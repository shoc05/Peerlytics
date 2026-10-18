// The five tabs of a course site, in display order.
export const COURSE_TABS = Object.freeze(['overview', 'assignments', 'groups', 'members', 'grades']);

/** A tab id from a URL or saved state; anything unknown opens Overview. */
export function parseCourseTab(value) {
  return COURSE_TABS.includes(value) ? value : 'overview';
}

/**
 * Arrow-key navigation for a tablist (WAI-ARIA tabs pattern).
 * Returns the index to focus, or null when the key doesn't move focus.
 */
export function tabIndexAfterKey(index, key, count = COURSE_TABS.length) {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight': return (index + 1) % count;
    case 'ArrowLeft': return (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}
