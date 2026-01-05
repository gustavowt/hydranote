import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';
import WorkspacePage from '../views/WorkspacePage.vue';
import SettingsPage from '../views/SettingsPage.vue';
import SetupWizardPage from '../views/SetupWizardPage.vue';
import { shouldShowWizard } from '@/services';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/workspace',
  },
  {
    path: '/setup',
    name: 'Setup',
    component: SetupWizardPage,
    meta: { isSetupWizard: true },
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

// Navigation guard: redirect to setup wizard on first boot
router.beforeEach((to, _from, next) => {
  // Check if user needs to complete setup wizard
  const needsSetup = shouldShowWizard();
  
  // If going to setup page, always allow
  if (to.meta.isSetupWizard) {
    next();
    return;
  }
  
  // If wizard not completed and not going to setup, redirect to setup
  if (needsSetup) {
    next('/setup');
    return;
  }
  
  // Otherwise, proceed normally
  next();
});

export default router;
