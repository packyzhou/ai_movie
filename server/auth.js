'use strict';

const crypto = require('crypto');
const config = require('./config');

const sessions = new Map(); // token -> { username, expiresAt }
const COOKIE = 'ai_movie_session';

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verify(username, password) {
  const user = config.account.users.find((u) => u.username === username);
  if (!user) return false;
  // A stored hash wins over a plaintext password so deployments can avoid
  // keeping the cleartext around at all.
  const expected = user.passwordSha256 && /^[0-9a-f]{64}$/i.test(user.passwordSha256)
    ? user.passwordSha256.toLowerCase()
    : user.password != null
      ? sha256(String(user.password))
      : null;
  if (!expected) return false;
  return safeEqual(sha256(String(password)), expected);
}

function login(username, password) {
  if (!verify(username, password)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, expiresAt: Date.now() + config.sessionTtlMs });
  return token;
}

function logout(token) {
  sessions.delete(token);
}

function tokenOf(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return (req.cookies && req.cookies[COOKIE]) || null;
}

function currentUser(req) {
  const token = tokenOf(req);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session.username;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

module.exports = { COOKIE, login, logout, tokenOf, currentUser, requireAuth };
