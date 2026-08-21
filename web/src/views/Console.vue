<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { session, signOut } from '../session';

const router = useRouter();
const settingsOpen = ref(false);
const options = ref({});

const NAV = [
  { name: 'projects', label: '我的项目', icon: '🎬' },
  { name: 'templates', label: '模板', icon: '🧩' },
];

async function logout() {
  await signOut();
  router.replace('/');
}

onMounted(async () => {
  options.value = await api.options().catch(() => ({}));
});
</script>

<template>
  <div class="console">
    <!-- top: user info & settings -->
    <header class="topbar">
      <router-link class="brand" to="/">🎞️ AI Movie</router-link>
      <div class="spacer" />
      <button type="button" class="icon-btn" title="设置" @click="settingsOpen = !settingsOpen">⚙</button>
      <div class="user">
        <span class="avatar">{{ (session.user || '?').slice(0, 1).toUpperCase() }}</span>
        <span>{{ session.user }}</span>
      </div>
      <button type="button" class="link" @click="logout">退出</button>

      <div v-if="settingsOpen" class="settings card" @click.stop>
        <h3>设置</h3>
        <dl>
          <dt>ComfyUI 地址</dt>
          <dd class="mono">{{ options.comfyUrl || '—' }}</dd>
          <dt>客户端 ID</dt>
          <dd class="mono">{{ options.clientId || '—' }}</dd>
          <dt>轮询间隔</dt>
          <dd>{{ options.pollIntervalMs || '—' }} ms</dd>
          <dt>尺寸范围</dt>
          <dd>
            {{ options.limits?.width?.min }}–{{ options.limits?.width?.max }}，步长
            {{ options.limits?.width?.step }}
          </dd>
          <dt>时长范围</dt>
          <dd>{{ options.limits?.duration?.min }}–{{ options.limits?.duration?.max }} 秒</dd>
        </dl>
        <p class="muted small">这些取自 api/config/*.json，修改后重启服务生效。</p>
        <button type="button" class="link" @click="settingsOpen = false">关闭</button>
      </div>
    </header>

    <div class="body">
      <!-- left: navigation -->
      <aside class="sidenav">
        <router-link v-for="n in NAV" :key="n.name" :to="{ name: n.name }" class="nav-item">
          <span class="icon">{{ n.icon }}</span>{{ n.label }}
        </router-link>
      </aside>

      <!-- center: tab content -->
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.console {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.topbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 20px;
  height: 56px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.brand {
  font-weight: 700;
  color: var(--text);
  text-decoration: none;
}
.spacer {
  flex: 1;
}
.icon-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--muted);
  width: 30px;
  height: 30px;
  cursor: pointer;
}
.icon-btn:hover {
  color: var(--text);
  border-color: var(--accent);
}
.user {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
}
.settings {
  position: absolute;
  top: 52px;
  right: 16px;
  width: 330px;
  z-index: 20;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
}
.settings h3 {
  margin: 0 0 12px;
  font-size: 15px;
}
.settings dl {
  margin: 0 0 10px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 14px;
  font-size: 12.5px;
}
.settings dt {
  color: var(--muted);
  white-space: nowrap;
}
.settings dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.small {
  font-size: 12px;
}
.body {
  flex: 1;
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  align-items: start;
}
.sidenav {
  position: sticky;
  top: 56px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 10px;
  border-right: 1px solid var(--border);
  min-height: calc(100vh - 56px);
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 9px;
  color: var(--muted);
  text-decoration: none;
  font-size: 14px;
}
.nav-item:hover {
  background: var(--surface-2);
  color: var(--text);
}
.nav-item.router-link-active {
  background: var(--surface-2);
  color: var(--text);
  box-shadow: inset 2px 0 0 var(--accent);
}
.content {
  padding: 20px 24px 48px;
  min-width: 0;
}
@media (max-width: 820px) {
  .body {
    grid-template-columns: 1fr;
  }
  .sidenav {
    position: static;
    flex-direction: row;
    min-height: 0;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
}
</style>
