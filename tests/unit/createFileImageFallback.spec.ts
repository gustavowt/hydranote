import { describe, expect, test, vi, beforeEach } from 'vitest';

{
  const store = new Map<string, string>();
  const polyfill: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: polyfill,
    writable: true,
    configurable: true,
  });
}

const writeBinaryFileMock = vi.fn();
const dbCreateFileMock = vi.fn().mockResolvedValue(undefined);
const dbGetProjectMock = vi.fn();
const flushDatabaseMock = vi.fn().mockResolvedValue(undefined);
const initializeDatabaseMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/versionService', () => ({
  createInitialVersion: vi.fn().mockResolvedValue(undefined),
  createUpdateVersion: vi.fn(),
}));

vi.mock('../../src/services/database', () => ({
  initializeDatabase: (...args: unknown[]) => initializeDatabaseMock(...args),
  createFile: (...args: unknown[]) => dbCreateFileMock(...args),
  getProject: (...args: unknown[]) => dbGetProjectMock(...args),
  flushDatabase: (...args: unknown[]) => flushDatabaseMock(...args),
  getConnection: () => ({ query: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('../../src/services/syncService', () => ({
  syncFileToFileSystem: vi.fn(),
  syncFileDelete: vi.fn(),
  syncProjectCreate: vi.fn(),
  syncProjectDelete: vi.fn(),
}));

vi.mock('../../src/services/fileSystemService', () => ({
  writeBinaryFile: (...args: unknown[]) => writeBinaryFileMock(...args),
}));

vi.mock('../../src/services/documentProcessor', () => ({
  chunkMarkdownText: vi.fn(),
  chunkText: vi.fn(),
  processDocument: vi.fn(),
  isFileTypeSupported: vi.fn(),
}));

vi.mock('../../src/services/embeddingService', () => ({
  generateEmbeddingsForChunks: vi.fn().mockResolvedValue([]),
  generateEmbedding: vi.fn(),
  computeContentHash: vi.fn(() => 'abc123'),
  reindexFilesMissingChunks: vi.fn().mockResolvedValue({ reindexed: 0, failed: 0 }),
}));

describe('createFile image DB fallback', () => {
  beforeEach(async () => {
    vi.resetModules();
    writeBinaryFileMock.mockReset();
    dbCreateFileMock.mockClear();
    dbGetProjectMock.mockReset();
    localStorage.clear();

    dbGetProjectMock.mockResolvedValue({
      id: 'p1',
      name: 'Test Project',
      description: '',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    writeBinaryFileMock.mockResolvedValue({
      success: false,
      error: 'File system sync is not enabled',
    });
  });

  test('persists image binary to DB when filesystem write fails', async () => {
    const { createFile } = await import('../../src/services/projectService');
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    const file = await createFile('p1', 'images/test.png', '', 'png', bytes);

    expect(file.type).toBe('png');
    expect(file.binaryData).toBeTruthy();
    expect(dbCreateFileMock).toHaveBeenCalled();
    const dbRecord = dbCreateFileMock.mock.calls[0][0] as { binaryData?: string };
    expect(dbRecord.binaryData).toBeTruthy();
  });

  test('rejects oversized images when filesystem write fails', async () => {
    const { createFile } = await import('../../src/services/projectService');
    const bytes = new Uint8Array(6 * 1024 * 1024);

    await expect(
      createFile('p1', 'images/huge.png', '', 'png', bytes),
    ).rejects.toThrow(/too large/i);
  });
});
