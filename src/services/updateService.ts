/**
 * Update Service
 *
 * Two paths:
 *
 *   • Electron (packaged builds): subscribes to electron-updater lifecycle
 *     events via electronAPI.updater and drives the in-app UpdateBanner
 *     through phases (checking → available → downloading → downloaded).
 *     Calls into the main process to download and quit-and-install.
 *
 *   • Web / PWA / unpacked dev builds: falls back to polling the GitHub
 *     repository tags API and renders a "View release" link banner.
 *
 * The exported reactive refs are consumed by UpdateBanner.vue.
 */

import { ref } from 'vue';
import packageJson from '../../package.json';

const GITHUB_REPO = 'gustavowt/hydranote';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DISMISSED_VERSION_KEY = 'hydranote_dismissed_update_version';

export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export const currentVersion = ref(packageJson.version);
export const latestVersion = ref<string | null>(null);
export const hasUpdate = ref(false);
export const releaseUrl = ref<string | null>(null);

// Electron-driven phase machine. Web builds stay at 'idle' / 'available'.
export const updaterPhase = ref<UpdaterPhase>('idle');
export const downloadPercent = ref(0);
export const downloadBytesPerSec = ref(0);
export const updaterError = ref<string | null>(null);

let checkTimer: ReturnType<typeof setInterval> | null = null;
let electronListenerAttached = false;

function getElectronUpdater() {
  if (typeof window === 'undefined') return null;
  return window.electronAPI?.updater ?? null;
}

function compareVersions(current: string, latest: string): number {
  const normalize = (v: string) => v.replace(/^v/, '');
  const a = normalize(current).split('.').map(Number);
  const b = normalize(latest).split('.').map(Number);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (b[i] || 0) - (a[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getDismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_VERSION_KEY);
  } catch {
    return null;
  }
}

/**
 * Dismiss the banner for the current "available" version.
 * Only affects the pre-download stage — once a download has started or
 * finished, the banner stays visible so the user can install.
 */
export function dismissUpdate(): void {
  if (latestVersion.value) {
    try {
      localStorage.setItem(DISMISSED_VERSION_KEY, latestVersion.value);
    } catch {
      // localStorage may be unavailable (private mode, etc.)
    }
  }
  hasUpdate.value = false;
  if (updaterPhase.value === 'available') {
    updaterPhase.value = 'idle';
  }
}

// ============================================================
// Web fallback: GitHub tags polling
// ============================================================

async function checkForUpdatesViaTags(): Promise<void> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/tags?per_page=1`,
    );
    if (!res.ok) return;

    const tags: { name: string }[] = await res.json();
    if (!tags.length) return;

    const tag = tags[0].name.replace(/^v/, '');
    latestVersion.value = tag;
    releaseUrl.value = `https://github.com/${GITHUB_REPO}/releases/tag/${tags[0].name}`;

    const dismissed = getDismissedVersion();
    if (dismissed === tag) {
      hasUpdate.value = false;
      return;
    }

    const isNewer = compareVersions(currentVersion.value, tag) > 0;
    hasUpdate.value = isNewer;
    updaterPhase.value = isNewer ? 'available' : 'idle';
  } catch {
    // Network errors shouldn't disrupt the app
  }
}

/**
 * Imperative one-off check. Used by the existing tests and as a refresh
 * trigger. Routes through electron-updater when available, otherwise hits
 * the GitHub tags API.
 */
export async function checkForUpdates(): Promise<void> {
  const updater = getElectronUpdater();
  if (updater) {
    updaterError.value = null;
    const result = await updater.check();
    if (!result.success && result.error) {
      updaterError.value = result.error;
      updaterPhase.value = 'error';
    }
    return;
  }
  await checkForUpdatesViaTags();
}

// ============================================================
// Electron path: subscribe to autoUpdater events
// ============================================================

function attachElectronListener(): void {
  const updater = getElectronUpdater();
  if (!updater || electronListenerAttached) return;

  updater.onEvent((payload) => {
    switch (payload.kind) {
      case 'checking':
        updaterError.value = null;
        // Don't override a terminal state with 'checking' from a periodic re-check.
        if (updaterPhase.value === 'idle') {
          updaterPhase.value = 'checking';
        }
        break;

      case 'available': {
        latestVersion.value = payload.version;
        releaseUrl.value = `https://github.com/${GITHUB_REPO}/releases/tag/v${payload.version}`;
        const dismissed = getDismissedVersion();
        if (dismissed === payload.version) {
          hasUpdate.value = false;
          updaterPhase.value = 'idle';
        } else {
          hasUpdate.value = true;
          updaterPhase.value = 'available';
        }
        break;
      }

      case 'not-available':
        if (updaterPhase.value === 'checking') {
          updaterPhase.value = 'idle';
        }
        break;

      case 'download-progress':
        updaterPhase.value = 'downloading';
        downloadPercent.value = Math.max(0, Math.min(100, payload.percent || 0));
        downloadBytesPerSec.value = payload.bytesPerSecond || 0;
        hasUpdate.value = true;
        break;

      case 'downloaded':
        latestVersion.value = payload.version;
        downloadPercent.value = 100;
        updaterPhase.value = 'downloaded';
        hasUpdate.value = true;
        break;

      case 'error':
        updaterError.value = payload.message || 'Update failed';
        updaterPhase.value = 'error';
        break;
    }
  });

  electronListenerAttached = true;
}

function detachElectronListener(): void {
  const updater = getElectronUpdater();
  if (updater && electronListenerAttached) {
    updater.offEvent();
    electronListenerAttached = false;
  }
}

// ============================================================
// Public lifecycle hooks (called from App.vue)
// ============================================================

/**
 * Trigger the download. Only meaningful in Electron — in the web build
 * the banner shows a "View release" link instead.
 */
export async function requestUpdateDownload(): Promise<void> {
  const updater = getElectronUpdater();
  if (!updater) return;
  updaterError.value = null;
  updaterPhase.value = 'downloading';
  downloadPercent.value = 0;
  downloadBytesPerSec.value = 0;
  const result = await updater.downloadUpdate();
  if (!result.success) {
    updaterError.value = result.error || 'Download failed';
    updaterPhase.value = 'error';
  }
}

/**
 * Restart the app and apply the downloaded update.
 */
export async function installUpdateNow(): Promise<void> {
  const updater = getElectronUpdater();
  if (!updater) return;
  const result = await updater.quitAndInstall();
  if (!result.success) {
    updaterError.value = result.error || 'Install failed';
    updaterPhase.value = 'error';
  }
}

export function startUpdateChecker(): void {
  const updater = getElectronUpdater();
  if (updater) {
    attachElectronListener();
    // First check is fired by the main process bootstrap; schedule a periodic
    // re-check from the renderer (same 6h cadence the web path used).
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = setInterval(() => {
      void updater.check();
    }, CHECK_INTERVAL_MS);
    return;
  }

  void checkForUpdatesViaTags();
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = setInterval(() => {
    void checkForUpdatesViaTags();
  }, CHECK_INTERVAL_MS);
}

export function stopUpdateChecker(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  detachElectronListener();
}
