// Polyfill for Promise.withResolvers (ES2024 feature not available in older environments)
// Required by pdf.js
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function <T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

import { createApp } from 'vue'
import App from './App.vue'
import router from './router';

import { IonicVue } from '@ionic/vue';

/* Core CSS required for Ionic components to work properly */
import '@ionic/vue/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/vue/css/padding.css';
import '@ionic/vue/css/float-elements.css';
import '@ionic/vue/css/text-alignment.css';
import '@ionic/vue/css/text-transformation.css';
import '@ionic/vue/css/flex-utils.css';
import '@ionic/vue/css/display.css';

/**
 * Ionic Dark Mode
 * -----------------------------------------------------
 * For more info, please see:
 * https://ionicframework.com/docs/theming/dark-mode
 */

/* @import '@ionic/vue/css/palettes/dark.always.css'; */
/* @import '@ionic/vue/css/palettes/dark.class.css'; */
import '@ionic/vue/css/palettes/dark.system.css';

/* Theme variables */
import './theme/variables.css';

/* Services */
import { initialize } from './services';

/**
 * Bootstrap the application
 * Ensures all critical resources (database, etc.) are initialized before mounting
 */
async function bootstrap() {
  // Initialize database and core services before mounting the app
  // This ensures the database is ready for all components and services
  await initialize();

  const app = createApp(App)
    .use(IonicVue)
    .use(router);

  await router.isReady();
  app.mount('#app');
}

bootstrap().catch((error) => {
  console.error('Failed to initialize application:', error);
});
