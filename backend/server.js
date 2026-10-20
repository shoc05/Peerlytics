// Load env from the project ROOT .env regardless of the cwd the server is launched from.
// (The .env lives one level up from /backend; loading the bare 'dotenv/config' only finds it
// when started from root, which silently dropped HF_API_KEY/VWT_API_KEY when run from /backend
// and made AI/writing analysis intermittently show "unavailable".)
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
const __dirnameSrv = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirnameSrv, '..', '.env') });
import { createApp } from './src/app.js';
import { startDeadlineReminders } from './services/reminderService.js';
import { startServerDeadlines } from './src/jobs/deadlines/index.js';

const PORT = process.env.PORT || 5000;

// ── Startup config validation: warn clearly if analysis API keys are missing or
// look like unreplaced placeholders, so failures aren't silent. The server still starts —
// analysis falls back gracefully ("AI checker not available") on any provider error.
function validateConfig() {
  const placeholder = (v) => !v || /your_.*_key_here|YOUR_.*_KEY/i.test(v);
  const checks = [
    ['HF_API_KEY', 'Hugging Face AI detection'],
    ['VWT_API_KEY', 'Virtual Writing Tutor grammar/writing'],
  ];
  const missing = checks.filter(([k]) => placeholder(process.env[k]));
  if (missing.length) {
    console.warn('⚠ Analysis API keys not configured:');
    for (const [k, label] of missing) {
      console.warn(`  • ${k} (${label}) is missing or a placeholder — that provider will show "unavailable".`);
    }
    console.warn('  Submissions still work; affected scores are hidden with a notice.');
  } else {
    console.log('✓ Analysis API keys present (Hugging Face + VWT).');
  }
}
validateConfig();

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`Peerlytics API listening on http://localhost:${PORT}`);
  // Optional: scheduled deadline-reminder emails for offline members. Stays dormant
  // (with a one-line log) unless FIREBASE_SERVICE_ACCOUNT + SMTP creds are configured.
  startDeadlineReminders();
  // Every minute: submit and lock workspaces past their deadline (dormant without the Admin SDK key).
  startServerDeadlines();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Another Peerlytics API is probably running.\n` +
        `  • Use http://localhost:${PORT}/api/health to verify\n` +
        `  • Or stop the other process, then run npm run dev:server again\n` +
        `  • Windows: netstat -ano | findstr :${PORT}  then  taskkill /PID <pid> /F`
    );
    process.exit(1);
  }
  throw err;
});
