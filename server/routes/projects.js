'use strict';

const express = require('express');
const crypto = require('crypto');
const store = require('../store');
const workflow = require('../workflow');
const shotjobs = require('../shotjobs');
const archive = require('../archive');
const merger = require('../merge');
const { asyncRoute, bad, pageQuery, requireText } = require('./helpers');

const router = express.Router();

const BACKGROUND_MAX = 500;

function defaults() {
  const l = workflow.limits;
  return {
    width: (l.width && l.width.default) || 1280,
    height: (l.height && l.height.default) || 704,
    duration: (l.duration && l.duration.default) || 5,
  };
}

/** Renumber chapters/shots so `seq` always reads 1..n after add/delete/reorder. */
function renumber(list) {
  list.forEach((item, i) => {
    item.seq = i + 1;
  });
  return list;
}

function normalizeChapters(input, existing = []) {
  if (!Array.isArray(input)) return existing;
  const byId = new Map(existing.map((c) => [c.chapterId, c]));
  const chapters = input.map((c) => {
    const prev = byId.get(c.chapterId);
    return {
      chapterId: c.chapterId || crypto.randomUUID(),
      title: requireText(c.title, 'Chapter title', 200),
      // Shots are edited on the chapter page, never through the project modal.
      shots: prev ? prev.shots || [] : [],
    };
  });
  if (!chapters.length) throw bad('At least one chapter is required');
  return renumber(chapters);
}

function summarize(p) {
  return {
    projectId: p.projectId,
    name: p.name,
    templateId: p.templateId,
    background: p.background,
    chapterCount: (p.chapters || []).length,
    shotCount: (p.chapters || []).reduce((n, c) => n + (c.shots || []).length, 0),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

router.get('/', (req, res) => {
  const result = store.projects.page(req.user, pageQuery(req, ['name', 'projectId', 'background']));
  res.json({ ...result, items: result.items.map(summarize) });
});

router.get(
  '/:projectId',
  asyncRoute(async (req, res) => {
    const project = store.projects.find(req.user, req.params.projectId);
    if (!project) throw bad('Project not found', 404);
    res.json({ project });
  })
);

router.post(
  '/',
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const templateId = requireText(body.templateId, 'Template', 64);
    if (!store.templates.find(req.user, templateId)) throw bad(`Unknown template "${templateId}"`);

    const project = {
      projectId: String(body.projectId || '').trim() || crypto.randomUUID(),
      name: requireText(body.name, 'Project name', 120),
      templateId,
      background: String(body.background || '').trim().slice(0, BACKGROUND_MAX),
      chapters: normalizeChapters(body.chapters || []),
    };
    res.json({ project: store.projects.insert(req.user, project) });
  })
);

router.put(
  '/:projectId',
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const existing = store.projects.find(req.user, req.params.projectId);
    if (!existing) throw bad('Project not found', 404);

    const patch = {};
    if (body.name !== undefined) patch.name = requireText(body.name, 'Project name', 120);
    if (body.templateId !== undefined) {
      const templateId = requireText(body.templateId, 'Template', 64);
      if (!store.templates.find(req.user, templateId)) throw bad(`Unknown template "${templateId}"`);
      patch.templateId = templateId;
    }
    if (body.background !== undefined) {
      patch.background = String(body.background || '').trim().slice(0, BACKGROUND_MAX);
    }
    if (body.chapters !== undefined) patch.chapters = normalizeChapters(body.chapters, existing.chapters || []);

    res.json({ project: store.projects.update(req.user, req.params.projectId, patch) });
  })
);

router.delete(
  '/:projectId',
  asyncRoute(async (req, res) => {
    store.projects.remove(req.user, req.params.projectId);
    res.json({ ok: true });
  })
);

// --- chapters & shots -------------------------------------------------------

function locate(username, projectId, chapterId) {
  const project = store.projects.find(username, projectId);
  if (!project) throw bad('Project not found', 404);
  const chapter = (project.chapters || []).find((c) => c.chapterId === chapterId);
  if (!chapter) throw bad('Chapter not found', 404);
  chapter.shots = chapter.shots || [];
  return { project, chapter };
}

function persist(username, project) {
  return store.projects.update(username, project.projectId, { chapters: project.chapters });
}

router.get(
  '/:projectId/chapters/:chapterId',
  asyncRoute(async (req, res) => {
    const { project, chapter } = locate(req.user, req.params.projectId, req.params.chapterId);
    const changed = await shotjobs.refreshChapter(chapter, {
      username: req.user,
      projectId: project.projectId,
      chapterId: chapter.chapterId,
    });
    if (changed) persist(req.user, project);
    res.json({
      chapter,
      project: { projectId: project.projectId, name: project.name, templateId: project.templateId, background: project.background },
    });
  })
);

router.post(
  '/:projectId/chapters/:chapterId/shots',
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const { project, chapter } = locate(req.user, req.params.projectId, req.params.chapterId);
    const shot = {
      shotId: crypto.randomUUID(),
      seq: chapter.shots.length + 1, // sequence is generated, never entered
      name: requireText(body.name, 'Shot name', 120),
      remark: String(body.remark || '').trim().slice(0, 500),
      firstFrame: '',
      lastFrame: '',
      prompt: '',
      ...defaults(),
      job: shotjobs.emptyJob(),
    };
    chapter.shots.push(shot);
    renumber(chapter.shots);
    persist(req.user, project);
    res.json({ shot });
  })
);

router.post(
  '/:projectId/chapters/:chapterId/shots/merge',
  asyncRoute(async (req, res) => {
    const { project, chapter } = locate(req.user, req.params.projectId, req.params.chapterId);
    if (chapter.shots.length < 2) throw bad('至少需要两个镜头才能合成');
    const sources = chapter.shots.map((shot) => ({ shot, job: shotjobs.normalize(shot.job) }));
    const unavailable = sources.find(({ job }) => job.status !== shotjobs.COMPLETED || !job.file);
    if (unavailable) throw bad(`镜头「${unavailable.shot.name}」尚未生成完成，无法合成`);

    const date = new Date();
    const shotId = crypto.randomUUID();
    const saved = await merger.mergeVideos(sources.map(({ job }) => job.file), {
      username: req.user,
      projectId: project.projectId,
      chapterId: chapter.chapterId,
      shotId,
      date,
    });
    const name = `merge_${archive.stamp(date)}`;
    const merged = {
      shotId,
      seq: 1,
      name,
      remark: `由 ${sources.length} 个镜头按顺序合成`,
      firstFrame: '',
      lastFrame: '',
      prompt: '',
      width: sources[0].shot.width,
      height: sources[0].shot.height,
      duration: sources.reduce((total, item) => total + (Number(item.shot.duration) || 0), 0),
      job: {
        ...shotjobs.emptyJob(),
        promptId: `merge-${shotId}`,
        status: shotjobs.COMPLETED,
        progress: 1,
        message: '合成完成',
        queuedAt: date.toISOString(),
        finishedAt: new Date().toISOString(),
        ...saved,
      },
    };

    chapter.shots = [merged];
    try {
      persist(req.user, project);
    } catch (err) {
      await archive.remove(saved.file);
      throw err;
    }
    await Promise.all(sources.map(({ job }) => archive.remove(job.file)));
    res.json({ shot: merged, removed: sources.length });
  })
);

router.put(
  '/:projectId/chapters/:chapterId/shots/reorder',
  asyncRoute(async (req, res) => {
    const { project, chapter } = locate(req.user, req.params.projectId, req.params.chapterId);
    const shotIds = Array.isArray(req.body && req.body.shotIds) ? req.body.shotIds.map(String) : [];
    const currentIds = chapter.shots.map((shot) => shot.shotId);
    if (shotIds.length !== currentIds.length || new Set(shotIds).size !== currentIds.length ||
      currentIds.some((id) => !shotIds.includes(id))) {
      throw bad('shotIds must contain every chapter shot exactly once');
    }
    const byId = new Map(chapter.shots.map((shot) => [shot.shotId, shot]));
    chapter.shots = renumber(shotIds.map((id) => byId.get(id)));
    persist(req.user, project);
    res.json({ shots: chapter.shots });
  })
);

const SHOT_FIELDS = ['name', 'remark', 'firstFrame', 'lastFrame', 'prompt', 'width', 'height', 'duration'];

router.put(
  '/:projectId/chapters/:chapterId/shots/:shotId',
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const { project, chapter } = locate(req.user, req.params.projectId, req.params.chapterId);
    const shot = chapter.shots.find((s) => s.shotId === req.params.shotId);
    if (!shot) throw bad('Shot not found', 404);

    for (const field of SHOT_FIELDS) {
      if (body[field] === undefined) continue;
      if (field === 'name') shot.name = requireText(body.name, 'Shot name', 120);
      else if (['width', 'height', 'duration'].includes(field)) shot[field] = Number(body[field]);
      else shot[field] = body[field];
    }
    persist(req.user, project);
    res.json({ shot });
  })
);

router.delete(
  '/:projectId/chapters/:chapterId/shots/:shotId',
  asyncRoute(async (req, res) => {
    const { project, chapter } = locate(req.user, req.params.projectId, req.params.chapterId);
    const idx = chapter.shots.findIndex((s) => s.shotId === req.params.shotId);
    if (idx === -1) throw bad('Shot not found', 404);
    const [removed] = chapter.shots.splice(idx, 1);
    renumber(chapter.shots);
    persist(req.user, project);
    await archive.remove(removed.job && removed.job.file);
    res.json({ ok: true });
  })
);

module.exports = { router, locate, persist };
