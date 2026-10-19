// JSON Schema checks with Ajv (CLAUDE.md: external API results and tracking events are
// validated with JSON Schema). The schema files in backend/schemas/ are the single source:
// OpenAI's structured-output schema is derived from analysis-result.json, not written twice.
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const load = (name) => JSON.parse(readFileSync(new URL(`../../schemas/${name}`, import.meta.url), 'utf8'));

export const analysisResultSchema = load('analysis-result.json');
export const trackingEventSchema = load('tracking-event.json');

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const analysisValidator = ajv.compile(analysisResultSchema);
const trackingValidator = ajv.compile(trackingEventSchema);

const describe = (errors) => (errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`);

/** { valid: true } or { valid: false, errors: string[] } — errors name paths, never values. */
export function validateAnalysisResult(value) {
  return analysisValidator(value) ? { valid: true } : { valid: false, errors: describe(analysisValidator.errors) };
}

export function validateTrackingEvent(value) {
  return trackingValidator(value) ? { valid: true } : { valid: false, errors: describe(trackingValidator.errors) };
}

// Keywords OpenAI strict structured output does not accept. Ranges and lengths are still
// enforced: the reply is validated with Ajv against the full schema afterwards.
const UNSUPPORTED = new Set(['$schema', '$id', 'title', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'format']);

function strip(node) {
  if (Array.isArray(node)) return node.map(strip);
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).filter(([k]) => !UNSUPPORTED.has(k)).map(([k, v]) => [k, strip(v)]));
}

/** The schema sent as response_format.json_schema.schema. */
export const openaiResponseSchema = strip(analysisResultSchema);
