/**
 * Builds lecturer-facing structured report from AI + plagiarism results.
 */
const AI_UNAVAILABLE_MESSAGE =
  'AI evaluation unavailable — submission received successfully. The work has been ' +
  'delivered to the lecturer; automated writing analysis could not be generated at this time.';

export function buildSubmissionReport({ text, ai, plagiarism, meta = {} }) {
  const plagiarismScore = plagiarism.plagiarismScore ?? 0;

  // AI evaluation could not run (no key, quota exceeded, API/network error).
  // Per spec: never block submission, show no AI score — just the fallback message.
  // Plagiarism (EyeSift) is independent and still reported.
  if (ai && ai.aiAvailable === false) {
    return buildUnavailableReport({ plagiarism, plagiarismScore, meta });
  }

  const aiUsageScore = ai.aiGeneratedProbability ?? 0;
  const writingQuality = ai.writingQualityScore ?? 50;

  const overallRisk = Math.round(aiUsageScore * 0.35 + plagiarismScore * 0.45 + (100 - writingQuality) * 0.2);

  let recommendation = 'Accept';
  if (overallRisk >= 65) recommendation = 'Reject';
  else if (overallRisk >= 40) recommendation = 'Review';

  const suggestedGrade =
    recommendation === 'Accept'
      ? Math.min(10, Math.round(6 + writingQuality / 20))
      : recommendation === 'Review'
        ? Math.round(5 + writingQuality / 25)
        : Math.max(3, Math.round(4 + writingQuality / 30));

  const strengths = [];
  const weaknesses = [];

  if (writingQuality >= 70) strengths.push('Clear structure and readable flow');
  if (plagiarismScore < 20) strengths.push('Low similarity to external sources');
  if (aiUsageScore < 30) strengths.push('Writing appears authentically student-authored');

  if (plagiarismScore >= 35) weaknesses.push('Elevated plagiarism similarity — verify citations');
  if (aiUsageScore >= 45) weaknesses.push('Patterns consistent with AI-assisted writing');
  if (writingQuality < 55) weaknesses.push('Writing quality below cohort expectations');

  if (!strengths.length) strengths.push('Submission received and processed successfully');
  if (!weaknesses.length) weaknesses.push('No major issues detected in automated scan');

  const pasteEvents = meta.pasteEvents || [];

  // EVIDENCE-ONLY highlighting. We only emit a flag when we have hard evidence + a real
  // author — no guessing, no "attribute to submitter" fallback (which produced inaccurate
  // and mis-attributed highlights).
  //
  // YELLOW = copy-pasted: built ONLY from real paste events (each carries the author who
  // pasted it). No EyeSift/similarity guessing.
  const pasteFlags = pasteEvents
    .filter((p) => p.userId && (p.contentSnippet || '').trim().length > 12)
    .map((p, i) => ({
      id: `paste-${i}`,
      type: 'plagiarism',
      highlight: 'yellow',
      text: (p.contentSnippet || '').trim(),
      reason: p.changeType === 'paste-large' ? 'Large block pasted into the document' : 'Pasted content',
      authorId: p.userId,
      authorName: p.userName,
      authorInitials: toInitials(p.userName),
    }));

  // RED = AI-generated (real spans from the AI provider). Attribute each to WHOEVER WROTE
  // that text: 1) the version-history entry whose content contains the span (best signal
  // for typed AI text), else 2) paste overlap, else 3) the submitter (they own the doc).
  // AI content is usually typed, so version-history attribution is the key path.
  const versions = meta.versions || [];
  const submitter = (meta.userId || meta.studentName)
    ? { userId: meta.userId, userName: meta.studentName }
    : null;

  const aiFlags = (ai.flaggedSegments || []).map((f) => {
    const author =
      attributeFlagToVersionAuthor(f, versions) ||
      attributeFlagToAuthor(f, pasteEvents) ||
      submitter;
    return withAuthor({ ...f, highlight: 'red' }, author);
  });

  const allFlags = [...pasteFlags, ...aiFlags]
    .sort((a, b) => (a.startIndex ?? 0) - (b.startIndex ?? 0));

  // Per-author penalty inputs: how many large pastes each author made, and how much
  // of the flagged AI content is attributed to each author (their share, 0–100).
  const authorAttribution = buildAuthorAttribution(allFlags, pasteEvents, (text || '').length);

  return {
    id: `report-${Date.now()}`,
    createdAt: new Date().toISOString(),
    meta,
    aiScore: aiUsageScore,
    plagiarismScore,
    scores: {
      aiUsageScore,
      plagiarismScore,
      writingQualityScore: writingQuality,
      aiAuthenticityScore: ai.aiScore,
      overallRisk,
    },
    // Writing sub-scores (0–100) used by the behavioural grading model.
    metrics: ai.metrics || {},
    // False when GPTZero (AI detection) was unavailable — UI shows a notice instead of 0%.
    aiDetectionAvailable: ai.aiDetectionAvailable !== false,
    // False when VWT (writing analysis) was unavailable — UI hides the writing score.
    writingAnalysisAvailable: ai.writingAnalysisAvailable !== false,
    flaggedContent: allFlags,
    // Per-author attribution so grading can charge AI/paste penalties to the
    // responsible member only (keyed by userId): { [userId]: { name, initials,
    // largePasteCount, aiShare } }. aiShare is that author's % of flagged AI spans.
    authorAttribution,
    feedback: {
      strengths,
      weaknesses,
      summary: buildSummary(recommendation, plagiarismScore, aiUsageScore, writingQuality),
      pasteReview:
        meta.largePasteCount > 0
          ? `${meta.largePasteCount} large paste event(s) detected — review highlights.`
          : meta.pasteEventCount > 0
            ? `${meta.pasteEventCount} paste/edit event(s) logged for lecturer review.`
            : 'No suspicious paste blocks flagged.',
    },
    audit: {
      versionCount: meta.versionCount ?? 0,
      pasteEventCount: meta.pasteEventCount ?? 0,
      largePasteCount: meta.largePasteCount ?? 0,
      difficulty: meta.difficulty ?? 1,
    },
    recommendation,
    suggestedGrade,
    status: 'completed',
    aiEvaluation: 'available',
  };
}

/**
 * Report shape when AI evaluation could not be produced. Carries the fallback
 * message and plagiarism results only — no writing/AI scores, no suggested grade.
 */
function buildUnavailableReport({ plagiarism, plagiarismScore, meta }) {
  const flaggedContent = (plagiarism.flaggedSegments || [])
    .map((f) => ({ ...f, highlight: 'yellow' }))
    .sort((a, b) => a.startIndex - b.startIndex);

  return {
    id: `report-${Date.now()}`,
    createdAt: new Date().toISOString(),
    meta,
    plagiarismScore,
    scores: {
      plagiarismScore,
      // No AI/writing scores — evaluation was unavailable.
    },
    flaggedContent,
    feedback: {
      strengths: [],
      weaknesses: [],
      summary: AI_UNAVAILABLE_MESSAGE,
      pasteReview:
        meta.largePasteCount > 0
          ? `${meta.largePasteCount} large paste event(s) detected — review highlights.`
          : meta.pasteEventCount > 0
            ? `${meta.pasteEventCount} paste/edit event(s) logged for lecturer review.`
            : 'No suspicious paste blocks flagged.',
    },
    audit: {
      versionCount: meta.versionCount ?? 0,
      pasteEventCount: meta.pasteEventCount ?? 0,
      largePasteCount: meta.largePasteCount ?? 0,
      difficulty: meta.difficulty ?? 1,
    },
    recommendation: 'Manual review',
    suggestedGrade: null,
    status: 'completed',
    aiEvaluation: 'unavailable',
    aiUnavailableMessage: AI_UNAVAILABLE_MESSAGE,
  };
}

function buildSummary(recommendation, plagiarismScore, aiUsageScore, writingQuality) {
  return `Automated review complete. Recommendation: ${recommendation}. AI-likelihood: ${aiUsageScore}%, Writing quality: ${writingQuality}/100.`;
}

// ─── Per-author attribution ───────────────────────────────────────────────

function toInitials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase() || '?';
}

/**
 * Attribute a flagged span to the paste event whose snippet contains (or is
 * contained by) the flag text. Content-based so it doesn't depend on indices
 * lining up across the AI/plagiarism text. Returns the matching paste event
 * ({ userId, userName }) or null when no author can be determined.
 */
function withAuthor(flag, author) {
  if (!author || !author.userId) return flag;
  return { ...flag, authorId: author.userId, authorName: author.userName, authorInitials: toInitials(author.userName) };
}

function attributeFlagToAuthor(flag, pasteEvents) {
  const needle = String(flag.text || '').trim().toLowerCase();
  if (needle.length < 6 || !pasteEvents.length) return null;
  for (const ev of pasteEvents) {
    const hay = String(ev.contentSnippet || '').toLowerCase();
    if (!hay) continue;
    if (hay.includes(needle) || needle.includes(hay.slice(0, 40))) {
      return { userId: ev.userId, userName: ev.userName };
    }
  }
  return null;
}

// Attribute a flagged span to the version-history author whose CONTENT contains it.
// This catches typed AI text (no paste event). Newest matching author wins.
function attributeFlagToVersionAuthor(flag, versions) {
  const needle = String(flag.text || '').trim().toLowerCase();
  if (needle.length < 8 || !versions.length) return null;
  const sorted = [...versions].sort(
    (a, b) => (b.timestamp || b.createdAt?.seconds || 0) - (a.timestamp || a.createdAt?.seconds || 0)
  );
  for (const v of sorted) {
    const hay = String(v.content || '').toLowerCase();
    const who = v.author || v.user || v.userName || v.editedBy;
    if (who && hay && hay.includes(needle)) {
      // version entries store the display name; userId may be absent → use name as id.
      return { userId: v.authorId || v.userId || who, userName: who };
    }
  }
  return null;
}

/**
 * Build { [userId]: { name, initials, largePasteCount, aiShare } }.
 * - largePasteCount: number of this author's paste-large events.
 * - aiShare: this author's share (0–100) of the AI-flagged spans that could be attributed.
 */
function buildAuthorAttribution(flags, pasteEvents, textLength = 0) {
  // Key EVERY author by a normalised identity (lowercased name preferred, else uid) so
  // the same person's paste data and AI data always merge into ONE entry. Mixed keying
  // (uid for pastes, display-name for AI) previously split a person across two entries,
  // so the grade only picked up half their penalties.
  const idOf = (userId, name) => `id:${String(name || userId || '').trim().toLowerCase() || userId}`;
  const byId = {};
  const ensure = (userId, name) => {
    const key = idOf(userId, name);
    if (!byId[key]) byId[key] = { userId, name: name || 'Member', initials: toInitials(name), largePasteCount: 0, pastedChars: 0, pastePct: 0, aiShare: 0 };
    if (userId && !byId[key].userId) byId[key].userId = userId;
    return byId[key];
  };

  // Pastes per author.
  for (const ev of pasteEvents) {
    if (!ev.userId && !ev.userName) continue;
    const m = ensure(ev.userId, ev.userName);
    if (ev.changeType === 'paste-large') m.largePasteCount += 1;
    m.pastedChars += String(ev.contentSnippet || '').length;
  }
  if (textLength > 0) {
    for (const k of Object.keys(byId)) {
      byId[k].pastePct = Math.min(100, Math.round((byId[k].pastedChars / textLength) * 100));
    }
  }

  // AI spans per author → share (0–100) of the attributed AI spans.
  const attributedAi = flags.filter((f) => f.highlight === 'red' && (f.authorId || f.authorName));
  if (attributedAi.length) {
    const counts = {};
    for (const f of attributedAi) {
      const key = idOf(f.authorId, f.authorName);
      counts[key] = (counts[key] || 0) + 1;
      ensure(f.authorId, f.authorName); // make sure the entry exists
    }
    for (const [key, n] of Object.entries(counts)) {
      byId[key].aiShare = Math.round((n / attributedAi.length) * 100);
    }
  }

  // Expose the merged entries under BOTH a uid key and a name key, so the frontend can
  // match a member however it identifies them.
  const out = {};
  for (const entry of Object.values(byId)) {
    if (entry.userId) out[entry.userId] = entry;
    const nameKey = `name:${String(entry.name || '').trim().toLowerCase()}`;
    if (nameKey !== 'name:') out[nameKey] = entry;
  }
  return out;
}
