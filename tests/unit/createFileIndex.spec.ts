import { describe, expect, test, vi, beforeEach } from 'vitest';

const connQueryMock = vi.fn().mockResolvedValue(undefined);
const dbCreateFileMock = vi.fn().mockResolvedValue(undefined);
const dbGetProjectMock = vi.fn();
const flushDatabaseMock = vi.fn().mockResolvedValue(undefined);
const initializeDatabaseMock = vi.fn().mockResolvedValue(undefined);
const syncFileToFileSystemMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/versionService', () => ({
  createInitialVersion: vi.fn().mockResolvedValue(undefined),
  createUpdateVersion: vi.fn(),
}));

vi.mock('../../src/services/database', () => ({
  initializeDatabase: (...args: unknown[]) => initializeDatabaseMock(...args),
  createFile: (...args: unknown[]) => dbCreateFileMock(...args),
  getProject: (...args: unknown[]) => dbGetProjectMock(...args),
  flushDatabase: (...args: unknown[]) => flushDatabaseMock(...args),
  getConnection: () => ({ query: connQueryMock }),
  deleteFileSearchData: vi.fn(async () => {
    await connQueryMock('DELETE FROM embeddings WHERE file_id = \'file-1\'');
    await connQueryMock('DELETE FROM chunks WHERE file_id = \'file-1\'');
  }),
  createChunks: vi.fn(async (chunks: Array<{ id: string; fileId: string; projectId: string; index: number; text: string; startOffset: number; endOffset: number; createdAt: Date }>) => {
    for (const chunk of chunks) {
      await connQueryMock(`INSERT INTO chunks (id, file_id, project_id, chunk_index, text, start_offset, end_offset, created_at) VALUES ('${chunk.id}', '${chunk.fileId}', '${chunk.projectId}', ${chunk.index}, '${chunk.text}', ${chunk.startOffset}, ${chunk.endOffset}, '${chunk.createdAt.toISOString()}')`);
    }
  }),
  createEmbeddings: vi.fn(async () => {}),
  updateFileContentHash: vi.fn(async (fileId: string, hash: string) => {
    await connQueryMock(`UPDATE files SET content_hash = '${hash}' WHERE id = '${fileId}'`);
  }),
}));

vi.mock('../../src/services/syncService', () => ({
  syncFileToFileSystem: (...args: unknown[]) => syncFileToFileSystemMock(...args),
  syncFileDelete: vi.fn(),
  syncProjectCreate: vi.fn(),
  syncProjectDelete: vi.fn(),
}));

vi.mock('../../src/services/fileSystemService', () => ({
  writeBinaryFile: vi.fn(),
}));

vi.mock('../../src/services/documentProcessor', () => ({
  chunkMarkdownText: vi.fn(() => [{
    id: 'chunk-1',
    fileId: 'file-1',
    projectId: 'p1',
    index: 0,
    text: 'Hello',
    startOffset: 0,
    endOffset: 5,
    createdAt: new Date(),
  }]),
  chunkText: vi.fn(),
  processDocument: vi.fn(),
  isFileTypeSupported: vi.fn(),
}));

vi.mock('../../src/services/embeddingService', () => ({
  generateEmbeddingsForChunks: vi.fn().mockResolvedValue([]),
  generateEmbedding: vi.fn(),
  computeContentHash: vi.fn(() => 'hash-123'),
}));

describe('createFile indexing', () => {
  beforeEach(async () => {
    vi.resetModules();
    connQueryMock.mockClear();
    dbCreateFileMock.mockClear();
    dbGetProjectMock.mockReset();
    flushDatabaseMock.mockClear();
    syncFileToFileSystemMock.mockClear();

    dbGetProjectMock.mockResolvedValue({
      id: 'p1',
      name: 'Test Project',
      description: '',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  test('indexes md files once after create', async () => {
    const { createFile } = await import('../../src/services/projectService');
    const file = await createFile('p1', 'notes/hello.md', '# Hello unique phrase', 'md');

    expect(file.type).toBe('md');
    expect(connQueryMock).toHaveBeenCalled();
    expect(
      connQueryMock.mock.calls.some(([sql]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO chunks'),
      ),
    ).toBe(true);
    expect(syncFileToFileSystemMock).toHaveBeenCalled();
  });

  test('does not index empty md files', async () => {
    const { createFile } = await import('../../src/services/projectService');
    await createFile('p1', 'notes/empty.md', '   ', 'md');

    expect(
      connQueryMock.mock.calls.some(([sql]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO chunks'),
      ),
    ).toBe(false);
  });
});
