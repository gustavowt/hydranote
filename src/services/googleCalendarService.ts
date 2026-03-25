/**
 * Google Calendar Service
 * Handles REST API calls for Google Calendar events.
 * Authentication is delegated to googleWorkspaceAuthService.
 */

import type {
  GoogleCalendarEvent,
  GoogleCalendarEventsResponse,
  GoogleCalendarListEntry,
  GoogleCalendarListResponse,
  GoogleWorkspaceSettings,
} from '../types';
import {
  loadGoogleWorkspaceSettings,
  getWorkspaceAccessToken,
  googleFetch,
} from './googleWorkspaceAuthService';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

// ============================================
// API Calls
// ============================================

/**
 * Test the Google Calendar connection by listing calendars.
 * Returns the impersonated user email on success.
 */
export async function testCalendarConnection(settings?: GoogleWorkspaceSettings): Promise<string> {
  const s = settings ?? loadGoogleWorkspaceSettings();
  const token = await getWorkspaceAccessToken(s);

  const result = await googleFetch(`${CALENDAR_API_BASE}/users/me/calendarList?maxResults=1`, {
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

  return s.credentials.userEmail || 'Connected';
}

/**
 * List all calendars the impersonated user has access to.
 */
export async function listCalendars(settings?: GoogleWorkspaceSettings): Promise<GoogleCalendarListEntry[]> {
  const token = await getWorkspaceAccessToken(settings);
  const allCalendars: GoogleCalendarListEntry[] = [];
  let nextPageToken = '';

  do {
    const params = new URLSearchParams({ maxResults: '250' });
    if (nextPageToken) {
      params.set('pageToken', nextPageToken);
    }

    const result = await googleFetch(
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
  settings?: GoogleWorkspaceSettings,
): Promise<GoogleCalendarEvent[]> {
  const token = await getWorkspaceAccessToken(settings);
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

    const result = await googleFetch(
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
  settings?: GoogleWorkspaceSettings,
): Promise<GoogleCalendarEvent> {
  const token = await getWorkspaceAccessToken(settings);

  const result = await googleFetch(
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
  settings?: GoogleWorkspaceSettings,
): Promise<string> {
  const s = settings ?? loadGoogleWorkspaceSettings();
  const { clientId, clientSecret, refreshToken } = s.credentials;

  if (!clientId || !clientSecret || !refreshToken) {
    return '';
  }

  try {
    const now = new Date();
    const end = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
    const timeMin = now.toISOString();
    const timeMax = end.toISOString();

    const calendarIds = s.calendarSyncSettings.selectedCalendarIds.length > 0
      ? s.calendarSyncSettings.selectedCalendarIds
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
