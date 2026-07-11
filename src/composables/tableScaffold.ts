/**
 * Markdown table header scaffolding for edit/split textarea modes.
 */

const TABLE_HEADER_RE = /^\|(.+)\|$/;
const TABLE_SEPARATOR_RE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;

export interface TableScaffoldResult {
  insertion: string;
  cursor: number;
}

export function scaffoldTableAfterHeader(
  line: string,
  cursorAtEnd: number,
  nextLine?: string,
): TableScaffoldResult | null {
  const trimmed = line.trim();
  if (TABLE_SEPARATOR_RE.test(trimmed)) return null;

  const match = line.match(TABLE_HEADER_RE);
  if (!match) return null;

  if (nextLine && TABLE_SEPARATOR_RE.test(nextLine.trim())) {
    return null;
  }

  const cells = match[1].split('|').map((c) => c.trim());
  const nonEmptyCells = cells.filter((c) => c.length > 0);
  if (nonEmptyCells.length === 0) return null;

  const colCount = nonEmptyCells.length;
  const sepCells = Array(colCount).fill(' --- ');
  const emptyCells = Array(colCount).fill('  ');
  const sepRow = `|${sepCells.join('|')}|`;
  const bodyRow = `|${emptyCells.join('|')}|`;

  const insertion = `\n${sepRow}\n${bodyRow}`;
  const cursor = cursorAtEnd + `\n${sepRow}\n| `.length;

  return { insertion, cursor };
}
