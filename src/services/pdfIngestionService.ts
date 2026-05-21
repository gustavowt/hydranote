/**
 * PDF Ingestion Service
 *
 * Page-aware ingestion pipeline for PDF files. Replaces the previous flow
 * (where PDFs were stored as a single flat content string and never indexed
 * for semantic search). For each page we:
 *
 *   1. Extract the text via PDF.js `getTextContent()`.
 *   2. Detect whether the page contains visual elements (raster images and/or
 *      a dense vector-graphics signature for charts and diagrams) by walking
 *      `page.getOperatorList()` op codes.
 *   3. For visual pages only: render the page to an in-memory PNG, hand it to
 *      the configured provider's vision model via `visionService.describeImage`,
 *      and immediately discard the bitmap.
 *   4. Chunk the per-page text and add a single `visual_description` chunk per
 *      visual page. All chunks carry `pageNumber` and the nearest enclosing
 *      `section` (resolved from the PDF outline when available).
 *   5. Generate embeddings and persist chunks + embeddings.
 *
 * Concurrency:
 *   - A CPU-bound queue rate-limits page render + extract work to keep the UI
 *     responsive on multi-page documents.
 *   - A separate, smaller queue rate-limits vision API calls so we don't burn
 *     through tokens or stall on the local Ollama.
 */

import * as pdfjsLib from 'pdfjs-dist';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextItem,
} from 'pdfjs-dist/types/src/display/api';
import { OPS } from 'pdfjs-dist';
import {
  getConnection,
  flushDatabase,
  createChunks as dbCreateChunks,
  createEmbeddings as dbCreateEmbeddings,
} from './database';
import { generateEmbeddingsForChunks } from './embeddingService';
import { describeImage, isVisionAvailable } from './visionService';
import { runWithLimit, getCpuConcurrency } from '../utils/concurrencyQueue';
import { chunkText } from './documentProcessor';
import type { Chunk, ChunkingConfig } from '../types';

const VISION_CONCURRENCY = 3;
const PAGE_RENDER_SCALE = 1.5;

/** Heuristic: vector-path-op count that suggests a chart/diagram on a sparse-text page. */
const VECTOR_PATH_DENSITY_THRESHOLD = 80;
/** Below this character count a page is considered "sparse text". */
const SPARSE_TEXT_THRESHOLD = 200;

const VISION_PROMPT_HEADER =
  'Describe in plain text any visual elements on this PDF page (charts, diagrams, ' +
  'images, tables-as-images, screenshots, hand-drawings). Note labels, axes, key ' +
  'numbers, units, relationships, and what the visual is communicating. Return ' +
  'prose only — no preamble, no markdown headings.';

/**
 * Progress milestones reported by the ingestion pipeline. The caller can
 * translate these into a single 0..100 percent for UI purposes.
 */
export type PdfIngestionStage = 'extracting' | 'visual_describe' | 'embedding';

export interface PdfIngestionProgress {
  stage: PdfIngestionStage;
  /** Units completed in the current stage (page count, or 1 for embedding). */
  done: number;
  /** Total units in the current stage (page count, or 1 for embedding). */
  total: number;
}

export interface PdfIngestionOptions {
  chunkingConfig?: ChunkingConfig;
  /** Override the CPU-bound parallelism for page render/extract (mainly for tests). */
  pageConcurrency?: number;
  /** Override the parallelism for vision API calls (mainly for tests). */
  visionConcurrency?: number;
  /** Skip vision analysis entirely (for cheap re-index runs or unit tests). */
  skipVision?: boolean;
  /**
   * Optional callback invoked at each progress milestone:
   *   - once per page during text extraction + visual detection
   *   - once per visual page after the vision model returns
   *   - once when embeddings + persistence finish
   * The pipeline never throws if this callback throws — caller errors are
   * swallowed so they cannot break ingestion.
   */
  onProgress?: (progress: PdfIngestionProgress) => void;
}

export interface PdfIngestionResult {
  /** Per-page extracted text joined with blank lines (kept on `files.content`). */
  fullText: string;
  /** Number of chunks persisted (text + visual). */
  chunksWritten: number;
  /** Number of pages flagged as visual. */
  visualPagesDetected: number;
  /** Number of pages where the vision model returned a description. */
  visualDescriptionsCreated: number;
  /** Soft errors encountered per page (vision failures etc.) — pipeline continued. */
  errors: Array<{ pageNumber: number; message: string }>;
}

interface ExtractedPage {
  pageNumber: number;
  text: string;
  hasVisuals: boolean;
  /** Fast access to the underlying PDFPageProxy for rendering visual pages. */
  pageProxy: PDFPageProxy;
}

interface OutlineEntry {
  title: string;
  pageIndex: number; // 0-based
}

/**
 * Public entry point. Builds an in-memory `pdfjs` document from the file,
 * runs the pipeline, and persists everything in DuckDB.
 *
 * The caller is expected to have already created the `files` row via
 * `projectService.createFile`. This function only writes chunks + embeddings.
 */
export async function ingestPdfForSearch(
  projectId: string,
  fileId: string,
  file: File,
  opts: PdfIngestionOptions = {},
): Promise<PdfIngestionResult> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  try {
    return await ingestPdfFromDocument(projectId, fileId, pdf, opts);
  } finally {
    // Free PDF.js worker resources promptly; we don't keep page proxies around.
    await pdf.destroy().catch(() => {});
  }
}

/**
 * Splits per-page text into searchable chunks, runs vision over visual pages,
 * and persists everything. Exported separately so tests can inject a synthetic
 * `PDFDocumentProxy` without touching `getDocument`.
 */
export async function ingestPdfFromDocument(
  projectId: string,
  fileId: string,
  pdf: PDFDocumentProxy,
  opts: PdfIngestionOptions = {},
): Promise<PdfIngestionResult> {
  const pageConcurrency = opts.pageConcurrency ?? getCpuConcurrency();
  const visionConcurrency = opts.visionConcurrency ?? VISION_CONCURRENCY;
  const chunkingConfig: ChunkingConfig = opts.chunkingConfig ?? { maxChunkSize: 1000, overlap: 200 };

  const pageNumbers = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  const outline = await buildPageOutlineMap(pdf);
  const reportProgress = makeProgressReporter(opts.onProgress);

  // Stage 1 — extract text + detect visuals in parallel (CPU-bound).
  let extractedDone = 0;
  const extracted = await runWithLimit(pageNumbers, pageConcurrency, async (pageNumber) => {
    const result = await extractPage(pdf, pageNumber);
    extractedDone++;
    reportProgress({ stage: 'extracting', done: extractedDone, total: pageNumbers.length });
    return result;
  });

  // `files.content` keeps the joined per-page text so the existing `read` tool
  // continues to work without any change to its content path.
  const fullText = extracted
    .map((p) => p.text.trim())
    .filter((t) => t.length > 0)
    .join('\n\n');

  // Stage 2 — describe visual pages (network/local-LLM bound), but only when
  // the active provider exposes a vision pathway.
  const errors: PdfIngestionResult['errors'] = [];
  const visualPages = extracted.filter((p) => p.hasVisuals);
  const visionPossible = !opts.skipVision && visualPages.length > 0
    ? await isVisionAvailable()
    : false;

  const descriptions = new Map<number, string>();
  if (visionPossible) {
    let visionDone = 0;
    await runWithLimit(visualPages, visionConcurrency, async (page) => {
      try {
        const png = await renderPageToPngBase64(page.pageProxy, PAGE_RENDER_SCALE);
        if (!png) return;
        const section = sectionForPage(page.pageNumber, outline);
        const prompt = buildVisionPrompt(page.pageNumber, section);
        const description = await describeImage({
          base64: png,
          mime: 'image/png',
          prompt,
        });
        if (description && description.trim().length > 0) {
          descriptions.set(page.pageNumber, description.trim());
        }
      } catch (err) {
        errors.push({
          pageNumber: page.pageNumber,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        visionDone++;
        reportProgress({
          stage: 'visual_describe',
          done: visionDone,
          total: visualPages.length,
        });
      }
    });
  }

  // Stage 3 — assemble chunks (text + visual descriptions) with metadata.
  const chunks = buildChunks({
    extracted,
    descriptions,
    outline,
    fileId,
    projectId,
    chunkingConfig,
  });

  if (chunks.length === 0) {
    return {
      fullText,
      chunksWritten: 0,
      visualPagesDetected: visualPages.length,
      visualDescriptionsCreated: descriptions.size,
      errors,
    };
  }

  // Stage 4 — persist. Replace any prior chunks/embeddings for this file so
  // re-ingestion is idempotent.
  const conn = getConnection();
  await conn.query(`DELETE FROM embeddings WHERE file_id = '${fileId}'`);
  await conn.query(`DELETE FROM chunks WHERE file_id = '${fileId}'`);

  await dbCreateChunks(chunks);

  try {
    const embeddings = await generateEmbeddingsForChunks(chunks);
    await dbCreateEmbeddings(embeddings);
  } catch (err) {
    errors.push({
      pageNumber: 0,
      message: `embedding generation failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  await flushDatabase();

  reportProgress({ stage: 'embedding', done: 1, total: 1 });

  return {
    fullText,
    chunksWritten: chunks.length,
    visualPagesDetected: visualPages.length,
    visualDescriptionsCreated: descriptions.size,
    errors,
  };
}

/**
 * Wrap the user-supplied progress callback so a thrown caller error never
 * breaks ingestion. We swallow the error and continue.
 */
function makeProgressReporter(
  onProgress: PdfIngestionOptions['onProgress'],
): (p: PdfIngestionProgress) => void {
  if (!onProgress) return () => {};
  return (progress: PdfIngestionProgress) => {
    try {
      onProgress(progress);
    } catch {
      /* progress callback errors must not abort ingestion */
    }
  };
}

/**
 * Convenience helper used by `extractText` callers that need the joined
 * per-page text without persisting anything (e.g. `syncService.createFile`
 * needs it to populate `files.content`).
 */
export async function extractFullPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  try {
    const pageNumbers = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    const parts = await runWithLimit(pageNumbers, getCpuConcurrency(), async (pageNumber) => {
      const { text } = await extractPage(pdf, pageNumber);
      return text;
    });
    return parts.map((t) => t.trim()).filter((t) => t.length > 0).join('\n\n');
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

// ============================================
// Page extraction + visual detection
// ============================================

async function extractPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<ExtractedPage> {
  const page = await pdf.getPage(pageNumber);
  const text = await extractPageText(page);
  const hasVisuals = await detectVisuals(page, text);
  return { pageNumber, text, hasVisuals, pageProxy: page };
}

async function extractPageText(page: PDFPageProxy): Promise<string> {
  const textContent = await page.getTextContent();
  return textContent.items
    .filter((item): item is TextItem => typeof item === 'object' && item !== null && 'str' in item)
    .map((item) => item.str)
    .join(' ');
}

/**
 * A page counts as "visual" if it contains raster image XObjects, OR if its
 * text is sparse and its operator list shows a heavy concentration of vector
 * drawing ops (typical of charts and diagrams drawn with paths).
 */
async function detectVisuals(page: PDFPageProxy, text: string): Promise<boolean> {
  const opList = await page.getOperatorList();
  const fnArray = opList.fnArray;

  let imageOps = 0;
  let pathOps = 0;
  for (let i = 0; i < fnArray.length; i++) {
    const op = fnArray[i];
    if (
      op === OPS.paintImageXObject ||
      op === OPS.paintInlineImageXObject ||
      op === OPS.paintImageMaskXObject ||
      op === OPS.paintImageXObjectRepeat ||
      op === OPS.paintImageMaskXObjectRepeat
    ) {
      imageOps++;
    } else if (
      op === OPS.constructPath ||
      op === OPS.fill ||
      op === OPS.stroke
    ) {
      pathOps++;
    }
  }

  if (imageOps > 0) return true;
  const trimmedLength = text.trim().length;
  return trimmedLength < SPARSE_TEXT_THRESHOLD && pathOps >= VECTOR_PATH_DENSITY_THRESHOLD;
}

// ============================================
// Outline → page-section map
// ============================================

interface OutlineNode {
  title?: string;
  dest?: string | unknown[] | null;
  items?: OutlineNode[];
}

/**
 * Walk the PDF outline (bookmarks) and produce a sorted list of
 * `{ title, pageIndex }`. We skip entries whose destinations can't be
 * resolved. Returns an empty array for outline-less PDFs; in that case
 * `sectionForPage` will return `undefined`.
 */
async function buildPageOutlineMap(pdf: PDFDocumentProxy): Promise<OutlineEntry[]> {
  let outline: OutlineNode[] | null = null;
  try {
    outline = (await pdf.getOutline()) as OutlineNode[] | null;
  } catch {
    outline = null;
  }
  if (!outline || outline.length === 0) return [];

  const entries: OutlineEntry[] = [];

  const walk = async (nodes: OutlineNode[]): Promise<void> => {
    for (const node of nodes) {
      const pageIndex = await resolveOutlinePage(pdf, node.dest);
      if (pageIndex != null && typeof node.title === 'string') {
        entries.push({ title: node.title.trim(), pageIndex });
      }
      if (node.items && node.items.length > 0) {
        await walk(node.items);
      }
    }
  };
  await walk(outline);

  entries.sort((a, b) => a.pageIndex - b.pageIndex);
  return entries;
}

async function resolveOutlinePage(
  pdf: PDFDocumentProxy,
  dest: OutlineNode['dest'],
): Promise<number | null> {
  try {
    let resolved: unknown = dest;
    if (typeof dest === 'string') {
      resolved = await pdf.getDestination(dest);
    }
    if (!Array.isArray(resolved) || resolved.length === 0) return null;
    const ref = resolved[0];
    const pageIndex = await pdf.getPageIndex(ref as Parameters<typeof pdf.getPageIndex>[0]);
    return typeof pageIndex === 'number' ? pageIndex : null;
  } catch {
    return null;
  }
}

function sectionForPage(pageNumber: number, outline: OutlineEntry[]): string | undefined {
  if (outline.length === 0) return undefined;
  const pageIndex = pageNumber - 1;
  // Find the last outline entry whose page index is <= this page.
  let match: OutlineEntry | undefined;
  for (const entry of outline) {
    if (entry.pageIndex <= pageIndex) {
      match = entry;
    } else {
      break;
    }
  }
  return match?.title || undefined;
}

// ============================================
// Page rendering (in-memory PNG)
// ============================================

/**
 * Render a PDF page to a transient PNG and return its base64 payload.
 * The canvas is created off-DOM and dropped before this function returns,
 * so no bitmap remains in memory after the caller finishes with the string.
 *
 * Returns `null` in environments where canvas-based rendering is unavailable
 * (e.g. Node-based unit tests). Callers should treat `null` as "skip this page".
 */
export async function renderPageToPngBase64(
  page: PDFPageProxy,
  scale: number,
): Promise<string | null> {
  if (typeof document === 'undefined') return null;

  // Any failure here (no 2D context, canvas not implemented in the test env,
  // render throwing for an unsupported page) should degrade to "skip vision
  // for this page" rather than abort the whole ingestion run.
  try {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) return null;

    await page.render({ canvas, canvasContext: context, viewport }).promise;

    const dataUrl = canvas.toDataURL('image/png');
    // Free the bitmap before we leave: shrink to 0 and drop the reference.
    canvas.width = 0;
    canvas.height = 0;

    const commaIdx = dataUrl.indexOf(',');
    return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : null;
  } catch {
    return null;
  }
}

// ============================================
// Chunk assembly
// ============================================

interface BuildChunksParams {
  extracted: ExtractedPage[];
  descriptions: Map<number, string>;
  outline: OutlineEntry[];
  fileId: string;
  projectId: string;
  chunkingConfig: ChunkingConfig;
}

function buildChunks(params: BuildChunksParams): Chunk[] {
  const { extracted, descriptions, outline, fileId, projectId, chunkingConfig } = params;

  const out: Chunk[] = [];
  let runningIndex = 0;

  for (const page of extracted) {
    const section = sectionForPage(page.pageNumber, outline);
    const trimmed = page.text.trim();

    // Text chunks for this page (may be 0 if the page is empty, or 1-N if long).
    if (trimmed.length > 0) {
      // We pass the per-page text only — `chunkText` handles size + sentence
      // boundaries. We don't need section-aware splitting here; section is
      // attached as metadata per chunk, not used as a split boundary.
      const subChunks = chunkText(trimmed, fileId, projectId, chunkingConfig);
      for (const sub of subChunks) {
        out.push({
          ...sub,
          index: runningIndex++,
          pageNumber: page.pageNumber,
          section,
          kind: 'text',
        });
      }
    }

    const description = descriptions.get(page.pageNumber);
    if (description && description.length > 0) {
      out.push({
        id: crypto.randomUUID(),
        fileId,
        projectId,
        index: runningIndex++,
        text: description,
        startOffset: 0,
        endOffset: description.length,
        pageNumber: page.pageNumber,
        section,
        kind: 'visual_description',
        createdAt: new Date(),
      });
    }
  }

  return out;
}

function buildVisionPrompt(pageNumber: number, section: string | undefined): string {
  const header = VISION_PROMPT_HEADER;
  const context = section
    ? `Page ${pageNumber} — Section "${section}".`
    : `Page ${pageNumber}.`;
  return `${header}\n\nContext: ${context}`;
}
