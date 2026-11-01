// Entry point for backend/server.js: start the every-minute deadline lock. `pool` is the
// PostgreSQL pool from backend/db/pool.js, or null without DATABASE_URL (Firestore deadlines only).
import { analyzeSubmission } from '../../../routes/check.js';
import { getDeadlineDb } from './firestore.js';
import { startDeadlineJob } from './job.js';
import { createDeadlineStore } from './postgres.js';

export function startServerDeadlines({ pool = null } = {}) {
  return startDeadlineJob({ db: getDeadlineDb(), pg: pool ? createDeadlineStore(pool) : null, analyze: analyzeSubmission });
}
