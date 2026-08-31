'use strict';

const express = require('express');
const crypto = require('crypto');
const store = require('../store');
const { asyncRoute, bad, pageQuery, requireText } = require('./helpers');

const router = express.Router();
const CONTENT_MAX = 20000;

function clean(body, existing = {}) {
  return {
    name: requireText(body.name ?? existing.name, 'Setting name', 120),
    content: requireText(body.content ?? existing.content, 'Setting content', CONTENT_MAX),
    remark: String(body.remark ?? existing.remark ?? '').trim().slice(0, 500),
  };
}

router.get('/', (req, res) => {
  res.json(store.settings.page(req.user, pageQuery(req, ['name', 'settingId', 'content'])));
});

router.get('/:settingId', (req, res) => {
  const setting = store.settings.find(req.user, req.params.settingId);
  if (!setting) throw bad('Setting template not found', 404);
  res.json({ setting });
});

router.post('/', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const settingId = String(body.settingId || '').trim() || crypto.randomUUID();
  const setting = store.settings.insert(req.user, { settingId, ...clean(body) });
  res.json({ setting });
}));

router.put('/:settingId', asyncRoute(async (req, res) => {
  const existing = store.settings.find(req.user, req.params.settingId);
  if (!existing) throw bad('Setting template not found', 404);
  res.json({ setting: store.settings.update(req.user, req.params.settingId, clean(req.body || {}, existing)) });
}));

router.delete('/:settingId', (req, res) => {
  store.settings.remove(req.user, req.params.settingId);
  res.json({ ok: true });
});

module.exports = router;
