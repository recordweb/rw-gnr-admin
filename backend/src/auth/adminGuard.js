import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { verifyPassword } from './adminAuth.js';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 10; // per IP
const failures = new Map(); // ip -> timestamps

const digest = (s) => createHash('sha256').update(String(s)).digest();
const sameString = (a, b) => timingSafeEqual(digest(a), digest(b));

function parseBasic(header) {
  const m = /^Basic (.+)$/.exec(header ?? '');
  if (!m) return null;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  return i < 0 ? null : { user: decoded.slice(0, i), password: decoded.slice(i + 1) };
}

// nginx sets X-Real-IP; the container has no published port.
const clientIp = (req) => req.get('x-real-ip') || req.socket.remoteAddress || 'unknown';

function recent(ip, now) {
  const list = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(ip, list); else failures.delete(ip);
  return list;
}

setInterval(() => {
  const now = Date.now();
  for (const ip of [...failures.keys()]) recent(ip, now);
}, WINDOW_MS).unref();

export function requireAdmin(req, res, next) {
  const now = Date.now();
  const ip = clientIp(req);

  if (recent(ip, now).length >= MAX_FAILURES) {
    res.set('Retry-After', '600');
    return res.status(429).json({ errorCode: 'TOO_MANY_ATTEMPTS', message: 'Too many failed logins. Try again later.' });
  }

  const challenge = () => {
    res.set('WWW-Authenticate', 'Basic realm="RW-GNR admin", charset="UTF-8"');
    res.set('Cache-Control', 'no-store');
    return res.status(401).json({ errorCode: 'UNAUTHORIZED', message: 'Login required.' });
  };

  const cred = parseBasic(req.headers.authorization);
  if (!cred) return challenge(); // no credentials yet: not counted as failure

  const userOk = sameString(cred.user, config.adminUser);
  const passOk = verifyPassword(cred.password, config.adminPasswordHash);
  if (!(userOk && passOk)) {
    failures.set(ip, [...recent(ip, now), now]);
    logger.warn('Admin login failed', { ip });
    return challenge();
  }

  if (!['GET', 'HEAD'].includes(req.method) && req.get('x-requested-with') !== 'fetch') {
    return res.status(403).json({ errorCode: 'FORBIDDEN', message: 'Missing X-Requested-With header.' });
  }
  res.set('Cache-Control', 'no-store');
  next();
}