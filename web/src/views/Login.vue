<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { signIn } from '../session';

const route = useRoute();
const router = useRouter();

const username = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    await signIn(username.value, password.value);
    router.replace(route.query.redirect || '/console');
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <form class="card login" @submit.prevent="submit">
      <router-link class="back" to="/">← 返回首页</router-link>
      <h1>登录</h1>
      <p class="muted">AI 视频创作平台</p>

      <label>
        <span>账号</span>
        <input v-model="username" autocomplete="username" required autofocus />
      </label>
      <label>
        <span>密码</span>
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>

      <p v-if="error" class="error">{{ error }}</p>
      <button class="primary" type="submit" :disabled="busy">{{ busy ? '登录中…' : '登录' }}</button>
    </form>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}
.login {
  width: min(380px, 100%);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.login h1 {
  margin: 0;
  font-size: 26px;
}
.login p.muted {
  margin: -8px 0 6px;
}
.back {
  color: var(--muted);
  text-decoration: none;
  font-size: 13px;
}
.back:hover {
  color: var(--text);
}
</style>
