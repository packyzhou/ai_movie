<script setup>
import { computed } from 'vue';

const props = defineProps({
  page: { type: Number, default: 1 },
  pages: { type: Number, default: 1 },
  total: { type: Number, default: 0 },
});
const emit = defineEmits(['update:page']);

/** A compact window of page numbers around the current one. */
const window_ = computed(() => {
  const span = 5;
  let start = Math.max(1, props.page - Math.floor(span / 2));
  const end = Math.min(props.pages, start + span - 1);
  start = Math.max(1, end - span + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
});

function go(p) {
  if (p >= 1 && p <= props.pages && p !== props.page) emit('update:page', p);
}
</script>

<template>
  <div v-if="total > 0" class="pager">
    <span class="muted">共 {{ total }} 条 · 第 {{ page }}/{{ pages }} 页</span>
    <div class="controls">
      <button type="button" :disabled="page <= 1" @click="go(page - 1)">上一页</button>
      <button
        v-for="p in window_"
        :key="p"
        type="button"
        :class="{ active: p === page }"
        @click="go(p)"
      >
        {{ p }}
      </button>
      <button type="button" :disabled="page >= pages" @click="go(page + 1)">下一页</button>
    </div>
  </div>
</template>

<style scoped>
.pager {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  margin-top: 14px;
  font-size: 13px;
  flex-wrap: wrap;
}
.controls {
  display: flex;
  gap: 6px;
}
.controls button {
  min-width: 32px;
  padding: 5px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--muted);
  cursor: pointer;
  font-size: 12.5px;
}
.controls button:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--accent);
}
.controls button.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.controls button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
