<script setup>
import { computed } from 'vue';

const props = defineProps({
  job: { type: Object, default: null },
});
defineEmits(['cancel', 'preview']);

const STATUS_TEXT = {
  queued: '排队中',
  running: '生成中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const percent = computed(() => Math.round((props.job?.progress || 0) * 100));
const active = computed(() => props.job && (props.job.status === 'queued' || props.job.status === 'running'));

const elapsed = computed(() => {
  if (!props.job) return '';
  const end = props.job.finishedAt || Date.now();
  return `${Math.max(0, Math.round((end - props.job.createdAt) / 1000))}s`;
});
</script>

<template>
  <section v-if="job" class="card job">
    <header>
      <div>
        <span class="badge" :class="job.status">{{ STATUS_TEXT[job.status] || job.status }}</span>
        <span class="muted mono">{{ job.promptId }}</span>
      </div>
      <button v-if="active" type="button" class="link danger" @click="$emit('cancel', job.promptId)">中断</button>
    </header>

    <div class="bar" :class="job.status">
      <div class="fill" :style="{ width: percent + '%' }" />
    </div>

    <p class="line">
      <span>{{ job.message }}</span>
      <span class="muted">
        {{ percent }}% · {{ elapsed }}
        <template v-if="job.queueRemaining != null && active"> · 队列剩余 {{ job.queueRemaining }}</template>
      </span>
    </p>

    <p v-if="job.error" class="error">{{ job.error }}</p>

    <div v-if="job.videos && job.videos.length" class="results">
      <button v-for="v in job.videos" :key="v.url" type="button" class="result" @click="$emit('preview', v)">
        <video :src="v.url" muted preload="metadata" />
        <span class="play">▶</span>
        <span class="name">{{ v.filename }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.job {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.job header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.job header > div {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.job header .mono {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bar {
  height: 8px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}
.bar .fill {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #22d3ee);
  transition: width 0.4s ease;
}
.bar.failed .fill,
.bar.cancelled .fill {
  background: #ef4444;
}
.bar.completed .fill {
  background: #22c55e;
}
.line {
  margin: 0;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.results {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
  margin-top: 4px;
}
.result {
  position: relative;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: #000;
  cursor: pointer;
}
.result video {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  display: block;
}
.result .play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 26px;
  color: #fff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}
.result .name {
  display: block;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--muted);
  background: var(--surface-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
