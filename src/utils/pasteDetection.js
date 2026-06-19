/** Large paste threshold (chars added in one action) */
export const LARGE_PASTE_CHARS = 80;
/** Small paste: between these and LARGE */
export const SMALL_PASTE_CHARS = 25;

export function classifyPasteDelta(delta) {
  if (delta >= LARGE_PASTE_CHARS) return 'paste-large';
  if (delta >= SMALL_PASTE_CHARS) return 'paste-small';
  return null;
}

export function buildPasteRanges(prevLen, newLen) {
  return [{ start: prevLen, end: newLen, size: newLen - prevLen }];
}
