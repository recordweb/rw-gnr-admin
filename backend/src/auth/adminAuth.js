import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Password hashes for the admin login. Format: scrypt:<N>:<r>:<p>:<salt>:<hash> (base64url).
// The separator is ':' on purpose: '$' inside a .env value would be treated as a variable by Docker Compose.

const COST = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), hash.toString('base64url')].join(':');
}

export function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split(':') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  try {
    const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}