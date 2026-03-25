/**
 * Google Workspace Auth Service
 * Shared authentication infrastructure for Google Meet and Google Calendar.
 * Uses OAuth 2.0 Authorization Code flow with loopback redirect.
 * Token refresh is handled via Electron IPC (google:refreshToken).
 * All HTTP requests go through Electron IPC (web:fetch) to bypass CORS.
 */

import type { GoogleWorkspaceSettings, GoogleWorkspaceTokenData } from '../types';
import { DEFAULT_GOOGLE_WORKSPACE_SETTINGS } from '../types';

const STORAGE_KEY = 'hydranote_google_workspace_settings';
const LEGACY_MEET_KEY = 'hydranote_google_meet_settings';
const LEGACY_CALENDAR_KEY = 'hydranote_google_calendar_settings';
const LEGACY_INTEGRATION_KEY = 'hydranote_integration_settings';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const MEET_SCOPES = [
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/drive.meet.readonly',
];

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
];

export { MEET_SCOPES, CALENDAR_SCOPES };

// ============================================
// Migration from legacy keys
// ============================================

let migrationDone = false;

function migrateLegacySettings(): GoogleWorkspaceSettings | null {
  if (migrationDone) return null;
  migrationDone = true;

  const existingWorkspace = localStorage.getItem(STORAGE_KEY);
  if (existingWorkspace) {
    // Check if stored settings use old service-account format and clear credentials
    try {
      const parsed = JSON.parse(existingWorkspace);
      if (parsed.credentials?.serviceAccountJson) {
        parsed.credentials = { clientId: '', clientSecret: '' };
        parsed.token = undefined;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      }
    } catch { /* ignore */ }
    return null;
  }

  const legacyMeetRaw = localStorage.getItem(LEGACY_MEET_KEY);
  const legacyCalRaw = localStorage.getItem(LEGACY_CALENDAR_KEY);

  if (!legacyMeetRaw && !legacyCalRaw) return null;

  const ws: GoogleWorkspaceSettings = { ...DEFAULT_GOOGLE_WORKSPACE_SETTINGS };

  let legacyMeet: Record<string, unknown> | null = null;
  let legacyCal: Record<string, unknown> | null = null;

  try { if (legacyMeetRaw) legacyMeet = JSON.parse(legacyMeetRaw); } catch { /* ignore */ }
  try { if (legacyCalRaw) legacyCal = JSON.parse(legacyCalRaw); } catch { /* ignore */ }

  // Legacy credentials used service accounts -- cannot be migrated to OAuth.
  // Preserve only sync settings and app toggles; user must re-authenticate.

  if (legacyMeet) {
    const meetSync = legacyMeet.syncSettings as Record<string, unknown> | undefined;
    ws.enabledApps.meet = true;
    if (meetSync) {
      ws.meetSyncSettings = {
        syncIntervalMinutes: (meetSync.syncIntervalMinutes as number) || 5,
        targetProjectId: meetSync.targetProjectId as string | undefined,
        lastSyncTime: meetSync.lastSyncTime as string | undefined,
        syncedConferenceNames: (meetSync.syncedConferenceNames as string[]) || [],
      };
    }
  }

  if (legacyCal) {
    const calSync = legacyCal.syncSettings as Record<string, unknown> | undefined;
    ws.enabledApps.calendar = true;
    if (calSync) {
      ws.calendarSyncSettings = {
        syncIntervalMinutes: (calSync.syncIntervalMinutes as number) || 5,
        targetProjectId: calSync.targetProjectId as string | undefined,
        lastSyncTime: calSync.lastSyncTime as string | undefined,
        syncedEventIds: (calSync.syncedEventIds as string[]) || [],
        selectedCalendarIds: (calSync.selectedCalendarIds as string[]) || [],
        pastDays: (calSync.pastDays as number) || 7,
        futureDays: (calSync.futureDays as number) || 7,
      };
    }
  }

  // Migrate integration_settings toggle
  try {
    const legacyIntRaw = localStorage.getItem(LEGACY_INTEGRATION_KEY);
    if (legacyIntRaw) {
      const legacyInt = JSON.parse(legacyIntRaw) as Record<string, { enabled?: boolean }>;
      const meetEnabled = legacyInt.google_meet?.enabled;
      const calEnabled = legacyInt.google_calendar?.enabled;
      if (meetEnabled || calEnabled) {
        legacyInt.google_workspace = { enabled: true };
        delete legacyInt.google_meet;
        delete legacyInt.google_calendar;
        localStorage.setItem(LEGACY_INTEGRATION_KEY, JSON.stringify(legacyInt));
        if (meetEnabled) ws.enabledApps.meet = true;
        if (calEnabled) ws.enabledApps.calendar = true;
      }
    }
  } catch { /* ignore */ }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));

  localStorage.removeItem(LEGACY_MEET_KEY);
  localStorage.removeItem(LEGACY_CALENDAR_KEY);

  return ws;
}

// ============================================
// Settings Persistence
// ============================================

export function loadGoogleWorkspaceSettings(): GoogleWorkspaceSettings {
  const migrated = migrateLegacySettings();
  if (migrated) return migrated;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_GOOGLE_WORKSPACE_SETTINGS,
        ...parsed,
        credentials: {
          ...DEFAULT_GOOGLE_WORKSPACE_SETTINGS.credentials,
          ...parsed.credentials,
        },
        enabledApps: {
          ...DEFAULT_GOOGLE_WORKSPACE_SETTINGS.enabledApps,
          ...parsed.enabledApps,
        },
        meetSyncSettings: {
          ...DEFAULT_GOOGLE_WORKSPACE_SETTINGS.meetSyncSettings,
          ...parsed.meetSyncSettings,
        },
        calendarSyncSettings: {
          ...DEFAULT_GOOGLE_WORKSPACE_SETTINGS.calendarSyncSettings,
          ...parsed.calendarSyncSettings,
        },
      };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_GOOGLE_WORKSPACE_SETTINGS };
}

export function saveGoogleWorkspaceSettings(settings: GoogleWorkspaceSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// ============================================
// Electron IPC Helper
// ============================================

function isElectronWithIPC(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.web?.fetch;
}

function isElectronWithGoogleOAuth(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.google?.startOAuth;
}

export async function googleFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ success: boolean; status?: number; body?: string; error?: string }> {
  if (!isElectronWithIPC()) {
    throw new Error('Google Workspace API requires Electron IPC (web:fetch). Not available in browser.');
  }

  const result = await window.electronAPI!.web.fetch({
    url,
    method: options.method ?? 'GET',
    headers: options.headers ?? {},
    body: options.body,
    timeout: 30000,
  });

  return result;
}

// ============================================
// OAuth 2.0 Token Management
// ============================================

/**
 * Build the combined scopes string based on enabled apps.
 */
export function buildScopesForEnabledApps(settings: GoogleWorkspaceSettings): string {
  const scopes: string[] = [];
  if (settings.enabledApps.meet) scopes.push(...MEET_SCOPES);
  if (settings.enabledApps.calendar) scopes.push(...CALENDAR_SCOPES);
  if (scopes.length === 0) scopes.push(...MEET_SCOPES, ...CALENDAR_SCOPES);
  return scopes.join(' ');
}

/**
 * Start the OAuth 2.0 Authorization Code flow via Electron IPC.
 * Opens the user's browser for Google consent, captures the auth code via
 * a loopback HTTP server, exchanges for tokens, and persists them.
 */
export async function startGoogleOAuth(settings: GoogleWorkspaceSettings): Promise<{
  success: boolean;
  email?: string;
  error?: string;
}> {
  if (!isElectronWithGoogleOAuth()) {
    throw new Error('Google OAuth requires the Electron desktop app.');
  }

  const { clientId, clientSecret } = settings.credentials;
  if (!clientId || !clientSecret) {
    throw new Error('Client ID and Client Secret are required. Create an OAuth 2.0 Client ID in Google Cloud Console.');
  }

  const scopes = buildScopesForEnabledApps(settings);

  const result = await window.electronAPI!.google.startOAuth({ clientId, clientSecret, scopes });

  if (!result.success || !result.accessToken) {
    return { success: false, error: result.error || 'OAuth flow failed' };
  }

  const tokenData: GoogleWorkspaceTokenData = {
    accessToken: result.accessToken,
    expiresAt: result.expiresAt || Date.now() + 3600 * 1000,
  };

  const updated: GoogleWorkspaceSettings = {
    ...settings,
    credentials: {
      ...settings.credentials,
      refreshToken: result.refreshToken,
      userEmail: result.email,
    },
    token: tokenData,
  };
  saveGoogleWorkspaceSettings(updated);

  return { success: true, email: result.email };
}

/**
 * Obtain a valid Google access token.
 * Uses a cached token if still fresh, otherwise refreshes via the stored refresh token.
 */
export async function getWorkspaceAccessToken(settings?: GoogleWorkspaceSettings): Promise<string> {
  const s = settings ?? loadGoogleWorkspaceSettings();
  const { clientId, clientSecret, refreshToken } = s.credentials;

  if (!clientId || !clientSecret) {
    throw new Error('Google Workspace credentials are not configured. Please set up your Client ID and Client Secret in Settings > Integrations.');
  }

  if (!refreshToken) {
    throw new Error('Not signed in to Google. Please click "Sign in with Google" in Settings > Integrations > Google Workspace.');
  }

  if (s.token && s.token.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return s.token.accessToken;
  }

  // Refresh the token via Electron IPC
  if (!isElectronWithGoogleOAuth()) {
    throw new Error('Token refresh requires the Electron desktop app.');
  }

  const result = await window.electronAPI!.google.refreshToken({ clientId, clientSecret, refreshToken });

  if (!result.success || !result.accessToken) {
    // If refresh failed, the token may have been revoked
    throw new Error(result.error || 'Token refresh failed. You may need to sign in again in Settings > Integrations > Google Workspace.');
  }

  const tokenData: GoogleWorkspaceTokenData = {
    accessToken: result.accessToken,
    expiresAt: result.expiresAt || Date.now() + 3600 * 1000,
  };

  const updated: GoogleWorkspaceSettings = { ...s, token: tokenData };
  saveGoogleWorkspaceSettings(updated);

  return tokenData.accessToken;
}
