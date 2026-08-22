'use strict';

/**
 * Keeps the `job` object stored on each shot in step with ComfyUI.
 *
 * The chapter page needs every shot's task id and progress at once (the list
 * colours its sequence badge from it), so this module refreshes a whole chapter
 * in one pass and archives any freshly finished video on the way through.
 */

const jobs = require('./jobs');
const comfy = require('./comfy');
const archive = require('./archive');

/** Shot job states used by the UI. */
const PENDING = 'pending'; // never generated
const QUEUED = 'queued';
const RUNNING = 'running';
const COMPLETED = 'completed';
const FAILED = 'failed';
const CANCELLED = 'cancelled';

const TERMINAL = new Set([COMPLETED, FAILED, CANCELLED]);
const isTerminal = (status) => TERMINAL.has(status);

/** The shape persisted on a shot; also what the chapter page renders. */
function emptyJob() {
  return {
    promptId: null,
    status: PENDING,
    progress: 0,
    step: null,
    totalSteps: null,
    message: '',
    error: null,
    queuedAt: null,
    finishedAt: null,
    file: null, // archive-relative path
    videoUrl: null,
    bytes: 0,
  };
}

function normalize(job) {
  const base = emptyJob();
  if (!job || typeof job !== 'object') return base;
  const merged = { ...base, ...job };
  // A shot that was archived but whose file has since been deleted must not keep
  // advertising a preview link the player would 404 on.
  if (merged.file && !archive.exists(merged.file)) {
    merged.file = null;
    merged.videoUrl = null;
    merged.bytes = 0;
    if (merged.status === COMPLETED) merged.status = merged.promptId ? FAILED : PENDING;
    if (merged.status === FAILED && !merged.error) merged.error = '本地视频文件已丢失，请重新生成';
  }
  if (merged.file && !merged.videoUrl) merged.videoUrl = archive.videoUrlFor(merged.file);
  return merged;
}

/** Mark a shot as freshly queued. */
function queued(promptId) {
  return {
    ...emptyJob(),
    promptId,
    status: QUEUED,
    message: '已提交，排队中',
    queuedAt: new Date().toISOString(),
  };
}

const STATUS_TEXT = {
  queued: '排队中',
  running: '生成中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

/**
 * Merge a live job record (from jobs.js) into the persisted shot job, archiving
 * the video the first time the render completes.
 * Returns true when anything changed and the project needs re-saving.
 */
async function applyLive(shot, live, ctx) {
  const before = JSON.stringify(shot.job);
  const cur = normalize(shot.job);

  cur.promptId = live.promptId || cur.promptId;
  cur.status = live.status || cur.status;
  cur.progress = typeof live.progress === 'number' ? live.progress : cur.progress;
  cur.step = live.step != null ? live.step : cur.step;
  cur.totalSteps = live.totalSteps != null ? live.totalSteps : cur.totalSteps;
  cur.message = live.message || STATUS_TEXT[cur.status] || cur.message;
  cur.error = live.error || (live.status === FAILED ? cur.error : null);
  if (isTerminal(cur.status) && !cur.finishedAt) cur.finishedAt = new Date().toISOString();

  if (cur.status === COMPLETED) {
    cur.progress = 1;
    // Archive once: a shot that already points at an existing file is done.
    if (!cur.file) {
      const video = (live.videos || []).find((v) => v.kind === 'video') || (live.videos || [])[0];
      if (video) {
        try {
          const saved = await archive.saveFromComfy(video, ctx);
          if (saved) Object.assign(cur, saved);
        } catch (err) {
          cur.status = FAILED;
          cur.error = `视频保存失败：${err.message}`;
          cur.message = cur.error;
        }
      } else {
        cur.status = FAILED;
        cur.error = '工作流执行完成，但没有产出视频';
        cur.message = cur.error;
      }
    }
  }

  shot.job = cur;
  return JSON.stringify(shot.job) !== before;
}

/** Refresh one shot from ComfyUI. Returns true when the stored job changed. */
async function refreshShot(shot, ctx) {
  const cur = normalize(shot.job);
  // Nothing to ask ComfyUI about: never generated, or already finished+archived.
  if (!cur.promptId || (cur.status === COMPLETED && cur.file) || cur.status === CANCELLED) {
    const changed = JSON.stringify(cur) !== JSON.stringify(shot.job);
    shot.job = cur;
    return changed;
  }

  let live = await jobs.refresh(cur.promptId).catch(() => null);
  if (!live) {
    // Server restarted: rebuild the job from ComfyUI's own history.
    const history = await comfy.getHistory(cur.promptId).catch(() => null);
    if (!history) {
      // ComfyUI forgot the prompt. An in-flight job is now unrecoverable.
      if (cur.status === QUEUED || cur.status === RUNNING) {
        shot.job = { ...cur, status: FAILED, error: 'ComfyUI 已不再持有该任务，请重新生成', message: '任务丢失' };
        return true;
      }
      shot.job = cur;
      return false;
    }
    live = jobs.applyHistory(jobs.newJob(cur.promptId, {}, null), history);
  }

  return applyLive(shot, live, { ...ctx, shotId: shot.shotId });
}

/** Refresh every shot in a chapter. Returns true when anything changed. */
async function refreshChapter(chapter, ctx) {
  const results = await Promise.all(
    (chapter.shots || []).map((shot) => refreshShot(shot, ctx).catch(() => false))
  );
  return results.some(Boolean);
}

module.exports = {
  PENDING,
  QUEUED,
  RUNNING,
  COMPLETED,
  FAILED,
  CANCELLED,
  STATUS_TEXT,
  emptyJob,
  normalize,
  queued,
  isTerminal,
  refreshShot,
  refreshChapter,
};
