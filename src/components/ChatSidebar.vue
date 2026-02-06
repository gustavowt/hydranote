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
      <!-- Unified Compact Header -->
      <div class="chat-header">
        <!-- Left: Project/Scope selector -->
        <div class="scope-selector" @click="showScopeDropdown = !showScopeDropdown">
          <span class="scope-icon">{{ isGlobalMode ? '🌐' : '📁' }}</span>
          <span class="scope-name">{{ currentScopeName }}</span>
          <ion-icon :icon="chevronDownOutline" class="scope-chevron" />
          
          <!-- Scope Dropdown -->
          <div v-if="showScopeDropdown" class="scope-dropdown" @click.stop>
            <div 
              class="scope-item" 
              :class="{ active: isGlobalMode }"
              @click="selectScope('__all__')"
            >
              <span class="scope-item-icon">🌐</span>
              <span>All Projects</span>
            </div>
            <div class="scope-divider"></div>
            <div 
              v-for="project in projects" 
              :key="project.id"
              class="scope-item"
              :class="{ active: selectedScope === project.id }"
              @click="selectScope(project.id)"
            >
              <span class="scope-item-icon">📁</span>
              <span>{{ project.name }}</span>
            </div>
          </div>
        </div>

        <!-- Right: Action buttons -->
        <div class="header-actions">
          <button class="header-action-btn" @click.stop="handleNewChat" title="New Chat">
            <ion-icon :icon="addOutline" />
          </button>
          <button class="header-action-btn" @click.stop="toggleHistoryDropdown" title="Chat History" :class="{ active: showHistoryDropdown }">
            <ion-icon :icon="timeOutline" />
          </button>
          <button class="header-action-btn" @click.stop="toggleCollapse" title="Collapse">
            <ion-icon :icon="chevronForwardOutline" />
          </button>
        </div>

        <!-- History Panel (slides down) -->
        <div v-if="showHistoryDropdown" class="history-panel">
          <div class="history-panel-header">
            <span class="history-panel-title">Recent Chats</span>
          </div>
          <div class="history-panel-list">
            <div 
              v-for="session in chatHistory" 
              :key="session.id" 
              class="history-panel-item"
              :class="{ active: session.id === sessionId }"
              @click="handleSwitchSession(session.id)"
            >
              <span class="history-item-title">{{ session.title }}</span>
              <span class="history-item-date">{{ formatSessionDate(session.updatedAt) }}</span>
            </div>
            <div v-if="chatHistory.length === 0" class="history-empty">
              No previous chats
            </div>
          </div>
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
              <div v-else class="message-content user-message-content" v-html="renderUserMessage(message.content)"></div>
              <div class="message-time">{{ formatTime(message.timestamp) }}</div>
            </div>
            
            <!-- Persisted tool executions for this message -->
            <div v-if="message.toolExecutions && message.toolExecutions.length > 0" class="inline-tool-indicators persisted">
              <div 
                v-for="exec in message.toolExecutions" 
                :key="exec.id"
                class="tool-indicator"
                :class="{ expanded: expandedToolIds.has(exec.id), 'has-children': exec.children && exec.children.length > 0 }"
                @click="toggleToolExpansion(exec.id)"
              >
                <div class="tool-indicator-main">
                  <span class="tool-indicator-icon" v-html="getToolIcon(exec.tool)"></span>
                  <span class="tool-indicator-desc">{{ exec.description }}</span>
                  <span v-if="exec.status === 'completed'" class="tool-indicator-duration">{{ formatDuration(exec.durationMs) }}</span>
                  <ion-icon v-if="exec.status === 'completed'" :icon="checkmarkCircle" class="tool-indicator-status completed" />
                  <ion-icon v-else-if="exec.status === 'failed'" :icon="closeCircle" class="tool-indicator-status failed" />
                </div>
                <!-- Child lines for nested tools (e.g., web research pages) -->
                <div v-if="exec.children && exec.children.length > 0 && expandedToolIds.has(exec.id)" class="tool-indicator-children">
                  <div 
                    v-for="(child, idx) in exec.children" 
                    :key="child.id"
                    class="tool-indicator-child"
                  >
                    <span class="child-branch">{{ idx === exec.children.length - 1 ? '└─' : '├─' }}</span>
                    <span class="child-label">{{ child.label }}</span>
                    <ion-icon v-if="child.status === 'completed'" :icon="checkmarkCircle" class="child-status completed" />
                    <ion-icon v-else-if="child.status === 'failed'" :icon="closeCircle" class="child-status failed" />
                  </div>
                </div>
                <!-- Expandable result preview -->
                <div v-if="expandedToolIds.has(exec.id) && exec.resultPreview" class="tool-indicator-preview">
                  <pre>{{ exec.resultPreview }}</pre>
                </div>
              </div>
            </div>
          </div>

          <!-- Inline Tool Indicators (real-time during execution) -->
          <div v-if="toolLogs.length > 0" class="inline-tool-indicators live">
            <div 
              v-for="log in toolLogs" 
              :key="log.id"
              class="tool-indicator"
              :class="{ 
                running: log.status === 'running', 
                expanded: expandedToolIds.has(log.id),
                'has-children': log.children && log.children.length > 0
              }"
              @click="toggleToolExpansion(log.id)"
            >
              <div class="tool-indicator-main">
                <span class="tool-indicator-icon" v-html="getToolIcon(log.tool)"></span>
                <span class="tool-indicator-desc">{{ log.description }}</span>
                <span v-if="log.status === 'running'" class="tool-indicator-spinner">
                  <ion-spinner name="dots" />
                </span>
                <span v-else-if="log.status === 'completed'" class="tool-indicator-duration">{{ formatToolLogDuration(log) }}</span>
                <ion-icon v-if="log.status === 'completed'" :icon="checkmarkCircle" class="tool-indicator-status completed" />
                <ion-icon v-else-if="log.status === 'failed'" :icon="closeCircle" class="tool-indicator-status failed" />
              </div>
              
              <!-- Child lines for nested tools (e.g., web research pages) -->
              <div v-if="log.children && log.children.length > 0" class="tool-indicator-children">
                <div 
                  v-for="(child, idx) in log.children" 
                  :key="child.id"
                  class="tool-indicator-child"
                  :class="{ running: child.status === 'running' }"
                >
                  <span class="child-branch">{{ idx === log.children.length - 1 ? '└─' : '├─' }}</span>
                  <span class="child-label">{{ child.label }}</span>
                  <ion-spinner v-if="child.status === 'running'" name="dots" class="child-spinner" />
                  <ion-icon v-else-if="child.status === 'completed'" :icon="checkmarkCircle" class="child-status completed" />
                  <ion-icon v-else-if="child.status === 'failed'" :icon="closeCircle" class="child-status failed" />
                </div>
              </div>
              
              <!-- Single-line streaming preview while running -->
              <div v-if="log.status === 'running' && currentToolStreamingContent && log.id === currentRunningToolId" class="tool-indicator-streaming">
                <span class="streaming-preview">{{ getLastLine(currentToolStreamingContent) }}</span>
              </div>
              
              <!-- Expandable result preview when completed -->
              <div v-if="log.status === 'completed' && expandedToolIds.has(log.id) && log.resultPreview" class="tool-indicator-preview">
                <pre>{{ log.resultPreview }}</pre>
              </div>
              
              <!-- Error display -->
              <div v-if="log.error" class="tool-indicator-error">
                {{ log.error }}
              </div>
            </div>
          </div>

          <!-- Typing Indicator + Streaming Response (AFTER tool execution) -->
          <div v-if="isTyping || streamingContent" class="message assistant">
            <div class="message-bubble">
              <!-- Streaming Content (LLM interpretation) -->
              <div 
                v-if="streamingContent" 
                class="message-content markdown-content"
                v-html="renderMarkdown(streamingContent)"
              ></div>

              <!-- Current Step Indicator (when no tool logs, shows old-style step) -->
              <div v-if="currentStep && toolLogs.length === 0 && (currentStep.status === 'running' || !streamingContent)" class="current-step-indicator">
                <ion-spinner v-if="currentStep.status === 'running'" name="dots" class="step-spinner" />
                <ion-icon v-else-if="currentStep.status === 'completed'" :icon="checkmarkCircle" class="step-icon-done" />
                <ion-icon v-else-if="currentStep.status === 'error'" :icon="closeCircle" class="step-icon-error" />
                <span class="step-label">{{ currentStep.label }}</span>
                <span v-if="currentStep.detail" class="step-detail">{{ currentStep.detail }}</span>
              </div>
              
              <!-- Typing dots when no steps and no streaming -->
              <div v-if="!currentStep && !streamingContent && toolLogs.length === 0" class="typing">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
              
              <!-- Generating response indicator (after tools complete) -->
              <div v-if="toolLogs.length > 0 && !streamingContent && isTyping && toolLogs.every(l => l.status !== 'running')" class="generating-response">
                <ion-spinner name="dots" class="response-spinner" />
                <span>Generating response...</span>
              </div>
            </div>
          </div>

          <!-- Pending Final Answer (rendered AFTER tool log, before next query) -->
          <div v-if="pendingFinalAnswer && !isTyping" class="message assistant">
            <div class="message-bubble">
              <div 
                class="message-content markdown-content"
                v-html="renderMarkdown(pendingFinalAnswer)"
              ></div>
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
              <span v-if="activePreview.reasoning" class="info-item reasoning">
                <strong>Analysis:</strong> {{ activePreview.reasoning }}
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

          <!-- Execution Plan Confirmation -->
          <div v-if="pendingPlan && !pendingPlan.needsClarification" class="execution-plan">
            <div class="plan-header">
              <ion-icon :icon="listOutline" class="plan-icon" />
              <div class="plan-title">
                <span class="plan-label">Execution Plan</span>
                <span v-if="pendingPlan.estimatedDuration" class="plan-duration">{{ pendingPlan.estimatedDuration }}</span>
              </div>
            </div>

            <div class="plan-summary">
              {{ pendingPlan.summary }}
            </div>

            <div class="plan-steps">
              <div 
                v-for="(step, index) in pendingPlan.steps" 
                :key="step.id"
                :class="['plan-step', step.status || 'pending']"
              >
                <span class="step-number">{{ index + 1 }}</span>
                <span class="step-icon">{{ getToolIcon(step.tool) }}</span>
                <div class="step-content">
                  <span class="step-description">{{ step.description }}</span>
                  <span v-if="step.detail && step.status === 'running'" class="step-detail">{{ step.detail }}</span>
                </div>
                <ion-spinner v-if="step.status === 'running'" name="dots" class="step-spinner-small" />
                <ion-icon v-else-if="step.status === 'completed'" :icon="checkmarkCircle" class="step-status-icon done" />
                <ion-icon v-else-if="step.status === 'failed'" :icon="closeCircle" class="step-status-icon error" />
              </div>
            </div>

            <div v-if="!isExecutingPlan" class="plan-actions">
              <ion-button
                fill="outline"
                size="small"
                color="medium"
                @click="handleCancelPlan"
              >
                <ion-icon slot="start" :icon="closeOutline" />
                Cancel
              </ion-button>
              <ion-button
                size="small"
                color="primary"
                @click="handleExecutePlan"
              >
                <ion-icon slot="start" :icon="playOutline" />
                Execute Plan
              </ion-button>
            </div>

            <div v-else class="plan-executing">
              <ion-spinner name="crescent" />
              <span>Executing step {{ currentPlanStep?.index !== undefined ? currentPlanStep.index + 1 : 1 }} of {{ currentPlanStep?.total || pendingPlan.steps.length }}...</span>
            </div>
          </div>
        </template>
      </div>

      <!-- Chat Input -->
      <div class="chat-input" v-if="sessionReady" ref="inputContainerRef">
        <div class="input-container">
          <!-- Rich input with styled references -->
          <div class="rich-input-wrapper">
            <div
              ref="richInputRef"
              class="rich-input"
              contenteditable="true"
              :class="{ disabled: isTyping, 'has-content': inputMessage.trim() }"
              @input="handleRichInput"
              @keydown="handleKeydown"
              @paste="handlePaste"
              @focus="handleInputFocus"
              @blur="handleInputBlur"
              :data-placeholder="isGlobalMode ? 'Ask across all projects... (@ to reference files)' : 'Ask about your documents... (@ to reference files)'"
            ></div>
          </div>
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
import { ref, watch, onMounted, onUnmounted, nextTick, computed } from 'vue';
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
  listOutline,
  playOutline,
} from 'ionicons/icons';
import type { Project, ChatMessage, ChatSession, SupportedFileType, UpdateFilePreview, DiffLine, ExecutionPlan, PlanStep, ToolLogEntry, ToolExecutionRecord, WorkingContext, ToolResult, ProjectFile } from '@/types';
import type { ExecutionStep } from '@/services';
import {
  getOrCreateSession,
  addMessage,
  getMessages,
  buildSystemPrompt,
  buildGlobalSystemPrompt,
  isConfigured,
  chatCompletionStreaming,
  get_project_files,
  applyFileUpdate,
  removePendingPreview,
  getAllProjects,
  getAllFilesForAutocomplete,
  ensureFileSystemPermission,
  // Planner-Executor-Checker flow
  createExecutionPlan,
  runPlannerFlow,
  getToolIcon,
  shouldAutoExecutePlan,
  // Chat history
  getSessionHistory,
  switchToSession,
  startNewSession,
} from '@/services';
import FileReferenceAutocomplete from './FileReferenceAutocomplete.vue';
import { folderOutline, addOutline, timeOutline, chevronDownOutline, chevronUpOutline } from 'ionicons/icons';

// Special value for "All Projects" scope
const ALL_PROJECTS_SCOPE = '__all__';

interface Props {
  projects: Project[];
  initialProjectId?: string;
  /** Currently open file in the editor (for context in planner) */
  currentFile?: ProjectFile | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'project-change', projectId: string): void;
  (e: 'collapse-change', collapsed: boolean): void;
  (e: 'file-updated', fileId: string, fileName: string): void;
  (e: 'file-created', projectId: string, fileId: string, fileName: string): void;
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
const richInputRef = ref<HTMLElement | null>(null);
const inputContainerRef = ref<HTMLElement | null>(null);
const isInputFocused = ref(false);

// Working context for global mode - tracks recently created projects/files
// Resets when starting a new chat session
const workingContext = ref<WorkingContext>({ recentFiles: [] });

// Computed properties for mode detection
const isGlobalMode = computed(() => selectedScope.value === ALL_PROJECTS_SCOPE);
const currentScopeName = computed(() => {
  if (isGlobalMode.value) return 'All Projects';
  const project = props.projects.find(p => p.id === selectedScope.value);
  return project?.name || 'Select Project';
});

// Scope dropdown state
const showScopeDropdown = ref(false);

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

// Planner flow state
const pendingPlan = ref<ExecutionPlan | null>(null);
const isExecutingPlan = ref(false);
const currentPlanStep = ref<{ step: PlanStep; index: number; total: number } | null>(null);

// Tool execution log state
const toolLogs = ref<ToolLogEntry[]>([]);
const isToolLogExpanded = ref(true); // Expanded during execution
const formattedToolOutputs = ref<string[]>([]);
const currentToolStreamingContent = ref(''); // Shows real-time tool output during execution
const pendingFinalAnswer = ref(''); // Holds the final answer until next query (to keep order correct)

// Inline tool indicators state
const expandedToolIds = ref<Set<string>>(new Set());
// Selection card expand/collapse state (for user message references)
const expandedSelectionIds = ref<Set<string>>(new Set());
const currentRunningToolId = computed(() => {
  const running = toolLogs.value.find(l => l.status === 'running');
  return running?.id || null;
});
const pendingToolExecutions = ref<ToolExecutionRecord[]>([]); // Tool executions to attach to the next assistant message

// Chat history state
const showHistoryDropdown = ref(false);
const chatHistory = ref<ChatSession[]>([]);
const currentSessionTitle = ref('New Chat');

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

// Handler for selection card toggle events (from rendered HTML)
function handleToggleSelection(event: CustomEvent<string>) {
  const selectionId = event.detail;
  if (expandedSelectionIds.value.has(selectionId)) {
    expandedSelectionIds.value.delete(selectionId);
  } else {
    expandedSelectionIds.value.add(selectionId);
  }
  // Force reactivity update
  expandedSelectionIds.value = new Set(expandedSelectionIds.value);
}

onMounted(async () => {
  if (props.initialProjectId) {
    selectedScope.value = props.initialProjectId;
    selectedProjectId.value = props.initialProjectId;
  }
  await loadSession();
  
  // Listen for selection toggle events from rendered HTML
  window.addEventListener('toggle-selection', handleToggleSelection as EventListener);
});

onUnmounted(() => {
  window.removeEventListener('toggle-selection', handleToggleSelection as EventListener);
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
  currentSessionTitle.value = session.title || 'New Chat';
  sessionReady.value = true;
  
  // Load chat history for this project/global
  await loadChatHistory();
}

async function loadChatHistory() {
  chatHistory.value = await getSessionHistory(selectedProjectId.value);
}

async function handleNewChat() {
  showHistoryDropdown.value = false;
  
  // Reset all chat state to allow a fresh start
  isTyping.value = false;
  isExecutingPlan.value = false;
  pendingPlan.value = null;
  currentPlanStep.value = null;
  toolLogs.value = [];
  streamingContent.value = '';
  currentToolStreamingContent.value = '';
  pendingFinalAnswer.value = '';
  pendingToolExecutions.value = [];
  executionSteps.value = [];
  formattedToolOutputs.value = [];
  isToolLogExpanded.value = true;
  activePreview.value = null;
  expandedToolIds.value = new Set();
  inputMessage.value = '';
  if (richInputRef.value) {
    richInputRef.value.innerHTML = '';
  }
  
  // Reset working context for global mode
  workingContext.value = { recentFiles: [] };
  
  const session = await startNewSession(selectedProjectId.value);
  sessionId.value = session.id;
  messages.value = [];
  currentSessionTitle.value = session.title || 'New Chat';
  await loadChatHistory();
}

async function handleSwitchSession(targetSessionId: string) {
  showHistoryDropdown.value = false;
  const session = await switchToSession(targetSessionId);
  if (session) {
    sessionId.value = session.id;
    messages.value = [...session.messages];
    currentSessionTitle.value = session.title || 'New Chat';
    // Reset working context when switching sessions (each session is a separate conversation)
    workingContext.value = { recentFiles: [] };
  }
}

function toggleHistoryDropdown() {
  showHistoryDropdown.value = !showHistoryDropdown.value;
}

function formatSessionDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function handleScopeChange(event: CustomEvent) {
  const scope = event.detail.value;
  selectedScope.value = scope;
  
  if (scope !== ALL_PROJECTS_SCOPE) {
    emit('project-change', scope);
  }
  
  loadSession();
}

function selectScope(scope: string) {
  showScopeDropdown.value = false;
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
  // Clear the rich input
  if (richInputRef.value) {
    richInputRef.value.innerHTML = '';
  }

  // Commit any pending final answer from previous query to messages
  if (pendingFinalAnswer.value) {
    const prevAnswer = await addMessage(sessionId.value, 'assistant', pendingFinalAnswer.value);
    // Attach tool executions to the message for persistence
    if (pendingToolExecutions.value.length > 0) {
      prevAnswer.toolExecutions = [...pendingToolExecutions.value];
    }
    messages.value = [...messages.value, prevAnswer];
    pendingFinalAnswer.value = '';
    pendingToolExecutions.value = [];
    toolLogs.value = [];
  }

  // Add user message
  const userMessage = await addMessage(sessionId.value, 'user', messageText);
  messages.value = [...messages.value, userMessage];
  currentSessionTitle.value = userMessage.content.substring(0, 50) + (userMessage.content.length > 50 ? '...' : '');
  
  await scrollToBottom();
  isTyping.value = true;
  executionSteps.value = [];
  streamingContent.value = '';
  toolLogs.value = [];
  formattedToolOutputs.value = [];
  isToolLogExpanded.value = true;
  pendingFinalAnswer.value = '';

  try {
    // Get file names based on mode
    let projectFileNames: string[];
    if (isGlobalMode.value) {
      const allFiles = await getAllFilesForAutocomplete();
      projectFileNames = allFiles.map(f => `${f.projectName}/${f.path}`);
    } else {
      const files = await get_project_files(selectedProjectId.value!);
      projectFileNames = files.map(f => f.name);
    }

    // Build conversation context with user messages only for better context retention
    // Filter last 12 user messages (excluding current), with 500 chars each
    const userMessages = messages.value
      .slice(0, -1) // Exclude current message
      .filter(m => m.role === 'user')
      .slice(-12); // Last 12 user messages
    
    const conversationContext = userMessages
      .map(m => {
        const truncatedContent = m.content.length > 500 
          ? m.content.substring(0, 500) + '...' 
          : m.content;
        return `User: ${truncatedContent}`;
      })
      .join('\n');

    // Build current file context if a file is open in the editor
    const currentFileContext = props.currentFile ? {
      fileName: props.currentFile.name,
      filePath: props.currentFile.name, // name includes the full path in HydraNote
      fileType: props.currentFile.type,
      projectId: props.currentFile.projectId,
      projectName: props.projects.find((p: Project) => p.id === props.currentFile?.projectId)?.name,
    } : undefined;

    // Phase 1: Create execution plan
    const plan = await createExecutionPlan(
      messageText,
      selectedProjectId.value,
      projectFileNames,
      conversationContext,
      undefined, // replanContext
      isGlobalMode.value ? workingContext.value : undefined,
      currentFileContext,
    );

    // Handle clarification request
    if (plan.needsClarification) {
      const clarificationMessage = await addMessage(
        sessionId.value,
        'assistant',
        plan.clarificationQuestion || 'I need more information to proceed. Could you please clarify your request?'
      );
      messages.value = [...messages.value, clarificationMessage];
      isTyping.value = false;
      await scrollToBottom();
      return;
    }

    // Handle empty plan (just a conversation - no tools needed)
    if (plan.steps.length === 0) {
      console.log('[ChatSidebar] Empty plan - direct conversation mode');
      const systemPrompt = isGlobalMode.value
        ? await buildGlobalSystemPrompt(workingContext.value)
        : await buildSystemPrompt(selectedProjectId.value!);
      
      console.log('[ChatSidebar] System prompt length:', systemPrompt.length);
      
      // Build messages for LLM
      const llmMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPrompt },
        ...messages.value.slice(0, -1).map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: messageText },
      ];

      console.log('[ChatSidebar] Sending to LLM:');
      llmMessages.forEach((m, i) => {
        console.log(`[ChatSidebar]   [${i}] ${m.role}: ${m.content.length} chars`);
      });

      // Stream response directly
      const response = await chatCompletionStreaming(
        { messages: llmMessages },
        (chunk: string, done: boolean) => {
          if (done) return;
          streamingContent.value += chunk;
          scrollToBottom();
        }
      );

      const assistantMessage = await addMessage(sessionId.value, 'assistant', response.content);
      messages.value = [...messages.value, assistantMessage];
      isTyping.value = false;
      streamingContent.value = '';
      await scrollToBottom();
      return;
    }

    // Check if this is a simple plan that should auto-execute
    if (shouldAutoExecutePlan(plan)) {
      // Auto-execute without confirmation
      await executeAutoExecutePlan(plan);
      return;
    }

    // Complex plan - show confirmation UI
    const planSummaryMessage = await addMessage(
      sessionId.value,
      'assistant',
      `I've created an execution plan:\n\n**${plan.summary}**\n\nPlease review the steps below and click "Execute Plan" to proceed.`
    );
    messages.value = [...messages.value, planSummaryMessage];

    // Set pending plan for user confirmation
    pendingPlan.value = plan;
    
    // Don't reset isTyping - keep it true while waiting for confirmation
    // This prevents the user from sending another message

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get response';
    const assistantMessage = await addMessage(sessionId.value, 'assistant', `⚠️ Error: ${errorMessage}`);
    messages.value = [...messages.value, assistantMessage];
    isTyping.value = false;
  } finally {
    executionSteps.value = [];
    streamingContent.value = '';
    await scrollToBottom();
  }
}

/**
 * Auto-execute a simple single-step plan without confirmation
 */
async function executeAutoExecutePlan(plan: ExecutionPlan) {
  isExecutingPlan.value = true;
  currentToolStreamingContent.value = '';
  
  try {
    const result = await runPlannerFlow(
      plan,
      selectedProjectId.value,
      {
        onStepUpdate: (step, index, total) => {
          // Update plan step status
          const planStep = plan.steps.find(s => s.id === step.id);
          if (planStep) {
            planStep.status = step.status;
            planStep.error = step.error;
          }
          currentPlanStep.value = { step, index, total };
          // Clear streaming content when a new step starts
          if (step.status === 'running') {
            currentToolStreamingContent.value = '';
          }
          // Refresh sidebar immediately when a persisting tool completes
          if (step.status === 'completed' && step.persistedChanges) {
            emit('projects-changed');
          }
          scrollToBottom();
        },
        onToolLog: (log: ToolLogEntry) => {
          // Update tool logs for UI - create new array to trigger reactivity
          const existingIndex = toolLogs.value.findIndex(l => l.id === log.id);
          if (existingIndex >= 0) {
            // Create a deep copy to ensure Vue detects child changes
            const updatedLog = { ...log, children: log.children ? [...log.children] : undefined };
            toolLogs.value = [
              ...toolLogs.value.slice(0, existingIndex),
              updatedLog,
              ...toolLogs.value.slice(existingIndex + 1)
            ];
          } else {
            toolLogs.value = [...toolLogs.value, log];
          }
          scrollToBottom();
        },
        onToolResultStream: (chunk: string, done: boolean) => {
          // Show tool result content during execution
          if (!done && chunk) {
            // Replace content (not append) since we're getting full results
            currentToolStreamingContent.value = chunk;
            scrollToBottom();
          }
          // Don't clear on done - keep visible until execution completes
        },
        onStreamChunk: (chunk: string, done: boolean) => {
          if (done) return;
          streamingContent.value += chunk;
          scrollToBottom();
        },
        skipInterpretation: false,
      }
    );

    // Collapse the tool log after completion
    isToolLogExpanded.value = false;

    // Store formatted outputs for display (shown in tool log UI)
    formattedToolOutputs.value = result.formattedToolOutputs;

    // Store just the LLM interpretation as pending answer
    // Tool outputs are already visible in the collapsible tool log UI
    if (result.response?.trim()) {
      pendingFinalAnswer.value = result.response;
      // Capture tool executions for persistence with the message
      pendingToolExecutions.value = toolLogs.value.map(toolLogToRecord);
    }

    // Handle file creations
    handleExecutionFileCreations(result.toolResults);

    // Check for changes
    handleExecutionChanges(result.toolResults);

    // Update working context (for global mode)
    updateWorkingContextFromResults(result.toolResults);

    // Check for updateFile previews (auto-applies if multiple files)
    // This may replace pendingFinalAnswer with a concise summary
    await handleUpdateFilePreview(result.toolResults);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to execute';
    const assistantMessage = await addMessage(sessionId.value, 'assistant', `⚠️ Error: ${errorMessage}`);
    messages.value = [...messages.value, assistantMessage];
  } finally {
    isExecutingPlan.value = false;
    currentPlanStep.value = null;
    isTyping.value = false;
    streamingContent.value = '';
    currentToolStreamingContent.value = '';
    // Collapse the tool log (keep it visible but collapsed)
    isToolLogExpanded.value = false;
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

/**
 * Handle input in the rich contenteditable div
 */
function handleRichInput(event: Event) {
  const target = event.target as HTMLElement;
  // Extract text content, restoring original references from data attributes
  const rawText = extractRawTextFromRichInput(target);
  inputMessage.value = rawText;
  
  // Re-render with styled references
  renderRichInputContent();
  
  // Handle autocomplete
  handleInputChange();
}

/**
 * Extract raw text from rich input, restoring original @references from data attributes
 */
function extractRawTextFromRichInput(element: HTMLElement): string {
  let result = '';
  
  function processNode(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent || '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      
      // Check if this is a pill with stored reference
      if (el.classList.contains('input-pill') && el.dataset.reference) {
        // Restore the original reference text
        result += decodeHtmlEntities(el.dataset.reference);
      } else if (el.tagName === 'BR') {
        result += '\n';
      } else {
        // Process child nodes
        for (const child of Array.from(el.childNodes)) {
          processNode(child);
        }
      }
    }
  }
  
  processNode(element);
  return result;
}

/**
 * Decode HTML entities back to original characters
 */
function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

/**
 * Handle paste in rich input - strip formatting
 */
function handlePaste(event: ClipboardEvent) {
  event.preventDefault();
  const text = event.clipboardData?.getData('text/plain') || '';
  
  // Insert plain text at cursor position
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    
    // Move cursor after inserted text
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  
  // Trigger input handler
  if (richInputRef.value) {
    handleRichInput({ target: richInputRef.value } as unknown as Event);
  }
}

function handleInputFocus() {
  isInputFocused.value = true;
}

function handleInputBlur() {
  isInputFocused.value = false;
}

/**
 * Render styled references in the rich input while preserving cursor position
 */
function renderRichInputContent() {
  if (!richInputRef.value) return;
  
  const content = inputMessage.value;
  
  // Check if we have any references to style
  const hasReferences = /@(file|project|selection):/.test(content);
  
  if (!hasReferences) {
    // No references - just show plain text (don't re-render to preserve cursor)
    return;
  }
  
  // Save cursor position
  const selection = window.getSelection();
  const cursorOffset = getCursorOffsetInElement(richInputRef.value);
  
  // Render with styled references (for input, we use a simpler inline version)
  const styledHtml = renderInputReferences(content);
  
  // Only update if content changed
  if (richInputRef.value.innerHTML !== styledHtml) {
    richInputRef.value.innerHTML = styledHtml;
    
    // Restore cursor position
    if (cursorOffset !== null && selection) {
      restoreCursorPosition(richInputRef.value, cursorOffset);
    }
  }
}

/**
 * Get cursor offset from start of element, accounting for pills
 * Pills display shortened text but we need to count their full data-reference length
 */
function getCursorOffsetInElement(element: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  
  const range = selection.getRangeAt(0);
  let offset = 0;
  let found = false;
  
  function traverseNode(node: Node): boolean {
    if (found) return true;
    
    if (node.nodeType === Node.TEXT_NODE) {
      // Check if this text node contains the cursor
      if (node === range.endContainer) {
        offset += range.endOffset;
        found = true;
        return true;
      }
      offset += node.textContent?.length || 0;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      
      // Check if this is a pill with stored reference
      if (el.classList.contains('input-pill') && el.dataset.reference) {
        // Check if cursor is inside or after this pill
        if (range.endContainer === el || el.contains(range.endContainer)) {
          // Cursor is inside the pill - count full reference length
          offset += decodeHtmlEntities(el.dataset.reference).length;
          found = true;
          return true;
        }
        // Cursor is after this pill - count full reference length
        offset += decodeHtmlEntities(el.dataset.reference).length;
      } else if (el.tagName === 'BR') {
        if (el === range.endContainer) {
          found = true;
          return true;
        }
        offset += 1; // Count BR as newline
      } else {
        // Traverse child nodes
        for (const child of Array.from(el.childNodes)) {
          if (traverseNode(child)) return true;
        }
      }
    }
    return false;
  }
  
  traverseNode(element);
  return found ? offset : null;
}

/**
 * Restore cursor position in element, accounting for pills
 * Pills display shortened text but we count their full data-reference length
 */
function restoreCursorPosition(element: HTMLElement, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  
  const range = document.createRange();
  let charCount = 0;
  let found = false;
  
  function traverseNodes(node: Node): boolean {
    if (found) return true;
    
    if (node.nodeType === Node.TEXT_NODE) {
      const textLength = node.textContent?.length || 0;
      if (charCount + textLength >= offset) {
        range.setStart(node, offset - charCount);
        range.setEnd(node, offset - charCount);
        found = true;
        return true;
      }
      charCount += textLength;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      
      // Check if this is a pill with stored reference
      if (el.classList.contains('input-pill') && el.dataset.reference) {
        const refLength = decodeHtmlEntities(el.dataset.reference).length;
        if (charCount + refLength >= offset) {
          // Target position is within or at end of this pill - place cursor after pill
          range.setStartAfter(el);
          range.setEndAfter(el);
          found = true;
          return true;
        }
        charCount += refLength;
      } else if (el.tagName === 'BR') {
        if (charCount + 1 >= offset) {
          range.setStartAfter(el);
          range.setEndAfter(el);
          found = true;
          return true;
        }
        charCount += 1;
      } else {
        // Traverse child nodes
        for (const child of Array.from(el.childNodes)) {
          if (traverseNodes(child)) return true;
        }
      }
    }
    return false;
  }
  
  found = traverseNodes(element);
  
  if (found) {
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    // Put cursor at end if position not found
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

/**
 * Render references for the input field (inline pills only, hide code blocks)
 */
function renderInputReferences(content: string): string {
  // Use a marker system to handle replacements while preserving text escaping
  const markers: { placeholder: string; html: string }[] = [];
  let markerIndex = 0;
  let result = content;
  
  // Helper to create unique placeholder
  const createMarker = (html: string): string => {
    const placeholder = `\x00PILL${markerIndex++}\x00`;
    markers.push({ placeholder, html });
    return placeholder;
  };
  
  // First, handle @selection with code blocks - match the ENTIRE selection including code block
  // Pattern: @selection:filepath:startLine-endLine followed by newline and code block
  // Filepath captured until :digits pattern (handles spaces in paths)
  result = result.replace(/@selection:(.+?):(\d+)-(\d+)\s*\n```[\s\S]*?```\n?/g, (match, filePath, startLine, endLine) => {
    const fileName = getFileName(filePath);
    const iconClass = getFileIconClass(filePath);
    const html = `<span class="input-pill selection-pill ${iconClass}" contenteditable="false" data-reference="${escapeHtml(match)}"><span class="pill-icon">📄</span><span class="pill-text">${escapeHtml(fileName)}</span><span class="pill-lines">:${startLine}-${endLine}</span></span>`;
    return createMarker(html);
  });
  
  // Also handle @selection without code block (just the reference line)
  // Filepath captured until :digits pattern (handles spaces in paths)
  result = result.replace(/@selection:(.+?):(\d+)-(\d+)/g, (match, filePath, startLine, endLine) => {
    const fileName = getFileName(filePath);
    const iconClass = getFileIconClass(filePath);
    const html = `<span class="input-pill selection-pill ${iconClass}" contenteditable="false" data-reference="${escapeHtml(match)}"><span class="pill-icon">📄</span><span class="pill-text">${escapeHtml(fileName)}</span><span class="pill-lines">:${startLine}-${endLine}</span></span>`;
    return createMarker(html);
  });
  
  // Handle @file:path references - show only filename
  // Match until file extension (handles paths with spaces)
  result = result.replace(/@file:(.+?\.(?:md|pdf|docx|doc|txt|png|jpg|jpeg|webp|gif))(?=\s|$)/gi, (match, filePath) => {
    const fileName = getFileName(filePath);
    const iconClass = getFileIconClass(filePath);
    const html = `<span class="input-pill file-pill ${iconClass}" contenteditable="false" data-reference="${escapeHtml(match)}"><span class="pill-icon">📄</span><span class="pill-text">${escapeHtml(fileName)}</span></span>`;
    return createMarker(html);
  });
  
  // Handle @project:name references (match until double space, newline, or end)
  result = result.replace(/@project:(.+?)(?=\s{2}|\n|$)/g, (match, projectName) => {
    // Trim trailing single space if present
    const cleanName = projectName.trim();
    const html = `<span class="input-pill project-pill" contenteditable="false" data-reference="${escapeHtml(match)}"><span class="pill-icon">📁</span><span class="pill-text">${escapeHtml(cleanName)}</span></span>`;
    return createMarker(html);
  });
  
  // Escape HTML for all remaining text
  result = escapeHtml(result);
  
  // Replace markers with actual HTML
  for (const { placeholder, html } of markers) {
    result = result.replace(placeholder, html);
  }
  
  return result;
}

function getCursorPosition(): number {
  // For rich input, get cursor position from contenteditable
  if (richInputRef.value) {
    const offset = getCursorOffsetInElement(richInputRef.value);
    if (offset !== null) return offset;
  }
  // Fallback for IonTextarea
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
  
  // Update the rich input and focus it
  nextTick(() => {
    if (richInputRef.value) {
      richInputRef.value.innerHTML = renderInputReferences(inputMessage.value);
      richInputRef.value.focus();
      
      // Place cursor at the end
      const range = document.createRange();
      range.selectNodeContents(richInputRef.value);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
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
      const successMessage = await addMessage(
        sessionId.value,
        'assistant',
        `File "${result.fileName}" has been updated successfully. The file has been re-indexed.`
      );
      messages.value = [...messages.value, successMessage];
      
      // Emit event to refresh the file in the editor if it's currently open
      emit('file-updated', previewFileId, previewFileName);
    } else {
      const errorMsg = await addMessage(
        sessionId.value,
        'assistant',
        `Failed to update file: ${result.error}`
      );
      messages.value = [...messages.value, errorMsg];
    }
  } catch (error) {
    const errorStr = error instanceof Error ? error.message : 'Unknown error';
    const errorMsg = await addMessage(
      sessionId.value,
      'assistant',
      `Failed to apply update: ${errorStr}`
    );
    messages.value = [...messages.value, errorMsg];
  } finally {
    activePreview.value = null;
    isApplyingUpdate.value = false;
    await scrollToBottom();
  }
}

async function handleCancelUpdate() {
  if (activePreview.value) {
    removePendingPreview(activePreview.value.previewId);
    const cancelMessage = await addMessage(
      sessionId.value,
      'assistant',
      'Update cancelled. No changes were made to the file.'
    );
    messages.value = [...messages.value, cancelMessage];
  }
  activePreview.value = null;
  await scrollToBottom();
}

// Execution plan handlers
async function handleCancelPlan() {
  if (pendingPlan.value) {
    const cancelMessage = await addMessage(
      sessionId.value,
      'assistant',
      'Execution plan cancelled.'
    );
    messages.value = [...messages.value, cancelMessage];
  }
  pendingPlan.value = null;
  isTyping.value = false;
  await scrollToBottom();
}

async function handleExecutePlan() {
  if (!pendingPlan.value) return;

  // Store the plan locally and clear it immediately so the UI hides the plan box
  const planToExecute = pendingPlan.value;
  pendingPlan.value = null;
  
  isExecutingPlan.value = true;
  toolLogs.value = [];
  formattedToolOutputs.value = [];
  isToolLogExpanded.value = true;
  currentToolStreamingContent.value = '';
  
  try {
    const result = await runPlannerFlow(
      planToExecute,
      selectedProjectId.value,
      {
        onStepUpdate: (step, index, total) => {
          currentPlanStep.value = { step, index, total };
          // Clear streaming content when a new step starts
          if (step.status === 'running') {
            currentToolStreamingContent.value = '';
          }
          // Refresh sidebar immediately when a persisting tool completes
          if (step.status === 'completed' && step.persistedChanges) {
            emit('projects-changed');
          }
          scrollToBottom();
        },
        onToolLog: (log: ToolLogEntry) => {
          // Update tool logs for UI - create new array to trigger reactivity
          const existingIndex = toolLogs.value.findIndex(l => l.id === log.id);
          if (existingIndex >= 0) {
            // Create a deep copy to ensure Vue detects child changes
            const updatedLog = { ...log, children: log.children ? [...log.children] : undefined };
            toolLogs.value = [
              ...toolLogs.value.slice(0, existingIndex),
              updatedLog,
              ...toolLogs.value.slice(existingIndex + 1)
            ];
          } else {
            toolLogs.value = [...toolLogs.value, log];
          }
          scrollToBottom();
        },
        onToolResultStream: (chunk: string, done: boolean) => {
          // Show tool result content during execution
          if (!done && chunk) {
            // Replace content (not append) since we're getting full results
            currentToolStreamingContent.value = chunk;
            scrollToBottom();
          }
          // Don't clear on done - keep visible until execution completes
        },
        onStreamChunk: (chunk: string, done: boolean) => {
          if (done) return;
          streamingContent.value += chunk;
          scrollToBottom();
        },
      }
    );

    currentPlanStep.value = null;

    // Collapse the tool log after completion
    isToolLogExpanded.value = false;

    // Store formatted outputs for display (shown in tool log UI)
    formattedToolOutputs.value = result.formattedToolOutputs;

    // Store just the LLM interpretation as pending answer
    // Tool outputs are already visible in the collapsible tool log UI
    if (result.response?.trim()) {
      pendingFinalAnswer.value = result.response;
      // Capture tool executions for persistence with the message
      pendingToolExecutions.value = toolLogs.value.map(toolLogToRecord);
    }

    // Handle file creations
    handleExecutionFileCreations(result.toolResults);

    // Check for changes
    handleExecutionChanges(result.toolResults);

    // Update working context (for global mode)
    updateWorkingContextFromResults(result.toolResults);

    // Check for updateFile previews (auto-applies if multiple files)
    // This may replace pendingFinalAnswer with a concise summary
    await handleUpdateFilePreview(result.toolResults);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to execute plan';
    // Errors go directly to messages since they're not part of normal flow
    const assistantMessage = await addMessage(sessionId.value, 'assistant', `⚠️ Error: ${errorMessage}`);
    messages.value = [...messages.value, assistantMessage];
  } finally {
    isExecutingPlan.value = false;
    pendingPlan.value = null;
    currentPlanStep.value = null;
    isTyping.value = false;
    streamingContent.value = '';
    currentToolStreamingContent.value = '';
    // Collapse the tool log (keep it visible but collapsed)
    isToolLogExpanded.value = false;
    await scrollToBottom();
  }
}

/**
 * Helper: Handle file creation events from tool results
 */
function handleExecutionFileCreations(toolResults: Array<{ tool: string; success: boolean; metadata?: { fileId?: string; fileName?: string; projectId?: string } }>) {
  const fileCreationResults = toolResults.filter(
    (r) => (r.tool === 'write' || r.tool === 'addNote') && r.success && r.metadata?.fileId
  );
  for (const fileResult of fileCreationResults) {
    if (fileResult.metadata?.fileId && fileResult.metadata?.fileName) {
      const projectId = fileResult.metadata?.projectId || selectedProjectId.value;
      if (projectId) {
        emit('file-created', projectId, fileResult.metadata.fileId, fileResult.metadata.fileName);
      }
    }
  }
}

/**
 * Helper: Handle project/file change events from tool results
 * Emits projects-changed if any tool made persisting changes
 */
function handleExecutionChanges(toolResults: Array<{ tool: string; success: boolean; persistedChanges?: boolean }>) {
  const hasChanges = toolResults.some(
    (r) => r.success && r.persistedChanges
  );
  if (hasChanges) {
    emit('projects-changed');
  }
}

/**
 * Helper: Update working context from tool results
 * Extracts project/file references from createProject and write tool results
 * Only active in global mode
 */
function updateWorkingContextFromResults(toolResults: ToolResult[]) {
  // Only track working context in global mode
  if (!isGlobalMode.value) return;
  
  for (const result of toolResults) {
    if (!result.success) continue;
    
    // Track newly created project
    if (result.tool === 'createProject' && result.metadata?.projectId) {
      workingContext.value.projectId = result.metadata.projectId as string;
      workingContext.value.projectName = result.metadata.projectName as string;
    }
    
    // Track newly created files
    if (result.tool === 'write' && result.metadata?.fileId) {
      const projectId = (result.metadata.projectId as string) || workingContext.value.projectId;
      const projectName = (result.metadata.projectName as string) || workingContext.value.projectName;
      
      if (projectId && projectName) {
        workingContext.value.recentFiles.push({
          fileId: result.metadata.fileId as string,
          fileName: result.metadata.fileName as string,
          projectId,
          projectName,
        });
        // Limit to last 10 files to avoid bloat
        if (workingContext.value.recentFiles.length > 10) {
          workingContext.value.recentFiles.shift();
        }
      }
    }
  }
}

/**
 * Helper: Handle updateFile preview from tool results
 * - Single file: show confirmation dialog
 * - Multiple files: auto-apply all (user already confirmed the plan)
 */
async function handleUpdateFilePreview(toolResults: Array<{ tool: string; success: boolean; preview?: UpdateFilePreview }>) {
  // Get ALL updateFile results with previews
  const updateFileResults = toolResults.filter(
    (r) => r.tool === 'updateFile' && r.success && r.preview
  );

  if (updateFileResults.length === 0) {
    return; // No updates to process
  }

  if (updateFileResults.length === 1) {
    // Single file: show confirmation dialog (existing behavior)
    activePreview.value = updateFileResults[0].preview!;
  } else {
    // Multiple files: auto-apply all (user already confirmed the plan)
    await applyAllFileUpdates(updateFileResults.map(r => r.preview!));
  }
}

/**
 * Auto-apply multiple file updates without confirmation
 * Used when the plan contains multiple updateFile steps (user already approved the plan)
 * Replaces the verbose pendingFinalAnswer with a concise summary
 */
async function applyAllFileUpdates(previews: UpdateFilePreview[]) {
  const results: { fileName: string; fileId: string; success: boolean; error?: string }[] = [];

  for (const preview of previews) {
    try {
      const result = await applyFileUpdate(preview.previewId);
      results.push({
        fileName: result.fileName,
        fileId: preview.fileId,
        success: result.success,
        error: result.error,
      });

      // Emit file-updated event for each successful update
      if (result.success) {
        emit('file-updated', preview.fileId, preview.fileName);
      }
    } catch (error) {
      results.push({
        fileName: preview.fileName,
        fileId: preview.fileId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Build concise summary message
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  let summaryMessage = '';
  if (successful.length > 0) {
    summaryMessage += `**Updated ${successful.length} file(s):**\n`;
    summaryMessage += successful.map(r => `- ${r.fileName}`).join('\n');
  }
  if (failed.length > 0) {
    if (summaryMessage) summaryMessage += '\n\n';
    summaryMessage += `**Failed to update ${failed.length} file(s):**\n`;
    summaryMessage += failed.map(r => `- ${r.fileName}: ${r.error}`).join('\n');
  }

  // Replace the verbose pendingFinalAnswer with our concise summary
  // This avoids showing the preview/confirmation text that's now outdated
  if (summaryMessage) {
    pendingFinalAnswer.value = summaryMessage;
  }

  // Emit projects-changed to refresh file tree if any updates succeeded
  if (successful.length > 0) {
    emit('projects-changed');
  }

  await scrollToBottom();
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

function toggleToolLog() {
  isToolLogExpanded.value = !isToolLogExpanded.value;
}

function getToolLogStatusClass(status: ToolLogEntry['status']): string {
  switch (status) {
    case 'running':
      return 'tool-log-running';
    case 'completed':
      return 'tool-log-completed';
    case 'failed':
      return 'tool-log-failed';
    default:
      return '';
  }
}

function formatToolLogDuration(entry: ToolLogEntry): string {
  if (entry.durationMs === undefined) return '';
  if (entry.durationMs < 1000) return `${entry.durationMs}ms`;
  return `${(entry.durationMs / 1000).toFixed(1)}s`;
}

// Helper to format duration from milliseconds
function formatDuration(ms?: number): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Toggle tool indicator expansion for showing details
function toggleToolExpansion(toolId: string) {
  if (expandedToolIds.value.has(toolId)) {
    expandedToolIds.value.delete(toolId);
  } else {
    expandedToolIds.value.add(toolId);
  }
  // Force reactivity update
  expandedToolIds.value = new Set(expandedToolIds.value);
}

// Get last meaningful line from streaming content for preview
function getLastLine(content: string): string {
  if (!content) return '';
  const lines = content.trim().split('\n').filter(line => line.trim());
  const lastLine = lines[lines.length - 1] || '';
  // Truncate if too long
  return lastLine.length > 60 ? lastLine.substring(0, 57) + '...' : lastLine;
}

// Convert ToolLogEntry to ToolExecutionRecord for persistence
function toolLogToRecord(log: ToolLogEntry): ToolExecutionRecord {
  return {
    id: log.id,
    tool: log.tool,
    description: log.description,
    status: log.status,
    durationMs: log.durationMs,
    resultPreview: log.resultPreview,
    resultData: log.resultData,
    error: log.error,
    timestamp: log.startTime,
    children: log.children,
  };
}

function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false }) as string;
}

// ============================================
// User Message Reference Parsing & Rendering
// ============================================

interface ParsedReference {
  type: 'file' | 'project' | 'selection';
  fullMatch: string;
  filePath?: string;
  projectName?: string;
  startLine?: number;
  endLine?: number;
  codeContent?: string;
  id?: string; // Unique ID for selection cards (for expand/collapse state)
}

/**
 * Parse user message for @file:, @project:, and @selection: references
 */
function parseUserMessageReferences(content: string): { parts: Array<string | ParsedReference>; references: ParsedReference[] } {
  const references: ParsedReference[] = [];
  const parts: Array<string | ParsedReference> = [];
  
  // Combined pattern to match all reference types in order
  // Pattern 1: @selection:filepath:startLine-endLine followed by code block (filepath can have spaces, captured until :digits)
  // Pattern 2: @file:path/to/file.md (match until file extension, handles spaces in paths)
  // Pattern 3: @project:ProjectName (match until double space, newline, or another @ reference)
  const combinedPattern = /(@selection:(.+?):(\d+)-(\d+)\s*\n```(?:\w*\n)?([\s\S]*?)```)|(@file:(.+?\.(?:md|pdf|docx|doc|txt|png|jpg|jpeg|webp|gif)))(?=\s|$|@)|(@project:(.+?))(?=\s{2}|\n|$|@)/gi;
  
  let lastIndex = 0;
  let match;
  let selectionCounter = 0;
  
  while ((match = combinedPattern.exec(content)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      const textBefore = content.substring(lastIndex, match.index);
      if (textBefore.trim()) {
        parts.push(textBefore);
      }
    }
    
    if (match[1]) {
      // Selection reference with code block
      const ref: ParsedReference = {
        type: 'selection',
        fullMatch: match[1],
        filePath: match[2],
        startLine: parseInt(match[3], 10),
        endLine: parseInt(match[4], 10),
        codeContent: match[5]?.trim() || '',
        id: `selection-${selectionCounter++}`,
      };
      references.push(ref);
      parts.push(ref);
    } else if (match[6]) {
      // File reference
      const ref: ParsedReference = {
        type: 'file',
        fullMatch: match[6],
        filePath: match[7],
      };
      references.push(ref);
      parts.push(ref);
    } else if (match[8]) {
      // Project reference
      const ref: ParsedReference = {
        type: 'project',
        fullMatch: match[8],
        projectName: match[9],
      };
      references.push(ref);
      parts.push(ref);
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text after last match
  if (lastIndex < content.length) {
    const remaining = content.substring(lastIndex);
    if (remaining.trim()) {
      parts.push(remaining);
    }
  }
  
  return { parts, references };
}

/**
 * Escape HTML entities in plain text to prevent XSS
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, char => htmlEntities[char]);
}

/**
 * Get file extension icon class based on file path
 */
function getFileIconClass(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'md':
      return 'file-icon-md';
    case 'pdf':
      return 'file-icon-pdf';
    case 'docx':
    case 'doc':
      return 'file-icon-docx';
    case 'txt':
      return 'file-icon-txt';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif':
      return 'file-icon-image';
    default:
      return 'file-icon-default';
  }
}

/**
 * Extract just the filename from a path
 */
function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

/**
 * Render user message with styled reference components
 */
function renderUserMessage(content: string): string {
  const { parts } = parseUserMessageReferences(content);
  
  // If no references found, return escaped plain text
  if (parts.length === 0 || (parts.length === 1 && typeof parts[0] === 'string')) {
    return escapeHtml(content);
  }
  
  let html = '';
  
  for (const part of parts) {
    if (typeof part === 'string') {
      // Plain text - escape and preserve whitespace
      html += `<span class="user-text">${escapeHtml(part)}</span>`;
    } else if (part.type === 'file') {
      // File pill
      const fileName = getFileName(part.filePath || '');
      const iconClass = getFileIconClass(part.filePath || '');
      html += `<span class="reference-pill file-pill ${iconClass}" title="${escapeHtml(part.filePath || '')}">
        <span class="pill-icon">📄</span>
        <span class="pill-label">${escapeHtml(fileName)}</span>
      </span>`;
    } else if (part.type === 'project') {
      // Project pill
      html += `<span class="reference-pill project-pill" title="Project: ${escapeHtml(part.projectName || '')}">
        <span class="pill-icon">📁</span>
        <span class="pill-label">${escapeHtml(part.projectName || '')}</span>
      </span>`;
    } else if (part.type === 'selection') {
      // Selection card with collapsible code
      const fileName = getFileName(part.filePath || '');
      const lineRange = `Lines ${part.startLine}-${part.endLine}`;
      const iconClass = getFileIconClass(part.filePath || '');
      const cardId = part.id || 'selection-0';
      const isExpanded = expandedSelectionIds.value.has(cardId);
      
      // Syntax highlight the code content
      let highlightedCode = escapeHtml(part.codeContent || '');
      try {
        // Try to detect language from file extension
        const ext = (part.filePath || '').split('.').pop()?.toLowerCase() || '';
        const langMap: Record<string, string> = {
          'ts': 'typescript',
          'tsx': 'typescript',
          'js': 'javascript',
          'jsx': 'javascript',
          'vue': 'html',
          'md': 'markdown',
          'py': 'python',
          'json': 'json',
          'css': 'css',
          'scss': 'scss',
          'html': 'html',
        };
        const lang = langMap[ext] || ext;
        if (lang && hljs.getLanguage(lang)) {
          highlightedCode = hljs.highlight(part.codeContent || '', { language: lang }).value;
        } else {
          highlightedCode = hljs.highlightAuto(part.codeContent || '').value;
        }
      } catch {
        // Fallback to escaped text
      }
      
      html += `<div class="selection-card ${isExpanded ? 'expanded' : 'collapsed'}" data-selection-id="${cardId}">
        <div class="selection-header" onclick="window.dispatchEvent(new CustomEvent('toggle-selection', { detail: '${cardId}' }))">
          <span class="reference-pill file-pill ${iconClass} inline-pill">
            <span class="pill-icon">📄</span>
            <span class="pill-label">${escapeHtml(fileName)}</span>
          </span>
          <span class="line-range-badge">${lineRange}</span>
          <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
        </div>
        <div class="selection-code-container" style="display: ${isExpanded ? 'block' : 'none'}">
          <pre class="selection-code"><code class="hljs">${highlightedCode}</code></pre>
        </div>
      </div>`;
    }
  }
  
  return html;
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

// Selection context for Send to Chat feature
interface SelectionContext {
  text: string;
  filePath: string | null;
  fileId: string | null;
  startLine: number;
  endLine: number;
}

// Insert selection text into chat input (for Send to Chat feature)
// Format: @selection:filepath:startLine-endLine: "text..."
// This tells the LLM exactly which file and lines to edit
function insertSelection(selection: SelectionContext) {
  if (!selection.text.trim()) return;
  
  // Truncate display text if too long (keep first 500 chars for display)
  const displayText = selection.text.length > 500 
    ? selection.text.substring(0, 500) + '...' 
    : selection.text;
  
  // Format like a code editor reference with file path and line numbers
  let selectionRef: string;
  
  if (selection.filePath) {
    // Include file path and line numbers for precise context
    selectionRef = `@selection:${selection.filePath}:${selection.startLine}-${selection.endLine}\n\`\`\`\n${displayText}\n\`\`\`\n`;
  } else {
    // No file context (new unsaved note)
    selectionRef = `@selection:${selection.startLine}-${selection.endLine}\n\`\`\`\n${displayText}\n\`\`\`\n`;
  }
  
  inputMessage.value = selectionRef + inputMessage.value;
  
  // Update the rich input and focus it
  nextTick(() => {
    if (richInputRef.value) {
      // Render the styled content
      richInputRef.value.innerHTML = renderInputReferences(inputMessage.value);
      richInputRef.value.focus();
      
      // Place cursor at the end
      const range = document.createRange();
      range.selectNodeContents(richInputRef.value);
      range.collapse(false);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  });
}

defineExpose({ selectProject, selectGlobalMode, insertSelection });
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

/* Compact Chat Header */
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 8px 12px 16px;
  background: var(--hn-bg-surface);
  border-bottom: 1px solid var(--hn-border-default);
  position: relative;
  min-height: 48px;
  box-sizing: border-box;
}

/* Scope Selector */
.scope-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: var(--hn-bg-elevated);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  max-width: 180px;
  min-width: 120px;
  position: relative;
  z-index: 10;
}

.scope-selector:hover {
  background: var(--hn-bg-hover);
}

.scope-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.scope-name {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--hn-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scope-chevron {
  font-size: 10px;
  color: var(--hn-text-muted);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

/* Scope Dropdown */
.scope-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 200px;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-strong);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 200;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px 0;
}

.scope-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--hn-text-primary);
  transition: background 0.15s ease;
}

.scope-item:hover {
  background: var(--hn-bg-hover);
}

.scope-item.active {
  background: rgba(138, 180, 248, 0.12);
  color: var(--hn-purple);
}

.scope-item-icon {
  font-size: 14px;
}

.scope-divider {
  height: 1px;
  background: var(--hn-border-default);
  margin: 4px 0;
}

/* Header Actions */
.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.header-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: var(--hn-text-secondary);
  transition: all 0.15s ease;
}

.header-action-btn:hover {
  background: var(--hn-bg-hover);
  color: var(--hn-text-primary);
}

.header-action-btn.active {
  background: rgba(138, 180, 248, 0.15);
  color: var(--hn-purple);
}

.header-action-btn ion-icon {
  font-size: 16px;
}

/* History Panel */
.history-panel {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--hn-bg-surface);
  border-bottom: 1px solid var(--hn-border-strong);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 100;
  max-height: 240px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.history-panel-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--hn-border-default);
}

.history-panel-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--hn-text-muted);
}

.history-panel-list {
  flex: 1;
  overflow-y: auto;
}

.history-panel-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.15s ease;
  border-left: 2px solid transparent;
}

.history-panel-item:hover {
  background: var(--hn-bg-hover);
}

.history-panel-item.active {
  background: rgba(138, 180, 248, 0.1);
  border-left-color: var(--hn-purple);
}

.history-item-title {
  font-size: 0.82rem;
  color: var(--hn-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.history-item-date {
  font-size: 0.7rem;
  color: var(--hn-text-muted);
  flex-shrink: 0;
}

.history-empty {
  padding: 16px 12px;
  text-align: center;
  font-size: 0.82rem;
  color: var(--hn-text-muted);
  font-style: italic;
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
  display: flex;
  flex-direction: column;
}

.message.user {
  align-items: flex-end;
}

.message.assistant {
  align-items: flex-start;
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

/* Rich Input Wrapper & Contenteditable */
.rich-input-wrapper {
  flex: 1;
  min-width: 0;
}

.rich-input {
  background: var(--hn-bg-elevated);
  color: var(--hn-text-primary);
  padding: 10px 12px;
  border-radius: 8px;
  min-height: 20px;
  max-height: 150px;
  overflow-y: auto;
  font-size: 0.9rem;
  line-height: 1.5;
  outline: none;
  border: 1px solid transparent;
  transition: border-color 0.15s ease;
  word-wrap: break-word;
  white-space: pre-wrap;
}

.rich-input:focus {
  border-color: var(--hn-purple);
}

.rich-input.disabled {
  opacity: 0.6;
  pointer-events: none;
}

/* Placeholder */
.rich-input:empty:not(:focus)::before {
  content: attr(data-placeholder);
  color: var(--hn-text-muted);
  pointer-events: none;
}

.rich-input.has-content:empty::before {
  content: '';
}

/* Rich input scrollbar */
.rich-input::-webkit-scrollbar {
  width: 6px;
}

.rich-input::-webkit-scrollbar-track {
  background: transparent;
}

.rich-input::-webkit-scrollbar-thumb {
  background: var(--hn-border-default);
  border-radius: 3px;
}

/* Input Pills (inline in contenteditable) - Outline Style */
/* Using :deep() because v-html content doesn't get scoped attributes */
.rich-input :deep(.input-pill) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  margin: 0 3px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  vertical-align: baseline;
  line-height: 1.4;
  user-select: none;
  background: transparent;
  border: 1.5px solid;
  transition: all 0.15s ease;
}

.rich-input :deep(.input-pill .pill-icon) {
  font-size: 12px;
  opacity: 0.9;
}

.rich-input :deep(.input-pill .pill-text) {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rich-input :deep(.input-pill .pill-lines) {
  font-size: 0.7rem;
  opacity: 0.7;
  font-weight: 400;
}

/* File pill in input - outline style */
.rich-input :deep(.input-pill.file-pill) {
  color: #a8c7fa;
  border-color: rgba(138, 180, 248, 0.6);
}

.rich-input :deep(.input-pill.file-pill:hover) {
  background: rgba(138, 180, 248, 0.1);
  border-color: rgba(138, 180, 248, 0.8);
}

.rich-input :deep(.input-pill.file-pill.file-icon-md) {
  color: #a8c7fa;
  border-color: rgba(138, 180, 248, 0.6);
}

.rich-input :deep(.input-pill.file-pill.file-icon-pdf) {
  color: #ff8a8a;
  border-color: rgba(255, 82, 82, 0.6);
}

.rich-input :deep(.input-pill.file-pill.file-icon-pdf:hover) {
  background: rgba(255, 82, 82, 0.1);
  border-color: rgba(255, 82, 82, 0.8);
}

.rich-input :deep(.input-pill.file-pill.file-icon-docx) {
  color: #66d9a0;
  border-color: rgba(0, 200, 83, 0.6);
}

.rich-input :deep(.input-pill.file-pill.file-icon-docx:hover) {
  background: rgba(0, 200, 83, 0.1);
  border-color: rgba(0, 200, 83, 0.8);
}

.rich-input :deep(.input-pill.file-pill.file-icon-txt) {
  color: #bdbdbd;
  border-color: rgba(189, 189, 189, 0.5);
}

.rich-input :deep(.input-pill.file-pill.file-icon-image) {
  color: #ce93d8;
  border-color: rgba(186, 104, 200, 0.5);
}

/* Project pill in input - outline style */
.rich-input :deep(.input-pill.project-pill) {
  color: #66d9a0;
  border-color: rgba(0, 200, 83, 0.6);
}

.rich-input :deep(.input-pill.project-pill:hover) {
  background: rgba(0, 200, 83, 0.1);
  border-color: rgba(0, 200, 83, 0.8);
}

/* Selection pill in input - outline style */
.rich-input :deep(.input-pill.selection-pill) {
  color: #ce93d8;
  border-color: rgba(186, 104, 200, 0.6);
}

.rich-input :deep(.input-pill.selection-pill:hover) {
  background: rgba(186, 104, 200, 0.1);
  border-color: rgba(186, 104, 200, 0.8);
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

/* Collapsible Tool Log Styles */
.tool-log-container {
  margin: 12px 0;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 10px;
  overflow: hidden;
  font-size: 0.85rem;
}

.tool-log-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--hn-bg-surface);
  cursor: pointer;
  transition: background 0.15s ease;
  user-select: none;
}

.tool-log-header:hover {
  background: var(--hn-bg-hover);
}

.tool-log-chevron {
  font-size: 14px;
  color: var(--hn-text-muted);
  transition: transform 0.2s ease;
}

.tool-log-title {
  font-weight: 600;
  color: var(--hn-text-primary);
}

.tool-log-count {
  font-size: 0.75rem;
  color: var(--hn-text-muted);
  margin-left: auto;
}

.tool-log-status-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.7rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.tool-log-status-badge.running {
  background: rgba(138, 180, 248, 0.15);
  color: var(--hn-purple);
}

.tool-log-status-badge.completed {
  background: rgba(76, 175, 80, 0.15);
  color: var(--hn-green);
}

.tool-log-status-badge.failed {
  background: rgba(255, 82, 82, 0.15);
  color: #ff5252;
}

.tool-log-status-badge .badge-spinner {
  width: 10px;
  height: 10px;
}

.tool-log-status-badge .badge-icon {
  font-size: 12px;
}

.tool-log-content {
  border-top: 1px solid var(--hn-border-default);
  max-height: 300px;
  overflow-y: auto;
}

.tool-log-entry {
  padding: 10px 12px;
  border-bottom: 1px solid var(--hn-border-subtle);
  transition: background 0.15s ease;
}

.tool-log-entry:last-child {
  border-bottom: none;
}

.tool-log-entry.tool-log-running {
  background: rgba(138, 180, 248, 0.05);
}

.tool-log-entry.tool-log-completed {
  background: transparent;
}

.tool-log-entry.tool-log-failed {
  background: rgba(255, 82, 82, 0.05);
}

.tool-log-entry-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-log-entry .tool-icon {
  font-size: 16px;
  flex-shrink: 0;
  opacity: 0.8;
}

.tool-log-entry .tool-description {
  flex: 1;
  color: var(--hn-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-log-entry .tool-status {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.tool-log-entry .tool-spinner {
  width: 14px;
  height: 14px;
  color: var(--hn-purple);
}

.tool-log-entry .status-icon {
  font-size: 14px;
}

.tool-log-entry .tool-status.completed .status-icon {
  color: var(--hn-green);
}

.tool-log-entry .tool-status.failed .status-icon {
  color: #ff5252;
}

.tool-log-entry .tool-duration {
  font-size: 0.7rem;
  color: var(--hn-text-muted);
}

.tool-log-error {
  margin-top: 6px;
  padding: 6px 8px;
  background: rgba(255, 82, 82, 0.1);
  border-radius: 4px;
  font-size: 0.75rem;
  color: #ff5252;
}

.tool-log-preview {
  margin-top: 8px;
  background: var(--hn-bg-deep);
  border-radius: 4px;
  overflow: hidden;
}

.tool-log-preview .preview-content {
  padding: 8px 10px;
  font-family: var(--hn-font-mono);
  font-size: 0.75rem;
  color: var(--hn-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 100px;
  overflow-y: auto;
  margin: 0;
}

/* Tool Streaming Area (shows real-time content during execution) */
.tool-streaming-area {
  margin-top: 8px;
  padding: 10px;
  background: var(--hn-bg-deep);
  border-radius: 6px;
  border: 1px solid var(--hn-border-subtle);
}

.tool-streaming-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 0.75rem;
  color: var(--hn-text-muted);
}

.tool-streaming-label .streaming-spinner {
  width: 12px;
  height: 12px;
  color: var(--hn-purple);
}

.tool-streaming-label .streaming-done-icon {
  font-size: 12px;
  color: var(--hn-green);
}

.tool-streaming-content {
  font-family: var(--hn-font-mono);
  font-size: 0.75rem;
  color: var(--hn-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 150px;
  overflow-y: auto;
  margin: 0;
  line-height: 1.5;
  background: transparent;
}

/* ============================================
   Inline Tool Indicators (Cursor-inspired)
   ============================================ */

.inline-tool-indicators {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 8px 0;
  padding-left: 8px;
  width: 100%;
}

.inline-tool-indicators.persisted {
  margin-top: 4px;
  margin-bottom: 0;
  padding-left: 0;
  width: 100%;
  max-width: 90%;
}

.tool-indicator {
  display: flex;
  flex-direction: column;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.75rem;
  color: var(--hn-text-muted);
  background: transparent;
  cursor: pointer;
  transition: background 0.15s ease;
  overflow: hidden;
  width: 100%;
}

.tool-indicator:hover {
  background: rgba(138, 180, 248, 0.05);
}

.tool-indicator.running {
  background: rgba(138, 180, 248, 0.08);
}

.tool-indicator-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
}

.tool-indicator-icon {
  font-size: 12px;
  flex-shrink: 0;
  opacity: 0.7;
}

.tool-indicator-desc {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--hn-text-secondary);
}

.tool-indicator-spinner {
  flex-shrink: 0;
}

.tool-indicator-spinner ion-spinner {
  width: 12px;
  height: 12px;
  color: var(--hn-purple);
}

.tool-indicator-duration {
  font-size: 0.65rem;
  color: var(--hn-text-muted);
  opacity: 0.7;
  flex-shrink: 0;
}

.tool-indicator-status {
  font-size: 12px;
  flex-shrink: 0;
}

.tool-indicator-status.completed {
  color: var(--hn-green);
  opacity: 0.7;
}

.tool-indicator-status.failed {
  color: #ff5252;
}

/* Child lines for nested tools (web research pages) */
.tool-indicator-children {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 2px;
  margin-left: 18px;
}

.tool-indicator-child {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7rem;
  color: var(--hn-text-muted);
  opacity: 0.8;
}

.tool-indicator-child.running {
  color: var(--hn-purple);
  opacity: 1;
}

.child-branch {
  font-family: var(--hn-font-mono);
  color: var(--hn-border-default);
  user-select: none;
}

.child-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.child-spinner {
  width: 10px;
  height: 10px;
  color: var(--hn-purple);
}

.child-status {
  font-size: 10px;
  flex-shrink: 0;
}

.child-status.completed {
  color: var(--hn-green);
  opacity: 0.7;
}

.child-status.failed {
  color: #ff5252;
}

/* Single-line streaming preview */
.tool-indicator-streaming {
  margin-top: 2px;
  margin-left: 18px;
  padding: 2px 6px;
  background: var(--hn-bg-deep);
  border-radius: 4px;
  overflow: hidden;
}

.streaming-preview {
  font-family: var(--hn-font-mono);
  font-size: 0.65rem;
  color: var(--hn-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

/* Expandable result preview */
.tool-indicator-preview {
  margin-top: 4px;
  margin-left: 18px;
  padding: 6px 8px;
  background: var(--hn-bg-deep);
  border-radius: 4px;
  max-height: 120px;
  overflow-y: auto;
}

.tool-indicator-preview pre {
  font-family: var(--hn-font-mono);
  font-size: 0.65rem;
  color: var(--hn-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  line-height: 1.4;
}

/* Error display in tool indicator */
.tool-indicator-error {
  margin-top: 4px;
  margin-left: 18px;
  padding: 4px 8px;
  background: rgba(255, 82, 82, 0.1);
  border-radius: 4px;
  font-size: 0.65rem;
  color: #ff5252;
}

/* Expand/collapse visual hint */
.tool-indicator.has-children .tool-indicator-main::before {
  content: '';
  width: 0;
  height: 0;
  border-left: 4px solid var(--hn-text-muted);
  border-top: 3px solid transparent;
  border-bottom: 3px solid transparent;
  transition: transform 0.15s ease;
  opacity: 0.5;
  margin-right: 2px;
}

.tool-indicator.has-children.expanded .tool-indicator-main::before {
  transform: rotate(90deg);
}

/* Generating Response Indicator */
.generating-response {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  font-size: 0.85rem;
  color: var(--hn-text-muted);
}

.generating-response .response-spinner {
  width: 14px;
  height: 14px;
  color: var(--hn-purple);
}

/* Execution Plan Styles */
.execution-plan {
  margin: 12px 0;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-strong);
  border-radius: 12px;
  overflow: hidden;
}

.plan-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: linear-gradient(135deg, var(--hn-purple-dark), var(--hn-purple));
  color: #ffffff;
}

.plan-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.plan-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.plan-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.9;
}

.plan-duration {
  font-size: 0.8rem;
  opacity: 0.8;
}

.plan-summary {
  padding: 12px 14px;
  font-size: 0.85rem;
  color: var(--hn-text-primary);
  background: var(--hn-bg-surface);
  border-bottom: 1px solid var(--hn-border-default);
  line-height: 1.5;
}

.plan-steps {
  padding: 8px 0;
  max-height: 250px;
  overflow-y: auto;
}

.plan-step {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  font-size: 0.85rem;
  transition: background 0.15s ease;
}

.plan-step:hover {
  background: var(--hn-bg-hover);
}

.plan-step.running {
  background: rgba(138, 180, 248, 0.1);
}

.plan-step.completed {
  opacity: 0.7;
}

.plan-step.failed {
  background: rgba(255, 82, 82, 0.1);
}

.step-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--hn-bg-deep);
  color: var(--hn-text-secondary);
  font-size: 0.7rem;
  font-weight: 600;
  flex-shrink: 0;
}

.plan-step.running .step-number {
  background: var(--hn-purple);
  color: #ffffff;
}

.plan-step.completed .step-number {
  background: var(--hn-green);
  color: #ffffff;
}

.plan-step.failed .step-number {
  background: #ff5252;
  color: #ffffff;
}

.step-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.step-detail {
  font-size: 11px;
  color: var(--hn-purple);
  opacity: 0.9;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.step-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.step-description {
  flex: 1;
  color: var(--hn-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-spinner-small {
  width: 14px;
  height: 14px;
  --color: var(--hn-purple-light);
}

.step-status-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.step-status-icon.done {
  color: var(--hn-green);
}

.step-status-icon.error {
  color: #ff5252;
}

.plan-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 14px;
  background: var(--hn-bg-surface);
  border-top: 1px solid var(--hn-border-default);
}

.plan-actions ion-button {
  --border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
}

.plan-executing {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px;
  background: var(--hn-bg-surface);
  border-top: 1px solid var(--hn-border-default);
  color: var(--hn-text-secondary);
  font-size: 0.85rem;
}

.plan-executing ion-spinner {
  width: 18px;
  height: 18px;
  --color: var(--hn-purple);
}

/* Plan steps scrollbar */
.plan-steps::-webkit-scrollbar {
  width: 6px;
}

.plan-steps::-webkit-scrollbar-track {
  background: transparent;
}

.plan-steps::-webkit-scrollbar-thumb {
  background: var(--hn-border-default);
  border-radius: 3px;
}

/* ============================================
   User Message Reference Pills & Cards
   ============================================ */

/* Base styles for user message content with references */
.user-message-content {
  font-size: 0.9rem;
  line-height: 1.5;
  word-break: break-word;
}

.user-message-content .user-text {
  white-space: pre-wrap;
}

/* Reference Pills (base) */
.reference-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 14px;
  font-size: 0.8rem;
  font-weight: 500;
  vertical-align: middle;
  margin: 2px 4px 2px 0;
  transition: all 0.15s ease;
  text-decoration: none;
}

.reference-pill .pill-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.reference-pill .pill-label {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* File Pill Styling */
.file-pill {
  background: rgba(138, 180, 248, 0.2);
  color: #a8c7fa;
  border: 1px solid rgba(138, 180, 248, 0.3);
}

.file-pill:hover {
  background: rgba(138, 180, 248, 0.3);
  border-color: rgba(138, 180, 248, 0.5);
}

/* File type-specific colors */
.file-pill.file-icon-md {
  background: rgba(138, 180, 248, 0.2);
  color: #a8c7fa;
  border-color: rgba(138, 180, 248, 0.3);
}

.file-pill.file-icon-pdf {
  background: rgba(255, 82, 82, 0.15);
  color: #ff8a8a;
  border-color: rgba(255, 82, 82, 0.3);
}

.file-pill.file-icon-docx {
  background: rgba(0, 200, 83, 0.15);
  color: #66d9a0;
  border-color: rgba(0, 200, 83, 0.3);
}

.file-pill.file-icon-txt {
  background: rgba(189, 189, 189, 0.15);
  color: #bdbdbd;
  border-color: rgba(189, 189, 189, 0.3);
}

.file-pill.file-icon-image {
  background: rgba(186, 104, 200, 0.15);
  color: #ce93d8;
  border-color: rgba(186, 104, 200, 0.3);
}

/* Project Pill Styling */
.project-pill {
  background: rgba(0, 200, 83, 0.15);
  color: #66d9a0;
  border: 1px solid rgba(0, 200, 83, 0.25);
}

.project-pill:hover {
  background: rgba(0, 200, 83, 0.25);
  border-color: rgba(0, 200, 83, 0.4);
}

/* Selection Card */
.selection-card {
  display: block;
  margin: 8px 0;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  overflow: hidden;
  max-width: 100%;
}

.selection-card.expanded {
  border-color: rgba(138, 180, 248, 0.3);
}

.selection-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  cursor: pointer;
  transition: background 0.15s ease;
  user-select: none;
}

.selection-header:hover {
  background: rgba(0, 0, 0, 0.35);
}

.selection-header .inline-pill {
  margin: 0;
}

.line-range-badge {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(138, 180, 248, 0.15);
  color: #a8c7fa;
  font-weight: 500;
}

.expand-icon {
  margin-left: auto;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  transition: transform 0.2s ease;
}

.selection-card.expanded .expand-icon {
  transform: rotate(0deg);
}

/* Selection Code Container */
.selection-code-container {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.selection-code {
  margin: 0;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.15);
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
}

.selection-code code {
  background: transparent;
  padding: 0;
  font-size: inherit;
  color: inherit;
}

/* Scrollbar for selection code */
.selection-code::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.selection-code::-webkit-scrollbar-track {
  background: transparent;
}

.selection-code::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.selection-code::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}

/* Syntax highlighting overrides for selection cards */
.selection-code .hljs {
  background: transparent;
  padding: 0;
}

.selection-code .hljs-keyword,
.selection-code .hljs-selector-tag,
.selection-code .hljs-title,
.selection-code .hljs-section,
.selection-code .hljs-doctag,
.selection-code .hljs-name,
.selection-code .hljs-strong {
  color: #c792ea;
}

.selection-code .hljs-string,
.selection-code .hljs-attr {
  color: #c3e88d;
}

.selection-code .hljs-number,
.selection-code .hljs-literal,
.selection-code .hljs-variable,
.selection-code .hljs-template-variable,
.selection-code .hljs-tag .hljs-attr {
  color: #f78c6c;
}

.selection-code .hljs-comment,
.selection-code .hljs-quote {
  color: #676e95;
  font-style: italic;
}

.selection-code .hljs-function .hljs-keyword {
  color: #89ddff;
}

.selection-code .hljs-built_in {
  color: #82aaff;
}
</style>
