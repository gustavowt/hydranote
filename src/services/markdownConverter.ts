/**
 * Markdown ↔ HTML conversion for the Live (WYSIWYG) editor.
 *
 * - Markdown → HTML uses `marked` (same renderer as the reading view) so what
 *   the user edits matches the preview.
 * - HTML → Markdown uses `turndown` + GFM (tables, strikethrough, task lists),
 *   plus extra rules for fenced code blocks (with language) and Mermaid blocks.
 *
 * YAML frontmatter (`---\n…\n---`) is preserved by stripping it on import and
 * re-prepending on export — Tiptap has no node for it.
 */

import { Marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const marked = new Marked();

const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  fence: '```',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
});

turndown.use(gfm);

/**
 * Fenced code block rule that preserves the language attribute that
 * CodeBlockLowlight emits (`<pre><code class="language-mermaid">…`).
 */
turndown.addRule('fencedCodeBlockWithLang', {
  filter: (node) => {
    if (node.nodeName !== 'PRE') return false;
    const code = node.firstChild as HTMLElement | null;
    return !!code && code.nodeName === 'CODE';
  },
  replacement: (_content, node) => {
    const code = (node as HTMLElement).firstChild as HTMLElement;
    const className = code.getAttribute('class') || '';
    const langMatch = className.match(/language-([\w+-]+)/);
    const lang = langMatch ? langMatch[1] : '';
    const text = code.textContent || '';
    const trimmed = text.replace(/\n$/, '');
    return `\n\n\`\`\`${lang}\n${trimmed}\n\`\`\`\n\n`;
  },
});

/**
 * Mermaid blocks rendered via the custom Tiptap node use a wrapping
 * `<div data-mermaid-source="…">`. Convert that back to a fenced
 * ` ```mermaid ` block so the source round-trips.
 */
turndown.addRule('mermaidBlock', {
  filter: (node) =>
    node.nodeName === 'DIV' &&
    (node as HTMLElement).hasAttribute('data-mermaid-source'),
  replacement: (_content, node) => {
    const src = (node as HTMLElement).getAttribute('data-mermaid-source') || '';
    return `\n\n\`\`\`mermaid\n${src}\n\`\`\`\n\n`;
  },
});

/** Frontmatter (`---\n…\n---`) at the start of a markdown document. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface SplitMarkdown {
  frontmatter: string; // raw block including delimiters, '' if none
  body: string;
}

export function splitFrontmatter(md: string): SplitMarkdown {
  const m = md.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: '', body: md };
  return {
    frontmatter: m[0].endsWith('\n') ? m[0] : m[0] + '\n',
    body: md.slice(m[0].length),
  };
}

export function joinFrontmatter(frontmatter: string, body: string): string {
  if (!frontmatter) return body;
  const fm = frontmatter.endsWith('\n') ? frontmatter : frontmatter + '\n';
  return fm + body;
}

/** Convert markdown body → HTML for Tiptap.setContent(). */
export function markdownToHtml(md: string): string {
  if (!md) return '';
  return marked.parse(md, { async: false }) as string;
}

/** Convert HTML coming out of Tiptap → markdown body. */
export function htmlToMarkdown(html: string): string {
  if (!html || html === '<p></p>') return '';
  return turndown.turndown(html).trim() + '\n';
}
