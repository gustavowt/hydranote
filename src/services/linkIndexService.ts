/**
 * Note Link Index Service
 * Persists detected file cross-references for File Map; emits change events.
 */

import { detectLinks } from './linkDetectionService';
import {
  countNoteLinks,
  deleteNoteLinksForFile,
  getResolvedNoteLinks,
  replaceNoteLinksForFile,
  updateNoteLinksSourceFileName,
  updateNoteLinksSourceProject,
  type DBNoteLink,
} from './database';

export interface NoteLinksChangedEvent {
  fileId: string;
  projectId: string;
}

type NoteLinksChangedHandler = (event: NoteLinksChangedEvent) => void;

const listeners = new Set<NoteLinksChangedHandler>();
let backfillPromise: Promise<void> | null = null;

function truncateContext(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '...';
}

function emitNoteLinksChanged(fileId: string, projectId: string): void {
  const event = { fileId, projectId };
  for (const handler of listeners) {
    handler(event);
  }
}

export function onNoteLinksChanged(handler: NoteLinksChangedHandler): () => void {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

async function resolveTarget(
  sourceProjectId: string,
  targetRaw: string,
): Promise<{ fileId: string; projectId: string; fileName: string } | null> {
  const { findFileByPath, findFileGlobal } = await import('./projectService');

  const local = await findFileByPath(sourceProjectId, targetRaw);
  if (local) {
    return { fileId: local.id, projectId: sourceProjectId, fileName: local.name };
  }

  const global = await findFileGlobal(targetRaw);
  if (global) {
    return {
      fileId: global.file.id,
      projectId: global.projectId,
      fileName: global.file.name,
    };
  }

  return null;
}

export async function detectedLinksToRows(
  sourceFileId: string,
  sourceProjectId: string,
  sourceFileName: string,
  content: string,
): Promise<DBNoteLink[]> {
  const detected = detectLinks(content);
  const rows: DBNoteLink[] = [];

  for (const d of detected) {
    const resolved = await resolveTarget(sourceProjectId, d.raw);
    rows.push({
      id: crypto.randomUUID(),
      sourceFileId,
      sourceProjectId,
      sourceFileName,
      targetRaw: d.raw,
      targetFileId: resolved?.fileId ?? null,
      targetProjectId: resolved?.projectId ?? null,
      targetFileName: resolved?.fileName ?? d.raw,
      linkType: d.type,
      contextSnippet: truncateContext(d.context || d.raw, 100),
      startIndex: d.startIndex,
    });
  }

  return rows;
}

export async function reindexFileLinks(
  fileId: string,
  projectId: string,
  fileName: string,
  content: string,
  fileType: string,
  options?: { silent?: boolean },
): Promise<void> {
  if (fileType !== 'md' && fileType !== 'txt') {
    await clearFileLinks(fileId);
    return;
  }

  const rows = await detectedLinksToRows(fileId, projectId, fileName, content);
  await replaceNoteLinksForFile(fileId, rows);
  if (!options?.silent) {
    emitNoteLinksChanged(fileId, projectId);
  }
}

export async function clearFileLinks(fileId: string): Promise<void> {
  await deleteNoteLinksForFile(fileId);
}

export async function syncNoteLinksFileName(fileId: string, fileName: string): Promise<void> {
  await updateNoteLinksSourceFileName(fileId, fileName);
}

export async function syncNoteLinksProject(
  fileId: string,
  projectId: string,
  fileName: string,
): Promise<void> {
  await updateNoteLinksSourceProject(fileId, projectId, fileName);
}

export async function queryResolvedNoteLinks(
  projectId?: string | null,
): Promise<DBNoteLink[]> {
  return getResolvedNoteLinks(projectId ?? undefined);
}

export async function ensureNoteLinksBackfill(projectId?: string | null): Promise<void> {
  const existing = await countNoteLinks();
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
        await reindexFileLinks(
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
