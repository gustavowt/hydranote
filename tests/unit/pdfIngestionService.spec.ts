import { describe, expect, test, vi, beforeEach } from 'vitest';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
} from 'pdfjs-dist/types/src/display/api';
import type { Chunk, Embedding } from '../../src/types';

// Mock `pdfjs-dist` before importing the ingestion service. The real ESM build
// touches `DOMMatrix` at module load (browser-only), which crashes Node-based
// vitest. We only need the numeric `OPS` constants the pipeline uses.
const OPS = {
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageMaskXObject: 83,
  paintImageXObjectRepeat: 88,
  paintImageMaskXObjectRepeat: 87,
  constructPath: 91,
  fill: 24,
  stroke: 21,
} as const;

vi.mock('pdfjs-dist', () => ({
  OPS,
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => ({
    promise: Promise.reject(new Error('getDocument should not be called in unit tests')),
  })),
}));

// `pdfjs-dist/build/pdf.worker.min.mjs?url` is a Vite import; vitest needs it
// stubbed so the ingestion service module can resolve.
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));

// `documentProcessor` imports the worker URL too; stub it out.
vi.mock('../../src/services/documentProcessor', async () => {
  // Pull the real `chunkText` implementation by re-exporting only that helper
  // from a fresh, side-effect-free copy. We provide a minimal local
  // implementation here that mirrors the production behavior closely enough
  // for the test's assertions.
  return {
    chunkText: (text: string, fileId: string, projectId: string) => {
      const cleaned = text.replace(/\s+/g, ' ').trim();
      if (cleaned.length === 0) return [];
      return [
        {
          id: `chunk-${Math.random().toString(36).slice(2)}`,
          fileId,
          projectId,
          index: 0,
          text: cleaned,
          startOffset: 0,
          endOffset: cleaned.length,
          createdAt: new Date(),
        },
      ];
    },
  };
});

// ---- module mocks --------------------------------------------------------

// `database` is heavy (DuckDB WASM). We replace it with in-memory stand-ins
// that capture the data the ingestion pipeline persists, so the test can
// assert chunk shape and ordering without booting DuckDB.
const insertedChunks: Chunk[] = [];
const insertedEmbeddings: Embedding[] = [];

vi.mock('../../src/services/database', () => {
  return {
    getConnection: () => ({
      query: vi.fn(async () => ({ toArray: () => [] })),
    }),
    flushDatabase: vi.fn(async () => {}),
    deleteFileSearchData: vi.fn(async () => {}),
    createChunks: vi.fn(async (chunks: Chunk[]) => {
      insertedChunks.push(...chunks);
    }),
    createEmbeddings: vi.fn(async (embs: Embedding[]) => {
      insertedEmbeddings.push(...embs);
    }),
  };
});

// Embedding generation — produce deterministic stub vectors so we can verify
// ordering without depending on the real embedder (which would call out to a
// remote model).
vi.mock('../../src/services/embeddingService', () => {
  return {
    generateEmbeddingsForChunks: vi.fn(async (chunks: Chunk[]): Promise<Embedding[]> =>
      chunks.map((c, i) => ({
        id: `emb-${i}`,
        chunkId: c.id,
        fileId: c.fileId,
        projectId: c.projectId,
        vector: [i, i, i],
        createdAt: new Date(),
      })),
    ),
  };
});

// Vision adapter — record calls and return a canned description per page so
// the test can assert that visual pages produce a `visual_description` chunk.
const visionCalls: Array<{ prompt: string }> = [];
vi.mock('../../src/services/visionService', () => {
  return {
    describeImage: vi.fn(async (req: { prompt: string }) => {
      visionCalls.push({ prompt: req.prompt });
      return `Vision description for ${req.prompt}`;
    }),
    isVisionAvailable: vi.fn(async () => true),
  };
});

// ---- helpers -------------------------------------------------------------

interface PageBuilderOptions {
  pageNumber: number;
  text: string;
  hasImageOps?: boolean;
  pathOpCount?: number;
}

/**
 * Build a minimal `PDFPageProxy` good enough for the ingestion pipeline. We
 * only stub the methods the pipeline actually calls.
 */
function buildPage(opts: PageBuilderOptions): PDFPageProxy {
  const items = opts.text
    .split(' ')
    .filter((w) => w.length > 0)
    .map((str) => ({ str, dir: 'ltr', width: 0, height: 0, transform: [], fontName: '', hasEOL: false }));

  const fnArray: number[] = [];
  if (opts.hasImageOps) {
    fnArray.push(OPS.paintImageXObject);
  }
  for (let i = 0; i < (opts.pathOpCount ?? 0); i++) {
    fnArray.push(OPS.constructPath);
  }

  // We never render in unit tests (no DOM canvas). `renderPageToPngBase64`
  // returns `null` when `document` is undefined, which the pipeline treats
  // as "skip render" — exactly the behavior we want here.
  const page: Partial<PDFPageProxy> = {
    getTextContent: vi.fn(async () => ({
      items,
      styles: {},
      lang: null,
    })) as unknown as PDFPageProxy['getTextContent'],
    getOperatorList: vi.fn(async () => ({
      fnArray,
      argsArray: fnArray.map(() => []),
    })) as unknown as PDFPageProxy['getOperatorList'],
    getViewport: vi.fn(() => ({ width: 100, height: 100 })) as unknown as PDFPageProxy['getViewport'],
    render: vi.fn(() => ({ promise: Promise.resolve() })) as unknown as PDFPageProxy['render'],
  };
  return page as PDFPageProxy;
}

interface DocBuilderOptions {
  pages: PageBuilderOptions[];
  outline?: Array<{ title: string; pageIndex: number }>;
}

function buildDocument(opts: DocBuilderOptions): PDFDocumentProxy {
  const pages = opts.pages.map(buildPage);
  // Each outline entry's `dest` is the array PDF.js returns from
  // `getDestination`. The first element is the page ref; we encode the target
  // page index directly on that ref so the mocked `getPageIndex` can resolve
  // it without an actual PDF objects table.
  const outlineNodes = (opts.outline ?? []).map((entry) => ({
    title: entry.title,
    dest: [{ pageIndex: entry.pageIndex }],
  }));

  const doc: Partial<PDFDocumentProxy> = {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1]) as unknown as PDFDocumentProxy['getPage'],
    getOutline: vi.fn(async () => outlineNodes) as unknown as PDFDocumentProxy['getOutline'],
    getDestination: vi.fn(async (name: string) => name) as unknown as PDFDocumentProxy['getDestination'],
    getPageIndex: vi.fn(async (ref: unknown) => {
      const r = ref as { pageIndex?: number };
      return typeof r?.pageIndex === 'number' ? r.pageIndex : 0;
    }) as unknown as PDFDocumentProxy['getPageIndex'],
    destroy: vi.fn(async () => {}) as unknown as PDFDocumentProxy['destroy'],
  };
  return doc as PDFDocumentProxy;
}

// ---- tests ---------------------------------------------------------------

describe('ingestPdfFromDocument', () => {
  beforeEach(() => {
    insertedChunks.length = 0;
    insertedEmbeddings.length = 0;
    visionCalls.length = 0;
  });

  test('chunks each page with page/section metadata and tags visual chunks', async () => {
    const { ingestPdfFromDocument } = await import('../../src/services/pdfIngestionService');

    const longTextP1 = Array(80).fill('alpha beta gamma').join(' ');
    const visualText = 'minimal caption';

    const doc = buildDocument({
      pages: [
        { pageNumber: 1, text: longTextP1, hasImageOps: false, pathOpCount: 0 },
        { pageNumber: 2, text: visualText, hasImageOps: true, pathOpCount: 5 },
      ],
      outline: [
        { title: 'Introduction', pageIndex: 0 },
        { title: 'Diagrams', pageIndex: 1 },
      ],
    });

    // Force vision concurrency to 1 to make the test deterministic; renderPage
    // returns null in this environment so the vision call is skipped silently.
    // We force `isVisionAvailable` true (mock) to exercise the path that asks
    // `describeImage`, but since render returns null the description map stays
    // empty for visual page 2 — verifying the "no description" code path too.
    const result = await ingestPdfFromDocument('proj-1', 'file-1', doc, {
      pageConcurrency: 2,
      visionConcurrency: 1,
    });

    expect(result.chunksWritten).toBeGreaterThanOrEqual(1);
    expect(insertedChunks.length).toBe(result.chunksWritten);

    // Page 1 text chunks must carry section "Introduction" and pageNumber=1.
    const page1Chunks = insertedChunks.filter((c) => c.pageNumber === 1);
    expect(page1Chunks.length).toBeGreaterThan(0);
    for (const c of page1Chunks) {
      expect(c.section).toBe('Introduction');
      expect(c.kind).toBe('text');
    }

    // Visual page 2 has no rendered image (no DOM in unit tests), so the
    // pipeline records a visual page detected but produces no description.
    expect(result.visualPagesDetected).toBe(1);
    expect(result.visualDescriptionsCreated).toBe(0);

    // Embeddings 1:1 with chunks.
    expect(insertedEmbeddings.length).toBe(insertedChunks.length);
  });

  test('skips vision entirely when skipVision is true', async () => {
    const { ingestPdfFromDocument } = await import('../../src/services/pdfIngestionService');
    const visionService = await import('../../src/services/visionService');
    const isVisionAvailableMock = visionService.isVisionAvailable as unknown as ReturnType<typeof vi.fn>;
    const describeImageMock = visionService.describeImage as unknown as ReturnType<typeof vi.fn>;

    isVisionAvailableMock.mockClear();
    describeImageMock.mockClear();

    const doc = buildDocument({
      pages: [
        { pageNumber: 1, text: 'short', hasImageOps: true, pathOpCount: 0 },
      ],
    });

    const result = await ingestPdfFromDocument('proj-1', 'file-2', doc, {
      skipVision: true,
    });

    expect(isVisionAvailableMock).not.toHaveBeenCalled();
    expect(describeImageMock).not.toHaveBeenCalled();
    // Visual page is still detected, but we did not even probe vision.
    expect(result.visualPagesDetected).toBe(1);
    expect(result.visualDescriptionsCreated).toBe(0);
  });

  test('reports progress for each extracted page and once for embedding', async () => {
    const { ingestPdfFromDocument } = await import('../../src/services/pdfIngestionService');

    const doc = buildDocument({
      pages: [
        { pageNumber: 1, text: Array(40).fill('lorem ipsum').join(' '), hasImageOps: false, pathOpCount: 0 },
        { pageNumber: 2, text: Array(40).fill('dolor sit amet').join(' '), hasImageOps: false, pathOpCount: 0 },
      ],
    });

    const events: Array<{ stage: string; done: number; total: number }> = [];
    await ingestPdfFromDocument('proj-1', 'file-progress', doc, {
      pageConcurrency: 1,
      visionConcurrency: 1,
      skipVision: true,
      onProgress: (p) => events.push({ stage: p.stage, done: p.done, total: p.total }),
    });

    const extractEvents = events.filter((e) => e.stage === 'extracting');
    expect(extractEvents).toHaveLength(2);
    expect(extractEvents.map((e) => e.done)).toEqual([1, 2]);
    expect(extractEvents[1].total).toBe(2);

    const embeddingEvents = events.filter((e) => e.stage === 'embedding');
    expect(embeddingEvents).toHaveLength(1);
    expect(embeddingEvents[0]).toEqual({ stage: 'embedding', done: 1, total: 1 });
  });

  test('detects visual pages from dense path operators on sparse text', async () => {
    const { ingestPdfFromDocument } = await import('../../src/services/pdfIngestionService');

    const doc = buildDocument({
      pages: [
        // Sparse text + many path ops → counted as visual via the heuristic.
        { pageNumber: 1, text: 'tiny caption', hasImageOps: false, pathOpCount: 100 },
        // Plenty of text, no image ops, no path density → not visual.
        { pageNumber: 2, text: Array(50).fill('lorem ipsum dolor sit amet').join(' '), hasImageOps: false, pathOpCount: 100 },
      ],
    });

    const result = await ingestPdfFromDocument('proj-1', 'file-3', doc, {
      skipVision: true,
    });

    expect(result.visualPagesDetected).toBe(1);
  });
});
