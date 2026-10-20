// Backend settings, read from the environment once and checked with Zod. Everything comes from
// env variables (the root .env in development, Kubernetes Secrets and ConfigMaps in a cluster);
// .env.example lists every name. Modules written before this one still read process.env
// directly; new code should take its settings from here.
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Load the repo-root .env, whatever directory the server is started from. A missing file is fine. */
export function loadDotenv() {
  dotenv.config({ path: path.resolve(here, '..', '..', '.env'), quiet: true });
}

const emptyAsUndefined = (v) => (v === '' ? undefined : v);
const optionalString = z.preprocess(emptyAsUndefined, z.string().optional());

const schema = z.object({
  NODE_ENV: z.preprocess(emptyAsUndefined, z.enum(['development', 'test', 'production']).default('development')),
  PORT: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(65535).default(5000)),
  // Unset keeps today's behaviour (reflect any origin). Step 1.4 (Tshewang) makes it required.
  CORS_ORIGIN: optionalString,
  DATABASE_URL: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must start with postgres:// or postgresql://')
      .optional()
  ),
  DATABASE_POOL_MAX: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(100).default(10)),
  // OpenAI (step 2.4). Used only when both the key and the model are set; otherwise analysis
  // uses the legacy providers (Hugging Face + Virtual Writing Tutor).
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  OPENAI_BASE_URL: z.preprocess(emptyAsUndefined, z.string().url().default('https://api.openai.com/v1')),
  OPENAI_TIMEOUT_MS: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1000).max(300_000).default(30_000)),
  OPENAI_MAX_INPUT_CHARS: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1000).max(1_000_000).default(60_000)),
  // USD per million tokens for OPENAI_MODEL, from OpenAI's price list. Used for the usage
  // table's cost estimate and the college budget check; 0 means "unknown, count as free".
  OPENAI_PRICE_INPUT_PER_1M: z.preprocess(emptyAsUndefined, z.coerce.number().min(0).default(0)),
  OPENAI_PRICE_OUTPUT_PER_1M: z.preprocess(emptyAsUndefined, z.coerce.number().min(0).default(0)),
});

/**
 * Parse settings from `env`. Throws one error listing every bad variable (names and
 * messages only, never the values, so a secret never reaches a log).
 */
export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid backend configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return Object.freeze({
    env: e.NODE_ENV,
    port: e.PORT,
    corsOrigin: e.CORS_ORIGIN ?? true,
    databaseUrl: e.DATABASE_URL ?? null,
    databasePoolMax: e.DATABASE_POOL_MAX,
    openai: Object.freeze({
      apiKey: e.OPENAI_API_KEY ?? null,
      model: e.OPENAI_MODEL ?? null,
      baseUrl: e.OPENAI_BASE_URL.replace(/\/+$/, ''),
      timeoutMs: e.OPENAI_TIMEOUT_MS,
      maxInputChars: e.OPENAI_MAX_INPUT_CHARS,
      priceInputPer1M: e.OPENAI_PRICE_INPUT_PER_1M,
      priceOutputPer1M: e.OPENAI_PRICE_OUTPUT_PER_1M,
    }),
  });
}

/** Provider keys that are missing or still the placeholder text, as [envName, label] pairs. */
export function missingProviderKeys(env = process.env) {
  const placeholder = (v) => !v || /your_.*_key_here|YOUR_.*_KEY/i.test(v);
  return [
    ['HF_API_KEY', 'Hugging Face AI detection'],
    ['VWT_API_KEY', 'Virtual Writing Tutor grammar/writing'],
  ].filter(([k]) => placeholder(env[k]));
}
