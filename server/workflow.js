'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const SEPARATOR = '.inputs.';

/**
 * Node ids may contain colons ("140:131"), so binding paths are split on the
 * first ".inputs." rather than on dots.
 */
function parsePath(p) {
  const at = p.indexOf(SEPARATOR);
  if (at === -1) throw new Error(`Invalid binding path "${p}" (expected <nodeId>.inputs.<field>)`);
  return { nodeId: p.slice(0, at), field: p.slice(at + SEPARATOR.length) };
}

function setInput(graph, bindingPath, value) {
  const { nodeId, field } = parsePath(bindingPath);
  const node = graph[nodeId];
  if (!node) throw new Error(`Workflow has no node "${nodeId}" (binding ${bindingPath})`);
  node.inputs[field] = value;
}

/** The built-in workflow shipped in ./api, used as the seed template on first run. */
function loadBuiltinTemplate() {
  const name = config.workflow.template;
  const file = path.join(config.workflowDir, path.basename(name));
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const limits = config.workflow.limits || {};

function clampInt(value, spec, label) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
  const min = spec.min != null ? spec.min : 1;
  const max = spec.max != null ? spec.max : 4096;
  if (n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}`);
  const step = spec.step || 1;
  return Math.round(n / step) * step;
}

function validate(params) {
  const prompt = String(params.prompt || '').trim();
  if (!prompt) throw new Error('prompt is required');
  if (!params.firstFrame) throw new Error('first frame image is required');
  if (!params.lastFrame) throw new Error('last frame image is required');

  const durSpec = limits.duration || { min: 1, max: 10 };
  const duration = Number(params.duration);
  if (!Number.isFinite(duration) || duration < durSpec.min || duration > durSpec.max) {
    throw new Error(`duration must be between ${durSpec.min} and ${durSpec.max} seconds`);
  }

  return {
    prompt,
    firstFrame: String(params.firstFrame),
    lastFrame: String(params.lastFrame),
    width: clampInt(params.width, limits.width || {}, 'width'),
    height: clampInt(params.height, limits.height || {}, 'height'),
    duration,
  };
}

/**
 * Build a queueable prompt graph.
 * `graph` is the template's node map, `bindings`/`seedBinding` say where the six
 * parameters go. Frame values must already be names known to ComfyUI's input folder.
 */
function build(graph, bindings, params, { seed, seedBinding } = {}) {
  const clean = validate(params);
  const out = JSON.parse(JSON.stringify(graph));

  for (const [key, binding] of Object.entries(bindings || {})) {
    if (!binding || !binding.path || clean[key] === undefined) continue;
    setInput(out, binding.path, clean[key]);
  }

  if (seedBinding && seedBinding.path) {
    const noiseSeed = seed != null && seed !== '' ? Number(seed) : Math.floor(Math.random() * 2 ** 48);
    setInput(out, seedBinding.path, noiseSeed);
    clean.seed = noiseSeed;
  }

  return { graph: out, params: clean };
}

module.exports = { build, validate, loadBuiltinTemplate, limits, parsePath, setInput };
