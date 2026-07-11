<template>
  <div class="markdown-editor-container" ref="editorContainerRef">
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
          <span v-if="autoSaveStatusText" class="autosave-status">{{ autoSaveStatusText }}</span>
          <button
            class="shortcuts-hint-btn"
            @click="showShortcutsModal = true"
            title="Keyboard shortcuts"
          >
            <ion-icon :icon="keypadOutline" />
          </button>
        </template>
      </div>
      <div class="header-actions">
        <!-- Version Navigation -->
        <div v-if="currentFile && totalVersions > 0" class="version-nav">
          <button 
            class="version-nav-btn"
            :disabled="!canGoBack || navigatingVersion"
            @click="handleVersionBack"
            :title="canGoBack ? `Go to version ${currentVersionIndex + 1}` : 'No older version'"
            :aria-label="canGoBack ? `Go to version ${currentVersionIndex + 1}` : 'No older version'"
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
            :title="canGoForward ? (currentVersionIndex === 1 ? 'Go to latest version' : `Go to version ${currentVersionIndex - 1}`) : 'At latest version'"
            :aria-label="canGoForward ? (currentVersionIndex === 1 ? 'Go to latest version' : `Go to version ${currentVersionIndex - 1}`) : 'At latest version'"
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
        <button
          v-if="hasOutlineHeadings"
          :class="['mode-btn', { active: outlineVisible }]"
          @click="outlineVisible = !outlineVisible"
          title="Document outline"
        >
          <ion-icon :icon="readerOutline" />
        </button>
        <div class="mode-toggle">
          <button 
            :class="['mode-btn', { active: viewMode === 'edit' }]" 
            @click="viewMode = 'edit'"
            title="Edit"
          >
            <ion-icon :icon="codeOutline" />
          </button>
          <button 
            :class="['mode-btn', { active: viewMode === 'split', disabled: splitViewDisabled }]" 
            @click="setSplitViewMode"
            :title="splitViewDisabled ? 'Not enough space for split view' : 'Split'"
            :disabled="splitViewDisabled"
          >
            <ion-icon :icon="gridOutline" />
          </button>
          <button 
            :class="['mode-btn', { active: viewMode === 'hybrid' }]" 
            @click="viewMode = 'hybrid'"
            title="Live (rendered + markdown at cursor)"
          >
            <ion-icon :icon="layersOutline" />
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
          v-if="currentFile"
          :is-open="showActionsMenu"
          @didDismiss="showActionsMenu = false"
          trigger="editor-actions-trigger"
          trigger-action="click"
          side="bottom"
          alignment="end"
        >
          <ion-content class="actions-popover-content">
            <ion-list lines="none">
              <ion-item button @click="handleOpenFormatStudio" :detail="false">
                <ion-icon :icon="sparklesOutline" slot="start" />
                <ion-label>Run AI Formatting</ion-label>
              </ion-item>
              <ion-item v-if="isMeetingTranscript" button @click="handleGenerateMeetingNotes" :detail="false">
                <ion-icon :icon="clipboardOutline" slot="start" />
                <ion-label>Generate Meeting Notes</ion-label>
              </ion-item>
              <ion-item button @click="handleStartRename" :detail="false">
                <ion-icon :icon="pencilOutline" slot="start" />
                <ion-label>Rename</ion-label>
              </ion-item>
              <ion-item button @click="handleOpenVersionHistory" :detail="false">
                <ion-icon :icon="timeOutline" slot="start" />
                <ion-label>Version History</ion-label>
              </ion-item>
              <ion-item-divider class="export-divider">Export</ion-item-divider>
              <ion-item button @click="handleExport('pdf')" :detail="false">
                <ion-icon :icon="documentOutline" slot="start" />
                <ion-label>Export as PDF</ion-label>
              </ion-item>
              <ion-item button @click="handleExport('docx')" :detail="false">
                <ion-icon :icon="readerOutline" slot="start" />
                <ion-label>Export as DOCX</ion-label>
              </ion-item>
              <ion-item button @click="handleExport('md')" :detail="false">
                <ion-icon :icon="codeSlashOutline" slot="start" />
                <ion-label>Export as Markdown</ion-label>
              </ion-item>
            </ion-list>
          </ion-content>
        </ion-popover>
      </div>
    </div>

    <!-- AI Format Studio -->
    <FormatStudio
      :is-open="showFormatStudio"
      :note-content="content"
      :current-file="currentFile"
      @dismiss="showFormatStudio = false"
      @apply="handleFormatApply"
    />

    <!-- Version History Modal -->
    <ion-modal :is-open="showVersionHistoryModal" @didDismiss="showVersionHistoryModal = false">
      <ion-header>
        <ion-toolbar>
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
      <ion-footer class="modal-footer">
        <ion-toolbar>
          <ion-buttons slot="end">
            <ion-button fill="clear" @click="showVersionHistoryModal = false">Close</ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-footer>
    </ion-modal>

    <!-- Manual / Hybrid Save Modal -->
    <ion-modal :is-open="showManualSaveModal" :can-dismiss="canDismissSaveModal" @didDismiss="handleSaveModalDismiss">
      <ion-header>
        <ion-toolbar>
          <ion-title>Save Note</ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding manual-save-modal-content">
        <p v-if="!hybridMode" class="manual-save-description">
          No AI provider configured. Choose where to save your note manually.
        </p>
        <p v-else class="manual-save-description">
          AI has pre-filled some fields. Complete the remaining fields and save.
        </p>

        <!-- Project Selection -->
        <div class="manual-save-field">
          <ion-label class="manual-save-label">
            Project
            <span v-if="hybridProjectLocked" class="ai-badge">AI</span>
          </ion-label>
          <div class="manual-save-project-select">
            <ion-select
              v-if="!manualSaveCreatingNewProject"
              v-model="manualSaveProjectId"
              placeholder="Select a project"
              interface="popover"
              class="manual-save-select"
              :class="{ 'field-locked': hybridProjectLocked }"
              :disabled="hybridProjectLocked"
              @ionChange="handleManualProjectChange"
              @ionFocus="saveSelectOpen = true"
              @ionBlur="saveSelectOpen = false"
            >
              <ion-select-option
                v-for="project in availableProjects"
                :key="project.id"
                :value="project.id"
              >
                {{ project.name }}
              </ion-select-option>
            </ion-select>
            <ion-input
              v-else
              v-model="manualSaveNewProjectName"
              placeholder="New project name"
              class="manual-save-input"
            />
            <ion-button
              v-if="!hybridProjectLocked"
              fill="clear"
              size="small"
              @click="toggleNewProject"
              class="manual-save-toggle-btn"
            >
              <ion-icon :icon="manualSaveCreatingNewProject ? closeOutline : addOutline" slot="icon-only" />
            </ion-button>
          </div>
        </div>

        <!-- Directory Selection -->
        <div class="manual-save-field">
          <ion-label class="manual-save-label">
            Directory
            <span v-if="hybridDirectoryLocked" class="ai-badge">AI</span>
          </ion-label>
          <div class="manual-save-project-select">
            <ion-select
              v-if="!manualSaveCreatingNewDirectory"
              v-model="manualSaveDirectory"
              placeholder="Root (no directory)"
              interface="popover"
              class="manual-save-select"
              :class="{ 'field-locked': hybridDirectoryLocked }"
              :disabled="hybridDirectoryLocked"
              @ionFocus="saveSelectOpen = true"
              @ionBlur="saveSelectOpen = false"
            >
              <ion-select-option value="">Root (no directory)</ion-select-option>
              <ion-select-option
                v-for="dir in availableDirectories"
                :key="dir"
                :value="dir"
              >
                {{ dir }}
              </ion-select-option>
            </ion-select>
            <ion-input
              v-else
              v-model="manualSaveNewDirectoryName"
              placeholder="New directory name"
              class="manual-save-input"
            />
            <ion-button
              v-if="!hybridDirectoryLocked"
              fill="clear"
              size="small"
              @click="toggleNewDirectory"
              class="manual-save-toggle-btn"
            >
              <ion-icon :icon="manualSaveCreatingNewDirectory ? closeOutline : addOutline" slot="icon-only" />
            </ion-button>
          </div>
        </div>

        <!-- File Name -->
        <div class="manual-save-field">
          <ion-label class="manual-save-label">File Name</ion-label>
          <ion-input
            v-model="manualSaveFileName"
            placeholder="note.md"
            class="manual-save-input"
          />
        </div>

        <p v-if="!hybridMode" class="manual-save-hint">
          <ion-icon :icon="informationCircleOutline" />
          The note will be saved as-is without AI formatting. You can run AI formatting later from the editor menu.
        </p>
        <p v-else-if="hybridFormattedContent && hybridFormattedContent !== content" class="manual-save-hint hybrid-hint">
          <ion-icon :icon="sparklesOutline" />
          Note content has been formatted by AI. Original will be saved in version history.
        </p>
      </ion-content>
      <ion-footer class="modal-footer">
        <ion-toolbar>
          <ion-buttons slot="start">
            <ion-button fill="clear" @click="showManualSaveModal = false" :disabled="manualSaving">
              Cancel
            </ion-button>
          </ion-buttons>
          <ion-buttons slot="end">
            <ion-button
              fill="solid"
              :strong="true"
              @click="handleManualSave"
              :disabled="manualSaving || !canManualSave"
              class="modal-confirm-btn"
            >
              {{ manualSaving ? 'Saving...' : 'Save' }}
            </ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-footer>
    </ion-modal>

    <!-- Keyboard Shortcuts Modal -->
    <ion-modal :is-open="showShortcutsModal" @didDismiss="showShortcutsModal = false">
      <ion-header>
        <ion-toolbar>
          <ion-title>Keyboard Shortcuts</ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding shortcuts-modal-content">
        <div v-for="cat in shortcutCategories" :key="cat.key" class="shortcuts-group">
          <h3 class="shortcuts-group-title">{{ cat.label }}</h3>
          <div
            v-for="entry in shortcutsByCategory[cat.key]"
            :key="entry.keys"
            class="shortcut-row"
          >
            <span class="shortcut-description">{{ entry.description }}</span>
            <span class="shortcut-keys">
              <template v-if="entry.keys.includes(',')">
                <kbd>{{ entry.keys }}</kbd>
              </template>
              <template v-else>
                <kbd v-for="(part, i) in entry.keys.split('+')" :key="i">{{ part.trim() }}</kbd>
              </template>
            </span>
          </div>
        </div>
      </ion-content>
      <ion-footer class="modal-footer">
        <ion-toolbar>
          <ion-buttons slot="end">
            <ion-button fill="clear" @click="showShortcutsModal = false">Close</ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-footer>
    </ion-modal>

    <!-- Editor Content -->
    <div class="editor-content" ref="editorContentRef">
      <div class="editor-workspace">
        <EditorOutline
          :content="outlineContent"
          :visible="outlineVisible"
          @navigate="handleOutlineNavigate"
          @toggle="outlineVisible = !outlineVisible"
        />
        <div class="editor-main">
      <!-- Floating Send to Chat Button -->
      <Teleport to="body">
        <Transition name="selection-fade">
          <button
            v-if="showSelectionButton && selectionPosition"
            class="selection-to-chat-btn"
            :style="{
              position: 'fixed',
              left: `${selectionPosition.x}px`,
              top: `${selectionPosition.y}px`,
              zIndex: 9999,
            }"
            @mousedown.prevent
            @click="handleSendToChat"
            title="Send selection to Chat"
          >
            <ion-icon :icon="chatbubbleOutline" />
            <span>Send to Chat</span>
          </button>
        </Transition>
      </Teleport>

      <!-- Saving State (for new notes) -->
      <div v-if="saving && isNewNote" class="saving-overlay">
        <div class="saving-content">
          <IonSpinner name="crescent" />
          <h3>{{ hybridRunningAI ? 'Processing Note' : 'Saving Note' }}</h3>
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
          @paste="handleEditorPaste"
          @mouseup="handleEditorMouseUp"
          @keyup="handleEditorMouseUp"
          :disabled="saving"
        ></textarea>
      </div>

      <!-- Split Mode -->
      <div v-else-if="viewMode === 'split'" class="split-pane">
        <div class="editor-pane" :style="{ width: splitLeftWidth + '%' }">
          <textarea 
            ref="splitEditorRef"
            v-model="content"
            class="markdown-textarea"
            placeholder="Start writing your note..."
            @input="handleInput"
            @paste="handleEditorPaste"
            @mouseup="handleEditorMouseUp"
            @keyup="handleEditorMouseUp"
            :disabled="saving"
          ></textarea>
        </div>
        <div
          class="split-resizer"
          @mousedown="startSplitResize"
        ></div>
        <div class="split-preview markdown-preview" :style="{ width: (100 - splitLeftWidth) + '%' }" v-html="renderedContent" @click="handlePreviewClick"></div>
      </div>

      <!-- Live Preview Mode (Tiptap WYSIWYG; markdown round-tripped via turndown).
           NOTE: do not pass `class="editor-pane full"` here. The live editor's
           own `.live-editor-host` styling owns its layout and scrolling
           (`overflow-y: auto`); applying the parent's `editor-pane`
           `overflow: hidden` would clip the content and disable scrolling. -->
      <MarkdownLiveEditor
        v-else-if="viewMode === 'hybrid'"
        ref="hybridEditorRef"
        v-model="content"
        :disabled="saving"
        :project-id="currentProject?.id"
        @update:modelValue="handleInput"
        @selection-snapshot="onHybridSelectionSnapshot"
        @date-chip-click="onHybridDateChipClick"
      />

      <!-- View Mode -->
      <div v-else-if="viewMode === 'view'" class="preview-pane full markdown-preview" v-html="renderedContent" @click="handlePreviewClick"></div>
        </div>
      </div>
    </div>

    <!-- Date Chip Popover -->
    <DateChipPopover
      v-if="datePopover.visible"
      :date="datePopover.date"
      :type="datePopover.type"
      :original-text="datePopover.original"
      :context="datePopover.context"
      :anchor-rect="datePopover.anchorRect"
      @close="closeDatePopover"
    />

    <!-- Slash command & wikilink autocomplete (edit/split textarea modes) -->
    <MarkdownSlashMenu
      v-if="viewMode === 'edit' || viewMode === 'split'"
      :commands="slashMenuState.commands"
      :is-visible="slashMenuState.visible"
      :anchor-rect="slashMenuState.anchorRect"
      @select="onTextareaSlashSelect"
      @close="closeTextareaSlashMenu"
    />
    <WikilinkAutocomplete
      v-if="viewMode === 'edit' || viewMode === 'split'"
      :project-id="currentProject?.id"
      :search-query="wikilinkMenuState.query"
      :is-visible="wikilinkMenuState.visible"
      :anchor-rect="wikilinkMenuState.anchorRect"
      @select="onTextareaWikilinkSelect"
      @close="closeTextareaWikilinkMenu"
    />

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
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
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
  IonItemDivider,
  IonLabel,
  IonModal,
  IonHeader,
  IonFooter,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonInput,
  IonSelect,
  IonSelectOption,
  toastController,
} from '@ionic/vue';
import {
  documentTextOutline,
  documentOutline,
  codeOutline,
  codeSlashOutline,
  gridOutline,
  layersOutline,
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
  chatbubbleOutline,
  readerOutline,
  addOutline,
  keypadOutline,
  clipboardOutline,
} from 'ionicons/icons';
import type { Project, ProjectFile, GlobalAddNoteResult, FileVersionMeta, VersionSource } from '@/types';
import type { NoteExecutionStep } from '@/services';
import { useMarkdownShortcuts, SHORTCUTS_CATALOG, SHORTCUT_CATEGORIES } from '@/composables/useMarkdownShortcuts';
import type { ShortcutEntry } from '@/composables/useMarkdownShortcuts';
import { rewriteCalloutHtml } from '@/services/calloutConverter';
import { useEditorSlashCommands, type SlashMenuState } from '@/composables/useEditorSlashCommands';
import { useEditorWikilinkAutocomplete, type WikilinkMenuState } from '@/composables/useEditorWikilinkAutocomplete';
import MarkdownSlashMenu from '@/components/MarkdownSlashMenu.vue';
import WikilinkAutocomplete, { type WikilinkFileItem } from '@/components/WikilinkAutocomplete.vue';
import type { SlashCommand } from '@/composables/markdownSlashCommands';
import { useIdleAutoSave, autoSaveStatusLabel } from '@/composables/useIdleAutoSave';
import { 
  globalAddNote, 
  formatNote, 
  generateNoteTitle,
  titleToSlug,
  decideTargetProject,
  decideNoteDirectoryWithDirs,
  createFormatVersion,
  getVersionHistory,
  getVersionContent,
  createRestoreVersion,
  exportToFile,
  getFileNameWithoutExtension as getBaseName,
  isConfigured,
  isAutoFormatEnabled,
  isAutoProjectRoutingEnabled,
  isAutoDirectoryRoutingEnabled,
  getAllProjects,
  createProject,
  getProjectDirectories,
  persistNote,
  indexNote,
  generateUniqueFileName,
  updateProjectStatus,
  flushDatabase,
  findFileByPath,
  findFileGlobal,
  chatCompletion,
  detectDates,
} from '@/services';
import type { DocumentFormat, DetectedDate } from '@/types';
import FormatStudio from '@/components/FormatStudio.vue';
import DateChipPopover from '@/components/DateChipPopover.vue';
import MarkdownLiveEditor from '@/components/MarkdownLiveEditor.vue';
import EditorOutline, { type OutlineItem } from '@/components/EditorOutline.vue';
import { parseDocumentStructure } from '@/services/documentProcessor';
import { savePastedImage, readClipboardImage } from '@/services/editorImagePaste';

interface Props {
  currentFile?: ProjectFile | null;
  currentProject?: Project | null;
  initialContent?: string;
  defaultProjectId?: string;
  onAutosave?: (content: string, file: ProjectFile) => Promise<boolean>;
}

const props = withDefaults(defineProps<Props>(), {
  currentFile: null,
  currentProject: null,
  initialContent: '',
});

// Selection context for Send to Chat feature
interface SelectionContext {
  text: string;
  filePath: string | null;
  fileId: string | null;
  startLine: number;
  endLine: number;
}

const emit = defineEmits<{
  (e: 'save', content: string, file?: ProjectFile): void;
  (e: 'content-change', content: string): void;
  (e: 'note-saved', result: GlobalAddNoteResult): void;
  (e: 'rename', fileId: string, newName: string): void;
  (e: 'selection-to-chat', selection: SelectionContext): void;
  (e: 'open-file', fileId: string, projectId: string): void;
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

// Custom image renderer for resolving project file paths to blob URLs
const imageBlobUrls = ref<Map<string, string>>(new Map());

const imageRenderer = {
  image(token: { href: string; title: string | null; text: string }): string | false {
    const href = token.href;
    if (!href) return false;

    // Skip data URLs and external URLs - they already work
    if (href.startsWith('data:') || href.startsWith('http://') || href.startsWith('https://')) {
      return false;
    }

    // Try to resolve project-relative paths from cache
    const resolvedUrl = imageBlobUrls.value.get(href);
    if (resolvedUrl) {
      const title = token.title ? ` title="${token.title}"` : '';
      return `<img src="${resolvedUrl}" alt="${token.text || ''}"${title} style="max-width:100%;border-radius:8px;margin:1em 0;">`;
    }

    // Return a placeholder that will be replaced once the blob URL is resolved
    const title = token.title ? ` title="${token.title}"` : '';
    return `<img src="" alt="${token.text || ''}"${title} data-project-image="${href}" style="max-width:100%;border-radius:8px;margin:1em 0;display:none;">`;
  }
};

// Apply renderers
marked.use({ renderer: mermaidRenderer });
marked.use({ renderer: imageRenderer });

const content = ref('');
const originalContent = ref('');
const viewMode = ref<'edit' | 'split' | 'hybrid' | 'view'>('edit');
const saving = ref(false);
const editorContentRef = ref<HTMLElement | null>(null);
const OUTLINE_VISIBLE_KEY = 'hn-editor-outline-visible';
const outlineVisible = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(OUTLINE_VISIBLE_KEY) !== 'false',
);
const outlineContent = ref('');
let outlineDebounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(outlineVisible, (visible) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(OUTLINE_VISIBLE_KEY, String(visible));
  }
});

watch(
  content,
  (value) => {
    if (outlineDebounceTimer) clearTimeout(outlineDebounceTimer);
    outlineDebounceTimer = setTimeout(() => {
      outlineContent.value = value;
    }, 200);
  },
  { immediate: true },
);

const hasOutlineHeadings = computed(() =>
  parseDocumentStructure(outlineContent.value).some((s) => s.type === 'heading'),
);

function slugifyHeading(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'heading';
}

function headingDomId(title: string, outlineIndex: number): string {
  const base = slugifyHeading(title);
  let duplicateIndex = 0;
  const sections = parseDocumentStructure(outlineContent.value).filter(
    (s) => s.type === 'heading' && s.title,
  );
  for (let i = 0; i < outlineIndex; i++) {
    const other = sections[i];
    if (other?.title && slugifyHeading(other.title) === base) {
      duplicateIndex++;
    }
  }
  return duplicateIndex === 0 ? base : `${base}-${duplicateIndex}`;
}

function injectHeadingIds(html: string): string {
  if (!html.includes('<h')) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return html;

  const slugCounts = new Map<string, number>();
  for (const heading of Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
    const text = heading.textContent?.trim() || '';
    const base = slugifyHeading(text);
    const count = slugCounts.get(base) || 0;
    slugCounts.set(base, count + 1);
    heading.id = count === 0 ? base : `${base}-${count}`;
  }
  return root.innerHTML;
}

function scrollTextareaToOffset(textarea: HTMLTextAreaElement, offset: number): void {
  textarea.focus();
  textarea.setSelectionRange(offset, offset);
  const textBefore = textarea.value.substring(0, offset);
  const lineNum = textBefore.split('\n').length;
  const lineHeight = Number.parseInt(getComputedStyle(textarea).lineHeight, 10) || 20;
  textarea.scrollTop = Math.max(0, (lineNum - 1) * lineHeight - textarea.clientHeight / 3);
}

function handleOutlineNavigate(item: OutlineItem, index: number): void {
  if (viewMode.value === 'edit' || viewMode.value === 'split') {
    const textarea = viewMode.value === 'split' ? splitEditorRef.value : editorRef.value;
    if (!textarea) return;
    scrollTextareaToOffset(textarea, item.startOffset);
    return;
  }

  if (viewMode.value === 'hybrid') {
    hybridEditorRef.value?.scrollToHeading(index);
    return;
  }

  const pane = editorContentRef.value?.querySelector('.preview-pane, .split-preview');
  const id = headingDomId(item.title, index);
  pane?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function showPasteImageToast(message: string, color: 'warning' | 'danger' = 'warning'): Promise<void> {
  const toast = await toastController.create({ message, duration: 3000, color });
  await toast.present();
}

async function handleEditorPaste(event: ClipboardEvent): Promise<void> {
  const clipboard = event.clipboardData;
  if (!clipboard) return;

  const image = await readClipboardImage(clipboard);
  if (!image) return;

  event.preventDefault();

  const projectId = props.currentProject?.id || props.currentFile?.projectId;
  if (!projectId) {
    await showPasteImageToast('Open or select a project to paste images');
    return;
  }

  try {
    const { markdown } = await savePastedImage({
      projectId,
      binaryData: image.binaryData,
      mimeType: image.mimeType,
    });
    insertAtCursor(markdown);
  } catch {
    await showPasteImageToast('Failed to save pasted image', 'danger');
  }
}

const editorRef = ref<HTMLTextAreaElement | null>(null);
const splitEditorRef = ref<HTMLTextAreaElement | null>(null);
const hybridEditorRef = ref<InstanceType<typeof MarkdownLiveEditor> | null>(null);
const executionSteps = ref<NoteExecutionStep[]>([]);

// Date chip popover state
const datePopover = ref<{
  visible: boolean;
  date: string;
  type: string;
  original: string;
  context: string;
  anchorRect: DOMRect | null;
}>({
  visible: false,
  date: '',
  type: 'regular',
  original: '',
  context: '',
  anchorRect: null,
});

async function copyCodeBlock(btn: HTMLElement) {
  const pre = btn.parentElement?.querySelector('pre');
  if (!pre) return;
  try {
    await navigator.clipboard.writeText(pre.innerText.replace(/\n$/, ''));
  } catch {
    return;
  }
  // Direct DOM mutation is fine here: the button lives in v-html content that
  // is regenerated wholesale whenever renderedContent recomputes.
  btn.classList.add('copied');
  btn.innerHTML = CHECK_ICON_SVG;
  window.setTimeout(() => {
    btn.classList.remove('copied');
    btn.innerHTML = COPY_ICON_SVG;
  }, 1500);
}

function handlePreviewClick(event: MouseEvent) {
  const target = event.target as HTMLElement;

  const copyBtn = target.closest('.code-copy-btn') as HTMLElement | null;
  if (copyBtn) {
    event.preventDefault();
    event.stopPropagation();
    copyCodeBlock(copyBtn);
    return;
  }

  const wikilink = target.closest('.wikilink') as HTMLElement | null;
  if (wikilink) {
    event.preventDefault();
    event.stopPropagation();
    void openWikilink(wikilink.dataset.wikilink || '');
    return;
  }

  const chip = target.closest('.date-chip') as HTMLElement | null;

  if (chip) {
    event.preventDefault();
    event.stopPropagation();
    const rect = chip.getBoundingClientRect();
    datePopover.value = {
      visible: true,
      date: chip.dataset.date || '',
      type: chip.dataset.type || 'regular',
      original: chip.dataset.original || '',
      context: chip.dataset.context || '',
      anchorRect: rect,
    };
  }
}

async function openWikilink(rawPath: string) {
  const path = rawPath.trim();
  if (!path) return;

  try {
    if (props.currentProject?.id) {
      const local = await findFileByPath(props.currentProject.id, path);
      if (local) {
        emit('open-file', local.id, props.currentProject.id);
        return;
      }
    }
    const global = await findFileGlobal(path);
    if (global) {
      emit('open-file', global.file.id, global.projectId);
    }
  } catch (err) {
    console.warn('Failed to open wikilink:', path, err);
  }
}

/**
 * Hybrid (Live) mode emits a structured payload from MarkdownLiveEditor when a
 * date chip is clicked, so we can reuse the same popover state without
 * touching the DOM directly.
 */
function onHybridDateChipClick(payload: {
  date: string;
  type: string;
  original: string;
  context: string;
  anchorRect: DOMRect | null;
}) {
  datePopover.value = {
    visible: true,
    date: payload.date,
    type: payload.type,
    original: payload.original,
    context: payload.context,
    anchorRect: payload.anchorRect,
  };
}

function closeDatePopover() {
  datePopover.value.visible = false;
}

// Keyboard shortcuts catalog
const showShortcutsModal = ref(false);
const toggleShortcutsModal = () => { showShortcutsModal.value = !showShortcutsModal.value; };

const shortcutCategories = (Object.keys(SHORTCUT_CATEGORIES) as Array<ShortcutEntry['category']>).map(key => ({
  key,
  label: SHORTCUT_CATEGORIES[key],
}));
const shortcutsByCategory = shortcutCategories.reduce((acc, cat) => {
  acc[cat.key] = SHORTCUTS_CATALOG.filter(e => e.category === cat.key);
  return acc;
}, {} as Record<ShortcutEntry['category'], ShortcutEntry[]>);

const onShortcutContentChange = (val: string) => emit('content-change', val);
useMarkdownShortcuts({ textareaRef: editorRef, content, onContentChange: onShortcutContentChange, onToggleShortcuts: toggleShortcutsModal });
useMarkdownShortcuts({ textareaRef: splitEditorRef, content, onContentChange: onShortcutContentChange, onToggleShortcuts: toggleShortcutsModal });

const slashMenuState = ref<SlashMenuState>({
  visible: false,
  query: '',
  startIndex: -1,
  commands: [],
  anchorRect: null,
});
const wikilinkMenuState = ref<WikilinkMenuState>({
  visible: false,
  query: '',
  startIndex: -1,
  anchorRect: null,
});

function onSlashMenuChange(state: SlashMenuState) {
  slashMenuState.value = state;
}
function onWikilinkMenuChange(state: WikilinkMenuState) {
  wikilinkMenuState.value = state;
}

const slashEdit = useEditorSlashCommands({
  textareaRef: editorRef,
  content,
  onContentChange: onShortcutContentChange,
  onMenuChange: onSlashMenuChange,
});
const slashSplit = useEditorSlashCommands({
  textareaRef: splitEditorRef,
  content,
  onContentChange: onShortcutContentChange,
  onMenuChange: onSlashMenuChange,
});
const wikilinkEdit = useEditorWikilinkAutocomplete({
  textareaRef: editorRef,
  content,
  onContentChange: onShortcutContentChange,
  onMenuChange: onWikilinkMenuChange,
});
const wikilinkSplit = useEditorWikilinkAutocomplete({
  textareaRef: splitEditorRef,
  content,
  onContentChange: onShortcutContentChange,
  onMenuChange: onWikilinkMenuChange,
});

function onTextareaSlashSelect(command: SlashCommand) {
  slashEdit.applyCommand(command);
  slashSplit.applyCommand(command);
  if (command.id === 'file') {
    // Ensure wikilink autocomplete opens after [[ is inserted.
    wikilinkEdit.refreshMenu();
    wikilinkSplit.refreshMenu();
  }
}
function closeTextareaSlashMenu() {
  slashEdit.closeMenu();
  slashSplit.closeMenu();
}
function onTextareaWikilinkSelect(file: WikilinkFileItem) {
  wikilinkEdit.applyFile(file);
  wikilinkSplit.applyFile(file);
}
function closeTextareaWikilinkMenu() {
  wikilinkEdit.closeMenu();
  wikilinkSplit.closeMenu();
}

// Split resizer state
const splitLeftWidth = ref(50); // percentage
let isResizingSplit = false;
let splitPaneEl: HTMLElement | null = null;

function startSplitResize(e: MouseEvent) {
  e.preventDefault();
  isResizingSplit = true;
  splitPaneEl = (e.target as HTMLElement).parentElement;
  document.addEventListener('mousemove', onSplitResize);
  document.addEventListener('mouseup', stopSplitResize);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function onSplitResize(e: MouseEvent) {
  if (!isResizingSplit || !splitPaneEl) return;
  const rect = splitPaneEl.getBoundingClientRect();
  const offsetX = e.clientX - rect.left;
  let pct = (offsetX / rect.width) * 100;
  // Clamp between 20% and 80%
  pct = Math.max(20, Math.min(80, pct));
  splitLeftWidth.value = pct;
}

function stopSplitResize() {
  isResizingSplit = false;
  splitPaneEl = null;
  document.removeEventListener('mousemove', onSplitResize);
  document.removeEventListener('mouseup', stopSplitResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

// Actions menu state
const showActionsMenu = ref(false);
const generatingMeetingNotes = ref(false);

const MEETING_DIRS = ['zoom-meetings/', 'google-meet/', 'google-calendar/'];
const isMeetingTranscript = computed(() => {
  const filePath = props.currentFile?.name?.toLowerCase() || '';
  return MEETING_DIRS.some(d => filePath.startsWith(d) || filePath.includes('/' + d));
});

// AI Format Studio state
const showFormatStudio = ref(false);

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

// Manual/hybrid save state
const showManualSaveModal = ref(false);
const manualSaveProjectId = ref<string | null>(null);
const manualSaveNewProjectName = ref('');
const manualSaveDirectory = ref('');
const manualSaveNewDirectoryName = ref('');
const manualSaveFileName = ref('');
const manualSaveCreatingNewProject = ref(false);
const manualSaveCreatingNewDirectory = ref(false);
const availableProjects = ref<Project[]>([]);
const availableDirectories = ref<string[]>([]);
const manualSaving = ref(false);
const saveSelectOpen = ref(false);

async function canDismissSaveModal(): Promise<boolean> {
  return !saveSelectOpen.value;
}

const editorContainerRef = ref<HTMLElement | null>(null);
const editorContainerWidth = ref(0);
const splitViewDisabled = computed(() => editorContainerWidth.value > 0 && editorContainerWidth.value < 560);
let editorContainerObserver: ResizeObserver | null = null;

function setSplitViewMode() {
  if (splitViewDisabled.value) return;
  viewMode.value = 'split';
}

watch(splitViewDisabled, (disabled) => {
  if (disabled && viewMode.value === 'split') {
    viewMode.value = 'edit';
  }
});

// Hybrid save mode: tracks which fields were AI-decided (shown as disabled)
const hybridMode = ref(false);
const hybridProjectLocked = ref(false);
const hybridDirectoryLocked = ref(false);
const hybridFormattedContent = ref<string | null>(null);
const hybridRunningAI = ref(false);

// Text selection state (for Send to Chat feature)
const selectionText = ref('');
const selectionStartLine = ref(1);
const selectionEndLine = ref(1);
const selectionPosition = ref<{ x: number; y: number } | null>(null);
const showSelectionButton = ref(false);
let selectionHideTimeout: ReturnType<typeof setTimeout> | null = null;

// Helper to calculate line number from character offset
function getLineNumberFromOffset(text: string, offset: number): number {
  const textUpToOffset = text.substring(0, offset);
  return (textUpToOffset.match(/\n/g) || []).length + 1;
}

const hasChanges = computed(() => content.value !== originalContent.value);
const isNewNote = computed(() => !props.currentFile);

// Version navigation computed
const isViewingOldVersion = computed(() => currentVersionIndex.value > 0 && currentVersionIndex.value < totalVersions.value);
const canGoBack = computed(() => currentVersionIndex.value < totalVersions.value);
const canGoForward = computed(() => currentVersionIndex.value > 0);

const autosaveEnabled = computed(() => !!props.onAutosave);

const { status: autoSaveStatus, cancelPending: cancelAutoSave } = useIdleAutoSave({
  content,
  savedBaseline: originalContent,
  fileId: computed(() => props.currentFile?.id ?? null),
  isBlocked: isViewingOldVersion,
  enabled: autosaveEnabled,
  onAutosave: async (contentToSave) => {
    if (!props.currentFile || !props.onAutosave) return false;
    return props.onAutosave(contentToSave, props.currentFile);
  },
});

const autoSaveStatusText = computed(() => autoSaveStatusLabel(autoSaveStatus.value));

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

function injectDateChips(html: string, dates: DetectedDate[]): string {
  if (dates.length === 0) return html;

  let result = html;
  const sorted = [...dates].sort((a, b) => b.text.length - a.text.length);
  const replaced = new Set<string>();

  for (const d of sorted) {
    const dateText = d.text;
    if (replaced.has(dateText)) continue;

    const isoDate = d.date.toISOString().split('T')[0];
    const isPast = d.type === 'deadline' && d.date < new Date();
    const chipClass = d.type === 'deadline'
      ? (isPast ? 'date-chip deadline overdue' : 'date-chip deadline')
      : 'date-chip';

    const escapedText = dateText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<![\\w-])${escapedText}(?![\\w-])(?![^<]*>)`, 'g');

    const replacement = `<span class="${chipClass}" data-date="${isoDate}" data-type="${d.type}" data-original="${dateText.replace(/"/g, '&quot;')}" data-context="${(d.context || '').replace(/"/g, '&quot;')}">${dateText}</span>`;

    result = result.replace(regex, replacement);
    replaced.add(dateText);
  }

  return result;
}

const COPY_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

/**
 * Wrap each rendered code block in a `.code-block-wrapper` carrying a
 * copy-to-clipboard button. Mermaid blocks are untouched (they render as
 * `<div class="mermaid-diagram">`, not `<pre>`). Clicks are handled via the
 * existing `handlePreviewClick` delegation.
 */
function injectCopyButtons(html: string): string {
  if (!html.includes('<pre>')) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return html;
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    const wrapper = doc.createElement('div');
    wrapper.className = 'code-block-wrapper';
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'code-copy-btn';
    btn.title = 'Copy code';
    btn.setAttribute('aria-label', 'Copy code');
    btn.innerHTML = COPY_ICON_SVG;
    pre.replaceWith(wrapper);
    wrapper.appendChild(btn);
    wrapper.appendChild(pre);
  }
  return root.innerHTML;
}

/**
 * Turn literal [[path]] text in preview HTML into clickable .wikilink spans.
 * Skips text inside code/pre/anchors.
 */
function injectWikilinks(html: string): string {
  if (!html.includes('[[')) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return html;

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (!parent) continue;
    if (parent.closest('code, pre, a, .wikilink, script, style')) continue;
    if (!/\[\[[^\]]+\]\]/.test(node.textContent || '')) continue;
    targets.push(node);
  }

  for (const node of targets) {
    const text = node.textContent || '';
    const frag = doc.createDocumentFragment();
    let last = 0;
    const re = /\[\[([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
      }
      const raw = m[1].trim();
      const span = doc.createElement('span');
      span.className = 'wikilink';
      span.dataset.wikilink = raw;
      span.textContent = raw;
      span.title = `Open ${raw}`;
      frag.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      frag.appendChild(doc.createTextNode(text.slice(last)));
    }
    node.parentNode?.replaceChild(frag, node);
  }

  return root.innerHTML;
}

const renderedContent = computed(() => {
  if (!content.value.trim()) {
    return '<p class="placeholder-text">Preview will appear here...</p>';
  }
  imageBlobUrls.value;
  let html = marked.parse(content.value, { async: false }) as string;

  const dates = detectDates(content.value);
  if (dates.length > 0) {
    html = injectDateChips(html, dates);
  }

  html = injectWikilinks(html);
  html = rewriteCalloutHtml(html);

  return injectCopyButtons(injectHeadingIds(html));
});

// Normalize a relative image path against the current file's directory
// e.g. current file "ai-news/ai-news.md" + href "../images/foo.png" → "images/foo.png"
function normalizeImagePath(href: string): string {
  if (!href.includes('..') && !href.startsWith('./')) return href;

  const currentFilePath = props.currentFile?.name || '';
  const currentDir = currentFilePath.includes('/')
    ? currentFilePath.substring(0, currentFilePath.lastIndexOf('/'))
    : '';

  const parts = currentDir ? currentDir.split('/') : [];
  for (const segment of href.split('/')) {
    if (segment === '..') {
      parts.pop();
    } else if (segment !== '.') {
      parts.push(segment);
    }
  }
  return parts.join('/');
}

// Resolve project-relative image paths to blob URLs for preview rendering
const pendingImagePaths = new Set<string>();
watch(
  () => content.value,
  async (newContent) => {
    if (!props.currentProject) return;

    const imagePathRegex = /!\[.*?\]\(([^)]+)\)/g;
    let match;
    const pathsToResolve: string[] = [];

    while ((match = imagePathRegex.exec(newContent)) !== null) {
      const href = match[1];
      if (href.startsWith('data:') || href.startsWith('http://') || href.startsWith('https://')) continue;
      if (imageBlobUrls.value.has(href) || pendingImagePaths.has(href)) continue;
      pathsToResolve.push(href);
    }

    for (const imgPath of pathsToResolve) {
      pendingImagePaths.add(imgPath);
      try {
        // Normalize relative paths (e.g. ../images/foo.png) to project-root-relative
        const resolvedPath = normalizeImagePath(imgPath);
        const file = await findFileByPath(props.currentProject.id, resolvedPath);
        if (!file?.binaryData && resolvedPath !== imgPath) {
          // Fallback: try the original path as-is
          const fallback = await findFileByPath(props.currentProject.id, imgPath);
          if (fallback?.binaryData) {
            const ext = imgPath.split('.').pop()?.toLowerCase() || 'png';
            const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
            const mimeType = mimeMap[ext] || 'image/png';
            const blobUrl = `data:${mimeType};base64,${fallback.binaryData}`;
            const updated = new Map(imageBlobUrls.value);
            updated.set(imgPath, blobUrl);
            imageBlobUrls.value = updated;
            continue;
          }
        }
        if (file?.binaryData) {
          const ext = imgPath.split('.').pop()?.toLowerCase() || 'png';
          const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
          const mimeType = mimeMap[ext] || 'image/png';
          const blobUrl = `data:${mimeType};base64,${file.binaryData}`;
          const updated = new Map(imageBlobUrls.value);
          updated.set(imgPath, blobUrl);
          imageBlobUrls.value = updated;
        }
      } catch {
        // Silently skip unresolvable paths
      } finally {
        pendingImagePaths.delete(imgPath);
      }
    }
  },
  { immediate: true }
);

// Clean up blob URLs when component unmounts
onUnmounted(() => {
  imageBlobUrls.value.clear();
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
    // Open existing markdown files in Live (WYSIWYG) mode by default
    if (newFile.id !== oldFile?.id) {
      viewMode.value = 'hybrid';
      resetVersionNavigation();
      void loadVersionCount();
    }
  } else {
    // New note - use edit mode (raw markdown textarea)
    viewMode.value = 'edit';
    showActionsMenu.value = false;
    resetVersionNavigation();
    void loadVersionCount();
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
  if (viewMode.value === 'view' || viewMode.value === 'split' || viewMode.value === 'hybrid') {
    debouncedRenderMermaid();
  }
});

// Watch for view mode changes to render mermaid diagrams
watch(viewMode, (newMode) => {
  if (newMode !== 'edit' && newMode !== 'split') {
    closeTextareaSlashMenu();
    closeTextareaWikilinkMenu();
  }
  if (newMode === 'view' || newMode === 'split' || newMode === 'hybrid') {
    debouncedRenderMermaid();
  }
});

function handleInput() {
  emit('content-change', content.value);
}

function onHybridSelectionSnapshot() {
  setTimeout(() => {
    handleSelectionChange();
  }, 10);
}

// ============================================
// Text Selection Detection (for Send to Chat)
// ============================================

function handleSelectionChange() {
  // Clear any pending hide timeout
  if (selectionHideTimeout) {
    clearTimeout(selectionHideTimeout);
    selectionHideTimeout = null;
  }

  let selectedText = '';
  let startLine = 1;
  let endLine = 1;
  let position: { x: number; y: number } | null = null;

  if (viewMode.value === 'edit') {
    // Handle textarea selection
    const textarea = editorRef.value;
    if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
      selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
      startLine = getLineNumberFromOffset(textarea.value, textarea.selectionStart);
      endLine = getLineNumberFromOffset(textarea.value, textarea.selectionEnd);
      // Get position from textarea - use getBoundingClientRect
      const rect = textarea.getBoundingClientRect();
      // Position button at the top-right of the textarea selection area
      position = {
        x: rect.right - 100,
        y: rect.top + 10,
      };
    }
  } else if (viewMode.value === 'split') {
    // Handle split mode - check both textarea and preview
    const textarea = splitEditorRef.value;
    if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
      selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
      startLine = getLineNumberFromOffset(textarea.value, textarea.selectionStart);
      endLine = getLineNumberFromOffset(textarea.value, textarea.selectionEnd);
      const rect = textarea.getBoundingClientRect();
      position = {
        x: rect.right - 100,
        y: rect.top + 10,
      };
    } else {
      // Check preview selection - for preview, we try to find the text in original content
      const selection = window.getSelection();
      if (selection && selection.toString().trim()) {
        // Verify selection is within our preview pane
        const previewPane = editorContentRef.value?.querySelector('.split-preview');
        if (previewPane && selection.anchorNode && previewPane.contains(selection.anchorNode)) {
          selectedText = selection.toString();
          // Try to find this text in the content to get line numbers
          const textIndex = content.value.indexOf(selectedText);
          if (textIndex !== -1) {
            startLine = getLineNumberFromOffset(content.value, textIndex);
            endLine = getLineNumberFromOffset(content.value, textIndex + selectedText.length);
          }
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          position = {
            x: rect.right + 10,
            y: rect.top,
          };
        }
      }
    }
  } else if (viewMode.value === 'hybrid') {
    const sel = hybridEditorRef.value?.getSelectionText?.();
    if (sel && sel.text.trim()) {
      selectedText = sel.text;
      // Tiptap selection is HTML-DOM based; map text back into the markdown
      // source by string search so chat can show file:line references.
      const idx = content.value.indexOf(selectedText);
      if (idx !== -1) {
        startLine = getLineNumberFromOffset(content.value, idx);
        endLine = getLineNumberFromOffset(content.value, idx + selectedText.length);
      }
      const winSel = window.getSelection();
      if (winSel && winSel.rangeCount > 0) {
        const rect = winSel.getRangeAt(0).getBoundingClientRect();
        position = { x: rect.right + 10, y: rect.top };
      }
    }
  } else if (viewMode.value === 'view') {
    // Handle preview selection
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      // Verify selection is within our preview pane
      const previewPane = editorContentRef.value?.querySelector('.preview-pane.full');
      if (previewPane && selection.anchorNode && previewPane.contains(selection.anchorNode)) {
        selectedText = selection.toString();
        // Try to find this text in the content to get line numbers
        const textIndex = content.value.indexOf(selectedText);
        if (textIndex !== -1) {
          startLine = getLineNumberFromOffset(content.value, textIndex);
          endLine = getLineNumberFromOffset(content.value, textIndex + selectedText.length);
        }
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        position = {
          x: rect.right + 10,
          y: rect.top,
        };
      }
    }
  }

  if (selectedText.trim()) {
    selectionText.value = selectedText.trim();
    selectionStartLine.value = startLine;
    selectionEndLine.value = endLine;
    selectionPosition.value = position;
    showSelectionButton.value = true;

    // Auto-hide after 4 seconds
    selectionHideTimeout = setTimeout(() => {
      hideSelectionButton();
    }, 4000);
  } else {
    hideSelectionButton();
  }
}

function hideSelectionButton() {
  showSelectionButton.value = false;
  selectionText.value = '';
  selectionPosition.value = null;
  if (selectionHideTimeout) {
    clearTimeout(selectionHideTimeout);
    selectionHideTimeout = null;
  }
}

function handleSendToChat() {
  if (selectionText.value.trim()) {
    const selectionContext: SelectionContext = {
      text: selectionText.value.trim(),
      filePath: props.currentFile?.name || null,
      fileId: props.currentFile?.id || null,
      startLine: selectionStartLine.value,
      endLine: selectionEndLine.value,
    };
    emit('selection-to-chat', selectionContext);
    hideSelectionButton();
    // Clear the selection
    window.getSelection()?.removeAllRanges();
  }
}

function handleEditorMouseUp() {
  // Small delay to ensure selection is complete
  setTimeout(() => {
    handleSelectionChange();
  }, 10);
}

function handleDocumentSelectionChange() {
  if (viewMode.value === 'view' || viewMode.value === 'split' || viewMode.value === 'hybrid') {
    handleSelectionChange();
  }
}

// Global Cmd/Ctrl+/ listener for shortcuts modal (works in all view modes)
function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === '/') {
    e.preventDefault();
    toggleShortcutsModal();
  }
}

// Setup and cleanup selection listeners
onMounted(() => {
  document.addEventListener('selectionchange', handleDocumentSelectionChange);
  document.addEventListener('keydown', handleGlobalKeydown);

  if (editorContainerRef.value) {
    editorContainerWidth.value = editorContainerRef.value.clientWidth;
    editorContainerObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        editorContainerWidth.value = entry.contentRect.width;
      }
    });
    editorContainerObserver.observe(editorContainerRef.value);
  }
});

onUnmounted(() => {
  document.removeEventListener('selectionchange', handleDocumentSelectionChange);
  document.removeEventListener('keydown', handleGlobalKeydown);
  editorContainerObserver?.disconnect();
  editorContainerObserver = null;
  if (selectionHideTimeout) {
    clearTimeout(selectionHideTimeout);
  }
  // Cleanup split resizer listeners
  stopSplitResize();
});

async function handleSave() {
  if (!content.value.trim()) return;

  cancelAutoSave();
  
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
  if (!isConfigured()) {
    await openManualSaveModal();
    return;
  }

  const autoFormat = isAutoFormatEnabled();
  const autoProject = isAutoProjectRoutingEnabled();
  const autoDirectory = isAutoDirectoryRoutingEnabled();

  // If all AI features are enabled → fully automatic flow
  if (autoFormat && autoProject && autoDirectory) {
    await saveNewNoteAutomatic();
    return;
  }

  // Hybrid flow: run AI for enabled features, then show modal for the rest
  await saveNewNoteHybrid(autoFormat, autoProject, autoDirectory);
}

async function saveNewNoteAutomatic() {
  saving.value = true;
  executionSteps.value = [];

  const onProgress = (steps: NoteExecutionStep[]) => {
    executionSteps.value = [...steps];
  };

  try {
    let result = await globalAddNote({ rawNoteText: content.value }, onProgress);

    if (result.pendingConfirmation) {
      const toast = await toastController.create({
        message: `Creating project "${result.pendingConfirmation.proposedProjectName}"...`,
        duration: 2000,
        position: 'top',
        color: 'primary',
      });
      await toast.present();

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

async function saveNewNoteHybrid(autoFormat: boolean, autoProject: boolean, autoDirectory: boolean) {
  hybridMode.value = true;
  hybridProjectLocked.value = false;
  hybridDirectoryLocked.value = false;
  hybridFormattedContent.value = null;
  hybridRunningAI.value = true;
  saving.value = true;
  executionSteps.value = [];

  try {
    // Phase 1: Run AI for all enabled features in parallel
    const aiPromises: Promise<void>[] = [];
    let aiTitle = '';
    let aiProjectId: string | null = null;
    let aiProjectName = '';
    let aiDirectory = '';
    let formattedText = content.value;

    // Build parallel AI tasks
    const titlePromise = generateNoteTitle(content.value).then(t => { aiTitle = t; });
    aiPromises.push(titlePromise);

    if (autoFormat) {
      const formatPromise = formatNote(content.value).then(f => { formattedText = f; });
      aiPromises.push(formatPromise);

      executionSteps.value = [
        { id: 'format', status: 'running', label: 'Formatting note' },
        ...executionSteps.value.filter(s => s.id !== 'format'),
      ];
    }

    if (autoProject) {
      const projectPromise = decideTargetProject(content.value).then(async decision => {
        if (decision.action === 'create_project') {
          const newProject = await createProject(
            decision.proposedProjectName || 'New Project',
            decision.proposedProjectDescription,
          );
          aiProjectId = newProject.id;
          aiProjectName = newProject.name;
        } else if (decision.targetProjectId) {
          aiProjectId = decision.targetProjectId;
          const projects = await getAllProjects();
          const found = projects.find(p => p.id === decision.targetProjectId);
          aiProjectName = found?.name || '';
        }
      });
      aiPromises.push(projectPromise);

      executionSteps.value = [
        ...executionSteps.value,
        { id: 'project', status: 'running', label: 'Deciding project' },
      ];
    }

    await Promise.all(aiPromises);

    // Phase 1b: If project was AI-decided and directory routing is enabled, run directory routing
    if (autoDirectory && aiProjectId) {
      executionSteps.value = executionSteps.value.map(s =>
        s.id === 'project' ? { ...s, status: 'completed' as const, detail: aiProjectName } : s
      );
      executionSteps.value = [
        ...executionSteps.value,
        { id: 'directory', status: 'running', label: 'Choosing directory' },
      ];

      const existingDirs = await getProjectDirectories(aiProjectId);
      const dirDecision = await decideNoteDirectoryWithDirs(aiProjectId, aiTitle, existingDirs);
      aiDirectory = dirDecision.targetDirectory;

      executionSteps.value = executionSteps.value.map(s =>
        s.id === 'directory' ? { ...s, status: 'completed' as const, detail: aiDirectory } : s
      );
    }

    // Mark completed steps
    executionSteps.value = executionSteps.value.map(s =>
      s.status === 'running' ? { ...s, status: 'completed' as const } : s
    );

    hybridFormattedContent.value = formattedText;
    hybridRunningAI.value = false;
    saving.value = false;

    // Phase 2: Load data for the modal
    availableProjects.value = await getAllProjects();

    // Pre-fill modal fields with AI results
    const slug = titleToSlug(aiTitle);
    manualSaveFileName.value = slug ? `${slug}.md` : getDefaultFileName();

    if (autoProject && aiProjectId) {
      manualSaveProjectId.value = aiProjectId;
      hybridProjectLocked.value = true;
      manualSaveCreatingNewProject.value = false;
      // Load directories for the AI-selected project
      try {
        availableDirectories.value = await getProjectDirectories(aiProjectId);
      } catch { availableDirectories.value = []; }
    } else {
      manualSaveProjectId.value = props.defaultProjectId ?? props.currentProject?.id ?? null;
      hybridProjectLocked.value = false;
      manualSaveCreatingNewProject.value = false;
      if (manualSaveProjectId.value) {
        try {
          availableDirectories.value = await getProjectDirectories(manualSaveProjectId.value);
        } catch { availableDirectories.value = []; }
      } else {
        availableDirectories.value = [];
      }
    }

    if (autoDirectory && aiDirectory) {
      manualSaveDirectory.value = aiDirectory;
      hybridDirectoryLocked.value = true;
      manualSaveCreatingNewDirectory.value = false;
    } else {
      manualSaveDirectory.value = '';
      hybridDirectoryLocked.value = false;
      manualSaveCreatingNewDirectory.value = false;
    }

    manualSaveNewProjectName.value = '';
    manualSaveNewDirectoryName.value = '';

    // Open the modal
    showManualSaveModal.value = true;
    executionSteps.value = [];

  } catch (error) {
    hybridRunningAI.value = false;
    saving.value = false;
    executionSteps.value = [];
    const toast = await toastController.create({
      message: 'An error occurred while processing',
      duration: 3000,
      position: 'top',
      color: 'danger',
    });
    await toast.present();
  }
}

// ============================================
// Manual Save (no AI provider)
// ============================================

function getDefaultFileName(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `note-${yyyy}-${mm}-${dd}.md`;
}

async function openManualSaveModal() {
  // Reset hybrid state — this is a fully manual save
  hybridMode.value = false;
  hybridProjectLocked.value = false;
  hybridDirectoryLocked.value = false;
  hybridFormattedContent.value = null;
  hybridRunningAI.value = false;

  manualSaveProjectId.value = props.defaultProjectId ?? props.currentProject?.id ?? null;
  manualSaveNewProjectName.value = '';
  manualSaveDirectory.value = '';
  manualSaveNewDirectoryName.value = '';
  manualSaveFileName.value = getDefaultFileName();
  manualSaveCreatingNewProject.value = false;
  manualSaveCreatingNewDirectory.value = false;
  availableDirectories.value = [];

  try {
    availableProjects.value = await getAllProjects();
    if (manualSaveProjectId.value) {
      availableDirectories.value = await getProjectDirectories(manualSaveProjectId.value);
    }
  } catch {
    availableProjects.value = [];
  }

  showManualSaveModal.value = true;
}

function handleSaveModalDismiss() {
  showManualSaveModal.value = false;
  hybridMode.value = false;
  hybridProjectLocked.value = false;
  hybridDirectoryLocked.value = false;
  hybridFormattedContent.value = null;
}

function toggleNewProject() {
  manualSaveCreatingNewProject.value = !manualSaveCreatingNewProject.value;
  if (manualSaveCreatingNewProject.value) {
    manualSaveProjectId.value = null;
    manualSaveNewProjectName.value = '';
    availableDirectories.value = [];
    manualSaveDirectory.value = '';
    manualSaveCreatingNewDirectory.value = false;
    manualSaveNewDirectoryName.value = '';
  } else {
    manualSaveNewProjectName.value = '';
  }
}

function toggleNewDirectory() {
  manualSaveCreatingNewDirectory.value = !manualSaveCreatingNewDirectory.value;
  if (manualSaveCreatingNewDirectory.value) {
    manualSaveDirectory.value = '';
    manualSaveNewDirectoryName.value = '';
  } else {
    manualSaveNewDirectoryName.value = '';
  }
}

async function handleManualProjectChange() {
  manualSaveDirectory.value = '';
  hybridDirectoryLocked.value = false;
  if (!manualSaveProjectId.value) {
    availableDirectories.value = [];
    return;
  }
  try {
    const dirs = await getProjectDirectories(manualSaveProjectId.value);
    availableDirectories.value = dirs;

    // If in hybrid mode and directory routing is enabled, auto-decide directory
    if (hybridMode.value && isAutoDirectoryRoutingEnabled() && manualSaveFileName.value) {
      const title = manualSaveFileName.value.replace(/\.md$/, '');
      const dirDecision = await decideNoteDirectoryWithDirs(
        manualSaveProjectId.value,
        title,
        dirs,
      );
      manualSaveDirectory.value = dirDecision.targetDirectory;
      hybridDirectoryLocked.value = true;
    }
  } catch {
    availableDirectories.value = [];
  }
}

const canManualSave = computed(() => {
  const hasProject = manualSaveCreatingNewProject.value
    ? manualSaveNewProjectName.value.trim().length > 0
    : !!manualSaveProjectId.value;
  const hasFileName = manualSaveFileName.value.trim().length > 0;
  return hasProject && hasFileName;
});

async function handleManualSave() {
  if (!canManualSave.value) return;

  manualSaving.value = true;

  try {
    let projectId: string;
    let projectName: string;
    let newProjectCreated = false;

    if (manualSaveCreatingNewProject.value) {
      const newProject = await createProject(
        manualSaveNewProjectName.value.trim(),
      );
      projectId = newProject.id;
      projectName = newProject.name;
      newProjectCreated = true;
    } else {
      projectId = manualSaveProjectId.value!;
      const project = availableProjects.value.find(p => p.id === projectId);
      projectName = project?.name || '';
    }

    let fileName = manualSaveFileName.value.trim();
    if (!fileName.endsWith('.md')) {
      fileName += '.md';
    }

    const slug = fileName.replace(/\.md$/, '');
    const directory = manualSaveCreatingNewDirectory.value
      ? manualSaveNewDirectoryName.value.trim()
      : manualSaveDirectory.value;
    const uniqueFileName = await generateUniqueFileName(projectId, slug, directory);

    // In hybrid mode, use AI-formatted content; otherwise use raw content
    const noteContent = (hybridMode.value && hybridFormattedContent.value)
      ? hybridFormattedContent.value
      : content.value;

    const file = await persistNote(
      projectId,
      uniqueFileName,
      directory,
      noteContent,
    );

    // Store original (pre-formatting) content in version history if formatted
    if (hybridMode.value && hybridFormattedContent.value && hybridFormattedContent.value !== content.value) {
      await createFormatVersion(file.id, content.value);
    }

    await indexNote(file);
    await updateProjectStatus(projectId, 'indexed');
    await flushDatabase();

    showManualSaveModal.value = false;

    const toast = await toastController.create({
      message: `Note saved to "${projectName}"`,
      duration: 3000,
      position: 'top',
      color: 'success',
    });
    await toast.present();

    content.value = '';
    originalContent.value = '';
    hybridMode.value = false;
    hybridFormattedContent.value = null;
    emit('note-saved', {
      success: true,
      projectId,
      projectName,
      newProjectCreated,
      filePath: file.name,
      title: slug,
      fileId: file.id,
    });
  } catch (error) {
    const toast = await toastController.create({
      message: error instanceof Error ? error.message : 'Failed to save note',
      duration: 3000,
      position: 'top',
      color: 'danger',
    });
    await toast.present();
  } finally {
    manualSaving.value = false;
  }
}

// ============================================
// Actions Menu Handlers
// ============================================

function handleOpenFormatStudio() {
  showActionsMenu.value = false;
  showFormatStudio.value = true;
}

async function handleGenerateMeetingNotes() {
  showActionsMenu.value = false;
  if (!content.value.trim() || generatingMeetingNotes.value) return;

  generatingMeetingNotes.value = true;
  try {
    const response = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: `You are a meeting notes assistant. Given a meeting transcript, extract structured meeting notes in Markdown format. Include:

## Meeting Summary
A 2-3 sentence overview of the meeting.

## Key Decisions
- List any decisions that were made

## Action Items
- [ ] Task — Owner (if identifiable)

## Discussion Points
- Key topics discussed with brief context

## Open Questions
- Any unresolved questions

Be concise and actionable. Use checkbox syntax for action items. If attendees are identifiable from the transcript, include them.`,
        },
        {
          role: 'user',
          content: `Generate meeting notes from this transcript:\n\n${content.value}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 2000,
    });

    const meetingNotes = response.content;
    const separator = '\n\n---\n\n';
    content.value = meetingNotes + separator + '## Original Transcript\n\n' + content.value;
    emit('content-change', content.value);
  } catch {
    // Silently fail
  } finally {
    generatingMeetingNotes.value = false;
  }
}

// ============================================
// Export Handlers
// ============================================

async function handleExport(format: DocumentFormat) {
  showActionsMenu.value = false;
  
  // Get title from file name or use default
  const title = props.currentFile?.name 
    ? getBaseName(props.currentFile.name)
    : 'Untitled Note';
  
  // Use export service
  const result = await exportToFile(title, content.value, format);
  
  // Show feedback
  if (result.success) {
    const toast = await toastController.create({
      message: `Exported as ${result.fileName}`,
      duration: 2000,
      position: 'top',
      color: 'success',
    });
    await toast.present();
  } else {
    const toast = await toastController.create({
      message: result.error || 'Failed to export file',
      duration: 3000,
      position: 'top',
      color: result.error === 'No content to export' ? 'warning' : 'danger',
    });
    await toast.present();
  }
}

async function handleFormatApply(formattedContent: string) {
  if (props.currentFile) {
    await createFormatVersion(props.currentFile.id, content.value);
  }

  content.value = formattedContent;
  showFormatStudio.value = false;

  if (props.currentFile) {
    emit('save', formattedContent, props.currentFile);
    originalContent.value = formattedContent;
  }

  const toast = await toastController.create({
    message: 'Formatted version applied and saved',
    duration: 2000,
    position: 'top',
    color: 'success',
  });
  await toast.present();
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

function discardChanges() {
  if (props.currentFile) {
    content.value = originalContent.value;
  } else {
    clearContent();
  }
  cancelAutoSave();
}

function focusEditor() {
  if (viewMode.value === 'hybrid') {
    hybridEditorRef.value?.focusEditor();
    return;
  }
  const editor = editorRef.value || splitEditorRef.value;
  editor?.focus();
}

function insertAtCursor(text: string) {
  // Switch to edit mode if in view-only mode so the textarea is available
  if (viewMode.value === 'view') {
    viewMode.value = 'edit';
  }

  nextTick(() => {
    if (viewMode.value === 'hybrid') {
      hybridEditorRef.value?.insertAtCursor(text);
      emit('content-change', content.value);
      return;
    }
    const editor = editorRef.value || splitEditorRef.value;
    if (!editor) {
      const needsNewline = content.value.length > 0 && !content.value.endsWith('\n');
      content.value += (needsNewline ? '\n' : '') + text + '\n';
      emit('content-change', content.value);
      return;
    }

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const before = content.value.substring(0, start);
    const after = content.value.substring(end);

    const needsNewline = before.length > 0 && !before.endsWith('\n');
    const insertion = (needsNewline ? '\n' : '') + text + '\n';

    content.value = before + insertion + after;
    emit('content-change', content.value);

    nextTick(() => {
      const newPos = start + insertion.length;
      editor.selectionStart = newPos;
      editor.selectionEnd = newPos;
      editor.focus();
    });
  });
}

defineExpose({
  setContent,
  clearContent,
  focusEditor,
  hasChanges,
  insertAtCursor,
  saveCurrent: handleSave,
  discardChanges,
});
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

.autosave-status {
  font-size: 12px;
  color: var(--hn-text-muted);
  line-height: 1;
  flex-shrink: 0;
  margin-left: 2px;
}

.shortcuts-hint-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: var(--hn-text-muted);
  transition: all 0.15s ease;
  flex-shrink: 0;
  margin-left: 4px;
}

.shortcuts-hint-btn:hover {
  color: var(--hn-text-secondary);
  background: var(--hn-bg-hover);
}

.shortcuts-hint-btn ion-icon {
  font-size: 14px;
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

.mode-btn.disabled,
.mode-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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

.actions-popover-content ion-item-divider.export-divider {
  --background: transparent;
  --color: var(--hn-text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  --padding-start: 12px;
  --padding-end: 12px;
  --padding-top: 10px;
  --padding-bottom: 4px;
  min-height: 28px;
  border-top: 1px solid var(--hn-border-subtle);
  margin-top: 4px;
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

.editor-workspace {
  display: flex;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  width: 100%;
}

.editor-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.editor-main :deep(.live-editor-host) {
  flex: 1;
  min-height: 0;
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
  min-width: 0;
  overflow: hidden;
}

.split-pane .editor-pane {
  flex: none;
  width: 50%;
  overflow: hidden;
}

.split-pane .split-preview {
  flex: none;
  width: 50%;
  overflow-y: auto;
  overflow-x: auto;
  padding: 20px 24px;
}

.split-resizer {
  flex: none;
  width: 4px;
  cursor: col-resize;
  background: var(--hn-border-default);
  transition: background 0.15s ease;
  position: relative;
  z-index: 2;
}

.split-resizer:hover,
.split-resizer:active {
  background: var(--hn-accent-primary, #58a6ff);
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

.markdown-preview :deep(.code-block-wrapper) {
  position: relative;
}

.markdown-preview :deep(.code-copy-btn) {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid var(--hn-border-default);
  background: var(--hn-bg-elevated);
  color: var(--hn-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease;
  z-index: 1;
}

.markdown-preview :deep(.code-block-wrapper:hover .code-copy-btn),
.markdown-preview :deep(.code-copy-btn:focus-visible) {
  opacity: 1;
}

.markdown-preview :deep(.code-copy-btn:hover) {
  color: var(--hn-text-primary);
  background: var(--hn-bg-hover);
}

.markdown-preview :deep(.code-copy-btn.copied) {
  color: var(--hn-teal);
  opacity: 1;
}

/* Touch devices have no hover: keep the button visible at reduced opacity */
@media (hover: none) {
  .markdown-preview :deep(.code-copy-btn) {
    opacity: 0.6;
  }
}

.markdown-preview :deep(blockquote) {
  border-left: 4px solid var(--hn-teal);
  margin: 1.2em 0;
  padding: 0.6em 0 0.6em 1.2em;
  color: var(--hn-text-secondary);
  background: var(--hn-teal-muted);
  border-radius: 0 8px 8px 0;
}

.markdown-preview :deep(aside.callout) {
  margin: 1.2em 0;
  padding: 0.75em 1em;
  border-radius: 8px;
  border-left: 4px solid;
}

.markdown-preview :deep(aside.callout .callout-body) {
  margin: 0;
}

.markdown-preview :deep(aside.callout .callout-body > :first-child) {
  margin-top: 0;
}

.markdown-preview :deep(aside.callout .callout-body > :last-child) {
  margin-bottom: 0;
}

.markdown-preview :deep(aside.callout-note) {
  background: rgba(59, 130, 246, 0.1);
  border-left-color: #3b82f6;
}

.markdown-preview :deep(aside.callout-tip) {
  background: rgba(34, 197, 94, 0.1);
  border-left-color: #22c55e;
}

.markdown-preview :deep(aside.callout-warning) {
  background: rgba(245, 158, 11, 0.12);
  border-left-color: #f59e0b;
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

/* Wikilink Styles */
.markdown-preview :deep(.wikilink) {
  color: var(--hn-purple-light, #a78bfa);
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
  cursor: pointer;
}

.markdown-preview :deep(.wikilink:hover) {
  color: var(--hn-text-primary, #e0e0e0);
}

/* Date Chip Styles */
.markdown-preview :deep(.date-chip) {
  display: inline;
  padding: 1px 8px;
  border-radius: 6px;
  font-size: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
  background: rgba(66, 133, 244, 0.12);
  color: #7aafff;
  border: 1px solid rgba(66, 133, 244, 0.25);
}

.markdown-preview :deep(.date-chip:hover) {
  background: rgba(66, 133, 244, 0.22);
  border-color: rgba(66, 133, 244, 0.45);
}

.markdown-preview :deep(.date-chip.deadline) {
  background: rgba(251, 191, 36, 0.12);
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.3);
}

.markdown-preview :deep(.date-chip.deadline:hover) {
  background: rgba(251, 191, 36, 0.22);
  border-color: rgba(251, 191, 36, 0.5);
}

.markdown-preview :deep(.date-chip.deadline.overdue) {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.3);
}

.markdown-preview :deep(.date-chip.deadline.overdue:hover) {
  background: rgba(239, 68, 68, 0.22);
  border-color: rgba(239, 68, 68, 0.5);
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

/* Manual Save Modal */
ion-modal ion-content.manual-save-modal-content {
  --background: var(--hn-bg-deep);
}

.manual-save-description {
  color: var(--hn-text-secondary);
  font-size: 0.9rem;
  margin-bottom: 20px;
  line-height: 1.5;
}

.manual-save-field {
  margin-bottom: 18px;
}

.manual-save-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--hn-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.manual-save-project-select {
  display: flex;
  align-items: center;
  gap: 6px;
}

.manual-save-project-select .manual-save-select,
.manual-save-project-select .manual-save-input {
  flex: 1;
}

.manual-save-select {
  --background: var(--hn-bg-surface);
  --color: var(--hn-text-primary);
  --placeholder-color: var(--hn-text-muted);
  --border-radius: 8px;
  --padding-start: 12px;
  --padding-end: 12px;
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
}

.manual-save-input {
  --background: var(--hn-bg-surface);
  --color: var(--hn-text-primary);
  --placeholder-color: var(--hn-text-muted);
  --border-radius: 8px;
  --padding-start: 12px;
  --padding-end: 12px;
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
}

.manual-save-input:focus-within {
  border-color: var(--hn-teal);
}

.manual-save-toggle-btn {
  --color: var(--hn-text-secondary);
  flex-shrink: 0;
}

.manual-save-toggle-btn:hover {
  --color: var(--hn-teal);
}

.manual-save-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--hn-text-muted);
  font-size: 0.8rem;
  padding: 10px 12px;
  background: var(--hn-bg-surface);
  border-radius: 6px;
  border: 1px solid var(--hn-border-subtle);
  margin-top: 24px;
}

.manual-save-hint ion-icon {
  font-size: 16px;
  flex-shrink: 0;
  color: var(--hn-teal);
  margin-top: 1px;
}

.manual-save-hint.hybrid-hint {
  border-color: var(--hn-purple);
}

.manual-save-hint.hybrid-hint ion-icon {
  color: var(--hn-purple);
}

.ai-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--hn-purple);
  background: rgba(168, 85, 247, 0.15);
  border-radius: 4px;
  margin-left: 6px;
  vertical-align: middle;
}

.field-locked {
  opacity: 0.7;
  pointer-events: none;
}

.modal-footer ion-toolbar {
  --background: var(--hn-bg-surface);
  --border-color: var(--hn-border-default);
  padding: 4px 8px;
}

.modal-confirm-btn {
  --background: linear-gradient(135deg, var(--hn-green) 0%, var(--hn-teal) 100%);
  --color: #ffffff;
  --border-radius: 8px;
  --padding-start: 20px;
  --padding-end: 20px;
}

.modal-confirm-btn:disabled {
  opacity: 0.5;
}

/* Keyboard Shortcuts Modal */
ion-modal ion-content.shortcuts-modal-content {
  --background: var(--hn-bg-deep);
}

.shortcuts-group {
  margin-bottom: 20px;
}

.shortcuts-group-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--hn-text-muted);
  margin: 0 0 8px 0;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--hn-border-subtle);
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 4px;
  border-radius: 6px;
  gap: 12px;
}

.shortcut-row:hover {
  background: var(--hn-bg-surface);
}

.shortcut-description {
  font-size: 0.875rem;
  color: var(--hn-text-primary);
}

.shortcut-keys {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.shortcut-keys kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--hn-text-secondary);
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 4px;
  white-space: nowrap;
}
</style>

<!-- Global styles for teleported button -->
<style>
/* Selection to Chat floating button */
.selection-to-chat-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: linear-gradient(135deg, var(--hn-teal, #2dd4bf) 0%, var(--hn-purple, #a855f7) 100%);
  color: #ffffff;
  border: none;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(45, 212, 191, 0.4), 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: all 0.2s ease;
  white-space: nowrap;
  font-family: inherit;
}

.selection-to-chat-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(45, 212, 191, 0.5), 0 3px 6px rgba(0, 0, 0, 0.25);
}

.selection-to-chat-btn:active {
  transform: translateY(0);
  box-shadow: 0 2px 8px rgba(45, 212, 191, 0.3);
}

.selection-to-chat-btn ion-icon {
  font-size: 14px;
}

/* Fade transition for selection button */
.selection-fade-enter-active,
.selection-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.selection-fade-enter-from,
.selection-fade-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

.selection-fade-enter-to,
.selection-fade-leave-from {
  opacity: 1;
  transform: scale(1);
}
</style>

