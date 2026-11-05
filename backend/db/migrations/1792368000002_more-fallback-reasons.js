// Step 2.4: two more reasons for using the legacy provider instead of OpenAI.
//   openai_invalid_output  OpenAI answered, but the reply failed analysis-result.json
//   openai_not_configured  OPENAI_API_KEY or OPENAI_MODEL is not set
// analysis_results is append-only, but ALTER TABLE is not an UPDATE, so the trigger allows it.

const OLD = `'openai_error', 'openai_timeout', 'budget_reached', 'flag_legacy'`;
const NEW = `${OLD}, 'openai_invalid_output', 'openai_not_configured'`;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE analysis_results DROP CONSTRAINT analysis_results_fallback_reason_check;
    ALTER TABLE analysis_results ADD CONSTRAINT analysis_results_fallback_reason_check
      CHECK (fallback_reason IN (${NEW}));
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE analysis_results DROP CONSTRAINT analysis_results_fallback_reason_check;
    ALTER TABLE analysis_results ADD CONSTRAINT analysis_results_fallback_reason_check
      CHECK (fallback_reason IN (${OLD}));
  `);
};
