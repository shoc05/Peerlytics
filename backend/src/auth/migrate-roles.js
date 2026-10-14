// Usage: node backend/src/auth/migrate-roles.js [--dry-run]
// Needs FIREBASE_SERVICE_ACCOUNT in the repo-root .env. Run once, after the backend is deployed.
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getAdmin } from './firebaseAdmin.js';
import { migrateRoles } from './migrate.js';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env') });

const dryRun = process.argv.includes('--dry-run');
const clients = getAdmin();
if (!clients) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set or not valid.');
  process.exit(1);
}
const result = await migrateRoles({ ...clients, dryRun, log: (line) => console.log(line) });
console.log(
  `${dryRun ? 'Would migrate' : 'Migrated'} ${result.migrated.length}, already had a claim ${result.skipped.length}, no valid role ${result.invalid.length}.`
);
process.exit(0);
