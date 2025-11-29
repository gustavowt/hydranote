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
          <ion-icon :icon="chatbubblesOutline" class="welcome-icon" />
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
            <div class="message-content">{{ message.content }}</div>
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

    <!-- Chat Input -->
    <ion-footer class="chat-footer">
      <ion-toolbar>
        <div class="input-container">
          <ion-textarea
            v-model="inputMessage"
            :rows="1"
            :auto-grow="true"
            placeholder="Ask about your documents..."
            :disabled="isTyping"
            @keydown.enter.exact.prevent="sendMessage()"
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
          <ion-item v-for="file in files" :key="file.id">
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
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
  chatbubblesOutline,
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
} from 'ionicons/icons';
import type { Project, ProjectFile, ChatMessage } from '@/types';
import type { ExecutionStep } from '@/services';
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

    // Add assistant response
    const assistantMessage = addMessage(
      sessionId.value,
      'assistant',
      result.response
    );
    messages.value = [...messages.value, assistantMessage];
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
</script>

<style scoped>
.chat-content {
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
  color: #8b8b9e;
}

.welcome-icon {
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.6;
  color: #6366f1;
}

.welcome-message h2 {
  margin: 0 0 8px;
  font-size: 1.5rem;
  color: #e2e2e8;
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
  --background: #2d2d44;
  --color: #c4c4d4;
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
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #ffffff;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-bubble {
  background: #2d2d44;
  color: #e2e2e8;
  border-bottom-left-radius: 4px;
}

.message-content {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  font-size: 0.95rem;
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
  color: #8b8b9e;
  margin-right: 4px;
}

.context-sources ion-chip {
  --background: #3d3d5c;
  --color: #a5a5c0;
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
  color: #6b6b80;
}

.typing {
  display: flex;
  gap: 5px;
  padding: 16px 20px;
}

.typing .dot {
  width: 8px;
  height: 8px;
  background: #6366f1;
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
  background: #16162a;
  border-top: 1px solid #2d2d44;
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
  --background: #2d2d44;
  --color: #e2e2e8;
  --placeholder-color: #6b6b80;
  --padding-start: 16px;
  --padding-end: 16px;
  --padding-top: 12px;
  --padding-bottom: 12px;
  border-radius: 24px;
  max-height: 120px;
  border: 1px solid #3d3d5c;
}

.input-container ion-button {
  --padding-start: 12px;
  --padding-end: 12px;
  --color: #6366f1;
  margin-bottom: 4px;
}

.empty-files {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  color: #8b8b9e;
}

.empty-files ion-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
  color: #6366f1;
}

.upload-progress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  color: #8b8b9e;
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
  color: #a5a5c0;
}

.step.running {
  color: #6366f1;
}

.step.completed {
  color: #22c55e;
}

.step.error {
  color: #ef4444;
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
  --color: #6366f1;
}

.step-icon ion-icon {
  font-size: 16px;
}

.step-label {
  font-weight: 500;
}

.step-detail {
  color: #6b6b80;
  font-size: 0.8rem;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

