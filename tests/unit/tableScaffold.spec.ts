import { describe, expect, test } from 'vitest';
import { scaffoldTableAfterHeader } from '@/composables/tableScaffold';

describe('tableScaffold', () => {
  test('inserts separator and body row after header', () => {
    const line = '| a | b |';
    const result = scaffoldTableAfterHeader(line, 9);

    expect(result).not.toBeNull();
    expect(result!.insertion).toBe('\n| --- | --- |\n|  |  |');
    expect(result!.cursor).toBe(9 + '\n| --- | --- |\n| '.length);
  });

  test('returns null if next line is already a separator', () => {
    const line = '| a | b |';
    const nextLine = '| --- | --- |';
    expect(scaffoldTableAfterHeader(line, 9, nextLine)).toBeNull();
  });

  test('returns null for non-table lines', () => {
    expect(scaffoldTableAfterHeader('- list item', 11)).toBeNull();
  });

  test('returns null for separator and empty body rows', () => {
    expect(scaffoldTableAfterHeader('| --- | --- |', 13)).toBeNull();
    expect(scaffoldTableAfterHeader('|  |  |', 8)).toBeNull();
  });
});
