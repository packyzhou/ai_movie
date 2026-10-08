<script setup>
import { computed, onUnmounted, reactive, ref } from 'vue';
import { api } from '../api';
import Modal from './Modal.vue';

const props = defineProps({
  label: { type: String, required: true },
  modelValue: { type: String, default: '' },
  trimValue: { type: Object, default: null },
});
const emit = defineEmits(['update:modelValue', 'update:trimValue']);

const input = ref(null);
const clipAudio = ref(null);
const busy = ref(false);
const error = ref('');
const trimOpen = ref(false);
const pendingFile = ref(null);
const pendingUrl = ref('');
const sourceDuration = ref(0);
const trim = reactive({ start: 0, end: 15 });
const preview = computed(() => props.modelValue ? `/resources/images/${encodeURIComponent(props.modelValue)}` : '');
const clipDuration = computed(() => Math.max(0, Number(trim.end) - Number(trim.start)));
const validTrim = computed(() => clipDuration.value >= 2 && clipDuration.value <= 15 && trim.start >= 0 && trim.end <= sourceDuration.value);

function rounded(value) {
  return Math.round(Number(value) * 100) / 100;
}

function releasePending() {
  if (clipAudio.value) clipAudio.value.pause();
  if (pendingUrl.value) URL.revokeObjectURL(pendingUrl.value);
  pendingUrl.value = '';
  pendingFile.value = null;
  trimOpen.value = false;
  if (input.value) input.value.value = '';
}

function inspectFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) resolve({ duration: audio.duration, url });
      else {
        URL.revokeObjectURL(url);
        reject(new Error('无法读取音频时长'));
      }
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取音频文件'));
    };
    audio.src = url;
  });
}

async function saveFile(file, range) {
  busy.value = true;
  try {
    const res = await api.uploadAudio(file);
    emit('update:modelValue', res.name);
    emit('update:trimValue', range);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function selectFile(file) {
  if (!file) return;
  error.value = '';
  try {
    const inspected = await inspectFile(file);
    const duration = rounded(inspected.duration);
    if (duration <= 15) {
      URL.revokeObjectURL(inspected.url);
      await saveFile(file, { start: 0, end: Math.max(2, duration) });
      if (input.value) input.value.value = '';
      return;
    }
    pendingFile.value = file;
    pendingUrl.value = inspected.url;
    sourceDuration.value = duration;
    trim.start = 0;
    trim.end = 15;
    trimOpen.value = true;
  } catch (err) {
    error.value = err.message;
    if (input.value) input.value.value = '';
  }
}

function updateStart() {
  trim.start = Math.max(0, Math.min(rounded(trim.start), Math.max(0, sourceDuration.value - 2)));
  if (trim.end - trim.start < 2) trim.end = Math.min(sourceDuration.value, trim.start + 2);
  if (trim.end - trim.start > 15) trim.end = trim.start + 15;
}

function updateEnd() {
  trim.end = Math.min(sourceDuration.value, Math.max(rounded(trim.end), 2));
  if (trim.end - trim.start < 2) trim.start = Math.max(0, trim.end - 2);
  if (trim.end - trim.start > 15) trim.start = trim.end - 15;
}

async function audition() {
  const audio = clipAudio.value;
  if (!audio || !validTrim.value) return;
  audio.pause();
  audio.currentTime = trim.start;
  await audio.play();
}

function stopAtEnd() {
  const audio = clipAudio.value;
  if (audio && audio.currentTime >= trim.end) {
    audio.pause();
    audio.currentTime = trim.start;
  }
}

async function confirmTrim() {
  if (!pendingFile.value || !validTrim.value) return;
  const file = pendingFile.value;
  const range = { start: rounded(trim.start), end: rounded(trim.end) };
  releasePending();
  await saveFile(file, range);
}

function clear() {
  emit('update:modelValue', '');
  emit('update:trimValue', null);
}

function onFile(event) {
  selectFile(event.target.files && event.target.files[0]);
}

function onDrop(event) {
  selectFile(event.dataTransfer.files && event.dataTransfer.files[0]);
}

onUnmounted(releasePending);
</script>

<template>
  <div class="audio-field">
    <div class="head">
      <span class="label">{{ label }}</span>
      <button v-if="modelValue" type="button" class="link" @click="clear">清除</button>
    </div>
    <div class="drop" :class="{ filled: !!modelValue }" @click="input.click()" @dragover.prevent @drop.prevent.stop="onDrop">
      <span v-if="busy" class="hint">上传中…</span>
      <span v-else class="hint">点击或拖拽上传音频<br /><small>超过15秒可选择片段 · wav / mp3 / flac / ogg / m4a / aac</small></span>
    </div>
    <input ref="input" type="file" accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac" hidden @change="onFile" />
    <audio v-if="preview" :src="preview" controls preload="metadata" />
    <p v-if="trimValue" class="muted trim-summary">截取 {{ trimValue.start }}s–{{ trimValue.end }}s（{{ rounded(trimValue.end - trimValue.start) }}s）</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="modelValue" class="mono muted name">{{ modelValue }}</p>

    <Modal v-if="trimOpen" title="截取参考音频" @close="releasePending">
      <div class="trim-editor">
        <p class="muted">原音频 {{ sourceDuration }} 秒，请选择2–15秒的片段。</p>
        <audio ref="clipAudio" :src="pendingUrl" controls preload="metadata" @timeupdate="stopAtEnd" />
        <div class="trim-fields">
          <label><span>开始时间（秒）</span><input v-model.number="trim.start" type="number" min="0" :max="sourceDuration - 2" step="0.1" @change="updateStart" /></label>
          <label><span>结束时间（秒）</span><input v-model.number="trim.end" type="number" min="2" :max="sourceDuration" step="0.1" @change="updateEnd" /></label>
        </div>
        <div class="range-row">
          <input v-model.number="trim.start" type="range" min="0" :max="sourceDuration - 2" step="0.1" @input="updateStart" />
          <input v-model.number="trim.end" type="range" min="2" :max="sourceDuration" step="0.1" @input="updateEnd" />
        </div>
        <p :class="validTrim ? 'muted' : 'error'">已选择 {{ rounded(clipDuration) }} 秒{{ validTrim ? '' : '，片段必须为2–15秒' }}</p>
        <button type="button" class="ghost-btn" :disabled="!validTrim" @click="audition">试听选中片段</button>
      </div>
      <template #footer>
        <button type="button" class="ghost-btn" @click="releasePending">取消</button>
        <button type="button" class="primary" :disabled="!validTrim || busy" @click="confirmTrim">{{ busy ? '上传中…' : '确认并上传' }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.audio-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.label {
  font-size: 13px;
  color: var(--muted);
}
.drop {
  min-height: 92px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  display: grid;
  place-items: center;
  cursor: pointer;
  background: var(--surface-2);
  transition: border-color 0.15s;
}
.drop:hover {
  border-color: var(--accent);
}
.drop.filled {
  border-style: solid;
}
.hint {
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}
audio {
  width: 100%;
  height: 36px;
}
.trim-summary,
.name,
.trim-editor p {
  margin: 0;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trim-editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.trim-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.range-row {
  display: grid;
  gap: 8px;
}
.range-row input {
  width: 100%;
}
</style>
