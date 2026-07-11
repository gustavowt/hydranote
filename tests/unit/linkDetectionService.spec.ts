import { describe, expect, test } from 'vitest';
import { detectLinks } from '../../src/services/linkDetectionService';

describe('detectLinks', () => {
  test('extracts wikilinks', () => {
    const links = detectLinks('See [[notes/meeting.md]] and [[other.md]].');
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      raw: 'notes/meeting.md',
      type: 'wikilink',
    });
    expect(links[1].raw).toBe('other.md');
  });

  test('extracts relative markdown links and ignores external URLs', () => {
    const links = detectLinks(
      'A [local](docs/a.md) and [web](https://example.com/x) and [mail](mailto:a@b.com) and [hash](#section).',
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      raw: 'docs/a.md',
      type: 'markdown',
    });
  });

  test('strips fragment from markdown file links', () => {
    const links = detectLinks('[jump](notes/foo.md#heading)');
    expect(links).toHaveLength(1);
    expect(links[0].raw).toBe('notes/foo.md');
  });

  test('extracts @file mentions in note bodies', () => {
    const links = detectLinks('Related: @file:Work/notes/x.md and @file:y.md');
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      raw: 'Work/notes/x.md',
      type: 'at_file',
    });
    expect(links[1].raw).toBe('y.md');
  });

  test('returns empty for content without links', () => {
    expect(detectLinks('plain text only')).toEqual([]);
    expect(detectLinks('')).toEqual([]);
  });

  test('includes startIndex and context', () => {
    const content = 'Prefix [[target.md]] suffix';
    const links = detectLinks(content);
    expect(links[0].startIndex).toBe(content.indexOf('[['));
    expect(links[0].context).toContain('target.md');
  });
});
