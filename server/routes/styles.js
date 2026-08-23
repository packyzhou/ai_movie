'use strict';

const express = require('express');
const crypto = require('crypto');
const store = require('../store');
const { bad, requireText } = require('./helpers');

const router = express.Router();

function uniqueName(username, name, ignoredId = '') {
  const duplicate = store.styles.list(username).find(
    (style) => style.styleId !== ignoredId && style.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) throw bad(`风格「${name}」已存在`);
}

router.get('/', (req, res) => {
  const styles = store.styles.list(req.user).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  res.json({ styles });
});

router.post('/', (req, res) => {
  const name = requireText((req.body || {}).name, 'Style name', 60);
  uniqueName(req.user, name);
  const styleId = String((req.body || {}).styleId || '').trim() || crypto.randomUUID();
  res.json({ style: store.styles.insert(req.user, { styleId, name }) });
});

router.put('/:styleId', (req, res) => {
  if (!store.styles.find(req.user, req.params.styleId)) throw bad('Style not found', 404);
  const name = requireText((req.body || {}).name, 'Style name', 60);
  uniqueName(req.user, name, req.params.styleId);
  res.json({ style: store.styles.update(req.user, req.params.styleId, { name }) });
});

router.delete('/:styleId', (req, res) => {
  const styleId = req.params.styleId;
  if (!store.styles.find(req.user, styleId)) throw bad('Style not found', 404);
  store.assets.list(req.user).forEach((asset) => {
    if ((asset.styleIds || []).includes(styleId)) {
      store.assets.update(req.user, asset.assetId, { styleIds: asset.styleIds.filter((id) => id !== styleId) });
    }
  });
  store.projects.list(req.user).forEach((project) => {
    if ((project.styleIds || []).includes(styleId)) {
      store.projects.update(req.user, project.projectId, { styleIds: project.styleIds.filter((id) => id !== styleId) });
    }
  });
  store.styles.remove(req.user, styleId);
  res.json({ ok: true });
});

module.exports = router;
