// Accurate document highlighting.
//
// Approach: work on the document's PLAIN TEXT (not raw HTML). For each flag we locate its
// text as a character range in the document, merge overlapping/adjacent ranges (so two
// flags over the same words don't produce nested/broken markup), then rebuild the document
// as escaped text with <mark> wrappers around each range. This can't corrupt HTML tags and
// matches reliably regardless of inline formatting, because we compare normalized text.
//
// Yellow = copy-pasted, Red = AI-generated.

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function toInitials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

function stripTags(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Normalize for fuzzy locating: collapse whitespace, lowercase. We keep a map from the
// normalized index back to the original index so the highlight lands on the real text.
function normalizeWithMap(text) {
  let norm = '';
  const map = []; // map[i in norm] = index in original text
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      norm += ' ';
      map.push(i);
      prevSpace = true;
    } else {
      norm += ch.toLowerCase();
      map.push(i);
      prevSpace = false;
    }
  }
  return { norm, map };
}

const wrapStyle = (flag) => {
  const isAI = flag.type === 'ai-generated' || flag.highlight === 'red';
  return {
    isAI,
    bg: isAI ? '#ffd6d6' : '#fff3b0',
    border: isAI ? '#dc143c' : '#daa520',
    label: isAI ? 'AI-generated' : 'Copy-pasted',
  };
};

function markOpen(flag) {
  const { isAI, bg, border, label } = wrapStyle(flag);
  const author = flag.authorName || flag.author || '';
  const initials = flag.authorInitials || (author ? toInitials(author) : '') || '?';
  const title = `${label} · ${author || 'Unattributed'}: ${flag.reason || 'Flagged'}`;
  const badge =
    `<span style="display:inline-block;font-size:9px;font-weight:700;line-height:1.4;` +
    `color:#fff;background:${border};border-radius:3px;padding:1px 4px;margin-right:3px;` +
    `vertical-align:middle;">${escapeHtml(initials)}</span>`;
  return (
    `<mark data-type="${isAI ? 'ai-generated' : 'plagiarism'}" ` +
    `data-author="${escapeHtml(author)}" title="${escapeHtml(title)}" ` +
    `style="background-color:${bg};border-bottom:2px solid ${border};padding:0 2px;border-radius:2px;cursor:help;">` +
    badge
  );
}

/**
 * Highlight flagged spans in plain document text. Returns HTML (escaped text + <mark>s,
 * newlines → <br>). This is the accurate path; injectHighlightsIntoHtml strips tags first.
 */
export function injectHighlightsIntoText(text, flaggedContent) {
  const src = String(text || '');
  if (!src) return '';
  if (!Array.isArray(flaggedContent) || !flaggedContent.length) {
    return escapeHtml(src).replace(/\n/g, '<br>');
  }

  const { norm, map } = normalizeWithMap(src);

  // 1) Locate every flag (and its sentence fragments) as ranges in the ORIGINAL text.
  const ranges = []; // { start, end, flag }
  const addRange = (needleRaw, flag) => {
    const needle = needleRaw.replace(/\s+/g, ' ').trim().toLowerCase();
    if (needle.length < 5) return false;
    let from = 0;
    let found = false;
    while (true) {
      const idx = norm.indexOf(needle, from);
      if (idx === -1) break;
      const start = map[idx];
      const end = map[Math.min(idx + needle.length - 1, map.length - 1)] + 1;
      ranges.push({ start, end, flag });
      found = true;
      from = idx + needle.length;
    }
    return found;
  };

  // Find the longest run of `needle` (from its start) that exists contiguously in the
  // normalized text, and highlight that whole run. This keeps a paste highlighted as ONE
  // block even when the snippet's tail differs slightly (trailing edits/whitespace), instead
  // of dropping unmatched sentence fragments — which left only part of the paste highlighted.
  const addLongestRun = (needleRaw, flag) => {
    const needle = needleRaw.replace(/\s+/g, ' ').trim().toLowerCase();
    if (needle.length < 5) return false;
    // Binary-search the longest prefix that occurs in norm.
    let lo = 5, hi = needle.length, best = 0;
    while (lo <= hi) {
      const midLen = (lo + hi) >> 1;
      if (norm.includes(needle.slice(0, midLen))) { best = midLen; lo = midLen + 1; }
      else hi = midLen - 1;
    }
    if (best < 8) return false;
    return addRange(needle.slice(0, best), flag);
  };

  // Find the longest run of consecutive WORDS from the needle that appears contiguously
  // anywhere in the text — anchored at any word, not just the start. AI excerpts quoted by
  // the LLM sometimes have a drifted leading OR trailing word (it lightly paraphrases the
  // edges), which makes both the exact match and the from-start prefix match fail and leaves
  // the sentence un-highlighted even though it's clearly the flagged content. Highlighting the
  // longest matching word-window recovers those cases.
  const addLongestWordWindow = (needleRaw, flag) => {
    const words = needleRaw.replace(/\s+/g, ' ').trim().toLowerCase().split(' ').filter(Boolean);
    if (words.length < 3) return false;
    let best = null; // { i, j } half-open word range with the most words that matches
    for (let i = 0; i < words.length; i++) {
      // Extend j as far as the window words.slice(i, j) still occurs contiguously in norm.
      let j = i + 1;
      while (j <= words.length && norm.includes(words.slice(i, j).join(' '))) j++;
      const len = j - 1 - i;
      if (len >= 3 && (!best || len > best.j - best.i)) best = { i, j: j - 1 };
    }
    if (!best) return false;
    return addRange(words.slice(best.i, best.j).join(' '), flag);
  };

  for (const flag of flaggedContent) {
    const raw = (flag?.text || '').trim();
    if (!raw) continue;
    // 1) Exact whole-snippet match (best). 2) Longest contiguous run from the start.
    // 3) Longest matching word-window anywhere. 4) Per-sentence fragments (last resort).
    if (addRange(raw, flag)) continue;
    if (addLongestRun(raw, flag)) continue;
    if (addLongestWordWindow(raw, flag)) continue;
    raw.split(/(?<=[.!?])\s+|\n+/).forEach((frag) => addRange(frag, flag));
  }

  if (!ranges.length) return escapeHtml(src).replace(/\n/g, '<br>');

  // 2) Sort + merge overlapping ranges (AI/red wins over copy/yellow on overlap).
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start < last.end) {
      last.end = Math.max(last.end, r.end);
      const lastAI = last.flag.type === 'ai-generated' || last.flag.highlight === 'red';
      const rAI = r.flag.type === 'ai-generated' || r.flag.highlight === 'red';
      if (rAI && !lastAI) last.flag = r.flag; // prefer the stronger (AI) signal
    } else {
      merged.push({ start: r.start, end: r.end, flag: r.flag });
    }
  }

  // 3) Rebuild: escaped text outside ranges, <mark>…</mark> inside. Newlines → <br>.
  let out = '';
  let cursor = 0;
  const nl = (s) => escapeHtml(s).replace(/\n/g, '<br>');
  for (const m of merged) {
    if (m.start > cursor) out += nl(src.slice(cursor, m.start));
    out += markOpen(m.flag) + nl(src.slice(m.start, m.end)) + '</mark>';
    cursor = m.end;
  }
  if (cursor < src.length) out += nl(src.slice(cursor));
  return out;
}

/**
 * Highlight flagged spans given the document as HTML. We strip tags to plain text and use
 * the accurate text-range path above — regex-replacing into live HTML was the source of the
 * inaccurate / corrupted highlights (matches inside tags, nested marks, first-occurrence-only).
 */
export function injectHighlightsIntoHtml(html, flaggedContent) {
  if (!html) return '';
  return injectHighlightsIntoText(stripTags(html), flaggedContent);
}
