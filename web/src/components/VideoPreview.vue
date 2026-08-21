<script setup>
import { onMounted, onUnmounted } from 'vue';

const props = defineProps({ video: { type: Object, required: true } });
const emit = defineEmits(['close']);

function onKey(e) {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="modal">
      <header>
        <span class="mono">{{ video.filename }}</span>
        <div class="actions">
          <a class="link" :href="video.url + '&download=1'" download>下载</a>
          <button type="button" class="link" @click="emit('close')">关闭</button>
        </div>
      </header>
      <video :src="video.url" controls autoplay playsinline />
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(6, 8, 15, 0.82);
  display: grid;
  place-items: center;
  padding: 24px;
  z-index: 50;
}
.modal {
  width: min(960px, 100%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
}
.modal header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.actions {
  display: flex;
  gap: 14px;
}
.modal video {
  display: block;
  width: 100%;
  max-height: 72vh;
  background: #000;
}
</style>
