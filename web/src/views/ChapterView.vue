<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { api } from '../api';
import ImageField from '../components/ImageField.vue';
import JobStatus from '../components/JobStatus.vue';
import VideoPreview from '../components/VideoPreview.vue';
import Modal from '../components/Modal.vue';

const props = defineProps({
  projectId: { type: String, required: true },
  chapterId: { type: String, required: true },
});

const project = ref(null);
const chapter = ref(null);
const library = ref([]);
const options = ref({ limits: {}, pollIntervalMs: 1500 });

const selectedId = ref('');
const draft = reactive({
  shotId: '',
  name: '',
  remark: '',
  firstFrame: '',
  lastFrame: '',
  promptStoryboard: '',
  promptNegative: '',
  promptOverride: '',
  sourceShotIds: [],
  mergedSourceShotIds: [],
  width: 1280,
  height: 704,
  duration: 5,
});

const loading = ref(true);
const error = ref('');
const notice = ref('');
const saving = ref(false);
const generatingScript = ref(false);
const generating = ref(false);
const merging = ref(false);
const batch = reactive({ running: false, cancelling: false, cancelRequested: false, index: 0, total: 0, currentShotId: '', currentPromptId: '', currentProgress: 0, message: '' });
let batchRun = 0;
const draggingId = ref('');
const sourceDraggingId = ref('');
const mergeSelection = ref([]);
const chapterIntroduction = ref('');
const lastSavedIntroduction = ref('');
const savingChapter = ref(false);

const job = ref(null);
const cancellingPromptId = ref('');
const previewing = ref(null);
const scriptModalOpen = ref(false);
const scriptModalMode = ref('preview');
const scriptPrompt = ref('');
const optimizingPrompt = ref(false);

const addOpen = ref(false);
const addForm = reactive({ name: '', remark: '' });
const addError = ref('');

let pollTimer = null;

const shots = computed(() => (chapter.value && chapter.value.shots) || []);
const selected = computed(() => shots.value.find((s) => s.shotId === selectedId.value) || null);
const limits = computed(() => options.value.limits || {});
const active = computed(() => job.value && (job.value.status === 'queued' || job.value.status === 'running'));
const aggregatedPrompt = computed(() => draft.promptOverride ||
  [draft.promptStoryboard, draft.promptNegative]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('\n\n')
);
const mergedSources = computed(() => {
  const byId = new Map(shots.value.map((shot) => [shot.shotId, shot]));
  return (draft.sourceShotIds || []).map((id) => byId.get(id)).filter(Boolean);
});
const mergeOrderChanged = computed(() =>
  JSON.stringify(draft.sourceShotIds || []) !== JSON.stringify(draft.mergedSourceShotIds || [])
);
const selectedBatchShots = computed(() => shots.value.filter((shot) =>
  mergeSelection.value.includes(shot.shotId) && !shot.disabled && !shot.merged
));
const selectedBatchTargets = computed(() => selectedBatchShots.value.filter((shot) => stateOf(shot) !== 'running'));
const canBatchDelete = computed(() => selectedBatchShots.value.length > 0 &&
  selectedBatchShots.value.every((shot) => stateOf(shot) !== 'running'));
const canMergeSelection = computed(() => selectedBatchShots.value.length >= 2 &&
  selectedBatchShots.value.every((shot) => stateOf(shot) === 'completed' && previewOf(shot)));

// Frames are optional: without either frame the workflow runs in text-to-video mode.
const mode = computed(() => (draft.firstFrame || draft.lastFrame ? '图生视频' : '文生视频'));

function stateOf(shot) {
  const status = shot.job?.status || 'pending';
  if (status === 'queued' || status === 'running') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'pending';
}

function percentOf(shot) {
  return Math.round((shot.job?.progress || 0) * 100);
}

function previewOf(shot) {
  if (!shot.job?.videoUrl) return null;
  return { url: shot.job.videoUrl, filename: (shot.job.file || shot.name).split('/').pop() };
}

const STORYBOARD_PLACEHOLDER = `要求：\n人物造型必须全程保持一致：所有画面中的人物必须严格锁定为图1（背面）与图2（正面）中的同一人。完全光头，无头发，胡须形状、密度、颜色完全一致；肤色、眼睛颜色、眉毛、面部轮廓完全一致；服装款式、颜色、褶皱完全一致。从背面、侧面、四分之三侧脸到正面，任何转身中间角度都不得出现五官变形、身份漂移或造型差异。\n\n场景描述：\n在广州塔下\n\n剧情：\n[0-2秒] 镜头一：图1局长面向镜头，说了一句“i will kill you”，然后从后面拿出一把枪对准镜头\n[2-3秒] 镜头二：开出一枪，子弹慢动作射向外星人，外星人在镜头后面，此时镜头需要转向\n[3-5秒]镜头三：子弹命中外星人额头，外星人倒地\n\n镜头：\n镜头聚焦图1人物，然后拉近枪口，人物高度过渡平滑。变形宽银幕镜头，浅景深，焦点始终保持在人物身上；镜头二慢动作，镜头顺着子弹方向移动；镜头三速度恢复正常\n\n音频：\n对白：“i will kill you“英语语速正常，背景音乐带压抑恐怖气氛\n\n字幕：\n字幕仅在人物说话时出现，约从0.5-2秒，中英双语字幕：中文在上，英文在下，居中位于画面下方三分之一处。中文：“我会杀了你”，英文：““i will kill you”，净电影级无衬线字体，无背景框，细描边保证可读性。除指定字幕外，画面无其他文字、标志或水印。

`;
const NEGATIVE_PLACEHOLDER = '否定约束：\n无动画、卡通或过度CG感，保持实拍质感。无其他人、无复制人、无变形、无畸变。';

const PRESETS = [
  { label: '16:9 · 1280×704', width: 1280, height: 704 },
  { label: '16:9 · 1920×1088', width: 1920, height: 1088 },
  { label: '9:16 · 704×1280', width: 704, height: 1280 },
  { label: '1:1 · 960×960', width: 960, height: 960 },
];

function loadDraft(shot) {
  Object.assign(draft, {
    shotId: shot.shotId,
    name: shot.name,
    remark: shot.remark || '',
    firstFrame: shot.firstFrame || '',
    lastFrame: shot.lastFrame || '',
    promptStoryboard: shot.promptStoryboard || STORYBOARD_PLACEHOLDER,
    promptNegative: shot.promptNegative || NEGATIVE_PLACEHOLDER,
    promptOverride: shot.promptOverride || '',
    sourceShotIds: [...(shot.sourceShotIds || [])],
    mergedSourceShotIds: [...(shot.mergedSourceShotIds || shot.sourceShotIds || [])],
    width: shot.width,
    height: shot.height,
    duration: shot.duration,
  });
}

function select(shot) {
  stopPolling();
  selectedId.value = shot.shotId;
  loadDraft(shot);
  job.value = shot.job || null;
  if (stateOf(shot) === 'running') startPolling();
}

async function refreshLibrary() {
  const assets = await api.assets({
    page: 1,
    pageSize: 100,
    type: 'image',
    styles: (project.value?.styleIds || []).join(','),
  });
  library.value = assets.items.flatMap((asset) =>
    (asset.resources || [])
      .filter((resource) => resource.kind === 'image')
      .map((resource, index) => ({
        key: `${asset.assetId}-${index}`,
        name: resource.name || `${asset.name}-${index + 1}.png`,
        url: resource.path,
        needsImport: true,
      }))
  );
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [res, opts] = await Promise.all([api.chapter(props.projectId, props.chapterId), api.options()]);
    chapter.value = res.chapter;
    project.value = res.project;
    chapterIntroduction.value = res.chapter.introduction || '';
    lastSavedIntroduction.value = chapterIntroduction.value;
    options.value = opts;
    document.title = `${res.chapter.title} · ${res.project.name}`;
    await refreshLibrary();
    if (shots.value.length) select(shots.value[0]);
    if (shots.value.some((shot) => stateOf(shot) === 'running')) startPolling();
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function saveChapter() {
  if (chapterIntroduction.value === lastSavedIntroduction.value) return true;
  savingChapter.value = true;
  error.value = '';
  try {
    const { chapter: saved } = await api.updateChapter(props.projectId, props.chapterId, {
      introduction: chapterIntroduction.value,
    });
    chapter.value = saved;
    chapterIntroduction.value = saved.introduction || '';
    lastSavedIntroduction.value = chapterIntroduction.value;
    notice.value = '章节介绍已自动保存';
    setTimeout(() => (notice.value = ''), 2000);
    return true;
  } catch (err) {
    error.value = err.message;
    return false;
  } finally {
    savingChapter.value = false;
  }
}

async function generateScript() {
  if (generatingScript.value) return;
  error.value = '';
  if (!chapterIntroduction.value.trim()) {
    error.value = '请先填写章节介绍';
    return;
  }
  if (shots.value.length && !confirm('当前章节已有镜头，继续生成会追加新的镜头，是否继续？')) return;
  if (!(await saveChapter())) return;

  generatingScript.value = true;
  try {
    const { shots: generatedShots } = await api.generateScript({
      chapterName: chapter.value.title,
      chapterIntroduction: chapterIntroduction.value,
      projectBackground: project.value?.background || '',
    });
    if (!generatedShots.length) throw new Error('AI未生成有效镜头');
    const createdShots = [];
    for (const generated of generatedShots) {
      const { shot } = await api.createShot(props.projectId, props.chapterId, generated);
      createdShots.push(shot);
    }
    chapter.value.shots.push(...createdShots);
    notice.value = `已生成并添加 ${createdShots.length} 个镜头`;
    setTimeout(() => (notice.value = ''), 3000);
    if (createdShots.length) select(createdShots[0]);
  } catch (err) {
    error.value = err.message;
  } finally {
    generatingScript.value = false;
  }
}

async function addShot() {
  addError.value = '';
  if (!addForm.name.trim()) {
    addError.value = '请输入镜头名称';
    return;
  }
  if (!(await saveChapter())) {
    addError.value = '章节介绍保存失败，暂时无法添加镜头';
    return;
  }
  try {
    const { shot } = await api.createShot(props.projectId, props.chapterId, addForm);
    chapter.value.shots.push(shot);
    addOpen.value = false;
    addForm.name = '';
    addForm.remark = '';
    select(shot);
  } catch (err) {
    addError.value = err.message;
  }
}

async function removeShot(shot) {
  if (!confirm(`删除镜头「${shot.seq}. ${shot.name}」？`)) return;
  try {
    await api.deleteShot(props.projectId, props.chapterId, shot.shotId);
    const res = await api.chapter(props.projectId, props.chapterId);
    chapter.value = res.chapter;
    if (selectedId.value === shot.shotId) {
      stopPolling();
      job.value = null;
      selectedId.value = '';
      if (shots.value.length) select(shots.value[0]);
    }
  } catch (err) {
    error.value = err.message;
  }
}

async function removeSelectedShots() {
  if (!canBatchDelete.value || batch.running || merging.value) return;
  const targets = [...selectedBatchShots.value];
  if (!confirm(`确认删除选中的 ${targets.length} 个镜头？该操作不可撤销。`)) return;
  error.value = '';
  try {
    for (const shot of targets) {
      await api.deleteShot(props.projectId, props.chapterId, shot.shotId);
    }
    mergeSelection.value = mergeSelection.value.filter((id) => !targets.some((shot) => shot.shotId === id));
    if (targets.some((shot) => shot.shotId === selectedId.value)) {
      stopPolling();
      selectedId.value = '';
      job.value = null;
    }
    await load();
    notice.value = `已删除 ${targets.length} 个镜头`;
    setTimeout(() => (notice.value = ''), 3000);
  } catch (err) {
    error.value = err.message;
    await load();
  }
}

async function save() {
  if (!selected.value) return null;
  saving.value = true;
  error.value = '';
  try {
    const payload = selected.value.merged
      ? { name: draft.name, remark: draft.remark, sourceShotIds: draft.sourceShotIds }
      : {
          name: draft.name,
          remark: draft.remark,
          firstFrame: draft.firstFrame,
          lastFrame: draft.lastFrame,
          promptStoryboard: draft.promptStoryboard,
          promptNegative: draft.promptNegative,
          promptOverride: draft.promptOverride,
          width: draft.width,
          height: draft.height,
          duration: draft.duration,
        };
    const { shot } = await api.updateShot(props.projectId, props.chapterId, draft.shotId, payload);
    const idx = shots.value.findIndex((s) => s.shotId === shot.shotId);
    if (idx >= 0) chapter.value.shots[idx] = shot;
    notice.value = '已保存';
    setTimeout(() => (notice.value = ''), 2000);
    return shot;
  } catch (err) {
    error.value = err.message;
    return null;
  } finally {
    saving.value = false;
  }
}

function openScriptPreview() {
  scriptModalMode.value = 'preview';
  scriptPrompt.value = aggregatedPrompt.value;
  scriptModalOpen.value = true;
}

function requestGenerate() {
  scriptModalMode.value = 'generate';
  scriptPrompt.value = aggregatedPrompt.value;
  scriptModalOpen.value = true;
}

async function optimizePrompt() {
  if (optimizingPrompt.value || !scriptPrompt.value.trim()) return;
  optimizingPrompt.value = true;
  error.value = '';
  try {
    const result = await api.optimizePrompt(scriptPrompt.value);
    scriptPrompt.value = result.prompt;
  } catch (err) {
    error.value = err.message;
  } finally {
    optimizingPrompt.value = false;
  }
}

function applyScriptPrompt() {
  draft.promptOverride = scriptPrompt.value.trim();
}

function confirmScriptPreview() {
  applyScriptPrompt();
  scriptModalOpen.value = false;
}

async function confirmGenerate() {
  applyScriptPrompt();
  scriptModalOpen.value = false;
  await generate();
}

async function generate() {
  error.value = '';
  // Persist first so the server queues exactly what is on screen.
  if (!(await save())) return;
  generating.value = true;
  try {
    const res = await api.generate({
      projectId: props.projectId,
      chapterId: props.chapterId,
      shotId: draft.shotId,
    });
    job.value = res.job;
    const idx = shots.value.findIndex((shot) => shot.shotId === res.shot.shotId);
    if (idx >= 0) chapter.value.shots[idx] = res.shot;
    startPolling();
  } catch (err) {
    error.value = err.message;
  } finally {
    generating.value = false;
  }
}

async function waitForBatchShot(shotId, runId) {
  while (runId === batchRun) {
    const res = await api.chapter(props.projectId, props.chapterId);
    chapter.value = res.chapter;
    const current = shots.value.find((shot) => shot.shotId === shotId);
    if (!current) throw new Error('镜头不存在');
    if (current.shotId === selectedId.value) job.value = current.job || null;
    batch.currentProgress = percentOf(current);
    if (stateOf(current) === 'completed') return current;
    if (stateOf(current) === 'failed') return null;
    await new Promise((resolve) => setTimeout(resolve, options.value.pollIntervalMs || 1500));
  }
  return null;
}

async function cancelBatch() {
  if (!batch.running || batch.cancelling) return;
  batch.cancelling = true;
  batch.cancelRequested = true;
  try {
    await api.cancel(batch.currentPromptId || 'active');
  } catch (err) {
    error.value = err.message;
  } finally {
    batch.cancelling = false;
  }
}

async function generateBatch() {
  if (batch.running || generating.value || merging.value) return;
  error.value = '';
  if (!(await save())) return;
  const targets = selectedBatchTargets.value;
  if (!selectedBatchShots.value.length) {
    error.value = '请先在镜头列表中选择要生成的镜头';
    return;
  }
  if (targets.length < 2) {
    error.value = '至少需要选择两个未在生成中的镜头';
    return;
  }
  if (!confirm(`将按顺序生成 ${targets.length} 个镜头，并在全部成功后自动合成，是否继续？`)) return;

  stopPolling();
  batchRun += 1;
  const runId = batchRun;
  Object.assign(batch, {
    running: true, cancelling: false, cancelRequested: false, index: 0, total: targets.length,
    currentShotId: '', currentPromptId: '', currentProgress: 0, message: '准备开始',
  });
  const successful = [];
  try {
    for (const [index, target] of targets.entries()) {
      if (runId !== batchRun || batch.cancelRequested) break;
      batch.index = index + 1;
      batch.currentShotId = target.shotId;
      batch.currentPromptId = '';
      batch.currentProgress = 0;
      batch.message = `正在生成：${target.name}（${index + 1}/${targets.length}）`;
      const res = await api.generate({ projectId: props.projectId, chapterId: props.chapterId, shotId: target.shotId });
      batch.currentPromptId = res.promptId;
      const shotIndex = shots.value.findIndex((shot) => shot.shotId === target.shotId);
      if (shotIndex >= 0) chapter.value.shots[shotIndex] = res.shot;
      const completed = await waitForBatchShot(target.shotId, runId);
      if (!completed) {
        if (!batch.cancelRequested) error.value = `镜头「${target.name}」生成失败，批量任务已停止`;
        break;
      }
      successful.push(completed);
    }
    if (runId === batchRun && !batch.cancelRequested && successful.length === targets.length) {
      batch.message = '所有镜头生成完成，正在自动合成…';
      await mergeShots(null, false, successful);
    } else if (batch.cancelRequested) {
      batch.message = '批量生成已中断';
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    if (runId === batchRun) {
      batch.running = false;
      batch.currentPromptId = '';
      if (shots.value.some((shot) => stateOf(shot) === 'running')) startPolling();
    }
  }
}

function startPolling() {
  stopPolling();
  const tick = async () => {
    try {
      const res = await api.chapter(props.projectId, props.chapterId);
      chapter.value = res.chapter;
      const current = shots.value.find((shot) => shot.shotId === selectedId.value);
      job.value = current?.job || null;
      if (!shots.value.some((shot) => stateOf(shot) === 'running')) {
        stopPolling();
        return;
      }
    } catch (_) {
      stopPolling();
      return;
    }
    pollTimer = setTimeout(tick, options.value.pollIntervalMs || 1500);
  };
  pollTimer = setTimeout(tick, 500);
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

function dragStart(shot, event) {
  draggingId.value = shot.shotId;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', shot.shotId);
}

async function dropOn(target) {
  const sourceId = draggingId.value;
  draggingId.value = '';
  if (!sourceId || sourceId === target.shotId) return;
  const ordered = [...shots.value];
  const from = ordered.findIndex((shot) => shot.shotId === sourceId);
  const to = ordered.findIndex((shot) => shot.shotId === target.shotId);
  if (from < 0 || to < 0) return;
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  chapter.value.shots = ordered.map((shot, index) => ({ ...shot, seq: index + 1 }));
  try {
    const res = await api.reorderShots(props.projectId, props.chapterId, ordered.map((shot) => shot.shotId));
    chapter.value.shots = res.shots;
  } catch (err) {
    error.value = err.message;
    await load();
  }
}

async function mergeShots(targetShot = null, shouldConfirm = true, sourceShots = null) {
  const shotIds = sourceShots
    ? sourceShots.map((shot) => shot.shotId)
    : targetShot
      ? [...draft.sourceShotIds]
      : shots.value.filter((shot) => mergeSelection.value.includes(shot.shotId)).map((shot) => shot.shotId);
  if (shotIds.length < 2) {
    error.value = '请先从镜头列表选择至少两个已完成镜头';
    return;
  }
  if (shouldConfirm && !confirm(`确认按当前顺序合成选中的 ${shotIds.length} 个镜头？原镜头将保留并置灰。`)) return;
  merging.value = true;
  error.value = '';
  stopPolling();
  try {
    const { shot, shots: updated } = await api.mergeShots(props.projectId, props.chapterId, {
      shotIds,
      targetShotId: targetShot?.shotId,
    });
    chapter.value.shots = updated;
    mergeSelection.value = [];
    select(shot);
    previewing.value = previewOf(shot);
  } catch (err) {
    error.value = err.message;
  } finally {
    merging.value = false;
  }
}

async function unmergeShot(shot) {
  if (!confirm(`解除合成镜头「${shot.name}」？本次合成视频将被删除，直接原镜头会恢复。`)) return;
  error.value = '';
  try {
    const sourceShotIds = [...(shot.sourceShotIds || [])];
    const { shots: updated } = await api.unmergeShot(props.projectId, props.chapterId, shot.shotId);
    chapter.value.shots = updated;
    selectedId.value = '';
    job.value = null;
    const restored = updated.find((item) => sourceShotIds.includes(item.shotId) && !item.disabled);
    if (restored) select(restored);
    else if (updated.length) select(updated[0]);
  } catch (err) {
    error.value = err.message;
  }
}

function toggleMergeSelection(shotId) {
  mergeSelection.value = mergeSelection.value.includes(shotId)
    ? mergeSelection.value.filter((id) => id !== shotId)
    : [...mergeSelection.value, shotId];
}

function sourceDragStart(shotId, event) {
  sourceDraggingId.value = shotId;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', shotId);
}

function dropSource(targetId) {
  const sourceId = sourceDraggingId.value;
  sourceDraggingId.value = '';
  if (!sourceId || sourceId === targetId) return;
  const order = [...draft.sourceShotIds];
  const from = order.indexOf(sourceId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0) return;
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  draft.sourceShotIds = order;
}

async function cancel(promptId) {
  if (!promptId || cancellingPromptId.value === promptId) return;
  cancellingPromptId.value = promptId;
  error.value = '';
  try {
    await api.cancel(promptId);
  } catch (err) {
    cancellingPromptId.value = '';
    error.value = err.message;
  }
}

watch(() => [props.projectId, props.chapterId], load);
onMounted(load);
onUnmounted(stopPolling);
</script>

<template>
  <div class="chapter-page">
    <!-- top: chapter name -->
    <header class="topbar">
      <div class="titles">
        <h1>{{ chapter ? chapter.title : '载入中…' }}</h1>
        <span v-if="project" class="muted">{{ project.name }}</span>
      </div>
      <div class="right">
        <span v-if="notice" class="badge completed">{{ notice }}</span>
        <a class="link" :href="`/console/projects`" target="_self">返回项目列表</a>
      </div>
    </header>

    <p v-if="error" class="error page-error">{{ error }}</p>

    <section v-if="chapter" class="chapter-introduction">
      <div class="chapter-introduction-head">
        <label>
        <span>章节介绍 <small class="muted">（离开输入框后自动保存）</small></span>
        <textarea
          v-model="chapterIntroduction"
          rows="6"
          maxlength="5000"
          placeholder="输入本章节的背景、人物和剧情概述，新增镜头会复用该内容。"
          @blur="saveChapter"
        />
        </label>
        <div class="chapter-introduction-actions">
          <button type="button" class="primary" :disabled="generatingScript || savingChapter" @click="generateScript">
            {{ generatingScript ? 'AI生成剧本中…' : '生成剧本' }}
          </button>
          <button type="button" class="primary" :disabled="batch.running || generating || merging || selectedBatchTargets.length < 2" title="请先在镜头列表中选择至少两个未在生成中的镜头" @click="generateBatch">
            {{ batch.running ? '批量生成中…' : '镜头批量生成' }}
          </button>
          <button type="button" class="ghost-btn danger-btn" :disabled="batch.running || generating || merging || !canBatchDelete" title="请选择未在生成中的镜头" @click="removeSelectedShots">镜头批量删除</button>
        </div>
      </div>
      <span v-if="savingChapter" class="muted auto-saving">自动保存中…</span>
    </section>

    <div class="body">
      <!-- left: shot list -->
      <aside class="shots">
        <div class="shots-head">
          <span>镜头列表</span>
          <div class="head-actions">
            <button type="button" class="ghost-btn small" :disabled="batch.running || merging || !canMergeSelection" @click="mergeShots()">
              {{ merging ? '合成中…' : `合成 (${mergeSelection.length})` }}
            </button>
            <button type="button" class="ghost-btn small" :disabled="batch.running" @click="addOpen = true">+ 添加</button>
          </div>
        </div>
        <div v-if="batch.running || batch.message" class="batch-progress">
          <div class="batch-progress-head">
            <span>{{ batch.message }}</span>
            <button v-if="batch.running" type="button" class="link danger" :disabled="batch.cancelling" @click="cancelBatch">
              {{ batch.cancelling ? '中断中…' : '中断' }}
            </button>
          </div>
          <div class="progress-track"><span :style="{ width: `${batch.total ? Math.round(((batch.index - 1 + batch.currentProgress / 100) / batch.total) * 100) : 0}%` }" /></div>
          <div class="batch-progress-meta">
            <span>整体进度 {{ batch.index }}/{{ batch.total }}</span>
            <span v-if="batch.currentShotId">当前镜头 {{ batch.currentProgress }}%</span>
          </div>
        </div>
        <ul>
          <li
            v-for="s in shots"
            :key="s.shotId"
            draggable="true"
            :class="{ dragging: draggingId === s.shotId, disabled: s.disabled }"
            @dragstart="dragStart(s, $event)"
            @dragend="draggingId = ''"
            @dragover.prevent
            @drop.prevent="dropOn(s)"
          >
            <input
              type="checkbox"
              class="merge-check"
              :checked="mergeSelection.includes(s.shotId)"
              :disabled="s.disabled || s.merged || batch.running"
              title="选择镜头（用于批量生成、删除或合成）"
              @click.stop="toggleMergeSelection(s.shotId)"
            />
            <button type="button" class="shot" :class="{ active: s.shotId === selectedId }" @click="select(s)">
              <span class="seq" :class="stateOf(s)">{{ s.seq }}</span>
              <span class="text">
                <span class="nm">{{ s.name }} <small v-if="s.merged" class="merged-label">合成</small></span>
                <span class="rm muted">{{ s.disabled ? '已用于合成' : `任务：${s.job?.promptId || '未开始'}` }}</span>
                <span v-if="stateOf(s) === 'running'" class="progress-text">进度 {{ percentOf(s) }}%</span>
                <span v-else-if="stateOf(s) === 'failed'" class="shot-error" :title="s.job?.error || s.job?.message">
                  {{ s.job?.error || s.job?.message || '执行失败' }}
                </span>
              </span>
            </button>
            <button
              v-if="stateOf(s) === 'completed' && previewOf(s)"
              type="button"
              class="preview-btn"
              title="预览视频"
              @click="previewing = previewOf(s)"
            >
              预览
            </button>
            <button v-if="!s.disabled" type="button" class="del" title="删除镜头" @click="removeShot(s)">✕</button>
          </li>
        </ul>
        <p v-if="!shots.length && !loading" class="muted small pad">还没有镜头，点击「+ 添加」创建第一个。</p>
      </aside>

      <!-- center: shot editor -->
      <main class="editor">
        <div v-if="!selected" class="placeholder card">
          {{ loading ? '载入中…' : '从左侧选择一个镜头，或添加新的镜头。' }}
        </div>

        <template v-else>
          <section class="card form">
            <div class="form-head">
              <h2>{{ draft.name }}</h2>
              <span class="badge">{{ selected.merged ? '合成镜头' : mode }}</span>
            </div>

            <div class="row2">
              <label>
                <span>镜头名称</span>
                <input v-model="draft.name" maxlength="120" />
              </label>
              <label>
                <span>备注</span>
                <input v-model="draft.remark" maxlength="500" />
              </label>
            </div>

            <template v-if="selected.merged">
              <div class="source-head">
                <span>原镜头列表</span>
                <small class="muted">拖拽可调整重新合成顺序</small>
              </div>
              <div class="source-list">
                <div
                  v-for="source in mergedSources"
                  :key="source.shotId"
                  class="source-item"
                  :class="{ dragging: sourceDraggingId === source.shotId }"
                  draggable="true"
                  @dragstart="sourceDragStart(source.shotId, $event)"
                  @dragend="sourceDraggingId = ''"
                  @dragover.prevent
                  @drop.prevent="dropSource(source.shotId)"
                >
                  <span class="source-order">{{ draft.sourceShotIds.indexOf(source.shotId) + 1 }}</span>
                  <span class="source-name">{{ source.name }}</span>
                  <button v-if="previewOf(source)" type="button" class="link" @click="previewing = previewOf(source)">预览</button>
                </div>
              </div>
              <div class="actions">
                <button type="button" class="ghost-btn danger-btn" :disabled="selected.disabled" :title="selected.disabled ? '请先解除引用它的上层合成' : ''" @click="unmergeShot(selected)">解除合成</button>
                <button type="button" class="ghost-btn" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
                <button type="button" class="primary" :disabled="merging || !mergeOrderChanged" @click="mergeShots(selected)">
                  {{ merging ? '重新合成中…' : '重新合成' }}
                </button>
              </div>
            </template>

            <template v-else>
              <div class="frames">
                <ImageField label="首帧 (first frame，可选)" v-model="draft.firstFrame" :library="library" @uploaded="refreshLibrary" />
                <ImageField label="尾帧 (last frame，可选)" v-model="draft.lastFrame" :library="library" @uploaded="refreshLibrary" />
              </div>
              <p class="muted small frame-hint">不填写首帧和尾帧时，将直接使用提示词进行文生视频。</p>

              <div class="prompt-parts">
                <label>
                  <span>故事板</span>
                  <textarea v-model="draft.promptStoryboard" rows="12" :placeholder="STORYBOARD_PLACEHOLDER" @input="draft.promptOverride = ''" />
                </label>
                <label>
                  <span>约束（负向提示词）</span>
                  <textarea v-model="draft.promptNegative" rows="4" :placeholder="NEGATIVE_PLACEHOLDER" @input="draft.promptOverride = ''" />
                </label>
              </div>

              <div class="presets">
                <button
                  v-for="p in PRESETS"
                  :key="p.label"
                  type="button"
                  class="chip"
                  @click="((draft.width = p.width), (draft.height = p.height))"
                >
                  {{ p.label }}
                </button>
              </div>

              <div class="row3">
                <label><span>宽度 (width)</span><input v-model.number="draft.width" type="number" :min="limits.width?.min ?? 256" :max="limits.width?.max ?? 1920" :step="limits.width?.step ?? 32" /></label>
                <label><span>高度 (height)</span><input v-model.number="draft.height" type="number" :min="limits.height?.min ?? 256" :max="limits.height?.max ?? 1920" :step="limits.height?.step ?? 32" /></label>
                <label><span>时长 (duration, 秒)</span><input v-model.number="draft.duration" type="number" :min="limits.duration?.min ?? 1" :max="limits.duration?.max ?? 10" :step="limits.duration?.step ?? 0.5" /></label>
              </div>

              <p v-if="selected.disabled" class="muted disabled-note">该镜头已用于合成，保留供预览，不能再次生成。</p>
              <div class="actions">
                <button type="button" class="ghost-btn" @click="openScriptPreview">预览剧本</button>
                <button type="button" class="ghost-btn" :disabled="saving || selected.disabled" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
                <button type="button" class="primary" :disabled="batch.running || generating || active || selected.disabled" @click="requestGenerate">{{ generating ? '提交中…' : active ? '生成中…' : '生成视频' }}</button>
              </div>
            </template>
          </section>

          <JobStatus :job="job" :cancelling="cancellingPromptId === job?.promptId" @cancel="cancel" @preview="previewing = $event" />
        </template>
      </main>
    </div>

    <Modal
      v-if="scriptModalOpen"
      :title="scriptModalMode === 'generate' ? '确认剧本内容' : '预览剧本内容'"
      wide
      @close="scriptModalOpen = false"
    >
      <div class="script-preview">
        <p class="muted">
          以下内容由背景、故事板和约束按顺序聚合，段落之间保留一个空行，并将作为视频生成的提示词输入。
        </p>
        <textarea v-model="scriptPrompt" rows="20" class="mono" placeholder="剧本内容为空" />
        <span class="muted script-count">共 {{ scriptPrompt.length }} 个字符</span>
      </div>
      <template #footer>
        <button type="button" class="ghost-btn" :disabled="optimizingPrompt" @click="scriptModalOpen = false">
          {{ scriptModalMode === 'generate' ? '返回修改' : '关闭' }}
        </button>
        <button type="button" class="ghost-btn" :disabled="optimizingPrompt || !scriptPrompt.trim()" @click="optimizePrompt">
          {{ optimizingPrompt ? 'AI优化中…' : 'AI优化提示词' }}
        </button>
        <button
          type="button"
          class="primary"
          :disabled="!scriptPrompt.trim() || optimizingPrompt || generating"
          @click="scriptModalMode === 'generate' ? confirmGenerate() : confirmScriptPreview()"
        >
          {{ scriptModalMode === 'generate' ? '确认并生成' : '确认修改' }}
        </button>
      </template>
    </Modal>

    <Modal v-if="addOpen" title="添加镜头" @close="addOpen = false">
      <div class="add-form">
        <label>
          <span>镜头序号</span>
          <input :value="shots.length + 1" disabled />
        </label>
        <label>
          <span>镜头名称 <em>*</em></span>
          <input v-model="addForm.name" maxlength="120" placeholder="例如：转身特写" @keyup.enter="addShot" />
        </label>
        <label>
          <span>备注</span>
          <input v-model="addForm.remark" maxlength="500" placeholder="可选" />
        </label>
        <p v-if="addError" class="error">{{ addError }}</p>
      </div>
      <template #footer>
        <button type="button" class="ghost-btn" @click="addOpen = false">取消</button>
        <button type="button" class="primary" @click="addShot">添加</button>
      </template>
    </Modal>

    <VideoPreview v-if="previewing" :video="previewing" @close="previewing = null" />
  </div>
</template>

<style scoped>
.chapter-page {
  min-height: 100vh;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 12px 22px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  position: sticky;
  top: 0;
  z-index: 10;
}
.titles {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}
.titles h1 {
  margin: 0;
  font-size: 19px;
}
.right {
  display: flex;
  align-items: center;
  gap: 14px;
}
.page-error {
  margin: 12px 22px 0;
}
.chapter-introduction {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.chapter-introduction-head {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
.chapter-introduction-head label {
  flex: 1;
}
.chapter-introduction-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.body {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  align-items: start;
}
.shots {
  position: sticky;
  top: 57px;
  padding: 14px 10px;
  border-right: 1px solid var(--border);
  min-height: calc(100vh - 57px);
}
.shots-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 4px 10px;
  font-size: 13px;
  color: var(--muted);
}
.head-actions {
  display: flex;
  gap: 6px;
}
.batch-progress {
  margin: 0 4px 12px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-2);
}
.batch-progress-head,
.batch-progress-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.batch-progress-head {
  margin-bottom: 8px;
  color: var(--text);
}
.batch-progress-meta {
  margin-top: 6px;
  color: var(--muted);
}
.batch-progress .progress-track {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface);
}
.batch-progress .progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #6366f1, #22d3ee);
  transition: width .3s ease;
}
.shots ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.shots li {
  display: flex;
  align-items: stretch;
  gap: 4px;
}
.shots li.dragging {
  opacity: 0.45;
}
.shots li.disabled {
  opacity: 0.48;
  filter: grayscale(0.7);
}
.merge-check {
  flex: 0 0 auto;
  align-self: center;
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}
.shot {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  background: none;
  border: 1px solid transparent;
  border-radius: 9px;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.shot:hover {
  background: var(--surface-2);
}
.shot.active {
  background: var(--surface-2);
  border-color: var(--accent);
}
.seq {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: #6b7280;
  display: grid;
  place-items: center;
  font-size: 11px;
  color: #fff;
  font-weight: 700;
}
.seq.completed {
  background: #16a34a;
}
.seq.running {
  background: #2563eb;
}
.seq.failed {
  background: #dc2626;
}
.shot .text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.nm,
.rm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.rm {
  font-size: 11.5px;
}
.merged-label {
  color: #a5b4fc;
  font-weight: 500;
}
.progress-text,
.shot-error {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}
.progress-text {
  color: #60a5fa;
}
.shot-error {
  color: #f87171;
}
.preview-btn {
  flex: 0 0 auto;
  align-self: center;
  padding: 4px 6px;
  border: 1px solid #16a34a;
  border-radius: 6px;
  background: transparent;
  color: #4ade80;
  cursor: pointer;
  font-size: 11px;
}
.preview-btn:hover {
  background: rgba(22, 163, 74, 0.14);
}
.dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted);
}
.dot.completed {
  background: #4ade80;
}
.dot.failed {
  background: var(--danger);
}
.del {
  flex: 0 0 auto;
  width: 24px;
  background: none;
  border: none;
  color: transparent;
  cursor: pointer;
  border-radius: 6px;
}
.shots li:hover .del {
  color: var(--muted);
}
.del:hover {
  color: var(--danger) !important;
  background: var(--surface-2);
}
.pad {
  padding: 10px 6px;
}
.editor {
  padding: 18px 22px 48px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.placeholder {
  display: grid;
  place-items: center;
  min-height: 220px;
  color: var(--muted);
}
.form {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.form-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.form-head h2 {
  margin: 0;
  font-size: 17px;
}
.frames {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.row3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.prompt-parts {
  display: grid;
  gap: 14px;
}
.script-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.script-preview p {
  margin: 0;
}
.script-preview textarea {
  min-height: 360px;
  resize: vertical;
  white-space: pre-wrap;
}
.script-count {
  align-self: flex-end;
  font-size: 12px;
}
.source-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.source-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.source-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  cursor: grab;
}
.source-item.dragging {
  opacity: 0.45;
}
.source-order {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--accent);
  color: white;
  font-size: 11px;
}
.source-name {
  flex: 1;
}
.disabled-note {
  margin: 0;
}
.danger-btn {
  color: var(--danger);
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.add-form {
  display: flex;
  flex-direction: column;
  gap: 13px;
}
em {
  color: var(--danger);
  font-style: normal;
}
.small {
  font-size: 12px;
}
@media (max-width: 860px) {
  .body {
    grid-template-columns: 1fr;
  }
  .shots {
    position: static;
    min-height: 0;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
}
</style>
