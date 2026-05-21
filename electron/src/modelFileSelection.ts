export interface SelectableModelFile {
  filename: string;
  size: number;
  isPrimary?: boolean;
}

interface ModelFileGroup {
  files: SelectableModelFile[];
  firstIndex: number;
  complete: boolean;
  preferredRank: number;
  hasPrimary: boolean;
}

const PREFERRED_QUANTIZATIONS = ['q4_k_m', 'q5_k_m', 'q4_0', 'q5_0'];
const SHARD_PATTERN = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i;

export function selectDownloadableModelFiles<T extends SelectableModelFile>(files: T[]): T[] {
  const groups = buildModelFileGroups(files).filter(group => group.complete);
  if (groups.length === 0) {
    return [];
  }

  groups.sort((a, b) => {
    if (a.hasPrimary !== b.hasPrimary) {
      return a.hasPrimary ? -1 : 1;
    }
    if (a.preferredRank !== b.preferredRank) {
      return a.preferredRank - b.preferredRank;
    }
    return a.firstIndex - b.firstIndex;
  });

  return groups[0].files;
}

function buildModelFileGroups<T extends SelectableModelFile>(files: T[]): ModelFileGroup[] {
  const groups = new Map<string, {
    entries: Array<{ file: SelectableModelFile; shardIndex: number }>;
    expectedShardCount: number;
    firstIndex: number;
  }>();

  files.forEach((file, index) => {
    const shard = parseShardFilename(file.filename);
    const groupKey = shard ? `${shard.base}|${shard.total}` : file.filename;
    const group = groups.get(groupKey) || {
      entries: [],
      expectedShardCount: shard?.total || 1,
      firstIndex: index,
    };

    group.entries.push({
      file,
      shardIndex: shard?.index || 1,
    });
    groups.set(groupKey, group);
  });

  return Array.from(groups.values()).map(group => {
    const shardIndexes = new Set(group.entries.map(entry => entry.shardIndex));
    const complete = shardIndexes.size === group.expectedShardCount &&
      Array.from({ length: group.expectedShardCount }, (_, index) => index + 1)
        .every(shardIndex => shardIndexes.has(shardIndex));

    const orderedFiles = [...group.entries]
      .sort((a, b) => a.shardIndex - b.shardIndex)
      .map(entry => entry.file);

    return {
      files: orderedFiles,
      firstIndex: group.firstIndex,
      complete,
      preferredRank: getPreferredRank(orderedFiles[0]?.filename || ''),
      hasPrimary: orderedFiles.some(file => file.isPrimary),
    };
  });
}

function parseShardFilename(filename: string): { base: string; index: number; total: number } | null {
  const match = filename.match(SHARD_PATTERN);
  if (!match) {
    return null;
  }

  return {
    base: match[1],
    index: Number(match[2]),
    total: Number(match[3]),
  };
}

function getPreferredRank(filename: string): number {
  const normalized = filename.toLowerCase();
  const rank = PREFERRED_QUANTIZATIONS.findIndex(quantization => normalized.includes(quantization));
  return rank === -1 ? PREFERRED_QUANTIZATIONS.length : rank;
}
