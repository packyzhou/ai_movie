'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const comfy = require('../comfy');
const jobs = require('../jobs');
const store = require('../store');
const tpl = require('../templates');
const workflow = require('../workflow');
const { asyncRoute, bad, pageQuery, requireText } = require('./helpers');

const router = express.Router();
const ASSET_TYPES = new Set(['image', 'video', 'text']);
const MODES = new Set(['manual', 'ai']);
const TASK_STATUSES = new Set(['pending', 'queued', 'running', 'completed', 'failed', 'cancelled']);
const ALLOWED_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp',
  '.mp4', '.webm', '.mov', '.avi', '.mkv', '.txt', '.md',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 256 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error(`Unsupported asset type "${ext}"`));
    cb(null, true);
  },
});

function userDir(username) {
  return path.join(config.assetsDir, username);
}

function assetType(value, fallback = 'image') {
  const type = String(value || fallback);
  if (!ASSET_TYPES.has(type)) throw bad('Asset type must be image, video or text');
  return type;
}

function resourceKind(filename, mimetype = '') {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  const ext = path.extname(filename).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return 'image';
  if (['.mp4', '.webm', '.mov', '.avi', '.mkv'].includes(ext)) return 'video';
  return 'text';
}

function cleanStyleIds(username, value) {
  const ids = Array.isArray(value)
    ? value.map(String)
    : String(value || '').split(',').map((id) => id.trim()).filter(Boolean);
  const unique = [...new Set(ids)];
  const known = new Set(store.styles.list(username).map((style) => style.styleId));
  if (unique.some((id) => !known.has(id))) throw bad('Unknown asset style');
  return unique;
}

function cleanDimension(value, spec, label) {
  const number = Number(value ?? spec.default);
  if (!Number.isFinite(number) || number < spec.min || number > spec.max) {
    throw bad(`${label} must be between ${spec.min} and ${spec.max}`);
  }
  return Math.round(number / (spec.step || 1)) * (spec.step || 1);
}

function cleanResources(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const resourcePath = requireText(item && item.path, 'Resource path', 2000);
    return {
      path: resourcePath,
      name: String((item && item.name) || path.basename(resourcePath)).slice(0, 255),
      kind: assetType(item && item.kind, 'text'),
      status: TASK_STATUSES.has(String(item && item.status)) ? String(item.status) : 'completed',
    };
  });
}

function cleanPromptItems(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 100) throw bad('Prompt list must contain at most 100 items');
  return value.map((item) => ({
    itemId: String((item && item.itemId) || '').trim() || crypto.randomUUID(),
    prompt: requireText(item && item.prompt, 'Prompt', 10000),
    status: TASK_STATUSES.has(String(item && item.status)) ? String(item.status) : 'pending',
    message: String((item && item.message) || '').slice(0, 500),
    error: String((item && item.error) || '').slice(0, 1000),
    resources: cleanResources(item && item.resources),
  }));
}

function payload(body, existing = {}) {
  const mode = String(body.mode || existing.mode || 'manual');
  if (!MODES.has(mode)) throw bad('Asset mode must be manual or ai');
  const type = assetType(body.type, existing.type || 'image');
  const templateId = String(body.templateId ?? existing.templateId ?? '').trim();
  if (mode === 'ai' && !templateId) throw bad('AI template is required');
  if (mode === 'ai') {
    const template = store.templates.find(body.username, templateId);
    if (!template || (template.type || 'video') !== type) throw bad('AI template type does not match asset type');
  }
  const hasSize = mode === 'ai' && (type === 'image' || type === 'video');
  const width = hasSize
    ? cleanDimension(body.width ?? existing.width, workflow.limits.width, 'Width')
    : null;
  const length = hasSize
    ? cleanDimension(body.length ?? existing.length, workflow.limits.height, 'Length')
    : null;
  const promptItems = mode === 'ai' ? cleanPromptItems(body.promptItems ?? existing.promptItems) : [];
  const resources = promptItems.length
    ? promptItems.flatMap((item) => item.resources)
    : cleanResources(body.resources ?? existing.resources);
  return {
    name: requireText(body.name ?? existing.name, 'Asset name', 120),
    mode,
    type,
    prompt: promptItems.length
      ? promptItems.map((item) => item.prompt).join('\n')
      : String(body.prompt ?? existing.prompt ?? '').trim(),
    promptItems,
    templateId: mode === 'ai' ? templateId : '',
    width,
    length,
    remark: String(body.remark ?? existing.remark ?? '').trim().slice(0, 500),
    styleIds: cleanStyleIds(body.username, body.styleIds ?? existing.styleIds),
    resources,
  };
}

router.get('/', (req, res) => {
  const styleIds = String(req.query.styles || '').split(',').map((id) => id.trim()).filter(Boolean);
  const type = String(req.query.type || '').trim();
  let assets = store.assets.list(req.user);
  if (styleIds.length) assets = assets.filter((asset) => styleIds.some((id) => (asset.styleIds || []).includes(id)));
  if (ASSET_TYPES.has(type)) assets = assets.filter((asset) => (asset.type || 'image') === type);
  res.json(store.paginate(assets, pageQuery(req, ['name', 'assetId', 'remark', 'prompt'])));
});

router.post(
  '/uploads',
  upload.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw bad('No file uploaded');
    const ext = path.extname(req.file.originalname).toLowerCase();
    const filename = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    fs.mkdirSync(userDir(req.user), { recursive: true });
    fs.writeFileSync(path.join(userDir(req.user), filename), req.file.buffer);
    res.json({
      path: `/api/assets/files/${encodeURIComponent(filename)}`,
      name: req.file.originalname,
      kind: resourceKind(filename, req.file.mimetype),
    });
  })
);

router.post(
  '/text',
  asyncRoute(async (req, res) => {
    const content = requireText((req.body || {}).content, 'Text content', 2 * 1024 * 1024);
    const filename = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.md`;
    fs.mkdirSync(userDir(req.user), { recursive: true });
    fs.writeFileSync(path.join(userDir(req.user), filename), content, 'utf8');
    res.json({ path: `/api/assets/files/${encodeURIComponent(filename)}`, name: filename, kind: 'text' });
  })
);

router.get('/files/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const file = path.join(userDir(req.user), filename);
  if (!fs.existsSync(file)) throw bad('Asset file not found', 404);
  res.sendFile(file);
});

router.post(
  '/generate',
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const type = assetType(body.type);
    const prompt = requireText(body.prompt, 'Prompt', 10000);
    const template = store.templates.find(req.user, requireText(body.templateId, 'AI template', 120));
    if (!template || (template.type || 'video') !== type) throw bad('Matching AI template not found');
    const graph = tpl.loadGraph(template.templateId);
    const derived = tpl.deriveBindings(graph);
    if (derived.bindings.firstFrame || derived.bindings.lastFrame) {
      throw bad('This template requires frame inputs and cannot be used for prompt-only asset generation');
    }
    if (!derived.bindings.prompt) throw bad('This template has no prompt binding');
    const limits = workflow.limits;
    const width = type === 'image' || type === 'video'
      ? cleanDimension(body.width, limits.width, 'Width')
      : limits.width.default;
    const length = type === 'image' || type === 'video'
      ? cleanDimension(body.length, limits.height, 'Length')
      : limits.height.default;
    const built = workflow.build(
      graph,
      derived.bindings,
      {
        prompt,
        width,
        height: length,
        duration: limits.duration.default,
      },
      { seedBinding: derived.seed }
    );
    const result = await comfy.queuePrompt(built.graph, jobs.CLIENT_ID);
    if (!result || !result.prompt_id) throw bad('ComfyUI did not return a prompt_id', 502);
    const job = jobs.newJob(result.prompt_id, { prompt, type, templateId: template.templateId, width, length }, result.number);
    res.json({ promptId: job.promptId, job });
  })
);

router.get('/:assetId', (req, res) => {
  const asset = store.assets.find(req.user, req.params.assetId);
  if (!asset) throw bad('Asset not found', 404);
  res.json({ asset });
});

router.post('/', (req, res) => {
  const body = { ...(req.body || {}), username: req.user };
  const assetId = String(body.assetId || '').trim() || crypto.randomUUID();
  res.json({ asset: store.assets.insert(req.user, { assetId, ...payload(body) }) });
});

router.put('/:assetId', (req, res) => {
  const existing = store.assets.find(req.user, req.params.assetId);
  if (!existing) throw bad('Asset not found', 404);
  const body = { ...(req.body || {}), username: req.user };
  res.json({ asset: store.assets.update(req.user, req.params.assetId, payload(body, existing)) });
});

router.delete('/:assetId', (req, res) => {
  store.assets.remove(req.user, req.params.assetId);
  res.json({ ok: true });
});

module.exports = router;
