/**
 * Zoom Service
 * Handles Zoom Server-to-Server OAuth authentication and REST API calls.
 * All HTTP requests go through Electron IPC (web:fetch) to bypass CORS.
 */

import type {
  ZoomSettings,
  ZoomTokenData,
  ZoomMeeting,
  ZoomRecordingsResponse,
} from '../types';
import { DEFAULT_ZOOM_SETTINGS } from '../types';

const STORAGE_KEY = 'hydranote_zoom_settings';
const ZOOM_OAUTH_URL = 'https://zoom.us/oauth/token';
const ZOOM_API_BASE = 'https://api.zoom.us/v2';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

// ============================================
// Settings Persistence
// ============================================

export function loadZoomSettings(): ZoomSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_ZOOM_SETTINGS,
        ...parsed,
        credentials: {
          ...DEFAULT_ZOOM_SETTINGS.credentials,
          ...parsed.credentials,
        },
        syncSettings: {
          ...DEFAULT_ZOOM_SETTINGS.syncSettings,
          ...parsed.syncSettings,
        },
      };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_ZOOM_SETTINGS };
}

export function saveZoomSettings(settings: ZoomSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// ============================================
// Electron IPC Helper
// ============================================

function isElectronWithIPC(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.web?.fetch;
}

async function zoomFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ success: boolean; status?: number; body?: string; error?: string }> {
  if (!isElectronWithIPC()) {
    throw new Error('Zoom API requires Electron IPC (web:fetch). Not available in browser.');
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
// OAuth Token Management
// ============================================

/**
 * Obtain or refresh a Zoom access token using Server-to-Server OAuth.
 * Caches the token in settings and returns it. Refreshes if expired or about to expire.
 */
export async function getAccessToken(settings?: ZoomSettings): Promise<string> {
  const s = settings ?? loadZoomSettings();
  const { accountId, clientId, clientSecret } = s.credentials;

  if (!accountId || !clientId || !clientSecret) {
    throw new Error('Zoom credentials are not configured. Please enter Account ID, Client ID, and Client Secret.');
  }

  // Return cached token if still valid
  if (s.token && s.token.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return s.token.accessToken;
  }

  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const body = `grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`;

  const result = await zoomFetch(ZOOM_OAUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!result.success || !result.body) {
    throw new Error(result.error || 'Failed to obtain Zoom access token');
  }

  let parsed: { access_token?: string; expires_in?: number; error?: string; reason?: string };
  try {
    parsed = JSON.parse(result.body);
  } catch {
    throw new Error('Invalid response from Zoom OAuth endpoint');
  }

  if (parsed.error) {
    throw new Error(`Zoom OAuth error: ${parsed.error} - ${parsed.reason ?? ''}`);
  }

  if (!parsed.access_token || !parsed.expires_in) {
    throw new Error('Zoom OAuth response missing access_token or expires_in');
  }

  const tokenData: ZoomTokenData = {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + parsed.expires_in * 1000,
  };

  // Persist token
  const updated: ZoomSettings = { ...s, token: tokenData };
  saveZoomSettings(updated);

  return tokenData.accessToken;
}

// ============================================
// API Calls
// ============================================

/**
 * Test the Zoom connection by requesting the current user profile.
 * Returns the user's display name on success.
 */
export async function testConnection(settings?: ZoomSettings): Promise<string> {
  const token = await getAccessToken(settings);

  const result = await zoomFetch(`${ZOOM_API_BASE}/users/me`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!result.success || !result.body) {
    throw new Error(result.error || 'Failed to connect to Zoom API');
  }

  let parsed: { first_name?: string; last_name?: string; email?: string; code?: number; message?: string };
  try {
    parsed = JSON.parse(result.body);
  } catch {
    throw new Error('Invalid response from Zoom API');
  }

  if (parsed.code && parsed.message) {
    throw new Error(`Zoom API error: ${parsed.message}`);
  }

  const displayName = [parsed.first_name, parsed.last_name].filter(Boolean).join(' ') || parsed.email || 'Unknown';
  return displayName;
}

/**
 * List cloud recordings within a date range.
 * Handles pagination automatically.
 */
export async function listRecordings(
  from: string,
  to: string,
  settings?: ZoomSettings,
): Promise<ZoomMeeting[]> {
  const token = await getAccessToken(settings);
  const allMeetings: ZoomMeeting[] = [];
  let nextPageToken = '';

  do {
    const params = new URLSearchParams({
      from,
      to,
      page_size: '100',
    });
    if (nextPageToken) {
      params.set('next_page_token', nextPageToken);
    }

    const result = await zoomFetch(
      `${ZOOM_API_BASE}/users/me/recordings?${params.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!result.success || !result.body) {
      throw new Error(result.error || 'Failed to fetch Zoom recordings');
    }

    let parsed: ZoomRecordingsResponse & { code?: number; message?: string };
    try {
      parsed = JSON.parse(result.body);
    } catch {
      throw new Error('Invalid response from Zoom recordings API');
    }

    if (parsed.code && parsed.message) {
      throw new Error(`Zoom API error: ${parsed.message}`);
    }

    if (parsed.meetings) {
      allMeetings.push(...parsed.meetings);
    }

    nextPageToken = parsed.next_page_token || '';
  } while (nextPageToken);

  return allMeetings;
}

/**
 * Download a transcript file (VTT) from a Zoom recording download URL.
 * Zoom download URLs require the access token as a query parameter.
 */
export async function downloadTranscript(
  downloadUrl: string,
  settings?: ZoomSettings,
): Promise<string> {
  const token = await getAccessToken(settings);

  const separator = downloadUrl.includes('?') ? '&' : '?';
  const url = `${downloadUrl}${separator}access_token=${token}`;

  const result = await zoomFetch(url, {
    headers: {
      'Accept': 'text/vtt,text/plain,*/*',
    },
  });

  if (!result.success || !result.body) {
    throw new Error(result.error || 'Failed to download Zoom transcript');
  }

  return result.body;
}

/**
 * Get meetings that have transcript recordings, filtering out already-synced ones.
 */
export function filterNewMeetingsWithTranscripts(
  meetings: ZoomMeeting[],
  syncedUuids: string[],
): ZoomMeeting[] {
  const syncedSet = new Set(syncedUuids);

  return meetings.filter((meeting) => {
    if (syncedSet.has(meeting.uuid)) return false;

    const hasTranscript = meeting.recording_files?.some(
      (f) => f.file_type === 'TRANSCRIPT' && f.status === 'completed',
    );

    return hasTranscript;
  });
}

/**
 * Get the transcript download URL from a meeting's recording files.
 */
export function getTranscriptDownloadUrl(meeting: ZoomMeeting): string | null {
  const transcriptFile = meeting.recording_files?.find(
    (f) => f.file_type === 'TRANSCRIPT' && f.status === 'completed',
  );
  return transcriptFile?.download_url ?? null;
}
