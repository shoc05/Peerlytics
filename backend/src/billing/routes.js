// Billing and college routes (docs/billing.md, docs/phase6-spec.md section 3.1).
//
//   superAdmin   /api/admin/billing/...  plans, payment methods and settings, the payment queue,
//                                         colleges with their status, grants, extensions, revokes
//   collegeAdmin /api/college/...         their own college only: lecturers, seats, paying
//   anyone       /api/billing/me          whether the caller's lecturer seat is covered
//
// Everything about money is behind billing_enabled. GET /api/college and adding lecturers to a
// college work without it, so a collegeAdmin always has a page of their own.
import { randomBytes } from 'node:crypto';
import express from 'express';
import { getAdmin } from '../auth/firebaseAdmin.js';
import { createRequireAuth, requireRole } from '../auth/middleware.js';
import { claimsToRole } from '../auth/roles.js';
import { getFlag } from '../flags/index.js';
import { createUserRateLimit, fail, handler, parse, requireDb } from '../../routes/http.js';
import { collegeUuid, ensureUser } from '../../services/courses/access.js';
import * as schema from './schemas.js';
import * as store from './store.js';

const ANY_ROLE = ['student', 'lecturer', 'collegeAdmin', 'superAdmin'];

function idParam(value) {
  const parsed = schema.uuid.safeParse(value);
  if (!parsed.success) throw fail(404, 'NOT_FOUND');
  return parsed.data.toLowerCase();
}

function uidParam(value) {
  const parsed = schema.uidParam.safeParse(value);
  if (!parsed.success) throw fail(404, 'NOT_FOUND');
  return parsed.data;
}

/**
 * @param {{ db, getClients?, isEnabled?, now?, random?, payLimit? }} deps
 *   getClients returns { auth, db } (firebase-admin) or null; tests pass fakes.
 */
export function createBillingRouter({
  db,
  getClients = getAdmin,
  isEnabled = getFlag,
  now = Date.now,
  random = randomBytes,
  payLimit = createUserRateLimit({ max: 5, windowMs: 60_000 }),
}) {
  const router = express.Router();
  const requireAuth = createRequireAuth(() => getClients()?.auth ?? null);
  const at = () => new Date(now());

  async function lookupName(uid) {
    try {
      return (await getClients()?.auth?.getUser(uid))?.displayName ?? null;
    } catch {
      return null;
    }
  }
  const syncUser = (req, _res, next) => ensureUser(db.pool, req.user, lookupName).then(() => next(), next);
  const requireBilling = (_req, res, next) =>
    isEnabled('billing_enabled').then((on) => {
      if (on) return next();
      return res.status(404).json({ error: 'This feature is not turned on.', code: 'FEATURE_DISABLED' });
    }, next);
  const requireCollege = (req, res, next) => {
    req.collegeId = collegeUuid(req.user)?.toLowerCase() ?? null;
    if (req.collegeId) return next();
    return res.status(409).json({ error: 'Your account is not linked to a college. Ask the Peerlytics administrator.', code: 'NO_COLLEGE' });
  };

  const superAdmin = [requireAuth, requireRole('superAdmin'), requireBilling, requireDb(db), syncUser];
  const collegeAdmin = [requireAuth, requireRole('collegeAdmin'), requireCollege, requireDb(db), syncUser];
  const collegeBilling = [...collegeAdmin, requireBilling];

  // ── superAdmin: plans ──
  router.get('/admin/billing/plans', superAdmin, handler(async (_req, res) => res.json({ plans: await store.listPlans(db.pool) })));
  router.post(
    '/admin/billing/plans',
    superAdmin,
    handler(async (req, res) => res.status(201).json(await store.createPlan(db.pool, parse(schema.planCreate, req.body), req.user.uid)))
  );
  router.patch(
    '/admin/billing/plans/:id',
    superAdmin,
    handler(async (req, res) => res.json(await store.updatePlan(db.pool, idParam(req.params.id), parse(schema.planUpdate, req.body), req.user.uid)))
  );

  // ── superAdmin: payment methods and settings ──
  router.get('/admin/billing/methods', superAdmin, handler(async (_req, res) => res.json({ methods: await store.listMethods(db.pool) })));
  router.post(
    '/admin/billing/methods',
    superAdmin,
    handler(async (req, res) => res.status(201).json(await store.createMethod(db.pool, parse(schema.methodCreate, req.body), req.user.uid)))
  );
  router.patch(
    '/admin/billing/methods/:id',
    superAdmin,
    handler(async (req, res) => res.json(await store.updateMethod(db.pool, idParam(req.params.id), parse(schema.methodUpdate, req.body), req.user.uid)))
  );
  router.get('/admin/billing/settings', superAdmin, handler(async (_req, res) => res.json(await store.getSettings(db.pool))));
  router.put(
    '/admin/billing/settings',
    superAdmin,
    handler(async (req, res) => res.json(await store.updateSettings(db.pool, parse(schema.settingsUpdate, req.body), req.user.uid)))
  );

  // ── superAdmin: the payment queue ──
  router.get(
    '/admin/billing/requests',
    superAdmin,
    handler(async (req, res) => {
      const { status } = parse(schema.requestListQuery, req.query);
      res.json({ requests: await store.listRequests(db.pool, { status, staff: true }) });
    })
  );
  router.post(
    '/admin/billing/requests/:id/approve',
    superAdmin,
    handler(async (req, res) => res.json(await store.approveRequest(db.pool, { id: idParam(req.params.id), actorId: req.user.uid, now: at() })))
  );
  router.post(
    '/admin/billing/requests/:id/reject',
    superAdmin,
    handler(async (req, res) => {
      const { reason } = parse(schema.rejectBody, req.body);
      res.json(await store.rejectRequest(db.pool, { id: idParam(req.params.id), actorId: req.user.uid, reason, now: at() }));
    })
  );
  router.post(
    '/admin/billing/requests/:id/cancel',
    superAdmin,
    handler(async (req, res) => res.json(await store.cancelRequest(db.pool, { id: idParam(req.params.id), actorId: req.user.uid, now: at() })))
  );

  // ── superAdmin: colleges and subscriptions ──
  router.get(
    '/admin/billing/colleges',
    superAdmin,
    handler(async (_req, res) => res.json({ colleges: await store.listCollegesWithBilling(db.pool, { now: at() }) }))
  );
  router.post(
    '/admin/billing/colleges/:id/grants',
    superAdmin,
    handler(async (req, res) => {
      const body = parse(schema.grantBody, req.body);
      const subscription = await store.grantSubscription(db.pool, { collegeId: idParam(req.params.id), ...body, actorId: req.user.uid, now: at() });
      res.status(201).json(subscription);
    })
  );
  router.post(
    '/admin/billing/subscriptions/:id/extend',
    superAdmin,
    handler(async (req, res) => {
      const body = parse(schema.extendBody, req.body);
      res.json(await store.extendSubscription(db.pool, { id: idParam(req.params.id), ...body, actorId: req.user.uid, now: at() }));
    })
  );
  router.post(
    '/admin/billing/subscriptions/:id/revoke',
    superAdmin,
    handler(async (req, res) => {
      const { reason } = parse(schema.revokeBody, req.body);
      res.json(await store.revokeSubscription(db.pool, { id: idParam(req.params.id), reason, actorId: req.user.uid, now: at() }));
    })
  );

  // ── collegeAdmin: their college ──
  router.get(
    '/college',
    collegeAdmin,
    handler(async (req, res) => {
      const billingOn = await isEnabled('billing_enabled');
      res.json(await store.collegeOverview(db.pool, req.collegeId, { now: at(), billingOn }));
    })
  );

  /** Set a lecturer's collegeId claim and sign them out once so their next token carries it. */
  async function setLecturerCollege(uid, collegeId) {
    const clients = getClients();
    await clients.auth.setCustomUserClaims(uid, { role: 'lecturer', collegeId });
    if (clients.db) await clients.db.collection('users').doc(uid).set({ role: 'lecturer', collegeId }, { merge: true });
    await clients.auth.revokeRefreshTokens(uid);
  }

  router.post(
    '/college/lecturers',
    collegeAdmin,
    handler(async (req, res) => {
      const { email } = parse(schema.lecturerAdd, req.body);
      const { auth } = getClients();
      let record;
      try {
        record = await auth.getUserByEmail(email);
      } catch (err) {
        if (err?.code === 'auth/user-not-found') throw fail(404, 'NOT_A_LECTURER');
        throw err;
      }
      const claims = claimsToRole(record.customClaims);
      // The same answer for "no account" and "not a lecturer", so this can't be used to find accounts.
      if (claims.role !== 'lecturer') throw fail(404, 'NOT_A_LECTURER');
      if (claims.collegeId && claims.collegeId.toLowerCase() !== req.collegeId) throw fail(409, 'IN_ANOTHER_COLLEGE');
      if (claims.collegeId?.toLowerCase() !== req.collegeId) await setLecturerCollege(record.uid, req.collegeId);
      await store.addCollegeLecturer(db.pool, { collegeId: req.collegeId, uid: record.uid, email, name: record.displayName, actorId: req.user.uid });
      res.status(201).json(await store.collegeOverview(db.pool, req.collegeId, { now: at(), billingOn: await isEnabled('billing_enabled') }));
    })
  );

  router.delete(
    '/college/lecturers/:uid',
    collegeAdmin,
    handler(async (req, res) => {
      const uid = uidParam(req.params.uid);
      await store.removeCollegeLecturer(db.pool, { collegeId: req.collegeId, uid, actorId: req.user.uid, now: at() });
      await setLecturerCollege(uid, null);
      res.status(204).end();
    })
  );

  // ── collegeAdmin: paying and seats (billing_enabled) ──
  router.get(
    '/college/billing',
    collegeBilling,
    handler(async (req, res) => {
      const [plans, methods, settings, requests] = await Promise.all([
        store.listPlans(db.pool, { forBuyers: true }),
        store.listMethods(db.pool, { activeOnly: true }),
        store.getSettings(db.pool),
        store.listRequests(db.pool, { status: 'all', collegeId: req.collegeId }),
      ]);
      const { accountName, accountNumber, bank, qrImagePath, verificationMessage, refundPolicy } = settings;
      res.json({ plans, methods, payTo: { accountName, accountNumber, bank, qrImagePath, verificationMessage, refundPolicy }, requests });
    })
  );

  router.post(
    '/college/payment-requests',
    collegeBilling,
    handler(async (req, res) => {
      payLimit(req.user.uid);
      const body = parse(schema.paymentRequestCreate, req.body);
      const created = await store.createPaymentRequest(db.pool, { payerId: req.user.uid, collegeId: req.collegeId, body, now: at(), random });
      res.status(201).json(created);
    })
  );

  router.post(
    '/college/payment-requests/:id/cancel',
    collegeBilling,
    handler(async (req, res) =>
      res.json(await store.cancelRequest(db.pool, { id: idParam(req.params.id), actorId: req.user.uid, collegeId: req.collegeId, now: at() }))
    )
  );

  router.post(
    '/college/seats/:uid',
    collegeBilling,
    handler(async (req, res) =>
      res.status(201).json(await store.assignSeat(db.pool, { collegeId: req.collegeId, lecturerId: uidParam(req.params.uid), actorId: req.user.uid, now: at() }))
    )
  );

  router.delete(
    '/college/seats/:uid',
    collegeBilling,
    handler(async (req, res) => {
      await store.removeSeat(db.pool, { collegeId: req.collegeId, lecturerId: uidParam(req.params.uid), actorId: req.user.uid, now: at() });
      res.status(204).end();
    })
  );

  // ── Anyone: is my work covered? ──
  router.get(
    '/billing/me',
    requireAuth,
    requireRole(...ANY_ROLE),
    handler(async (req, res) => {
      const billingEnabled = await isEnabled('billing_enabled');
      if (!billingEnabled || req.user.role !== 'lecturer' || !db.pool) return res.json({ billingEnabled, coverage: null });
      return res.json({ billingEnabled, coverage: await store.lecturerCoverage(db.pool, req.user.uid, { now: at() }) });
    })
  );

  return router;
}
