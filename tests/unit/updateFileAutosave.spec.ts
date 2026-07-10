import { describe, expect, test, vi, beforeEach } from 'vitest';

const createUpdateVersionMock = vi.fn().mockResolvedValue({ id: 'v1' });
const dbGetFileMock = vi.fn();
const dbGetProjectMock = vi.fn();
const updateFileContentMock = vi.fn().mockResolvedValue(undefined);
const flushDatabaseMock = vi.fn().mockResolvedValue(undefined);
const syncFileToFileSystemMock = vi.fn().mockResolvedValue(undefined);
const initializeDatabaseMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/versionService', () => ({
  createUpdateVersion: (...args: unknown[]) => createUpdateVersionMock(...args),
  createInitialVersion: vi.fn(),
}));

vi.mock('../../src/services/database', () => ({
  initializeDatabase: (...args: unknown[]) => initializeDatabaseMock(...args),
  getFile: (...args: unknown[]) => dbGetFileMock(...args),
  getProject: (...args: unknown[]) => dbGetProjectMock(...args),
  updateFileContent: (...args: unknown[]) => updateFileContentMock(...args),
  flushDatabase: (...args: unknown[]) => flushDatabaseMock(...args),
  getConnection: () => ({ query: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('../../src/services/syncService', () => ({
  syncFileToFileSystem: (...args: unknown[]) => syncFileToFileSystemMock(...args),
  syncFileDelete: vi.fn(),
  syncProjectCreate: vi.fn(),
  syncProjectDelete: vi.fn(),
}));

vi.mock('../../src/services/documentProcessor', () => ({
  processDocument: vi.fn(),
  isFileTypeSupported: vi.fn(),
}));

vi.mock('../../src/services/embeddingService', () => ({
  generateEmbeddingsForChunks: vi.fn(),
  generateEmbedding: vi.fn(),
  computeContentHash: vi.fn(() => 'abc123'),
  reindexFilesMissingChunks: vi.fn().mockResolvedValue({ reindexed: 0, failed: 0 }),
}));

vi.mock('../../src/services/fileSystemService', () => ({
  writeBinaryFile: vi.fn(),
}));

describe('updateFile createVersion option', () => {
  beforeEach(() => {
    vi.resetModules();
    createUpdateVersionMock.mockClear();
    dbGetFileMock.mockReset();
    dbGetProjectMock.mockReset();
    updateFileContentMock.mockClear();
    flushDatabaseMock.mockClear();

    dbGetFileMock.mockResolvedValue({
      id: 'file-1',
      projectId: 'proj-1',
      name: 'note.md',
      type: 'md',
      content: 'old body',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    dbGetProjectMock.mockResolvedValue({ id: 'proj-1', name: 'Project' });
  });

  test('skips version creation when createVersion is false', async () => {
    const { updateFile } = await import('../../src/services/projectService');
    await updateFile('file-1', 'new body', { createVersion: false });

    expect(createUpdateVersionMock).not.toHaveBeenCalled();
    expect(updateFileContentMock).toHaveBeenCalledWith('file-1', 'new body');
  });

  test('creates version by default', async () => {
    const { updateFile } = await import('../../src/services/projectService');
    await updateFile('file-1', 'new body');

    expect(createUpdateVersionMock).toHaveBeenCalledWith('file-1', 'old body');
  });
});
