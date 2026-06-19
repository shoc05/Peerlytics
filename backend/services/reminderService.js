// Deadline reminder emails for OFFLINE members.
//
// Why this is server-side: the browser can only fire reminders while a tab is open, so it
// can never reach a student who is offline. This module runs on a schedule inside the Express
// backend (node-cron), reads workspaces + members + presence + submissions via the Firebase
// Admin SDK (a service account, which bypasses Firestore security rules — the client SDK
// cannot read across users), and emails anyone who is offline, hasn't submitted, and whose
// deadline is within the reminder window.
//
// SAFETY / DORMANCY: the whole feature is OPTIONAL. If the service-account key or the SMTP
// credentials are missing it logs ONE warning and stays dormant — the rest of the app is
// completely unaffected. Configure it by adding to backend/.env:
//   FIREBASE_SERVICE_ACCOUNT=./serviceAccountKey.json   (downloaded from Firebase console)
//   SMTP_USER=you@gmail.com
//   SMTP_PASS=<16-char Gmail app password>               (NOT your normal password)
//   SMTP_HOST=smtp.gmail.com  SMTP_PORT=465              (optional; these are the defaults)
//   REMINDER_WINDOW_HOURS=24                             (optional; how early to start nudging)
//   REMINDER_OFFLINE_SECONDS=300                         (optional; "offline" = no presence in N s)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import nodemailer from 'nodemailer';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WINDOW_HOURS = Number(process.env.REMINDER_WINDOW_HOURS || 24);
const OFFLINE_SECONDS = Number(process.env.REMINDER_OFFLINE_SECONDS || 300);
const CRON_EXPR = process.env.REMINDER_CRON || '*/15 * * * *'; // every 15 min

let db = null;
let transporter = null;
// In-memory guard so we don't re-email the same person for the same deadline on every tick.
// Resets when the backend restarts (fine for a prototype; a deployed version would persist this).
const sentLog = new Set(); // key: `${groupId}:${userId}:${deadlineMs}`

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  // Accept either a path to a JSON file or the JSON itself pasted into the env var.
  const trimmed = raw.trim();
  try {
    if (trimmed.startsWith('{')) return JSON.parse(trimmed);
    const file = path.isAbsolute(trimmed) ? trimmed : path.resolve(__dirname, '..', trimmed);
    if (!fs.existsSync(file)) {
      console.warn(`⚠ Reminder emails: FIREBASE_SERVICE_ACCOUNT points to "${file}" which does not exist.`);
      return null;
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn('⚠ Reminder emails: could not parse FIREBASE_SERVICE_ACCOUNT —', err.message);
    return null;
  }
}

function buildTransporter() {
  const user = process.env.SMTP_USER;
  // Gmail shows app passwords as "abcd efgh ijkl mnop" (with spaces) but rejects them if the
  // spaces are sent — so strip all whitespace, letting either paste format work.
  const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user, pass },
  });
}

/**
 * Send a single test reminder email to confirm SMTP is configured correctly.
 * Used by `npm run test:mail`. Throws (with the SMTP error) if it can't send.
 */
export async function sendTestEmail(to) {
  transporter = buildTransporter();
  if (!transporter) {
    throw new Error('SMTP not configured — set SMTP_USER and SMTP_PASS in .env first.');
  }
  const recipient = to || process.env.SMTP_USER;
  await transporter.verify(); // surfaces auth/connection problems clearly before sending
  await sendReminderEmail({
    to: recipient,
    name: 'there',
    workspaceName: 'Test Workspace',
    deadlineMs: Date.now() + 3 * 3600_000, // pretend deadline 3h out
  });
  return recipient;
}

/** Initialise the reminder cron. No-op (with a clear log) if not configured. */
export function startDeadlineReminders() {
  const serviceAccount = loadServiceAccount();
  transporter = buildTransporter();

  if (!serviceAccount || !transporter) {
    const missing = [
      !serviceAccount && 'FIREBASE_SERVICE_ACCOUNT (Admin SDK key)',
      !transporter && 'SMTP_USER/SMTP_PASS (sender email)',
    ].filter(Boolean);
    console.log(`ℹ Deadline reminder emails are OFF — missing: ${missing.join(', ')}. (Optional feature; app is unaffected.)`);
    return;
  }

  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
  }
  db = getFirestore();

  cron.schedule(CRON_EXPR, () => {
    runReminderSweep().catch((err) => console.error('[reminders] sweep failed:', err.message));
  });
  console.log(`✓ Deadline reminder emails ON (every "${CRON_EXPR}", window ${WINDOW_HOURS}h, offline > ${OFFLINE_SECONDS}s).`);
  // Run one sweep shortly after boot so it's not silent until the first cron tick.
  setTimeout(() => runReminderSweep().catch(() => {}), 10_000);
}

function deadlineToMs(deadline) {
  if (!deadline) return null;
  if (deadline instanceof Timestamp) return deadline.toMillis();
  if (typeof deadline?.toMillis === 'function') return deadline.toMillis();
  const t = new Date(deadline).getTime();
  return Number.isFinite(t) ? t : null;
}

async function runReminderSweep() {
  const now = Date.now();
  const windowMs = WINDOW_HOURS * 3600_000;
  const groupsSnap = await db.collection('groups').get();

  for (const groupDoc of groupsSnap.docs) {
    const g = groupDoc.data();
    const groupId = groupDoc.id;
    const deadlineMs = deadlineToMs(g.deadline);
    // Only groups with a deadline that is in the future but within the reminder window.
    if (deadlineMs == null) continue;
    if (deadlineMs <= now || deadlineMs - now > windowMs) continue;

    const memberIds = Array.isArray(g.memberIds) ? g.memberIds : [];
    const studentIds = memberIds.filter((id) => !(g.lecturerIds || []).includes(id));
    if (!studentIds.length) continue;

    // Who is currently online (presence updated within OFFLINE_SECONDS)?
    const presenceSnap = await db.collection('groups').doc(groupId).collection('presence').get();
    const onlineIds = new Set();
    presenceSnap.forEach((p) => {
      const seen = deadlineToMs(p.data().lastSeen);
      if (seen && now - seen < OFFLINE_SECONDS * 1000) onlineIds.add(p.id);
    });

    // Who has already submitted in this workspace? (submittedToLecturers means a submission
    // happened; we also check per-user submissions so we only nudge those still pending.)
    const submittedIds = new Set();
    try {
      const subs = await db.collection('submissions').where('workspaceId', '==', groupId).get();
      subs.forEach((s) => {
        const d = s.data();
        if (d.submittedBy) submittedIds.add(d.submittedBy);
        if (d.userId) submittedIds.add(d.userId);
      });
    } catch { /* submissions query optional */ }

    for (const uid of studentIds) {
      if (onlineIds.has(uid)) continue; // online → the in-app reminder covers them
      if (submittedIds.has(uid)) continue; // already submitted → nothing to nudge
      const key = `${groupId}:${uid}:${deadlineMs}`;
      if (sentLog.has(key)) continue; // already emailed for this deadline

      const userSnap = await db.collection('users').doc(uid).get();
      const user = userSnap.exists ? userSnap.data() : null;
      const email = user?.email;
      if (!email) continue;

      await sendReminderEmail({
        to: email,
        name: user.name || user.displayName || 'there',
        workspaceName: g.name || 'your workspace',
        deadlineMs,
      }).then(() => {
        sentLog.add(key);
        console.log(`[reminders] emailed ${email} for "${g.name}" (deadline ${new Date(deadlineMs).toISOString()})`);
      }).catch((err) => console.error(`[reminders] send to ${email} failed:`, err.message));
    }
  }
}

async function sendReminderEmail({ to, name, workspaceName, deadlineMs }) {
  const when = new Date(deadlineMs);
  const hoursLeft = Math.max(0, Math.round((deadlineMs - Date.now()) / 3600_000));
  const dateStr = when.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const from = process.env.SMTP_FROM || `Peerlytics <${process.env.SMTP_USER}>`;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto">
      <h2 style="color:#0f766e;margin-bottom:4px">Peerlytics — Submission reminder</h2>
      <p>Hi ${escape(name)},</p>
      <p>Your submission for <strong>${escape(workspaceName)}</strong> is due in
         about <strong>${hoursLeft} hour(s)</strong> — by <strong>${escape(dateStr)}</strong>.</p>
      <p>You haven't submitted yet. Open your workspace and submit before the deadline so your
         work is included in the lecturer's review.</p>
      <p style="color:#64748b;font-size:12px;margin-top:24px">
        You received this because you're a member of this workspace and were offline near the deadline.
      </p>
    </div>`;

  await transporter.sendMail({
    from,
    to,
    subject: `Reminder: "${workspaceName}" is due in ~${hoursLeft}h`,
    text: `Hi ${name}, your submission for "${workspaceName}" is due by ${dateStr} (~${hoursLeft}h). You haven't submitted yet — please submit before the deadline.`,
    html,
  });
}

function escape(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
