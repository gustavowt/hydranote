import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';
import WorkspacePage from '../views/WorkspacePage.vue';
import SettingsPage from '../views/SettingsPage.vue';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/workspace',
  },
  {
    path: '/workspace',
    name: 'Workspace',
    component: WorkspacePage,
  },
  {
    path: '/home',
    redirect: '/workspace',
  },
  {
    path: '/project/:id/chat',
    redirect: '/workspace',
  },
  {
    path: '/settings',
    name: 'Settings',
    component: SettingsPage,
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

export default router;
