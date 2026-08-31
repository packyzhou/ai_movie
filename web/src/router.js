import { createRouter, createWebHistory } from 'vue-router';
import { session, loadSession } from './session';

import Home from './views/Home.vue';
import Login from './views/Login.vue';
import Console from './views/Console.vue';
import ProjectsView from './views/ProjectsView.vue';
import TemplatesView from './views/TemplatesView.vue';
import AssetsView from './views/AssetsView.vue';
import SettingsView from './views/SettingsView.vue';
import ChapterView from './views/ChapterView.vue';

const routes = [
  { path: '/', name: 'home', component: Home },
  { path: '/login', name: 'login', component: Login },
  {
    path: '/console',
    component: Console,
    meta: { auth: true },
    children: [
      { path: '', redirect: { name: 'projects' } },
      { path: 'projects', name: 'projects', component: ProjectsView },
      { path: 'templates', name: 'templates', component: TemplatesView },
      { path: 'assets', name: 'assets', component: AssetsView },
      { path: 'settings', name: 'settings', component: SettingsView },
    ],
  },
  {
    // Chapters open in a new tab, so they are a top-level route rather than a
    // child of the console shell.
    path: '/chapter/:projectId/:chapterId',
    name: 'chapter',
    component: ChapterView,
    props: true,
    meta: { auth: true },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  if (!session.ready) await loadSession();
  if (to.meta.auth && !session.user) return { name: 'login', query: { redirect: to.fullPath } };
  if (to.name === 'login' && session.user) return { name: 'projects' };
  return true;
});
