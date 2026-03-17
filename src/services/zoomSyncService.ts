/**
 * Zoom Sync Service
 * Orchestrates automatic syncing of Zoom meeting transcripts.
 * Polls for new recordings, downloads transcripts, and saves them as Markdown files.
 */

import type { ZoomSyncEvent, ZoomMeeting } from '../types';
import {
  loadZoomSettings,
  saveZoomSettings,
  listRecordings,
  downloadTranscript,
  filterNewMeetingsWithTranscripts,
  getTranscriptDownloadUrl,
} from './zoomService';
import { vttToMarkdown } from './vttParser';
import { createFile } from './projectService';
import { isIntegrationEnabled } from './integrationService';

type SyncEventCallback = (event: ZoomSyncEvent) => void;

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

function emitEvent(event: ZoomSyncEvent): void {
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

function buildDateRange(lastSyncTime?: string): { from: string; to: string } {
  const to = new Date().toISOString().split('T')[0];

  if (lastSyncTime) {
    const fromDate = new Date(lastSyncTime);
    fromDate.setDate(fromDate.getDate() - 1); // overlap by 1 day for safety
    const from = fromDate.toISOString().split('T')[0];
    return { from, to };
  }

  // First sync: look back 30 days
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30);
  const from = fromDate.toISOString().split('T')[0];
  return { from, to };
}

function formatMeetingDate(startTime: string): string {
  try {
    const d = new Date(startTime);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return startTime;
  }
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 100);
}

async function syncMeeting(meeting: ZoomMeeting, targetProjectId: string): Promise<boolean> {
  const downloadUrl = getTranscriptDownloadUrl(meeting);
  if (!downloadUrl) return false;

  emitEvent({
    type: 'transcript_downloaded',
    message: `Downloading transcript for "${meeting.topic}"...`,
    meetingTopic: meeting.topic,
    meetingUuid: meeting.uuid,
  });

  const vttContent = await downloadTranscript(downloadUrl);
  const meetingDate = formatMeetingDate(meeting.start_time);
  const markdown = vttToMarkdown(vttContent, meeting.topic, meetingDate);

  const datePrefix = new Date(meeting.start_time).toISOString().split('T')[0];
  const safeTopic = sanitizeFileName(meeting.topic);
  const filePath = `zoom-meetings/${datePrefix}-${safeTopic}.md`;

  await createFile(targetProjectId, filePath, markdown, 'md');

  emitEvent({
    type: 'transcript_saved',
    message: `Saved transcript for "${meeting.topic}"`,
    meetingTopic: meeting.topic,
    meetingUuid: meeting.uuid,
  });

  return true;
}

/**
 * Perform a single sync cycle: fetch new recordings, download transcripts, save as files.
 */
export async function syncNow(): Promise<{ synced: number; errors: number }> {
  if (syncing) {
    return { synced: 0, errors: 0 };
  }

  syncing = true;
  let syncedCount = 0;
  let errorCount = 0;

  try {
    const settings = loadZoomSettings();
    const { targetProjectId } = settings.syncSettings;

    if (!targetProjectId) {
      throw new Error('No target project configured for Zoom sync');
    }

    emitEvent({ type: 'sync_started', message: 'Starting Zoom sync...' });

    const { from, to } = buildDateRange(settings.syncSettings.lastSyncTime);
    const meetings = await listRecordings(from, to, settings);

    const newMeetings = filterNewMeetingsWithTranscripts(
      meetings,
      settings.syncSettings.syncedMeetingUuids,
    );

    if (newMeetings.length === 0) {
      emitEvent({
        type: 'sync_completed',
        message: 'No new meetings to sync',
        totalSynced: 0,
      });
      // Update last sync time even when nothing new found
      settings.syncSettings.lastSyncTime = new Date().toISOString();
      saveZoomSettings(settings);
      return { synced: 0, errors: 0 };
    }

    emitEvent({
      type: 'meeting_found',
      message: `Found ${newMeetings.length} new meeting(s) with transcripts`,
    });

    for (const meeting of newMeetings) {
      try {
        const saved = await syncMeeting(meeting, targetProjectId);
        if (saved) {
          syncedCount++;
          settings.syncSettings.syncedMeetingUuids.push(meeting.uuid);
        }
      } catch (err) {
        errorCount++;
        const errMsg = err instanceof Error ? err.message : String(err);
        emitEvent({
          type: 'sync_error',
          message: `Failed to sync "${meeting.topic}": ${errMsg}`,
          meetingTopic: meeting.topic,
          meetingUuid: meeting.uuid,
          error: errMsg,
        });
      }
    }

    settings.syncSettings.lastSyncTime = new Date().toISOString();
    saveZoomSettings(settings);

    emitEvent({
      type: 'sync_completed',
      message: `Sync complete: ${syncedCount} transcript(s) saved`,
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

  if (!isIntegrationEnabled('zoom')) return;

  const settings = loadZoomSettings();
  const intervalMs = settings.syncSettings.syncIntervalMinutes * 60 * 1000;

  // Run immediately on start, then on interval
  syncNow();

  syncIntervalId = setInterval(() => {
    if (isIntegrationEnabled('zoom')) {
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

/**
 * Restart sync with updated settings (e.g., changed interval).
 */
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
