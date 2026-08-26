'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Failed to read ${file}: ${err.message}`);
  }
}

const app = readJson(path.join(ROOT, 'config/config.json'), {});

const config = {
  root: ROOT,
  port: Number(process.env.PORT) || app.port || 3000,
  host: process.env.HOST || app.host || '0.0.0.0',
  sessionTtlMs: app.sessionTtlMs || 12 * 60 * 60 * 1000,
  apiConfigDir: path.join(ROOT, app.apiConfigDir || 'api/config'),
  workflowDir: path.join(ROOT, app.workflowDir || 'api'),
  resourcesDir: path.join(ROOT, app.resourcesDir || 'resources/images'),
  assetsDir: path.join(ROOT, app.assetsDir || 'resources/assets'),
  dataDir: path.join(ROOT, app.dataDir || 'resources/datas'),
  navigation: Array.isArray(app.navigation) ? app.navigation : [],
  // Rendered videos are archived here as
  // <outputDir>/<username>_<projectId>/<chapterId>/<shotId>_<YYYYMMDDHHmmss>.mp4
  outputDir: path.join(ROOT, app.outputDir || 'resources/output'),
  // Bare command names resolve through PATH; absolute paths are used as-is.
  ffmpegPath: process.env.FFMPEG_PATH || app.ffmpegPath || 'ffmpeg',
  ai: {
    apiKey: process.env.AI_API_KEY || app.ai?.apiKey || '',
    url: process.env.AI_API_URL || app.ai?.url || 'https://api.openai.com/v1/chat/completions',
    model: process.env.AI_MODEL || app.ai?.model || 'gpt-4o-mini',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || app.ai?.timeoutMs) || 120000,
  },
};

config.comfy = readJson(path.join(config.apiConfigDir, 'comfy.json'), {});
config.workflow = readJson(path.join(config.apiConfigDir, 'workflow.json'), {});

// api/config/workflow.json is optional; without sane limits the UI would render
// empty min/max/step attributes and the server would clamp against undefined.
config.workflow.limits = Object.assign(
  {
    width: { min: 256, max: 1920, step: 32, default: 1280 },
    height: { min: 256, max: 1920, step: 32, default: 704 },
    duration: { min: 1, max: 10, step: 0.5, default: 5 },
  },
  config.workflow.limits
);

// account.json holds credentials and is git-ignored. Missing file is fatal:
// running without it would silently expose the generator.
const accountFile = path.join(ROOT, 'config/account.json');
const account = readJson(accountFile, null);
if (!account || !Array.isArray(account.users) || account.users.length === 0) {
  throw new Error(
    `config/account.json is missing or has no users. Copy config/account.example.json to config/account.json and fill it in.`
  );
}
config.account = account;

config.comfy.baseUrl = (process.env.COMFY_URL || config.comfy.baseUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');
config.comfy.endpoints = Object.assign(
  {
    prompt: '/prompt',
    history: '/history',
    queue: '/queue',
    view: '/view',
    upload: '/upload/image',
    interrupt: '/interrupt',
    ws: '/ws',
  },
  config.comfy.endpoints
);
config.comfy.timeoutMs = config.comfy.timeoutMs || 60000;
config.comfy.pollIntervalMs = config.comfy.pollIntervalMs || 1500;

module.exports = config;
