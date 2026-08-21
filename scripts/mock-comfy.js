'use strict';

/**
 * Minimal stand-in for ComfyUI, used to exercise the server without a GPU.
 *   node scripts/mock-comfy.js       # listens on 8188
 * It accepts an upload, queues a prompt, streams fake progress over the
 * websocket and then reports a video in /history.
 */

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '64mb' }));

const history = {};
const sockets = new Set();

function broadcast(msg) {
  const raw = JSON.stringify(msg);
  for (const ws of sockets) ws.send(raw);
}

app.post('/upload/image', (req, res) => {
  // Multipart body is irrelevant to the mock; echo back a plausible name.
  res.json({ name: `mock_${crypto.randomBytes(3).toString('hex')}.jpg`, subfolder: '', type: 'input' });
});

app.post('/prompt', (req, res) => {
  const promptId = crypto.randomUUID();
  res.json({ prompt_id: promptId, number: 1, node_errors: {} });

  setTimeout(() => broadcast({ type: 'execution_start', data: { prompt_id: promptId } }), 200);
  let step = 0;
  const total = 8;
  const timer = setInterval(() => {
    step += 1;
    broadcast({ type: 'progress', data: { prompt_id: promptId, node: '140:125', value: step, max: total } });
    if (step >= total) {
      clearInterval(timer);
      history[promptId] = {
        prompt: [1, promptId, req.body.prompt, {}, []],
        outputs: { 92: { videos: [{ filename: 'MiniMax_H3_00001.mp4', subfolder: 'video', type: 'output' }] } },
        status: { status_str: 'success', completed: true, messages: [] },
      };
      broadcast({ type: 'executing', data: { prompt_id: promptId, node: null } });
    }
  }, 300);
});

app.get('/history/:id', (req, res) => {
  const entry = history[req.params.id];
  res.json(entry ? { [req.params.id]: entry } : {});
});

app.get('/queue', (req, res) => res.json({ queue_running: [], queue_pending: [] }));
app.post('/interrupt', (req, res) => res.json({}));
app.get('/view', (req, res) => {
  res.setHeader('Content-Type', 'video/mp4');
  res.end(Buffer.from('fake-mp4-bytes'));
});

const server = http.createServer(app);
new WebSocketServer({ server, path: '/ws' }).on('connection', (ws) => {
  sockets.add(ws);
  ws.on('close', () => sockets.delete(ws));
  ws.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } } } }));
});

server.listen(8199, '127.0.0.1', () => console.log('mock ComfyUI on http://127.0.0.1:8199'));
