'use strict';

const express = require('express');
const crypto = require('crypto');
const store = require('../store');
const tpl = require('../templates');
const workflow = require('../workflow');
const config = require('../config');
const { asyncRoute, bad, pageQuery, requireText } = require('./helpers');

const router = express.Router();

/** The row we hand to the list view - the full graph stays out of it. */
function summarize(row) {
  const { graph, ...rest } = row;
  return rest;
}

/**
 * Give a brand-new user the shipped MiniMax workflow so "select a template"
 * is never an empty list on first use.
 */
function seedDefault(username) {
  if (store.templates.list(username).length) return;
  const graph = workflow.loadBuiltinTemplate();
  const templateId = 'builtin-minimax-h3';
  const { bindings, seed, missing } = tpl.deriveBindings(graph);
  tpl.save(templateId, graph, { templateId, name: 'MiniMax H3 首尾帧生视频', owner: username });
  store.templates.insert(username, {
    templateId,
    name: 'MiniMax H3 首尾帧生视频',
    remark: '内置模板：首帧 + 尾帧 + 提示词 → 视频',
    nodeCount: Object.keys(graph).length,
    bindings,
    seed,
    missing,
    builtin: true,
  });
}

router.get(
  '/',
  asyncRoute(async (req, res) => {
    seedDefault(req.user);
    const result = store.templates.page(req.user, pageQuery(req, ['name', 'templateId', 'remark']));
    res.json({ ...result, items: result.items.map(summarize) });
  })
);

router.get(
  '/:templateId',
  asyncRoute(async (req, res) => {
    const row = store.templates.find(req.user, req.params.templateId);
    if (!row) throw bad('Template not found', 404);
    // The editor needs the raw JSON back, so read it from ./api/<id>/workflow.json.
    const graph = tpl.loadGraph(row.templateId);
    res.json({ template: { ...summarize(row), content: JSON.stringify(graph, null, 2) } });
  })
);

router.post(
  '/',
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const templateId = String(body.templateId || '').trim() || crypto.randomUUID();
    const name = requireText(body.name, 'Template name', 120);
    const graph = tpl.parseGraph(body.content);
    const { bindings, seed, missing } = tpl.deriveBindings(graph);

    tpl.save(templateId, graph, { templateId, name, owner: req.user, savedAt: new Date().toISOString() });
    const row = store.templates.insert(req.user, {
      templateId,
      name,
      remark: String(body.remark || '').trim(),
      nodeCount: Object.keys(graph).length,
      bindings,
      seed,
      missing,
    });
    res.json({ template: summarize(row), missing });
  })
);

router.put(
  '/:templateId',
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const existing = store.templates.find(req.user, req.params.templateId);
    if (!existing) throw bad('Template not found', 404);

    const patch = { remark: String(body.remark ?? existing.remark ?? '').trim() };
    if (body.name !== undefined) patch.name = requireText(body.name, 'Template name', 120);

    if (body.content !== undefined && String(body.content).trim()) {
      const graph = tpl.parseGraph(body.content);
      const derived = tpl.deriveBindings(graph);
      tpl.save(existing.templateId, graph, {
        templateId: existing.templateId,
        name: patch.name || existing.name,
        owner: req.user,
        savedAt: new Date().toISOString(),
      });
      Object.assign(patch, {
        nodeCount: Object.keys(graph).length,
        bindings: derived.bindings,
        seed: derived.seed,
        missing: derived.missing,
      });
    }

    const row = store.templates.update(req.user, req.params.templateId, patch);
    res.json({ template: summarize(row), missing: row.missing });
  })
);

router.delete(
  '/:templateId',
  asyncRoute(async (req, res) => {
    const inUse = store.projects
      .list(req.user)
      .filter((p) => p.templateId === req.params.templateId)
      .map((p) => p.name);
    if (inUse.length) throw bad(`Template is used by: ${inUse.join(', ')}`);

    store.templates.remove(req.user, req.params.templateId);
    tpl.removeFiles(req.params.templateId);
    res.json({ ok: true });
  })
);

/** Let the UI dry-run the JSON self-check before saving. */
router.post(
  '/validate',
  asyncRoute(async (req, res) => {
    const graph = tpl.parseGraph((req.body || {}).content);
    const derived = tpl.deriveBindings(graph);
    res.json({ ok: true, nodeCount: Object.keys(graph).length, ...derived });
  })
);

module.exports = { router, seedDefault, workflowDir: config.workflowDir };
