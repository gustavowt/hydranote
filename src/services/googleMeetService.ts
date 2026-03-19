/**
 * Google Meet Service
 * Handles Google Workspace Service Account authentication (JWT + OAuth)
 * and REST API calls for Meet conference records and Drive transcript export.
 * All HTTP requests go through Electron IPC (web:fetch) to bypass CORS.
 */

import type {
  GoogleMeetSettings,
  GoogleMeetTokenData,
  GoogleMeetConferenceRecord,
  GoogleMeetConferenceRecordsResponse,
  GoogleMeetTranscript,
  GoogleMeetTranscriptsResponse,
} from '../types';
import { DEFAULT_GOOGLE_MEET_SETTINGS } from '../types';

const STORAGE_KEY = 'hydranote_google_meet_settings';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MEET_API_BASE = 'https://meet.googleapis.com/v2';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const SCOPES = [
  'https://www.googleapis.com/auth/meetings.space',
  'https://www.googleapis.com/auth/drive.meet.readonly',
].join(' ');

// ============================================
// Settings Persistence
// ============================================

export function loadGoogleMeetSettings(): GoogleMeetSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_GOOGLE_MEET_SETTINGS,
        ...parsed,
        credentials: {
          ...DEFAULT_GOOGLE_MEET_SETTINGS.credentials,
          ...parsed.credentials,
        },
        syncSettings: {
          ...DEFAULT_GOOGLE_MEET_SETTINGS.syncSettings,
          ...parsed.syncSettings,
        },
      };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_GOOGLE_MEET_SETTINGS };
}

export function saveGoogleMeetSettings(settings: GoogleMeetSettings): void {
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

async function meetFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ success: boolean; status?: number; body?: string; error?: string }> {
  if (!isElectronWithIPC()) {
    throw new Error('Google Meet API requires Electron IPC (web:fetch). Not available in browser.');
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

/**
 * Obtain or refresh a Google access token using Service Account JWT.
 * Caches the token in settings and returns it. Refreshes if expired or about to expire.
 */
export async function getAccessToken(settings?: GoogleMeetSettings): Promise<string> {
  const s = settings ?? loadGoogleMeetSettings();
  const { serviceAccountJson, impersonatedUserEmail } = s.credentials;

  if (!serviceAccountJson || !impersonatedUserEmail) {
    throw new Error('Google Meet credentials are not configured. Please provide Service Account JSON and impersonated user email.');
  }

  if (s.token && s.token.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return s.token.accessToken;
  }

  const sa = parseServiceAccountJson(serviceAccountJson);
  const jwt = await createSignedJwt(sa.client_email, sa.private_key, impersonatedUserEmail);

  const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`;

  const result = await meetFetch(sa.token_uri || GOOGLE_TOKEN_URL, {
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

  const tokenData: GoogleMeetTokenData = {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + parsed.expires_in * 1000,
  };

  const updated: GoogleMeetSettings = { ...s, token: tokenData };
  saveGoogleMeetSettings(updated);

  return tokenData.accessToken;
}

// ============================================
// API Calls
// ============================================

/**
 * Test the Google Meet connection by listing 1 conference record.
 * Returns the impersonated user email on success.
 */
export async function testConnection(settings?: GoogleMeetSettings): Promise<string> {
  const s = settings ?? loadGoogleMeetSettings();
  const token = await getAccessToken(s);

  const result = await meetFetch(`${MEET_API_BASE}/conferenceRecords?pageSize=1`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!result.success || !result.body) {
    throw new Error(result.error || 'Failed to connect to Google Meet API');
  }

  let parsed: { conferenceRecords?: unknown[]; error?: { message?: string; code?: number } };
  try {
    parsed = JSON.parse(result.body);
  } catch {
    throw new Error('Invalid response from Google Meet API');
  }

  if (parsed.error) {
    throw new Error(`Google Meet API error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`);
  }

  return s.credentials.impersonatedUserEmail;
}

/**
 * List conference records within a date range.
 * Uses the `end_time` filter to scope results.
 * Handles pagination automatically.
 */
export async function listConferenceRecords(
  from: string,
  to: string,
  settings?: GoogleMeetSettings,
): Promise<GoogleMeetConferenceRecord[]> {
  const token = await getAccessToken(settings);
  const allRecords: GoogleMeetConferenceRecord[] = [];
  let nextPageToken = '';

  const fromRfc = new Date(from).toISOString();
  const toRfc = new Date(to + 'T23:59:59Z').toISOString();
  const filter = `end_time>="${fromRfc}" AND end_time<="${toRfc}"`;

  do {
    const params = new URLSearchParams({
      pageSize: '100',
      filter,
    });
    if (nextPageToken) {
      params.set('pageToken', nextPageToken);
    }

    const result = await meetFetch(
      `${MEET_API_BASE}/conferenceRecords?${params.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!result.success || !result.body) {
      throw new Error(result.error || 'Failed to fetch Google Meet conference records');
    }

    let parsed: GoogleMeetConferenceRecordsResponse & { error?: { message?: string } };
    try {
      parsed = JSON.parse(result.body);
    } catch {
      throw new Error('Invalid response from Google Meet conference records API');
    }

    if (parsed.error) {
      throw new Error(`Google Meet API error: ${parsed.error.message}`);
    }

    if (parsed.conferenceRecords) {
      allRecords.push(...parsed.conferenceRecords);
    }

    nextPageToken = parsed.nextPageToken || '';
  } while (nextPageToken);

  return allRecords;
}

/**
 * List transcripts for a given conference record.
 */
export async function listTranscripts(
  conferenceRecordName: string,
  settings?: GoogleMeetSettings,
): Promise<GoogleMeetTranscript[]> {
  const token = await getAccessToken(settings);
  const allTranscripts: GoogleMeetTranscript[] = [];
  let nextPageToken = '';

  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (nextPageToken) {
      params.set('pageToken', nextPageToken);
    }

    const result = await meetFetch(
      `${MEET_API_BASE}/${conferenceRecordName}/transcripts?${params.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!result.success || !result.body) {
      throw new Error(result.error || 'Failed to fetch transcripts');
    }

    let parsed: GoogleMeetTranscriptsResponse & { error?: { message?: string } };
    try {
      parsed = JSON.parse(result.body);
    } catch {
      throw new Error('Invalid response from transcripts API');
    }

    if (parsed.error) {
      throw new Error(`Google Meet API error: ${parsed.error.message}`);
    }

    if (parsed.transcripts) {
      allTranscripts.push(...parsed.transcripts);
    }

    nextPageToken = parsed.nextPageToken || '';
  } while (nextPageToken);

  return allTranscripts;
}

/**
 * Download a transcript document from Google Drive as plain text.
 * Uses the Drive export API to get the Google Doc content.
 */
export async function downloadTranscriptDoc(
  documentId: string,
  settings?: GoogleMeetSettings,
): Promise<string> {
  const token = await getAccessToken(settings);

  const result = await meetFetch(
    `${DRIVE_API_BASE}/files/${documentId}/export?mimeType=text/plain`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/plain',
      },
    },
  );

  if (!result.success || !result.body) {
    throw new Error(result.error || 'Failed to download transcript document');
  }

  return result.body;
}

/**
 * Get conference records that have completed transcripts, filtering out already-synced ones.
 */
export function filterNewConferencesWithTranscripts(
  records: GoogleMeetConferenceRecord[],
  transcriptsMap: Map<string, GoogleMeetTranscript[]>,
  syncedNames: string[],
): GoogleMeetConferenceRecord[] {
  const syncedSet = new Set(syncedNames);

  return records.filter((record) => {
    if (syncedSet.has(record.name)) return false;

    const transcripts = transcriptsMap.get(record.name);
    if (!transcripts || transcripts.length === 0) return false;

    return transcripts.some((t) => t.state === 'FILE_GENERATED' && t.docsDestination?.document);
  });
}

/**
 * Get the first completed transcript's document ID from a list of transcripts.
 */
export function getTranscriptDocumentId(transcripts: GoogleMeetTranscript[]): string | null {
  const completed = transcripts.find(
    (t) => t.state === 'FILE_GENERATED' && t.docsDestination?.document,
  );
  return completed?.docsDestination?.document ?? null;
}

/**
 * Extract a readable meeting topic from a conference record.
 * The space field is like "spaces/abc123" — we use the code as fallback.
 */
export function getMeetingTopic(record: GoogleMeetConferenceRecord): string {
  const spaceCode = record.space?.split('/').pop() || 'unknown';
  return `Google Meet - ${spaceCode}`;
}
