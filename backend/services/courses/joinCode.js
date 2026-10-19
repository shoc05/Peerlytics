// Course join codes: 8 characters from an alphabet with no look-alikes (no 0/O, 1/I/L), so a
// code read aloud or copied from a slide is typed correctly. Drawn with crypto.randomInt,
// never Math.random. 31^8 ≈ 8.5 × 10^11 codes; guessing is also rate limited per user.
import { randomInt } from 'node:crypto';

export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 8;
export const JOIN_CODE_PATTERN = /^[A-HJKMNP-Z2-9]{8}$/;

export function generateJoinCode(random = randomInt) {
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) code += JOIN_CODE_ALPHABET[random(JOIN_CODE_ALPHABET.length)];
  return code;
}

/** What a student typed -> the stored form: upper case, spaces and dashes removed. null if it can't be a code. */
export function normaliseJoinCode(input) {
  const code = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  return JOIN_CODE_PATTERN.test(code) ? code : null;
}
