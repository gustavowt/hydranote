import type { IntegrationSettings, IntegrationId, GoogleWorkspaceApp } from '@/types';
import { DEFAULT_INTEGRATION_SETTINGS } from '@/types';
import { loadGoogleWorkspaceSettings } from './googleWorkspaceAuthService';

const STORAGE_KEY = 'hydranote_integration_settings';

/**
 * Load integration settings from localStorage
 */
export function loadIntegrationSettings(): IntegrationSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_INTEGRATION_SETTINGS,
        ...parsed,
      };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_INTEGRATION_SETTINGS };
}

/**
 * Save integration settings to localStorage
 */
export function saveIntegrationSettings(settings: IntegrationSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Toggle a specific integration on/off and persist
 */
export function toggleIntegration(
  settings: IntegrationSettings,
  id: IntegrationId,
  enabled: boolean,
): IntegrationSettings {
  const updated: IntegrationSettings = {
    ...settings,
    [id]: {
      ...settings[id],
      enabled,
      connectedAt: enabled ? new Date().toISOString() : undefined,
    },
  };
  saveIntegrationSettings(updated);
  return updated;
}

/**
 * Check if a specific integration is enabled
 */
export function isIntegrationEnabled(id: IntegrationId): boolean {
  const settings = loadIntegrationSettings();
  return settings[id]?.enabled ?? false;
}

/**
 * Check if a specific Google Workspace app (meet/calendar) is enabled.
 * Requires both the workspace integration toggle AND the per-app toggle.
 */
export function isGoogleAppEnabled(app: GoogleWorkspaceApp): boolean {
  if (!isIntegrationEnabled('google_workspace')) return false;
  const ws = loadGoogleWorkspaceSettings();
  return ws.enabledApps[app] ?? false;
}
