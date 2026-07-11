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
import { calloutAsideToMarkdown } from './calloutConverter';

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

/**
 * Obsidian callouts rendered as `<aside data-callout="…">` round-trip back to
 * `> [!type]` markdown.
 */
turndown.addRule('calloutAside', {
  filter: (node) =>
    node.nodeName === 'ASIDE' && (node as HTMLElement).hasAttribute('data-callout'),
  replacement: (_content, node) => calloutAsideToMarkdown(node as HTMLElement),
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

/** Convert marked GFM checkbox lists into TipTap taskList HTML. */
export function rewriteTaskListHtml(html: string): string {
  if (!html.includes('type="checkbox"')) return html;

  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return html;

  for (const ul of Array.from(root.querySelectorAll('ul'))) {
    const items = Array.from(ul.children).filter((el) => el.tagName === 'LI');
    const checkboxItems = items.filter((li) => li.querySelector('input[type="checkbox"]'));
    if (checkboxItems.length === 0) continue;

    const taskUl = doc.createElement('ul');
    taskUl.setAttribute('data-type', 'taskList');

    for (const li of checkboxItems) {
      const checkbox = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (!checkbox) continue;

      const checked = checkbox.checked || checkbox.hasAttribute('checked');
      const taskLi = doc.createElement('li');
      taskLi.setAttribute('data-type', 'taskItem');
      taskLi.setAttribute('data-checked', checked ? 'true' : 'false');

      const label = doc.createElement('label');
      const input = doc.createElement('input');
      input.type = 'checkbox';
      if (checked) input.setAttribute('checked', 'checked');
      label.appendChild(input);
      label.appendChild(doc.createElement('span'));

      const contentDiv = doc.createElement('div');
      const clone = li.cloneNode(true) as HTMLElement;
      clone.querySelector('input[type="checkbox"]')?.remove();
      const inner = clone.innerHTML.trim();
      if (inner) {
        contentDiv.innerHTML = inner.startsWith('<') ? inner : `<p>${inner}</p>`;
      } else {
        contentDiv.innerHTML = '<p></p>';
      }

      taskLi.appendChild(label);
      taskLi.appendChild(contentDiv);
      taskUl.appendChild(taskLi);
    }

    if (taskUl.children.length > 0) {
      ul.replaceWith(taskUl);
    }
  }

  return root.innerHTML;
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
