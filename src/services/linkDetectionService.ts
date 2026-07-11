/**
 * Detect file cross-references in note content for the File Map index.
 * Supports [[wikilinks]], relative markdown links, and @file: mentions in bodies.
 */

export type LinkType = 'wikilink' | 'markdown' | 'at_file';

export interface DetectedLink {
  raw: string;
  type: LinkType;
  startIndex: number;
  context: string;
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const MARKDOWN_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const AT_FILE_RE = /@file:([^\s]+)/g;

function isExternalOrNonFileHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('#')) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true; // http:, mailto:, etc.
  return false;
}

function contextAround(content: string, start: number, end: number, radius = 40): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(content.length, end + radius);
  let snippet = content.slice(from, to).replace(/\s+/g, ' ').trim();
  if (from > 0) snippet = '…' + snippet;
  if (to < content.length) snippet = snippet + '…';
  return snippet;
}

function pushUnique(
  out: DetectedLink[],
  seen: Set<string>,
  link: DetectedLink,
): void {
  const key = `${link.type}:${link.startIndex}:${link.raw}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(link);
}

/**
 * Extract link candidates from markdown/text content.
 * Does not resolve paths — that happens in linkIndexService.
 */
export function detectLinks(content: string): DetectedLink[] {
  if (!content) return [];

  const out: DetectedLink[] = [];
  const seen = new Set<string>();

  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(content)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    // Skip image-style wikilinks if ever used as ![[...]] — the ! is outside the match
    pushUnique(out, seen, {
      raw,
      type: 'wikilink',
      startIndex: m.index,
      context: contextAround(content, m.index, m.index + m[0].length),
    });
  }

  MARKDOWN_LINK_RE.lastIndex = 0;
  while ((m = MARKDOWN_LINK_RE.exec(content)) !== null) {
    let href = m[2].trim();
    // Strip optional title: path "title"
    const titleMatch = href.match(/^(\S+)\s+/);
    if (titleMatch) href = titleMatch[1];
    // Decode angle-bracket URLs <path>
    if (href.startsWith('<') && href.endsWith('>')) {
      href = href.slice(1, -1);
    }
    if (isExternalOrNonFileHref(href)) continue;
    // Drop fragment-only after path check already handled #; strip trailing #fragment for file path
    const hashIdx = href.indexOf('#');
    if (hashIdx === 0) continue;
    const pathOnly = hashIdx > 0 ? href.slice(0, hashIdx) : href;
    if (!pathOnly) continue;

    pushUnique(out, seen, {
      raw: pathOnly,
      type: 'markdown',
      startIndex: m.index,
      context: contextAround(content, m.index, m.index + m[0].length),
    });
  }

  AT_FILE_RE.lastIndex = 0;
  while ((m = AT_FILE_RE.exec(content)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    pushUnique(out, seen, {
      raw,
      type: 'at_file',
      startIndex: m.index,
      context: contextAround(content, m.index, m.index + m[0].length),
    });
  }

  out.sort((a, b) => a.startIndex - b.startIndex);
  return out;
}
