/**
 * Update Service
 *
 * Checks the GitHub repository for new releases by comparing
 * the latest tag against the current app version from package.json.
 */

import { ref } from 'vue';
import packageJson from '../../package.json';

const GITHUB_REPO = 'gustavowt/hydranote';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DISMISSED_VERSION_KEY = 'hydranote_dismissed_update_version';

export const currentVersion = ref(packageJson.version);
export const latestVersion = ref<string | null>(null);
export const hasUpdate = ref(false);
export const releaseUrl = ref<string | null>(null);

let checkTimer: ReturnType<typeof setInterval> | null = null;

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

export function dismissUpdate(): void {
  if (latestVersion.value) {
    localStorage.setItem(DISMISSED_VERSION_KEY, latestVersion.value);
  }
  hasUpdate.value = false;
}

export async function checkForUpdates(): Promise<void> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/tags?per_page=1`
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

    hasUpdate.value = compareVersions(currentVersion.value, tag) > 0;
  } catch {
    // Silently fail — network issues shouldn't disrupt the app
  }
}

export function startUpdateChecker(): void {
  checkForUpdates();
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = setInterval(checkForUpdates, CHECK_INTERVAL_MS);
}

export function stopUpdateChecker(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}
