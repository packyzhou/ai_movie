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
const projects = require('./projects');
const { asyncRoute, bad } = require('./helpers');

const router = express.Router();

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024, files: 2 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!IMAGE_EXT.has(ext)) return cb(new Error(`Unsupported image type "${ext}"`));
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

/** Re-push a stored frame to ComfyUI - its input folder may have been cleared. */
async function pushFrame(name, label) {
  const base = path.basename(String(name || ''));
  if (!base) throw bad(`${label} image is required`);
  const full = path.join(config.resourcesDir, base);
  if (!fs.existsSync(full)) throw bad(`Image "${base}" not found in resources/images`);
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
    shot.prompt = projects.promptOf(shot);

    const template = store.templates.find(req.user, project.templateId);
    if (!template) throw bad(`Project template "${project.templateId}" no longer exists`);
    if ((template.type || 'video') !== 'video') throw bad(`Project template "${template.name}" is not a video template`);

    const sourceGraph = tpl.loadGraph(template.templateId);
    // Older rows may have been created before snake_case/custom-node binding
    // support was added. Re-derive those rows from the stored workflow.
    const derived = tpl.deriveBindings(sourceGraph);
    const needsDerivation = !template.bindings || !Object.keys(template.bindings).length ||
      (template.missing && template.missing.length);
    const bindings = needsDerivation ? derived.bindings : template.bindings;
    const missing = needsDerivation ? derived.missing : [];
    if (missing.length) {
      throw bad(`Template "${template.name}" has no binding for: ${missing.join(', ')}`);
    }

    const hasFrames = Boolean(shot.firstFrame || shot.lastFrame);
    const generationBindings = hasFrames
      ? bindings
      : Object.fromEntries(Object.entries(bindings).filter(([key]) => key !== 'firstFrame' && key !== 'lastFrame'));
    const [firstFrame, lastFrame] = await Promise.all([
      hasFrames && bindings.firstFrame ? pushFrame(shot.firstFrame, 'First frame') : Promise.resolve(''),
      hasFrames && bindings.lastFrame ? pushFrame(shot.lastFrame, 'Last frame') : Promise.resolve(''),
    ]);

    const { graph, params } = workflow.build(
      sourceGraph,
      generationBindings,
      {
        firstFrame,
        lastFrame,
        prompt: shot.prompt,
        width: shot.width,
        height: shot.height,
        duration: shot.duration,
      },
      { seedBinding: template.seed }
    );

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
