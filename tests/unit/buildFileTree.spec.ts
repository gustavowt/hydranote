import { describe, expect, test, vi } from 'vitest';

vi.mock('../../src/services/documentProcessor', () => ({
  processDocument: vi.fn(),
  isFileTypeSupported: vi.fn(),
  chunkText: vi.fn(),
  chunkMarkdownText: vi.fn(),
}));

vi.mock('../../src/services/database', () => ({
  initializeDatabase: vi.fn(),
}));

vi.mock('../../src/services/embeddingService', () => ({
  generateEmbeddingsForChunks: vi.fn(),
  generateEmbedding: vi.fn(),
}));

vi.mock('../../src/services/syncService', () => ({
  syncFileToFileSystem: vi.fn(),
  syncFileDelete: vi.fn(),
  syncProjectCreate: vi.fn(),
  syncProjectDelete: vi.fn(),
}));

vi.mock('../../src/services/fileSystemService', () => ({
  writeBinaryFile: vi.fn(),
}));

vi.mock('../../src/services/versionService', () => ({
  createInitialVersion: vi.fn(),
  createUpdateVersion: vi.fn(),
}));

import { buildFileTree } from '../../src/services/projectService';
import type { ProjectFile } from '../../src/types';

function makeFile(name: string, id?: string): ProjectFile {
  return {
    id: id ?? crypto.randomUUID(),
    projectId: 'p1',
    name,
    type: 'md',
    size: 10,
    status: 'indexed',
    content: '# test',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('buildFileTree', () => {
  test('nests deep paths with intermediate directories', () => {
    const tree = buildFileTree([
      makeFile('meetings/2024-12-19/a.md', 'f1'),
      makeFile('meetings/b.md', 'f2'),
    ]);

    expect(tree).toHaveLength(1);
    const meetings = tree[0];
    expect(meetings.name).toBe('meetings');
    expect(meetings.type).toBe('directory');
    expect(meetings.children).toHaveLength(2);

    const datedFolder = meetings.children!.find((node) => node.name === '2024-12-19');
    expect(datedFolder?.type).toBe('directory');
    expect(datedFolder?.children?.some((node) => node.name === 'a.md')).toBe(true);

    const rootMeetingFile = meetings.children!.find((node) => node.name === 'b.md');
    expect(rootMeetingFile?.type).toBe('file');
  });
});
