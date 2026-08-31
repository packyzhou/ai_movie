'use strict';

const express = require('express');
const config = require('../config');
const auth = require('../auth');
const templates = require('./templates');
const projects = require('./projects');
const generate = require('./generate');
const assets = require('./assets');
const styles = require('./styles');
const ai = require('./ai');
const settings = require('./settings');

const router = express.Router();

// --- public -----------------------------------------------------------------

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const token = auth.login(String(username || ''), String(password || ''));
  if (!token) return res.status(401).json({ error: 'Wrong username or password' });
  // Seeding the sample template is a convenience, never a reason to fail a
  // valid login - a broken/absent built-in workflow must not lock the user out.
  try {
    templates.seedDefault(username);
  } catch (err) {
    console.error('[login] seedDefault skipped:', err.message);
  }
  res.cookie(auth.COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: config.sessionTtlMs });
  res.json({ username, token });
});

router.post('/logout', (req, res) => {
  const token = auth.tokenOf(req);
  if (token) auth.logout(token);
  res.clearCookie(auth.COOKIE);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const user = auth.currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ username: user });
});

// --- authenticated ----------------------------------------------------------

router.use(auth.requireAuth);
router.use('/templates', templates.router);
router.use('/projects', projects.router);
router.use('/assets', assets);
router.use('/styles', styles);
router.use('/ai', ai);
router.use('/settings', settings);
router.use('/', generate);

module.exports = router;
