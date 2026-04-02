/**
 * Google Calendar Sync Service
 * Orchestrates automatic syncing of Google Calendar events.
 * Polls for new events within a configurable date range and stores them in DuckDB.
 */

import type { GoogleCalendarSyncEvent, GoogleCalendarEvent } from '../types';
import {
  listCalendars,
  listEvents,
  filterNewEvents,
} from './googleCalendarService';
import {
  loadGoogleWorkspaceSettings,
  saveGoogleWorkspaceSettings,
} from './googleWorkspaceAuthService';
import { upsertCalendarEvent } from './database';
import { isGoogleAppEnabled } from './integrationService';

type SyncEventCallback = (event: GoogleCalendarSyncEvent) => void;

let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let syncing = false;
const eventListeners: Set<SyncEventCallback> = new Set();

// ============================================
// Event Emitter
// ============================================

export function onSyncEvent(callback: SyncEventCallback): () => void {
  eventListeners.add(callback);
  return () => {
    eventListeners.delete(callback);
  };
}

function emitEvent(event: GoogleCalendarSyncEvent): void {
  for (const cb of eventListeners) {
    try {
      cb(event);
    } catch {
      // ignore listener errors
    }
  }
}

// ============================================
// Sync Logic
// ============================================

function buildDateRange(pastDays: number, futureDays: number): { timeMin: string; timeMax: string } {
  const now = new Date();

  const min = new Date(now);
  min.setDate(min.getDate() - pastDays);
  min.setHours(0, 0, 0, 0);

  const max = new Date(now);
  max.setDate(max.getDate() + futureDays);
  max.setHours(23, 59, 59, 999);

  return {
    timeMin: min.toISOString(),
    timeMax: max.toISOString(),
  };
}

function parseEventDateTime(dt: { dateTime?: string; date?: string }): Date {
  if (dt.dateTime) return new Date(dt.dateTime);
  if (dt.date) return new Date(dt.date + 'T00:00:00');
  return new Date();
}

async function syncEvent(
  event: GoogleCalendarEvent,
  calendarId: string,
  calendarName?: string,
): Promise<boolean> {
  if (!event.id || !event.summary) return false;

  const startTime = parseEventDateTime(event.start);
  const endTime = parseEventDateTime(event.end);
  const allDay = !event.start.dateTime && !!event.start.date;

  await upsertCalendarEvent({
    id: crypto.randomUUID(),
    googleEventId: event.id,
    calendarId,
    calendarName,
    summary: event.summary,
    description: event.description,
    location: event.location,
    startTime,
    endTime,
    allDay,
    attendees: event.attendees ? JSON.stringify(event.attendees) : undefined,
    hangoutLink: event.hangoutLink,
    htmlLink: event.htmlLink,
    status: event.status,
    syncedAt: new Date(),
  });

  emitEvent({
    type: 'event_saved',
    message: `Saved event "${event.summary}"`,
    eventTitle: event.summary,
    eventId: event.id,
  });

  return true;
}

/**
 * Perform a single sync cycle: fetch new calendar events and save them as markdown notes.
 */
export async function syncNow(): Promise<{ synced: number; errors: number }> {
  if (syncing) {
    return { synced: 0, errors: 0 };
  }

  syncing = true;
  let syncedCount = 0;
  let errorCount = 0;

  try {
    const wsSettings = loadGoogleWorkspaceSettings();
    const { pastDays, futureDays, selectedCalendarIds } = wsSettings.calendarSyncSettings;

    emitEvent({ type: 'sync_started', message: 'Starting Google Calendar sync...' });

    const { timeMin, timeMax } = buildDateRange(pastDays, futureDays);

    let calendarIds = selectedCalendarIds;
    let calendarNameMap: Map<string, string> = new Map();

    if (calendarIds.length === 0) {
      const calendars = await listCalendars(wsSettings);
      const primary = calendars.find((c) => c.primary);
      if (primary) {
        calendarIds = [primary.id];
        calendarNameMap.set(primary.id, primary.summary);
      } else if (calendars.length > 0) {
        calendarIds = [calendars[0].id];
        calendarNameMap.set(calendars[0].id, calendars[0].summary);
      }
    } else {
      try {
        const calendars = await listCalendars(wsSettings);
        for (const cal of calendars) {
          calendarNameMap.set(cal.id, cal.summary);
        }
      } catch {
        // Non-critical: proceed without calendar names
      }
    }

    if (calendarIds.length === 0) {
      emitEvent({
        type: 'sync_completed',
        message: 'No calendars available to sync',
        totalSynced: 0,
      });
      return { synced: 0, errors: 0 };
    }

    let allNewEvents: Array<{ event: GoogleCalendarEvent; calendarId: string; calendarName?: string }> = [];

    for (const calId of calendarIds) {
      try {
        const events = await listEvents(calId, timeMin, timeMax, wsSettings);
        const newEvents = filterNewEvents(events, wsSettings.calendarSyncSettings.syncedEventIds);
        const calName = calendarNameMap.get(calId);
        for (const ev of newEvents) {
          allNewEvents.push({ event: ev, calendarId: calId, calendarName: calName });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        emitEvent({
          type: 'sync_error',
          message: `Failed to fetch events from calendar "${calendarNameMap.get(calId) || calId}": ${errMsg}`,
          error: errMsg,
        });
        errorCount++;
      }
    }

    if (allNewEvents.length === 0) {
      emitEvent({
        type: 'sync_completed',
        message: 'No new events to sync',
        totalSynced: 0,
      });
      wsSettings.calendarSyncSettings.lastSyncTime = new Date().toISOString();
      saveGoogleWorkspaceSettings(wsSettings);
      return { synced: 0, errors: 0 };
    }

    emitEvent({
      type: 'event_found',
      message: `Found ${allNewEvents.length} new event(s) to sync`,
    });

    for (const { event, calendarId, calendarName } of allNewEvents) {
      try {
        const saved = await syncEvent(event, calendarId, calendarName);
        if (saved && event.id) {
          syncedCount++;
          wsSettings.calendarSyncSettings.syncedEventIds.push(event.id);
        }
      } catch (err) {
        errorCount++;
        const errMsg = err instanceof Error ? err.message : String(err);
        emitEvent({
          type: 'sync_error',
          message: `Failed to sync "${event.summary}": ${errMsg}`,
          eventTitle: event.summary,
          eventId: event.id,
          error: errMsg,
        });
      }
    }

    wsSettings.calendarSyncSettings.lastSyncTime = new Date().toISOString();
    saveGoogleWorkspaceSettings(wsSettings);

    emitEvent({
      type: 'sync_completed',
      message: `Sync complete: ${syncedCount} event(s) saved`,
      totalSynced: syncedCount,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    emitEvent({
      type: 'sync_error',
      message: `Sync failed: ${errMsg}`,
      error: errMsg,
    });
    errorCount++;
  } finally {
    syncing = false;
  }

  return { synced: syncedCount, errors: errorCount };
}

// ============================================
// Polling Control
// ============================================

export function startSync(): void {
  if (syncIntervalId !== null) return;

  if (!isGoogleAppEnabled('calendar')) return;

  const wsSettings = loadGoogleWorkspaceSettings();
  const intervalMs = wsSettings.calendarSyncSettings.syncIntervalMinutes * 60 * 1000;

  syncNow();

  syncIntervalId = setInterval(() => {
    if (isGoogleAppEnabled('calendar')) {
      syncNow();
    } else {
      stopSync();
    }
  }, intervalMs);
}

export function stopSync(): void {
  if (syncIntervalId !== null) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
}

export function restartSync(): void {
  stopSync();
  startSync();
}

export function isSyncing(): boolean {
  return syncing;
}

export function isSyncRunning(): boolean {
  return syncIntervalId !== null;
}
