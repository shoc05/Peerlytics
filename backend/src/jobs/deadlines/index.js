// Entry point for backend/server.js: start the every-minute deadline lock.
import { analyzeSubmission } from '../../../routes/check.js';
import { getDeadlineDb } from './firestore.js';
import { startDeadlineJob } from './job.js';

export function startServerDeadlines() {
  return startDeadlineJob({ db: getDeadlineDb(), analyze: analyzeSubmission });
}
