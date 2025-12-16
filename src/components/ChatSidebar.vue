<template>
  <div class="chat-sidebar" :class="{ collapsed: isCollapsed }">
    <!-- Collapsed Vertical Tab -->
    <div v-if="isCollapsed" class="collapsed-tab" @click="toggleCollapse">
      <ion-icon :icon="chatbubbleOutline" />
      <span class="tab-label">Chat</span>
      <ion-icon :icon="chevronBackOutline" class="tab-chevron" />
    </div>

    <!-- Expanded Sidebar -->
    <template v-else>
      <!-- Sidebar Header -->
      <div class="sidebar-header">
        <div class="header-top">
          <ion-icon :icon="chatbubbleOutline" class="header-icon" />
          <span class="header-title">Chat</span>
        </div>
        <ion-button 
          fill="clear" 
          size="small" 
          class="collapse-btn"
          @click="toggleCollapse"
        >
          <ion-icon slot="icon-only" :icon="chevronForwardOutline" />
        </ion-button>
      </div>

      <!-- Project Selector -->
      <div class="project-selector-container">
        <div class="project-selector">
          <ion-select 
            v-model="selectedScope"
            interface="popover"
            placeholder="Select scope"
            class="project-select"
            @ionChange="handleScopeChange"
          >
            <ion-select-option value="__all__">
              🌐 All Projects
            </ion-select-option>
            <ion-select-option 
              v-for="project in projects" 
              :key="project.id" 
              :value="project.id"
            >
              {{ project.name }}
            </ion-select-option>
          </ion-select>
        </div>
      </div>

      <!-- Chat Content -->
      <div class="chat-content" ref="chatContentRef">
        <!-- Messages -->
        <template v-if="sessionReady">
          <!-- Welcome message when no messages -->
          <div v-if="messages.length === 0" class="welcome-message">
            <ion-icon :icon="sparklesOutline" class="welcome-icon" />
            <p>{{ isGlobalMode ? 'Ask questions across all projects' : 'Ask questions about your documents' }}</p>
            <div class="quick-actions">
              <button 
                v-for="action in currentQuickActions" 
                :key="action.text" 
                class="quick-action-btn"
                @click="sendMessage(action.text)"
              >
                <ion-icon :icon="action.icon" />
                <span>{{ action.label }}</span>
              </button>
            </div>
          </div>

          <!-- Message List -->
          <div v-for="message in messages" :key="message.id" :class="['message', message.role]">
            <div class="message-bubble">
              <div 
                v-if="message.role === 'assistant'" 
                class="message-content markdown-content" 
                v-html="renderMarkdown(message.content)"
              ></div>
              <div v-else class="message-content">{{ message.content }}</div>
              <div class="message-time">{{ formatTime(message.timestamp) }}</div>
            </div>
          </div>

          <!-- Typing Indicator + Streaming -->
          <div v-if="isTyping || streamingContent" class="message assistant">
            <div class="message-bubble">
              <!-- Streaming Content -->
              <div 
                v-if="streamingContent" 
                class="message-content markdown-content"
                v-html="renderMarkdown(streamingContent)"
              ></div>

              <!-- Current Step Indicator (always at bottom) -->
              <div v-if="currentStep && (currentStep.status === 'running' || !streamingContent)" class="current-step-indicator">
                <ion-spinner v-if="currentStep.status === 'running'" name="dots" class="step-spinner" />
                <ion-icon v-else-if="currentStep.status === 'completed'" :icon="checkmarkCircle" class="step-icon-done" />
                <ion-icon v-else-if="currentStep.status === 'error'" :icon="closeCircle" class="step-icon-error" />
                <span class="step-label">{{ currentStep.label }}</span>
                <span v-if="currentStep.detail" class="step-detail">{{ currentStep.detail }}</span>
              </div>
              
              <!-- Typing dots when no steps and no streaming -->
              <div v-if="!currentStep && !streamingContent" class="typing">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
            </div>
          </div>

          <!-- Update File Preview -->
          <div v-if="activePreview" class="update-preview">
            <div class="preview-header">
              <ion-icon :icon="createOutline" class="preview-icon" />
              <div class="preview-title">
                <span class="preview-label">File Update Preview</span>
                <span class="preview-filename">{{ activePreview.fileName }}</span>
              </div>
            </div>
            
            <div class="preview-info">
              <span class="info-item">
                <strong>Operation:</strong> {{ activePreview.operation }}
              </span>
              <span v-if="activePreview.confidence" class="info-item">
                <strong>Confidence:</strong> {{ Math.round(activePreview.confidence * 100) }}%
              </span>
            </div>

            <div class="diff-container">
              <div class="diff-header">Changes</div>
              <div class="diff-content">
                <div 
                  v-for="(line, index) in activePreview.diffLines.slice(0, 30)" 
                  :key="index"
                  :class="['diff-line', getDiffLineClass(line.type)]"
                >
                  <span class="diff-prefix">{{ getDiffLinePrefix(line.type) }}</span>
                  <span class="diff-text">{{ line.content || ' ' }}</span>
                </div>
                <div v-if="activePreview.diffLines.length > 30" class="diff-truncated">
                  ... {{ activePreview.diffLines.length - 30 }} more lines
                </div>
              </div>
            </div>

            <div class="preview-actions">
              <ion-button
                fill="outline"
                size="small"
                color="medium"
                :disabled="isApplyingUpdate"
                @click="handleCancelUpdate"
              >
                <ion-icon slot="start" :icon="closeOutline" />
                Cancel
              </ion-button>
              <ion-button
                size="small"
                color="success"
                :disabled="isApplyingUpdate"
                @click="handleApplyUpdate"
              >
                <ion-icon slot="start" :icon="checkmarkOutline" />
                {{ isApplyingUpdate ? 'Applying...' : 'Apply Changes' }}
              </ion-button>
            </div>
          </div>
        </template>
      </div>

      <!-- Chat Input -->
      <div class="chat-input" v-if="sessionReady" ref="inputContainerRef">
        <div class="input-container">
          <ion-textarea
            ref="textareaRef"
            v-model="inputMessage"
            :rows="1"
            :auto-grow="true"
            :placeholder="isGlobalMode ? 'Ask across all projects... (@ to reference files)' : 'Ask about your documents... (@ to reference files)'"
            :disabled="isTyping"
            @keydown="handleKeydown"
            @ionInput="handleInputChange"
          />
          <ion-button 
            fill="clear" 
            :disabled="!inputMessage.trim() || isTyping"
            @click="sendMessage()"
          >
            <ion-icon slot="icon-only" :icon="sendOutline" />
          </ion-button>
        </div>
      </div>

      <!-- File Reference Autocomplete -->
      <FileReferenceAutocomplete
        v-if="sessionReady"
        :project-id="selectedProjectId"
        :search-query="autocompleteQuery"
        :is-visible="showAutocomplete"
        :anchor-rect="autocompleteAnchorRect"
        @select="handleAutocompleteSelect"
        @close="closeAutocomplete"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick, computed } from 'vue';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import {
  IonIcon,
  IonButton,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonSpinner,
} from '@ionic/vue';
import {
  chatbubbleOutline,
  chatbubblesOutline,
  chevronBackOutline,
  chevronForwardOutline,
  sendOutline,
  sparklesOutline,
  searchOutline,
  bookOutline,
  documentTextOutline,
  checkmarkOutline,
  closeOutline,
  createOutline,
  checkmarkCircle,
  closeCircle,
} from 'ionicons/icons';
import type { Project, ChatMessage, SupportedFileType, UpdateFilePreview, DiffLine } from '@/types';
import type { ExecutionStep } from '@/services';
import {
  getOrCreateSession,
  addMessage,
  getMessages,
  buildSystemPrompt,
  buildGlobalSystemPrompt,
  isConfigured,
  orchestrateToolExecution,
  get_project_files,
  applyFileUpdate,
  removePendingPreview,
  getAllProjects,
  getAllFilesForAutocomplete,
  ensureFileSystemPermission,
} from '@/services';
import FileReferenceAutocomplete from './FileReferenceAutocomplete.vue';
import { folderOutline, addOutline } from 'ionicons/icons';

// Special value for "All Projects" scope
const ALL_PROJECTS_SCOPE = '__all__';

interface Props {
  projects: Project[];
  initialProjectId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'project-change', projectId: string): void;
  (e: 'collapse-change', collapsed: boolean): void;
  (e: 'file-updated', fileId: string, fileName: string): void;
  (e: 'projects-changed'): void;
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
          // Fall back
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

const isCollapsed = ref(false);
const selectedScope = ref<string>(ALL_PROJECTS_SCOPE); // Can be project ID or '__all__'
const selectedProjectId = ref<string | undefined>(undefined); // Actual project ID or undefined for global
const messages = ref<ChatMessage[]>([]);
const inputMessage = ref('');
const isTyping = ref(false);
const sessionId = ref('');
const sessionReady = ref(false); // Whether a session is loaded
const chatContentRef = ref<HTMLElement | null>(null);
const textareaRef = ref<InstanceType<typeof IonTextarea> | null>(null);
const inputContainerRef = ref<HTMLElement | null>(null);

// Computed properties for mode detection
const isGlobalMode = computed(() => selectedScope.value === ALL_PROJECTS_SCOPE);

// Autocomplete state
const showAutocomplete = ref(false);
const autocompleteQuery = ref('');
const autocompleteStartIndex = ref(-1);
const autocompleteAnchorRect = ref<DOMRect | null>(null);

// Update file preview state
const activePreview = ref<UpdateFilePreview | null>(null);
const isApplyingUpdate = ref(false);

// Streaming state
const executionSteps = ref<ExecutionStep[]>([]);
const streamingContent = ref('');

// Get the current/last step to display (prioritize running, then last completed)
const currentStep = computed(() => {
  if (executionSteps.value.length === 0) return null;
  const running = executionSteps.value.find(s => s.status === 'running');
  if (running) return running;
  return executionSteps.value[executionSteps.value.length - 1];
});

const projectQuickActions = [
  { text: 'What documents do I have?', label: 'List files', icon: documentTextOutline },
  { text: 'Search for key topics', label: 'Search', icon: searchOutline },
  { text: 'Summarize all documents', label: 'Summarize', icon: bookOutline },
];

const globalQuickActions = [
  { text: 'What projects do I have?', label: 'List projects', icon: folderOutline },
  { text: 'Search across all projects', label: 'Search all', icon: searchOutline },
  { text: 'Create a new project', label: 'New project', icon: addOutline },
];

const currentQuickActions = computed(() => 
  isGlobalMode.value ? globalQuickActions : projectQuickActions
);

onMounted(async () => {
  if (props.initialProjectId) {
    selectedScope.value = props.initialProjectId;
    selectedProjectId.value = props.initialProjectId;
  }
  await loadSession();
});

watch(() => props.initialProjectId, async (newId) => {
  if (newId && newId !== selectedProjectId.value) {
    selectedScope.value = newId;
    selectedProjectId.value = newId;
    await loadSession();
  }
});

async function loadSession() {
  // Set projectId based on scope
  if (selectedScope.value === ALL_PROJECTS_SCOPE) {
    selectedProjectId.value = undefined;
  } else {
    selectedProjectId.value = selectedScope.value;
  }
  
  // Get or create session (undefined for global, projectId for project-specific)
  const session = await getOrCreateSession(selectedProjectId.value);
  sessionId.value = session.id;
  messages.value = getMessages(session.id);
  sessionReady.value = true;
}

function handleScopeChange(event: CustomEvent) {
  const scope = event.detail.value;
  selectedScope.value = scope;
  
  if (scope !== ALL_PROJECTS_SCOPE) {
    emit('project-change', scope);
  }
  
  loadSession();
}

async function sendMessage(text?: string) {
  const messageText = text || inputMessage.value.trim();
  if (!messageText || !sessionReady.value) return;

  if (!isConfigured()) {
    // Could emit an event to show settings
    return;
  }

  // Ensure file system permission early (while user gesture is still active)
  // This allows project/file creation to work properly
  await ensureFileSystemPermission();

  inputMessage.value = '';

  // Add user message
  const userMessage = addMessage(sessionId.value, 'user', messageText);
  messages.value = [...messages.value, userMessage];
  
  await scrollToBottom();
  isTyping.value = true;
  executionSteps.value = [];
  streamingContent.value = '';

  try {
    // Build system prompt based on mode
    const systemPrompt = isGlobalMode.value
      ? await buildGlobalSystemPrompt()
      : await buildSystemPrompt(selectedProjectId.value!);
    
    const conversationHistory = messages.value.slice(0, -1).map(m => ({
      role: m.role,
      content: m.content,
    }));
    
    // Get file names based on mode
    let projectFileNames: string[];
    if (isGlobalMode.value) {
      const allFiles = await getAllFilesForAutocomplete();
      projectFileNames = allFiles.map(f => `${f.projectName}/${f.path}`);
    } else {
      const files = await get_project_files(selectedProjectId.value!);
      projectFileNames = files.map(f => f.name);
    }

    // Streaming callback - updates streamingContent as chunks arrive
    const handleStreamChunk = (chunk: string, done: boolean) => {
      if (done) return;
      streamingContent.value += chunk;
      scrollToBottom();
    };

    const result = await orchestrateToolExecution(
      selectedProjectId.value, // undefined for global mode
      messageText,
      systemPrompt,
      conversationHistory,
      projectFileNames,
      (steps) => {
        executionSteps.value = [...steps];
        scrollToBottom();
      },
      handleStreamChunk
    );

    // Check if there's an updateFile preview in the results
    const updateFileResult = result.toolResults.find(
      (r) => r.tool === 'updateFile' && r.success && (r as { preview?: UpdateFilePreview }).preview
    );
    if (updateFileResult) {
      const preview = (updateFileResult as { preview?: UpdateFilePreview }).preview;
      if (preview) {
        activePreview.value = preview;
      }
    }

    // Check if any files were created (write tool) or notes added (addNote tool)
    // and emit event to refresh the file tree
    const fileCreationResults = result.toolResults.filter(
      (r) => (r.tool === 'write' || r.tool === 'addNote') && r.success && r.metadata?.fileId
    );
    for (const fileResult of fileCreationResults) {
      if (fileResult.metadata?.fileId && fileResult.metadata?.fileName) {
        emit('file-updated', fileResult.metadata.fileId, fileResult.metadata.fileName);
      }
    }

    // Check if any project-level or file-level changes occurred
    // and emit event to refresh the project list and file tree
    const changeTools = ['createProject', 'deleteProject', 'moveFile', 'deleteFile', 'write', 'addNote'];
    const hasChanges = result.toolResults.some(
      (r) => changeTools.includes(r.tool) && r.success
    );
    if (hasChanges) {
      emit('projects-changed');
    }

    // Add the final assistant message(s) properly through addMessage
    if (result.responses && result.responses.length > 1) {
      for (const response of result.responses) {
        const assistantMessage = addMessage(sessionId.value, 'assistant', response);
        messages.value = [...messages.value, assistantMessage];
      }
    } else {
      const assistantMessage = addMessage(sessionId.value, 'assistant', result.response);
      messages.value = [...messages.value, assistantMessage];
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get response';
    const assistantMessage = addMessage(sessionId.value, 'assistant', `⚠️ Error: ${errorMessage}`);
    messages.value = [...messages.value, assistantMessage];
  } finally {
    isTyping.value = false;
    executionSteps.value = [];
    streamingContent.value = '';
    await scrollToBottom();
  }
}

function handleKeydown(event: KeyboardEvent) {
  // Handle Enter key for sending (only if autocomplete is not visible)
  if (event.key === 'Enter' && !event.shiftKey && !showAutocomplete.value) {
    event.preventDefault();
    sendMessage();
    return;
  }
  
  // Don't interfere with autocomplete navigation
  if (showAutocomplete.value) {
    if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Tab'].includes(event.key)) {
      // Let the autocomplete component handle these
      return;
    }
  }
}

function handleInputChange() {
  const value = inputMessage.value;
  const cursorPos = getCursorPosition();
  
  // Find if we're in an @ mention context
  const textBeforeCursor = value.substring(0, cursorPos);
  const atIndex = textBeforeCursor.lastIndexOf('@');
  
  if (atIndex !== -1) {
    const textAfterAt = textBeforeCursor.substring(atIndex + 1);
    
    // Check if there's a space after the @, which would end the mention
    if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
      // We're in an @ mention context
      autocompleteStartIndex.value = atIndex;
      autocompleteQuery.value = textAfterAt;
      showAutocomplete.value = true;
      updateAutocompletePosition();
      return;
    }
  }
  
  // Not in @ context
  closeAutocomplete();
}

function getCursorPosition(): number {
  // For IonTextarea, we need to get the actual textarea element
  const textarea = textareaRef.value?.$el?.querySelector('textarea');
  if (textarea) {
    return textarea.selectionStart || inputMessage.value.length;
  }
  return inputMessage.value.length;
}

function updateAutocompletePosition() {
  if (!inputContainerRef.value) return;
  
  // Get the input container's bounding rect
  const rect = inputContainerRef.value.getBoundingClientRect();
  autocompleteAnchorRect.value = rect;
}

function handleAutocompleteSelect(item: { id: string; name: string; path: string; type: SupportedFileType | 'project'; itemType?: 'file' | 'project'; projectName?: string }) {
  // Replace from the @ symbol to current position with the reference
  const start = autocompleteStartIndex.value;
  const before = inputMessage.value.substring(0, start);
  
  let reference: string;
  
  if (item.itemType === 'project' || item.type === 'project') {
    // Project reference
    reference = `@project:${item.name} `;
  } else {
    // File reference - include project name in global mode
    reference = item.projectName 
      ? `@file:${item.projectName}/${item.path} `
      : `@file:${item.path} `;
  }
  
  inputMessage.value = before + reference;
  
  closeAutocomplete();
  
  // Focus back on the textarea
  nextTick(() => {
    const textarea = textareaRef.value?.$el?.querySelector('textarea');
    if (textarea) {
      textarea.focus();
    }
  });
}

function closeAutocomplete() {
  showAutocomplete.value = false;
  autocompleteQuery.value = '';
  autocompleteStartIndex.value = -1;
  autocompleteAnchorRect.value = null;
}

// Update file preview handlers
async function handleApplyUpdate() {
  if (!activePreview.value) return;
  
  const previewFileId = activePreview.value.fileId;
  const previewFileName = activePreview.value.fileName;
  
  isApplyingUpdate.value = true;
  
  try {
    const result = await applyFileUpdate(activePreview.value.previewId);
    
    if (result.success) {
      const successMessage = addMessage(
        sessionId.value,
        'assistant',
        `File "${result.fileName}" has been updated successfully. The file has been re-indexed.`
      );
      messages.value = [...messages.value, successMessage];
      
      // Emit event to refresh the file in the editor if it's currently open
      emit('file-updated', previewFileId, previewFileName);
    } else {
      const errorMessage = addMessage(
        sessionId.value,
        'assistant',
        `Failed to update file: ${result.error}`
      );
      messages.value = [...messages.value, errorMessage];
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    const errorMessage = addMessage(
      sessionId.value,
      'assistant',
      `Failed to apply update: ${errorMsg}`
    );
    messages.value = [...messages.value, errorMessage];
  } finally {
    activePreview.value = null;
    isApplyingUpdate.value = false;
    await scrollToBottom();
  }
}

function handleCancelUpdate() {
  if (activePreview.value) {
    removePendingPreview(activePreview.value.previewId);
    const cancelMessage = addMessage(
      sessionId.value,
      'assistant',
      'Update cancelled. No changes were made to the file.'
    );
    messages.value = [...messages.value, cancelMessage];
  }
  activePreview.value = null;
  scrollToBottom();
}

function getDiffLineClass(type: DiffLine['type']): string {
  switch (type) {
    case 'added':
      return 'diff-added';
    case 'removed':
      return 'diff-removed';
    default:
      return 'diff-unchanged';
  }
}

function getDiffLinePrefix(type: DiffLine['type']): string {
  switch (type) {
    case 'added':
      return '+';
    case 'removed':
      return '-';
    default:
      return ' ';
  }
}

async function scrollToBottom() {
  await nextTick();
  if (chatContentRef.value) {
    chatContentRef.value.scrollTop = chatContentRef.value.scrollHeight;
  }
}

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value;
  emit('collapse-change', isCollapsed.value);
}

function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false }) as string;
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

// Expose methods
async function selectProject(projectId: string) {
  selectedScope.value = projectId;
  selectedProjectId.value = projectId;
  await loadSession();
}

async function selectGlobalMode() {
  selectedScope.value = ALL_PROJECTS_SCOPE;
  selectedProjectId.value = undefined;
  await loadSession();
}

defineExpose({ selectProject, selectGlobalMode });
</script>

<style scoped>
.chat-sidebar {
  display: flex;
  flex-direction: column;
  width: 360px;
  min-width: 360px;
  max-width: 360px;
  height: 100%;
  background: var(--hn-bg-deep);
  border-left: 1px solid var(--hn-border-default);
  transition: all 0.2s ease;
  overflow: hidden;
}

.chat-sidebar.collapsed {
  width: 0;
  min-width: 0;
  max-width: 0;
  background: transparent;
  border-left: none;
  position: relative;
  overflow: visible;
}

/* Collapsed Vertical Tab */
.collapsed-tab {
  position: absolute;
  right: 0;
  top: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 6px;
  background: var(--hn-bg-surface);
  border-radius: 8px 0 0 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid var(--hn-border-default);
  border-right: none;
  z-index: 10;
}

.collapsed-tab:hover {
  background: var(--hn-bg-elevated);
}

.collapsed-tab ion-icon {
  font-size: 16px;
  color: var(--hn-text-secondary);
}

.collapsed-tab:hover ion-icon {
  color: var(--hn-purple);
}

.collapsed-tab .tab-label {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--hn-text-secondary);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.collapsed-tab:hover .tab-label {
  color: var(--hn-text-primary);
}

.collapsed-tab .tab-chevron {
  font-size: 12px;
}

/* Expanded Sidebar */
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 8px 12px 16px;
  border-bottom: 1px solid var(--hn-border-default);
  background: var(--hn-bg-surface);
  min-height: 48px;
  box-sizing: border-box;
}

.header-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.header-icon {
  font-size: 18px;
  color: var(--hn-purple);
  flex-shrink: 0;
}

.header-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--hn-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex: 1;
}

.collapse-btn {
  --padding-start: 4px;
  --padding-end: 4px;
  --color: var(--hn-text-secondary);
  margin: 0;
  height: 28px;
  width: 28px;
}

.collapse-btn:hover {
  --color: var(--hn-text-primary);
}

/* Project Selector Container */
.project-selector-container {
  padding: 8px 16px;
  border-bottom: 1px solid var(--hn-border-default);
}

.project-selector {
  /* No extra margin needed */
}

.project-select {
  --background: var(--hn-bg-elevated);
  --color: var(--hn-text-primary);
  --placeholder-color: var(--hn-text-secondary);
  --padding-start: 12px;
  --padding-end: 12px;
  border-radius: 6px;
  font-size: 0.9rem;
  width: 100%;
}

.no-projects {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
  font-style: italic;
  margin-top: 8px;
}

/* Chat Content */
.chat-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: var(--hn-text-secondary);
}

.empty-state ion-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-size: 0.9rem;
}

.welcome-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 8px;
  color: var(--hn-text-secondary);
}

.welcome-message .welcome-icon {
  font-size: 32px;
  margin-bottom: 8px;
  color: var(--hn-purple);
}

.welcome-message p {
  margin: 0 0 16px;
  font-size: 0.9rem;
}

/* Quick Actions - using native buttons for better alignment */
.quick-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.quick-action-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  color: var(--hn-text-primary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}

.quick-action-btn:hover {
  background: var(--hn-bg-hover);
  border-color: var(--hn-border-strong);
}

.quick-action-btn ion-icon {
  font-size: 18px;
  color: var(--hn-purple);
  flex-shrink: 0;
}

.quick-action-btn span {
  flex: 1;
}

/* Messages */
.message {
  margin-bottom: 12px;
}

.message.user {
  display: flex;
  justify-content: flex-end;
}

.message.assistant {
  display: flex;
  justify-content: flex-start;
}

.message-bubble {
  max-width: 90%;
  padding: 10px 14px;
  border-radius: 12px;
}

.message.user .message-bubble {
  background: linear-gradient(135deg, var(--hn-green-dark), var(--hn-green));
  color: #ffffff;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-bubble {
  background: var(--hn-bg-elevated);
  color: var(--hn-text-primary);
  border-bottom-left-radius: 4px;
}

.message-content {
  font-size: 0.9rem;
  line-height: 1.5;
  word-break: break-word;
}

/* Markdown Content in Chat */
.markdown-content :deep(p) {
  margin: 0.5em 0;
}

.markdown-content :deep(p:first-child) {
  margin-top: 0;
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(code) {
  background: rgba(0, 0, 0, 0.3);
  padding: 0.15em 0.4em;
  border-radius: 4px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.85em;
}

.markdown-content :deep(pre) {
  background: rgba(0, 0, 0, 0.35);
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.6em 0;
}

.markdown-content :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.8em;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.2em;
}

.message-time {
  font-size: 0.65rem;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 4px;
  text-align: right;
}

.message.assistant .message-time {
  color: var(--hn-text-faint);
}

/* Typing Indicator */
.typing {
  display: flex;
  gap: 4px;
  padding: 8px 4px;
}

.typing .dot {
  width: 6px;
  height: 6px;
  background: var(--hn-purple);
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out both;
}

.typing .dot:nth-child(1) { animation-delay: -0.32s; }
.typing .dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes typing {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

/* Current Step Indicator - Single Line */
.current-step-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--hn-text-secondary);
  padding: 2px 0;
}

.current-step-indicator .step-spinner {
  width: 12px;
  height: 12px;
  --color: var(--hn-purple-light);
}

.current-step-indicator .step-icon-done {
  font-size: 12px;
  color: var(--hn-green);
}

.current-step-indicator .step-icon-error {
  font-size: 12px;
  color: var(--hn-danger);
}

.current-step-indicator .step-label {
  color: var(--hn-text-secondary);
}

.current-step-indicator .step-detail {
  color: var(--hn-text-muted);
  font-size: 0.7rem;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Chat Input */
.chat-input {
  padding: 12px 16px;
  border-top: 1px solid var(--hn-border-default);
  background: var(--hn-bg-surface);
}

.input-container {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.input-container ion-textarea {
  --background: var(--hn-bg-elevated);
  --color: var(--hn-text-primary);
  --placeholder-color: var(--hn-text-muted);
  --padding-start: 12px;
  --padding-end: 12px;
  --padding-top: 10px;
  --padding-bottom: 10px;
  border-radius: 8px;
  max-height: 100px;
  font-size: 0.9rem;
}

.input-container ion-button {
  --padding-start: 8px;
  --padding-end: 8px;
  --color: var(--hn-purple);
  margin-bottom: 4px;
}

/* Scrollbar styling */
.chat-content::-webkit-scrollbar {
  width: 6px;
}

.chat-content::-webkit-scrollbar-track {
  background: transparent;
}

.chat-content::-webkit-scrollbar-thumb {
  background: var(--hn-border-default);
  border-radius: 3px;
}

.chat-content::-webkit-scrollbar-thumb:hover {
  background: var(--hn-border-strong);
}

/* Update Preview Styles */
.update-preview {
  margin: 12px 0;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-strong);
  border-radius: 12px;
  overflow: hidden;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: linear-gradient(135deg, var(--hn-purple), var(--hn-green));
  color: #ffffff;
}

.preview-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.preview-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.preview-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.9;
}

.preview-filename {
  font-size: 0.9rem;
  font-weight: 600;
}

.preview-info {
  display: flex;
  gap: 16px;
  padding: 10px 14px;
  background: var(--hn-bg-surface);
  border-bottom: 1px solid var(--hn-border-default);
  font-size: 0.8rem;
  color: var(--hn-text-secondary);
}

.info-item strong {
  color: var(--hn-text-primary);
}

.diff-container {
  max-height: 250px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.diff-header {
  padding: 8px 14px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--hn-text-secondary);
  background: var(--hn-bg-deep);
  border-bottom: 1px solid var(--hn-border-default);
}

.diff-content {
  overflow-y: auto;
  max-height: 200px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.75rem;
  line-height: 1.5;
}

.diff-line {
  display: flex;
  padding: 2px 14px;
  border-left: 3px solid transparent;
}

.diff-line.diff-added {
  background: rgba(0, 200, 83, 0.15);
  border-left-color: var(--hn-green);
  color: #66d9a0;
}

.diff-line.diff-removed {
  background: rgba(255, 82, 82, 0.15);
  border-left-color: #ff5252;
  color: #ff8a8a;
}

.diff-line.diff-unchanged {
  color: var(--hn-text-secondary);
}

.diff-prefix {
  width: 14px;
  flex-shrink: 0;
  font-weight: 600;
}

.diff-text {
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-truncated {
  padding: 8px 14px;
  text-align: center;
  font-size: 0.75rem;
  color: var(--hn-text-muted);
  font-style: italic;
  background: var(--hn-bg-deep);
}

.preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 14px;
  background: var(--hn-bg-surface);
  border-top: 1px solid var(--hn-border-default);
}

.preview-actions ion-button {
  --border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
}

/* Diff scrollbar */
.diff-content::-webkit-scrollbar {
  width: 6px;
}

.diff-content::-webkit-scrollbar-track {
  background: transparent;
}

.diff-content::-webkit-scrollbar-thumb {
  background: var(--hn-border-default);
  border-radius: 3px;
}
</style>
