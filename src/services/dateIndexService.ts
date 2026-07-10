/**
 * Note Date Index Service
 * Persists chrono-detected dates for Timeline; emits change events for live refresh.
 */

import { detectDates } from './dateDetectionService';
import {
  countNoteDates,
  deleteNoteDatesForFile,
  getNoteDatesByRange,
  replaceNoteDatesForFile,
  updateNoteDatesFileName,
  updateNoteDatesProject,
  type DBNoteDate,
} from './database';

export interface NoteDatesChangedEvent {
  fileId: string;
  projectId: string;
}

type NoteDatesChangedHandler = (event: NoteDatesChangedEvent) => void;

const listeners = new Set<NoteDatesChangedHandler>();
let backfillPromise: Promise<void> | null = null;

function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function truncateContext(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '...';
}

function emitNoteDatesChanged(fileId: string, projectId: string): void {
  const event = { fileId, projectId };
  for (const handler of listeners) {
    handler(event);
  }
}

export function onNoteDatesChanged(handler: NoteDatesChangedHandler): () => void {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

export function detectedDatesToRows(
  fileId: string,
  projectId: string,
  fileName: string,
  content: string,
  referenceDate?: Date,
): DBNoteDate[] {
  const detected = detectDates(content, referenceDate);
  return detected.map(d => ({
    id: crypto.randomUUID(),
    fileId,
    projectId,
    fileName,
    dateStr: toDateStr(d.date),
    dateText: d.text,
    type: d.type,
    contextSnippet: truncateContext(d.context || d.text, 100),
    startIndex: d.index,
  }));
}

export async function reindexFileDates(
  fileId: string,
  projectId: string,
  fileName: string,
  content: string,
  fileType: string,
  options?: { silent?: boolean },
): Promise<void> {
  if (fileType !== 'md' && fileType !== 'txt') {
    await clearFileDates(fileId);
    return;
  }

  const rows = detectedDatesToRows(fileId, projectId, fileName, content);
  await replaceNoteDatesForFile(fileId, rows);
  if (!options?.silent) {
    emitNoteDatesChanged(fileId, projectId);
  }
}

export async function clearFileDates(fileId: string): Promise<void> {
  await deleteNoteDatesForFile(fileId);
}

export async function syncNoteDatesFileName(fileId: string, fileName: string): Promise<void> {
  await updateNoteDatesFileName(fileId, fileName);
}

export async function syncNoteDatesProject(
  fileId: string,
  projectId: string,
  fileName: string,
): Promise<void> {
  await updateNoteDatesProject(fileId, projectId, fileName);
}

export async function queryTimelineNoteDates(
  rangeStart: Date,
  rangeEnd: Date,
  projectId?: string | null,
): Promise<DBNoteDate[]> {
  const startStr = toDateStr(rangeStart);
  const endStr = toDateStr(rangeEnd);
  return getNoteDatesByRange(startStr, endStr, projectId ?? undefined);
}

export async function ensureNoteDatesBackfill(projectId?: string | null): Promise<void> {
  const existing = await countNoteDates();
  if (existing > 0) return;

  if (backfillPromise) {
    await backfillPromise;
    return;
  }

  backfillPromise = (async () => {
    const { getAllProjects, get_project_files } = await import('./projectService');
    const projects = projectId
      ? [{ id: projectId }]
      : await getAllProjects();

    for (const project of projects) {
      let files;
      try {
        files = await get_project_files(project.id);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.content || (file.type !== 'md' && file.type !== 'txt')) continue;
        await reindexFileDates(
          file.id,
          file.projectId,
          file.name,
          file.content,
          file.type,
          { silent: true },
        );
      }
    }
  })();

  try {
    await backfillPromise;
  } finally {
    backfillPromise = null;
  }
}
