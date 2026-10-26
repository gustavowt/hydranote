import type { Project, FileTreeNode } from '@/types';

function isNodeInTree(nodes: FileTreeNode[], targetId: string): boolean {
  for (const node of nodes) {
    if (node.id === targetId) return true;
    if (node.children && isNodeInTree(node.children, targetId)) return true;
  }
  return false;
}

export interface ResolveProjectContextParams {
  targetId: string;
  targetType?: string;
  fallbackProjectId?: string;
  projects: Project[];
  projectFileTrees?: Record<string, { nodes: FileTreeNode[] }>;
}

export interface ResolvedProjectContext {
  projectId: string;
  projectName: string;
  isProject: boolean;
}

/**
 * Resolves the true project ID and name from the interaction target, preventing
 * stale project context captured by reused context menu popovers.
 */
export function resolveTargetProjectContext(
  params: ResolveProjectContextParams
): ResolvedProjectContext {
  const { targetId, targetType, fallbackProjectId, projects, projectFileTrees } = params;

  // 1. Direct match: target is a project or matches a known project ID
  if (targetType === 'project' || projects.some((p) => p.id === targetId)) {
    const matched = projects.find((p) => p.id === targetId);
    if (matched) {
      return {
        projectId: matched.id,
        projectName: matched.name,
        isProject: true,
      };
    }
  }

  // 2. Search project file trees for the node ID (directory or file)
  if (projectFileTrees) {
    for (const project of projects) {
      const tree = projectFileTrees[project.id];
      if (tree?.nodes && isNodeInTree(tree.nodes, targetId)) {
        return {
          projectId: project.id,
          projectName: project.name,
          isProject: false,
        };
      }
    }
  }

  // 3. Fallback: match by fallbackProjectId
  const fallback = projects.find((p) => p.id === fallbackProjectId);
  if (fallback) {
    return {
      projectId: fallback.id,
      projectName: fallback.name,
      isProject: targetType === 'project',
    };
  }

  return {
    projectId: fallbackProjectId || targetId,
    projectName: '',
    isProject: targetType === 'project',
  };
}
