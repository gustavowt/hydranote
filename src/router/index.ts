import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';
import ProjectListPage from '../views/ProjectListPage.vue';
import ProjectChatPage from '../views/ProjectChatPage.vue';
import SettingsPage from '../views/SettingsPage.vue';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/home',
  },
  {
    path: '/home',
    name: 'Home',
    component: ProjectListPage,
  },
  {
    path: '/project/:id/chat',
    name: 'ProjectChat',
    component: ProjectChatPage,
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
