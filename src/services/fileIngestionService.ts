/**
 * File Ingestion Service
 *
 * Orchestrates ingestion of files dropped onto the project tree from the OS.
 * Each dropped file is routed to the right pipeline (md/txt → text indexing,
 * pdf → page-aware vision pipeline, docx → mammoth, image → binary cache),
 * and a reactive `ingestionProgress` map is updated as work advances so the
 * tree row can render a progress bar over the filename.
 *
 * Folder drops are walked recursively via `webkitGetAsEntry()` so a dropped
 * directory preserves its subdirectory structure under the drop target.
 */

import { ref } from 'vue';
import { createFile } from './projectService';
import { detectFileType, getFileBinaryData, convertDOCXToHTML } from './documentProcessor';
import {
  ingestPdfForSearch,
  extractFullPdfText,
  type PdfIngestionStage,
} from './pdfIngestionService';
import type { ProjectFile, SupportedFileType } from '../types';

/**
 * Stage labels exposed to the UI. The UI only needs three states beyond
 * "indexing"; we map PDF-internal stages to these for a unified label.
 */
export type IngestionStage = PdfIngestionStage | 'indexing' | 'complete';

export interface IngestionProgressEntry {
  /** Display name for the file (without directory prefix). */
  fileName: string;
  /** 0..100 — round to integer before rendering. */
  percent: number;
  /** Current stage, used for tooltip / a11y label. */
  stage: IngestionStage;
}

/**
 * Reactive progress map keyed by:
 *   - the transient drop id while the file row hasn't been created yet, and
 *   - the persisted `files.id` once `createFile` returns.
 * The tree row reads this by both keys (transient first for early UI, then
 * the row is matched once the persisted id is published).
 */
export const ingestionProgress = ref(new Map<string, IngestionProgressEntry>());

/**
 * Pending drop ghost rows.
 *
 * Populated by `ingestSingleFile` BEFORE any per-file work starts so the tree
 * can render a placeholder row immediately on drop (especially important for
 * PDFs, where `extractFullPdfText` blocks for seconds before `createFile` is
 * called). Entries are cleared the moment `createFile` returns — from that
 * point on the persisted row takes over and the progress bar continues via
 * `ingestionProgress` keyed by `files.id`.
 *
 * Keyed by transient drop id (same id used for the early `ingestionProgress`
 * entry). The tree component groups these by `targetDirectory` and renders
 * them inside the matching directory node, or at the drop target / project
 * root when the directory doesn't yet exist in the tree.
 */
export interface PendingDropEntry {
  transientId: string;
  projectId: string;
  /** Original file name, used as a fallback display label. */
  fileName: string;
  /** Path of the row relative to the project, including drop target prefix. */
  displayPath: string;
  /** Parent directory inside the project (undefined → project root). */
  targetDirectory?: string;
  fileType: SupportedFileType;
}

export const pendingDrops = ref(new Map<string, PendingDropEntry>());

export interface IngestExternalFilesResult {
  created: ProjectFile[];
  failed: Array<{ name: string; error: string }>;
}

interface DroppedEntry {
  file: File;
  /** Path inside the drop, e.g. "Reports/Q1/sales.pdf" or "report.pdf". */
  relativePath: string;
}

// ============================================
// Public API
// ============================================

/**
 * Ingest every file in the dropped batch into the given project, sequentially.
 * Returns successful `ProjectFile` rows plus per-file failures.
 *
 * - `targetDirectory` is the directory inside the project the drop landed on
 *   (or `undefined` for the project root).
 * - `entries` carry their own `relativePath`, so dropping a folder preserves
 *   nested directories under `targetDirectory`.
 */
export async function ingestExternalFiles(
  entries: DroppedEntry[],
  projectId: string,
  targetDirectory?: string,
  onFileCreated?: (file: ProjectFile) => void | Promise<void>,
): Promise<IngestExternalFilesResult> {
  const created: ProjectFile[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const entry of entries) {
    const fileType = detectFileType(entry.file.name);
    if (!fileType) {
      failed.push({ name: entry.relativePath, error: 'Unsupported file type' });
      continue;
    }

    const dropPath = joinPath(targetDirectory, entry.relativePath);
    const transientId = `drop:${dropPath}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    // Publish the ghost row immediately so the tree can render a placeholder
    // before any extraction or DB work begins. The ghost shares its key with
    // the early `ingestionProgress` entry so the progress bar attaches to it
    // out of the box.
    publishPendingDrop({
      transientId,
      projectId,
      fileName: entry.file.name,
      displayPath: dropPath,
      targetDirectory,
      fileType,
    });
    publishProgress(transientId, entry.file.name, 0, 'indexing');

    try {
      const projectFile = await ingestSingleFile({
        entry,
        fileType,
        projectId,
        dropPath,
        transientId,
        notifyCreated: async (file) => {
          // The persisted row exists from this point on; drop the ghost so
          // the tree refresh can swap it for the real node.
          clearPendingDrop(transientId);
          if (onFileCreated) {
            try {
              await onFileCreated(file);
            } catch {
              /* host callback errors must not abort ingestion */
            }
          }
        },
      });
      created.push(projectFile);
      // Hold the entry briefly at 100% so the UI can finish its animation,
      // then drop both keys.
      publishProgress(transientId, entry.file.name, 100, 'indexing');
      publishProgress(projectFile.id, entry.file.name, 100, 'indexing');
      setTimeout(() => {
        clearProgress(transientId);
        clearProgress(projectFile.id);
      }, 600);
    } catch (err) {
      failed.push({
        name: entry.relativePath,
        error: err instanceof Error ? err.message : String(err),
      });
      clearProgress(transientId);
      clearPendingDrop(transientId);
    }
  }

  return { created, failed };
}

/**
 * Walk a `DataTransferItemList` from a drop event and resolve every nested
 * file, preserving its path inside the dropped folder. Browsers expose this
 * as `webkitGetAsEntry()`. Items that can't be resolved (kind: 'string',
 * inaccessible directories) are silently skipped.
 */
export async function collectDroppedEntries(
  items: DataTransferItemList | DataTransferItem[],
): Promise<DroppedEntry[]> {
  const list: DataTransferItem[] = Array.isArray(items)
    ? items
    : Array.from(items);
  const collected: DroppedEntry[] = [];

  await Promise.all(
    list.map(async (item) => {
      if (item.kind !== 'file') return;
      // `webkitGetAsEntry` is the de-facto standard; some browsers also expose
      // the spec name `getAsEntry`. Prefer whichever exists.
      const getEntry = (item as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntry | null;
        getAsEntry?: () => FileSystemEntry | null;
      });
      const entry = getEntry.webkitGetAsEntry?.() ?? getEntry.getAsEntry?.() ?? null;
      if (entry) {
        await walkEntry(entry, '', collected);
        return;
      }
      // Fallback: no entry API available — accept the file as a flat drop.
      const file = item.getAsFile();
      if (file) collected.push({ file, relativePath: file.name });
    }),
  );

  return collected;
}

/**
 * Same as `collectDroppedEntries` but for the legacy flat path: just the
 * files with no directory recursion. Used as a fallback when `dataTransfer.items`
 * is unavailable.
 */
export function flatFilesToEntries(files: FileList | File[]): DroppedEntry[] {
  const arr = Array.isArray(files) ? files : Array.from(files);
  return arr.map((file) => ({ file, relativePath: file.name }));
}

// ============================================
// Internals
// ============================================

interface IngestSingleFileParams {
  entry: DroppedEntry;
  fileType: SupportedFileType;
  projectId: string;
  /** Final path inside the project, including target directory + relativePath. */
  dropPath: string;
  transientId: string;
  /**
   * Invoked as soon as the persisted `files` row is created. The orchestrator
   * uses this to drop the pre-creation ghost row from `pendingDrops` and
   * trigger a per-file tree refresh, so the real row appears mid-batch
   * instead of only at the end. The callback may be async; per-file ingestion
   * does NOT wait for it (we await it inline to keep ordering simple, since
   * it's typically just a tree-refresh and the caller wraps it in its own
   * try/catch).
   */
  notifyCreated: (file: ProjectFile) => Promise<void>;
}

async function ingestSingleFile(params: IngestSingleFileParams): Promise<ProjectFile> {
  const { entry, fileType, projectId, dropPath, transientId, notifyCreated } = params;
  const file = entry.file;
  const fileName = entry.file.name;

  switch (fileType) {
    case 'md':
    case 'txt': {
      const content = await file.text();
      publishProgress(transientId, fileName, 50, 'indexing');
      const projectFile = await createFile(projectId, dropPath, content, fileType);
      await notifyCreated(projectFile);
      publishProgress(projectFile.id, fileName, 100, 'complete');
      return projectFile;
    }

    case 'pdf': {
      // The PDF pipeline needs the binary, but we also need extracted text on
      // `files.content` so the existing `read` tool keeps working — reuse the
      // pipeline's joined-page-text helper here for free since PDF.js has to
      // open the document anyway. We pass the same File to `ingestPdfForSearch`
      // afterward; PDF.js caches nothing across these two calls but the cost
      // (single-document open twice) is negligible compared to vision calls.
      publishProgress(transientId, fileName, 5, 'extracting');
      const fullText = await extractFullPdfText(file);
      publishProgress(transientId, fileName, 15, 'extracting');

      // Drop-ingested PDFs aren't on the synced filesystem, so they have no
      // `systemFilePath` for PDFViewer to read back. Persist the raw bytes on
      // the row itself (DuckDB `binary_data_base64`, same column DOCX uses)
      // so the viewer can re-render the document on click. Without this the
      // editor area shows up blank because PDFViewer has nothing to load.
      const pdfBytes = new Uint8Array(await file.arrayBuffer());

      const projectFile = await createFile(
        projectId,
        dropPath,
        fullText,
        'pdf',
        pdfBytes,
        undefined,
        undefined, // no systemFilePath: drop-ingested PDFs aren't on the synced FS
      );
      await notifyCreated(projectFile);
      publishProgress(projectFile.id, fileName, 20, 'extracting');

      await ingestPdfForSearch(projectId, projectFile.id, file, {
        onProgress: (p) => {
          // Map the three internal PDF stages onto a unified 20..100 percent
          // band so the bar always advances forward.
          const ratio = p.total > 0 ? p.done / p.total : 1;
          let percent: number;
          switch (p.stage) {
            case 'extracting':
              percent = 20 + ratio * 30; // 20..50
              break;
            case 'visual_describe':
              percent = 50 + ratio * 35; // 50..85
              break;
            case 'embedding':
              percent = 85 + ratio * 15; // 85..100
              break;
            default:
              percent = 50;
          }
          publishProgress(projectFile.id, fileName, Math.min(99, Math.round(percent)), p.stage);
        },
      });

      return projectFile;
    }

    case 'docx': {
      publishProgress(transientId, fileName, 25, 'indexing');
      const binary = await getFileBinaryData(file);
      const binaryBytes = base64ToUint8Array(binary);
      publishProgress(transientId, fileName, 55, 'indexing');
      const { html } = await convertDOCXToHTML(file);
      publishProgress(transientId, fileName, 75, 'indexing');
      // Extracted text is left to the existing pipeline; we feed an empty
      // string and let mammoth-backed conversion provide the HTML body.
      const projectFile = await createFile(projectId, dropPath, '', 'docx', binaryBytes, html);
      await notifyCreated(projectFile);
      publishProgress(projectFile.id, fileName, 95, 'indexing');
      return projectFile;
    }

    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp': {
      publishProgress(transientId, fileName, 50, 'indexing');
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const projectFile = await createFile(projectId, dropPath, '', fileType, bytes);
      await notifyCreated(projectFile);
      publishProgress(projectFile.id, fileName, 95, 'indexing');
      return projectFile;
    }

    default: {
      // Type system should prevent reaching here, but be defensive.
      throw new Error(`Unsupported file type: ${fileType}`);
    }
  }
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: DroppedEntry[],
): Promise<void> {
  if (entry.isFile) {
    const file = await fileFromFileEntry(entry as FileSystemFileEntry);
    if (file) {
      out.push({
        file,
        relativePath: prefix ? `${prefix}/${entry.name}` : entry.name,
      });
    }
    return;
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const children = await readAllChildren(dirEntry);
    const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    for (const child of children) {
      await walkEntry(child, subPrefix, out);
    }
  }
}

function fileFromFileEntry(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    try {
      entry.file(
        (file) => resolve(file),
        () => resolve(null),
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * Read every child of a directory entry. Browser readers can return results
 * in batches; we keep calling `readEntries` until it returns an empty batch.
 */
async function readAllChildren(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const results: FileSystemEntry[] = [];
  let hasMore = true;
  while (hasMore) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      try {
        reader.readEntries(
          (entries) => resolve(entries),
          () => resolve([]),
        );
      } catch {
        resolve([]);
      }
    });
    if (batch.length === 0) {
      hasMore = false;
    } else {
      results.push(...batch);
    }
  }
  return results;
}

function joinPath(directory: string | undefined, relative: string): string {
  if (!directory) return relative;
  const trimmedDir = directory.replace(/\/+$/, '');
  const trimmedRel = relative.replace(/^\/+/, '');
  return `${trimmedDir}/${trimmedRel}`;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================
// Reactive progress publish/clear
// ============================================

export function publishProgress(
  key: string,
  fileName: string,
  percent: number,
  stage: IngestionStage,
): void {
  const next = new Map(ingestionProgress.value);
  next.set(key, { fileName, percent, stage });
  ingestionProgress.value = next;
}

export function clearProgress(key: string): void {
  if (!ingestionProgress.value.has(key)) return;
  const next = new Map(ingestionProgress.value);
  next.delete(key);
  ingestionProgress.value = next;
}

/**
 * Publish a ghost row that the tree should render before the persisted
 * `files` row exists. Replaces any existing entry with the same transientId.
 */
function publishPendingDrop(entry: PendingDropEntry): void {
  const next = new Map(pendingDrops.value);
  next.set(entry.transientId, entry);
  pendingDrops.value = next;
}

/**
 * Remove a ghost row, typically because the persisted row has just appeared
 * (or because the ingestion attempt failed).
 */
function clearPendingDrop(transientId: string): void {
  if (!pendingDrops.value.has(transientId)) return;
  const next = new Map(pendingDrops.value);
  next.delete(transientId);
  pendingDrops.value = next;
}

/**
 * Test helper — drops every entry. Not exported via the services index.
 */
export function _resetIngestionProgressForTests(): void {
  ingestionProgress.value = new Map();
  pendingDrops.value = new Map();
}
