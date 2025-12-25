<template>
  <div class="markdown-editor-container">
    <!-- Editor Header -->
    <div class="editor-header">
      <div class="header-left">
        <ion-icon :icon="documentTextOutline" class="header-icon" />
        <!-- Rename mode: editable input -->
        <div v-if="isRenaming && currentFile" class="rename-container">
          <input
            ref="renameInputRef"
            v-model="newFileName"
            class="rename-input"
            @keydown.enter="handleSaveRename"
            @keydown.escape="handleCancelRename"
          />
          <ion-button 
            fill="solid" 
            size="small" 
            class="rename-save-btn"
            @click="handleSaveRename"
            :disabled="!newFileName.trim() || newFileName === getFileNameWithoutExtension()"
          >
            <ion-icon slot="icon-only" :icon="checkmarkOutline" />
          </ion-button>
          <ion-button 
            fill="clear" 
            size="small" 
            class="rename-cancel-btn"
            @click="handleCancelRename"
          >
            <ion-icon slot="icon-only" :icon="closeOutline" />
          </ion-button>
        </div>
        <!-- Normal mode: static title -->
        <template v-else>
          <span class="header-title" :title="currentFile?.name || 'New Note'">
            {{ displayFileName }}
          </span>
          <span v-if="hasChanges" class="unsaved-indicator">•</span>
        </template>
      </div>
      <div class="header-actions">
        <!-- Version Navigation -->
        <div v-if="currentFile && totalVersions > 0" class="version-nav">
          <button 
            class="version-nav-btn"
            :disabled="!canGoBack || navigatingVersion"
            @click="handleVersionBack"
            :title="canGoBack ? `Go to version ${currentVersionIndex - 1}` : 'No older version'"
          >
            <ion-icon :icon="chevronBackOutline" />
          </button>
          <span class="version-indicator" :class="{ 'viewing-old': isViewingOldVersion }">
            <template v-if="isViewingOldVersion">
              v{{ currentVersionIndex }}/{{ totalVersions }}
            </template>
            <template v-else>
              <ion-icon :icon="timeOutline" class="version-icon" />
              {{ totalVersions }}
            </template>
          </span>
          <button 
            class="version-nav-btn"
            :disabled="!canGoForward || navigatingVersion"
            @click="handleVersionForward"
            :title="canGoForward ? `Go to version ${currentVersionIndex + 1}` : 'At latest version'"
          >
            <ion-icon :icon="chevronForwardOutline" />
          </button>
        </div>
        <div class="save-btn-wrapper">
          <ion-button 
            fill="solid" 
            size="small" 
            class="save-btn"
            :class="{ visible: hasChanges || isViewingOldVersion }"
            @click="handleSave"
            :disabled="saving || (!hasChanges && !isViewingOldVersion)"
          >
            <ion-icon slot="start" :icon="saveOutline" />
            {{ isViewingOldVersion ? 'Restore' : 'Save' }}
          </ion-button>
        </div>
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
        <!-- 3-dots Actions Menu -->
        <button 
          v-if="currentFile"
          class="actions-menu-btn"
          @click="showActionsMenu = true"
          id="editor-actions-trigger"
          title="More actions"
        >
          <ion-icon :icon="ellipsisVertical" />
        </button>
        <ion-popover
          :is-open="showActionsMenu"
          @didDismiss="showActionsMenu = false"
          trigger="editor-actions-trigger"
          trigger-action="click"
          side="bottom"
          alignment="end"
        >
          <ion-content class="actions-popover-content">
            <ion-list lines="none">
              <ion-item button @click="handleOpenFormatModal" :detail="false">
                <ion-icon :icon="sparklesOutline" slot="start" />
                <ion-label>Run AI Formatting</ion-label>
              </ion-item>
              <ion-item button @click="handleStartRename" :detail="false">
                <ion-icon :icon="pencilOutline" slot="start" />
                <ion-label>Rename</ion-label>
              </ion-item>
              <ion-item button @click="handleOpenVersionHistory" :detail="false">
                <ion-icon :icon="timeOutline" slot="start" />
                <ion-label>Version History</ion-label>
              </ion-item>
            </ion-list>
          </ion-content>
        </ion-popover>
      </div>
    </div>

    <!-- AI Formatting Modal -->
    <ion-modal :is-open="showFormatModal" @didDismiss="showFormatModal = false">
      <ion-header>
        <ion-toolbar>
          <ion-buttons slot="start">
            <ion-button @click="showFormatModal = false">Cancel</ion-button>
          </ion-buttons>
          <ion-title>AI Formatting</ion-title>
          <ion-buttons slot="end">
            <ion-button :strong="true" @click="handleRunFormatting" :disabled="formatting">
              {{ formatting ? 'Formatting...' : 'Format' }}
            </ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding format-modal-content">
        <p class="format-description">
          AI will format and improve your note's structure. Add any specific instructions below (optional):
        </p>
        <ion-textarea
          v-model="formatInstructions"
          placeholder="E.g., 'Use bullet points for lists', 'Add a summary section', 'Convert to formal tone'..."
          :rows="5"
          class="format-textarea"
        />
        <p class="format-note">
          <ion-icon :icon="informationCircleOutline" />
          Your default formatting settings from Settings will also be applied.
        </p>
      </ion-content>
    </ion-modal>

    <!-- Version History Modal -->
    <ion-modal :is-open="showVersionHistoryModal" @didDismiss="showVersionHistoryModal = false">
      <ion-header>
        <ion-toolbar>
          <ion-buttons slot="start">
            <ion-button @click="showVersionHistoryModal = false">Close</ion-button>
          </ion-buttons>
          <ion-title>Version History</ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding version-history-content">
        <div v-if="loadingVersions" class="loading-versions">
          <IonSpinner name="crescent" />
          <p>Loading version history...</p>
        </div>
        <div v-else-if="versionHistory.length === 0" class="no-versions">
          <ion-icon :icon="timeOutline" class="empty-icon" />
          <p>No version history available.</p>
          <p class="hint">Versions are created when you save, update, or format the file.</p>
        </div>
        <ion-list v-else lines="full" class="version-list">
          <ion-item 
            v-for="version in versionHistory" 
            :key="version.id" 
            button 
            @click="handlePreviewVersion(version)"
            :class="{ 'selected-version': selectedVersionId === version.id }"
          >
            <ion-icon 
              :icon="getVersionIcon(version.source)" 
              slot="start" 
              :class="['version-icon', version.source]"
            />
            <ion-label>
              <h3>Version {{ version.versionNumber }}</h3>
              <p>{{ formatVersionDate(version.createdAt) }}</p>
              <p class="version-source">{{ getVersionSourceLabel(version.source) }}</p>
            </ion-label>
            <ion-button 
              slot="end" 
              fill="outline" 
              size="small"
              @click.stop="handleRestoreVersion(version)"
              :disabled="restoringVersion"
            >
              {{ restoringVersion && selectedVersionId === version.id ? 'Restoring...' : 'Restore' }}
            </ion-button>
          </ion-item>
        </ion-list>
      </ion-content>
    </ion-modal>

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
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import mermaid from 'mermaid';
import {
  IonIcon,
  IonButton,
  IonSpinner,
  IonPopover,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonTextarea,
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
  ellipsisVertical,
  sparklesOutline,
  pencilOutline,
  checkmarkOutline,
  closeOutline,
  informationCircleOutline,
  timeOutline,
  createOutline,
  refreshOutline,
  colorWandOutline,
  arrowUndoOutline,
  chevronBackOutline,
  chevronForwardOutline,
} from 'ionicons/icons';
import type { Project, ProjectFile, GlobalAddNoteResult, FileVersionMeta, VersionSource } from '@/types';
import type { NoteExecutionStep } from '@/services';
import { 
  globalAddNote, 
  formatNote, 
  getNoteFormatInstructions, 
  createFormatVersion,
  getVersionHistory,
  getVersionContent,
  createRestoreVersion,
} from '@/services';

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
  (e: 'rename', fileId: string, newName: string): void;
}>();

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  fontFamily: 'inherit',
});

// Custom renderer for mermaid code blocks
const mermaidRenderer = {
  code(token: { text: string; lang?: string }): string | false {
    if (token.lang === 'mermaid') {
      const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
      // Encode the mermaid code to preserve special characters
      const encodedCode = btoa(encodeURIComponent(token.text));
      return `<div class="mermaid-diagram" data-mermaid-id="${id}" data-mermaid-code="${encodedCode}"></div>`;
    }
    return false; // Use default renderer for other languages
  }
};

// Configure marked with highlight.js and mermaid support
const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code: string, lang: string) {
      // Skip mermaid blocks - they're handled by custom renderer
      if (lang === 'mermaid') return code;
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

// Apply mermaid renderer
marked.use({ renderer: mermaidRenderer });

const content = ref('');
const originalContent = ref('');
const viewMode = ref<'edit' | 'split' | 'view'>('edit');
const saving = ref(false);
const editorRef = ref<HTMLTextAreaElement | null>(null);
const splitEditorRef = ref<HTMLTextAreaElement | null>(null);
const executionSteps = ref<NoteExecutionStep[]>([]);

// Actions menu state
const showActionsMenu = ref(false);

// AI Formatting state
const showFormatModal = ref(false);
const formatInstructions = ref('');
const formatting = ref(false);

// Rename state
const isRenaming = ref(false);
const newFileName = ref('');
const renameInputRef = ref<HTMLInputElement | null>(null);

// Version history state
const showVersionHistoryModal = ref(false);
const versionHistory = ref<FileVersionMeta[]>([]);
const loadingVersions = ref(false);
const selectedVersionId = ref<string | null>(null);
const restoringVersion = ref(false);

// Version navigation state
const totalVersions = ref(0);
const currentVersionIndex = ref(0); // 0 means viewing current/latest
const navigatingVersion = ref(false);
const cachedVersions = ref<Map<number, string>>(new Map()); // Cache for version content

const hasChanges = computed(() => content.value !== originalContent.value);
const isNewNote = computed(() => !props.currentFile);

// Version navigation computed
const isViewingOldVersion = computed(() => currentVersionIndex.value > 0 && currentVersionIndex.value < totalVersions.value);
const canGoBack = computed(() => currentVersionIndex.value < totalVersions.value);
const canGoForward = computed(() => currentVersionIndex.value > 0);

// Mermaid rendering with debounce
let mermaidRenderTimeout: ReturnType<typeof setTimeout> | null = null;

async function renderMermaidDiagrams() {
  await nextTick();
  try {
    const diagrams = Array.from(document.querySelectorAll('.mermaid-diagram:not([data-processed])'));
    if (diagrams.length === 0) return;
    
    for (const diagram of diagrams) {
      const id = diagram.getAttribute('data-mermaid-id') || `mermaid-${Math.random().toString(36).substring(2, 9)}`;
      const encodedCode = diagram.getAttribute('data-mermaid-code') || '';
      if (!encodedCode) {
        diagram.setAttribute('data-processed', 'true');
        continue;
      }
      // Decode the mermaid code
      const code = decodeURIComponent(atob(encodedCode));
      try {
        const { svg } = await mermaid.render(id, code);
        diagram.innerHTML = svg;
        diagram.setAttribute('data-processed', 'true');
      } catch (err) {
        // Invalid mermaid syntax - show error state with details
        const errorMsg = err instanceof Error ? err.message : 'Invalid diagram syntax';
        diagram.innerHTML = `<div class="mermaid-error">${errorMsg}</div>`;
        diagram.setAttribute('data-processed', 'true');
      }
    }
  } catch {
    // Silently handle errors
  }
}

function debouncedRenderMermaid() {
  if (mermaidRenderTimeout) clearTimeout(mermaidRenderTimeout);
  mermaidRenderTimeout = setTimeout(renderMermaidDiagrams, 300);
}

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

// Watch for content changes to render mermaid diagrams
watch(renderedContent, () => {
  if (viewMode.value === 'view' || viewMode.value === 'split') {
    debouncedRenderMermaid();
  }
});

// Watch for view mode changes to render mermaid diagrams
watch(viewMode, (newMode) => {
  if (newMode === 'view' || newMode === 'split') {
    debouncedRenderMermaid();
  }
});

function handleInput() {
  emit('content-change', content.value);
}

async function handleSave() {
  if (!content.value.trim()) return;
  
  if (props.currentFile) {
    // Save existing file (or restore old version)
    saving.value = true;
    try {
      // If viewing old version, create a restore version first
      if (isViewingOldVersion.value) {
        await createRestoreVersion(props.currentFile.id, originalContent.value);
      }
      
      emit('save', content.value, props.currentFile);
      originalContent.value = content.value;
      
      // Reset version navigation and reload version count
      resetVersionNavigation();
      await loadVersionCount();
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

// ============================================
// Actions Menu Handlers
// ============================================

function handleOpenFormatModal() {
  showActionsMenu.value = false;
  formatInstructions.value = '';
  showFormatModal.value = true;
}

async function handleRunFormatting() {
  if (!content.value.trim()) {
    const toast = await toastController.create({
      message: 'No content to format',
      duration: 2000,
      position: 'top',
      color: 'warning',
    });
    await toast.present();
    return;
  }

  formatting.value = true;
  
  try {
    // Store pre-format version if this is an existing file
    if (props.currentFile) {
      await createFormatVersion(props.currentFile.id, content.value);
    }
    
    // Get current settings instructions and merge with user's additional instructions
    const settingsInstructions = getNoteFormatInstructions();
    let combinedInstructions = settingsInstructions;
    
    if (formatInstructions.value.trim()) {
      combinedInstructions = combinedInstructions 
        ? `${settingsInstructions}\n\nAdditional instructions:\n${formatInstructions.value.trim()}`
        : formatInstructions.value.trim();
    }
    
    // Call formatNote with the combined instructions
    const formattedContent = await formatNote(content.value, {
      topic: combinedInstructions || undefined,
    });
    
    // Update editor content
    content.value = formattedContent;
    
    showFormatModal.value = false;
    
    // Save the file automatically after formatting
    if (props.currentFile) {
      emit('save', formattedContent, props.currentFile);
      originalContent.value = formattedContent;
    }
    
    const toast = await toastController.create({
      message: 'Note formatted and saved',
      duration: 2000,
      position: 'top',
      color: 'success',
    });
    await toast.present();
  } catch (error) {
    const toast = await toastController.create({
      message: 'Failed to format note',
      duration: 3000,
      position: 'top',
      color: 'danger',
    });
    await toast.present();
  } finally {
    formatting.value = false;
  }
}

// ============================================
// Rename Handlers
// ============================================

function getFileNameWithoutExtension(): string {
  if (!props.currentFile) return '';
  const name = props.currentFile.name;
  const lastSlash = name.lastIndexOf('/');
  const fileName = lastSlash >= 0 ? name.substring(lastSlash + 1) : name;
  const lastDot = fileName.lastIndexOf('.');
  return lastDot >= 0 ? fileName.substring(0, lastDot) : fileName;
}

function handleStartRename() {
  showActionsMenu.value = false;
  if (!props.currentFile) return;
  
  // Set initial value to current file name without extension
  newFileName.value = getFileNameWithoutExtension();
  isRenaming.value = true;
  
  // Focus the input after DOM updates
  nextTick(() => {
    renameInputRef.value?.focus();
    renameInputRef.value?.select();
  });
}

function handleCancelRename() {
  isRenaming.value = false;
  newFileName.value = '';
}

async function handleSaveRename() {
  if (!props.currentFile || !newFileName.value.trim()) return;
  
  const trimmedName = newFileName.value.trim();
  const currentName = getFileNameWithoutExtension();
  
  // No change
  if (trimmedName === currentName) {
    handleCancelRename();
    return;
  }
  
  // Add extension back
  const extension = props.currentFile.type === 'md' ? '.md' : '';
  const fullNewName = `${trimmedName}${extension}`;
  
  // Emit rename event to parent
  emit('rename', props.currentFile.id, fullNewName);
  
  isRenaming.value = false;
  newFileName.value = '';
}

// ============================================
// Version Navigation Handlers
// ============================================

async function loadVersionCount() {
  if (!props.currentFile) {
    totalVersions.value = 0;
    currentVersionIndex.value = 0;
    return;
  }
  
  try {
    const history = await getVersionHistory(props.currentFile.id);
    totalVersions.value = history.length;
    // Store the history for potential use
    versionHistory.value = history;
  } catch (error) {
    console.error('Failed to load version count:', error);
    totalVersions.value = 0;
  }
}

async function handleVersionBack() {
  if (!props.currentFile || !canGoBack.value || navigatingVersion.value) return;
  
  navigatingVersion.value = true;
  
  try {
    const targetIndex = currentVersionIndex.value + 1;
    const targetVersionNumber = totalVersions.value - targetIndex + 1;
    
    // Check cache first
    if (cachedVersions.value.has(targetVersionNumber)) {
      content.value = cachedVersions.value.get(targetVersionNumber)!;
      currentVersionIndex.value = targetIndex;
    } else {
      // Load version content
      const versionContent = await getVersionContent(props.currentFile.id, targetVersionNumber);
      if (versionContent !== null) {
        cachedVersions.value.set(targetVersionNumber, versionContent);
        content.value = versionContent;
        currentVersionIndex.value = targetIndex;
      }
    }
  } catch (error) {
    console.error('Failed to navigate to older version:', error);
    const toast = await toastController.create({
      message: 'Failed to load version',
      duration: 2000,
      position: 'top',
      color: 'danger',
    });
    await toast.present();
  } finally {
    navigatingVersion.value = false;
  }
}

async function handleVersionForward() {
  if (!props.currentFile || !canGoForward.value || navigatingVersion.value) return;
  
  navigatingVersion.value = true;
  
  try {
    const targetIndex = currentVersionIndex.value - 1;
    
    if (targetIndex === 0) {
      // Going back to current/latest version
      content.value = originalContent.value;
      currentVersionIndex.value = 0;
    } else {
      const targetVersionNumber = totalVersions.value - targetIndex + 1;
      
      // Check cache first
      if (cachedVersions.value.has(targetVersionNumber)) {
        content.value = cachedVersions.value.get(targetVersionNumber)!;
        currentVersionIndex.value = targetIndex;
      } else {
        // Load version content
        const versionContent = await getVersionContent(props.currentFile.id, targetVersionNumber);
        if (versionContent !== null) {
          cachedVersions.value.set(targetVersionNumber, versionContent);
          content.value = versionContent;
          currentVersionIndex.value = targetIndex;
        }
      }
    }
  } catch (error) {
    console.error('Failed to navigate to newer version:', error);
    const toast = await toastController.create({
      message: 'Failed to load version',
      duration: 2000,
      position: 'top',
      color: 'danger',
    });
    await toast.present();
  } finally {
    navigatingVersion.value = false;
  }
}

function resetVersionNavigation() {
  currentVersionIndex.value = 0;
  cachedVersions.value.clear();
}

// ============================================
// Version History Handlers
// ============================================

async function handleOpenVersionHistory() {
  showActionsMenu.value = false;
  if (!props.currentFile) return;
  
  showVersionHistoryModal.value = true;
  loadingVersions.value = true;
  selectedVersionId.value = null;
  
  try {
    versionHistory.value = await getVersionHistory(props.currentFile.id);
  } catch (error) {
    console.error('Failed to load version history:', error);
    versionHistory.value = [];
  } finally {
    loadingVersions.value = false;
  }
}

function getVersionIcon(source: VersionSource): string {
  switch (source) {
    case 'create':
      return createOutline;
    case 'update':
      return refreshOutline;
    case 'format':
      return colorWandOutline;
    case 'restore':
      return arrowUndoOutline;
    default:
      return timeOutline;
  }
}

function getVersionSourceLabel(source: VersionSource): string {
  switch (source) {
    case 'create':
      return 'Created';
    case 'update':
      return 'Updated';
    case 'format':
      return 'Before formatting';
    case 'restore':
      return 'Before restore';
    default:
      return source;
  }
}

function formatVersionDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  
  return date.toLocaleDateString(undefined, { 
    month: 'short', 
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  });
}

function handlePreviewVersion(version: FileVersionMeta) {
  selectedVersionId.value = version.id;
}

async function handleRestoreVersion(version: FileVersionMeta) {
  if (!props.currentFile || restoringVersion.value) return;
  
  restoringVersion.value = true;
  selectedVersionId.value = version.id;
  
  try {
    // Store current content as a 'restore' version before restoring
    await createRestoreVersion(props.currentFile.id, content.value);
    
    // Get the content of the selected version
    const restoredContent = await getVersionContent(props.currentFile.id, version.versionNumber);
    
    if (restoredContent !== null) {
      // Update editor content
      content.value = restoredContent;
      
      // Save the restored content
      emit('save', restoredContent, props.currentFile);
      originalContent.value = restoredContent;
      
      showVersionHistoryModal.value = false;
      
      const toast = await toastController.create({
        message: `Restored to version ${version.versionNumber}`,
        duration: 2000,
        position: 'top',
        color: 'success',
      });
      await toast.present();
    } else {
      const toast = await toastController.create({
        message: 'Failed to restore version: content not found',
        duration: 3000,
        position: 'top',
        color: 'danger',
      });
      await toast.present();
    }
  } catch (error) {
    console.error('Failed to restore version:', error);
    const toast = await toastController.create({
      message: 'Failed to restore version',
      duration: 3000,
      position: 'top',
      color: 'danger',
    });
    await toast.present();
  } finally {
    restoringVersion.value = false;
  }
}

// ============================================
// Expose methods
// ============================================

function setContent(newContent: string) {
  content.value = newContent;
  originalContent.value = newContent;
  // Reset version navigation and load version count
  resetVersionNavigation();
  loadVersionCount();
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
  min-width: 0; /* Allow flexbox to shrink below content width */
  overflow: hidden;
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
  gap: 10px;
  flex-shrink: 0;
  margin-right: 32px;
  height: 30px;
}

/* Version Navigation */
.version-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--hn-bg-elevated);
  border-radius: 6px;
  padding: 2px 4px;
  height: 30px;
}

.version-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: var(--hn-text-secondary);
  transition: all 0.15s ease;
}

.version-nav-btn:hover:not(:disabled) {
  color: var(--hn-text-primary);
  background: var(--hn-bg-hover);
}

.version-nav-btn:disabled {
  color: var(--hn-text-muted);
  cursor: not-allowed;
  opacity: 0.5;
}

.version-nav-btn ion-icon {
  font-size: 16px;
}

.version-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  font-size: 0.75rem;
  color: var(--hn-text-secondary);
  font-weight: 500;
  min-width: 32px;
  justify-content: center;
}

.version-indicator.viewing-old {
  color: var(--hn-orange);
  background: rgba(var(--hn-orange-rgb, 245, 158, 11), 0.15);
  border-radius: 4px;
  padding: 2px 6px;
}

.version-indicator .version-icon {
  font-size: 12px;
  color: var(--hn-text-muted);
}

.mode-toggle {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--hn-bg-elevated);
  border-radius: 6px;
  padding: 2px;
  height: 30px;
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

/* Actions Menu Button */
.actions-menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--hn-text-secondary);
  transition: all 0.15s ease;
}

.actions-menu-btn:hover {
  background: var(--hn-bg-hover);
  color: var(--hn-text-primary);
}

.actions-menu-btn ion-icon {
  font-size: 18px;
}

/* Actions Popover */
.actions-popover-content {
  --background: var(--hn-bg-surface);
}

.actions-popover-content ion-list {
  padding: 4px 0;
  background: transparent;
}

.actions-popover-content ion-item {
  --background: transparent;
  --background-hover: var(--hn-bg-hover);
  --color: var(--hn-text-primary);
  --padding-start: 12px;
  --padding-end: 12px;
  --min-height: 40px;
  font-size: 0.9rem;
  cursor: pointer;
}

.actions-popover-content ion-item ion-icon {
  font-size: 18px;
  color: var(--hn-text-secondary);
  margin-right: 10px;
}

.actions-popover-content ion-item:hover ion-icon {
  color: var(--hn-teal);
}

/* Rename Container */
.rename-container {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.rename-input {
  flex: 1;
  min-width: 100px;
  max-width: 300px;
  padding: 6px 10px;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--hn-text-primary);
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-teal);
  border-radius: 6px;
  outline: none;
}

.rename-input:focus {
  border-color: var(--hn-teal-light);
  box-shadow: 0 0 0 2px rgba(45, 212, 191, 0.2);
}

.rename-save-btn {
  --background: var(--hn-green);
  --background-hover: var(--hn-green-light);
  --border-radius: 6px;
  --padding-start: 8px;
  --padding-end: 8px;
  height: 30px;
  min-height: 30px;
  margin: 0;
}

.rename-cancel-btn {
  --color: var(--hn-text-secondary);
  --padding-start: 6px;
  --padding-end: 6px;
  height: 30px;
  min-height: 30px;
  margin: 0;
}

.rename-cancel-btn:hover {
  --color: var(--hn-text-primary);
}

/* Save Button Wrapper - prevents layout shift */
.save-btn-wrapper {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 75px;
  height: 30px;
  flex-shrink: 0;
}

.save-btn {
  --color: #ffffff;
  --border-radius: 6px;
  --padding-start: 10px;
  --padding-end: 12px;
  --padding-top: 0;
  --padding-bottom: 0;
  --box-shadow: none;
  margin: 0;
  font-weight: 600;
  font-size: 0.8rem;
  height: 30px;
  min-height: 30px;
  opacity: 0;
  transform: scale(0.9);
  pointer-events: none;
  transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.15s ease;
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

.save-btn.visible:hover::part(native) {
  background: linear-gradient(135deg, var(--hn-green-light) 0%, var(--hn-teal-light) 100%);
  box-shadow: 0 3px 10px rgba(63, 185, 80, 0.4);
}

.save-btn.visible:hover {
  transform: scale(1.02);
}

.save-btn.visible:active::part(native) {
  background: linear-gradient(135deg, var(--hn-green-dark) 0%, var(--hn-teal-dark) 100%);
  box-shadow: 0 1px 3px rgba(63, 185, 80, 0.2);
}

.save-btn.visible:active {
  transform: scale(0.98);
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
  min-width: 0; /* Allow flexbox to shrink */
}

.editor-pane {
  flex: 1;
  overflow: hidden;
  display: flex;
  min-width: 0; /* Allow flexbox to shrink */
}

.editor-pane.full {
  width: 100%;
}

.preview-pane {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px 24px;
  min-width: 0; /* Allow flexbox to shrink */
}

.preview-pane.full {
  width: 100%;
}

.split-pane {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0; /* Allow flexbox to shrink */
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
  overflow-x: auto; /* Scroll horizontally for wide content */
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

/* Mermaid Diagram Styles */
.markdown-preview :deep(.mermaid-diagram) {
  margin: 1.5em 0;
  padding: 16px;
  background: var(--hn-bg-surface);
  border-radius: 8px;
  border: 1px solid var(--hn-border-default);
  overflow-x: auto;
  display: flex;
  justify-content: center;
}

.markdown-preview :deep(.mermaid-diagram svg) {
  max-width: 100%;
  height: auto;
}

.markdown-preview :deep(.mermaid-error) {
  color: var(--hn-error, #ef4444);
  font-style: italic;
  padding: 12px;
  text-align: center;
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

/* AI Formatting Modal */
ion-modal ion-toolbar {
  --background: var(--hn-bg-surface);
  --color: var(--hn-text-primary);
  --border-color: var(--hn-border-default);
}

ion-modal ion-content.format-modal-content {
  --background: var(--hn-bg-deep);
}

.format-description {
  color: var(--hn-text-secondary);
  font-size: 0.9rem;
  margin-bottom: 16px;
  line-height: 1.5;
}

.format-textarea {
  --background: var(--hn-bg-surface);
  --color: var(--hn-text-primary);
  --placeholder-color: var(--hn-text-muted);
  --border-radius: 8px;
  --padding-start: 12px;
  --padding-end: 12px;
  --padding-top: 12px;
  --padding-bottom: 12px;
  border: 1px solid var(--hn-border-default);
  margin-bottom: 16px;
}

.format-textarea:focus-within {
  border-color: var(--hn-teal);
}

.format-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--hn-text-muted);
  font-size: 0.8rem;
  padding: 10px 12px;
  background: var(--hn-bg-surface);
  border-radius: 6px;
  border: 1px solid var(--hn-border-subtle);
}

.format-note ion-icon {
  font-size: 16px;
  flex-shrink: 0;
  color: var(--hn-teal);
  margin-top: 1px;
}

ion-modal ion-button {
  --color: var(--hn-purple);
}

ion-modal ion-button[strong] {
  --color: var(--hn-green);
}

/* Version History Modal Styles */
ion-modal ion-content.version-history-content {
  --background: var(--hn-bg-deep);
}

.loading-versions {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  color: var(--hn-text-secondary);
}

.loading-versions ion-spinner {
  --color: var(--hn-teal);
  margin-bottom: 16px;
}

.no-versions {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  color: var(--hn-text-secondary);
}

.no-versions .empty-icon {
  font-size: 48px;
  color: var(--hn-text-muted);
  margin-bottom: 16px;
}

.no-versions .hint {
  font-size: 0.85rem;
  color: var(--hn-text-muted);
  margin-top: 8px;
}

.version-list {
  background: transparent;
}

.version-list ion-item {
  --background: var(--hn-bg-surface);
  --border-color: var(--hn-border-subtle);
  --padding-start: 16px;
  --padding-end: 16px;
  --inner-padding-end: 8px;
  margin-bottom: 8px;
  border-radius: 8px;
  overflow: hidden;
}

.version-list ion-item:hover {
  --background: var(--hn-bg-elevated);
}

.version-list ion-item.selected-version {
  --background: var(--hn-bg-elevated);
  border-left: 3px solid var(--hn-teal);
}

.version-icon {
  font-size: 20px;
  margin-right: 4px;
}

.version-icon.create {
  color: var(--hn-green);
}

.version-icon.update {
  color: var(--hn-blue);
}

.version-icon.format {
  color: var(--hn-purple);
}

.version-icon.restore {
  color: var(--hn-orange);
}

.version-list ion-label h3 {
  font-weight: 600;
  color: var(--hn-text-primary);
  margin-bottom: 4px;
}

.version-list ion-label p {
  color: var(--hn-text-secondary);
  font-size: 0.85rem;
  margin: 2px 0;
}

.version-list ion-label .version-source {
  color: var(--hn-text-muted);
  font-size: 0.8rem;
}

.version-list ion-button[fill="outline"] {
  --border-color: var(--hn-teal);
  --color: var(--hn-teal);
  --padding-start: 12px;
  --padding-end: 12px;
}

.version-list ion-button[fill="outline"]:hover {
  --background: rgba(var(--hn-teal-rgb), 0.1);
}
</style>

