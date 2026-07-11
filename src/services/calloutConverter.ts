/**
 * Obsidian-style callout conversion for markdown ↔ HTML round-trip.
 *
 * Syntax:
 *   > [!note]
 *   > Body text
 *
 *   > [!tip] Optional title
 *   > Body
 */

export const CALLOUT_TYPES = ['note', 'tip', 'warning'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

const CALLOUT_TYPE_SET = new Set<string>(CALLOUT_TYPES);

const CALLOUT_MARKER_RE = /^\[!(\w+)\](?:\s+(.*))?$/;

function isCalloutType(type: string): type is CalloutType {
  return CALLOUT_TYPE_SET.has(type.toLowerCase());
}

/**
 * Post-process HTML from marked: detect blockquotes whose first paragraph is
 * `[!type]` or `[!type] Title`, and rewrite to `<aside data-callout>`.
 */
export function rewriteCalloutHtml(html: string): string {
  if (!html.includes('[!')) return html;

  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return html;

  for (const bq of Array.from(root.querySelectorAll('blockquote'))) {
    const firstP = bq.querySelector('p');
    if (!firstP) continue;

    const fullText = firstP.textContent || '';
    const lines = fullText.split('\n');
    const firstLine = lines[0].trim();
    const markerMatch = firstLine.match(CALLOUT_MARKER_RE);
    if (!markerMatch) continue;

    const type = markerMatch[1].toLowerCase();
    if (!isCalloutType(type)) continue;

    const title = (markerMatch[2] || '').trim();
    const inlineBodyLines = lines.slice(1).map((l) => l.trim()).filter(Boolean);

    firstP.remove();

    const aside = doc.createElement('aside');
    aside.className = `callout callout-${type}`;
    aside.setAttribute('data-callout', type);
    if (title) {
      aside.setAttribute('data-callout-title', title);
    }

    const bodyDiv = doc.createElement('div');
    bodyDiv.className = 'callout-body';

    for (const line of inlineBodyLines) {
      const p = doc.createElement('p');
      p.textContent = line;
      bodyDiv.appendChild(p);
    }

    while (bq.firstChild) {
      bodyDiv.appendChild(bq.firstChild);
    }

    aside.appendChild(bodyDiv);
    bq.replaceWith(aside);
  }

  return root.innerHTML;
}

/**
 * Convert callout `<aside data-callout>` blocks back to Obsidian markdown.
 */
export function calloutHtmlToMarkdown(html: string): string {
  if (!html.includes('data-callout')) return '';

  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';

  const parts: string[] = [];

  for (const aside of Array.from(root.querySelectorAll('aside[data-callout]'))) {
    const type = (aside.getAttribute('data-callout') || 'note').toLowerCase();
    const title = aside.getAttribute('data-callout-title') || '';
    const bodyEl = aside.querySelector('.callout-body') || aside;

    const header = title ? `> [!${type}] ${title}` : `> [!${type}]`;
    parts.push(header);

    const bodyText = extractBlockquoteBody(bodyEl);
    for (const line of bodyText.split('\n')) {
      if (line.trim()) {
        parts.push(`> ${line}`);
      } else {
        parts.push('>');
      }
    }
    parts.push('');
  }

  return parts.join('\n').trim();
}

function extractBlockquoteBody(container: Element): string {
  const paragraphs = Array.from(container.querySelectorAll('p'));
  if (paragraphs.length > 0) {
    return paragraphs.map((p) => (p.textContent || '').trim()).filter(Boolean).join('\n');
  }
  return (container.textContent || '').trim();
}

/** No-op pre-pass for plain markdown; reserved for future pre-marked transforms. */
export function rewriteCalloutsInMarkdown(md: string): string {
  return md;
}

/**
 * Turndown replacement for a single callout aside element.
 */
export function calloutAsideToMarkdown(node: HTMLElement): string {
  const type = (node.getAttribute('data-callout') || 'note').toLowerCase();
  const title = node.getAttribute('data-callout-title') || '';
  const bodyEl = node.querySelector('.callout-body') || node;

  const header = title ? `> [!${type}] ${title}` : `> [!${type}]`;
  const lines = [header];
  const bodyText = extractBlockquoteBody(bodyEl);
  for (const line of bodyText.split('\n')) {
    lines.push(line.trim() ? `> ${line}` : '>');
  }
  return `\n\n${lines.join('\n')}\n\n`;
}
