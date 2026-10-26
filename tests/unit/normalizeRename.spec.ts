import { describe, expect, test } from 'vitest';
import { normalizeRenameInput } from '../../src/utils/normalizeRename';

describe('normalizeRenameInput', () => {
  test('strips duplicate trailing .md when user types full filename', () => {
    expect(normalizeRenameInput('smoke-edit.md', '.md')).toBe('smoke-edit.md');
  });

  test('appends .md when user types base name only', () => {
    expect(normalizeRenameInput('smoke-edit', '.md')).toBe('smoke-edit.md');
  });

  test('handles uppercase/mixed-case extension in user input', () => {
    expect(normalizeRenameInput('smoke-edit.MD', '.md')).toBe('smoke-edit.md');
    expect(normalizeRenameInput('smoke-edit.Md', '.md')).toBe('smoke-edit.md');
  });

  test('trims surrounding whitespace from input', () => {
    expect(normalizeRenameInput('  smoke-edit.md  ', '.md')).toBe('smoke-edit.md');
    expect(normalizeRenameInput('  smoke-edit  ', '.md')).toBe('smoke-edit.md');
  });

  test('preserves dots inside the filename', () => {
    expect(normalizeRenameInput('release.notes.v1.md', '.md')).toBe('release.notes.v1.md');
    expect(normalizeRenameInput('release.notes.v1', '.md')).toBe('release.notes.v1.md');
  });

  test('works with other extensions like .pdf and .txt', () => {
    expect(normalizeRenameInput('doc.pdf', '.pdf')).toBe('doc.pdf');
    expect(normalizeRenameInput('doc', '.pdf')).toBe('doc.pdf');
    expect(normalizeRenameInput('notes.txt', '.txt')).toBe('notes.txt');
    expect(normalizeRenameInput('notes', '.txt')).toBe('notes.txt');
  });

  test('returns empty string if input is empty or whitespace only', () => {
    expect(normalizeRenameInput('', '.md')).toBe('');
    expect(normalizeRenameInput('   ', '.md')).toBe('');
  });

  test('returns input as-is when ext is empty', () => {
    expect(normalizeRenameInput('license', '')).toBe('license');
  });
});
