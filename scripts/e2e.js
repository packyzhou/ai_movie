'use strict';

/**
 * End-to-end smoke test against a running server (default :3100 + mock ComfyUI).
 *   node scripts/e2e.js
 * Exercises login, template CRUD, project CRUD, chapters, shots and generation.
 */

const axios = require('axios');

const BASE = process.env.BASE || 'http://127.0.0.1:3100';
const jar = [];

const http = axios.create({
  baseURL: BASE,
  validateStatus: () => true,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((cfg) => {
  if (jar.length) cfg.headers.Cookie = jar.join('; ');
  return cfg;
});
http.interceptors.response.use((res) => {
  const set = res.headers['set-cookie'];
  if (set) for (const c of set) jar.push(c.split(';')[0]);
  return res;
});

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`E2E against ${BASE}\n`);

  console.log('auth');
  check('unauthenticated list is 401', (await http.get('/api/projects')).status === 401);
  check('bad password rejected', (await http.post('/api/login', { username: 'admin', password: 'x' })).status === 401);
  const login = await http.post('/api/login', { username: 'admin', password: 'admin123' });
  check('login succeeds', login.status === 200 && login.data.username === 'admin', login.data);

  console.log('\ntemplates');
  let list = await http.get('/api/templates?page=1&pageSize=10');
  check('builtin template seeded', list.data.total === 1, list.data);
  const builtin = list.data.items[0];
  check('builtin has all bindings', builtin.missing.length === 0, builtin.missing);
  check('binding for prompt found', !!builtin.bindings.prompt, builtin.bindings);

  const badJson = await http.post('/api/templates', { name: 'bad', content: '{not json' });
  check('invalid JSON rejected', badJson.status === 400 && /not valid JSON/.test(badJson.data.error), badJson.data);

  const noClass = await http.post('/api/templates', { name: 'bad', content: '{"1":{"inputs":{}}}' });
  check('missing class_type rejected', noClass.status === 400, noClass.data);

  const validate = await http.post('/api/templates/validate', {
    content: JSON.stringify({
      1: { class_type: 'LoadImage', inputs: { image: 'a.jpg' }, _meta: { title: 'start' } },
      2: { class_type: 'LoadImage', inputs: { image: 'b.jpg' }, _meta: { title: 'end' } },
      3: { class_type: 'Wan', inputs: { prompt: '', width: 1, height: 1 } },
      4: { class_type: 'PrimitiveFloat', inputs: { value: 5 }, _meta: { title: 'Float (duration)' } },
      5: { class_type: 'RandomNoise', inputs: { noise_seed: 1 } },
    }),
  });
  check('self-check derives all six', validate.data.missing.length === 0, validate.data);
  check('first frame -> node 1', validate.data.bindings.firstFrame.path === '1.inputs.image', validate.data.bindings);
  check('last frame -> node 2', validate.data.bindings.lastFrame.path === '2.inputs.image', validate.data.bindings);
  check('seed -> node 5', validate.data.seed.path === '5.inputs.noise_seed', validate.data.seed);

  const created = await http.post('/api/templates', {
    name: 'Wrapped example',
    remark: 'accepts {prompt:{...}} wrapper',
    content: JSON.stringify({ prompt: { 1: { class_type: 'X', inputs: { a: 1 } } } }),
  });
  check('wrapper form accepted', created.status === 200, created.data);
  const tmpId = created.data.template.templateId;
  check('partial template reports missing', created.data.missing.length === 6, created.data.missing);

  const fetched = await http.get(`/api/templates/${tmpId}`);
  check('template content round-trips', JSON.parse(fetched.data.template.content)['1'].class_type === 'X', fetched.data);

  const renamed = await http.put(`/api/templates/${tmpId}`, { name: 'Renamed', remark: 'r2' });
  check('template rename works', renamed.data.template.name === 'Renamed', renamed.data);

  console.log('\nprojects');
  const longBg = 'x'.repeat(600);
  const proj = await http.post('/api/projects', {
    name: 'Demo project',
    templateId: builtin.templateId,
    background: longBg,
    chapters: [{ title: '第一章 相遇' }, { title: '第二章 追逐' }],
  });
  check('project created', proj.status === 200, proj.data);
  const p = proj.data.project;
  check('background truncated to 500', p.background.length === 500, p.background.length);
  check('chapters numbered from 1', p.chapters[0].seq === 1 && p.chapters[1].seq === 2, p.chapters);
  check('chapter ids generated', !!p.chapters[0].chapterId, p.chapters[0]);

  const noTitle = await http.post('/api/projects', { name: 'x', templateId: builtin.templateId, chapters: [] });
  check('project needs a chapter', noTitle.status === 400, noTitle.data);

  const badTpl = await http.post('/api/projects', {
    name: 'x',
    templateId: 'nope',
    chapters: [{ title: 'a' }],
  });
  check('unknown template rejected', badTpl.status === 400, badTpl.data);

  const idLocked = await http.put(`/api/projects/${p.projectId}`, { projectId: 'hacked', name: 'Renamed project' });
  check('projectId is immutable', idLocked.data.project.projectId === p.projectId, idLocked.data.project.projectId);
  check('project rename works', idLocked.data.project.name === 'Renamed project');

  console.log('\nchapters & shots');
  const ch = p.chapters[0];
  const chRes = await http.get(`/api/projects/${p.projectId}/chapters/${ch.chapterId}`);
  check('chapter fetch works', chRes.status === 200 && chRes.data.chapter.title === '第一章 相遇', chRes.data);

  const s1 = await http.post(`/api/projects/${p.projectId}/chapters/${ch.chapterId}/shots`, { name: '镜头A', remark: 'r' });
  const s2 = await http.post(`/api/projects/${p.projectId}/chapters/${ch.chapterId}/shots`, { name: '镜头B' });
  check('shot seq auto-generates 1,2', s1.data.shot.seq === 1 && s2.data.shot.seq === 2, [s1.data.shot.seq, s2.data.shot.seq]);
  check('shot gets default size', s1.data.shot.width === 1280 && s1.data.shot.height === 704, s1.data.shot);

  const noName = await http.post(`/api/projects/${p.projectId}/chapters/${ch.chapterId}/shots`, { name: '  ' });
  check('shot name required', noName.status === 400, noName.data);

  await http.put(`/api/projects/${p.projectId}/chapters/${ch.chapterId}/shots/${s1.data.shot.shotId}`, {
    firstFrame: 'start_1.jpg',
    lastFrame: 'end_1.jpg',
    prompt: '一个男人转身面向镜头',
    width: 1280,
    height: 704,
    duration: 5,
  });

  // Deleting shot 1 must renumber shot 2 down to seq 1.
  const s3 = await http.post(`/api/projects/${p.projectId}/chapters/${ch.chapterId}/shots`, { name: '镜头C' });
  await http.delete(`/api/projects/${p.projectId}/chapters/${ch.chapterId}/shots/${s3.data.shot.shotId}`);
  const after = await http.get(`/api/projects/${p.projectId}/chapters/${ch.chapterId}`);
  check('shots renumber after delete', after.data.chapter.shots.map((s) => s.seq).join(',') === '1,2', after.data.chapter.shots);

  // Editing the project must not wipe shots already attached to a chapter.
  await http.put(`/api/projects/${p.projectId}`, {
    chapters: p.chapters.map((c) => ({ chapterId: c.chapterId, title: c.title + '!' })),
  });
  const kept = await http.get(`/api/projects/${p.projectId}/chapters/${ch.chapterId}`);
  check('project edit preserves shots', kept.data.chapter.shots.length === 2, kept.data.chapter.shots.length);
  check('chapter title updated', kept.data.chapter.title === '第一章 相遇!', kept.data.chapter.title);

  console.log('\ngeneration');
  const gen = await http.post('/api/generate', {
    projectId: p.projectId,
    chapterId: ch.chapterId,
    shotId: s1.data.shot.shotId,
  });
  check('generate queued', gen.status === 200 && !!gen.data.promptId, gen.data);

  let final = null;
  for (let i = 0; i < 25; i += 1) {
    await sleep(300);
    const st = await http.get(`/api/jobs/${gen.data.promptId}`);
    final = st.data.job;
    if (final.status === 'completed' || final.status === 'failed') break;
  }
  check('job completes', final && final.status === 'completed', final && { s: final.status, m: final.message });
  check('video returned', final && final.videos.length === 1, final && final.videos);

  const view = await http.get(final.videos[0].url, { responseType: 'arraybuffer' });
  check('video streams via proxy', view.status === 200 && view.headers['content-type'] === 'video/mp4', view.status);

  const withJob = await http.get(`/api/projects/${p.projectId}/chapters/${ch.chapterId}`);
  const shotJob = withJob.data.chapter.shots.find((s) => s.shotId === s1.data.shot.shotId).job;
  check('prompt_id saved on the shot', shotJob && shotJob.promptId === gen.data.promptId, shotJob);

  const noFrames = await http.post('/api/generate', {
    projectId: p.projectId,
    chapterId: ch.chapterId,
    shotId: s2.data.shot.shotId,
  });
  check('generate needs frames', noFrames.status === 400 && /required/i.test(noFrames.data.error), noFrames.data);

  console.log('\ndeletion guards');
  const inUse = await http.delete(`/api/templates/${builtin.templateId}`);
  check('template in use cannot be deleted', inUse.status === 400 && /used by/.test(inUse.data.error), inUse.data);

  check('unused template deletes', (await http.delete(`/api/templates/${tmpId}`)).status === 200);
  check('deleted template is gone', (await http.get(`/api/templates/${tmpId}`)).status === 404);

  console.log('\npagination');
  for (let i = 0; i < 12; i += 1) {
    await http.post('/api/projects', {
      name: `Bulk ${String(i).padStart(2, '0')}`,
      templateId: builtin.templateId,
      chapters: [{ title: 'c1' }],
    });
  }
  const pg1 = await http.get('/api/projects?page=1&pageSize=5');
  check('page size honoured', pg1.data.items.length === 5, pg1.data.items.length);
  check('total counts all', pg1.data.total === 13, pg1.data.total);
  check('pages computed', pg1.data.pages === 3, pg1.data.pages);
  const pg9 = await http.get('/api/projects?page=99&pageSize=5');
  check('out-of-range page clamps', pg9.data.page === 3, pg9.data.page);
  const search = await http.get('/api/projects?keyword=Bulk%2003');
  check('keyword search filters', search.data.total === 1, search.data.total);

  check('project deletes', (await http.delete(`/api/projects/${p.projectId}`)).status === 200);
  check('deleted project is gone', (await http.get(`/api/projects/${p.projectId}`)).status === 404);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E crashed:', err.message);
  process.exit(1);
});
