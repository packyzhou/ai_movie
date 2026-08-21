<script setup>
import { session } from './session';
</script>

<template>
  <router-view v-if="session.ready" />
  <div v-else class="boot">载入中…</div>
</template>

<style scoped>
.boot {
  min-height: 100vh;
  display: grid;
  place-items: center;
  color: var(--muted);
}
</style>
