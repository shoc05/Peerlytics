// Inline feedback anchors (step 4.6). A lecturer's comment is tied to the submitted text by a
// quote: the exact words plus a little text before and after. That survives the comment
// being shown in a different editor (the lecturer's snapshot, the students' read-only view)
// and picks the right spot when the same words appear twice. Pure functions.

export const CONTEXT = 32;
export const MAX_QUOTE = 1000;

/** text + [start, end) -> { exact, prefix, suffix }, or null for an empty selection. */
export function createAnchor(text, start, end) {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(text.length, Math.max(start, end));
  const exact = text.slice(from, to);
  if (!exact.trim() || exact.length > MAX_QUOTE) return null;
  return {
    exact,
    prefix: text.slice(Math.max(0, from - CONTEXT), from),
    suffix: text.slice(to, to + CONTEXT),
  };
}

function commonSuffix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
}

function commonPrefix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

/** Where the anchor is in `text`: { start, end }, or null when the words are gone. */
export function resolveAnchor(text, anchor) {
  if (!anchor?.exact) return null;
  let best = null;
  for (let i = text.indexOf(anchor.exact); i !== -1; i = text.indexOf(anchor.exact, i + 1)) {
    const end = i + anchor.exact.length;
    const score =
      commonSuffix(text.slice(Math.max(0, i - CONTEXT), i), anchor.prefix || '') +
      commonPrefix(text.slice(end, end + CONTEXT), anchor.suffix || '');
    if (!best || score > best.score) best = { start: i, end, score };
  }
  return best && { start: best.start, end: best.end };
}

/**
 * The plain text of a ProseMirror document with a map back to positions, so text offsets
 * (anchors) and editor positions (selection, highlights) can be converted both ways.
 * Blocks are separated by a blank line, like editor.getText().
 */
export function textIndex(doc) {
  let text = '';
  const positions = [];
  let firstBlock = true;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (!firstBlock) {
        text += '\n\n';
        positions.push(pos, pos);
      }
      firstBlock = false;
    } else if (node.isText) {
      for (let i = 0; i < node.text.length; i += 1) positions.push(pos + i);
      text += node.text;
    } else if (node.type.name === 'hardBreak') {
      text += '\n';
      positions.push(pos);
    }
  });
  return {
    text,
    /** Text range -> editor range. */
    toPositions(start, end) {
      if (start >= end || end > positions.length) return null;
      return { from: positions[start], to: positions[end - 1] + 1 };
    },
    /** Editor range -> text range. */
    toOffsets(from, to) {
      let start = positions.findIndex((p) => p >= from);
      if (start === -1) return null;
      let end = start;
      while (end < positions.length && positions[end] < to) end += 1;
      return end > start ? { start, end } : null;
    },
  };
}
