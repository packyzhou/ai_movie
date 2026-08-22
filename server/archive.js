'use strict';

/**
 * Local archive for rendered videos.
 *
 * Layout (as specified):
 *   <outputDir>/<username>_<projectId>/<chapterId>/<shotId>_<YYYYMMDDHHmmss>.mp4
 *
 * ComfyUI keeps its own output folder, but it is volatile (users clear it, and a
 * remote ComfyUI is not on this box at all). Copying the finished video here is
 * what makes "click a completed shot to preview" survive restarts, and it gives
 * ffmpeg real files to concatenate when merging a chapter.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const config = require('./config');
const comfy = require('./comfy');

// Ids come from crypto.randomUUID() but shots/projects can be hand-edited in the
// JSON store, so every segment is sanitised before it reaches the filesystem.
const SAFE_RE = /[^A-Za-z0-9_.-]+/g;

function safeSegment(value, fallback = 'unknown') {
  const cleaned = String(value == null ? '' : value)
    .replace(SAFE_RE, '_')
    .replace(/^\.+/, '_')
    .slice(0, 100);
  return cleaned || fallback;
}

/** Local timestamp in YYYYMMDDHHmmss, matching the requested filename format. */
function stamp(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

/** <outputDir>/<username>_<projectId>/<chapterId> */
function chapterDir(username, projectId, chapterId) {
  return path.join(
    config.outputDir,
    `${safeSegment(username, 'user')}_${safeSegment(projectId, 'project')}`,
    safeSegment(chapterId, 'chapter')
  );
}

function buildName(shotId, ext = '.mp4', date = new Date()) {
  return `${safeSegment(shotId, 'shot')}_${stamp(date)}${ext}`;
}

/**
 * Relative POSIX path used as the stored handle on a shot. Keeping it relative
 * (rather than absolute) means the data files stay portable between machines.
 */
function toRelative(absolute) {
  return path.relative(config.outputDir, absolute).split(path.sep).join('/');
}

/** Resolve a stored handle back to an absolute path, refusing directory escapes. */
function resolveRelative(relative) {
  const rel = String(relative || '').replace(/\\/g, '/');
  if (!rel || rel.split('/').includes('..')) throw new Error('Invalid video path');
  const abs = path.resolve(config.outputDir, rel);
  const root = path.resolve(config.outputDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Invalid video path');
  return abs;
}

const videoUrlFor = (relative) => `/api/videos?file=${encodeURIComponent(relative)}`;

function exists(relative) {
  if (!relative) return false;
  try {
    return fs.existsSync(resolveRelative(relative));
  } catch (_) {
    return false;
  }
}

function sizeOf(relative) {
  try {
    return fs.statSync(resolveRelative(relative)).size;
  } catch (_) {
    return 0;
  }
}

/**
 * Pull a finished video out of ComfyUI and write it under the archive.
 * `descriptor` is one of jobs.collectOutputs()'s entries.
 * Returns { file, url, bytes } or null when nothing usable came back.
 */
async function saveFromComfy(descriptor, { username, projectId, chapterId, shotId }) {
  if (!descriptor || !descriptor.filename) return null;

  const dir = chapterDir(username, projectId, chapterId);
  await fsp.mkdir(dir, { recursive: true });

  const ext = path.extname(descriptor.filename) || '.mp4';
  const target = path.join(dir, buildName(shotId, ext));

  const upstream = await comfy.viewStream({
    filename: descriptor.filename,
    subfolder: descriptor.subfolder || '',
    type: descriptor.type || 'output',
  });
  if (upstream.status >= 400) throw new Error(`ComfyUI /view returned ${upstream.status}`);

  // Stream to a temp file then rename, so a half-written mp4 is never picked up
  // as a valid archived result by the chapter page or by ffmpeg.
  const tmp = `${target}.part`;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    upstream.data.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    upstream.data.pipe(out);
  }).catch(async (err) => {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  });

  await fsp.rename(tmp, target);
  const relative = toRelative(target);
  return { file: relative, url: videoUrlFor(relative), bytes: sizeOf(relative) };
}

/** Best-effort delete of an archived file - a missing file is not an error. */
async function remove(relative) {
  if (!relative) return false;
  try {
    await fsp.rm(resolveRelative(relative), { force: true });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  chapterDir,
  buildName,
  stamp,
  safeSegment,
  toRelative,
  resolveRelative,
  videoUrlFor,
  exists,
  sizeOf,
  saveFromComfy,
  remove,
};
