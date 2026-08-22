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
  prompt: '',
  width: 1280,
  height: 704,
  duration: 5,
});

const loading = ref(true);
const error = ref('');
const notice = ref('');
const saving = ref(false);
const generating = ref(false);
const merging = ref(false);
const draggingId = ref('');

const job = ref(null);
const previewing = ref(null);

const addOpen = ref(false);
const addForm = reactive({ name: '', remark: '' });
const addError = ref('');

let pollTimer = null;

const shots = computed(() => (chapter.value && chapter.value.shots) || []);
const selected = computed(() => shots.value.find((s) => s.shotId === selectedId.value) || null);
const limits = computed(() => options.value.limits || {});
const active = computed(() => job.value && (job.value.status === 'queued' || job.value.status === 'running'));

// Both frames present -> image-to-video; prompt only -> text-to-video.
const mode = computed(() => (draft.firstFrame && draft.lastFrame ? '图生视频' : '文生视频'));

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
    prompt: shot.prompt || '',
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
  library.value = (await api.resources()).images;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [res, opts] = await Promise.all([api.chapter(props.projectId, props.chapterId), api.options()]);
    chapter.value = res.chapter;
    project.value = res.project;
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

async function addShot() {
  addError.value = '';
  if (!addForm.name.trim()) {
    addError.value = '请输入镜头名称';
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

async function save() {
  if (!selected.value) return null;
  saving.value = true;
  error.value = '';
  try {
    const { shot } = await api.updateShot(props.projectId, props.chapterId, draft.shotId, {
      name: draft.name,
      remark: draft.remark,
      firstFrame: draft.firstFrame,
      lastFrame: draft.lastFrame,
      prompt: draft.prompt,
      width: draft.width,
      height: draft.height,
      duration: draft.duration,
    });
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

async function mergeShots() {
  if (!confirm('将按当前顺序合成全部镜头，并删除原镜头及其视频。是否继续？')) return;
  merging.value = true;
  error.value = '';
  stopPolling();
  try {
    const { shot } = await api.mergeShots(props.projectId, props.chapterId);
    chapter.value.shots = [shot];
    select(shot);
    previewing.value = previewOf(shot);
  } catch (err) {
    error.value = err.message;
  } finally {
    merging.value = false;
  }
}

async function cancel(promptId) {
  await api.cancel(promptId).catch((err) => (error.value = err.message));
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

    <div class="body">
      <!-- left: shot list -->
      <aside class="shots">
        <div class="shots-head">
          <span>镜头列表</span>
          <div class="head-actions">
            <button type="button" class="ghost-btn small" :disabled="merging || shots.length < 2" @click="mergeShots">
              {{ merging ? '合成中…' : '合成' }}
            </button>
            <button type="button" class="ghost-btn small" @click="addOpen = true">+ 添加</button>
          </div>
        </div>
        <ul>
          <li
            v-for="s in shots"
            :key="s.shotId"
            draggable="true"
            :class="{ dragging: draggingId === s.shotId }"
            @dragstart="dragStart(s, $event)"
            @dragend="draggingId = ''"
            @dragover.prevent
            @drop.prevent="dropOn(s)"
          >
            <button type="button" class="shot" :class="{ active: s.shotId === selectedId }" @click="select(s)">
              <span class="seq" :class="stateOf(s)">{{ s.seq }}</span>
              <span class="text">
                <span class="nm">{{ s.name }}</span>
                <span class="rm muted">任务：{{ s.job?.promptId || '未开始' }}</span>
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
            <button type="button" class="del" title="删除镜头" @click="removeShot(s)">✕</button>
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
              <span class="badge">{{ mode }}</span>
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

            <div class="frames">
              <ImageField label="首帧 (first frame)" v-model="draft.firstFrame" :library="library" @uploaded="refreshLibrary" />
              <ImageField label="尾帧 (last frame)" v-model="draft.lastFrame" :library="library" @uploaded="refreshLibrary" />
            </div>

            <label>
              <span>剧本内容提示词 (prompt)</span>
              <textarea v-model="draft.prompt" rows="9" placeholder="描述镜头、人物、动作、运镜、音频与字幕…" />
            </label>

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
              <label>
                <span>宽度 (width)</span>
                <input
                  v-model.number="draft.width"
                  type="number"
                  :min="limits.width?.min ?? 256"
                  :max="limits.width?.max ?? 1920"
                  :step="limits.width?.step ?? 32"
                />
              </label>
              <label>
                <span>高度 (height)</span>
                <input
                  v-model.number="draft.height"
                  type="number"
                  :min="limits.height?.min ?? 256"
                  :max="limits.height?.max ?? 1920"
                  :step="limits.height?.step ?? 32"
                />
              </label>
              <label>
                <span>时长 (duration, 秒)</span>
                <input
                  v-model.number="draft.duration"
                  type="number"
                  :min="limits.duration?.min ?? 1"
                  :max="limits.duration?.max ?? 10"
                  :step="limits.duration?.step ?? 0.5"
                />
              </label>
            </div>

            <div class="actions">
              <button type="button" class="ghost-btn" :disabled="saving" @click="save">
                {{ saving ? '保存中…' : '保存' }}
              </button>
              <button type="button" class="primary" :disabled="generating || active" @click="generate">
                {{ generating ? '提交中…' : active ? '生成中…' : '生成视频' }}
              </button>
            </div>
          </section>

          <JobStatus :job="job" @cancel="cancel" @preview="previewing = $event" />
        </template>
      </main>
    </div>

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
