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
const INTRODUCTION_MAX = 5000;
const STORYBOARD_DEFAULT = '要求：\nxxx\n\n场景描述：\nxxx\n\n剧情：\nxxx\n\n镜头：\nxxx\n\n音频：\nxxx\n\n字幕：\nxxx';
const NEGATIVE_DEFAULT = '无动画、卡通或过度CG感，保持实拍质感。无其他人、无复制人、无变形、无畸变。';

function chapterBackground(project, chapter) {
  return [String(project.background || '').trim(), String(chapter.introduction || '').trim()].filter(Boolean).join('\n-------\n');
}

function promptOf(shot) {
  if (shot.promptBackground !== undefined || shot.promptStoryboard !== undefined || shot.promptNegative !== undefined) {
    return [shot.promptBackground, shot.promptStoryboard, shot.promptNegative]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join('\n\n');
  }
  return String(shot.prompt || '').trim();
}

function cleanStyleIds(username, value) {
  const ids = Array.isArray(value) ? value.map(String) : [];
  const unique = [...new Set(ids)];
  const known = new Set(store.styles.list(username).map((style) => style.styleId));
  if (unique.some((id) => !known.has(id))) throw bad('Unknown project style');
  return unique;
}

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

function refreshMergeLocks(shots) {
  const referenced = new Set(shots.filter((shot) => shot.merged).flatMap((shot) => shot.sourceShotIds || []));
  shots.forEach((shot) => {
    shot.disabled = referenced.has(shot.shotId);
  });
  return shots;
}

function normalizeChapters(input, existing = []) {
  if (!Array.isArray(input)) return existing;
  const byId = new Map(existing.map((c) => [c.chapterId, c]));
  const chapters = input.map((c) => {
    const prev = byId.get(c.chapterId);
    return {
      chapterId: c.chapterId || crypto.randomUUID(),
      title: requireText(c.title, 'Chapter title', 200),
      introduction: String(c.introduction ?? (prev && prev.introduction) ?? '').trim().slice(0, INTRODUCTION_MAX),
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
    styleIds: p.styleIds || [],
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
    const template = store.templates.find(req.user, templateId);
    if (!template) throw bad(`Unknown template "${templateId}"`);
    if ((template.type || 'video') !== 'video') throw bad('Projects can only use video templates');

    const project = {
      projectId: String(body.projectId || '').trim() || crypto.randomUUID(),
      name: requireText(body.name, 'Project name', 120),
      templateId,
      background: String(body.background || '').trim().slice(0, BACKGROUND_MAX),
      styleIds: cleanStyleIds(req.user, body.styleIds),
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
      const template = store.templates.find(req.user, templateId);
      if (!template) throw bad(`Unknown template "${templateId}"`);
      if ((template.type || 'video') !== 'video') throw bad('Projects can only use video templates');
      patch.templateId = templateId;
    }
    if (body.background !== undefined) {
      patch.background = String(body.background || '').trim().slice(0, BACKGROUND_MAX);
    }
    if (body.styleIds !== undefined) patch.styleIds = cleanStyleIds(req.user, body.styleIds);
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
      project: {
        projectId: project.projectId,
        name: project.name,
        templateId: project.templateId,
        background: project.background,
        styleIds: project.styleIds || [],
      },
    });
  })
);

router.put(
  '/:projectId/chapters/:chapterId',
  asyncRoute(async (req, res) => {
    const { project, chapter } = locate(req.user, req.params.projectId, req.params.chapterId);
    const previousBackground = chapterBackground(project, chapter);
    chapter.introduction = String((req.body || {}).introduction || '').trim().slice(0, INTRODUCTION_MAX);
    const nextBackground = chapterBackground(project, chapter);
    chapter.shots.forEach((shot) => {
      const legacyAuto = shot.promptBackgroundAuto === undefined &&
        (!shot.promptBackground || shot.promptBackground === previousBackground);
      if (!shot.merged && (shot.promptBackgroundAuto === true || legacyAuto)) {
        shot.promptBackground = nextBackground;
        shot.promptBackgroundAuto = true;
        shot.prompt = promptOf(shot);
      }
    });
    persist(req.user, project);
    res.json({ chapter });
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
      promptBackground: chapterBackground(project, chapter),
      promptBackgroundAuto: true,
      promptStoryboard: STORYBOARD_DEFAULT,
      promptNegative: NEGATIVE_DEFAULT,
      prompt: '',
      disabled: false,
      merged: false,
      ...defaults(),
      job: shotjobs.emptyJob(),
    };
    shot.prompt = promptOf(shot);
    chapter.shots.push(shot);
    renumber(chapter.shots);
    persist(req.user, project);
    res.json({ shot });
  })
);

router.post(
  '/:projectId/chapters/:chapterId/shots/merge',
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const { project, chapter } = locate(req.user, req.params.projectId, req.params.chapterId);
    const shotIds = Array.isArray(body.shotIds) ? body.shotIds.map(String) : [];
    if (shotIds.length < 2 || new Set(shotIds).size !== shotIds.length) {
      throw bad('请选择至少两个不同的镜头进行合成');
    }
    const byId = new Map(chapter.shots.map((shot) => [shot.shotId, shot]));
    const existing = body.targetShotId ? byId.get(String(body.targetShotId)) : null;
    if (body.targetShotId && (!existing || !existing.merged)) throw bad('合成镜头不存在');
    if (existing && shotIds.includes(existing.shotId)) throw bad('合成镜头不能包含自身');
    const sourceShots = shotIds.map((id) => byId.get(id));
    if (sourceShots.some((shot) => !shot)) throw bad('选择的镜头不存在');
    const sources = sourceShots.map((shot) => ({ shot, job: shotjobs.normalize(shot.job) }));
    const unavailable = sources.find(({ job }) => job.status !== shotjobs.COMPLETED || !job.file);
    if (unavailable) throw bad(`镜头「${unavailable.shot.name}」尚未生成完成，无法合成`);

    const date = new Date();
    const shotId = existing ? existing.shotId : crypto.randomUUID();
    const saved = await merger.mergeVideos(sources.map(({ job }) => job.file), {
      username: req.user,
      projectId: project.projectId,
      chapterId: chapter.chapterId,
      shotId,
      date,
    });
    const merged = existing || {
      shotId,
      name: `merge_${archive.stamp(date)}_${sources.length}`,
      remark: `由 ${sources.length} 个镜头按顺序合成`,
      firstFrame: '',
      lastFrame: '',
      prompt: '',
      width: sources[0].shot.width,
      height: sources[0].shot.height,
      disabled: false,
      merged: true,
    };
    const previousFile = existing && existing.job && existing.job.file;
    Object.assign(merged, {
      sourceShotIds: shotIds,
      mergedSourceShotIds: shotIds,
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
    });

    if (!existing) chapter.shots.push(merged);
    refreshMergeLocks(chapter.shots);
    renumber(chapter.shots);
    try {
      persist(req.user, project);
    } catch (err) {
      await archive.remove(saved.file);
      throw err;
    }
    if (previousFile && previousFile !== saved.file) await archive.remove(previousFile);
    res.json({ shot: merged, shots: chapter.shots });
  })
);

router.post(
  '/:projectId/chapters/:chapterId/shots/:shotId/unmerge',
  asyncRoute(async (req, res) => {
    const { project, chapter } = locate(req.user, req.params.projectId, req.params.chapterId);
    const idx = chapter.shots.findIndex((shot) => shot.shotId === req.params.shotId);
    if (idx === -1 || !chapter.shots[idx].merged) throw bad('合成镜头不存在', 404);
    const merged = chapter.shots[idx];
    const parent = chapter.shots.find(
      (shot) => shot.merged && shot.shotId !== merged.shotId && (shot.sourceShotIds || []).includes(merged.shotId)
    );
    if (parent) throw bad(`该合成镜头正在被「${parent.name}」使用，请先解除上层合成`);
    chapter.shots.splice(idx, 1);
    refreshMergeLocks(chapter.shots);
    renumber(chapter.shots);
    persist(req.user, project);
    await archive.remove(merged.job && merged.job.file);
    res.json({ ok: true, shots: chapter.shots, restoredShotIds: merged.sourceShotIds || [] });
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

const SHOT_FIELDS = [
  'name', 'remark', 'firstFrame', 'lastFrame', 'promptBackground', 'promptStoryboard', 'promptNegative',
  'width', 'height', 'duration',
];

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
      else shot[field] = String(body[field] || '');
    }
    if (!shot.merged && body.promptBackground !== undefined) {
      shot.promptBackgroundAuto = shot.promptBackground === chapterBackground(project, chapter);
    }
    if (shot.merged && body.sourceShotIds !== undefined) {
      const sourceShotIds = Array.isArray(body.sourceShotIds) ? body.sourceShotIds.map(String) : [];
      const previous = shot.sourceShotIds || [];
      if (sourceShotIds.length !== previous.length || new Set(sourceShotIds).size !== previous.length ||
        previous.some((id) => !sourceShotIds.includes(id))) throw bad('原镜头列表只能调整顺序');
      shot.sourceShotIds = sourceShotIds;
    }
    if (!shot.merged) shot.prompt = promptOf(shot);
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
    const removed = chapter.shots[idx];
    if (chapter.shots.some((item) => item.merged && (item.sourceShotIds || []).includes(removed.shotId))) {
      throw bad('该镜头已被合成镜头引用，不能删除');
    }
    chapter.shots.splice(idx, 1);
    refreshMergeLocks(chapter.shots);
    renumber(chapter.shots);
    persist(req.user, project);
    await archive.remove(removed.job && removed.job.file);
    res.json({ ok: true });
  })
);

module.exports = { router, locate, persist, promptOf, refreshMergeLocks };
