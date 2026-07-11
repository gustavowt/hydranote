import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/projectService', () => ({
  getAllProjects: vi.fn(),
  get_project_files: vi.fn(),
}));

vi.mock('../../src/services/llmService', () => ({
  chatCompletion: vi.fn(),
  chatCompletionStreaming: vi.fn(),
  loadImageGenerationSettings: vi.fn(),
}));

vi.mock('../../src/services/noteService', () => ({
  formatNote: vi.fn(),
  generateNoteTitle: vi.fn(),
  titleToSlug: vi.fn(),
  decideNoteDirectoryWithDirs: vi.fn(),
  getProjectDirectories: vi.fn(),
  generateUniqueFileName: vi.fn(),
}));

vi.mock('../../src/services/documentGeneratorService', () => ({
  generateDocument: vi.fn(),
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

import { getAllProjects, get_project_files } from '../../src/services/projectService';
import { executeListProjectsTool } from '../../src/services/toolService';

const getAllProjectsMock = vi.mocked(getAllProjects);
const getProjectFilesMock = vi.mocked(get_project_files);

beforeEach(() => {
  getAllProjectsMock.mockReset();
  getProjectFilesMock.mockReset();
});

describe('executeListProjectsTool', () => {
  test('returns formatted project list with file counts', async () => {
    getAllProjectsMock.mockResolvedValue([
      {
        id: 'p1',
        name: 'QA Exploratory',
        description: 'Test project',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    getProjectFilesMock.mockResolvedValue([
      { id: 'f1', name: 'note.md' } as never,
      { id: 'f2', name: 'other.md' } as never,
    ]);

    const result = await executeListProjectsTool();

    expect(result.success).toBe(true);
    expect(result.tool).toBe('listProjects');
    expect(result.data).toContain('QA Exploratory');
    expect(result.data).toContain('2 files');
  });

  test('returns empty-state message when no projects exist', async () => {
    getAllProjectsMock.mockResolvedValue([]);

    const result = await executeListProjectsTool();

    expect(result.success).toBe(true);
    expect(result.data).toBe('No projects found.');
  });
});
