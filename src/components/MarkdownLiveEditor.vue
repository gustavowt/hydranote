<template>
  <div class="live-editor-host markdown-preview" @click="handleHostClick">
    <editor-content v-if="editor" :editor="editor" class="live-editor-surface" />
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount, computed } from 'vue';
import { Editor, EditorContent, Extension, Node, mergeAttributes, VueNodeViewRenderer } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { common, createLowlight } from 'lowlight';
import {
  splitFrontmatter,
  joinFrontmatter,
  markdownToHtml,
  htmlToMarkdown,
} from '@/services/markdownConverter';
import { detectDates } from '@/services/dateDetectionService';
import MermaidBlockNodeView from './MermaidBlockNodeView.vue';
import CodeBlockNodeView from './CodeBlockNodeView.vue';

const lowlight = createLowlight(common);

const props = withDefaults(
  defineProps<{
    modelValue: string;
    disabled?: boolean;
    placeholder?: string;
  }>(),
  { disabled: false, placeholder: 'Start writing...' },
);

export interface DateChipClickPayload {
  date: string;
  type: string;
  original: string;
  context: string;
  anchorRect: DOMRect | null;
}

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'selection-snapshot'): void;
  (e: 'date-chip-click', payload: DateChipClickPayload): void;
}>();

const editor = shallowRef<Editor | null>(null);
const frontmatter = ref('');

/**
 * Custom Tiptap node for Mermaid diagrams. Replaces fenced ` ```mermaid ` code
 * blocks during import (see initialContent below) with a node that renders the
 * diagram inline and toggles to a textarea on click for source editing.
 *
 * On serialization to HTML the node renders a wrapping
 * `<div data-mermaid-source="…">` which `htmlToMarkdown` turns back into
 * a fenced ` ```mermaid ` block.
 */
const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      source: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-mermaid-source]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-mermaid-source': node.attrs.source as string,
        class: 'mermaid-block-node',
      }),
    ];
  },
  addNodeView() {
    return VueNodeViewRenderer(MermaidBlockNodeView);
  },
});

/**
 * CodeBlockLowlight with a Vue node view that overlays a copy-to-clipboard
 * button on each code block (see CodeBlockNodeView.vue). Serialization is
 * untouched — getHTML() still uses the extension's default renderHTML, so the
 * turndown round-trip in htmlToMarkdown is unaffected.
 */
const CodeBlockWithCopy = CodeBlockLowlight.extend({
  addNodeView() {
    return VueNodeViewRenderer(CodeBlockNodeView);
  },
});

/**
 * Inline ProseMirror decoration plugin that mirrors `injectDateChips` from
 * `MarkdownEditor.vue`: walks the doc's text nodes, runs `detectDates` on
 * each, and wraps recognized date ranges in `<span class="date-chip">`
 * decorations carrying the same `data-*` attributes the marked path emits.
 *
 * Click handling is delegated via an `onChipClick` option so the parent Vue
 * component can route into the existing `DateChipPopover` flow.
 */
const dateChipPluginKey = new PluginKey('dateChipDecorations');

function buildDateChipDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  const now = new Date();

  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text || '';
    if (text.length < 3) return;

    const dates = detectDates(text);
    for (const d of dates) {
      const from = pos + d.index;
      const to = from + d.length;
      const isoDate = d.date.toISOString().split('T')[0];
      const isPast = d.type === 'deadline' && d.date < now;
      const chipClass = d.type === 'deadline'
        ? (isPast ? 'date-chip deadline overdue' : 'date-chip deadline')
        : 'date-chip';

      decorations.push(
        Decoration.inline(from, to, {
          nodeName: 'span',
          class: chipClass,
          'data-date': isoDate,
          'data-type': d.type,
          'data-original': d.text,
          'data-context': d.context || '',
        }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

const DateChipExtension = Extension.create({
  name: 'dateChip',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: dateChipPluginKey,
        state: {
          init: (_, { doc }) => buildDateChipDecorations(doc),
          apply: (tr, oldSet) => {
            if (!tr.docChanged) return oldSet.map(tr.mapping, tr.doc);
            return buildDateChipDecorations(tr.doc);
          },
        },
        props: {
          decorations(state) {
            return dateChipPluginKey.getState(state) as DecorationSet | undefined;
          },
        },
      }),
    ];
  },
});

/**
 * Pre-process the parsed HTML so any fenced ```mermaid ``` block becomes
 * a `<div data-mermaid-source>` that the MermaidBlock node can absorb
 * via parseHTML. Done with a simple DOMParser — no regex on HTML.
 */
function rewriteMermaidBlocks(html: string): string {
  if (!html.includes('language-mermaid')) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return html;
  const blocks = Array.from(root.querySelectorAll('pre > code.language-mermaid'));
  for (const code of blocks) {
    const pre = code.parentElement!;
    const source = code.textContent || '';
    const wrapper = doc.createElement('div');
    wrapper.setAttribute('data-mermaid-source', source);
    wrapper.className = 'mermaid-block-node';
    pre.replaceWith(wrapper);
  }
  return root.innerHTML;
}

let suppressUpdate = false;

function buildEditor(): Editor {
  const { frontmatter: fm, body } = splitFrontmatter(props.modelValue);
  frontmatter.value = fm;
  const html = rewriteMermaidBlocks(markdownToHtml(body));

  return new Editor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // CodeBlockLowlight replaces it
      }),
      Placeholder.configure({ placeholder: props.placeholder }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'tiptap-link', rel: 'noopener noreferrer' },
      }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockWithCopy.configure({ lowlight }),
      MermaidBlock,
      DateChipExtension,
    ],
    content: html,
    editable: !props.disabled,
    editorProps: {
      attributes: {
        class: 'tiptap-live-content',
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (suppressUpdate) return;
      const md = htmlToMarkdown(ed.getHTML());
      emit('update:modelValue', joinFrontmatter(frontmatter.value, md));
    },
    onSelectionUpdate: () => emit('selection-snapshot'),
    onFocus: () => emit('selection-snapshot'),
    onBlur: () => emit('selection-snapshot'),
  });
}

onMounted(() => {
  editor.value = buildEditor();
});

onBeforeUnmount(() => {
  editor.value?.destroy();
  editor.value = null;
});

/**
 * External markdown changes (file load, AI format apply, version restore) need
 * to repopulate the editor without echoing back through onUpdate (which would
 * re-emit the same string and possibly create a feedback loop).
 */
watch(
  () => props.modelValue,
  (next) => {
    const ed = editor.value;
    if (!ed) return;
    const current = joinFrontmatter(frontmatter.value, htmlToMarkdown(ed.getHTML()));
    if (current === next) return;
    const { frontmatter: fm, body } = splitFrontmatter(next);
    frontmatter.value = fm;
    const html = rewriteMermaidBlocks(markdownToHtml(body));
    suppressUpdate = true;
    ed.commands.setContent(html, { emitUpdate: false });
    suppressUpdate = false;
  },
);

watch(
  () => props.disabled,
  (disabled) => {
    editor.value?.setEditable(!disabled);
  },
);

/**
 * Handle clicks on the host element. If the click landed on a `.date-chip`
 * decoration, emit `date-chip-click` so the parent can open the popover.
 * We handle it here (Vue level) rather than via ProseMirror's `handleClickOn`
 * because the latter relies on `posAtCoords` which doesn't work in jsdom and
 * isn't needed for a chip click — the decoration's DOM is already the target.
 */
function handleHostClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const chip = target.closest('.date-chip') as HTMLElement | null;
  if (!chip) return;
  event.preventDefault();
  event.stopPropagation();
  emit('date-chip-click', {
    date: chip.dataset.date || '',
    type: chip.dataset.type || 'regular',
    original: chip.dataset.original || '',
    context: chip.dataset.context || '',
    anchorRect: chip.getBoundingClientRect(),
  });
}

function focusEditor() {
  editor.value?.commands.focus();
}

/**
 * Insert a markdown snippet at the current cursor. Converts the snippet to
 * HTML first so any markdown structure is preserved as Tiptap nodes.
 */
function insertAtCursor(text: string) {
  const ed = editor.value;
  if (!ed) return;
  const html = rewriteMermaidBlocks(markdownToHtml(text));
  ed.chain().focus().insertContent(html).run();
}

function getSelectionText(): { text: string; from: number; to: number } {
  const ed = editor.value;
  if (!ed) return { text: '', from: 0, to: 0 };
  const { from, to } = ed.state.selection;
  return { text: ed.state.doc.textBetween(from, to, '\n'), from, to };
}

defineExpose({
  focusEditor,
  insertAtCursor,
  getSelectionText,
  getEditor: () => editor.value,
});

// Surface line-height + spelling hints aren't strictly needed; computed only
// to silence "ref not used" if any tooling complains.
const _hasEditor = computed(() => !!editor.value);
void _hasEditor.value;
</script>

<style scoped>
.live-editor-host {
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--hn-bg-deep);
  padding: 20px 24px;
}

.live-editor-surface {
  outline: none;
  min-height: 100%;
}

/* Tiptap renders into .ProseMirror; let .markdown-preview styles do the work,
   we just remove the focus ring and tighten paragraph spacing slightly. */
.live-editor-host :deep(.ProseMirror) {
  outline: none;
  min-height: 100%;
}

.live-editor-host :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: var(--hn-text-muted);
  float: left;
  height: 0;
  pointer-events: none;
}

.live-editor-host :deep(.ProseMirror-focused) {
  outline: none;
}

/* Task list checkboxes — Tiptap uses div wrappers, give them reading-view feel */
.live-editor-host :deep(ul[data-type='taskList']) {
  list-style: none;
  padding-left: 0.5em;
}

.live-editor-host :deep(ul[data-type='taskList'] li) {
  display: flex;
  align-items: flex-start;
  gap: 0.5em;
  margin: 0.4em 0;
}

.live-editor-host :deep(ul[data-type='taskList'] li > label) {
  margin-top: 0.25em;
}

.live-editor-host :deep(ul[data-type='taskList'] li > div) {
  flex: 1;
  min-width: 0;
}

.live-editor-host :deep(ul[data-type='taskList'] li > div > p) {
  margin: 0;
}

.live-editor-host :deep(.tiptap-link) {
  color: var(--hn-purple);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: var(--hn-purple-muted);
}

.live-editor-host :deep(.tiptap-link:hover) {
  text-decoration-color: var(--hn-purple);
}

/* Mermaid block node container */
.live-editor-host :deep(.mermaid-block-node) {
  margin: 1.5em 0;
}

/* Code block node view: the wrapper owns the block margin so the copy button
   (absolute, top-right) aligns with the pre instead of floating above it. */
.live-editor-host :deep(.code-block-node) {
  margin: 1.2em 0;
}

.live-editor-host :deep(.code-block-node pre) {
  margin: 0;
}
</style>
