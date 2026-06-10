<template>
  <transition name="update-banner">
    <div v-if="visible" class="update-banner" :class="phaseClass">
      <div class="update-banner-content">
        <ion-icon :icon="bannerIcon" class="update-icon" />

        <!-- Web fallback: GitHub release link -->
        <template v-if="!isElectron && phase === 'available'">
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
        </template>

        <!-- Electron: update available, ask to download -->
        <template v-else-if="phase === 'available'">
          <span class="update-text">
            Version <strong>{{ latestVersion }}</strong> is available
            <span class="current-version">(current: {{ currentVersion }})</span>
          </span>
          <button class="primary-btn" @click="onUpdateNow">
            <ion-icon :icon="cloudDownloadOutline" class="btn-icon" />
            Update now
          </button>
          <button class="secondary-btn" @click="dismissUpdate">Later</button>
        </template>

        <!-- Electron: downloading -->
        <template v-else-if="phase === 'downloading'">
          <span class="update-text">
            Downloading update
            <strong v-if="latestVersion">{{ latestVersion }}</strong>
            … <span class="percent">{{ percentLabel }}%</span>
            <span v-if="speedLabel" class="current-version">· {{ speedLabel }}</span>
          </span>
        </template>

        <!-- Electron: downloaded, ready to install -->
        <template v-else-if="phase === 'downloaded'">
          <span class="update-text">
            Update <strong>{{ latestVersion }}</strong> downloaded — ready to install
          </span>
          <button class="primary-btn" @click="onInstallNow">
            <ion-icon :icon="refreshOutline" class="btn-icon" />
            Restart now
          </button>
        </template>

        <!-- Electron: error state -->
        <template v-else-if="phase === 'error'">
          <span class="update-text error-text">
            Update failed: {{ updaterError ?? 'Unknown error' }}
          </span>
          <button class="secondary-btn" @click="onRetry">Retry</button>
          <button class="dismiss-btn" @click="dismissUpdate" aria-label="Dismiss">
            <ion-icon :icon="closeOutline" />
          </button>
        </template>
      </div>

      <!-- Thin progress bar overlay while downloading -->
      <div
        v-if="phase === 'downloading'"
        class="progress-track"
        :aria-valuenow="percentLabel"
        aria-valuemin="0"
        aria-valuemax="100"
        role="progressbar"
      >
        <div class="progress-fill" :style="{ width: percentLabel + '%' }" />
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import {
  arrowUpCircleOutline,
  cloudDownloadOutline,
  refreshOutline,
  openOutline,
  closeOutline,
  alertCircleOutline,
  checkmarkCircleOutline,
} from 'ionicons/icons';
import {
  hasUpdate,
  latestVersion,
  currentVersion,
  releaseUrl,
  updaterPhase,
  downloadPercent,
  downloadBytesPerSec,
  updaterError,
  dismissUpdate,
  requestUpdateDownload,
  installUpdateNow,
  checkForUpdates,
} from '@/services/updateService';

const isElectron = computed(() => !!(typeof window !== 'undefined' && window.electronAPI?.updater));
const phase = computed(() => updaterPhase.value);

const visible = computed(() => {
  if (phase.value === 'downloading' || phase.value === 'downloaded') return true;
  if (phase.value === 'error' && updaterError.value) return true;
  return hasUpdate.value;
});

const phaseClass = computed(() => `phase-${phase.value}`);

const bannerIcon = computed(() => {
  switch (phase.value) {
    case 'downloaded':
      return checkmarkCircleOutline;
    case 'error':
      return alertCircleOutline;
    case 'downloading':
      return cloudDownloadOutline;
    default:
      return arrowUpCircleOutline;
  }
});

const percentLabel = computed(() => Math.round(downloadPercent.value));

const speedLabel = computed(() => {
  const bps = downloadBytesPerSec.value;
  if (!bps || bps <= 0) return '';
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
});

async function onUpdateNow() {
  await requestUpdateDownload();
}

async function onInstallNow() {
  await installUpdateNow();
}

async function onRetry() {
  await checkForUpdates();
}
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

.update-banner.phase-downloaded {
  border-top-color: var(--hn-teal, #16a394);
}

.update-banner.phase-error {
  border-top-color: var(--hn-danger, #c0392b);
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

.phase-downloaded .update-icon {
  color: var(--hn-teal, #16a394);
}

.phase-error .update-icon {
  color: var(--hn-danger, #c0392b);
}

.update-text {
  flex: 1;
  min-width: 0;
}

.update-text strong {
  color: var(--hn-purple-light);
}

.phase-downloaded .update-text strong {
  color: var(--hn-teal-light, #2ec4b6);
}

.error-text {
  color: var(--hn-danger, #c0392b);
}

.current-version {
  color: var(--hn-text-muted);
}

.percent {
  color: var(--hn-text-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
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

.primary-btn,
.secondary-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s, opacity 0.15s;
}

.primary-btn {
  background: var(--hn-purple);
  color: #ffffff;
}

.primary-btn:hover {
  background: var(--hn-purple-light, var(--hn-purple));
}

.phase-downloaded .primary-btn {
  background: var(--hn-teal, #16a394);
}

.phase-downloaded .primary-btn:hover {
  background: var(--hn-teal-light, #2ec4b6);
}

.secondary-btn {
  background: transparent;
  color: var(--hn-text-secondary);
  border: 1px solid var(--hn-border, rgba(255, 255, 255, 0.12));
}

.secondary-btn:hover {
  background: var(--hn-bg-hover);
  color: var(--hn-text-primary);
}

.btn-icon {
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

.progress-track {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--hn-bg-hover, rgba(255, 255, 255, 0.06));
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--hn-purple);
  transition: width 0.2s linear;
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
