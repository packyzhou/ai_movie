'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function dirFor(templateId) {
  if (!ID_RE.test(templateId)) throw new Error('Invalid template id');
  return path.join(config.workflowDir, templateId);
}

/**
 * Validate a pasted workflow. Accepts either the raw API-format map of nodes or
 * a wrapper like {"prompt": {...}} that people often copy out of a curl example.
 */
function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeWorkflow(data) {
  if (isObject(data.prompt) && !data.prompt.class_type) return data.prompt;
  if (!Array.isArray(data.nodes)) return data;

  const links = new Map();
  for (const link of Array.isArray(data.links) ? data.links : []) {
    const [linkId, sourceId, sourceSlot, targetId, targetSlot] = Array.isArray(link)
      ? link
      : [link.id, link.origin_id ?? link.originId, link.origin_slot ?? link.originSlot, link.target_id ?? link.targetId, link.target_slot ?? link.targetSlot];
    if (linkId !== undefined) {
      links.set(String(linkId), [sourceId, sourceSlot]);
      links.set(`${targetId}:${targetSlot}`, [sourceId, sourceSlot]);
    }
  }

  return Object.fromEntries(data.nodes.map((node) => {
    const inputs = {};
    let widgetIndex = 0;
    for (const input of Array.isArray(node.inputs) ? node.inputs : []) {
      const link = links.get(`${node.id}:${input.slot ?? input.index}`) ||
        (input.link !== undefined && input.link !== null ? links.get(String(input.link)) : null);
      if (link) inputs[input.name] = link;
      else if (Array.isArray(node.widgets_values) && widgetIndex < node.widgets_values.length) {
        inputs[input.name] = node.widgets_values[widgetIndex++];
      }
    }
    return [String(node.id), {
      class_type: node.class_type || node.type,
      inputs,
      ...(node._meta || node.title ? { _meta: { ...(node._meta || {}), ...(node.title ? { title: node.title } : {}) } } : {}),
    }];
  }));
}

function parseGraph(content) {
  let data = content;
  if (typeof data === 'string') {
    const text = data.trim();
    if (!text) throw new Error('Template content is empty');
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`Template content is not valid JSON: ${err.message}`);
    }
  }
  if (!isObject(data)) throw new Error('Template content must be a JSON object');
  data = normalizeWorkflow(data);

  const ids = Object.keys(data);
  if (!ids.length) throw new Error('Template content has no nodes');
  for (const id of ids) {
    const node = data[id];
    if (!isObject(node)) throw new Error(`Node "${id}" is not an object`);
    if (!node.class_type) throw new Error(`Node "${id}" is missing "class_type"`);
    if (!isObject(node.inputs)) throw new Error(`Node "${id}" is missing "inputs"`);
  }
  return data;
}

const title = (node) => String((node._meta && node._meta.title) || '').toLowerCase();

/**
 * Work out which node inputs the six UI parameters should be written to.
 * A pasted workflow has no annotations, so this leans on the conventions the
 * MiniMax/Wan-style templates follow: LoadImage nodes for the frames, one
 * node carrying prompt+width+height, and a titled primitive for duration.
 */
function deriveBindings(graph) {
  const entries = Object.entries(graph);
  const bindings = {};

  const loaders = entries.filter(([, n]) => n.class_type === 'LoadImage');
  const byTitle = (re) => loaders.find(([, n]) => re.test(title(n)));
  const first = byTitle(/start|first|首/) || loaders[0];
  const last = byTitle(/end|last|尾/) || loaders.find(([id]) => !first || id !== first[0]) || loaders[1];
  if (first) bindings.firstFrame = { path: `${first[0]}.inputs.image`, type: 'image' };
  if (last) bindings.lastFrame = { path: `${last[0]}.inputs.image`, type: 'image' };

  // The video node is the one that takes a text prompt alongside dimensions.
  // Some custom MiniMax nodes use snake_case field names. A T2V variant may
  // also call its prompt `first_frame`; its value is text, not an image.
  const videoNode =
    entries.find(([, n]) => 'prompt' in n.inputs && 'width' in n.inputs && 'height' in n.inputs) ||
    entries.find(([, n]) => 'text' in n.inputs && 'width' in n.inputs && 'height' in n.inputs) ||
    entries.find(([, n]) => 'first_frame' in n.inputs && 'last_frame' in n.inputs && 'width' in n.inputs && 'height' in n.inputs) ||
    entries.find(([, n]) => 'prompt' in n.inputs) ||
    entries.find(([, n]) => 'text' in n.inputs);
  if (videoNode) {
    const [id, node] = videoNode;
    const promptField = 'prompt' in node.inputs
      ? 'prompt'
      : 'text' in node.inputs
        ? 'text'
        : 'first_frame';
    bindings.prompt = { path: `${id}.inputs.${promptField}`, type: 'string' };
    if ('width' in node.inputs) bindings.width = { path: `${id}.inputs.width`, type: 'int' };
    if ('height' in node.inputs) bindings.height = { path: `${id}.inputs.height`, type: 'int' };
    if (!bindings.lastFrame && 'last_frame' in node.inputs) {
      bindings.lastFrame = { path: `${id}.inputs.last_frame`, type: 'image' };
    }
  }

  const durationNode =
    entries.find(([, n]) => /duration|时长/.test(title(n)) && 'value' in n.inputs) ||
    entries.find(([, n]) => n.class_type === 'PrimitiveFloat' && 'value' in n.inputs);
  if (durationNode) bindings.duration = { path: `${durationNode[0]}.inputs.value`, type: 'float' };

  const seedNode =
    entries.find(([, n]) => 'noise_seed' in n.inputs) || entries.find(([, n]) => 'seed' in n.inputs);
  const seed = seedNode
    ? { path: `${seedNode[0]}.inputs.${'noise_seed' in seedNode[1].inputs ? 'noise_seed' : 'seed'}` }
    : null;

  // MiniMax H3 T2V exposes `first_frame` as its text prompt and may use a
  // fixed duration, so those two UI fields are intentionally not required for
  // that workflow shape. All other templates retain the six-field contract.
  const optional = videoNode && 'first_frame' in videoNode[1].inputs
    ? ['firstFrame', 'duration']
    : [];
  const missing = ['firstFrame', 'lastFrame', 'prompt', 'width', 'height', 'duration'].filter(
    (k) => !bindings[k] && !optional.includes(k)
  );
  return { bindings, seed, missing };
}

/** Persist the graph under ./api/<templateId>/. */
function save(templateId, graph, meta) {
  const dir = dirFor(templateId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'workflow.json'), JSON.stringify(graph, null, 2));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return dir;
}

function loadGraph(templateId) {
  const file = path.join(dirFor(templateId), 'workflow.json');
  if (!fs.existsSync(file)) throw new Error(`Template "${templateId}" has no stored workflow`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function removeFiles(templateId) {
  const dir = dirFor(templateId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { parseGraph, deriveBindings, save, loadGraph, removeFiles, dirFor };
