<script setup>
import { onMounted, onUnmounted } from 'vue';

defineProps({
  title: { type: String, default: '' },
  wide: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);

function onKey(e) {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="modal" :class="{ wide }">
      <header>
        <h2>{{ title }}</h2>
        <button type="button" class="x" @click="emit('close')">✕</button>
      </header>
      <div class="body"><slot /></div>
      <footer v-if="$slots.footer"><slot name="footer" /></footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(6, 8, 15, 0.75);
  display: grid;
  place-items: center;
  padding: 24px;
  z-index: 40;
}
.modal {
  width: min(560px, 100%);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
}
.modal.wide {
  width: min(880px, 100%);
}
.modal header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.modal header h2 {
  margin: 0;
  font-size: 16px;
}
.x {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 15px;
}
.modal .body {
  padding: 18px;
  overflow: auto;
}
.modal footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid var(--border);
}
</style>
