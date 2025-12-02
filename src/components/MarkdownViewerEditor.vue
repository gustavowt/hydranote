<template>
  <ion-modal :is-open="isOpen" @didDismiss="handleClose" class="markdown-modal">
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button @click="handleClose">
            <ion-icon slot="icon-only" :icon="closeOutline" />
          </ion-button>
        </ion-buttons>
        <ion-title>{{ fileName }}</ion-title>
        <ion-buttons slot="end">
          <ion-button v-if="!isEditing" @click="toggleEdit" :disabled="!canEdit">
            <ion-icon slot="icon-only" :icon="createOutline" />
          </ion-button>
          <ion-button v-else @click="saveChanges" :disabled="!hasChanges">
            <ion-icon slot="icon-only" :icon="saveOutline" />
          </ion-button>
          <ion-button @click="downloadFile">
            <ion-icon slot="icon-only" :icon="downloadOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar v-if="canEdit" class="mode-toggle">
        <ion-segment v-model="viewMode" @ionChange="handleModeChange">
          <ion-segment-button value="view">
            <ion-icon :icon="eyeOutline" />
            <ion-label>View</ion-label>
          </ion-segment-button>
          <ion-segment-button value="edit">
            <ion-icon :icon="codeOutline" />
            <ion-label>Edit</ion-label>
          </ion-segment-button>
          <ion-segment-button value="split">
            <ion-icon :icon="gridOutline" />
            <ion-label>Split</ion-label>
          </ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content class="markdown-content">
      <!-- Loading State -->
      <div v-if="loading" class="loading-state">
        <ion-spinner name="crescent" />
        <p>Loading file...</p>
      </div>

      <!-- View Mode -->
      <div 
        v-else-if="viewMode === 'view'" 
        class="markdown-view"
        v-html="renderedContent"
      ></div>

      <!-- Edit Mode -->
      <div v-else-if="viewMode === 'edit'" class="editor-container">
        <textarea 
          ref="editorRef"
          v-model="editContent"
          class="markdown-editor"
          placeholder="Write your markdown here..."
          @input="handleInput"
        ></textarea>
      </div>

      <!-- Split Mode -->
      <div v-else-if="viewMode === 'split'" class="split-container">
        <div class="split-editor">
          <textarea 
            ref="splitEditorRef"
            v-model="editContent"
            class="markdown-editor"
            placeholder="Write your markdown here..."
            @input="handleInput"
          ></textarea>
        </div>
        <div class="split-preview markdown-view" v-html="renderedContent"></div>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
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
  IonButtons,
  IonButton,
  IonIcon,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSpinner,
} from '@ionic/vue';
import {
  closeOutline,
  createOutline,
  saveOutline,
  downloadOutline,
  eyeOutline,
  codeOutline,
  gridOutline,
} from 'ionicons/icons';

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

interface Props {
  isOpen: boolean;
  fileName: string;
  content: string;
  canEdit?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  canEdit: true,
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', content: string): void;
}>();

const loading = ref(false);
const viewMode = ref<'view' | 'edit' | 'split'>('view');
const editContent = ref('');
const originalContent = ref('');
const editorRef = ref<HTMLTextAreaElement | null>(null);
const splitEditorRef = ref<HTMLTextAreaElement | null>(null);

const isEditing = computed(() => viewMode.value !== 'view');
const hasChanges = computed(() => editContent.value !== originalContent.value);

const renderedContent = computed(() => {
  const content = viewMode.value === 'view' ? props.content : editContent.value;
  return marked.parse(content || '', { async: false }) as string;
});

// Watch for content changes from props
watch(() => props.content, (newContent) => {
  editContent.value = newContent;
  originalContent.value = newContent;
}, { immediate: true });

// Watch for modal open to reset state
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    viewMode.value = 'view';
    editContent.value = props.content;
    originalContent.value = props.content;
  }
});

function handleClose() {
  emit('close');
}

function toggleEdit() {
  viewMode.value = viewMode.value === 'view' ? 'edit' : 'view';
}

function handleModeChange(event: CustomEvent) {
  viewMode.value = event.detail.value;
}

function handleInput() {
  // Auto-resize could be added here
}

function saveChanges() {
  emit('save', editContent.value);
  originalContent.value = editContent.value;
  viewMode.value = 'view';
}

function downloadFile() {
  const content = viewMode.value === 'view' ? props.content : editContent.value;
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = props.fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
</script>

<style scoped>
.markdown-modal {
  --width: 100%;
  --height: 100%;
  --background: #1a1a2e;
}

.markdown-modal ion-toolbar {
  --background: #16162a;
  --border-color: #2d2d44;
}

.markdown-modal ion-title {
  font-size: 1rem;
  font-weight: 500;
}

.mode-toggle {
  --padding-top: 0;
  --padding-bottom: 8px;
}

.mode-toggle ion-segment {
  --background: #2d2d44;
  max-width: 300px;
  margin: 0 auto;
}

.mode-toggle ion-segment-button {
  --color: #8b8b9e;
  --color-checked: #6366f1;
  --indicator-color: #3d3d5c;
  font-size: 0.75rem;
}

.mode-toggle ion-segment-button ion-icon {
  font-size: 1rem;
  margin-bottom: 2px;
}

.markdown-content {
  --background: #1a1a2e;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: #8b8b9e;
}

/* View Mode Styles */
.markdown-view {
  padding: 20px 24px;
  color: #e2e2e8;
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

.markdown-view :deep(h1) { font-size: 2em; border-bottom: 1px solid #3d3d5c; padding-bottom: 0.3em; }
.markdown-view :deep(h2) { font-size: 1.5em; border-bottom: 1px solid #3d3d5c; padding-bottom: 0.3em; }
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
  background: rgba(99, 102, 241, 0.15);
  padding: 0.2em 0.5em;
  border-radius: 4px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.9em;
  color: #c4b5fd;
}

.markdown-view :deep(pre) {
  background: #0d1117;
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
  border-left: 4px solid #6366f1;
  margin: 1.2em 0;
  padding: 0.6em 0 0.6em 1.2em;
  color: #a5a5c0;
  background: rgba(99, 102, 241, 0.08);
  border-radius: 0 8px 8px 0;
}

.markdown-view :deep(a) {
  color: #818cf8;
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
  color: #c4c4d4;
}

.markdown-view :deep(hr) {
  border: none;
  border-top: 1px solid #3d3d5c;
  margin: 2em 0;
}

.markdown-view :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1.2em 0;
}

.markdown-view :deep(th),
.markdown-view :deep(td) {
  border: 1px solid #3d3d5c;
  padding: 10px 14px;
  text-align: left;
}

.markdown-view :deep(th) {
  background: rgba(99, 102, 241, 0.12);
  font-weight: 600;
  color: #ffffff;
}

.markdown-view :deep(tr:nth-child(even)) {
  background: rgba(255, 255, 255, 0.02);
}

.markdown-view :deep(img) {
  max-width: 100%;
  border-radius: 8px;
  margin: 1em 0;
}

/* Editor Styles */
.editor-container {
  height: 100%;
  padding: 0;
}

.markdown-editor {
  width: 100%;
  height: 100%;
  background: #0d1117;
  color: #e6edf3;
  border: none;
  padding: 20px 24px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.9rem;
  line-height: 1.6;
  resize: none;
  outline: none;
}

.markdown-editor::placeholder {
  color: #484f58;
}

/* Split Mode Styles */
.split-container {
  display: flex;
  height: 100%;
}

.split-editor {
  flex: 1;
  border-right: 1px solid #3d3d5c;
}

.split-editor .markdown-editor {
  height: 100%;
}

.split-preview {
  flex: 1;
  overflow-y: auto;
}
</style>

