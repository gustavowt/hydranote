import { describe, expect, test } from 'vitest';
import { buildFileLinkGraph } from '../../src/composables/buildFileLinkGraph';

describe('buildFileLinkGraph', () => {
  const links = [
    {
      sourceFileId: 'a',
      sourceProjectId: 'p1',
      sourceFileName: 'a.md',
      targetFileId: 'b',
      targetProjectId: 'p1',
      targetFileName: 'b.md',
    },
    {
      sourceFileId: 'b',
      sourceProjectId: 'p1',
      sourceFileName: 'b.md',
      targetFileId: 'c',
      targetProjectId: 'p2',
      targetFileName: 'c.md',
    },
    {
      sourceFileId: 'a',
      sourceProjectId: 'p1',
      sourceFileName: 'a.md',
      targetFileId: 'b',
      targetProjectId: 'p1',
      targetFileName: 'b.md',
    },
  ];

  test('builds unique nodes and directed edges from resolved pairs', () => {
    const graph = buildFileLinkGraph(links);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ]),
    );
  });

  test('computes degree as in + out', () => {
    const graph = buildFileLinkGraph(links);
    const byId = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
    expect(byId.a.degree).toBe(1);
    expect(byId.b.degree).toBe(2);
    expect(byId.c.degree).toBe(1);
  });

  test('filters by projectId when provided', () => {
    const graph = buildFileLinkGraph(links, { projectId: 'p1' });
    // a->b (both p1) and b->c (source p1) included; nodes a,b,c still present via those edges
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes.map(n => n.id).sort()).toEqual(['a', 'b', 'c']);
  });

  test('skips self-links and incomplete ids', () => {
    const graph = buildFileLinkGraph([
      {
        sourceFileId: 'a',
        sourceProjectId: 'p1',
        sourceFileName: 'a.md',
        targetFileId: 'a',
        targetProjectId: 'p1',
        targetFileName: 'a.md',
      },
      {
        sourceFileId: 'a',
        sourceProjectId: 'p1',
        sourceFileName: 'a.md',
        targetFileId: '',
        targetProjectId: 'p1',
        targetFileName: 'missing.md',
      },
    ]);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});
