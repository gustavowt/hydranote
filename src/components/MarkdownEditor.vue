<template>
  <div class="markdown-editor-container">
    <!-- Editor Header -->
    <div class="editor-header">
      <div class="header-left">
        <ion-icon :icon="documentTextOutline" class="header-icon" />
        <span class="header-title" :title="currentFile?.name || 'New Note'">
          {{ displayFileName }}
        </span>
        <span v-if="hasChanges" class="unsaved-indicator">•</span>
      </div>
      <div class="header-actions">
        <ion-button 
          v-if="hasChanges" 
          fill="solid" 
          size="small" 
          class="save-btn"
          @click="handleSave"
          :disabled="saving"
        >
          <ion-icon slot="start" :icon="saveOutline" />
          Save
        </ion-button>
        <div class="mode-toggle">
          <button 
            :class="['mode-btn', { active: viewMode === 'edit' }]" 
            @click="viewMode = 'edit'"
            title="Edit"
          >
            <ion-icon :icon="codeOutline" />
          </button>
          <button 
            :class="['mode-btn', { active: viewMode === 'split' }]" 
            @click="viewMode = 'split'"
            title="Split"
          >
            <ion-icon :icon="gridOutline" />
          </button>
          <button 
            :class="['mode-btn', { active: viewMode === 'view' }]" 
            @click="viewMode = 'view'"
            title="Preview"
          >
            <ion-icon :icon="eyeOutline" />
          </button>
        </div>
      </div>
    </div>

    <!-- Editor Content -->
    <div class="editor-content">
      <!-- Saving State (for new notes) -->
      <div v-if="saving && isNewNote" class="saving-overlay">
        <div class="saving-content">
          <IonSpinner name="crescent" />
          <h3>Saving Note</h3>
          <div class="execution-steps" v-if="executionSteps.length > 0">
            <div 
              v-for="step in executionSteps" 
              :key="step.id" 
              :class="['step', step.status]"
            >
              <span class="step-icon">
                <IonSpinner v-if="step.status === 'running'" name="dots" />
                <IonIcon v-else-if="step.status === 'completed'" :icon="checkmarkCircle" />
                <IonIcon v-else :icon="ellipseOutline" />
              </span>
              <span class="step-label">{{ step.label }}</span>
              <span v-if="step.detail" class="step-detail">{{ step.detail }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Edit Mode -->
      <div v-if="viewMode === 'edit'" class="editor-pane full">
        <textarea 
          ref="editorRef"
          v-model="content"
          class="markdown-textarea"
          placeholder="Start writing your note..."
          @input="handleInput"
          :disabled="saving"
        ></textarea>
      </div>

      <!-- Split Mode -->
      <div v-else-if="viewMode === 'split'" class="split-pane">
        <div class="editor-pane">
          <textarea 
            ref="splitEditorRef"
            v-model="content"
            class="markdown-textarea"
            placeholder="Start writing your note..."
            @input="handleInput"
            :disabled="saving"
          ></textarea>
        </div>
        <div class="preview-pane markdown-preview" v-html="renderedContent"></div>
      </div>

      <!-- View Mode -->
      <div v-else class="preview-pane full markdown-preview" v-html="renderedContent"></div>
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
      <span v-if="currentProject" class="status-item project-tag">
        <ion-icon :icon="folderOutline" />
        {{ currentProject.name }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import {
  IonIcon,
  IonButton,
  IonSpinner,
  toastController,
} from '@ionic/vue';
import {
  documentTextOutline,
  documentOutline,
  codeOutline,
  gridOutline,
  eyeOutline,
  saveOutline,
  textOutline,
  folderOutline,
  checkmarkCircle,
  ellipseOutline,
} from 'ionicons/icons';
import type { Project, ProjectFile, GlobalAddNoteResult } from '@/types';
import type { NoteExecutionStep } from '@/services';
import { globalAddNote } from '@/services';

interface Props {
  currentFile?: ProjectFile | null;
  currentProject?: Project | null;
  initialContent?: string;
}

const props = withDefaults(defineProps<Props>(), {
  currentFile: null,
  currentProject: null,
  initialContent: '',
});

const emit = defineEmits<{
  (e: 'save', content: string, file?: ProjectFile): void;
  (e: 'content-change', content: string): void;
  (e: 'note-saved', result: GlobalAddNoteResult): void;
}>();

// Configure marked with highlight.js
const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch {
          // Fall back to auto-detection
        }
      }
      try {
        return hljs.highlightAuto(code).value;
      } catch {
        return code;
      }
    },
  })
);

const content = ref('');
const originalContent = ref('');
const viewMode = ref<'edit' | 'split' | 'view'>('edit');
const saving = ref(false);
const editorRef = ref<HTMLTextAreaElement | null>(null);
const splitEditorRef = ref<HTMLTextAreaElement | null>(null);
const executionSteps = ref<NoteExecutionStep[]>([]);

const hasChanges = computed(() => content.value !== originalContent.value);
const isNewNote = computed(() => !props.currentFile);

const displayFileName = computed(() => {
  if (!props.currentFile) return 'New Note';
  return props.currentFile.name || 'Untitled';
});

const renderedContent = computed(() => {
  if (!content.value.trim()) {
    return '<p class="placeholder-text">Preview will appear here...</p>';
  }
  return marked.parse(content.value, { async: false }) as string;
});

const wordCount = computed(() => {
  if (!content.value.trim()) return 0;
  return content.value.trim().split(/\s+/).length;
});

const charCount = computed(() => content.value.length);

// Watch for file changes
watch(() => props.currentFile, (newFile, oldFile) => {
  if (newFile) {
    content.value = newFile.content || '';
    originalContent.value = newFile.content || '';
    // Open existing files in preview mode
    if (newFile.id !== oldFile?.id) {
      viewMode.value = 'view';
    }
  } else {
    // New note - use edit mode
    viewMode.value = 'edit';
  }
}, { immediate: true });

// Watch for initial content
watch(() => props.initialContent, (newContent) => {
  if (newContent && !props.currentFile) {
    content.value = newContent;
    originalContent.value = '';
  }
}, { immediate: true });

function handleInput() {
  emit('content-change', content.value);
}

async function handleSave() {
  if (!content.value.trim()) return;
  
  if (props.currentFile) {
    // Save existing file
    saving.value = true;
    try {
      emit('save', content.value, props.currentFile);
      originalContent.value = content.value;
    } finally {
      saving.value = false;
    }
  } else {
    // New note - run globalAddNote inline
    await saveNewNote();
  }
}

async function saveNewNote() {
  saving.value = true;
  executionSteps.value = [];

  const onProgress = (steps: NoteExecutionStep[]) => {
    executionSteps.value = [...steps];
  };

  try {
    let result = await globalAddNote({ rawNoteText: content.value }, onProgress);

    // Auto-confirm new project if needed
    if (result.pendingConfirmation) {
      const toast = await toastController.create({
        message: `Creating project "${result.pendingConfirmation.proposedProjectName}"...`,
        duration: 2000,
        position: 'top',
        color: 'primary',
      });
      await toast.present();

      // Auto-confirm the new project
      result = await globalAddNote(
        {
          rawNoteText: content.value,
          confirmedNewProject: {
            name: result.pendingConfirmation.proposedProjectName,
            description: result.pendingConfirmation.proposedProjectDescription,
          },
        },
        onProgress
      );
    }

    if (result.success) {
      const toast = await toastController.create({
        message: `Note saved to "${result.projectName}"`,
        duration: 3000,
        position: 'top',
        color: 'success',
      });
      await toast.present();

      // Clear editor and emit event
      content.value = '';
      originalContent.value = '';
      emit('note-saved', result);
    } else {
      const toast = await toastController.create({
        message: result.error || 'Failed to save note',
        duration: 3000,
        position: 'top',
        color: 'danger',
      });
      await toast.present();
    }
  } catch (error) {
    const toast = await toastController.create({
      message: 'An error occurred while saving',
      duration: 3000,
      position: 'top',
      color: 'danger',
    });
    await toast.present();
  } finally {
    saving.value = false;
    executionSteps.value = [];
  }
}

// Expose methods
function setContent(newContent: string) {
  content.value = newContent;
  originalContent.value = newContent;
}

function clearContent() {
  content.value = '';
  originalContent.value = '';
}

function focusEditor() {
  const editor = editorRef.value || splitEditorRef.value;
  editor?.focus();
}

defineExpose({ setContent, clearContent, focusEditor, hasChanges });
</script>

<style scoped>
.markdown-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--hn-bg-deep);
  flex: 1;
}

/* Editor Header */
.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 8px 12px 16px;
  background: var(--hn-bg-surface);
  border-bottom: 1px solid var(--hn-border-default);
  min-height: 48px;
  box-sizing: border-box;
  gap: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  margin-left: 32px;
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
  direction: rtl;
  text-align: left;
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
  gap: 8px;
  flex-shrink: 0;
  margin-right: 32px;
}

.mode-toggle {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--hn-bg-elevated);
  border-radius: 6px;
  padding: 2px;
}

.mode-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: var(--hn-text-secondary);
  transition: all 0.15s ease;
}

.mode-btn:hover {
  color: var(--hn-text-primary);
}

.mode-btn.active {
  background: var(--hn-bg-hover);
  color: var(--hn-teal);
}

.mode-btn ion-icon {
  font-size: 14px;
}

.save-btn {
  --background: var(--hn-green);
  --color: #ffffff;
  --border-radius: 6px;
  --padding-start: 10px;
  --padding-end: 10px;
  font-weight: 500;
  font-size: 0.8rem;
  height: 28px;
}

.save-btn:hover {
  --background: var(--hn-green-light);
}

.save-btn ion-icon {
  font-size: 14px;
}

/* Editor Content */
.editor-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  position: relative;
}

.editor-pane {
  flex: 1;
  overflow: hidden;
  display: flex;
}

.editor-pane.full {
  width: 100%;
}

.preview-pane {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

.preview-pane.full {
  width: 100%;
}

.split-pane {
  display: flex;
  width: 100%;
  height: 100%;
}

.split-pane .editor-pane {
  border-right: 1px solid var(--hn-border-default);
}

.markdown-textarea {
  width: 100%;
  height: 100%;
  background: var(--hn-bg-deep);
  color: var(--hn-text-primary);
  border: none;
  padding: 20px 24px;
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace;
  font-size: 0.95rem;
  line-height: 1.7;
  resize: none;
  outline: none;
}

.markdown-textarea::placeholder {
  color: var(--hn-text-muted);
}

/* Markdown Preview Styles */
.markdown-preview {
  color: var(--hn-text-primary);
  line-height: 1.7;
}

.markdown-preview :deep(.placeholder-text) {
  color: var(--hn-text-muted);
  font-style: italic;
}

.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3),
.markdown-preview :deep(h4),
.markdown-preview :deep(h5),
.markdown-preview :deep(h6) {
  color: #ffffff;
  font-weight: 600;
  margin: 1.5em 0 0.6em;
  line-height: 1.3;
}

.markdown-preview :deep(h1) { 
  font-size: 2em; 
  border-bottom: 1px solid var(--hn-border-default); 
  padding-bottom: 0.3em; 
}

.markdown-preview :deep(h2) { 
  font-size: 1.5em; 
  border-bottom: 1px solid var(--hn-border-default); 
  padding-bottom: 0.3em; 
}

.markdown-preview :deep(h3) { font-size: 1.25em; }
.markdown-preview :deep(h4) { font-size: 1em; }

.markdown-preview :deep(p) {
  margin: 1em 0;
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  margin: 1em 0;
  padding-left: 2em;
}

.markdown-preview :deep(li) {
  margin: 0.4em 0;
}

.markdown-preview :deep(code) {
  background: var(--hn-bg-elevated);
  padding: 0.2em 0.5em;
  border-radius: 4px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.9em;
  color: var(--hn-code);
}

.markdown-preview :deep(pre) {
  background: var(--hn-bg-surface);
  padding: 16px 20px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 1.2em 0;
  border: 1px solid var(--hn-border-default);
}

.markdown-preview :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.85em;
  line-height: 1.6;
  color: var(--hn-text-primary);
}

.markdown-preview :deep(blockquote) {
  border-left: 4px solid var(--hn-teal);
  margin: 1.2em 0;
  padding: 0.6em 0 0.6em 1.2em;
  color: var(--hn-text-secondary);
  background: var(--hn-teal-muted);
  border-radius: 0 8px 8px 0;
}

.markdown-preview :deep(a) {
  color: var(--hn-purple);
  text-decoration: none;
}

.markdown-preview :deep(a:hover) {
  text-decoration: underline;
}

.markdown-preview :deep(strong) {
  font-weight: 600;
  color: #ffffff;
}

.markdown-preview :deep(em) {
  font-style: italic;
  color: var(--hn-text-primary);
}

.markdown-preview :deep(hr) {
  border: none;
  border-top: 1px solid var(--hn-border-default);
  margin: 2em 0;
}

.markdown-preview :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1.2em 0;
}

.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  border: 1px solid var(--hn-border-default);
  padding: 10px 14px;
  text-align: left;
}

.markdown-preview :deep(th) {
  background: var(--hn-bg-surface);
  font-weight: 600;
  color: #ffffff;
}

.markdown-preview :deep(tr:nth-child(even)) {
  background: rgba(255, 255, 255, 0.02);
}

.markdown-preview :deep(img) {
  max-width: 100%;
  border-radius: 8px;
  margin: 1em 0;
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

.status-item.project-tag {
  margin-left: auto;
  color: var(--hn-teal);
}

/* Scrollbar styling */
.preview-pane::-webkit-scrollbar,
.markdown-textarea::-webkit-scrollbar {
  width: 8px;
}

.preview-pane::-webkit-scrollbar-track,
.markdown-textarea::-webkit-scrollbar-track {
  background: transparent;
}

.preview-pane::-webkit-scrollbar-thumb,
.markdown-textarea::-webkit-scrollbar-thumb {
  background: var(--hn-border-default);
  border-radius: 4px;
}

.preview-pane::-webkit-scrollbar-thumb:hover,
.markdown-textarea::-webkit-scrollbar-thumb:hover {
  background: var(--hn-border-strong);
}

/* Saving Overlay */
.saving-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 20, 25, 0.95);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.saving-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.saving-content ion-spinner {
  width: 36px;
  height: 36px;
  --color: var(--hn-teal);
}

.saving-content h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--hn-text-primary);
}

/* Execution Steps */
.execution-steps {
  background: var(--hn-bg-surface);
  border-radius: 10px;
  padding: 16px;
  border: 1px solid var(--hn-border-default);
  min-width: 280px;
}

.step {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
  border-bottom: 1px solid var(--hn-border-subtle);
}

.step:last-child {
  border-bottom: none;
}

.step.running {
  color: var(--hn-teal);
}

.step.completed {
  color: var(--hn-green);
}

.step-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.step-icon ion-spinner {
  width: 16px;
  height: 16px;
  --color: var(--hn-teal);
}

.step-icon ion-icon {
  font-size: 16px;
}

.step-label {
  font-weight: 500;
}

.step-detail {
  color: var(--hn-text-faint);
  font-size: 0.75rem;
  margin-left: auto;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step.completed .step-detail {
  color: var(--hn-green-light);
}
</style>

