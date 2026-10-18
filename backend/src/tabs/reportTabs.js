// Document tab titles sent with a submission (step 2.3), kept on the analysis report so the
// lecturer sees which part of the document is which. Bad input is dropped, never fatal: a
// submission must not fail because of its tab list.
import { z } from 'zod';

const tabSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(100),
  depth: z.number().int().min(0).max(2),
  wordCount: z.number().int().min(0).max(1_000_000),
});

export const reportTabsSchema = z.array(tabSchema).min(1).max(50);

/** The tab list to store on the report, or null when absent or invalid. */
export function reportTabs(raw) {
  if (raw == null) return null;
  const parsed = reportTabsSchema.safeParse(raw);
  return parsed.success ? parsed.data.map(({ id, title, depth, wordCount }) => ({ id, title, depth, wordCount })) : null;
}
