/**
 * Google Calendar Sync Service
 * Orchestrates automatic syncing of Google Calendar events.
 * Polls for new events within a configurable date range and saves them as Markdown files.
 */

import type { GoogleCalendarSyncEvent, GoogleCalendarEvent } from '../types';
import {
  loadGoogleCalendarSettings,
  saveGoogleCalendarSettings,
  listCalendars,
  listEvents,
  filterNewEvents,
  formatEventToMarkdown,
  getEventDatePrefix,
  sanitizeFileName,
} from './googleCalendarService';
import { createFile } from './projectService';
import { isIntegrationEnabled } from './integrationService';

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

async function syncEvent(
  event: GoogleCalendarEvent,
  targetProjectId: string,
  calendarName?: string,
): Promise<boolean> {
  if (!event.id || !event.summary) return false;

  const markdown = formatEventToMarkdown(event, calendarName);
  const datePrefix = getEventDatePrefix(event);
  const safeTitle = sanitizeFileName(event.summary);
  const filePath = `google-calendar/${datePrefix}-${safeTitle}.md`;

  await createFile(targetProjectId, filePath, markdown, 'md');

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
    const settings = loadGoogleCalendarSettings();
    const { targetProjectId, pastDays, futureDays, selectedCalendarIds } = settings.syncSettings;

    if (!targetProjectId) {
      throw new Error('No target project configured for Google Calendar sync');
    }

    emitEvent({ type: 'sync_started', message: 'Starting Google Calendar sync...' });

    const { timeMin, timeMax } = buildDateRange(pastDays, futureDays);

    let calendarIds = selectedCalendarIds;
    let calendarNameMap: Map<string, string> = new Map();

    if (calendarIds.length === 0) {
      const calendars = await listCalendars(settings);
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
        const calendars = await listCalendars(settings);
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

    let allNewEvents: Array<{ event: GoogleCalendarEvent; calendarName?: string }> = [];

    for (const calId of calendarIds) {
      try {
        const events = await listEvents(calId, timeMin, timeMax, settings);
        const newEvents = filterNewEvents(events, settings.syncSettings.syncedEventIds);
        const calName = calendarNameMap.get(calId);
        for (const ev of newEvents) {
          allNewEvents.push({ event: ev, calendarName: calName });
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
      settings.syncSettings.lastSyncTime = new Date().toISOString();
      saveGoogleCalendarSettings(settings);
      return { synced: 0, errors: 0 };
    }

    emitEvent({
      type: 'event_found',
      message: `Found ${allNewEvents.length} new event(s) to sync`,
    });

    for (const { event, calendarName } of allNewEvents) {
      try {
        const saved = await syncEvent(event, targetProjectId, calendarName);
        if (saved && event.id) {
          syncedCount++;
          settings.syncSettings.syncedEventIds.push(event.id);
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

    settings.syncSettings.lastSyncTime = new Date().toISOString();
    saveGoogleCalendarSettings(settings);

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

  if (!isIntegrationEnabled('google_calendar')) return;

  const settings = loadGoogleCalendarSettings();
  const intervalMs = settings.syncSettings.syncIntervalMinutes * 60 * 1000;

  syncNow();

  syncIntervalId = setInterval(() => {
    if (isIntegrationEnabled('google_calendar')) {
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
