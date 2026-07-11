import { describe, expect, test } from 'vitest';
import { SLASH_COMMANDS, filterSlashCommands } from '../../src/composables/markdownSlashCommands';

describe('markdownSlashCommands', () => {
  test('returns all commands for empty query', () => {
    expect(filterSlashCommands('')).toEqual(SLASH_COMMANDS);
  });

  test('filters by id and keywords', () => {
    const results = filterSlashCommands('todo');
    expect(results.some((c) => c.id === 'todo')).toBe(true);
    expect(results.every((c) => c.id === 'todo' || c.keywords.includes('todo') || c.label.toLowerCase().includes('todo'))).toBe(true);
  });

  test('includes mermaid for diagram query', () => {
    expect(filterSlashCommands('mermaid').some((c) => c.id === 'mermaid')).toBe(true);
  });

  test('includes callout commands', () => {
    const ids = filterSlashCommands('callout').map((c) => c.id);
    expect(ids).toContain('note');
    expect(ids).toContain('tip');
    expect(ids).toContain('warning');
  });

  test('filters callout by type', () => {
    expect(filterSlashCommands('warning').some((c) => c.id === 'warning')).toBe(true);
    expect(filterSlashCommands('tip').some((c) => c.id === 'tip')).toBe(true);
  });

  test('includes table command with tiptapAction for Live mode', () => {
    const table = SLASH_COMMANDS.find((c) => c.id === 'table');
    expect(table).toBeDefined();
    expect(table!.tiptapAction).toBeTypeOf('function');
    expect(filterSlashCommands('table').some((c) => c.id === 'table')).toBe(true);
  });

  test('includes file reference command for wikilink insertion', () => {
    const file = SLASH_COMMANDS.find((c) => c.id === 'file');
    expect(file).toBeDefined();
    expect(file!.markdown).toBe('[[');
    expect(file!.tiptapAction).toBeTypeOf('function');
    expect(filterSlashCommands('file').some((c) => c.id === 'file')).toBe(true);
    expect(filterSlashCommands('wikilink').some((c) => c.id === 'file')).toBe(true);
    expect(filterSlashCommands('ref').some((c) => c.id === 'file')).toBe(true);
  });
});
