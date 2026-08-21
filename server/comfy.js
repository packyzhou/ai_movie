'use strict';

const axios = require('axios');
const FormData = require('form-data');
const WebSocket = require('ws');
const config = require('./config');

const { baseUrl, endpoints, timeoutMs } = config.comfy;

function authHeaders() {
  const c = config.account.comfy || {};
  const headers = {};
  if (c.apiKey) headers.Authorization = `Bearer ${c.apiKey}`;
  return headers;
}

function authOptions() {
  const c = config.account.comfy || {};
  const opts = { headers: authHeaders(), timeout: timeoutMs };
  if (c.basicAuth && c.basicAuth.username) {
    opts.auth = { username: c.basicAuth.username, password: c.basicAuth.password || '' };
  }
  return opts;
}

const http = axios.create({ baseURL: baseUrl });

function unwrap(err) {
  if (err.response) {
    const body = err.response.data;
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    const e = new Error(`ComfyUI ${err.response.status}: ${detail}`);
    e.status = err.response.status;
    e.body = body;
    return e;
  }
  return new Error(`Cannot reach ComfyUI at ${baseUrl}: ${err.message}`);
}

/** Upload an image buffer into ComfyUI's input folder. Returns the name to use in LoadImage. */
async function uploadImage(buffer, filename, { subfolder = '', overwrite = true } = {}) {
  const form = new FormData();
  form.append('image', buffer, { filename });
  form.append('type', 'input');
  form.append('overwrite', String(overwrite));
  if (subfolder) form.append('subfolder', subfolder);

  const opts = authOptions();
  try {
    const res = await http.post(endpoints.upload, form, {
      ...opts,
      headers: { ...opts.headers, ...form.getHeaders() },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    const data = res.data || {};
    // ComfyUI's LoadImage expects "subfolder/name" when the file is nested.
    return data.subfolder ? `${data.subfolder}/${data.name}` : data.name || filename;
  } catch (err) {
    throw unwrap(err);
  }
}

/** Queue a prompt. Returns { prompt_id, number, node_errors }. */
async function queuePrompt(promptGraph, clientId) {
  try {
    const res = await http.post(
      endpoints.prompt,
      { prompt: promptGraph, client_id: clientId },
      { ...authOptions(), headers: { ...authHeaders(), 'Content-Type': 'application/json' } }
    );
    return res.data;
  } catch (err) {
    throw unwrap(err);
  }
}

async function getHistory(promptId) {
  try {
    const res = await http.get(`${endpoints.history}/${promptId}`, authOptions());
    return res.data && res.data[promptId] ? res.data[promptId] : null;
  } catch (err) {
    throw unwrap(err);
  }
}

async function getQueue() {
  try {
    const res = await http.get(endpoints.queue, authOptions());
    return res.data || { queue_running: [], queue_pending: [] };
  } catch (err) {
    throw unwrap(err);
  }
}

async function interrupt() {
  try {
    await http.post(endpoints.interrupt, {}, authOptions());
  } catch (err) {
    throw unwrap(err);
  }
}

/** Stream a generated file (video/image) back to the caller. Returns an axios stream response. */
async function viewStream(params, extraHeaders = {}) {
  try {
    return await http.get(endpoints.view, {
      ...authOptions(),
      headers: { ...authHeaders(), ...extraHeaders },
      params,
      responseType: 'stream',
      timeout: 0,
      // /view answers 206 for range requests; let the route decide what is an error.
      validateStatus: (s) => s < 400 || s === 416,
    });
  } catch (err) {
    throw unwrap(err);
  }
}

/**
 * ComfyUI only reports step-level progress over the websocket, so we keep one
 * long-lived connection per client_id and let the HTTP status route read from it.
 */
function openProgressSocket(clientId, onMessage) {
  const wsUrl = baseUrl.replace(/^http/, 'ws') + `${endpoints.ws}?clientId=${encodeURIComponent(clientId)}`;
  let socket = null;
  let closed = false;
  let retryDelay = 1000;

  const connect = () => {
    if (closed) return;
    socket = new WebSocket(wsUrl, { headers: authHeaders() });

    socket.on('open', () => {
      retryDelay = 1000;
    });
    socket.on('message', (raw, isBinary) => {
      if (isBinary) return; // preview frames - not used
      try {
        onMessage(JSON.parse(raw.toString()));
      } catch (_) {
        /* ignore malformed frames */
      }
    });
    socket.on('close', reconnect);
    socket.on('error', () => {
      /* 'close' follows and handles the retry */
    });
  };

  const reconnect = () => {
    if (closed) return;
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15000);
  };

  connect();

  return {
    close() {
      closed = true;
      if (socket) socket.close();
    },
  };
}

module.exports = {
  baseUrl,
  uploadImage,
  queuePrompt,
  getHistory,
  getQueue,
  interrupt,
  viewStream,
  openProgressSocket,
};
