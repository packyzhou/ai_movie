'use strict';

const crypto = require('crypto');
const comfy = require('./comfy');
const config = require('./config');

const CLIENT_ID = `ai-movie-${crypto.randomBytes(6).toString('hex')}`;
const MAX_JOBS = 200;

/** promptId -> job */
const jobs = new Map();

function newJob(promptId, params, queueNumber) {
  const job = {
    promptId,
    queueNumber,
    params,
    status: 'queued', // queued | running | completed | failed | cancelled
    progress: 0, // 0..1
    step: null,
    totalSteps: null,
    node: null,
    queueRemaining: null,
    message: 'Queued on ComfyUI',
    videos: [],
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
  jobs.set(promptId, job);
  // Bound memory: drop the oldest finished jobs first.
  if (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const j of oldest) {
      if (jobs.size <= MAX_JOBS) break;
      if (j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled') jobs.delete(j.promptId);
    }
  }
  return job;
}

function get(promptId) {
  return jobs.get(promptId) || null;
}

function list(limit = 20) {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

function markRunning(job, message) {
  if (job.status === 'queued') {
    job.status = 'running';
    job.startedAt = job.startedAt || Date.now();
  }
  if (message) job.message = message;
}

/** Pull the video/image outputs out of a /history entry. */
function collectOutputs(history) {
  const files = [];
  const outputs = (history && history.outputs) || {};
  for (const [nodeId, out] of Object.entries(outputs)) {
    for (const key of ['videos', 'gifs', 'images', 'audio']) {
      for (const f of out[key] || []) {
        if (!f || !f.filename) continue;
        files.push({
          nodeId,
          kind: key === 'images' ? 'image' : key === 'audio' ? 'audio' : 'video',
          filename: f.filename,
          subfolder: f.subfolder || '',
          type: f.type || 'output',
          url:
            `/api/view?filename=${encodeURIComponent(f.filename)}` +
            `&subfolder=${encodeURIComponent(f.subfolder || '')}` +
            `&type=${encodeURIComponent(f.type || 'output')}`,
        });
      }
    }
  }
  // A SaveVideo node reports under "videos"; prefer those, but fall back to
  // animated images so alternative save nodes still show up.
  const videos = files.filter((f) => f.kind === 'video');
  return videos.length ? videos : files;
}

function applyHistory(job, history) {
  if (!history) return job;
  const statusStr = history.status && history.status.status_str;
  const completed = history.status && history.status.completed;

  const outputs = collectOutputs(history);
  if (outputs.length) job.videos = outputs;

  if (statusStr === 'error') {
    job.status = 'failed';
    job.finishedAt = job.finishedAt || Date.now();
    const errMsg = (history.status.messages || [])
      .filter(([name]) => name === 'execution_error' || name === 'execution_interrupted')
      .map(([, data]) => data.exception_message || data.exception_type || 'Execution interrupted')
      .join('; ');
    job.error = job.error || errMsg || 'ComfyUI reported an execution error';
    job.message = job.error;
  } else if (completed) {
    job.status = 'completed';
    job.progress = 1;
    job.finishedAt = job.finishedAt || Date.now();
    job.message = outputs.length ? 'Done' : 'Finished, but the workflow produced no video output';
  }
  return job;
}

// --- live progress over the ComfyUI websocket -------------------------------

comfy.openProgressSocket(CLIENT_ID, (msg) => {
  const data = msg.data || {};
  const job = data.prompt_id ? jobs.get(data.prompt_id) : null;

  switch (msg.type) {
    case 'status': {
      const remaining =
        data.status && data.status.exec_info ? data.status.exec_info.queue_remaining : null;
      for (const j of jobs.values()) {
        if (j.status === 'queued' || j.status === 'running') j.queueRemaining = remaining;
      }
      break;
    }
    case 'execution_start':
      if (job) markRunning(job, 'Execution started');
      break;
    case 'execution_cached':
      if (job) markRunning(job, 'Reusing cached nodes');
      break;
    case 'executing':
      if (!job) break;
      if (data.node === null) {
        // Node stream finished; /history is the authority for outputs.
        markRunning(job, 'Finalising output');
      } else {
        job.node = data.node;
        markRunning(job, `Running node ${data.node}`);
      }
      break;
    case 'progress':
      if (!job) break;
      markRunning(job);
      job.step = data.value;
      job.totalSteps = data.max;
      if (data.max > 0) job.progress = Math.min(0.99, data.value / data.max);
      job.message = `Sampling step ${data.value}/${data.max}`;
      break;
    case 'progress_state': {
      // Newer ComfyUI aggregates per-node progress; average it for the bar.
      if (!job || !data.nodes) break;
      const nodes = Object.values(data.nodes);
      if (!nodes.length) break;
      const sum = nodes.reduce((acc, n) => acc + (n.max ? n.value / n.max : 0), 0);
      job.progress = Math.min(0.99, sum / nodes.length);
      markRunning(job);
      break;
    }
    case 'executed':
      if (!job) break;
      markRunning(job, 'Node finished');
      break;
    case 'execution_error':
      if (!job) break;
      job.status = 'failed';
      job.error = data.exception_message || 'Execution error';
      job.message = job.error;
      job.finishedAt = Date.now();
      break;
    case 'execution_interrupted':
      if (!job) break;
      job.status = 'cancelled';
      job.message = 'Cancelled';
      job.finishedAt = Date.now();
      break;
    default:
      break;
  }
});

/**
 * Refresh a job from /history. The websocket gives progress; history gives the
 * authoritative result, so the status route calls this on every poll until the
 * job reaches a terminal state.
 */
async function refresh(promptId) {
  const job = jobs.get(promptId);
  if (!job) return null;
  if (job.status === 'completed' || job.status === 'cancelled') return job;

  const history = await comfy.getHistory(promptId).catch(() => null);
  if (history) return applyHistory(job, history);

  // Not in history yet - work out whether it is still waiting in the queue.
  if (job.status === 'queued') {
    const queue = await comfy.getQueue().catch(() => null);
    if (queue) {
      const inRunning = (queue.queue_running || []).some((it) => it[1] === promptId);
      const pending = queue.queue_pending || [];
      const idx = pending.findIndex((it) => it[1] === promptId);
      if (inRunning) markRunning(job, 'Execution started');
      else if (idx >= 0) job.message = `Waiting in queue (position ${idx + 1})`;
    }
  }
  return job;
}

module.exports = { CLIENT_ID, newJob, get, list, refresh, applyHistory, collectOutputs, pollIntervalMs: config.comfy.pollIntervalMs };
