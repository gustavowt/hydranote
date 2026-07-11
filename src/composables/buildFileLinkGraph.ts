/**
 * Build a force-graph-friendly structure from resolved note_links rows.
 * Only edges with both source and target file ids become nodes/edges.
 */

export interface ResolvedNoteLink {
  sourceFileId: string;
  sourceProjectId: string;
  sourceFileName: string;
  targetFileId: string;
  targetProjectId: string;
  targetFileName: string;
  linkType?: string;
}

export interface FileLinkGraphNode {
  id: string;
  projectId: string;
  fileName: string;
  degree: number;
}

export interface FileLinkGraphEdge {
  source: string;
  target: string;
}

export interface FileLinkGraph {
  nodes: FileLinkGraphNode[];
  edges: FileLinkGraphEdge[];
}

export function buildFileLinkGraph(
  links: ResolvedNoteLink[],
  options?: { projectId?: string | null },
): FileLinkGraph {
  const projectFilter = options?.projectId ?? null;

  const filtered = projectFilter
    ? links.filter(
        l =>
          l.sourceProjectId === projectFilter ||
          l.targetProjectId === projectFilter,
      )
    : links;

  const nodeMap = new Map<string, FileLinkGraphNode>();
  const edgeKeys = new Set<string>();
  const edges: FileLinkGraphEdge[] = [];

  const ensureNode = (
    id: string,
    projectId: string,
    fileName: string,
  ): void => {
    if (!nodeMap.has(id)) {
      nodeMap.set(id, { id, projectId, fileName, degree: 0 });
    }
  };

  for (const link of filtered) {
    if (!link.sourceFileId || !link.targetFileId) continue;
    if (link.sourceFileId === link.targetFileId) continue;

    ensureNode(link.sourceFileId, link.sourceProjectId, link.sourceFileName);
    ensureNode(link.targetFileId, link.targetProjectId, link.targetFileName);

    const key = `${link.sourceFileId}->${link.targetFileId}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ source: link.sourceFileId, target: link.targetFileId });
  }

  for (const edge of edges) {
    const s = nodeMap.get(edge.source);
    const t = nodeMap.get(edge.target);
    if (s) s.degree += 1;
    if (t) t.degree += 1;
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
  };
}
