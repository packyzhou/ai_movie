'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const USERNAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const FILE_RE = /^([A-Za-z0-9_.-]{1,64})_progress_(\d{8})_tmp\.json$/;
const RETENTION_DAYS = 7;

function dateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function fileFor(username, date = new Date()) {
  if (!USERNAME_RE.test(username)) throw new Error('Invalid username for progress storage');
  return path.join(config.dataDir, `${username}_progress_${dateKey(date)}_tmp.json`);
}

function readFile(file) {
  if (!fs.existsSync(file)) return { jobs: [] };
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    return { jobs: Array.isArray(value.jobs) ? value.jobs : [] };
  } catch (_) {
    return { jobs: [] };
  }
}

function cleanup(now = new Date()) {
  if (!fs.existsSync(config.dataDir)) return;
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (RETENTION_DAYS - 1));
  for (const name of fs.readdirSync(config.dataDir)) {
    const match = name.match(FILE_RE);
    if (!match) continue;
    const fileDate = new Date(
      Number(match[2].slice(0, 4)),
      Number(match[2].slice(4, 6)) - 1,
      Number(match[2].slice(6, 8))
    );
    if (fileDate < cutoff) fs.rmSync(path.join(config.dataDir, name), { force: true });
  }
}

function snapshot(job, metadata = {}) {
  return {
    promptId: job.promptId,
    projectId: metadata.projectId || job.params?.__progress?.projectId || null,
    chapterId: metadata.chapterId || job.params?.__progress?.chapterId || null,
    shotId: metadata.shotId || job.params?.__progress?.shotId || null,
    status: job.status,
    progress: Number(job.progress) || 0,
    step: job.step ?? null,
    totalSteps: job.totalSteps ?? null,
    node: job.node ?? null,
    queueRemaining: job.queueRemaining ?? null,
    message: job.message || '',
    error: job.error || null,
    updatedAt: new Date().toISOString(),
  };
}

function save(username, job, metadata = {}) {
  if (!username || !job || !job.promptId) return;
  cleanup();
  const file = fileFor(username);
  const data = readFile(file);
  const next = snapshot(job, metadata);
  const index = data.jobs.findIndex((item) => item.promptId === next.promptId);
  if (index >= 0) data.jobs[index] = next;
  else data.jobs.push(next);
  fs.mkdirSync(config.dataDir, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ jobs: data.jobs, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(temp, file);
}

function find(username, promptId) {
  if (!username || !promptId) return null;
  cleanup();
  const today = new Date();
  for (let offset = 0; offset < RETENTION_DAYS; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const found = readFile(fileFor(username, date)).jobs.find((job) => job.promptId === promptId);
    if (found) return found;
  }
  return null;
}

cleanup();

module.exports = { save, find, cleanup, fileFor, dateKey };
