import { reactive } from 'vue';
import { api } from './api';

/** Shared auth state so the router guard and the shell agree on who is logged in. */
export const session = reactive({
  user: null,
  ready: false,
});

export async function loadSession() {
  try {
    session.user = (await api.me()).username;
  } catch (_) {
    session.user = null;
  } finally {
    session.ready = true;
  }
  return session.user;
}

export async function signIn(username, password) {
  const res = await api.login(username, password);
  session.user = res.username;
  return res.username;
}

export async function signOut() {
  await api.logout().catch(() => {});
  session.user = null;
}
