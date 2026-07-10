import { describe, expect, test } from 'vitest';
import { groupNoteRefsByFile } from '../../src/composables/groupTimelineNoteRefs';

describe('groupNoteRefsByFile', () => {
  test('collapses same-file same-day mentions into one card', () => {
    const refs = [
      {
        fileId: 'f1',
        projectId: 'p1',
        fileName: '05-multi-mention.md',
        dateText: 'July 12',
        type: 'regular' as const,
        contextSnippet: 'first',
      },
      {
        fileId: 'f1',
        projectId: 'p1',
        fileName: '05-multi-mention.md',
        dateText: 'July 12',
        type: 'regular' as const,
        contextSnippet: 'second',
      },
      {
        fileId: 'f1',
        projectId: 'p1',
        fileName: '05-multi-mention.md',
        dateText: 'July 12',
        type: 'regular' as const,
        contextSnippet: 'third',
      },
    ];

    const grouped = groupNoteRefsByFile(refs);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].mentionCount).toBe(3);
    expect(grouped[0].contextSnippet).toBe('first');
  });

  test('promotes type to deadline when any mention is a deadline', () => {
    const grouped = groupNoteRefsByFile([
      {
        fileId: 'f1',
        projectId: 'p1',
        fileName: 'note.md',
        dateText: 'July 12',
        type: 'regular',
        contextSnippet: 'review',
      },
      {
        fileId: 'f1',
        projectId: 'p1',
        fileName: 'note.md',
        dateText: 'July 12',
        type: 'deadline',
        contextSnippet: 'due July 12',
      },
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].type).toBe('deadline');
    expect(grouped[0].mentionCount).toBe(2);
  });

  test('keeps separate files as separate cards', () => {
    const grouped = groupNoteRefsByFile([
      {
        fileId: 'f1',
        projectId: 'p1',
        fileName: 'a.md',
        dateText: 'July 12',
        type: 'regular',
        contextSnippet: 'a',
      },
      {
        fileId: 'f2',
        projectId: 'p1',
        fileName: 'b.md',
        dateText: 'July 12',
        type: 'regular',
        contextSnippet: 'b',
      },
    ]);

    expect(grouped).toHaveLength(2);
  });
});
