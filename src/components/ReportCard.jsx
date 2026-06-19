import React, { useState } from 'react';
import { injectHighlightsIntoHtml, injectHighlightsIntoText } from '../utils/highlightHelpers';

const scoreText = (score, invert = false) => {
  const v = invert ? 100 - score : score;
  if (v >= 70) return 'text-brand-500';
  if (v >= 45) return 'text-amber-400';
  return 'text-rose-500';
};

export default function ReportCard({ report, documentHtml = '', documentText = '', suggestedGradeOverride = null, darkMode = true, compact = false }) {
  const [showDocViewer, setShowDocViewer] = useState(false);
  if (!report) return null;

  const { scores, feedback, recommendation, flaggedContent, audit } = report;
  // Prefer the behaviour-grader result (same source as the Grading tab) so the two
  // views always agree; fall back to the report's own suggestedGrade if not provided.
  const suggestedGrade = suggestedGradeOverride != null ? suggestedGradeOverride : report.suggestedGrade;
  // AI detection (GPTZero) may be unavailable (e.g. no API plan). Show a notice
  // instead of a misleading 0% score. Writing analysis (VWT) is independent.
  const aiDetectionDown = report.aiDetectionAvailable === false;
  const writingDown = report.writingAnalysisAvailable === false;
  // Document source: prefer the submission's html, fall back to its plain text, then to
  // the report's stored copy. Used so the highlighted Document View is never blank when
  // content exists somewhere on the submission/report.
  const docHtml = documentHtml || report.documentContent?.html || '';
  const docText = documentText || report.documentContent?.text || '';
  const hasDoc = Boolean(docHtml || docText);
  const aiUnavailable = report.aiEvaluation === 'unavailable';

  const surface = darkMode ? 'bg-ink-800/85 border-ink-700 text-ink-100' : 'bg-white border-slate-200 text-slate-900';
  const sub = darkMode ? 'text-ink-400' : 'text-slate-500';
  const tile = darkMode ? 'bg-ink-900/50 border-ink-700' : 'bg-slate-50 border-slate-200';

  // Recommendation tracks the (consolidated) suggested grade so it never contradicts it.
  const effectiveRec =
    suggestedGrade == null ? recommendation
    : suggestedGrade >= 7 ? 'Accept'
    : suggestedGrade >= 4 ? 'Review'
    : 'Needs work';
  const recCls =
    effectiveRec === 'Accept' ? 'text-brand-500' :
    effectiveRec === 'Review' ? 'text-amber-400' : 'text-rose-500';

  return (
    <div className={`rounded-xl border ${surface} ${compact ? 'p-4' : 'p-6'} transition hover:shadow-soft`}>
      <h3 className={`m-0 mb-4 font-semibold ${compact ? 'text-base' : 'text-lg'}`}>
        Submission Analysis Report
      </h3>

      {aiUnavailable ? (
        <div className="mb-5 p-4 rounded-lg border border-amber-400/40 bg-amber-400/10 flex items-start gap-3">
          <span className="text-amber-400 text-lg leading-none mt-0.5">⚠</span>
          <div>
            <div className="font-semibold text-amber-400 text-sm mb-1">AI evaluation unavailable</div>
            <p className={`text-xs m-0 ${sub}`}>
              {report.aiUnavailableMessage || feedback?.summary ||
                'Submission received successfully. Automated writing analysis could not be generated at this time.'}
            </p>
          </div>
        </div>
      ) : (
        <>
        {/* Headline: AI detection result, or an "unavailable" notice when GPTZero is down */}
        {aiDetectionDown ? (
          <div className="mb-4 p-4 rounded-lg border border-amber-400/40 bg-amber-400/10 flex items-center gap-3">
            <span className="text-amber-400 text-lg leading-none">⚠</span>
            <div className="font-semibold text-amber-400 text-sm">AI checker is not available right now</div>
          </div>
        ) : (
          <div className={`mb-4 p-4 rounded-lg border flex items-center justify-between ${
            (scores.aiUsageScore ?? 0) >= 70 ? 'border-rose-500/40 bg-rose-500/10'
              : (scores.aiUsageScore ?? 0) >= 40 ? 'border-amber-400/40 bg-amber-400/10'
              : 'border-brand-500/40 bg-brand-500/10'
          }`}>
            <div>
              <div className={`text-[11px] uppercase tracking-wide ${sub}`}>AI content detected</div>
              <div className={`text-[13px] ${sub}`}>Estimated share of the document likely AI-generated</div>
            </div>
            <div className={`text-[34px] font-extrabold leading-none ${scoreText(scores.aiUsageScore ?? 0, true)}`}>
              {Math.round(scores.aiUsageScore ?? 0)}<span className="text-base font-semibold">% AI</span>
            </div>
          </div>
        )}
        <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(140px,1fr))] mb-5">
          {[
            // AI Usage tile only when detection is available. (Plagiarism % removed —
            // there is no plagiarism provider; copy-paste is shown via flags instead.)
            ...(aiDetectionDown ? [] : [{ label: 'AI Usage', value: scores.aiUsageScore, suffix: '% AI', invert: true }]),
            // Writing Quality only when VWT analysis succeeded (avoids a fake 100/100).
            ...(writingDown ? [] : [{ label: 'Writing Quality', value: scores.writingQualityScore, suffix: '/100' }]),
          ].map((item) => (
            <div key={item.label} className={`p-3 rounded-lg border ${tile} transition hover:-translate-y-0.5 hover:shadow-soft`}>
              <div className={`text-[11px] mb-1.5 ${sub}`}>{item.label}</div>
              <div className={`text-[22px] font-bold ${scoreText(item.value, item.invert)}`}>
                {item.value}<span className="text-xs font-medium">{item.suffix}</span>
              </div>
            </div>
          ))}
        </div>
        {writingDown && (
          <div className={`mb-5 text-xs ${sub}`}>
            Writing analysis is currently unavailable, so no writing-quality score is shown.
          </div>
        )}
        </>
      )}

      <div className={`mb-4 p-2.5 rounded-md text-[11px] leading-relaxed border ${darkMode ? 'border-ink-700 bg-white/5 text-ink-400' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
        <strong>Note:</strong> AI-detection and copy-paste flags are automated <em>signals</em>, not proof of misconduct.
        Detection can miss hand-retyped content and can mis-flag legitimate writing. Use these as a starting point for
        review — the lecturer's judgement and grade override are final.
      </div>

      {audit && (
        <div className={`mb-4 text-xs ${sub}`}>
          <strong>Contribution audit:</strong> {audit.versionCount} versions, {audit.pasteEventCount} paste events
          ({audit.largePasteCount} large). Difficulty: {audit.difficulty}/3.
          {feedback?.pasteReview && <div className="mt-1.5 text-rose-500">{feedback.pasteReview}</div>}
        </div>
      )}

      {flaggedContent?.length > 0 && (
        <div className="mb-4">
          <strong className="text-[13px]">Flagged Content</strong>
          {flaggedContent.map((f, i) => {
            const isAI = f.type === 'ai-generated' || f.highlight === 'red';
            // Yellow = copy-pasted / similar content, Red = AI-generated.
            const label = isAI ? 'AI-generated' : 'Copy-pasted';
            const author = f.authorName || f.author;
            const initials = f.authorInitials || (author ? author.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() : '');
            return (
              <div
                key={f.id || i}
                className={`mt-2 p-2.5 rounded-md text-xs border-l-[3px] ${isAI ? 'bg-rose-500/15 border-rose-500' : 'bg-amber-400/15 border-amber-400'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`inline-flex items-center justify-center text-[9px] font-bold text-white rounded px-1.5 py-0.5 ${isAI ? 'bg-rose-500' : 'bg-amber-500'}`}>
                    {initials || '?'}
                  </span>
                  <span className={`font-semibold ${isAI ? 'text-rose-500' : 'text-amber-500'}`}>
                    {label} · {author || 'Unattributed'}
                  </span>
                </div>
                {f.reason && <div className={`mb-1 ${darkMode ? 'text-ink-400' : 'text-slate-500'}`}>{f.reason}</div>}
                <div className={darkMode ? 'text-ink-100/80' : 'text-slate-700'}>{f.text}</div>
              </div>
            );
          })}
        </div>
      )}

      {hasDoc && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <strong className="text-[13px]">Document View</strong>
            <button
              type="button"
              onClick={() => setShowDocViewer(v => !v)}
              className={`bg-transparent border rounded-md px-2.5 py-1 text-[11px] transition active:scale-95 ${
                darkMode ? 'border-sky-400 text-sky-400 hover:bg-sky-400/10' : 'border-sky-600 text-sky-600 hover:bg-sky-50'
              }`}
            >
              {showDocViewer ? 'Hide Document' : 'Show Highlighted Document'}
            </button>
          </div>
          {showDocViewer && (
            <div className="mb-2">
              <div className="flex gap-4 mb-2 text-[11px]">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 bg-[#fff3b0] border border-[#daa520] rounded-sm" />
                  Copy-pasted content
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 bg-[#ffd6d6] border border-[#dc143c] rounded-sm" />
                  AI-generated content
                </span>
              </div>
              <div
                className="px-5 py-4 rounded-lg bg-white text-slate-900 text-[13px] leading-[1.8] max-h-[360px] overflow-y-auto border border-slate-200 whitespace-pre-wrap break-words"
                style={{ fontFamily: '"Times New Roman", Times, serif' }}
                dangerouslySetInnerHTML={{
                  __html: docHtml
                    ? injectHighlightsIntoHtml(docHtml, flaggedContent || [])
                    : injectHighlightsIntoText(docText, flaggedContent || []),
                }}
              />
              {(!flaggedContent || flaggedContent.length === 0) && (
                <div className={`text-[11px] mt-1 ${sub}`}>No flagged spans — document shown without highlights.</div>
              )}
            </div>
          )}
        </div>
      )}

      {!aiUnavailable && (
        <div className="mb-4">
          <strong className="text-[13px]">Feedback</strong>
          <p className={`text-xs my-2 ${sub}`}>{feedback.summary}</p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="font-semibold text-brand-500 mb-1">Strengths</div>
              <ul className="m-0 pl-4">
                {(feedback.strengths || []).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
            <div>
              <div className="font-semibold text-amber-400 mb-1">Weaknesses</div>
              <ul className="m-0 pl-4">
                {(feedback.weaknesses || []).map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className={`flex flex-wrap gap-4 items-center justify-between pt-3 border-t ${darkMode ? 'border-ink-700' : 'border-slate-200'}`}>
        <div>
          <span className={`text-xs ${sub}`}>Recommendation: </span>
          <span className={`font-bold ${recCls}`}>{effectiveRec}</span>
        </div>
        <div>
          <span className={`text-xs ${sub}`}>Suggested Grade: </span>
          {aiUnavailable || suggestedGrade == null ? (
            <span className={`font-bold ${sub}`}>Manual review</span>
          ) : (
            <span className="font-bold text-lg text-brand-500">{suggestedGrade}/10</span>
          )}
        </div>
      </div>
    </div>
  );
}
