import { describe, expect, test } from 'vitest';
import { detectedDatesToRows } from '../../src/services/dateIndexService';

describe('detectedDatesToRows', () => {
  const ref = new Date('2026-07-10T12:00:00');

  test('maps deadline dates from preceding keywords', () => {
    const rows = detectedDatesToRows(
      'file-1',
      'project-1',
      'deadlines.md',
      'Proposal due July 12. Final report deadline next Friday.',
      ref,
    );

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some(r => r.type === 'deadline' && r.dateStr === '2026-07-12')).toBe(true);
    expect(rows.some(r => r.type === 'deadline' && r.dateStr === '2026-07-17')).toBe(true);
  });

  test('maps regular relative dates', () => {
    const rows = detectedDatesToRows(
      'file-2',
      'project-1',
      'meetings.md',
      'Standup tomorrow. Retro next Monday.',
      ref,
    );

    expect(rows.some(r => r.type === 'regular' && r.dateStr === '2026-07-11')).toBe(true);
    expect(rows.some(r => r.type === 'regular' && r.dateStr === '2026-07-13')).toBe(true);
  });

  test('returns no rows for noise-only content', () => {
    const rows = detectedDatesToRows(
      'file-3',
      'project-1',
      'noise.md',
      'Version 1.2.3 released. Upgrade to v2.0 soon.',
      ref,
    );

    expect(rows).toHaveLength(0);
  });

  test('truncates long context snippets', () => {
    const longPrefix = 'x'.repeat(120);
    const rows = detectedDatesToRows(
      'file-4',
      'project-1',
      'long.md',
      `${longPrefix} meeting on July 15`,
      ref,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].contextSnippet.length).toBeLessThanOrEqual(103);
  });
});
