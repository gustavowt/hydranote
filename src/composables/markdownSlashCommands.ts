import type { Editor } from '@tiptap/core';
import type { CalloutType } from '@/services/calloutConverter';

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  /** Markdown inserted in edit/split textarea modes (replaces `/query`). */
  markdown: string;
  /** Optional Tiptap action for Live mode. */
  tiptapAction?: (editor: Editor) => void;
}

function insertCalloutNode(ed: Editor, type: CalloutType): void {
  ed.chain()
    .focus()
    .insertContent({
      type: 'callout',
      attrs: { type, title: '' },
      content: [{ type: 'paragraph' }],
    })
    .run();
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    description: 'Large section heading',
    keywords: ['h1', 'heading', 'title'],
    markdown: '# ',
    tiptapAction: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    description: 'Medium section heading',
    keywords: ['h2', 'heading', 'subtitle'],
    markdown: '## ',
    tiptapAction: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    description: 'Small section heading',
    keywords: ['h3', 'heading'],
    markdown: '### ',
    tiptapAction: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet',
    label: 'Bullet list',
    description: 'Unordered list item',
    keywords: ['ul', 'list', 'bullet'],
    markdown: '- ',
    tiptapAction: (ed) => ed.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'numbered',
    label: 'Numbered list',
    description: 'Ordered list item',
    keywords: ['ol', 'list', 'numbered', 'ordered'],
    markdown: '1. ',
    tiptapAction: (ed) => ed.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'todo',
    label: 'Task list',
    description: 'Checkbox task item',
    keywords: ['task', 'todo', 'checkbox'],
    markdown: '- [ ] ',
    tiptapAction: (ed) => {
      ed.chain()
        .focus()
        .insertContent({
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph' }],
            },
          ],
        })
        .run();
    },
  },
  {
    id: 'code',
    label: 'Code block',
    description: 'Fenced code block',
    keywords: ['code', 'fence', 'pre'],
    markdown: '```\n\n```',
    tiptapAction: (ed) => ed.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'quote',
    label: 'Blockquote',
    description: 'Indented quote block',
    keywords: ['quote', 'blockquote'],
    markdown: '> ',
    tiptapAction: (ed) => ed.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'note',
    label: 'Note callout',
    description: 'Obsidian note callout',
    keywords: ['note', 'callout', 'info'],
    markdown: '> [!note]\n> ',
    tiptapAction: (ed) => insertCalloutNode(ed, 'note'),
  },
  {
    id: 'tip',
    label: 'Tip callout',
    description: 'Obsidian tip callout',
    keywords: ['tip', 'callout', 'hint'],
    markdown: '> [!tip]\n> ',
    tiptapAction: (ed) => insertCalloutNode(ed, 'tip'),
  },
  {
    id: 'warning',
    label: 'Warning callout',
    description: 'Obsidian warning callout',
    keywords: ['warning', 'callout', 'caution', 'alert'],
    markdown: '> [!warning]\n> ',
    tiptapAction: (ed) => insertCalloutNode(ed, 'warning'),
  },
  {
    id: 'table',
    label: 'Table',
    description: '3-column markdown table',
    keywords: ['table', 'grid'],
    markdown: '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n',
    tiptapAction: (ed) => {
      ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    },
  },
  {
    id: 'hr',
    label: 'Divider',
    description: 'Horizontal rule',
    keywords: ['hr', 'divider', 'line'],
    markdown: '---\n',
    tiptapAction: (ed) => ed.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'file',
    label: 'File reference',
    description: 'Link to another note with [[wikilink]]',
    keywords: ['file', 'link', 'wikilink', 'reference', 'ref', 'note'],
    markdown: '[[',
    tiptapAction: (ed) => {
      ed.chain().focus().insertContent('[[').run();
    },
  },
  {
    id: 'mermaid',
    label: 'Mermaid diagram',
    description: 'Diagram code block',
    keywords: ['mermaid', 'diagram', 'flowchart'],
    markdown: '```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```\n',
    tiptapAction: (ed) => {
      ed.chain()
        .focus()
        .insertContent({
          type: 'mermaidBlock',
          attrs: { source: 'flowchart TD\n  A[Start] --> B[End]' },
        })
        .run();
    },
  },
];

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase().trim();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((cmd) => {
    if (cmd.id.includes(q)) return true;
    if (cmd.label.toLowerCase().includes(q)) return true;
    return cmd.keywords.some((kw) => kw.includes(q));
  });
}
