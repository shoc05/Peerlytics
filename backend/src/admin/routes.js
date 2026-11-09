// Colleges and licences for a superAdmin. Colleges are behind licensing_enabled or billing_enabled,
// licences behind licensing_enabled only. A licence is a record
// for now: nothing here limits seats or AI spending, and there are no payments.
import express from 'express';
import { z } from 'zod';
import { sendError, zodDetails } from '../auth/errors.js';
import { getAdmin } from '../auth/firebaseAdmin.js';
import { createRequireAuth, requireRole } from '../auth/middleware.js';
import { getFlag } from '../flags/index.js';
import { createAdminStore, StoreError } from './store.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'This is not a real date.');

export const collegeBody = z
  .object({
    name: z.string().trim().min(2).max(200),
    slug: z.string().regex(/^[a-z0-9-]{2,40}$/, 'Use 2 to 40 lower-case letters, digits or hyphens.'),
  })
  .strict();

export const licenceBody = z
  .object({
    plan: z.enum(['trial', 'standard']),
    seats: z.number().int().positive().max(1_000_000),
    monthlyAiBudgetUsd: z.number().min(0).max(99_999_999.99),
    startsOn: isoDate,
    endsOn: isoDate.nullable().optional(),
  })
  .strict()
  .refine((b) => b.endsOn == null || b.endsOn > b.startsOn, {
    message: 'The end date must be after the start date.',
    path: ['endsOn'],
  });

const collegeIdParam = z.string().uuid();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

export function createAdminRouter({ db, getClients = getAdmin, isEnabled = getFlag, store } = {}) {
  const router = express.Router();
  const requireAuth = createRequireAuth(() => getClients()?.auth ?? null);
  const admin = store ?? (db?.pool ? createAdminStore(db.pool) : null);

  // `flags`: any one of them turns the route on. Colleges are needed by licences and by billing.
  const gateFor = (...flags) => [
    requireAuth,
    requireRole('superAdmin'),
    wrap(async (_req, res, next) => {
      const on = await Promise.all(flags.map((flag) => isEnabled(flag)));
      if (!on.some(Boolean)) return sendError(res, 404, 'FEATURE_DISABLED');
      if (!admin) return sendError(res, 503, 'DATABASE_UNAVAILABLE');
      return next();
    }),
  ];
  const gate = gateFor('licensing_enabled', 'billing_enabled');
  const licenceGate = gateFor('licensing_enabled');

  router.get(
    '/admin/colleges',
    gate,
    wrap(async (_req, res) => {
      res.json({ colleges: await admin.listColleges() });
    })
  );

  router.post(
    '/admin/colleges',
    gate,
    wrap(async (req, res) => {
      const body = collegeBody.safeParse(req.body);
      if (!body.success) return sendError(res, 400, 'INVALID_BODY', zodDetails(body.error));
      try {
        return res.status(201).json(await admin.createCollege(body.data, req.user.uid));
      } catch (err) {
        if (err instanceof StoreError) return sendError(res, 409, err.code);
        throw err;
      }
    })
  );

  router.post(
    '/admin/colleges/:collegeId/licences',
    licenceGate,
    wrap(async (req, res) => {
      const collegeId = collegeIdParam.safeParse(req.params.collegeId);
      if (!collegeId.success) return sendError(res, 404, 'NOT_FOUND');
      const body = licenceBody.safeParse(req.body);
      if (!body.success) return sendError(res, 400, 'INVALID_BODY', zodDetails(body.error));
      try {
        const licence = await admin.addLicence(collegeId.data, { ...body.data, endsOn: body.data.endsOn ?? null }, req.user.uid);
        return res.status(201).json(licence);
      } catch (err) {
        if (err instanceof StoreError) return sendError(res, 404, err.code);
        throw err;
      }
    })
  );

  return router;
}
