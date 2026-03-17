/**
 * Google Meet Sync Service
 * Orchestrates automatic syncing of Google Meet transcripts.
 * Polls for new conference records, downloads transcripts, and saves them as Markdown files.
 */

import type { GoogleMeetSyncEvent, GoogleMeetConferenceRecord, GoogleMeetTranscript } from '../types';
import {
  loadGoogleMeetSettings,
  saveGoogleMeetSettings,
  listConferenceRecords,
  listTranscripts,
  downloadTranscriptDoc,
  filterNewConferencesWithTranscripts,
  getTranscriptDocumentId,
  getMeetingTopic,
} from './googleMeetService';
import { createFile } from './projectService';
import { isIntegrationEnabled } from './integrationService';

type SyncEventCallback = (event: GoogleMeetSyncEvent) => void;

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

function emitEvent(event: GoogleMeetSyncEvent): void {
  for (const cb of eventListeners) {
    try {
      cb(event);
    } catch {
      // ignore listener errors
    }
  }
}

// ============================================
// Transcript Formatting
// ============================================

/**
 * Format a plain-text Google Meet transcript into Markdown.
 * Google Meet transcripts exported from Docs are plain text with speaker lines.
 */
function transcriptToMarkdown(
  textContent: string,
  meetingTopic: string,
  meetingDate: string,
): string {
  const parts: string[] = [];

  parts.push(`# ${meetingTopic}`);
  parts.push(`**Date:** ${meetingDate}`);
  parts.push('---');

  const trimmed = textContent.trim();
  if (!trimmed) {
    parts.push('*No transcript content available.*');
    return parts.join('\n\n') + '\n';
  }

  const lines = trimmed.split('\n');
  let currentSpeaker = '';
  let currentBlock: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Google Meet transcripts typically use "Speaker Name\nSpoken text" or "Speaker Name: text"
    const colonMatch = line.match(/^([^:]{2,50}):\s+(.+)$/);
    if (colonMatch) {
      // Flush previous block
      if (currentSpeaker && currentBlock.length > 0) {
        parts.push(`**${currentSpeaker}**\n${currentBlock.join(' ')}`);
      }
      currentSpeaker = colonMatch[1].trim();
      currentBlock = [colonMatch[2].trim()];
    } else if (currentSpeaker) {
      currentBlock.push(line);
    } else {
      // No speaker detected yet, treat as continuation
      currentBlock.push(line);
    }
  }

  // Flush final block
  if (currentSpeaker && currentBlock.length > 0) {
    parts.push(`**${currentSpeaker}**\n${currentBlock.join(' ')}`);
  } else if (currentBlock.length > 0) {
    parts.push(currentBlock.join('\n'));
  }

  return parts.join('\n\n') + '\n';
}

// ============================================
// Sync Logic
// ============================================

function buildDateRange(lastSyncTime?: string): { from: string; to: string } {
  const to = new Date().toISOString().split('T')[0];

  if (lastSyncTime) {
    const fromDate = new Date(lastSyncTime);
    fromDate.setDate(fromDate.getDate() - 1);
    const from = fromDate.toISOString().split('T')[0];
    return { from, to };
  }

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

async function syncConference(
  record: GoogleMeetConferenceRecord,
  transcripts: GoogleMeetTranscript[],
  targetProjectId: string,
): Promise<boolean> {
  const documentId = getTranscriptDocumentId(transcripts);
  if (!documentId) return false;

  const topic = getMeetingTopic(record);

  emitEvent({
    type: 'transcript_downloaded',
    message: `Downloading transcript for "${topic}"...`,
    meetingTopic: topic,
    conferenceName: record.name,
  });

  const textContent = await downloadTranscriptDoc(documentId);
  const meetingDate = formatMeetingDate(record.startTime);
  const markdown = transcriptToMarkdown(textContent, topic, meetingDate);

  const datePrefix = new Date(record.startTime).toISOString().split('T')[0];
  const safeTopic = sanitizeFileName(topic);
  const filePath = `google-meet/${datePrefix}-${safeTopic}.md`;

  await createFile(targetProjectId, filePath, markdown, 'md');

  emitEvent({
    type: 'transcript_saved',
    message: `Saved transcript for "${topic}"`,
    meetingTopic: topic,
    conferenceName: record.name,
  });

  return true;
}

/**
 * Perform a single sync cycle: fetch new conference records, download transcripts, save as files.
 */
export async function syncNow(): Promise<{ synced: number; errors: number }> {
  if (syncing) {
    return { synced: 0, errors: 0 };
  }

  syncing = true;
  let syncedCount = 0;
  let errorCount = 0;

  try {
    const settings = loadGoogleMeetSettings();
    const { targetProjectId } = settings.syncSettings;

    if (!targetProjectId) {
      throw new Error('No target project configured for Google Meet sync');
    }

    emitEvent({ type: 'sync_started', message: 'Starting Google Meet sync...' });

    const { from, to } = buildDateRange(settings.syncSettings.lastSyncTime);
    const records = await listConferenceRecords(from, to, settings);

    // Fetch transcripts for each conference record
    const transcriptsMap = new Map<string, GoogleMeetTranscript[]>();
    for (const record of records) {
      try {
        const transcripts = await listTranscripts(record.name, settings);
        transcriptsMap.set(record.name, transcripts);
      } catch {
        // Skip records where transcript listing fails
      }
    }

    const newRecords = filterNewConferencesWithTranscripts(
      records,
      transcriptsMap,
      settings.syncSettings.syncedConferenceNames,
    );

    if (newRecords.length === 0) {
      emitEvent({
        type: 'sync_completed',
        message: 'No new meetings to sync',
        totalSynced: 0,
      });
      settings.syncSettings.lastSyncTime = new Date().toISOString();
      saveGoogleMeetSettings(settings);
      return { synced: 0, errors: 0 };
    }

    emitEvent({
      type: 'meeting_found',
      message: `Found ${newRecords.length} new meeting(s) with transcripts`,
    });

    for (const record of newRecords) {
      try {
        const transcripts = transcriptsMap.get(record.name) || [];
        const saved = await syncConference(record, transcripts, targetProjectId);
        if (saved) {
          syncedCount++;
          settings.syncSettings.syncedConferenceNames.push(record.name);
        }
      } catch (err) {
        errorCount++;
        const errMsg = err instanceof Error ? err.message : String(err);
        const topic = getMeetingTopic(record);
        emitEvent({
          type: 'sync_error',
          message: `Failed to sync "${topic}": ${errMsg}`,
          meetingTopic: topic,
          conferenceName: record.name,
          error: errMsg,
        });
      }
    }

    settings.syncSettings.lastSyncTime = new Date().toISOString();
    saveGoogleMeetSettings(settings);

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

  if (!isIntegrationEnabled('google_meet')) return;

  const settings = loadGoogleMeetSettings();
  const intervalMs = settings.syncSettings.syncIntervalMinutes * 60 * 1000;

  syncNow();

  syncIntervalId = setInterval(() => {
    if (isIntegrationEnabled('google_meet')) {
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
