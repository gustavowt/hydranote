<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home" />
        </ion-buttons>
        <ion-title>{{ project?.name || 'Chat' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="showFilesModal = true">
            <ion-icon slot="icon-only" :icon="documentTextOutline" />
          </ion-button>
          <ion-button @click="showInfoPopover">
            <ion-icon slot="icon-only" :icon="informationCircleOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <!-- Main Layout with Sidebar -->
    <div class="main-layout">
      <!-- File Tree Sidebar -->
      <FileTreeSidebar
        v-if="project"
        ref="fileTreeRef"
        :project-id="projectId"
        :selected-file-id="selectedFileId"
        @select-file="handleSidebarFileSelect"
        @collapse-change="handleSidebarCollapseChange"
      />

      <!-- Chat Content Area -->
      <ion-content ref="contentRef" :fullscreen="true" class="chat-content">
      <!-- Loading State -->
      <div v-if="loading" class="loading-state">
        <ion-spinner name="crescent" />
        <p>Loading project...</p>
      </div>

      <!-- Chat Messages -->
      <div v-else class="messages-container">
        <!-- Welcome message when no messages -->
        <div v-if="messages.length === 0" class="welcome-message">
          <img src="/hydranote-logo.png" alt="HydraNote" class="welcome-logo" />
          <h2>Start a Conversation</h2>
          <p>Ask questions about your documents. I can search, read, summarize, and help you create new documents.</p>
          
          <div class="quick-actions">
            <ion-chip v-for="action in quickActions" :key="action.text" @click="sendMessage(action.text)">
              <ion-icon :icon="action.icon" />
              <ion-label>{{ action.label }}</ion-label>
            </ion-chip>
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
            <div v-if="message.contextChunks && message.contextChunks.length > 0" class="context-sources">
              <span class="sources-label">Sources:</span>
              <ion-chip 
                v-for="fileName in uniqueSourceFiles(message.contextChunks)" 
                :key="fileName"
                size="small"
              >
                {{ fileName }}
              </ion-chip>
            </div>
            <div class="message-time">{{ formatTime(message.timestamp) }}</div>
          </div>
        </div>

        <!-- Execution Log / Typing indicator -->
        <div v-if="isTyping" class="message assistant">
          <div class="message-bubble execution-log">
            <div v-if="executionSteps.length > 0" class="steps-container">
              <div 
                v-for="step in executionSteps" 
                :key="step.id" 
                :class="['step', step.status]"
              >
                <span class="step-icon">
                  <ion-spinner v-if="step.status === 'running'" name="dots" />
                  <ion-icon v-else-if="step.status === 'completed'" :icon="checkmarkCircle" />
                  <ion-icon v-else-if="step.status === 'error'" :icon="closeCircle" />
                  <ion-icon v-else :icon="ellipseOutline" />
                </span>
                <span class="step-label">{{ step.label }}</span>
                <span v-if="step.detail" class="step-detail">{{ step.detail }}</span>
              </div>
            </div>
            <div v-else class="typing">
              <span class="dot"></span>
              <span class="dot"></span>
              <span class="dot"></span>
            </div>
          </div>
        </div>
      </div>
    </ion-content>
    </div>

    <!-- Chat Input -->
    <ion-footer class="chat-footer">
      <ion-toolbar>
        <div class="input-container" ref="inputContainerRef">
          <ion-textarea
            ref="textareaRef"
            v-model="inputMessage"
            :rows="1"
            :auto-grow="true"
            placeholder="Ask about your documents... (type @ to reference files)"
            :disabled="isTyping"
            @keydown="handleInputKeydown"
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
      </ion-toolbar>
    </ion-footer>

    <!-- File Reference Autocomplete (Teleported to body) -->
    <FileReferenceAutocomplete
      v-if="project"
      :project-id="projectId"
      :search-query="autocompleteQuery"
      :is-visible="showAutocomplete"
      :anchor-rect="autocompleteAnchorRect"
      @select="handleAutocompleteSelect"
      @close="closeAutocomplete"
    />

    <!-- Files Modal -->
    <ion-modal :is-open="showFilesModal" @didDismiss="showFilesModal = false">
      <ion-header>
        <ion-toolbar>
          <ion-buttons slot="start">
            <ion-button @click="showFilesModal = false">Close</ion-button>
          </ion-buttons>
          <ion-title>Project Files</ion-title>
          <ion-buttons slot="end">
            <ion-button @click="triggerFileUpload">
              <ion-icon slot="icon-only" :icon="addOutline" />
            </ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <input 
          ref="fileInputRef"
          type="file" 
          hidden 
          multiple
          accept=".pdf,.txt,.docx,.md,.png,.jpg,.jpeg,.webp"
          @change="handleFileUpload"
        />

        <div v-if="files.length === 0" class="empty-files">
          <ion-icon :icon="cloudUploadOutline" />
          <p>No files yet. Upload documents to get started.</p>
          <ion-button @click="triggerFileUpload">
            <ion-icon slot="start" :icon="addOutline" />
            Upload Files
          </ion-button>
        </div>

        <ion-list v-else>
          <ion-item 
            v-for="file in files" 
            :key="file.id"
            button
            @click="openFile(file)"
            :detail="file.type === 'md'"
          >
            <ion-icon :icon="getFileIcon(file.type)" slot="start" />
            <ion-label>
              <h3>{{ file.name }}</h3>
              <p>{{ formatSize(file.size) }} • {{ file.status }}</p>
            </ion-label>
            <ion-badge slot="end" :color="getFileStatusColor(file.status)">
              {{ file.status }}
            </ion-badge>
          </ion-item>
        </ion-list>

        <!-- Upload Progress -->
        <div v-if="uploading" class="upload-progress">
          <ion-spinner name="crescent" />
          <p>Processing {{ uploadFileName }}...</p>
        </div>
      </ion-content>
    </ion-modal>

    <!-- Markdown Viewer/Editor Modal -->
    <MarkdownViewerEditor
      :is-open="showMarkdownViewer"
      :file-name="selectedMarkdownFile?.name || ''"
      :content="markdownContent"
      :can-edit="true"
      @close="closeMarkdownViewer"
      @save="saveMarkdownFile"
    />
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonFooter,
  IonButtons,
  IonButton,
  IonBackButton,
  IonIcon,
  IonTextarea,
  IonSpinner,
  IonModal,
  IonList,
  IonItem,
  IonLabel,
  IonBadge,
  IonChip,
  alertController,
} from '@ionic/vue';
import {
  sendOutline,
  documentTextOutline,
  informationCircleOutline,
  addOutline,
  cloudUploadOutline,
  searchOutline,
  bookOutline,
  createOutline,
  documentOutline,
  imageOutline,
  checkmarkCircle,
  closeCircle,
  ellipseOutline,
  logoMarkdown,
} from 'ionicons/icons';
import type { Project, ProjectFile, ChatMessage, SupportedFileType } from '@/types';
import type { ExecutionStep } from '@/services';
import MarkdownViewerEditor from '@/components/MarkdownViewerEditor.vue';
import FileReferenceAutocomplete from '@/components/FileReferenceAutocomplete.vue';
import FileTreeSidebar from '@/components/FileTreeSidebar.vue';
import {
  initialize,
  getProject,
  get_project_files,
  ingestDocument,
  getOrCreateSession,
  addMessage,
  getMessages,
  buildSystemPrompt,
  isConfigured,
  orchestrateToolExecution,
} from '@/services';

const route = useRoute();
const router = useRouter();
const contentRef = ref<InstanceType<typeof IonContent> | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const textareaRef = ref<InstanceType<typeof IonTextarea> | null>(null);
const inputContainerRef = ref<HTMLElement | null>(null);
const fileTreeRef = ref<InstanceType<typeof FileTreeSidebar> | null>(null);

const loading = ref(true);
const project = ref<Project | null>(null);
const files = ref<ProjectFile[]>([]);
const messages = ref<ChatMessage[]>([]);
const inputMessage = ref('');
const isTyping = ref(false);
const showFilesModal = ref(false);
const uploading = ref(false);
const uploadFileName = ref('');
const sessionId = ref('');
const executionSteps = ref<ExecutionStep[]>([]);

// Markdown viewer/editor state
const showMarkdownViewer = ref(false);
const selectedMarkdownFile = ref<ProjectFile | null>(null);
const markdownContent = ref('');

// Sidebar state
const sidebarCollapsed = ref(false);
const selectedFileId = ref<string | undefined>(undefined);

// Autocomplete state
const showAutocomplete = ref(false);
const autocompleteQuery = ref('');
const autocompleteStartIndex = ref(-1);
const autocompleteAnchorRect = ref<DOMRect | null>(null);

const projectId = computed(() => route.params.id as string);

const quickActions = [
  { text: 'What documents do I have?', label: 'List files', icon: documentTextOutline },
  { text: 'Search for key topics', label: 'Search', icon: searchOutline },
  { text: 'Summarize all documents', label: 'Summarize', icon: bookOutline },
  { text: 'Help me write a report', label: 'Write', icon: createOutline },
];

onMounted(async () => {
  await initialize();
  await loadProject();
});

async function loadProject() {
  loading.value = true;
  try {
    project.value = await getProject(projectId.value);
    if (!project.value) {
      const alert = await alertController.create({
        header: 'Error',
        message: 'Project not found',
        buttons: ['OK'],
      });
      await alert.present();
      return;
    }

    files.value = await get_project_files(projectId.value);
    
    // Initialize chat session
    const session = await getOrCreateSession(projectId.value);
    sessionId.value = session.id;
    messages.value = getMessages(session.id);
  } finally {
    loading.value = false;
  }
}

async function sendMessage(text?: string) {
  const messageText = text || inputMessage.value.trim();
  if (!messageText) return;

  // Check if LLM is configured
  if (!isConfigured()) {
    const alert = await alertController.create({
      header: 'LLM Not Configured',
      message: 'Please configure your LLM settings (OpenAI API key or Ollama) in the Settings page.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Go to Settings', handler: () => router.push('/settings') },
      ],
    });
    await alert.present();
    return;
  }

  inputMessage.value = '';

  // Add user message
  const userMessage = addMessage(sessionId.value, 'user', messageText);
  messages.value = [...messages.value, userMessage];
  
  await scrollToBottom();
  isTyping.value = true;
  executionSteps.value = [];

  try {
    // Get system prompt and conversation history
    const systemPrompt = await buildSystemPrompt(projectId.value);
    const conversationHistory = messages.value.slice(0, -1).map(m => ({
      role: m.role,
      content: m.content,
    }));
    const projectFileNames = files.value.map(f => f.name);

    // Orchestrate tool execution with live status updates
    const result = await orchestrateToolExecution(
      projectId.value,
      messageText,
      systemPrompt,
      conversationHistory,
      projectFileNames,
      (steps) => {
        executionSteps.value = [...steps];
      }
    );

    // Add assistant responses (may be multiple for multi-step requests)
    if (result.responses && result.responses.length > 1) {
      // Multiple responses - add each as separate message
      for (const response of result.responses) {
        const assistantMessage = addMessage(
          sessionId.value,
          'assistant',
          response
        );
        messages.value = [...messages.value, assistantMessage];
      }
    } else {
      // Single response
      const assistantMessage = addMessage(
        sessionId.value,
        'assistant',
        result.response
      );
      messages.value = [...messages.value, assistantMessage];
    }
  } catch (error) {
    console.error('LLM error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get response';
    
    // Add error as assistant message
    const assistantMessage = addMessage(
      sessionId.value,
      'assistant',
      `⚠️ Error: ${errorMessage}`
    );
    messages.value = [...messages.value, assistantMessage];
  } finally {
    isTyping.value = false;
    executionSteps.value = [];
    await scrollToBottom();
  }
}

async function scrollToBottom() {
  await nextTick();
  contentRef.value?.$el?.scrollToBottom?.(300);
}

function triggerFileUpload() {
  fileInputRef.value?.click();
}

async function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const uploadedFiles = input.files;
  if (!uploadedFiles?.length) return;

  for (let i = 0; i < uploadedFiles.length; i++) {
    const file = uploadedFiles[i];
    uploading.value = true;
    uploadFileName.value = file.name;

    try {
      const projectFile = await ingestDocument(file, projectId.value);
      files.value = [...files.value, projectFile];
    } catch (error) {
      console.error('Upload error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const alert = await alertController.create({
        header: 'Upload Error',
        message: `Failed to process ${file.name}: ${errorMessage}`,
        buttons: ['OK'],
      });
      await alert.present();
    }
  }

  uploading.value = false;
  input.value = '';
  
  // Refresh file tree after upload
  await refreshFileTree();
}

async function showInfoPopover() {
  if (!project.value) return;
  
  const alert = await alertController.create({
    header: project.value.name,
    message: `
      <p><strong>Status:</strong> ${project.value.status}</p>
      <p><strong>Files:</strong> ${files.value.length}</p>
      <p><strong>Created:</strong> ${formatDate(project.value.createdAt)}</p>
      ${project.value.description ? `<p><strong>Description:</strong> ${project.value.description}</p>` : ''}
    `,
    buttons: ['Close'],
  });
  await alert.present();
}

function getFileIcon(type: string): string {
  if (['png', 'jpg', 'jpeg', 'webp'].includes(type)) return imageOutline;
  if (type === 'md') return logoMarkdown;
  return documentOutline;
}

function getFileStatusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: 'medium',
    processing: 'warning',
    indexed: 'success',
    error: 'danger',
  };
  return colors[status] || 'medium';
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uniqueSourceFiles(chunks: { fileName: string }[]): string[] {
  return [...new Set(chunks.map(c => c.fileName))].slice(0, 3);
}

async function openFile(file: ProjectFile) {
  if (file.type === 'md') {
    // Open markdown file in viewer/editor
    selectedMarkdownFile.value = file;
    markdownContent.value = file.content || '';
    showMarkdownViewer.value = true;
  } else {
    // For other files, trigger a read through chat
    await sendMessage(`Read the file "${file.name}"`);
    showFilesModal.value = false;
  }
}

function closeMarkdownViewer() {
  showMarkdownViewer.value = false;
  selectedMarkdownFile.value = null;
  markdownContent.value = '';
}

async function saveMarkdownFile(content: string) {
  // Note: Full save implementation would require updating the file in the database
  // For now, we update the local state
  if (selectedMarkdownFile.value) {
    selectedMarkdownFile.value.content = content;
    markdownContent.value = content;
    
    // Update the files list
    const index = files.value.findIndex(f => f.id === selectedMarkdownFile.value?.id);
    if (index !== -1) {
      files.value[index] = { ...files.value[index], content };
    }
  }
}

// Configure marked with highlight.js for syntax highlighting
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

function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false }) as string;
}

// ============================================
// Sidebar Functions
// ============================================

function handleSidebarCollapseChange(collapsed: boolean) {
  sidebarCollapsed.value = collapsed;
}

async function handleSidebarFileSelect(file: { id: string; path: string; type: string }) {
  selectedFileId.value = file.id;
  
  // For markdown files, open in viewer
  if (file.type === 'md') {
    const projectFile = files.value.find(f => f.id === file.id);
    if (projectFile) {
      selectedMarkdownFile.value = projectFile;
      markdownContent.value = projectFile.content || '';
      showMarkdownViewer.value = true;
    }
  } else {
    // For other files, send a read request in chat
    await sendMessage(`Read the file "${file.path}"`);
  }
}

// Refresh file tree when files are uploaded
async function refreshFileTree() {
  await fileTreeRef.value?.refresh();
}

// ============================================
// Autocomplete Functions
// ============================================

function handleInputKeydown(event: KeyboardEvent) {
  // Handle Enter key for sending
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

function handleAutocompleteSelect(file: { id: string; name: string; path: string; type: SupportedFileType }) {
  // Replace from the @ symbol to the end of current input with the file reference
  const start = autocompleteStartIndex.value;
  const before = inputMessage.value.substring(0, start);
  
  // Insert the file reference
  const fileRef = `@file:${file.path} `;
  inputMessage.value = before + fileRef;
  
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
</script>

<style scoped>
/* Main Layout with Sidebar */
.main-layout {
  display: flex;
  flex: 1;
  height: 100%;
  overflow: hidden;
}

.chat-content {
  --background: var(--hn-bg-deepest);
  flex: 1;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: var(--hn-text-secondary);
}

.messages-container {
  padding: 16px;
  padding-bottom: 100px;
  min-height: 100%;
}

.welcome-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 24px;
  color: var(--hn-text-secondary);
}

.welcome-logo {
  width: 120px;
  height: auto;
  margin-bottom: 16px;
}

.welcome-message h2 {
  margin: 0 0 8px;
  font-size: 1.5rem;
  color: var(--hn-text-primary);
}

.welcome-message p {
  margin: 0 0 24px;
  max-width: 300px;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.quick-actions ion-chip {
  cursor: pointer;
  --background: var(--hn-bg-surface);
  --color: var(--hn-text-primary);
}

.message {
  display: flex;
  margin-bottom: 16px;
}

.message.user {
  justify-content: flex-end;
}

.message.assistant {
  justify-content: flex-start;
}

.message-bubble {
  max-width: 85%;
  padding: 12px 16px;
  border-radius: 16px;
  position: relative;
}

.message.user .message-bubble {
  background: linear-gradient(135deg, var(--hn-purple), var(--hn-purple-light));
  color: #ffffff;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-bubble {
  background: var(--hn-bg-surface);
  color: var(--hn-text-primary);
  border-bottom-left-radius: 4px;
}

.message-content {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  font-size: 0.95rem;
}

/* Markdown Styles */
.markdown-content {
  white-space: normal;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  margin: 0.8em 0 0.4em;
  font-weight: 600;
  line-height: 1.3;
}

.markdown-content :deep(h1) { font-size: 1.4em; }
.markdown-content :deep(h2) { font-size: 1.25em; }
.markdown-content :deep(h3) { font-size: 1.1em; }
.markdown-content :deep(h4) { font-size: 1em; }

.markdown-content :deep(p) {
  margin: 0.6em 0;
}

.markdown-content :deep(p:first-child),
.markdown-content :deep(h1:first-child),
.markdown-content :deep(h2:first-child),
.markdown-content :deep(h3:first-child) {
  margin-top: 0;
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 0.6em 0;
  padding-left: 1.5em;
}

.markdown-content :deep(li) {
  margin: 0.3em 0;
}

.markdown-content :deep(code) {
  background: rgba(0, 0, 0, 0.3);
  padding: 0.15em 0.4em;
  border-radius: 4px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.88em;
}

.markdown-content :deep(pre) {
  background: rgba(0, 0, 0, 0.35);
  padding: 12px 14px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0.8em 0;
}

.markdown-content :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.85em;
  line-height: 1.5;
}

.markdown-content :deep(blockquote) {
  border-left: 3px solid var(--hn-teal);
  margin: 0.8em 0;
  padding: 0.4em 0 0.4em 1em;
  color: var(--hn-text-secondary);
}

.markdown-content :deep(a) {
  color: var(--hn-purple);
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(strong) {
  font-weight: 600;
}

.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--hn-border-default);
  margin: 1em 0;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.8em 0;
  font-size: 0.9em;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid var(--hn-border-default);
  padding: 8px 12px;
  text-align: left;
}

.markdown-content :deep(th) {
  background: rgba(0, 0, 0, 0.2);
  font-weight: 600;
}

.context-sources {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.sources-label {
  font-size: 0.7rem;
  color: var(--hn-text-secondary);
  margin-right: 4px;
}

.context-sources ion-chip {
  --background: var(--hn-bg-elevated);
  --color: var(--hn-text-secondary);
  font-size: 0.7rem;
  height: 24px;
}

.message-time {
  font-size: 0.65rem;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 6px;
  text-align: right;
}

.message.assistant .message-time {
  color: var(--hn-text-muted);
}

.typing {
  display: flex;
  gap: 5px;
  padding: 16px 20px;
}

.typing .dot {
  width: 8px;
  height: 8px;
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

.chat-footer {
  background: var(--hn-bg-deep);
  border-top: 1px solid var(--hn-border-default);
}

.chat-footer ion-toolbar {
  --background: transparent;
}

.input-container {
  display: flex;
  align-items: flex-end;
  padding: 8px 12px;
  gap: 8px;
}

.input-container ion-textarea {
  --background: var(--hn-bg-surface);
  --color: var(--hn-text-primary);
  --placeholder-color: var(--hn-text-muted);
  --padding-start: 16px;
  --padding-end: 16px;
  --padding-top: 12px;
  --padding-bottom: 12px;
  border-radius: 24px;
  max-height: 120px;
  border: 1px solid var(--hn-border-default);
}

.input-container ion-button {
  --padding-start: 12px;
  --padding-end: 12px;
  --color: var(--hn-purple);
  margin-bottom: 4px;
}

.empty-files {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  color: var(--hn-text-secondary);
}

.empty-files ion-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
  color: var(--hn-purple);
}

.upload-progress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  color: var(--hn-text-secondary);
}

/* Execution Log Styles */
.execution-log {
  min-width: 200px;
}

.steps-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.step {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
}

.step.running {
  color: var(--hn-purple);
}

.step.completed {
  color: var(--hn-green);
}

.step.error {
  color: var(--hn-danger);
}

.step-icon {
  display: flex;
  align-items: center;
  width: 18px;
  height: 18px;
}

.step-icon ion-spinner {
  width: 16px;
  height: 16px;
  --color: var(--hn-purple);
}

.step-icon ion-icon {
  font-size: 16px;
}

.step-label {
  font-weight: 500;
}

.step-detail {
  color: var(--hn-text-muted);
  font-size: 0.8rem;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

