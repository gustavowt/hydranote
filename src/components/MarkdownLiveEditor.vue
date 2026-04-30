<template>
  <div class="live-editor-host markdown-preview">
    <editor-content v-if="editor" :editor="editor" class="live-editor-surface" />
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount, computed } from 'vue';
import { Editor, EditorContent, Node, mergeAttributes, VueNodeViewRenderer } from '@tiptap/vue-3';
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
import { common, createLowlight } from 'lowlight';
import {
  splitFrontmatter,
  joinFrontmatter,
  markdownToHtml,
  htmlToMarkdown,
} from '@/services/markdownConverter';
import MermaidBlockNodeView from './MermaidBlockNodeView.vue';

const lowlight = createLowlight(common);

const props = withDefaults(
  defineProps<{
    modelValue: string;
    disabled?: boolean;
    placeholder?: string;
  }>(),
  { disabled: false, placeholder: 'Start writing...' },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'selection-snapshot'): void;
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
      CodeBlockLowlight.configure({ lowlight }),
      MermaidBlock,
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
</style>
