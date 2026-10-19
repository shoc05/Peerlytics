// Text helpers shared by the providers.

const normalise = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Keep only flagged sentences that really appear in the text (whitespace and case aside, the
 * same test the document viewer uses to highlight them), dropping duplicates. A model that
 * paraphrases must not produce a red highlight on words the student never wrote.
 */
export function keepVerbatim(flags, text) {
  const haystack = normalise(text);
  const seen = new Set();
  return flags.filter((f) => {
    const needle = normalise(f?.sentence);
    if (needle.length < 12 || !haystack.includes(needle) || seen.has(needle)) return false;
    seen.add(needle);
    return true;
  });
}

export function stripHtml(html) {
  return String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export const wordCount = (text) => String(text ?? '').split(/\s+/).filter(Boolean).length;
