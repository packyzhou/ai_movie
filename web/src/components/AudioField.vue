<script setup>
import { computed, ref } from 'vue';
import { api } from '../api';

const props = defineProps({
  label: { type: String, required: true },
  modelValue: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);

const input = ref(null);
const busy = ref(false);
const error = ref('');
const preview = computed(() => props.modelValue ? `/resources/images/${encodeURIComponent(props.modelValue)}` : '');

async function uploadFile(file) {
  if (!file) return;
  error.value = '';
  busy.value = true;
  try {
    const res = await api.uploadAudio(file);
    emit('update:modelValue', res.name);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
    if (input.value) input.value.value = '';
  }
}

function onFile(event) {
  uploadFile(event.target.files && event.target.files[0]);
}

function onDrop(event) {
  uploadFile(event.dataTransfer.files && event.dataTransfer.files[0]);
}
</script>

<template>
  <div class="audio-field">
    <div class="head">
      <span class="label">{{ label }}</span>
      <button v-if="modelValue" type="button" class="link" @click="emit('update:modelValue', '')">清除</button>
    </div>
    <div class="drop" :class="{ filled: !!modelValue }" @click="input.click()" @dragover.prevent @drop.prevent.stop="onDrop">
      <span v-if="busy" class="hint">上传中…</span>
      <span v-else class="hint">点击或拖拽上传音频<br /><small>wav / mp3 / flac / ogg / m4a / aac</small></span>
    </div>
    <input ref="input" type="file" accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac" hidden @change="onFile" />
    <audio v-if="preview" :src="preview" controls preload="metadata" />
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="modelValue" class="mono muted name">{{ modelValue }}</p>
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
.name {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
