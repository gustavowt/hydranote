import { describe, expect, test, vi } from 'vitest';

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));
vi.mock('../../src/services/pdfIngestionService', () => ({
  ingestPdfForSearch: vi.fn(),
  extractFullPdfText: vi.fn(),
  ingestPdfFromDocument: vi.fn(),
}));

vi.mock('../../src/services/documentProcessor', () => ({
  processDocument: vi.fn(),
  isFileTypeSupported: vi.fn(),
  chunkText: vi.fn(),
  chunkMarkdownText: vi.fn(),
}));

vi.mock('../../src/services/database', () => ({
  initializeDatabase: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock('../../src/services/projectService', () => ({
  get_project_files: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/aiService', () => ({
  chatCompletion: vi.fn(),
}));

import { titleToSlug, generateUniqueFileName } from '../../src/services/noteService';

describe('titleToSlug and generateUniqueFileName', () => {
  describe('titleToSlug', () => {
    test('strips trailing .md without swallowing into md', () => {
      expect(titleToSlug('chat-smoke-1026.md')).toBe('chat-smoke-1026');
    });

    test('strips case-insensitive trailing .MD or .Md', () => {
      expect(titleToSlug('chat-smoke-1026.MD')).toBe('chat-smoke-1026');
      expect(titleToSlug('document.Md')).toBe('document');
    });

    test('preserves normal titles without .md', () => {
      expect(titleToSlug('chat-smoke-1026')).toBe('chat-smoke-1026');
      expect(titleToSlug('Hello World Note')).toBe('hello-world-note');
    });

    test('removes special characters and trims hyphens', () => {
      expect(titleToSlug('My Special Note: Part 1! (v2).md')).toBe('my-special-note-part-1-v2');
    });
  });

  describe('generateUniqueFileName', () => {
    test('generates .md filename without doubling extension if baseSlug has .md', async () => {
      const fileName = await generateUniqueFileName('proj-1', 'chat-smoke-1026.md', '');
      expect(fileName).toBe('chat-smoke-1026.md');
    });

    test('generates .md filename when baseSlug is clean slug', async () => {
      const fileName = await generateUniqueFileName('proj-1', 'chat-smoke-1026', '');
      expect(fileName).toBe('chat-smoke-1026.md');
    });
  });
});
