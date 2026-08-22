'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');
const archive = require('./archive');

const bundledFfmpeg = require('ffmpeg-static');
const ffmpegPath = config.ffmpegPath === 'ffmpeg' && bundledFfmpeg ? bundledFfmpeg : config.ffmpegPath;

function quoteConcatPath(file) {
  return file.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8000);
    });
    child.on('error', (err) => reject(new Error(`无法启动 ffmpeg：${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 合成失败（退出码 ${code}）：${stderr.trim() || '未知错误'}`));
    });
  });
}

async function mergeVideos(files, { username, projectId, chapterId, shotId, date = new Date() }) {
  if (!Array.isArray(files) || files.length < 2) throw new Error('至少需要两个已完成镜头才能合成');
  const sources = files.map((file) => archive.resolveRelative(file));
  const dir = archive.chapterDir(username, projectId, chapterId);
  await fsp.mkdir(dir, { recursive: true });
  const target = path.join(dir, archive.buildName(shotId, '.mp4', date));
  const listFile = path.join(dir, `.merge_${process.pid}_${Date.now()}.txt`);
  await fsp.writeFile(listFile, sources.map((file) => `file '${quoteConcatPath(file)}'`).join('\n'), 'utf8');

  try {
    await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', target]);
  } catch (err) {
    await fsp.rm(target, { force: true }).catch(() => {});
    throw err;
  } finally {
    await fsp.rm(listFile, { force: true }).catch(() => {});
  }

  const relative = archive.toRelative(target);
  return { file: relative, videoUrl: archive.videoUrlFor(relative), bytes: archive.sizeOf(relative) };
}

module.exports = { mergeVideos };
