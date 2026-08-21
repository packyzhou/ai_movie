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
  dataDir: path.join(ROOT, app.dataDir || 'resources/datas'),
};

config.comfy = readJson(path.join(config.apiConfigDir, 'comfy.json'), {});
config.workflow = readJson(path.join(config.apiConfigDir, 'workflow.json'), {});

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
