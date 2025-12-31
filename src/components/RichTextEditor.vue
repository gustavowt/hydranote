<template>
  <div class="rich-editor-container">
    <!-- Editor Header -->
    <div class="editor-header">
      <div class="header-left">
        <ion-icon :icon="documentTextOutline" class="header-icon" />
        <span class="header-title" :title="fileName">
          {{ fileName }}
        </span>
        <span v-if="hasChanges" class="unsaved-indicator">•</span>
      </div>
      <div class="header-actions">
        <div class="save-btn-wrapper">
          <ion-button 
            fill="solid" 
            size="small" 
            class="save-btn"
            :class="{ visible: hasChanges }"
            @click="handleSave"
            :disabled="saving || !hasChanges"
          >
            <ion-icon slot="start" :icon="saveOutline" />
            Save
          </ion-button>
        </div>
        <!-- Toolbar -->
        <div class="toolbar" v-if="editor">
          <button
            @click="editor.chain().focus().toggleBold().run()"
            :class="{ active: editor.isActive('bold') }"
            title="Bold (Ctrl+B)"
          >
            <ion-icon :icon="textOutline" style="font-weight: bold;" />
            <span class="btn-label">B</span>
          </button>
          <button
            @click="editor.chain().focus().toggleItalic().run()"
            :class="{ active: editor.isActive('italic') }"
            title="Italic (Ctrl+I)"
          >
            <span class="btn-label italic">I</span>
          </button>
          <button
            @click="editor.chain().focus().toggleUnderline().run()"
            :class="{ active: editor.isActive('underline') }"
            title="Underline (Ctrl+U)"
          >
            <span class="btn-label underline">U</span>
          </button>
          <button
            @click="editor.chain().focus().toggleStrike().run()"
            :class="{ active: editor.isActive('strike') }"
            title="Strikethrough"
          >
            <span class="btn-label strike">S</span>
          </button>
          
          <div class="toolbar-divider"></div>
          
          <button
            @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
            :class="{ active: editor.isActive('heading', { level: 1 }) }"
            title="Heading 1"
          >
            H1
          </button>
          <button
            @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
            :class="{ active: editor.isActive('heading', { level: 2 }) }"
            title="Heading 2"
          >
            H2
          </button>
          <button
            @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
            :class="{ active: editor.isActive('heading', { level: 3 }) }"
            title="Heading 3"
          >
            H3
          </button>
          
          <div class="toolbar-divider"></div>
          
          <button
            @click="editor.chain().focus().toggleBulletList().run()"
            :class="{ active: editor.isActive('bulletList') }"
            title="Bullet List"
          >
            <ion-icon :icon="listOutline" />
          </button>
          <button
            @click="editor.chain().focus().toggleOrderedList().run()"
            :class="{ active: editor.isActive('orderedList') }"
            title="Numbered List"
          >
            <ion-icon :icon="reorderFourOutline" />
          </button>
          <button
            @click="editor.chain().focus().toggleTaskList().run()"
            :class="{ active: editor.isActive('taskList') }"
            title="Task List"
          >
            <ion-icon :icon="checkboxOutline" />
          </button>
          
          <div class="toolbar-divider"></div>
          
          <button
            @click="editor.chain().focus().toggleBlockquote().run()"
            :class="{ active: editor.isActive('blockquote') }"
            title="Quote"
          >
            <ion-icon :icon="chatbubbleOutline" />
          </button>
          <button
            @click="editor.chain().focus().toggleCodeBlock().run()"
            :class="{ active: editor.isActive('codeBlock') }"
            title="Code Block"
          >
            <ion-icon :icon="codeSlashOutline" />
          </button>
          <button
            @click="editor.chain().focus().setHorizontalRule().run()"
            title="Horizontal Rule"
          >
            <ion-icon :icon="removeOutline" />
          </button>
          
          <div class="toolbar-divider"></div>
          
          <button
            @click="setLink"
            :class="{ active: editor.isActive('link') }"
            title="Add Link"
          >
            <ion-icon :icon="linkOutline" />
          </button>
          <button
            @click="insertTable"
            :class="{ active: editor.isActive('table') }"
            title="Insert Table"
          >
            <ion-icon :icon="gridOutline" />
          </button>
          
          <div class="toolbar-divider"></div>
          
          <button
            @click="editor.chain().focus().setTextAlign('left').run()"
            :class="{ active: editor.isActive({ textAlign: 'left' }) }"
            title="Align Left"
          >
            <ion-icon :icon="reorderTwoOutline" style="transform: scaleX(-1);" />
          </button>
          <button
            @click="editor.chain().focus().setTextAlign('center').run()"
            :class="{ active: editor.isActive({ textAlign: 'center' }) }"
            title="Align Center"
          >
            <ion-icon :icon="reorderTwoOutline" />
          </button>
          <button
            @click="editor.chain().focus().setTextAlign('right').run()"
            :class="{ active: editor.isActive({ textAlign: 'right' }) }"
            title="Align Right"
          >
            <ion-icon :icon="reorderTwoOutline" />
          </button>
        </div>
      </div>
    </div>

    <!-- Editor Content -->
    <div class="editor-content">
      <editor-content v-if="editor" :editor="editor" class="tiptap-editor" />
    </div>

    <!-- Status Bar -->
    <div class="status-bar">
      <span class="status-item">
        <ion-icon :icon="textOutline" />
        {{ wordCount }} words
      </span>
      <span class="status-item">
        <ion-icon :icon="documentOutline" />
        {{ charCount }} chars
      </span>
      <span class="status-item file-type">
        <ion-icon :icon="documentAttachOutline" />
        {{ fileTypeLabel }}
      </span>
      <span v-if="currentProject" class="status-item project-tag">
        <ion-icon :icon="folderOutline" />
        {{ currentProject.name }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
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
  IonIcon,
  IonButton,
} from '@ionic/vue';
import {
  documentTextOutline,
  documentOutline,
  documentAttachOutline,
  saveOutline,
  textOutline,
  folderOutline,
  listOutline,
  reorderFourOutline,
  checkboxOutline,
  chatbubbleOutline,
  codeSlashOutline,
  removeOutline,
  linkOutline,
  gridOutline,
  reorderTwoOutline,
} from 'ionicons/icons';
import type { Project, ProjectFile } from '@/types';

const lowlight = createLowlight(common);

interface Props {
  currentFile?: ProjectFile | null;
  currentProject?: Project | null;
  htmlContent?: string;
}

const props = withDefaults(defineProps<Props>(), {
  currentFile: null,
  currentProject: null,
  htmlContent: '',
});

const emit = defineEmits<{
  (e: 'save', content: string, html: string, file?: ProjectFile): void;
  (e: 'content-change', content: string): void;
}>();

const editor = shallowRef<Editor | null>(null);
const originalContent = ref('');
const saving = ref(false);

const fileName = computed(() => {
  if (!props.currentFile) return 'New Document';
  return props.currentFile.name || 'Untitled';
});

const fileTypeLabel = computed(() => {
  if (!props.currentFile) return 'DOCX';
  const type = props.currentFile.type?.toUpperCase() || 'DOCX';
  return type;
});

const hasChanges = computed(() => {
  if (!editor.value) return false;
  return editor.value.getHTML() !== originalContent.value;
});

const wordCount = computed(() => {
  if (!editor.value) return 0;
  const text = editor.value.getText();
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
});

const charCount = computed(() => {
  if (!editor.value) return 0;
  return editor.value.getText().length;
});

onMounted(() => {
  editor.value = new Editor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // We use CodeBlockLowlight instead
      }),
      Placeholder.configure({
        placeholder: 'Start writing your document...',
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Highlight.configure({
        multicolor: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'tiptap-link',
        },
      }),
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
    ],
    content: props.htmlContent || '',
    onUpdate: ({ editor }) => {
      emit('content-change', editor.getHTML());
    },
  });

  if (editor.value) {
    originalContent.value = editor.value.getHTML();
  }
});

onBeforeUnmount(() => {
  editor.value?.destroy();
});

// Watch for content changes from props
watch(() => props.htmlContent, (newContent) => {
  if (editor.value && newContent !== undefined) {
    const currentContent = editor.value.getHTML();
    if (newContent !== currentContent) {
      editor.value.commands.setContent(newContent, { emitUpdate: false });
      originalContent.value = newContent;
    }
  }
});

// Watch for file changes
watch(() => props.currentFile, (newFile) => {
  if (newFile && editor.value) {
    // Content will be set via htmlContent prop
    originalContent.value = editor.value.getHTML();
  }
});

function handleSave() {
  if (!editor.value) return;
  
  saving.value = true;
  const html = editor.value.getHTML();
  const text = editor.value.getText();
  
  emit('save', text, html, props.currentFile || undefined);
  originalContent.value = html;
  
  setTimeout(() => {
    saving.value = false;
  }, 500);
}

function setLink() {
  if (!editor.value) return;
  
  const previousUrl = editor.value.getAttributes('link').href;
  const url = window.prompt('URL', previousUrl);

  if (url === null) return;

  if (url === '') {
    editor.value.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }

  editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}

function insertTable() {
  if (!editor.value) return;
  editor.value.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
}

// Expose methods for parent component
function setContent(html: string) {
  if (editor.value) {
    editor.value.commands.setContent(html, { emitUpdate: false });
    originalContent.value = html;
  }
}

function getHTML(): string {
  return editor.value?.getHTML() || '';
}

function getText(): string {
  return editor.value?.getText() || '';
}

defineExpose({ setContent, getHTML, getText, hasChanges });
</script>

<style scoped>
.rich-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--hn-bg-deep);
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

/* Editor Header */
.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--hn-bg-surface);
  border-bottom: 1px solid var(--hn-border-default);
  min-height: 48px;
  gap: 12px;
  flex-wrap: wrap;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.header-icon {
  font-size: 16px;
  color: var(--hn-text-secondary);
  flex-shrink: 0;
}

.header-title {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--hn-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.unsaved-indicator {
  font-size: 20px;
  color: var(--hn-warning);
  line-height: 1;
  flex-shrink: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--hn-bg-elevated);
  border-radius: 6px;
  padding: 4px;
  flex-wrap: wrap;
}

.toolbar button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: var(--hn-text-secondary);
  font-size: 12px;
  font-weight: 600;
  transition: all 0.15s ease;
}

.toolbar button:hover {
  color: var(--hn-text-primary);
  background: var(--hn-bg-hover);
}

.toolbar button.active {
  color: var(--hn-teal);
  background: var(--hn-bg-hover);
}

.toolbar button ion-icon {
  font-size: 16px;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--hn-border-default);
  margin: 0 4px;
}

.btn-label {
  font-family: 'Georgia', serif;
  font-size: 14px;
}

.btn-label.italic {
  font-style: italic;
}

.btn-label.underline {
  text-decoration: underline;
}

.btn-label.strike {
  text-decoration: line-through;
}

/* Save Button */
.save-btn-wrapper {
  display: flex;
  align-items: center;
  min-width: 75px;
  height: 30px;
}

.save-btn {
  --color: #ffffff;
  --border-radius: 6px;
  --padding-start: 10px;
  --padding-end: 12px;
  --box-shadow: none;
  margin: 0;
  font-weight: 600;
  font-size: 0.8rem;
  height: 30px;
  min-height: 30px;
  opacity: 0;
  transform: scale(0.9);
  pointer-events: none;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.save-btn.visible {
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
}

.save-btn::part(native) {
  background: linear-gradient(135deg, var(--hn-green) 0%, var(--hn-teal) 100%);
  box-shadow: 0 2px 6px rgba(63, 185, 80, 0.3);
}

/* Editor Content */
.editor-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px 32px;
  background: var(--hn-bg-deep);
}

.tiptap-editor {
  max-width: 800px;
  margin: 0 auto;
}

/* Tiptap Editor Styles */
.tiptap-editor :deep(.tiptap) {
  outline: none;
  min-height: 300px;
  color: var(--hn-text-primary);
  font-size: 1rem;
  line-height: 1.7;
}

.tiptap-editor :deep(.tiptap p.is-editor-empty:first-child::before) {
  color: var(--hn-text-muted);
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

.tiptap-editor :deep(.tiptap h1),
.tiptap-editor :deep(.tiptap h2),
.tiptap-editor :deep(.tiptap h3),
.tiptap-editor :deep(.tiptap h4),
.tiptap-editor :deep(.tiptap h5),
.tiptap-editor :deep(.tiptap h6) {
  color: #ffffff;
  font-weight: 600;
  margin: 1.5em 0 0.6em;
  line-height: 1.3;
}

.tiptap-editor :deep(.tiptap h1) {
  font-size: 2em;
  border-bottom: 1px solid var(--hn-border-default);
  padding-bottom: 0.3em;
}

.tiptap-editor :deep(.tiptap h2) {
  font-size: 1.5em;
  border-bottom: 1px solid var(--hn-border-default);
  padding-bottom: 0.3em;
}

.tiptap-editor :deep(.tiptap h3) { font-size: 1.25em; }
.tiptap-editor :deep(.tiptap h4) { font-size: 1em; }

.tiptap-editor :deep(.tiptap p) {
  margin: 1em 0;
}

.tiptap-editor :deep(.tiptap ul),
.tiptap-editor :deep(.tiptap ol) {
  margin: 1em 0;
  padding-left: 1.5em;
}

.tiptap-editor :deep(.tiptap li) {
  margin: 0.4em 0;
}

.tiptap-editor :deep(.tiptap ul[data-type="taskList"]) {
  list-style: none;
  padding-left: 0;
}

.tiptap-editor :deep(.tiptap ul[data-type="taskList"] li) {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.tiptap-editor :deep(.tiptap ul[data-type="taskList"] li > label) {
  flex-shrink: 0;
  margin-top: 4px;
}

.tiptap-editor :deep(.tiptap ul[data-type="taskList"] li > div) {
  flex: 1;
}

.tiptap-editor :deep(.tiptap code) {
  background: var(--hn-bg-elevated);
  padding: 0.2em 0.5em;
  border-radius: 4px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.9em;
  color: var(--hn-code);
}

.tiptap-editor :deep(.tiptap pre) {
  background: var(--hn-bg-surface);
  padding: 16px 20px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 1.2em 0;
  border: 1px solid var(--hn-border-default);
}

.tiptap-editor :deep(.tiptap pre code) {
  background: none;
  padding: 0;
  font-size: 0.85em;
  line-height: 1.6;
  color: var(--hn-text-primary);
}

.tiptap-editor :deep(.tiptap blockquote) {
  border-left: 4px solid var(--hn-teal);
  margin: 1.2em 0;
  padding: 0.6em 0 0.6em 1.2em;
  color: var(--hn-text-secondary);
  background: var(--hn-teal-muted);
  border-radius: 0 8px 8px 0;
}

.tiptap-editor :deep(.tiptap a),
.tiptap-editor :deep(.tiptap .tiptap-link) {
  color: var(--hn-purple);
  text-decoration: none;
  cursor: pointer;
}

.tiptap-editor :deep(.tiptap a:hover) {
  text-decoration: underline;
}

.tiptap-editor :deep(.tiptap strong) {
  font-weight: 600;
  color: #ffffff;
}

.tiptap-editor :deep(.tiptap em) {
  font-style: italic;
}

.tiptap-editor :deep(.tiptap u) {
  text-decoration: underline;
}

.tiptap-editor :deep(.tiptap s) {
  text-decoration: line-through;
}

.tiptap-editor :deep(.tiptap hr) {
  border: none;
  border-top: 1px solid var(--hn-border-default);
  margin: 2em 0;
}

.tiptap-editor :deep(.tiptap img) {
  max-width: 100%;
  border-radius: 8px;
  margin: 1em 0;
}

/* Table Styles */
.tiptap-editor :deep(.tiptap table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1.2em 0;
  overflow: hidden;
}

.tiptap-editor :deep(.tiptap th),
.tiptap-editor :deep(.tiptap td) {
  border: 1px solid var(--hn-border-default);
  padding: 10px 14px;
  text-align: left;
  min-width: 80px;
  vertical-align: top;
}

.tiptap-editor :deep(.tiptap th) {
  background: var(--hn-bg-surface);
  font-weight: 600;
  color: #ffffff;
}

.tiptap-editor :deep(.tiptap .selectedCell) {
  background: rgba(45, 212, 191, 0.15);
}

/* Highlight */
.tiptap-editor :deep(.tiptap mark) {
  background: rgba(250, 204, 21, 0.4);
  border-radius: 2px;
  padding: 0 2px;
}

/* Status Bar */
.status-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 16px;
  background: var(--hn-bg-surface);
  border-top: 1px solid var(--hn-border-default);
  font-size: 0.75rem;
  color: var(--hn-text-secondary);
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-item ion-icon {
  font-size: 12px;
}

.status-item.file-type {
  color: var(--hn-purple);
}

.status-item.project-tag {
  margin-left: auto;
  color: var(--hn-teal);
}

/* Scrollbar */
.editor-content::-webkit-scrollbar {
  width: 8px;
}

.editor-content::-webkit-scrollbar-track {
  background: transparent;
}

.editor-content::-webkit-scrollbar-thumb {
  background: var(--hn-border-default);
  border-radius: 4px;
}

.editor-content::-webkit-scrollbar-thumb:hover {
  background: var(--hn-border-strong);
}
</style>

