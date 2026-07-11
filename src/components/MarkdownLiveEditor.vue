<template>
  <div class="live-editor-host markdown-preview" @click="handleHostClick">
    <editor-content v-if="editor" :editor="editor" class="live-editor-surface" />
    <MarkdownTableBubbleMenu v-if="editor" :editor="editor" />
    <MarkdownSlashMenu
      :commands="slashMenu.commands"
      :is-visible="slashMenu.visible"
      :anchor-rect="slashMenu.anchorRect"
      @select="onSlashSelect"
      @close="closeSlashMenu"
    />
    <WikilinkAutocomplete
      :project-id="projectId"
      :search-query="wikilinkMenu.query"
      :is-visible="wikilinkMenu.visible"
      :anchor-rect="wikilinkMenu.anchorRect"
      @select="onWikilinkSelect"
      @close="closeWikilinkMenu"
    />
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
  rewriteTaskListHtml,
} from '@/services/markdownConverter';
import { detectDates } from '@/services/dateDetectionService';
import { rewriteCalloutHtml } from '@/services/calloutConverter';
import MermaidBlockNodeView from './MermaidBlockNodeView.vue';
import CodeBlockNodeView from './CodeBlockNodeView.vue';
import MarkdownSlashMenu from './MarkdownSlashMenu.vue';
import WikilinkAutocomplete, { type WikilinkFileItem } from './WikilinkAutocomplete.vue';
import {
  SlashCommandExtension,
  applySlashCommandToEditor,
  type SlashCommandPayload,
} from '@/extensions/slashCommandExtension';
import {
  WikilinkAutocompleteExtension,
  applyWikilinkToEditor,
  type WikilinkPayload,
} from '@/extensions/wikilinkAutocompleteExtension';
import type { SlashCommand } from '@/composables/markdownSlashCommands';
import { Callout } from '@/extensions/calloutExtension';
import MarkdownTableBubbleMenu from './MarkdownTableBubbleMenu.vue';
import { savePastedImage, readClipboardImage } from '@/services/editorImagePaste';
import { toastController } from '@ionic/vue';

const lowlight = createLowlight(common);

const props = withDefaults(
  defineProps<{
    modelValue: string;
    disabled?: boolean;
    placeholder?: string;
    projectId?: string;
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

const slashMenu = ref<{
  visible: boolean;
  query: string;
  from: number;
  to: number;
  commands: SlashCommand[];
  anchorRect: DOMRect | null;
}>({
  visible: false,
  query: '',
  from: 0,
  to: 0,
  commands: [],
  anchorRect: null,
});

const wikilinkMenu = ref<{
  visible: boolean;
  query: string;
  from: number;
  to: number;
  anchorRect: DOMRect | null;
}>({
  visible: false,
  query: '',
  from: 0,
  to: 0,
  anchorRect: null,
});

function onSlashPayload(payload: SlashCommandPayload | null) {
  if (!payload) {
    slashMenu.value.visible = false;
    return;
  }
  slashMenu.value = {
    visible: true,
    query: payload.query,
    from: payload.from,
    to: payload.to,
    commands: payload.commands,
    anchorRect: payload.anchorRect,
  };
}

function onWikilinkPayload(payload: WikilinkPayload | null) {
  if (!payload) {
    wikilinkMenu.value.visible = false;
    return;
  }
  wikilinkMenu.value = {
    visible: true,
    query: payload.query,
    from: payload.from,
    to: payload.to,
    anchorRect: payload.anchorRect,
  };
}

function closeSlashMenu() {
  slashMenu.value.visible = false;
}

function closeWikilinkMenu() {
  wikilinkMenu.value.visible = false;
}

function onSlashSelect(command: SlashCommand) {
  const ed = editor.value;
  if (!ed) return;
  applySlashCommandToEditor(ed, command, slashMenu.value.from, slashMenu.value.to);
  closeSlashMenu();
}

function onWikilinkSelect(file: WikilinkFileItem) {
  const ed = editor.value;
  if (!ed) return;
  const linkPath = file.path || file.name;
  applyWikilinkToEditor(ed, linkPath, wikilinkMenu.value.from, wikilinkMenu.value.to);
  closeWikilinkMenu();
}

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

async function handleImagePaste(clipboardData: DataTransfer): Promise<boolean> {
  const image = await readClipboardImage(clipboardData);
  if (!image) return false;

  const projectId = props.projectId;
  if (!projectId) {
    const toast = await toastController.create({
      message: 'Open or select a project to paste images',
      duration: 3000,
      color: 'warning',
    });
    await toast.present();
    return true;
  }

  try {
    const { markdown } = await savePastedImage({
      projectId,
      binaryData: image.binaryData,
      mimeType: image.mimeType,
    });
    insertAtCursor(markdown);
    return true;
  } catch {
    const toast = await toastController.create({
      message: 'Failed to save pasted image',
      duration: 3000,
      color: 'danger',
    });
    await toast.present();
    return true;
  }
}

function buildEditor(): Editor {
  const { frontmatter: fm, body } = splitFrontmatter(props.modelValue);
  frontmatter.value = fm;
  const html = rewriteCalloutHtml(rewriteTaskListHtml(rewriteMermaidBlocks(markdownToHtml(body))));

  return new Editor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // CodeBlockLowlight replaces it
        link: false,
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
      Callout,
      DateChipExtension,
      SlashCommandExtension.configure({ onChange: onSlashPayload }),
      WikilinkAutocompleteExtension.configure({ onChange: onWikilinkPayload }),
    ],
    content: html,
    editable: !props.disabled,
    editorProps: {
      attributes: {
        class: 'tiptap-live-content',
        spellcheck: 'true',
      },
      handlePaste: (_view, event) => {
        const clipboard = event.clipboardData;
        if (!clipboard) return false;
        const hasImage = Array.from(clipboard.items || []).some((item) => item.type.startsWith('image/'));
        if (!hasImage) return false;
        event.preventDefault();
        void handleImagePaste(clipboard);
        return true;
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
    const html = rewriteCalloutHtml(rewriteTaskListHtml(rewriteMermaidBlocks(markdownToHtml(body))));
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
  if (chip) {
    event.preventDefault();
    event.stopPropagation();
    emit('date-chip-click', {
      date: chip.dataset.date || '',
      type: chip.dataset.type || 'regular',
      original: chip.dataset.original || '',
      context: chip.dataset.context || '',
      anchorRect: chip.getBoundingClientRect(),
    });
    return;
  }
  const host = event.currentTarget as HTMLElement;
  if (target === host || !target.closest('.ProseMirror')) {
    editor.value?.commands.focus();
  }
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
  const html = rewriteTaskListHtml(rewriteMermaidBlocks(markdownToHtml(text)));
  ed.chain().focus().insertContent(html).run();
}

function getSelectionText(): { text: string; from: number; to: number } {
  const ed = editor.value;
  if (!ed) return { text: '', from: 0, to: 0 };
  const { from, to } = ed.state.selection;
  return { text: ed.state.doc.textBetween(from, to, '\n'), from, to };
}

function scrollToHeading(outlineIndex: number): void {
  const ed = editor.value;
  if (!ed) return;

  let headingIndex = 0;
  let targetPos = -1;

  ed.state.doc.descendants((node, pos) => {
    if (targetPos >= 0) return false;
    if (node.type.name !== 'heading') return;
    if (headingIndex === outlineIndex) {
      targetPos = pos + 1;
      return false;
    }
    headingIndex++;
  });

  if (targetPos < 0 || targetPos > ed.state.doc.content.size) return;

  ed.chain().focus().setTextSelection(targetPos).run();
  const domPos = ed.view.domAtPos(targetPos);
  const element =
    domPos.node instanceof HTMLElement
      ? domPos.node
      : domPos.node.parentElement;
  element?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}

defineExpose({
  focusEditor,
  insertAtCursor,
  getSelectionText,
  getEditor: () => editor.value,
  scrollToHeading,
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
  position: relative;
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
  color: var(--hn-text-primary);
  caret-color: var(--hn-text-primary);
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

.live-editor-host :deep(aside.callout) {
  margin: 1.2em 0;
  padding: 0.75em 1em;
  border-radius: 8px;
  border-left: 4px solid;
}

.live-editor-host :deep(aside.callout-note) {
  background: rgba(59, 130, 246, 0.1);
  border-left-color: #3b82f6;
}

.live-editor-host :deep(aside.callout-tip) {
  background: rgba(34, 197, 94, 0.1);
  border-left-color: #22c55e;
}

.live-editor-host :deep(aside.callout-warning) {
  background: rgba(245, 158, 11, 0.12);
  border-left-color: #f59e0b;
}
</style>
