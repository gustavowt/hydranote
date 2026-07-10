export interface TimelineNoteReference {
  fileId: string;
  projectId: string;
  fileName: string;
  dateText: string;
  type: 'regular' | 'deadline';
  contextSnippet: string;
  mentionCount?: number;
}

export function groupNoteRefsByFile(refs: TimelineNoteReference[]): TimelineNoteReference[] {
  const grouped = new Map<string, TimelineNoteReference>();

  for (const ref of refs) {
    const existing = grouped.get(ref.fileId);
    if (!existing) {
      grouped.set(ref.fileId, { ...ref, mentionCount: 1 });
      continue;
    }

    existing.mentionCount = (existing.mentionCount ?? 1) + 1;
    if (ref.type === 'deadline') {
      existing.type = 'deadline';
    }
  }

  return Array.from(grouped.values());
}
