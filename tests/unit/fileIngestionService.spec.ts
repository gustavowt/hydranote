import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { ProjectFile } from '../../src/types';

// ---- module mocks --------------------------------------------------------

const createFileMock = vi.fn();
const indexFileForSearchMock = vi.fn();

vi.mock('../../src/services/projectService', () => ({
  createFile: (...args: unknown[]) => createFileMock(...args),
  indexFileForSearch: (...args: unknown[]) => indexFileForSearchMock(...args),
}));

const detectFileTypeMock = vi.fn();
const getFileBinaryDataMock = vi.fn();
const convertDOCXToHTMLMock = vi.fn();

vi.mock('../../src/services/documentProcessor', () => ({
  detectFileType: (...args: unknown[]) => detectFileTypeMock(...args),
  getFileBinaryData: (...args: unknown[]) => getFileBinaryDataMock(...args),
  convertDOCXToHTML: (...args: unknown[]) => convertDOCXToHTMLMock(...args),
}));

// pdfIngestionService imports the worker URL via Vite syntax — stub the URL
// so the bare `import` chain resolves under vitest.
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));

const ingestPdfForSearchMock = vi.fn();
const extractFullPdfTextMock = vi.fn();

vi.mock('../../src/services/pdfIngestionService', () => ({
  ingestPdfForSearch: (...args: unknown[]) => ingestPdfForSearchMock(...args),
  extractFullPdfText: (...args: unknown[]) => extractFullPdfTextMock(...args),
}));

// ---- helpers -------------------------------------------------------------

function makeProjectFile(id: string, name: string): ProjectFile {
  return {
    id,
    projectId: 'proj-1',
    name,
    path: name,
    type: 'md',
    size: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ProjectFile;
}

/**
 * jsdom's `File` polyfill does not implement `.text()`, but the production
 * code uses it for md/txt ingestion. This helper builds a `File` and bolts a
 * spec-compliant `text()` that resolves to the supplied string.
 */
function makeTextFile(name: string, content: string, type = 'text/plain'): File {
  const file = new File([content], name, { type });
  Object.defineProperty(file, 'text', {
    value: () => Promise.resolve(content),
    writable: false,
    configurable: true,
  });
  return file;
}

// ---- tests ---------------------------------------------------------------

describe('fileIngestionService', () => {
  beforeEach(() => {
    createFileMock.mockReset();
    indexFileForSearchMock.mockReset();
    detectFileTypeMock.mockReset();
    getFileBinaryDataMock.mockReset();
    convertDOCXToHTMLMock.mockReset();
    ingestPdfForSearchMock.mockReset();
    extractFullPdfTextMock.mockReset();
  });

  test('text files: routes through createFile and reports progress', async () => {
    detectFileTypeMock.mockReturnValue('md');
    const created = makeProjectFile('file-1', 'note.md');
    createFileMock.mockResolvedValue(created);

    const { ingestExternalFiles, ingestionProgress, _resetIngestionProgressForTests } =
      await import('../../src/services/fileIngestionService');
    _resetIngestionProgressForTests();

    const file = makeTextFile('note.md', '# hello', 'text/markdown');

    const result = await ingestExternalFiles(
      [{ file, relativePath: 'note.md' }],
      'proj-1',
      undefined,
    );

    expect(result.created).toEqual([created]);
    expect(result.failed).toEqual([]);

    expect(createFileMock).toHaveBeenCalledWith('proj-1', 'note.md', '# hello', 'md');
    expect(indexFileForSearchMock).not.toHaveBeenCalled();

    const finalSnapshot = ingestionProgress.value.get('file-1');
    expect(finalSnapshot).toBeTruthy();
    expect(finalSnapshot!.fileName).toBe('note.md');
    expect(finalSnapshot!.percent).toBe(100);
  });

  test('publishes a ghost row before createFile and clears it once the row exists', async () => {
    detectFileTypeMock.mockReturnValue('pdf');
    extractFullPdfTextMock.mockResolvedValue('full pdf text');
    const created = makeProjectFile('file-pdf', 'doc.pdf');
    ingestPdfForSearchMock.mockResolvedValue(undefined);

    const { ingestExternalFiles, pendingDrops, _resetIngestionProgressForTests } =
      await import('../../src/services/fileIngestionService');
    _resetIngestionProgressForTests();

    // Snapshot the pendingDrops state at two points: during PDF extraction
    // (before createFile runs) and during ingestPdfForSearch (after).
    let preCreateSize = -1;
    let preCreateEntry: ReturnType<typeof pendingDrops.value.values> | null = null;
    extractFullPdfTextMock.mockImplementation(async () => {
      preCreateSize = pendingDrops.value.size;
      preCreateEntry = pendingDrops.value.values() as unknown as ReturnType<typeof pendingDrops.value.values>;
      return 'full pdf text';
    });

    let postCreateSize = -1;
    ingestPdfForSearchMock.mockImplementation(async () => {
      postCreateSize = pendingDrops.value.size;
    });

    let createFileResolve: ((file: ProjectFile) => void) | null = null;
    createFileMock.mockImplementation(
      () =>
        new Promise<ProjectFile>((resolve) => {
          createFileResolve = resolve;
          // Resolve on next tick to make the "between extract and ingest" gap
          // observable to the test.
          setTimeout(() => resolve(created), 0);
        }),
    );

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const file = new File([pdfBytes], 'doc.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(pdfBytes.buffer.slice(0)),
      writable: false,
      configurable: true,
    });

    const result = await ingestExternalFiles(
      [{ file, relativePath: 'sub/doc.pdf' }],
      'proj-1',
      'Reports',
    );

    expect(result.created).toEqual([created]);

    // During extract (before createFile resolved), the ghost was present.
    expect(preCreateSize).toBe(1);
    const entry = Array.from((preCreateEntry as unknown as Iterable<unknown>) || [])[0] as {
      fileName: string;
      displayPath: string;
      targetDirectory?: string;
      fileType: string;
    };
    expect(entry.fileName).toBe('doc.pdf');
    expect(entry.displayPath).toBe('Reports/sub/doc.pdf');
    expect(entry.targetDirectory).toBe('Reports');
    expect(entry.fileType).toBe('pdf');

    // After createFile, the ghost is gone (the persisted row takes over).
    expect(postCreateSize).toBe(0);

    // And nothing leaks after the batch settles.
    expect(pendingDrops.value.size).toBe(0);
    void createFileResolve; // suppress unused-binding warning
  });

  test('invokes onFileCreated with the persisted ProjectFile after createFile resolves', async () => {
    detectFileTypeMock.mockReturnValue('md');
    const created = makeProjectFile('file-onfc', 'memo.md');
    createFileMock.mockResolvedValue(created);
    indexFileForSearchMock.mockResolvedValue(undefined);

    const onFileCreated = vi.fn();

    const { ingestExternalFiles, _resetIngestionProgressForTests } = await import(
      '../../src/services/fileIngestionService'
    );
    _resetIngestionProgressForTests();

    const file = makeTextFile('memo.md', 'body', 'text/markdown');
    await ingestExternalFiles(
      [{ file, relativePath: 'memo.md' }],
      'proj-1',
      undefined,
      onFileCreated,
    );

    expect(onFileCreated).toHaveBeenCalledTimes(1);
    expect(onFileCreated).toHaveBeenCalledWith(created);
  });

  test('clears the ghost row when ingestion fails before createFile', async () => {
    detectFileTypeMock.mockReturnValue('pdf');
    // Failure path: PDF extraction throws BEFORE createFile is ever called,
    // so the ghost row must still be cleaned up.
    extractFullPdfTextMock.mockRejectedValue(new Error('corrupt PDF'));

    const onFileCreated = vi.fn();
    const { ingestExternalFiles, pendingDrops, _resetIngestionProgressForTests } =
      await import('../../src/services/fileIngestionService');
    _resetIngestionProgressForTests();

    const file = new File([new Uint8Array([0x25])], 'broken.pdf', {
      type: 'application/pdf',
    });
    const result = await ingestExternalFiles(
      [{ file, relativePath: 'broken.pdf' }],
      'proj-1',
      undefined,
      onFileCreated,
    );

    expect(result.created).toEqual([]);
    expect(result.failed).toEqual([{ name: 'broken.pdf', error: 'corrupt PDF' }]);
    expect(onFileCreated).not.toHaveBeenCalled();
    expect(pendingDrops.value.size).toBe(0);
  });

  test('text files: prefixes targetDirectory onto the relative path', async () => {
    detectFileTypeMock.mockReturnValue('md');
    createFileMock.mockResolvedValue(makeProjectFile('file-2', 'note.md'));
    indexFileForSearchMock.mockResolvedValue(undefined);

    const { ingestExternalFiles, _resetIngestionProgressForTests } =
      await import('../../src/services/fileIngestionService');
    _resetIngestionProgressForTests();

    const file = makeTextFile('note.md', 'x', 'text/markdown');
    await ingestExternalFiles(
      [{ file, relativePath: 'inner/note.md' }],
      'proj-1',
      'Reports/Q1',
    );

    expect(createFileMock).toHaveBeenCalledWith('proj-1', 'Reports/Q1/inner/note.md', 'x', 'md');
  });

  test('pdf: extracts text first, then runs page-aware ingestion with progress mapping', async () => {
    detectFileTypeMock.mockReturnValue('pdf');
    extractFullPdfTextMock.mockResolvedValue('full pdf text');
    const createdPdf = makeProjectFile('file-pdf', 'doc.pdf');
    createFileMock.mockResolvedValue(createdPdf);

    type ProgressFn = (p: { stage: string; done: number; total: number }) => void;
    let capturedProgressFn: ProgressFn | null = null;
    ingestPdfForSearchMock.mockImplementation(
      async (
        _projectId: string,
        _fileId: string,
        _file: File,
        opts?: { onProgress?: ProgressFn },
      ) => {
        capturedProgressFn = opts?.onProgress ?? null;
      },
    );

    const { ingestExternalFiles, ingestionProgress, _resetIngestionProgressForTests } =
      await import('../../src/services/fileIngestionService');
    _resetIngestionProgressForTests();

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const file = new File([pdfBytes], 'doc.pdf', {
      type: 'application/pdf',
    });
    // jsdom's File polyfill doesn't always implement `arrayBuffer()` on the
    // Blob view; stub it so the production code can persist the binary.
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(pdfBytes.buffer.slice(0)),
      writable: false,
      configurable: true,
    });

    const result = await ingestExternalFiles(
      [{ file, relativePath: 'doc.pdf' }],
      'proj-1',
      undefined,
    );

    expect(result.created).toEqual([createdPdf]);
    expect(extractFullPdfTextMock).toHaveBeenCalledWith(file);
    // Binary bytes must be persisted so PDFViewer can re-render the document
    // later — drop-ingested PDFs have no systemFilePath.
    expect(createFileMock).toHaveBeenCalledTimes(1);
    const createFileArgs = createFileMock.mock.calls[0];
    expect(createFileArgs[0]).toBe('proj-1');
    expect(createFileArgs[1]).toBe('doc.pdf');
    expect(createFileArgs[2]).toBe('full pdf text');
    expect(createFileArgs[3]).toBe('pdf');
    expect(createFileArgs[4]).toBeInstanceOf(Uint8Array);
    expect(Array.from(createFileArgs[4] as Uint8Array)).toEqual(Array.from(pdfBytes));
    expect(createFileArgs[5]).toBeUndefined();
    expect(createFileArgs[6]).toBeUndefined();
    expect(ingestPdfForSearchMock).toHaveBeenCalled();

    // Drive the progress callback through each stage and assert the bar
    // advances monotonically within the documented bands.
    expect(capturedProgressFn).toBeTruthy();
    const fn = capturedProgressFn as unknown as ProgressFn;

    fn({ stage: 'extracting', done: 1, total: 2 });
    const afterExtract = ingestionProgress.value.get('file-pdf');
    expect(afterExtract).toBeDefined();
    expect(afterExtract!.percent).toBeGreaterThanOrEqual(20);
    expect(afterExtract!.percent).toBeLessThanOrEqual(50);

    fn({ stage: 'visual_describe', done: 2, total: 2 });
    const afterVision = ingestionProgress.value.get('file-pdf');
    expect(afterVision!.percent).toBeGreaterThan(afterExtract!.percent);
    expect(afterVision!.percent).toBeLessThanOrEqual(85);

    fn({ stage: 'embedding', done: 1, total: 1 });
    const afterEmbedding = ingestionProgress.value.get('file-pdf');
    expect(afterEmbedding!.percent).toBeGreaterThanOrEqual(afterVision!.percent);
    // We hold at <100 until the post-pipeline 100% publish below.
    expect(afterEmbedding!.percent).toBeLessThanOrEqual(99);
  });

  test('rejects unsupported file types without calling createFile', async () => {
    detectFileTypeMock.mockReturnValue(null);

    const { ingestExternalFiles, _resetIngestionProgressForTests } =
      await import('../../src/services/fileIngestionService');
    _resetIngestionProgressForTests();

    const file = new File(['junk'], 'archive.zip', { type: 'application/zip' });
    const result = await ingestExternalFiles(
      [{ file, relativePath: 'archive.zip' }],
      'proj-1',
      undefined,
    );

    expect(result.created).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].name).toBe('archive.zip');
    expect(createFileMock).not.toHaveBeenCalled();
  });

  test('cleans up progress entries on ingestion failure', async () => {
    detectFileTypeMock.mockReturnValue('md');
    createFileMock.mockRejectedValue(new Error('disk full'));

    const { ingestExternalFiles, ingestionProgress, _resetIngestionProgressForTests } =
      await import('../../src/services/fileIngestionService');
    _resetIngestionProgressForTests();

    const file = makeTextFile('note.md', 'x', 'text/markdown');
    const result = await ingestExternalFiles(
      [{ file, relativePath: 'note.md' }],
      'proj-1',
      undefined,
    );

    expect(result.created).toEqual([]);
    expect(result.failed).toEqual([{ name: 'note.md', error: 'disk full' }]);
    expect(ingestionProgress.value.size).toBe(0);
  });

  test('flatFilesToEntries returns one entry per file with relativePath = name', async () => {
    const { flatFilesToEntries } = await import('../../src/services/fileIngestionService');
    const a = new File(['a'], 'a.md');
    const b = new File(['b'], 'b.md');
    const entries = flatFilesToEntries([a, b]);
    expect(entries).toEqual([
      { file: a, relativePath: 'a.md' },
      { file: b, relativePath: 'b.md' },
    ]);
  });

  test('collectDroppedEntries walks nested directory entries recursively', async () => {
    const { collectDroppedEntries } = await import('../../src/services/fileIngestionService');

    const buildFileEntry = (name: string, content: string): FileSystemFileEntry => ({
      isFile: true,
      isDirectory: false,
      name,
      fullPath: `/${name}`,
      filesystem: {} as FileSystem,
      file: (cb: (file: File) => void) => cb(new File([content], name)),
      // FileSystemFileEntry has more methods, but the production code only
      // calls `file()`, so the cast below silences the missing-members error.
    } as unknown as FileSystemFileEntry);

    const buildDirEntry = (
      name: string,
      children: FileSystemEntry[],
    ): FileSystemDirectoryEntry => ({
      isFile: false,
      isDirectory: true,
      name,
      fullPath: `/${name}`,
      filesystem: {} as FileSystem,
      createReader: () => {
        let returned = false;
        return {
          readEntries: (cb: (entries: FileSystemEntry[]) => void) => {
            if (returned) {
              cb([]);
            } else {
              returned = true;
              cb(children);
            }
          },
        } as unknown as FileSystemDirectoryReader;
      },
    } as unknown as FileSystemDirectoryEntry);

    const tree = buildDirEntry('Reports', [
      buildFileEntry('summary.md', 'top-level'),
      buildDirEntry('Q1', [buildFileEntry('sales.md', 'q1 sales')]),
    ]);

    const dataItem = {
      kind: 'file',
      type: '',
      webkitGetAsEntry: () => tree,
      getAsFile: () => null,
    } as unknown as DataTransferItem;

    const entries = await collectDroppedEntries([dataItem]);
    const paths = entries.map((e) => e.relativePath).sort();

    expect(paths).toEqual(['Reports/Q1/sales.md', 'Reports/summary.md']);
  });
});
