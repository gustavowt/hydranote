import { describe, expect, test } from 'vitest';
import { resolveTargetProjectContext } from '../../src/utils/projectContext';
import type { Project, FileTreeNode } from '../../src/types';

describe('resolveTargetProjectContext', () => {
  const projects: Project[] = [
    {
      id: 'proj-alpha',
      name: 'Smoke Alpha',
      path: '/alpha',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'proj-beta',
      name: 'Smoke Beta',
      path: '/beta',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const projectFileTrees: Record<string, { nodes: FileTreeNode[] }> = {
    'proj-alpha': {
      nodes: [
        {
          id: 'file-alpha-1',
          name: 'notes.md',
          path: 'notes.md',
          type: 'file',
        },
      ],
    },
    'proj-beta': {
      nodes: [
        {
          id: 'dir:docs',
          name: 'docs',
          path: 'docs',
          type: 'directory',
          children: [
            {
              id: 'file-beta-doc',
              name: 'guide.md',
              path: 'docs/guide.md',
              type: 'file',
            },
          ],
        },
      ],
    },
  };

  test('resolves to the right-clicked project even if fallbackProjectId is stale', () => {
    // Stale popover prop has proj-alpha, but user right-clicked proj-beta
    const result = resolveTargetProjectContext({
      targetId: 'proj-beta',
      targetType: 'project',
      fallbackProjectId: 'proj-alpha',
      projects,
      projectFileTrees,
    });

    expect(result.projectId).toBe('proj-beta');
    expect(result.projectName).toBe('Smoke Beta');
    expect(result.isProject).toBe(true);
  });

  test('resolves directory target to its owning project', () => {
    const result = resolveTargetProjectContext({
      targetId: 'dir:docs',
      targetType: 'directory',
      fallbackProjectId: 'proj-alpha', // Stale
      projects,
      projectFileTrees,
    });

    expect(result.projectId).toBe('proj-beta');
    expect(result.projectName).toBe('Smoke Beta');
    expect(result.isProject).toBe(false);
  });

  test('resolves nested file target to its owning project', () => {
    const result = resolveTargetProjectContext({
      targetId: 'file-beta-doc',
      targetType: 'file',
      fallbackProjectId: 'proj-alpha', // Stale
      projects,
      projectFileTrees,
    });

    expect(result.projectId).toBe('proj-beta');
    expect(result.projectName).toBe('Smoke Beta');
    expect(result.isProject).toBe(false);
  });

  test('falls back gracefully when target is not found in file trees', () => {
    const result = resolveTargetProjectContext({
      targetId: 'unknown-id',
      fallbackProjectId: 'proj-alpha',
      projects,
      projectFileTrees,
    });

    expect(result.projectId).toBe('proj-alpha');
    expect(result.projectName).toBe('Smoke Alpha');
  });
});
