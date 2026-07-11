import { describe, expect, test, vi } from 'vitest';

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

import type { ExecutionPlan, ExecutionResult } from '../../src/types';
import { shouldPassthroughInterpretation } from '../../src/services/toolService';

function makePlan(tool: 'listProjects' | 'listEvents' | 'read'): ExecutionPlan {
  return {
    id: 'plan-1',
    originalQuery: 'test',
    summary: 'test',
    complexity: 'low',
    needsClarification: false,
    steps: [{ id: 'step-1', tool, description: 'test', contextNeeded: [], providesContext: [] }],
  };
}

function makeResult(allSuccessful: boolean): ExecutionResult {
  return {
    planId: 'plan-1',
    completedSteps: allSuccessful
      ? [{
          stepId: 'step-1',
          tool: 'listProjects',
          result: { success: true, tool: 'listProjects', data: 'Project A' },
          extractedContext: {},
          durationMs: 1,
        }]
      : [],
    failedSteps: allSuccessful ? [] : [{
      stepId: 'step-1',
      tool: 'listProjects',
      error: 'failed',
      recoverable: false,
    }],
    allSuccessful,
    accumulatedContext: {},
    finalResponse: undefined,
  };
}

describe('shouldPassthroughInterpretation', () => {
  test('returns true for successful single-step listProjects', () => {
    expect(shouldPassthroughInterpretation(makePlan('listProjects'), makeResult(true))).toBe(true);
  });

  test('returns true for successful single-step listEvents', () => {
    const plan = makePlan('listEvents');
    plan.steps[0].tool = 'listEvents';
    expect(shouldPassthroughInterpretation(plan, makeResult(true))).toBe(true);
  });

  test('returns false for read tool', () => {
    expect(shouldPassthroughInterpretation(makePlan('read'), makeResult(true))).toBe(false);
  });

  test('returns false when execution failed', () => {
    expect(shouldPassthroughInterpretation(makePlan('listProjects'), makeResult(false))).toBe(false);
  });
});
