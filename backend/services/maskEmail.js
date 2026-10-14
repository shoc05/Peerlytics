// Keep student email addresses out of server logs.
// maskEmail('sonam.dorji@rub.edu.bt') -> 's**********@rub.edu.bt'
// maskEmailsIn(text) masks every address inside a log line or an SMTP error message.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function maskEmail(email) {
  const value = String(email ?? '');
  const at = value.lastIndexOf('@');
  if (at <= 0) return value ? '***' : '';
  const local = value.slice(0, at);
  return `${local[0]}${'*'.repeat(Math.max(local.length - 1, 1))}${value.slice(at)}`;
}

export function maskEmailsIn(text) {
  return String(text ?? '').replace(EMAIL_RE, (match) => maskEmail(match));
}
