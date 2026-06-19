/**
 * Heuristic content difficulty (1–3) for grading weights.
 */
export function detectContentDifficulty({ text = '', type = 'document', html = '' }) {
  if (type === 'code') return 3;
  if (type === 'spreadsheet') return 1.5;

  const plain = (text || '').trim() || html.replace(/<[^>]+>/g, ' ');
  const words = plain.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const sentences = plain.split(/[.!?]+/).filter((s) => s.trim().length > 5);
  const avgWordLen =
    words.reduce((a, w) => a + w.length, 0) / Math.max(words.length, 1);

  let score = type === 'presentation' ? 1.2 : 1.5;
  if (wordCount > 400) score += 0.6;
  else if (wordCount > 150) score += 0.35;
  if (avgWordLen > 6.5) score += 0.25;
  if (sentences.length > 20) score += 0.2;
  if (/function|class|def |import |#include|algorithm/i.test(plain)) score = Math.max(score, 2.8);

  return Math.round(Math.min(3, Math.max(1, score)) * 10) / 10;
}
