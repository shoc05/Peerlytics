// One-shot email test: sends a sample deadline-reminder to confirm SMTP works.
// Usage:  npm run test:mail            -> sends to SMTP_USER (yourself)
//         npm run test:mail you@x.com  -> sends to a specific address
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const { sendTestEmail } = await import('../services/reminderService.js');

const to = process.argv[2];
try {
  const sent = await sendTestEmail(to);
  console.log(`✓ Test reminder email sent to ${sent}. Check that inbox (and spam).`);
  process.exit(0);
} catch (err) {
  console.error('✗ Could not send test email:', err.message);
  console.error('  Check SMTP_USER / SMTP_PASS (Gmail app password, no spaces) in your root .env.');
  process.exit(1);
}
