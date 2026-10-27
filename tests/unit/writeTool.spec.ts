import { describe, expect, test, vi, beforeEach } from 'vitest';

const createFileMock = vi.fn();
const formatNoteMock = vi.fn();

vi.mock('../../src/services/projectService', () => ({
  createFile: (...args: unknown[]) => createFileMock(...args),
  getAllProjects: vi.fn(),
  get_project_files: vi.fn(),
  getProjectDirectories: vi.fn().mockResolvedValue([]),
  searchProject: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/llmService', () => ({
  chatCompletion: vi.fn().mockResolvedValue({ content: 'Generated text' }),
  chatCompletionStreaming: vi.fn(),
  loadImageGenerationSettings: vi.fn(),
}));

vi.mock('../../src/services/noteService', () => ({
  formatNote: (...args: unknown[]) => formatNoteMock(...args),
  generateNoteTitle: vi.fn().mockResolvedValue('Chat Smoke'),
  titleToSlug: vi.fn().mockReturnValue('chat-smoke-1026'),
  decideNoteDirectoryWithDirs: vi.fn().mockResolvedValue({ targetDirectory: '' }),
  getProjectDirectories: vi.fn().mockResolvedValue([]),
  generateUniqueFileName: vi.fn().mockResolvedValue('chat-smoke-1026.md'),
}));

vi.mock('../../src/services/documentGeneratorService', () => ({
  generateDocument: vi.fn(),
  generateDocumentContent: (...args: unknown[]) => generateDocumentContentMock(...args),
}));

vi.mock('../../src/services/webSearchService', () => ({
  webResearch: vi.fn(),
  formatWebResearchResults: vi.fn(),
  isWebSearchConfigured: vi.fn(),
}));

vi.mock('../../src/services/imageGenerationService', () => ({
  generateImage: vi.fn(),
  isImageGenerationConfigured: vi.fn(),
}));

vi.mock('../../src/services/googleCalendarService', () => ({
  listEvents: vi.fn(),
  createEvent: vi.fn(),
}));

vi.mock('../../src/services/googleWorkspaceAuthService', () => ({
  loadGoogleWorkspaceSettings: vi.fn(),
}));

vi.mock('../../src/services/integrationService', () => ({
  isGoogleAppEnabled: vi.fn(),
}));

import { executeWriteTool } from '../../src/services/toolService';

describe('executeWriteTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFileMock.mockResolvedValue({
      id: 'f1',
      name: 'chat-smoke-1026.md',
      size: 100,
    });
    formatNoteMock.mockResolvedValue('**STATUS:** CREATED');
  });

  test('saves explicit content byte-identically and skips formatNote', async () => {
    const rawContent = '# Chat Smoke\n\nSTATUS: CREATED';
    const result = await executeWriteTool('proj-1', {
      format: 'md',
      title: 'chat-smoke-1026.md',
      content: rawContent,
    });

    expect(result.success).toBe(true);
    // formatNote must NOT have been called for explicit content
    expect(formatNoteMock).not.toHaveBeenCalled();
    // createFile must receive byte-identical content
    expect(createFileMock).toHaveBeenCalledWith('proj-1', 'chat-smoke-1026.md', rawContent, 'md');
  });

  test('formats generated content when content is not provided', async () => {
    formatNoteMock.mockResolvedValue('# Title\n\nFormatted text');

    const result = await executeWriteTool('proj-1', {
      format: 'md',
      title: 'Generated Doc',
    });

    expect(result.success).toBe(true);
    expect(formatNoteMock).toHaveBeenCalledWith('Generated text');
    expect(createFileMock).toHaveBeenCalledWith(
      'proj-1',
      'chat-smoke-1026.md',
      '# Title\n\nFormatted text',
      'md'
    );
  });
});
