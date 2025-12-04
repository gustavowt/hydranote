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
        <div class="project-selector" v-if="projects.length > 0">
          <ion-select 
            v-model="selectedProjectId"
            interface="popover"
            placeholder="Select a project"
            class="project-select"
            @ionChange="handleProjectChange"
          >
            <ion-select-option 
              v-for="project in projects" 
              :key="project.id" 
              :value="project.id"
            >
              {{ project.name }}
            </ion-select-option>
          </ion-select>
        </div>
        <div v-else class="no-projects">
          <span>No projects available</span>
        </div>
      </div>

      <!-- Chat Content -->
      <div class="chat-content" ref="chatContentRef">
        <!-- No Project Selected -->
        <div v-if="!selectedProjectId" class="empty-state">
          <ion-icon :icon="chatbubblesOutline" />
          <p>Select a project to start chatting</p>
        </div>

        <!-- Messages -->
        <template v-else>
          <!-- Welcome message when no messages -->
          <div v-if="messages.length === 0" class="welcome-message">
            <ion-icon :icon="sparklesOutline" class="welcome-icon" />
            <p>Ask questions about your documents</p>
            <div class="quick-actions">
              <button 
                v-for="action in quickActions" 
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

          <!-- Typing Indicator -->
          <div v-if="isTyping" class="message assistant">
            <div class="message-bubble">
              <div class="typing">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- Chat Input -->
      <div class="chat-input" v-if="selectedProjectId" ref="inputContainerRef">
        <div class="input-container">
          <ion-textarea
            ref="textareaRef"
            v-model="inputMessage"
            :rows="1"
            :auto-grow="true"
            placeholder="Ask about your documents... (@ to reference files)"
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
        v-if="selectedProjectId"
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
import { ref, watch, onMounted, nextTick } from 'vue';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import {
  IonIcon,
  IonButton,
  IonSelect,
  IonSelectOption,
  IonTextarea,
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
} from 'ionicons/icons';
import type { Project, ChatMessage, SupportedFileType } from '@/types';
import {
  getAllProjects,
  getOrCreateSession,
  addMessage,
  getMessages,
  buildSystemPrompt,
  isConfigured,
  orchestrateToolExecution,
  get_project_files,
} from '@/services';
import FileReferenceAutocomplete from './FileReferenceAutocomplete.vue';

interface Props {
  initialProjectId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'project-change', projectId: string): void;
  (e: 'collapse-change', collapsed: boolean): void;
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
const projects = ref<Project[]>([]);
const selectedProjectId = ref<string | undefined>(undefined);
const messages = ref<ChatMessage[]>([]);
const inputMessage = ref('');
const isTyping = ref(false);
const sessionId = ref('');
const chatContentRef = ref<HTMLElement | null>(null);
const textareaRef = ref<InstanceType<typeof IonTextarea> | null>(null);
const inputContainerRef = ref<HTMLElement | null>(null);

// Autocomplete state
const showAutocomplete = ref(false);
const autocompleteQuery = ref('');
const autocompleteStartIndex = ref(-1);
const autocompleteAnchorRect = ref<DOMRect | null>(null);

const quickActions = [
  { text: 'What documents do I have?', label: 'List files', icon: documentTextOutline },
  { text: 'Search for key topics', label: 'Search', icon: searchOutline },
  { text: 'Summarize all documents', label: 'Summarize', icon: bookOutline },
];

onMounted(async () => {
  await loadProjects();
  if (props.initialProjectId) {
    selectedProjectId.value = props.initialProjectId;
    await loadSession();
  }
});

watch(() => props.initialProjectId, async (newId) => {
  if (newId && newId !== selectedProjectId.value) {
    // Ensure projects are loaded before setting selection
    if (projects.value.length === 0) {
      await loadProjects();
    }
    selectedProjectId.value = newId;
    await loadSession();
  }
});

async function loadProjects() {
  projects.value = await getAllProjects();
}

async function loadSession() {
  if (!selectedProjectId.value) return;
  
  const session = await getOrCreateSession(selectedProjectId.value);
  sessionId.value = session.id;
  messages.value = getMessages(session.id);
}

function handleProjectChange(event: CustomEvent) {
  const projectId = event.detail.value;
  if (projectId) {
    emit('project-change', projectId);
    loadSession();
  }
}

async function sendMessage(text?: string) {
  const messageText = text || inputMessage.value.trim();
  if (!messageText || !selectedProjectId.value) return;

  if (!isConfigured()) {
    // Could emit an event to show settings
    return;
  }

  inputMessage.value = '';

  // Add user message
  const userMessage = addMessage(sessionId.value, 'user', messageText);
  messages.value = [...messages.value, userMessage];
  
  await scrollToBottom();
  isTyping.value = true;

  try {
    const systemPrompt = await buildSystemPrompt(selectedProjectId.value);
    const conversationHistory = messages.value.slice(0, -1).map(m => ({
      role: m.role,
      content: m.content,
    }));
    
    const files = await get_project_files(selectedProjectId.value);
    const projectFileNames = files.map(f => f.name);

    const result = await orchestrateToolExecution(
      selectedProjectId.value,
      messageText,
      systemPrompt,
      conversationHistory,
      projectFileNames,
      () => {} // Skip execution step updates for sidebar
    );

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

function handleAutocompleteSelect(file: { id: string; name: string; path: string; type: SupportedFileType }) {
  // Replace from the @ symbol to current position with the file reference
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
  // Ensure projects are loaded before setting selection
  if (projects.value.length === 0) {
    await loadProjects();
  }
  selectedProjectId.value = projectId;
  await loadSession();
}

async function refresh() {
  await loadProjects();
}

defineExpose({ selectProject, refresh });
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
</style>
