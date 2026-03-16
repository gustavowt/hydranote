<template>
  <transition name="update-banner">
    <div v-if="hasUpdate" class="update-banner">
      <div class="update-banner-content">
        <ion-icon :icon="arrowUpCircleOutline" class="update-icon" />
        <span class="update-text">
          Version <strong>{{ latestVersion }}</strong> is available
          <span class="current-version">(current: {{ currentVersion }})</span>
        </span>
        <a
          :href="releaseUrl ?? '#'"
          target="_blank"
          rel="noopener noreferrer"
          class="update-link"
        >
          View release
          <ion-icon :icon="openOutline" class="link-icon" />
        </a>
        <button class="dismiss-btn" @click="dismissUpdate" aria-label="Dismiss">
          <ion-icon :icon="closeOutline" />
        </button>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { arrowUpCircleOutline, openOutline, closeOutline } from 'ionicons/icons';
import {
  hasUpdate,
  latestVersion,
  currentVersion,
  releaseUrl,
  dismissUpdate,
} from '@/services/updateService';
</script>

<style scoped>
.update-banner {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 99999;
  background: var(--hn-bg-elevated);
  border-top: 1px solid var(--hn-purple-dark);
  padding: 6px 16px;
}

.update-banner-content {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 960px;
  margin: 0 auto;
  font-size: 13px;
  color: var(--hn-text-secondary);
}

.update-icon {
  font-size: 18px;
  color: var(--hn-purple);
  flex-shrink: 0;
}

.update-text {
  flex: 1;
  min-width: 0;
}

.update-text strong {
  color: var(--hn-purple-light);
}

.current-version {
  color: var(--hn-text-muted);
}

.update-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--hn-teal);
  text-decoration: none;
  font-weight: 500;
  white-space: nowrap;
  transition: color 0.15s;
}

.update-link:hover {
  color: var(--hn-teal-light);
}

.link-icon {
  font-size: 14px;
}

.dismiss-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--hn-text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  font-size: 16px;
  transition: color 0.15s, background 0.15s;
}

.dismiss-btn:hover {
  color: var(--hn-text-primary);
  background: var(--hn-bg-hover);
}

.update-banner-enter-active,
.update-banner-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

.update-banner-enter-from,
.update-banner-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
