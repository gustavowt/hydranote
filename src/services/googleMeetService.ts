/**
 * Google Meet Service
 * Handles REST API calls for Meet conference records and Drive transcript export.
 * Authentication is delegated to googleWorkspaceAuthService.
 */

import type {
  GoogleMeetConferenceRecord,
  GoogleMeetConferenceRecordsResponse,
  GoogleMeetTranscript,
  GoogleMeetTranscriptsResponse,
  GoogleWorkspaceSettings,
} from '../types';
import {
  loadGoogleWorkspaceSettings,
  getWorkspaceAccessToken,
  googleFetch,
} from './googleWorkspaceAuthService';

const MEET_API_BASE = 'https://meet.googleapis.com/v2';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

// ============================================
// API Calls
// ============================================

/**
 * Test the Google Meet connection by listing 1 conference record.
 * Returns the impersonated user email on success.
 */
export async function testMeetConnection(settings?: GoogleWorkspaceSettings): Promise<string> {
  const s = settings ?? loadGoogleWorkspaceSettings();
  const token = await getWorkspaceAccessToken(s);

  const result = await googleFetch(`${MEET_API_BASE}/conferenceRecords?pageSize=1`, {
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

  return s.credentials.userEmail || 'Connected';
}

/**
 * List conference records within a date range.
 * Uses the `end_time` filter to scope results.
 * Handles pagination automatically.
 */
export async function listConferenceRecords(
  from: string,
  to: string,
  settings?: GoogleWorkspaceSettings,
): Promise<GoogleMeetConferenceRecord[]> {
  const token = await getWorkspaceAccessToken(settings);
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

    const result = await googleFetch(
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
  settings?: GoogleWorkspaceSettings,
): Promise<GoogleMeetTranscript[]> {
  const token = await getWorkspaceAccessToken(settings);
  const allTranscripts: GoogleMeetTranscript[] = [];
  let nextPageToken = '';

  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (nextPageToken) {
      params.set('pageToken', nextPageToken);
    }

    const result = await googleFetch(
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
  settings?: GoogleWorkspaceSettings,
): Promise<string> {
  const token = await getWorkspaceAccessToken(settings);

  const result = await googleFetch(
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
 * The space field is like "spaces/abc123" -- we use the code as fallback.
 */
export function getMeetingTopic(record: GoogleMeetConferenceRecord): string {
  const spaceCode = record.space?.split('/').pop() || 'unknown';
  return `Google Meet - ${spaceCode}`;
}
