<script setup>
import { computed, ref } from 'vue';
import { api } from '../api';

const props = defineProps({
  label: { type: String, required: true },
  /** The stored file name inside resources/images, or '' when unset. */
  modelValue: { type: String, default: '' },
  library: { type: Array, default: () => [] },
});
const emit = defineEmits(['update:modelValue', 'uploaded']);

const input = ref(null);
const busy = ref(false);
const error = ref('');

const preview = computed(() => {
  if (!props.modelValue) return '';
  const hit = props.library.find((i) => i.name === props.modelValue);
  return hit ? hit.url : `/resources/images/${encodeURIComponent(props.modelValue)}`;
});

async function onFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  error.value = '';
  busy.value = true;
  try {
    // Upload immediately so the name is stable and ComfyUI already has the file.
    const res = await api.uploadImage(file);
    emit('update:modelValue', res.name);
    emit('uploaded');
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
    if (input.value) input.value.value = '';
  }
}
</script>

<template>
  <div class="image-field">
    <div class="head">
      <span class="label">{{ label }}</span>
      <button v-if="modelValue" type="button" class="link" @click="emit('update:modelValue', '')">清除</button>
    </div>

    <div class="drop" :class="{ filled: !!preview }" @click="input.click()">
      <img v-if="preview" :src="preview" :alt="label" />
      <span v-else-if="busy" class="hint">上传中…</span>
      <span v-else class="hint">点击上传图片<br /><small>png / jpg / webp</small></span>
    </div>
    <input ref="input" type="file" accept="image/*" hidden @change="onFile" />

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="modelValue" class="mono muted name">{{ modelValue }}</p>

    <div v-if="library.length" class="library">
      <button
        v-for="img in library"
        :key="img.name"
        type="button"
        class="thumb"
        :class="{ active: modelValue === img.name }"
        :title="img.name"
        @click="emit('update:modelValue', img.name)"
      >
        <img :src="img.url" :alt="img.name" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.image-field {
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
  aspect-ratio: 16 / 9;
  border: 1px dashed var(--border);
  border-radius: 10px;
  display: grid;
  place-items: center;
  cursor: pointer;
  overflow: hidden;
  background: var(--surface-2);
  transition: border-color 0.15s;
}
.drop:hover {
  border-color: var(--accent);
}
.drop.filled {
  border-style: solid;
}
.drop img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.hint {
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}
.name {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.library {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.thumb {
  flex: 0 0 auto;
  width: 52px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: none;
  cursor: pointer;
}
.thumb.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.35);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
