// Entry point: load settings, connect to PostgreSQL, start the app and the background jobs.
// The routes themselves are in app.js.
import { loadDotenv, loadConfig, missingProviderKeys } from './config/index.js';
// Before anything reads process.env, so it works from any working directory.
loadDotenv();

const { createApp } = await import('./app.js');
const { createDb } = await import('./db/pool.js');
const { startDeadlineReminders } = await import('./services/reminderService.js');
const { startServerDeadlines } = await import('./src/jobs/deadlines/index.js');

const config = loadConfig();

// ── Startup config validation: warn clearly if analysis API keys are missing or
// look like unreplaced placeholders, so failures aren't silent. The server still starts —
// analysis falls back gracefully ("AI checker not available") on any provider error.
const missing = missingProviderKeys();
if (missing.length) {
  console.warn('⚠ Analysis API keys not configured:');
  for (const [k, label] of missing) {
    console.warn(`  • ${k} (${label}) is missing or a placeholder — that provider will show "unavailable".`);
  }
  console.warn('  Submissions still work; affected scores are hidden with a notice.');
} else {
  console.log('✓ Analysis API keys present (Hugging Face + VWT).');
}
if (!config.databaseUrl) {
  console.warn('⚠ DATABASE_URL is not set: PostgreSQL features are off and /api/health leaves out "db".');
}

const db = createDb({ databaseUrl: config.databaseUrl, max: config.databasePoolMax });
const app = createApp({ config, db });
const PORT = config.port;

const server = app.listen(PORT, () => {
  console.log(`Peerlytics API listening on http://localhost:${PORT}`);
  if (!config.runJobs) {
    console.log('RUN_JOBS=false: reminder emails and the deadline lock are off in this process.');
    return;
  }
  // Optional: scheduled deadline-reminder emails for offline members. Stays dormant
  // (with a one-line log) unless FIREBASE_SERVICE_ACCOUNT + SMTP creds are configured.
  startDeadlineReminders();
  // Every minute: submit and lock workspaces past their deadline (dormant without the Admin SDK key).
  startServerDeadlines({ pool: db.pool });
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

// docker stop / Kubernetes send SIGTERM: finish open requests, close the pool, then exit.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(() => db.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
