/**
 * Google Calendar Service
 * Handles Google Workspace Service Account authentication (JWT + OAuth)
 * and REST API calls for Google Calendar events.
 * All HTTP requests go through Electron IPC (web:fetch) to bypass CORS.
 */

import type {
  GoogleCalendarSettings,
  GoogleCalendarTokenData,
  GoogleCalendarEvent,
  GoogleCalendarEventsResponse,
  GoogleCalendarListEntry,
  GoogleCalendarListResponse,
} from '../types';
import { DEFAULT_GOOGLE_CALENDAR_SETTINGS } from '../types';

const STORAGE_KEY = 'hydranote_google_calendar_settings';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const SCOPES = 'https://www.googleapis.com/auth/calendar';

// ============================================
// Settings Persistence
// ============================================

export function loadGoogleCalendarSettings(): GoogleCalendarSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_GOOGLE_CALENDAR_SETTINGS,
        ...parsed,
        credentials: {
          ...DEFAULT_GOOGLE_CALENDAR_SETTINGS.credentials,
          ...parsed.credentials,
        },
        syncSettings: {
          ...DEFAULT_GOOGLE_CALENDAR_SETTINGS.syncSettings,
          ...parsed.syncSettings,
        },
      };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_GOOGLE_CALENDAR_SETTINGS };
}

export function saveGoogleCalendarSettings(settings: GoogleCalendarSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// ============================================
// Service Account JSON Parsing
// ============================================

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function parseServiceAccountJson(json: string): ServiceAccountKey {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid Service Account JSON. Please paste the full contents of your downloaded key file.');
  }

  const clientEmail = parsed.client_email as string | undefined;
  const privateKey = parsed.private_key as string | undefined;

  if (!clientEmail || !privateKey) {
    throw new Error('Service Account JSON is missing required fields (client_email, private_key).');
  }

  return {
    client_email: clientEmail,
    private_key: privateKey,
    token_uri: (parsed.token_uri as string) || GOOGLE_TOKEN_URL,
  };
}

// ============================================
// Electron IPC Helper
// ============================================

function isElectronWithIPC(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.web?.fetch;
}

async function calendarFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ success: boolean; status?: number; body?: string; error?: string }> {
  if (!isElectronWithIPC()) {
    throw new Error('Google Calendar API requires Electron IPC (web:fetch). Not available in browser.');
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
// JWT Signing (Web Crypto API)
// ============================================

function base64UrlEncode(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function strToBase64Url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const lines = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s/g, '');
  const binaryStr = atob(lines);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}

async function createSignedJwt(
  serviceAccountEmail: string,
  privateKeyPem: string,
  impersonatedEmail: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccountEmail,
    sub: impersonatedEmail,
    scope: SCOPES,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = strToBase64Url(JSON.stringify(header));
  const encodedPayload = strToBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const keyData = pemToArrayBuffer(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  const encodedSignature = base64UrlEncode(new Uint8Array(signatureBuffer));
  return `${signingInput}.${encodedSignature}`;
}

// ============================================
// OAuth Token Management
// ============================================

export async function getAccessToken(settings?: GoogleCalendarSettings): Promise<string> {
  const s = settings ?? loadGoogleCalendarSettings();
  const { serviceAccountJson, impersonatedUserEmail } = s.credentials;

  if (!serviceAccountJson || !impersonatedUserEmail) {
    throw new Error('Google Calendar credentials are not configured. Please provide Service Account JSON and impersonated user email.');
  }

  if (s.token && s.token.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return s.token.accessToken;
  }

  const sa = parseServiceAccountJson(serviceAccountJson);
  const jwt = await createSignedJwt(sa.client_email, sa.private_key, impersonatedUserEmail);

  const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`;

  const result = await calendarFetch(sa.token_uri || GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!result.success || !result.body) {
    throw new Error(result.error || 'Failed to obtain Google access token');
  }

  let parsed: { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  try {
    parsed = JSON.parse(result.body);
  } catch {
    throw new Error('Invalid response from Google OAuth endpoint');
  }

  if (parsed.error) {
    throw new Error(`Google OAuth error: ${parsed.error} - ${parsed.error_description ?? ''}`);
  }

  if (!parsed.access_token || !parsed.expires_in) {
    throw new Error('Google OAuth response missing access_token or expires_in');
  }

  const tokenData: GoogleCalendarTokenData = {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + parsed.expires_in * 1000,
  };

  const updated: GoogleCalendarSettings = { ...s, token: tokenData };
  saveGoogleCalendarSettings(updated);

  return tokenData.accessToken;
}

// ============================================
// API Calls
// ============================================

/**
 * Test the Google Calendar connection by listing calendars.
 * Returns the impersonated user email on success.
 */
export async function testConnection(settings?: GoogleCalendarSettings): Promise<string> {
  const s = settings ?? loadGoogleCalendarSettings();
  const token = await getAccessToken(s);

  const result = await calendarFetch(`${CALENDAR_API_BASE}/users/me/calendarList?maxResults=1`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!result.success || !result.body) {
    throw new Error(result.error || 'Failed to connect to Google Calendar API');
  }

  let parsed: { items?: unknown[]; error?: { message?: string; code?: number } };
  try {
    parsed = JSON.parse(result.body);
  } catch {
    throw new Error('Invalid response from Google Calendar API');
  }

  if (parsed.error) {
    throw new Error(`Google Calendar API error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`);
  }

  return s.credentials.impersonatedUserEmail;
}

/**
 * List all calendars the impersonated user has access to.
 */
export async function listCalendars(settings?: GoogleCalendarSettings): Promise<GoogleCalendarListEntry[]> {
  const token = await getAccessToken(settings);
  const allCalendars: GoogleCalendarListEntry[] = [];
  let nextPageToken = '';

  do {
    const params = new URLSearchParams({ maxResults: '250' });
    if (nextPageToken) {
      params.set('pageToken', nextPageToken);
    }

    const result = await calendarFetch(
      `${CALENDAR_API_BASE}/users/me/calendarList?${params.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!result.success || !result.body) {
      throw new Error(result.error || 'Failed to fetch calendar list');
    }

    let parsed: GoogleCalendarListResponse & { error?: { message?: string } };
    try {
      parsed = JSON.parse(result.body);
    } catch {
      throw new Error('Invalid response from Google Calendar list API');
    }

    if (parsed.error) {
      throw new Error(`Google Calendar API error: ${parsed.error.message}`);
    }

    if (parsed.items) {
      allCalendars.push(...parsed.items);
    }

    nextPageToken = parsed.nextPageToken || '';
  } while (nextPageToken);

  return allCalendars;
}

/**
 * List events from a specific calendar within a date range.
 * Handles pagination automatically.
 */
export async function listEvents(
  calendarId: string,
  timeMin: string,
  timeMax: string,
  settings?: GoogleCalendarSettings,
): Promise<GoogleCalendarEvent[]> {
  const token = await getAccessToken(settings);
  const allEvents: GoogleCalendarEvent[] = [];
  let nextPageToken = '';

  do {
    const params = new URLSearchParams({
      maxResults: '250',
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    if (nextPageToken) {
      params.set('pageToken', nextPageToken);
    }

    const result = await calendarFetch(
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!result.success || !result.body) {
      throw new Error(result.error || 'Failed to fetch calendar events');
    }

    let parsed: GoogleCalendarEventsResponse & { error?: { message?: string } };
    try {
      parsed = JSON.parse(result.body);
    } catch {
      throw new Error('Invalid response from Google Calendar events API');
    }

    if (parsed.error) {
      throw new Error(`Google Calendar API error: ${parsed.error.message}`);
    }

    if (parsed.items) {
      allEvents.push(...parsed.items);
    }

    nextPageToken = parsed.nextPageToken || '';
  } while (nextPageToken);

  return allEvents;
}

// ============================================
// Create Event
// ============================================

/**
 * Create a new event on the specified calendar.
 */
export async function createEvent(
  calendarId: string,
  event: {
    summary: string;
    start: { dateTime?: string; date?: string; timeZone?: string };
    end: { dateTime?: string; date?: string; timeZone?: string };
    description?: string;
    location?: string;
    attendees?: Array<{ email: string }>;
  },
  settings?: GoogleCalendarSettings,
): Promise<GoogleCalendarEvent> {
  const token = await getAccessToken(settings);

  const result = await calendarFetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    },
  );

  if (!result.success || !result.body) {
    throw new Error(result.error || 'Failed to create calendar event');
  }

  let parsed: GoogleCalendarEvent & { error?: { message?: string } };
  try {
    parsed = JSON.parse(result.body);
  } catch {
    throw new Error('Invalid response from Google Calendar API');
  }

  if ((parsed as unknown as { error?: { message?: string } }).error) {
    throw new Error(`Google Calendar API error: ${(parsed as unknown as { error: { message: string } }).error.message}`);
  }

  return parsed;
}

/**
 * Get upcoming events for the next N hours (used for system prompt injection).
 * Returns a compact formatted string of today's events.
 */
export async function getUpcomingEventsForContext(
  hoursAhead: number = 24,
  settings?: GoogleCalendarSettings,
): Promise<string> {
  const s = settings ?? loadGoogleCalendarSettings();
  const { serviceAccountJson, impersonatedUserEmail } = s.credentials;

  if (!serviceAccountJson || !impersonatedUserEmail) {
    return '';
  }

  try {
    const now = new Date();
    const end = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
    const timeMin = now.toISOString();
    const timeMax = end.toISOString();

    const calendarIds = s.syncSettings.selectedCalendarIds.length > 0
      ? s.syncSettings.selectedCalendarIds
      : ['primary'];

    const allEvents: GoogleCalendarEvent[] = [];
    for (const calId of calendarIds) {
      try {
        const events = await listEvents(calId, timeMin, timeMax, s);
        allEvents.push(...events);
      } catch {
        // Skip calendars that fail
      }
    }

    if (allEvents.length === 0) return '';

    allEvents.sort((a, b) => {
      const aTime = a.start.dateTime || a.start.date || '';
      const bTime = b.start.dateTime || b.start.date || '';
      return aTime.localeCompare(bTime);
    });

    const lines = allEvents
      .filter(e => e.status !== 'cancelled' && e.summary?.trim())
      .slice(0, 10)
      .map(e => {
        const startStr = formatEventDateTime(e.start);
        const attendeeCount = e.attendees?.length || 0;
        const parts = [`- **${e.summary}** — ${startStr}`];
        if (e.location) parts.push(`  Location: ${e.location}`);
        if (attendeeCount > 0) parts.push(`  ${attendeeCount} attendee(s)`);
        if (e.hangoutLink) parts.push(`  [Google Meet](${e.hangoutLink})`);
        return parts.join('\n');
      });

    return lines.join('\n');
  } catch {
    return '';
  }
}

// ============================================
// Helpers
// ============================================

/**
 * Filter out already-synced and cancelled events.
 */
export function filterNewEvents(
  events: GoogleCalendarEvent[],
  syncedEventIds: string[],
): GoogleCalendarEvent[] {
  const syncedSet = new Set(syncedEventIds);

  return events.filter((event) => {
    if (!event.id || syncedSet.has(event.id)) return false;
    if (event.status === 'cancelled') return false;
    if (!event.summary?.trim()) return false;
    return true;
  });
}

/**
 * Format a calendar event's date/time for display.
 */
function formatEventDateTime(dt: { dateTime?: string; date?: string }): string {
  if (dt.dateTime) {
    try {
      return new Date(dt.dateTime).toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dt.dateTime;
    }
  }
  if (dt.date) {
    try {
      const d = new Date(dt.date + 'T00:00:00');
      return d.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }) + ' (All day)';
    } catch {
      return dt.date;
    }
  }
  return 'Unknown';
}

/**
 * Format a Google Calendar event into a Markdown note.
 */
export function formatEventToMarkdown(
  event: GoogleCalendarEvent,
  calendarName?: string,
): string {
  const parts: string[] = [];

  const title = event.summary || 'Untitled Event';
  parts.push(`# ${title}`);

  const startStr = formatEventDateTime(event.start);
  const endStr = formatEventDateTime(event.end);

  if (event.start.date && !event.start.dateTime) {
    parts.push(`**Date:** ${startStr}`);
  } else {
    parts.push(`**Date:** ${startStr} — ${endStr}`);
  }

  if (event.location) {
    parts.push(`**Location:** ${event.location}`);
  }

  if (calendarName) {
    parts.push(`**Calendar:** ${calendarName}`);
  }

  if (event.attendees && event.attendees.length > 0) {
    parts.push('## Attendees');
    const attendeeLines = event.attendees.map((a) => {
      const name = a.displayName || a.email;
      const status = a.responseStatus
        ? ` (${a.responseStatus})`
        : '';
      const role = a.organizer ? ' — Organizer' : '';
      return `- ${name}${role}${status}`;
    });
    parts.push(attendeeLines.join('\n'));
  }

  if (event.description) {
    parts.push('## Description');
    parts.push(event.description.trim());
  }

  if (event.hangoutLink) {
    parts.push('## Meeting Link');
    parts.push(`[Join Google Meet](${event.hangoutLink})`);
  }

  parts.push('---');
  parts.push('*Synced from Google Calendar*');

  return parts.join('\n\n') + '\n';
}

/**
 * Get a date string prefix for file naming from an event.
 */
export function getEventDatePrefix(event: GoogleCalendarEvent): string {
  const dateStr = event.start.dateTime || event.start.date || '';
  try {
    return new Date(dateStr).toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Sanitize a string for use as a file name.
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 100);
}
