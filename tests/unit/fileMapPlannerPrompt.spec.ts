import { describe, expect, test } from 'vitest';
import { FILE_MAP_WIKILINK_PLANNER_RULES } from '../../src/services/fileMapPlannerRules';

describe('FILE_MAP_WIKILINK_PLANNER_RULES', () => {
  test('instructs durable [[wikilink]] insertion for known files', () => {
    expect(FILE_MAP_WIKILINK_PLANNER_RULES).toContain('[[path/to/file.md]]');
    expect(FILE_MAP_WIKILINK_PLANNER_RULES).toContain('[[ProjectName/path/to/file.md]]');
    expect(FILE_MAP_WIKILINK_PLANNER_RULES).toMatch(/known file/i);
  });

  test('forbids inventing paths', () => {
    expect(FILE_MAP_WIKILINK_PLANNER_RULES).toMatch(/NEVER invent/i);
  });

  test('keeps @file for chat mentions vs [[…]] in note bodies', () => {
    expect(FILE_MAP_WIKILINK_PLANNER_RULES).toContain('@file:');
    expect(FILE_MAP_WIKILINK_PLANNER_RULES).toMatch(/note bodies/i);
  });
});
