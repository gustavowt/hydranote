<template>
  <ion-modal :is-open="isOpen" @didDismiss="handleClose" class="add-note-modal">
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button @click="handleClose" :disabled="saving">
            <ion-icon slot="icon-only" :icon="closeOutline" />
          </ion-button>
        </ion-buttons>
        <ion-title>New Note</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="handleSave" :disabled="!canSave || saving" color="primary">
            <span>Save</span>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar v-if="!saving" class="mode-toggle">
        <ion-segment v-model="viewMode">
          <ion-segment-button value="edit">
            <ion-icon :icon="codeOutline" />
            <ion-label>Write</ion-label>
          </ion-segment-button>
          <ion-segment-button value="split">
            <ion-icon :icon="gridOutline" />
            <ion-label>Split</ion-label>
          </ion-segment-button>
          <ion-segment-button value="preview">
            <ion-icon :icon="eyeOutline" />
            <ion-label>Preview</ion-label>
          </ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content class="add-note-content">
      <!-- Saving State with Execution Log -->
      <div v-if="saving || pendingConfirmation" class="saving-state">
        <div class="saving-header">
          <ion-spinner v-if="!pendingConfirmation" name="crescent" />
          <ion-icon v-else :icon="helpCircleOutline" class="confirm-icon" />
          <h2>{{ pendingConfirmation ? 'Confirm Project' : 'Saving Note' }}</h2>
        </div>
        <div class="execution-steps">
          <div 
            v-for="step in executionSteps" 
            :key="step.id" 
            :class="['step', step.status]"
          >
            <span class="step-icon">
              <ion-spinner v-if="step.status === 'running'" name="dots" />
              <ion-icon v-else-if="step.status === 'completed'" :icon="checkmarkCircle" />
              <ion-icon v-else-if="step.status === 'error'" :icon="closeCircle" />
              <ion-icon v-else-if="step.status === 'waiting'" :icon="pauseCircleOutline" />
              <ion-icon v-else :icon="ellipseOutline" />
            </span>
            <span class="step-label">{{ step.label }}</span>
            <span v-if="step.detail" class="step-detail">{{ step.detail }}</span>
          </div>
        </div>

        <!-- Inline Project Confirmation -->
        <div v-if="pendingConfirmation" class="inline-confirmation">
          <p class="confirm-message">
            Create new project <strong>"{{ pendingConfirmation.proposedProjectName }}"</strong>?
          </p>
          <p v-if="pendingConfirmation.reasoning" class="confirm-reasoning">
            {{ pendingConfirmation.reasoning }}
          </p>
          <div class="confirm-buttons">
            <ion-button size="small" @click="confirmNewProject" color="success">
              <ion-icon slot="start" :icon="checkmarkOutline" />
              Yes, create
            </ion-button>
            <ion-button size="small" fill="outline" @click="showProjectPicker = true" v-if="availableProjects.length > 0">
              <ion-icon slot="start" :icon="folderOutline" />
              Choose existing
            </ion-button>
            <ion-button size="small" fill="clear" @click="cancelConfirmation" color="medium">
              Cancel
            </ion-button>
          </div>
          
          <!-- Project picker dropdown -->
          <div v-if="showProjectPicker" class="project-picker">
            <p class="picker-label">Select a project:</p>
            <ion-button 
              v-for="project in availableProjects" 
              :key="project.id"
              size="small"
              fill="outline"
              expand="block"
              @click="selectExistingProject(project.id)"
              class="project-option"
            >
              {{ project.name }}
            </ion-button>
          </div>
        </div>
      </div>

      <!-- Edit Mode -->
      <div v-else-if="viewMode === 'edit'" class="editor-container">
        <textarea
          ref="editorRef"
          v-model="noteContent"
          class="markdown-editor"
          placeholder="Start writing your note in Markdown..."
          @keydown="handleKeydown"
        ></textarea>
      </div>

      <!-- Split Mode -->
      <div v-else-if="viewMode === 'split'" class="split-container">
        <div class="split-editor">
          <textarea
            ref="splitEditorRef"
            v-model="noteContent"
            class="markdown-editor"
            placeholder="Start writing your note in Markdown..."
            @keydown="handleKeydown"
          ></textarea>
        </div>
        <div class="split-preview markdown-view" v-html="renderedContent"></div>
      </div>

      <!-- Preview Mode -->
      <div v-else class="preview-container">
        <div v-if="noteContent" class="markdown-view" v-html="renderedContent"></div>
        <div v-else class="empty-preview">
          <ion-icon :icon="documentTextOutline" />
          <p>Nothing to preview yet</p>
        </div>
      </div>
    </ion-content>

    <!-- Tags Footer (hidden during saving) -->
    <ion-footer v-if="!saving">
      <ion-toolbar class="tags-toolbar">
        <div class="tags-container">
          <ion-icon :icon="pricetagsOutline" class="tags-icon" />
          <div class="tags-input-wrapper">
            <ion-chip v-for="tag in tags" :key="tag" @click="removeTag(tag)">
              <ion-label>{{ tag }}</ion-label>
              <ion-icon :icon="closeCircleOutline" />
            </ion-chip>
            <input
              v-model="tagInput"
              class="tag-input"
              placeholder="Add tags..."
              @keydown.enter.prevent="addTag"
              @keydown.comma.prevent="addTag"
              @keydown.backspace="handleBackspace"
            />
          </div>
        </div>
      </ion-toolbar>
    </ion-footer>
  </ion-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, type Ref } from 'vue';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonFooter,
  IonButtons,
  IonButton,
  IonIcon,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSpinner,
  IonChip,
} from '@ionic/vue';
import {
  closeOutline,
  codeOutline,
  gridOutline,
  eyeOutline,
  documentTextOutline,
  pricetagsOutline,
  closeCircleOutline,
  checkmarkCircle,
  closeCircle,
  ellipseOutline,
  helpCircleOutline,
  checkmarkOutline,
  folderOutline,
  pauseCircleOutline,
} from 'ionicons/icons';
import type { NoteExecutionStep } from '@/services';

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

interface Project {
  id: string;
  name: string;
}

interface PendingConfirmation {
  proposedProjectName: string;
  proposedProjectDescription?: string;
  reasoning?: string;
}

interface Props {
  isOpen: boolean;
  availableProjects?: Project[];
}

const props = withDefaults(defineProps<Props>(), {
  availableProjects: () => [],
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', content: string, tags: string[], onProgress: (steps: NoteExecutionStep[]) => void): void;
  (e: 'confirmNewProject', content: string, tags: string[], projectName: string, projectDescription?: string): void;
  (e: 'selectExistingProject', content: string, tags: string[], projectId: string): void;
}>();

const viewMode = ref<'edit' | 'split' | 'preview'>('edit');
const noteContent = ref('');
const tags = ref<string[]>([]);
const tagInput = ref('');
const saving = ref(false);
const editorRef = ref<HTMLTextAreaElement | null>(null);
const splitEditorRef = ref<HTMLTextAreaElement | null>(null);
const executionSteps = ref<NoteExecutionStep[]>([]);

// Inline confirmation state
const pendingConfirmation = ref<PendingConfirmation | null>(null);
const showProjectPicker = ref(false);

const availableProjects = computed(() => props.availableProjects || []);

const canSave = computed(() => noteContent.value.trim().length > 0);

const renderedContent = computed(() => {
  return marked.parse(noteContent.value || '', { async: false }) as string;
});

// Reset state when modal opens
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    viewMode.value = 'edit';
    noteContent.value = '';
    tags.value = [];
    tagInput.value = '';
    saving.value = false;
    executionSteps.value = [];
    pendingConfirmation.value = null;
    showProjectPicker.value = false;
    
    // Focus editor on next tick
    nextTick(() => {
      editorRef.value?.focus();
    });
  }
});

function handleClose() {
  if (saving.value) return;
  emit('close');
}

function handleSave() {
  if (!canSave.value || saving.value) return;
  saving.value = true;
  executionSteps.value = [];
  
  const onProgress = (steps: NoteExecutionStep[]) => {
    executionSteps.value = [...steps];
  };
  
  emit('save', noteContent.value, tags.value, onProgress);
}

function handleKeydown(event: KeyboardEvent) {
  // Cmd/Ctrl + Enter to save
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    handleSave();
    return;
  }
  
  // Tab to insert spaces
  if (event.key === 'Tab') {
    event.preventDefault();
    const textarea = event.target as HTMLTextAreaElement;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const spaces = '  ';
    
    noteContent.value = noteContent.value.substring(0, start) + spaces + noteContent.value.substring(end);
    
    nextTick(() => {
      textarea.selectionStart = textarea.selectionEnd = start + spaces.length;
    });
  }
}

function addTag() {
  const tag = tagInput.value.trim().replace(/,/g, '');
  if (tag && !tags.value.includes(tag)) {
    tags.value.push(tag);
  }
  tagInput.value = '';
}

function removeTag(tag: string) {
  tags.value = tags.value.filter(t => t !== tag);
}

function handleBackspace() {
  if (tagInput.value === '' && tags.value.length > 0) {
    tags.value.pop();
  }
}

// Confirmation handling functions
function confirmNewProject() {
  if (!pendingConfirmation.value) return;
  
  // Reset confirmation state and continue saving
  const confirmation = pendingConfirmation.value;
  pendingConfirmation.value = null;
  showProjectPicker.value = false;
  saving.value = true;
  
  emit('confirmNewProject', noteContent.value, tags.value, confirmation.proposedProjectName, confirmation.proposedProjectDescription);
}

function selectExistingProject(projectId: string) {
  pendingConfirmation.value = null;
  showProjectPicker.value = false;
  saving.value = true;
  
  emit('selectExistingProject', noteContent.value, tags.value, projectId);
}

function cancelConfirmation() {
  pendingConfirmation.value = null;
  showProjectPicker.value = false;
  saving.value = false;
  executionSteps.value = [];
}

// Show pending confirmation (called from parent)
function showConfirmation(confirmation: PendingConfirmation, steps: NoteExecutionStep[]) {
  saving.value = false;
  pendingConfirmation.value = confirmation;
  executionSteps.value = steps;
}

// Expose method to reset saving state (called from parent on error)
function resetSaving() {
  saving.value = false;
  pendingConfirmation.value = null;
  showProjectPicker.value = false;
}

defineExpose({ resetSaving, showConfirmation, executionSteps, saving });
</script>

<style scoped>
.add-note-modal {
  --width: 100%;
  --height: 100%;
  --background: #0d1117;
}

.add-note-modal ion-toolbar {
  --background: #161b22;
  --border-color: #30363d;
}

.add-note-modal ion-title {
  font-size: 1rem;
  font-weight: 600;
  color: #e6edf3;
}

.add-note-modal ion-button {
  --color: #8b949e;
}

.add-note-modal ion-button[color="primary"] {
  --color: #58a6ff;
  font-weight: 600;
}

.mode-toggle {
  --padding-top: 0;
  --padding-bottom: 8px;
}

.mode-toggle ion-segment {
  --background: #21262d;
  max-width: 280px;
  margin: 0 auto;
  border-radius: 8px;
}

.mode-toggle ion-segment-button {
  --color: #8b949e;
  --color-checked: #58a6ff;
  --indicator-color: #30363d;
  font-size: 0.75rem;
  min-height: 36px;
}

.mode-toggle ion-segment-button ion-icon {
  font-size: 1rem;
  margin-bottom: 2px;
}

.add-note-content {
  --background: #0d1117;
}

/* Editor Styles */
.editor-container,
.split-editor {
  height: 100%;
}

.markdown-editor {
  width: 100%;
  height: 100%;
  background: #0d1117;
  color: #e6edf3;
  border: none;
  padding: 20px 24px;
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace;
  font-size: 0.95rem;
  line-height: 1.7;
  resize: none;
  outline: none;
  caret-color: #58a6ff;
}

.markdown-editor::placeholder {
  color: #484f58;
  font-style: italic;
}

/* Split Mode */
.split-container {
  display: flex;
  height: 100%;
}

.split-editor {
  flex: 1;
  border-right: 1px solid #30363d;
}

.split-preview {
  flex: 1;
  overflow-y: auto;
  background: #0d1117;
}

/* Preview Mode */
.preview-container {
  height: 100%;
  overflow-y: auto;
}

.empty-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #484f58;
}

.empty-preview ion-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.6;
}

.empty-preview p {
  margin: 0;
  font-size: 0.95rem;
}

/* Markdown View Styles */
.markdown-view {
  padding: 20px 24px;
  color: #e6edf3;
  line-height: 1.7;
  max-width: 800px;
  margin: 0 auto;
}

.markdown-view :deep(h1),
.markdown-view :deep(h2),
.markdown-view :deep(h3),
.markdown-view :deep(h4),
.markdown-view :deep(h5),
.markdown-view :deep(h6) {
  color: #ffffff;
  font-weight: 600;
  margin: 1.5em 0 0.6em;
  line-height: 1.3;
}

.markdown-view :deep(h1) { font-size: 2em; border-bottom: 1px solid #30363d; padding-bottom: 0.3em; }
.markdown-view :deep(h2) { font-size: 1.5em; border-bottom: 1px solid #30363d; padding-bottom: 0.3em; }
.markdown-view :deep(h3) { font-size: 1.25em; }
.markdown-view :deep(h4) { font-size: 1em; }

.markdown-view :deep(p) {
  margin: 1em 0;
}

.markdown-view :deep(ul),
.markdown-view :deep(ol) {
  margin: 1em 0;
  padding-left: 2em;
}

.markdown-view :deep(li) {
  margin: 0.4em 0;
}

.markdown-view :deep(code) {
  background: rgba(110, 118, 129, 0.2);
  padding: 0.2em 0.5em;
  border-radius: 6px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.9em;
  color: #79c0ff;
}

.markdown-view :deep(pre) {
  background: #161b22;
  padding: 16px 20px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 1.2em 0;
  border: 1px solid #30363d;
}

.markdown-view :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.85em;
  line-height: 1.6;
  color: #e6edf3;
}

.markdown-view :deep(blockquote) {
  border-left: 4px solid #3fb950;
  margin: 1.2em 0;
  padding: 0.6em 0 0.6em 1.2em;
  color: #8b949e;
  background: rgba(63, 185, 80, 0.08);
  border-radius: 0 8px 8px 0;
}

.markdown-view :deep(a) {
  color: #58a6ff;
  text-decoration: none;
}

.markdown-view :deep(a:hover) {
  text-decoration: underline;
}

.markdown-view :deep(strong) {
  font-weight: 600;
  color: #ffffff;
}

.markdown-view :deep(em) {
  font-style: italic;
  color: #c9d1d9;
}

.markdown-view :deep(hr) {
  border: none;
  border-top: 1px solid #30363d;
  margin: 2em 0;
}

.markdown-view :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1.2em 0;
}

.markdown-view :deep(th),
.markdown-view :deep(td) {
  border: 1px solid #30363d;
  padding: 10px 14px;
  text-align: left;
}

.markdown-view :deep(th) {
  background: rgba(110, 118, 129, 0.15);
  font-weight: 600;
  color: #ffffff;
}

.markdown-view :deep(tr:nth-child(even)) {
  background: rgba(255, 255, 255, 0.02);
}

/* Tags Footer */
ion-footer ion-toolbar {
  --background: #161b22;
  --border-color: #30363d;
  --padding-top: 8px;
  --padding-bottom: 8px;
  --min-height: 48px;
}

.tags-container {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  width: 100%;
}

.tags-icon {
  font-size: 18px;
  color: #8b949e;
  flex-shrink: 0;
}

.tags-input-wrapper {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-height: 32px;
}

.tags-input-wrapper ion-chip {
  --background: #21262d;
  --color: #c9d1d9;
  margin: 0;
  height: 26px;
  font-size: 0.8rem;
  cursor: pointer;
}

.tags-input-wrapper ion-chip:hover {
  --background: #30363d;
}

.tags-input-wrapper ion-chip ion-icon {
  font-size: 14px;
  color: #8b949e;
}

.tag-input {
  flex: 1;
  min-width: 100px;
  background: transparent;
  border: none;
  color: #e6edf3;
  font-size: 0.9rem;
  outline: none;
  padding: 4px 0;
}

.tag-input::placeholder {
  color: #484f58;
}

/* Spinner */
ion-spinner {
  width: 18px;
  height: 18px;
  --color: #58a6ff;
}

/* Saving State */
.saving-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px 24px;
}

.saving-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 32px;
}

.saving-header ion-spinner {
  width: 40px;
  height: 40px;
  margin-bottom: 16px;
}

.saving-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #e6edf3;
}

/* Execution Steps */
.execution-steps {
  width: 100%;
  max-width: 360px;
  background: #161b22;
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #30363d;
}

.step {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  font-size: 0.9rem;
  color: #8b949e;
  border-bottom: 1px solid #21262d;
}

.step:last-child {
  border-bottom: none;
}

.step.running {
  color: #58a6ff;
}

.step.completed {
  color: #3fb950;
}

.step.error {
  color: #f85149;
}

.step-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.step-icon ion-spinner {
  width: 18px;
  height: 18px;
  --color: #58a6ff;
}

.step-icon ion-icon {
  font-size: 18px;
}

.step-label {
  font-weight: 500;
  flex-shrink: 0;
}

.step-detail {
  color: #484f58;
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}

.step.completed .step-detail {
  color: #7ee787;
}

.step.waiting {
  color: #f0883e;
}

/* Inline Confirmation Styles */
.saving-header .confirm-icon {
  font-size: 40px;
  color: #f0883e;
  margin-bottom: 16px;
}

.inline-confirmation {
  width: 100%;
  max-width: 360px;
  margin-top: 20px;
  padding: 16px;
  background: #21262d;
  border-radius: 12px;
  border: 1px solid #f0883e40;
}

.confirm-message {
  margin: 0 0 8px;
  font-size: 0.95rem;
  color: #e6edf3;
  text-align: center;
}

.confirm-message strong {
  color: #58a6ff;
}

.confirm-reasoning {
  margin: 0 0 16px;
  font-size: 0.8rem;
  color: #8b949e;
  text-align: center;
  font-style: italic;
}

.confirm-buttons {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}

.confirm-buttons ion-button {
  --border-radius: 8px;
  font-size: 0.85rem;
}

.project-picker {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #30363d;
}

.picker-label {
  margin: 0 0 8px;
  font-size: 0.8rem;
  color: #8b949e;
  text-align: center;
}

.project-option {
  margin-bottom: 6px;
  --border-color: #30363d;
  --color: #c9d1d9;
}

.project-option:last-child {
  margin-bottom: 0;
}
</style>

