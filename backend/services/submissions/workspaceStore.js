// The Firestore side of submissions (step 2.4), through the Admin SDK. The backend reads the
// submitted document and the tracking counts itself, so a browser can't send its own numbers
// (audit S4/S5). Field names follow what the app already writes (firestoreService.js) and what
// the deadline job reads (src/jobs/deadlines/submit.js).
//
// Privacy: tracking events stored here are counts, lengths and classes only. Paste events get
// the pasted length, never the pasted text (contrast savePasteEvent in the browser, audit S11).
import { FieldValue } from 'firebase-admin/firestore';
import { fail } from '../../routes/http.js';
import { stripHtml } from '../analysis/text.js';

const docsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/** Per-student counts at submission time: the `author_metrics` column. Members with no data get zeros. */
export function buildAuthorMetrics(memberIds, analytics, pasteEvents) {
  const byUid = new Map(analytics.map((a) => [a.uid || a.id, a]));
  return Object.fromEntries(
    memberIds.map((uid) => {
      const a = byUid.get(uid) || {};
      const mine = pasteEvents.filter((p) => p.userId === uid);
      return [
        uid,
        {
          // The editor counts active writing time in minutes.
          timeSpentSec: Math.max(0, Math.round((Number(a.timeSpent) || 0) * 60)),
          edits: Math.max(0, Math.round(Number(a.edits) || 0)),
          pasteEvents: mine.length,
          largePastes: mine.filter((p) => p.changeType === 'paste-large').length,
          tabEdits: a.tabEdits && typeof a.tabEdits === 'object' ? a.tabEdits : {},
        },
      ];
    })
  );
}

export function createWorkspaceStore(getClients) {
  const fs = () => {
    const db = getClients()?.db;
    if (!db) throw fail(503, 'FIRESTORE_UNAVAILABLE');
    return db;
  };

  async function readText(db, fileId, file) {
    const content = await db.collection('documents').doc(fileId).get();
    const stored = content.exists ? content.data() : {};
    const html = stored.html || file.contentHtml || '';
    return stored.text || file.content || stripHtml(html);
  }

  return {
    /** The file's text and every member's counts. 404 if the file isn't in the workspace. */
    async readSubmission(workspaceId, fileId, memberIds) {
      const db = fs();
      const groupRef = db.collection('groups').doc(workspaceId);
      const fileSnap = await groupRef.collection('files').doc(fileId).get();
      if (!fileSnap.exists) throw fail(404, 'NOT_FOUND', 'That file is not in this workspace.');
      const file = fileSnap.data();
      const [text, analyticsSnap, pasteSnap] = await Promise.all([
        readText(db, fileId, file),
        db.collection('analytics').doc(workspaceId).collection('members').get(),
        groupRef.collection('pasteEvents').get(),
      ]);
      return {
        text,
        fileName: file.name ?? null,
        authorMetrics: buildAuthorMetrics(memberIds, docsOf(analyticsSnap), docsOf(pasteSnap)),
      };
    },

    /** The text of an already-submitted file, for a re-run. `documentRef` is groups/{id}/files/{fileId}. */
    async readSubmittedText(documentRef) {
      const db = fs();
      const fileSnap = await db.doc(documentRef).get();
      return readText(db, fileSnap.id, fileSnap.exists ? fileSnap.data() : {});
    },

    /**
     * Hand the workspace to the course lecturers and lock it, as the app and the deadline job do:
     * submittedToLecturers unlocks it for them in firestore.rules; locked makes it read-only.
     */
    async markSubmitted(workspaceId, { fileId, lecturerIds, submittedBy, nowIso }) {
      const db = fs();
      const groupRef = db.collection('groups').doc(workspaceId);
      const batch = db.batch();
      batch.update(groupRef, {
        ...(lecturerIds.length ? { submittedToLecturers: FieldValue.arrayUnion(...lecturerIds) } : {}),
        locked: true,
        lockedAt: nowIso,
        lockedBy: 'submission',
        submittedBy,
      });
      batch.update(groupRef.collection('files').doc(fileId), { submitted: true, submittedAt: nowIso });
      await batch.commit();
    },

    /** Store validated tracking events for one student: counts on their analytics entry, paste events without text. */
    async recordEvents(workspaceId, uid, events) {
      const db = fs();
      const batch = db.batch();
      const member = db.collection('analytics').doc(workspaceId).collection('members').doc(uid);
      let edits = 0;
      let timeSpent = 0;
      let versions = 0;
      const tabEdits = {};
      for (const e of events) {
        const p = e.payload;
        if (e.kind === 'metric') {
          edits += p.edits || 0;
          timeSpent += p.timeSpent || 0;
          if (p.tabId && p.edits) tabEdits[p.tabId] = (tabEdits[p.tabId] || 0) + p.edits;
        } else if (e.kind === 'paste') {
          batch.set(db.collection('groups').doc(workspaceId).collection('pasteEvents').doc(), {
            fileId: p.fileId,
            userId: uid,
            changeType: p.changeType,
            length: p.length,
            ...(p.tabId ? { tabId: p.tabId } : {}),
            timestamp: e.at,
            createdAt: FieldValue.serverTimestamp(),
          });
        } else if (e.kind === 'version') {
          versions += 1;
        }
      }
      const counts = { uid };
      if (edits) counts.edits = FieldValue.increment(edits);
      if (timeSpent) counts.timeSpent = FieldValue.increment(timeSpent);
      if (versions) counts.versions = FieldValue.increment(versions);
      for (const [tab, n] of Object.entries(tabEdits)) counts[`tabEdits.${tab}`] = FieldValue.increment(n);
      // update() understands dotted paths; set() would not. Create the entry first if needed.
      batch.set(member, { uid }, { merge: true });
      batch.update(member, counts);
      await batch.commit();
    },
  };
}
