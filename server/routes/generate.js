'use strict';

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const comfy = require('../comfy');
const jobs = require('../jobs');
const store = require('../store');
const tpl = require('../templates');
const workflow = require('../workflow');
const shotjobs = require('../shotjobs');
const archive = require('../archive');
const { runFfmpeg } = require('../merge');
const projects = require('./projects');
const { asyncRoute, bad } = require('./helpers');

const router = express.Router();

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const AUDIO_EXT = new Set(['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024, files: 2 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!IMAGE_EXT.has(ext)) return cb(new Error(`Unsupported image type "${ext}"`));
    cb(null, true);
  },
});
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!AUDIO_EXT.has(ext)) return cb(new Error(`Unsupported audio type "${ext}"`));
    cb(null, true);
  },
});

function listResources() {
  if (!fs.existsSync(config.resourcesDir)) return [];
  return fs
    .readdirSync(config.resourcesDir)
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => {
      const stat = fs.statSync(path.join(config.resourcesDir, f));
      return { name: f, size: stat.size, mtime: stat.mtimeMs, url: `/resources/images/${encodeURIComponent(f)}` };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

router.get('/resources', (req, res) => res.json({ images: listResources() }));

router.get('/options', (req, res) => {
  res.json({
    limits: workflow.limits,
    comfyUrl: comfy.baseUrl,
    clientId: jobs.CLIENT_ID,
    pollIntervalMs: jobs.pollIntervalMs,
    navigation: config.navigation,
  });
});

/** Store an upload under resources/images and push it into ComfyUI's input folder. */
router.post(
  '/uploads',
  upload.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw bad('No file uploaded');
    const ext = path.extname(req.file.originalname).toLowerCase();
    const stored = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.mkdirSync(config.resourcesDir, { recursive: true });
    fs.writeFileSync(path.join(config.resourcesDir, stored), req.file.buffer);
    await comfy.uploadImage(req.file.buffer, stored);
    res.json({ name: stored, url: `/resources/images/${encodeURIComponent(stored)}` });
  })
);

router.post(
  '/uploads/audio',
  audioUpload.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw bad('No audio file uploaded');
    const ext = path.extname(req.file.originalname).toLowerCase();
    const stored = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.mkdirSync(config.resourcesDir, { recursive: true });
    fs.writeFileSync(path.join(config.resourcesDir, stored), req.file.buffer);
    res.json({ name: stored, url: `/resources/images/${encodeURIComponent(stored)}` });
  })
);

async function pushNormalizedAudio(full, base, duration, trim) {
  const requestedStart = Number(trim && trim.start);
  const requestedEnd = Number(trim && trim.end);
  const start = Number.isFinite(requestedStart) && requestedStart >= 0 ? requestedStart : 0;
  const selectedDuration = Number.isFinite(requestedEnd) && requestedEnd > start ? requestedEnd - start : Number(duration) || 5;
  const seconds = Math.min(15, Math.max(2, selectedDuration));
  const token = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const temp = path.join(config.resourcesDir, `.audio_${token}.wav`);
  const range = `${String(start).replace('.', '_')}_${String(seconds).replace('.', '_')}s`;
  const remote = `${path.parse(base).name}_${range}_${token}.wav`;
  try {
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', full, '-vn',
      '-af', 'apad', '-t', String(seconds), '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', temp,
    ]);
    return await comfy.uploadImage(fs.readFileSync(temp), remote);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/** Re-push a stored media input to ComfyUI - its input folder may have been cleared. */
async function pushMedia(name, input, duration, trim) {
  const base = path.basename(String(name || ''));
  const allowed = input.kind === 'audio' ? AUDIO_EXT : IMAGE_EXT;
  if (!base) throw bad(`${input.title} is required`);
  if (!allowed.has(path.extname(base).toLowerCase())) throw bad(`${input.title} has an unsupported ${input.kind} type`);
  const full = path.join(config.resourcesDir, base);
  if (!fs.existsSync(full)) throw bad(`Media file "${base}" not found in resources/images`);
  if (input.kind === 'audio') return pushNormalizedAudio(full, base, duration, trim);
  return comfy.uploadImage(fs.readFileSync(full), base);
}

/**
 * Queue a shot. Everything comes from the stored shot, so the chapter page only
 * has to save-then-generate.
 */
router.post(
  '/generate',
  asyncRoute(async (req, res) => {
    const { projectId, chapterId, shotId } = req.body || {};
    if (!projectId || !chapterId || !shotId) throw bad('projectId, chapterId and shotId are required');

    const { project, chapter } = projects.locate(req.user, projectId, chapterId);
    const shot = chapter.shots.find((s) => s.shotId === shotId);
    if (!shot) throw bad('Shot not found', 404);
    if (shot.disabled || shot.merged) throw bad('This shot cannot be generated');
    const setting = project.settingId ? store.settings.find(req.user, project.settingId) : null;
    const settingContent = String(setting && setting.content || '').trim();
    const shotPrompt = projects.promptOf(shot);
    shot.prompt = settingContent && shotPrompt.startsWith(settingContent)
      ? shotPrompt
      : [settingContent, shotPrompt]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join('\n\n');

    const templateId = shot.templateId || project.templateId;
    const template = store.templates.find(req.user, templateId);
    if (!template) throw bad(`Shot template "${templateId}" no longer exists`);
    if ((template.type || 'video') !== 'video') throw bad(`Shot template "${template.name}" is not a video template`);

    const storedGraph = tpl.loadGraph(template.templateId);
    // Re-derive from the stored workflow so newly supported node bindings are available immediately.
    const derived = tpl.deriveBindings(storedGraph);
    const bindings = derived.bindings;
    if (derived.missing.length) {
      throw bad(`Template "${template.name}" has no binding for: ${derived.missing.join(', ')}`);
    }
    const mediaInputs = tpl.deriveMediaInputs(storedGraph);
    const mediaValues = { ...(shot.mediaInputs || {}) };
    const imageInputs = mediaInputs.filter((input) => input.kind === 'image');
    const firstInput = mediaInputs.find((input) => input.path === bindings.firstFrame?.path) || imageInputs[0];
    const lastInput = mediaInputs.find((input) => input.path === bindings.lastFrame?.path) || imageInputs[1];
    if (firstInput && !mediaValues[firstInput.key] && shot.firstFrame) mediaValues[firstInput.key] = shot.firstFrame;
    if (lastInput && !mediaValues[lastInput.key] && shot.lastFrame) mediaValues[lastInput.key] = shot.lastFrame;
    const uploadedMedia = await Promise.all(mediaInputs.flatMap((input) => mediaValues[input.key]
      ? [pushMedia(mediaValues[input.key], input, shot.duration, shot.mediaTrims && shot.mediaTrims[input.key]).then((name) => ({ input, name }))]
      : []));
    const uploadedByKey = new Map(uploadedMedia.map((media) => [media.input.key, media.name]));
    const sourceGraph = tpl.applyMediaInputs(storedGraph, mediaInputs, Object.fromEntries(uploadedByKey));
    const mediaPaths = new Set(mediaInputs.map((input) => input.path));
    const directFrames = await Promise.all([
      ['firstFrame', shot.firstFrame, 'First frame'],
      ['lastFrame', shot.lastFrame, 'Last frame'],
    ].flatMap(([key, value, title]) => bindings[key] && !mediaPaths.has(bindings[key].path) && value
      ? [pushMedia(value, { kind: 'image', title }).then((name) => ({ path: bindings[key].path, name }))]
      : []));
    const generationBindings = Object.fromEntries(
      Object.entries(bindings).filter(([key]) => key !== 'firstFrame' && key !== 'lastFrame')
    );
    const { graph, params } = workflow.build(
      sourceGraph,
      generationBindings,
      {
        prompt: shot.prompt,
        width: shot.width,
        height: shot.height,
        duration: shot.duration,
        acceleration: shot.acceleration !== false,
      },
      { seedBinding: template.seed }
    );
    for (const frame of directFrames) workflow.setInput(graph, frame.path, frame.name);
    shot.mediaInputs = Object.fromEntries(mediaInputs.flatMap((input) => mediaValues[input.key] ? [[input.key, mediaValues[input.key]]] : []));
    shot.firstFrame = firstInput ? mediaValues[firstInput.key] || '' : shot.firstFrame || '';
    shot.lastFrame = lastInput ? mediaValues[lastInput.key] || '' : shot.lastFrame || '';

    const result = await comfy.queuePrompt(graph, jobs.CLIENT_ID);
    if (result && result.node_errors && Object.keys(result.node_errors).length) {
      return res.status(400).json({ error: 'ComfyUI rejected the workflow', node_errors: result.node_errors });
    }
    if (!result || !result.prompt_id) throw bad('ComfyUI did not return a prompt_id', 502);

    const job = jobs.newJob(result.prompt_id, {
      ...params,
      __progress: {
        username: req.user,
        projectId: project.projectId,
        chapterId: chapter.chapterId,
        shotId: shot.shotId,
      },
    }, result.number);
    shot.job = shotjobs.queued(job.promptId);
    projects.persist(req.user, project);

    res.json({ promptId: job.promptId, job: shot.job, shot });
  })
);

router.get('/jobs', (req, res) => res.json({ jobs: jobs.list(Number(req.query.limit) || 20) }));

router.get(
  '/jobs/:promptId',
  asyncRoute(async (req, res) => {
    let job = await jobs.refresh(req.params.promptId);
    if (!job) {
      // The server may have restarted; rebuild from ComfyUI's own history.
      const history = await comfy.getHistory(req.params.promptId).catch(() => null);
      if (!history) throw bad('Unknown prompt_id', 404);
      job = jobs.applyHistory(jobs.newJob(req.params.promptId, {}, null), history);
    }
    res.json({ job });
  })
);

router.post(
  '/jobs/:promptId/cancel',
  asyncRoute(async (req, res) => {
    await comfy.interrupt();
    res.json({ ok: true });
  })
);

router.get(
  '/videos',
  asyncRoute(async (req, res) => {
    const relative = String(req.query.file || '').replace(/\\/g, '/');
    if (!relative) throw bad('file is required');
    const ownerPrefix = `${archive.safeSegment(req.user, 'user')}_`;
    if (!relative.split('/')[0].startsWith(ownerPrefix)) throw bad('Video not found', 404);

    const file = archive.resolveRelative(relative);
    if (!fs.existsSync(file)) throw bad('Video not found', 404);
    const stat = fs.statSync(file);
    const range = req.headers.range;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${path.basename(file)}"`);

    if (!range) {
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(file).pipe(res);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return res.status(416).end();
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', end - start + 1);
    fs.createReadStream(file, { start, end }).pipe(res);
  })
);

router.get(
  '/view',
  asyncRoute(async (req, res) => {
    const { filename, subfolder = '', type = 'output' } = req.query;
    if (!filename) throw bad('filename is required');

    const extra = {};
    if (req.headers.range) extra.Range = req.headers.range;

    const upstream = await comfy.viewStream({ filename, subfolder, type }, extra);
    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    }
    if (req.query.download) {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(String(filename))}"`);
    }
    upstream.data.pipe(res);
  })
);

module.exports = router;
