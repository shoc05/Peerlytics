// requireActiveSubscription for the course routes (spec section 2, D3). With billing_enabled off
// it does nothing, so courses work exactly as before. With it on, creating courses, projects and
// groups, adding members, submitting and new AI analysis need the course owner to hold a seat on
// a college subscription that is active or in grace. Viewing and export are never blocked.
import { fail } from '../../routes/http.js';
import { lecturerCoverage } from './store.js';

/**
 * @param {{ db, isEnabled: (name: string) => Promise<boolean>, now?: () => number }} deps
 * @returns {(q, lecturerId: string, opts?: { newCourse?: boolean }) => Promise<object|null>}
 *   Resolves to the coverage (or null when billing is off); throws 403 NO_SEAT,
 *   SUBSCRIPTION_INACTIVE or COURSE_LIMIT.
 */
export function createCoverageCheck({ isEnabled, now = Date.now }) {
  return async function requireCovered(q, lecturerId, { newCourse = false } = {}) {
    if (!(await isEnabled('billing_enabled'))) return null;
    const coverage = await lecturerCoverage(q, lecturerId, { now: new Date(now()) });
    if (!coverage.covered) throw fail(403, coverage.reason);
    if (newCourse && coverage.maxCourses != null) {
      const { rows } = await q.query('SELECT count(*)::int AS n FROM courses WHERE owner_id = $1 AND archived_at IS NULL', [lecturerId]);
      if (rows[0].n >= coverage.maxCourses) throw fail(403, 'COURSE_LIMIT');
    }
    return coverage;
  };
}
