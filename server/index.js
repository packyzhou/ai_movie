'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const auth = require('./auth');
const routes = require('./routes');

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api', routes);

// Source images are only browsable to a logged-in user.
app.use('/resources/images', auth.requireAuth, express.static(config.resourcesDir, { fallthrough: false }));

// Serve the built SPA when it exists; in development `npm run dev:web` proxies here instead.
const dist = path.join(config.root, 'web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 400;
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err.message);
  res.status(status).json({ error: err.message || 'Unexpected error' });
});

app.listen(config.port, config.host, () => {
  console.log(`ai_movie server listening on http://${config.host}:${config.port}`);
  console.log(`ComfyUI target: ${config.comfy.baseUrl}`);
  if (!fs.existsSync(dist)) console.log('web/dist not built - run `npm run build`, or `npm run dev:web` for HMR.');
});
