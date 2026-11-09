// Request bodies for the billing and college routes (Zod, strict: unknown fields are refused).
import { z } from 'zod';
import { normaliseJournal } from './status.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'This is not a real date.');

const money = z.number().positive().max(9_999_999_999.99).refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, 'Use at most two decimal places.');
const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters.').max(500);
const optionalText = (max) => z.string().trim().max(max).nullable().optional();

export const uuid = z.string().uuid();

export const planCreate = z
  .object({
    name: z.string().trim().min(2).max(100),
    priceNu: money,
    durationDays: z.number().int().min(1).max(1100),
    seats: z.number().int().min(1).max(100000),
    maxCourses: z.number().int().min(1).max(1000).nullable().optional(),
    monthlyAiAnalyses: z.number().int().min(0).max(10_000_000).nullable().optional(),
    manualOnly: z.boolean().optional(),
  })
  .strict();

export const planUpdate = planCreate
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Change at least one field.');

export const methodCreate = z.object({ name: z.string().trim().min(2).max(60) }).strict();
export const methodUpdate = z.object({ isActive: z.boolean() }).strict();

export const settingsUpdate = z
  .object({
    accountName: optionalText(200),
    accountNumber: optionalText(60),
    bank: optionalText(200),
    qrImagePath: optionalText(500),
    verificationMessage: optionalText(2000),
    refundPolicy: optionalText(4000),
    graceDays: z.number().int().min(0).max(60),
  })
  .strict();

export const paymentRequestCreate = z
  .object({
    planId: uuid,
    paymentMethodId: uuid,
    amountNu: money,
    journalNumber: z
      .string()
      .transform(normaliseJournal)
      .pipe(z.string().regex(/^[A-Z0-9-]{4,40}$/, 'Use 4 to 40 letters, digits or hyphens.')),
    paidOn: isoDate,
  })
  .strict();

export const requestListQuery = z
  .object({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'all']).default('pending') })
  .strict();

export const rejectBody = z.object({ reason }).strict();

export const grantBody = z
  .object({
    planId: uuid,
    days: z.number().int().min(1).max(1100).optional(),
    note: reason,
  })
  .strict();

export const extendBody = z.object({ days: z.number().int().min(1).max(1100), reason }).strict();
export const revokeBody = z.object({ reason }).strict();

export const lecturerAdd = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();
export const uidParam = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
