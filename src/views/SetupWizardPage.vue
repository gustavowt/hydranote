<template>
  <ion-page class="setup-wizard">
    <div class="wizard-container">
      <!-- Progress Stepper -->
      <div class="stepper">
        <div 
          v-for="(step, index) in steps" 
          :key="step.id"
          class="step-indicator"
          :class="{ 
            active: currentStep === index, 
            completed: currentStep > index 
          }"
        >
          <div class="step-circle">
            <ion-icon v-if="currentStep > index" :icon="checkmarkOutline" />
            <span v-else>{{ index + 1 }}</span>
          </div>
          <span class="step-label">{{ step.title }}</span>
          <div v-if="index < steps.length - 1" class="step-connector" :class="{ completed: currentStep > index }" />
        </div>
      </div>

      <!-- Step Content -->
      <div class="step-content">
        <!-- Step 1: Welcome -->
        <div v-if="currentStep === 0" class="step-panel welcome-step">
          <div class="step-icon-container">
            <img src="/hydranote-logo.png" alt="HydraNote" class="app-logo" />
          </div>
          <h1 class="step-title">Welcome to HydraNote</h1>
          <p class="step-description">
            Your AI-powered document management and note-taking system.
          </p>
          
          <div class="features-grid">
            <div class="feature-card">
              <div class="feature-icon">
                <ion-icon :icon="documentsOutline" />
              </div>
              <h3>Document Indexing</h3>
              <p>Import and index PDFs, DOCX, Markdown files for semantic search.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon">
                <ion-icon :icon="chatbubblesOutline" />
              </div>
              <h3>AI Chat</h3>
              <p>Chat with your documents using advanced AI models.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon">
                <ion-icon :icon="createOutline" />
              </div>
              <h3>Smart Notes</h3>
              <p>Create formatted notes that are automatically organized.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon">
                <ion-icon :icon="syncOutline" />
              </div>
              <h3>File Sync</h3>
              <p>Sync your notes with a local folder on your computer.</p>
            </div>
          </div>
          
          <p class="step-hint">Let's set up a few things to get you started.</p>
        </div>

        <!-- Step 2: Storage -->
        <div v-if="currentStep === 1" class="step-panel storage-step">
          <div class="step-icon-container">
            <ion-icon :icon="folderOpenOutline" class="step-icon" />
          </div>
          <h1 class="step-title">Storage Configuration</h1>
          <p class="step-description">
            HydraNote can sync your projects and notes to a folder on your computer, 
            keeping everything accessible as regular files.
          </p>

          <!-- Browser Support Warning -->
          <div v-if="!isFileSystemSupported" class="info-banner warning">
            <ion-icon :icon="alertCircleOutline" />
            <div>
              <strong>Limited Browser Support</strong>
              <p>File System sync is not available in this browser. Use Chrome, Edge, or Opera for full sync capabilities.</p>
            </div>
          </div>

          <div v-else class="config-section">
            <div class="toggle-option">
              <div class="toggle-info">
                <label>Enable File System Sync</label>
                <span class="toggle-hint">Mirror projects and notes to a local folder</span>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="fsSettings.enabled" @change="handleFsToggle" />
                <span class="slider"></span>
              </label>
            </div>

            <div v-if="fsSettings.enabled" class="directory-config">
              <label>Select Sync Directory</label>
              <div class="directory-picker">
                <div class="directory-display" :class="{ connected: fsSettings.rootPath }">
                  <ion-icon :icon="fsSettings.rootPath ? folderOpenOutline : folderOutline" />
                  <span v-if="fsSettings.rootPath">{{ fsSettings.rootPath }}</span>
                  <span v-else class="placeholder">No directory selected</span>
                </div>
                <button class="btn btn-secondary" @click="handleSelectDirectory" :disabled="selectingDirectory">
                  <ion-spinner v-if="selectingDirectory" name="crescent" />
                  <ion-icon v-else :icon="folderOutline" />
                  <span>{{ fsSettings.rootPath ? 'Change' : 'Select' }}</span>
                </button>
              </div>

              <div class="sub-options" v-if="fsSettings.rootPath">
                <div class="toggle-option small">
                  <div class="toggle-info">
                    <label>Sync on Save</label>
                    <span class="toggle-hint">Auto-sync when you save changes</span>
                  </div>
                  <label class="toggle-switch small">
                    <input type="checkbox" v-model="fsSettings.syncOnSave" />
                    <span class="slider"></span>
                  </label>
                </div>
                <div class="toggle-option small">
                  <div class="toggle-info">
                    <label>Watch for External Changes</label>
                    <span class="toggle-hint">Detect files modified outside HydraNote</span>
                  </div>
                  <label class="toggle-switch small">
                    <input type="checkbox" v-model="fsSettings.watchForChanges" />
                    <span class="slider"></span>
                  </label>
                </div>
              </div>
            </div>

            <div v-if="!fsSettings.enabled" class="info-banner">
              <ion-icon :icon="informationCircleOutline" />
              <p>You can enable file sync later in Settings. Your data is always stored safely in the browser.</p>
            </div>
          </div>
        </div>

        <!-- Step 3: AI Provider -->
        <div v-if="currentStep === 2" class="step-panel provider-step">
          <div class="step-icon-container">
            <ion-icon :icon="sparklesOutline" class="step-icon" />
          </div>
          <h1 class="step-title">AI Provider</h1>
          <p class="step-description">
            Choose your preferred AI provider for chat and document analysis.
          </p>

          <div class="provider-grid">
            <button
              v-for="provider in providerConfigs"
              :key="provider.id"
              class="provider-card"
              :class="{ selected: llmSettings.provider === provider.id }"
              @click="llmSettings.provider = provider.id"
            >
              <div class="provider-icon">
                <component :is="provider.iconComponent" />
              </div>
              <div class="provider-info">
                <h3>{{ provider.name }}</h3>
                <p>{{ provider.description }}</p>
              </div>
              <div class="selected-badge" v-if="llmSettings.provider === provider.id">
                <ion-icon :icon="checkmarkCircle" />
              </div>
            </button>
          </div>

          <!-- OpenAI Config -->
          <div v-if="llmSettings.provider === 'openai'" class="provider-config">
            <div class="field-group">
              <label>API Key</label>
              <div class="input-wrapper">
                <input
                  v-model="llmSettings.openai.apiKey"
                  :type="showApiKey ? 'text' : 'password'"
                  placeholder="sk-..."
                />
                <button class="toggle-visibility" @click="showApiKey = !showApiKey">
                  <ion-icon :icon="showApiKey ? eyeOffOutline : eyeOutline" />
                </button>
              </div>
              <span class="field-hint">
                Get your key at <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com</a>
              </span>
            </div>
            <div class="field-group">
              <label>Model</label>
              <select v-model="llmSettings.openai.model">
                <option value="gpt-4.1">GPT-4.1</option>
                <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                <option value="gpt-4.1-nano">GPT-4.1 Nano</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
              </select>
            </div>
          </div>

          <!-- Anthropic Config -->
          <div v-if="llmSettings.provider === 'anthropic'" class="provider-config">
            <div class="field-group">
              <label>API Key</label>
              <div class="input-wrapper">
                <input
                  v-model="llmSettings.anthropic.apiKey"
                  :type="showApiKey ? 'text' : 'password'"
                  placeholder="sk-ant-..."
                />
                <button class="toggle-visibility" @click="showApiKey = !showApiKey">
                  <ion-icon :icon="showApiKey ? eyeOffOutline : eyeOutline" />
                </button>
              </div>
              <span class="field-hint">
                Get your key at <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>
              </span>
            </div>
            <div class="field-group">
              <label>Model</label>
              <select v-model="llmSettings.anthropic.model">
                <option value="claude-opus-4-5-20251101">Claude Opus 4.5</option>
                <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
              </select>
            </div>
          </div>

          <!-- Google Config -->
          <div v-if="llmSettings.provider === 'google'" class="provider-config">
            <div class="field-group">
              <label>API Key</label>
              <div class="input-wrapper">
                <input
                  v-model="llmSettings.google.apiKey"
                  :type="showApiKey ? 'text' : 'password'"
                  placeholder="AIza..."
                />
                <button class="toggle-visibility" @click="showApiKey = !showApiKey">
                  <ion-icon :icon="showApiKey ? eyeOffOutline : eyeOutline" />
                </button>
              </div>
              <span class="field-hint">
                Get your key at <a href="https://aistudio.google.com/apikey" target="_blank">Google AI Studio</a>
              </span>
            </div>
            <div class="field-group">
              <label>Model</label>
              <select v-model="llmSettings.google.model">
                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
              </select>
            </div>
          </div>

          <!-- Ollama Config -->
          <div v-if="llmSettings.provider === 'ollama'" class="provider-config">
            <div class="field-group">
              <label>Ollama URL</label>
              <input
                v-model="llmSettings.ollama.baseUrl"
                type="text"
                placeholder="http://localhost:11434"
              />
              <span class="field-hint">Local Ollama server address</span>
            </div>
            <div class="field-group">
              <label>Model</label>
              <input
                v-model="llmSettings.ollama.model"
                type="text"
                placeholder="llama3.2"
              />
            </div>
          </div>

          <!-- Test Connection -->
          <div v-if="hasApiKey" class="test-connection-section">
            <button class="btn btn-secondary" @click="handleTestConnection" :disabled="testingConnection">
              <ion-spinner v-if="testingConnection" name="crescent" />
              <ion-icon v-else :icon="flashOutline" />
              <span>Test Connection</span>
            </button>
            
            <div v-if="connectionStatus" :class="['connection-status', connectionStatus.success ? 'success' : 'error']">
              <ion-icon :icon="connectionStatus.success ? checkmarkCircleOutline : closeCircleOutline" />
              <span>{{ connectionStatus.message }}</span>
            </div>
          </div>

          <div v-if="!hasApiKey" class="info-banner warning">
            <ion-icon :icon="alertCircleOutline" />
            <p>You can configure the API key later in Settings. AI features will be disabled until configured.</p>
          </div>

          <!-- Indexer Configuration (collapsible) -->
          <div class="indexer-section">
            <button class="indexer-toggle" @click="showIndexerConfig = !showIndexerConfig">
              <ion-icon :icon="searchOutline" />
              <span>Embedding Provider (for search)</span>
              <ion-icon :icon="showIndexerConfig ? chevronUpOutline : chevronDownOutline" class="chevron" />
            </button>
            
            <div v-if="showIndexerConfig" class="indexer-config">
              <p class="indexer-description">
                Choose a separate provider for document embeddings. By default, we'll use the same provider as your AI chat.
              </p>
              
              <div class="provider-grid small">
                <button
                  v-for="provider in indexerProviders"
                  :key="provider.id"
                  class="provider-card small"
                  :class="{ selected: indexerSettings.provider === provider.id }"
                  @click="indexerSettings.provider = provider.id"
                >
                  <div class="provider-icon">
                    <component :is="provider.iconComponent" />
                  </div>
                  <div class="provider-info">
                    <h3>{{ provider.name }}</h3>
                  </div>
                </button>
              </div>

              <!-- OpenAI Indexer Config -->
              <div v-if="indexerSettings.provider === 'openai'" class="provider-config compact">
                <div class="field-group">
                  <label>API Key</label>
                  <div class="input-wrapper">
                    <input
                      v-model="indexerSettings.openai.apiKey"
                      :type="showIndexerKey ? 'text' : 'password'"
                      placeholder="sk-... (can be same as AI provider)"
                    />
                    <button class="toggle-visibility" @click="showIndexerKey = !showIndexerKey">
                      <ion-icon :icon="showIndexerKey ? eyeOffOutline : eyeOutline" />
                    </button>
                  </div>
                </div>
              </div>

              <!-- Gemini Indexer Config -->
              <div v-if="indexerSettings.provider === 'gemini'" class="provider-config compact">
                <div class="field-group">
                  <label>API Key</label>
                  <div class="input-wrapper">
                    <input
                      v-model="indexerSettings.gemini.apiKey"
                      :type="showIndexerKey ? 'text' : 'password'"
                      placeholder="AIza... (can be same as AI provider)"
                    />
                    <button class="toggle-visibility" @click="showIndexerKey = !showIndexerKey">
                      <ion-icon :icon="showIndexerKey ? eyeOffOutline : eyeOutline" />
                    </button>
                  </div>
                </div>
              </div>

              <!-- Ollama Indexer Config -->
              <div v-if="indexerSettings.provider === 'ollama'" class="provider-config compact">
                <div class="field-group">
                  <label>Ollama URL</label>
                  <input
                    v-model="indexerSettings.ollama.baseUrl"
                    type="text"
                    placeholder="http://localhost:11434"
                  />
                </div>
                <div class="field-group">
                  <label>Embedding Model</label>
                  <input
                    v-model="indexerSettings.ollama.model"
                    type="text"
                    placeholder="nomic-embed-text"
                  />
                  <span class="field-hint">Suggested: nomic-embed-text, mxbai-embed-large</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 4: AI Instructions -->
        <div v-if="currentStep === 3" class="step-panel instructions-step">
          <div class="step-icon-container">
            <ion-icon :icon="settingsOutline" class="step-icon" />
          </div>
          <h1 class="step-title">AI Instructions</h1>
          <p class="step-description">
            Customize how the AI formats and organizes your notes.
          </p>

          <div class="config-section">
            <div class="field-group">
              <label>Format Instructions</label>
              <textarea
                v-model="llmSettings.noteSettings.formatInstructions"
                placeholder="e.g., 'Always use bullet points', 'Include a summary at the top', 'Write in Portuguese'"
                rows="4"
              ></textarea>
              <span class="field-hint">
                These instructions guide how the AI formats your notes.
              </span>
            </div>

            <div class="field-group">
              <label>Default Notes Directory</label>
              <input
                v-model="llmSettings.noteSettings.defaultDirectory"
                type="text"
                placeholder="notes"
              />
              <span class="field-hint">
                New notes will be saved in this folder by default.
              </span>
            </div>

            <div class="toggle-option">
              <div class="toggle-info">
                <label>Auto-generate Note Titles</label>
                <span class="toggle-hint">Use AI to create descriptive titles from content</span>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="llmSettings.noteSettings.autoGenerateTitle" />
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <div class="completion-message">
            <ion-icon :icon="checkmarkCircleOutline" />
            <div>
              <h3>You're all set!</h3>
              <p>You can always change these settings later from the Settings page.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Navigation -->
      <div class="wizard-navigation">
        <button 
          class="btn btn-secondary" 
          @click="previousStep" 
          :disabled="currentStep === 0"
        >
          <ion-icon :icon="arrowBackOutline" />
          <span>Previous</span>
        </button>

        <div class="step-dots">
          <span 
            v-for="(_, index) in steps" 
            :key="index"
            class="dot"
            :class="{ active: currentStep === index, completed: currentStep > index }"
          />
        </div>

        <button 
          v-if="currentStep < steps.length - 1"
          class="btn btn-primary" 
          @click="nextStep"
        >
          <span>Next</span>
          <ion-icon :icon="arrowForwardOutline" />
        </button>
        <button 
          v-else
          class="btn btn-primary finish" 
          @click="finishWizard"
        >
          <span>Get Started</span>
          <ion-icon :icon="rocketOutline" />
        </button>
      </div>
    </div>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonIcon, IonSpinner, toastController } from '@ionic/vue';
import {
  checkmarkOutline,
  checkmarkCircle,
  checkmarkCircleOutline,
  closeCircleOutline,
  documentsOutline,
  chatbubblesOutline,
  createOutline,
  syncOutline,
  folderOutline,
  folderOpenOutline,
  alertCircleOutline,
  informationCircleOutline,
  sparklesOutline,
  eyeOutline,
  eyeOffOutline,
  settingsOutline,
  arrowBackOutline,
  arrowForwardOutline,
  rocketOutline,
  flashOutline,
  searchOutline,
  chevronDownOutline,
  chevronUpOutline,
} from 'ionicons/icons';
import type { LLMSettings, LLMProvider, FileSystemSettings, IndexerSettings, EmbeddingProvider } from '@/types';
import { DEFAULT_LLM_SETTINGS, DEFAULT_FILESYSTEM_SETTINGS, DEFAULT_INDEXER_SETTINGS } from '@/types';
import { OpenAiIcon, ClaudeIcon, GeminiIcon, OllamaIcon } from '@/icons';
import {
  loadSettings,
  saveSettings,
  testConnection,
  loadFileSystemSettings,
  saveFileSystemSettings,
  isFileSystemAccessSupported,
  selectRootDirectory,
  markWizardCompleted,
  loadIndexerSettings,
  saveIndexerSettings,
} from '@/services';

const router = useRouter();

// Wizard steps definition
const steps = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'storage', title: 'Storage' },
  { id: 'provider', title: 'AI Provider' },
  { id: 'instructions', title: 'Instructions' },
];

const currentStep = ref(0);

// Settings state
const llmSettings = ref<LLMSettings>({ ...DEFAULT_LLM_SETTINGS });
const fsSettings = ref<FileSystemSettings>({ ...DEFAULT_FILESYSTEM_SETTINGS });
const indexerSettings = ref<IndexerSettings>({ ...DEFAULT_INDEXER_SETTINGS });
const isFileSystemSupported = ref(false);
const selectingDirectory = ref(false);
const showApiKey = ref(false);
const showIndexerConfig = ref(false);
const showIndexerKey = ref(false);

// Test connection state
const testingConnection = ref(false);
const connectionStatus = ref<{ success: boolean; message: string } | null>(null);

// Provider configurations
const providerConfigs: { id: LLMProvider; name: string; description: string; iconComponent: typeof OpenAiIcon }[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4.1, GPT-4o series',
    iconComponent: OpenAiIcon,
  },
  {
    id: 'anthropic',
    name: 'Claude',
    description: 'Claude 4 Opus, Sonnet',
    iconComponent: ClaudeIcon,
  },
  {
    id: 'google',
    name: 'Gemini',
    description: 'Gemini 2.5 Pro, Flash',
    iconComponent: GeminiIcon,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local LLMs: Llama, Mistral',
    iconComponent: OllamaIcon,
  },
];

// Indexer (embedding) provider configurations
const indexerProviders: { id: EmbeddingProvider; name: string; iconComponent: typeof OpenAiIcon }[] = [
  { id: 'openai', name: 'OpenAI', iconComponent: OpenAiIcon },
  { id: 'gemini', name: 'Gemini', iconComponent: GeminiIcon },
  { id: 'ollama', name: 'Ollama', iconComponent: OllamaIcon },
];

// Computed
const hasApiKey = computed(() => {
  const provider = llmSettings.value.provider;
  if (provider === 'openai') return !!llmSettings.value.openai.apiKey;
  if (provider === 'anthropic') return !!llmSettings.value.anthropic.apiKey;
  if (provider === 'google') return !!llmSettings.value.google.apiKey;
  if (provider === 'ollama') return !!llmSettings.value.ollama.baseUrl;
  return false;
});

// Lifecycle
onMounted(() => {
  llmSettings.value = loadSettings();
  fsSettings.value = loadFileSystemSettings();
  indexerSettings.value = loadIndexerSettings();
  isFileSystemSupported.value = isFileSystemAccessSupported();
});

// Navigation
function nextStep() {
  if (currentStep.value < steps.length - 1) {
    saveCurrentStepSettings();
    currentStep.value++;
  }
}

function previousStep() {
  if (currentStep.value > 0) {
    saveCurrentStepSettings();
    currentStep.value--;
  }
}

function saveCurrentStepSettings() {
  // Save settings after each step
  if (currentStep.value === 1) {
    saveFileSystemSettings(fsSettings.value);
  } else if (currentStep.value >= 2) {
    saveSettings(llmSettings.value);
    saveIndexerSettings(indexerSettings.value);
  }
}

async function finishWizard() {
  // Save all settings
  saveFileSystemSettings(fsSettings.value);
  saveSettings(llmSettings.value);
  saveIndexerSettings(indexerSettings.value);
  
  // Mark wizard as completed
  markWizardCompleted();
  
  const toast = await toastController.create({
    message: 'Setup complete! Welcome to HydraNote.',
    duration: 2000,
    color: 'success',
    position: 'top',
  });
  await toast.present();
  
  // Navigate to workspace
  router.replace('/workspace');
}

// AI Provider handlers
async function handleTestConnection() {
  testingConnection.value = true;
  connectionStatus.value = null;
  
  // Save settings first so test uses current values
  saveSettings(llmSettings.value);
  
  try {
    const result = await testConnection();
    connectionStatus.value = result;
  } catch (error) {
    connectionStatus.value = {
      success: false,
      message: error instanceof Error ? error.message : 'Connection failed',
    };
  } finally {
    testingConnection.value = false;
  }
}

// Storage handlers
async function handleFsToggle() {
  if (fsSettings.value.enabled && !fsSettings.value.rootPath) {
    await handleSelectDirectory();
    if (!fsSettings.value.rootPath) {
      fsSettings.value.enabled = false;
    }
  }
}

async function handleSelectDirectory() {
  selectingDirectory.value = true;
  
  try {
    const result = await selectRootDirectory();
    
    if (result.success) {
      fsSettings.value.rootPath = result.path;
      fsSettings.value.enabled = true;
      
      const toast = await toastController.create({
        message: `Connected to: ${result.path}`,
        duration: 2000,
        color: 'success',
        position: 'top',
      });
      await toast.present();
    }
  } catch (error) {
    const toast = await toastController.create({
      message: error instanceof Error ? error.message : 'Failed to select directory',
      duration: 3000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  } finally {
    selectingDirectory.value = false;
  }
}
</script>

<style scoped>
.setup-wizard {
  --background: var(--hn-bg-deepest);
}

.wizard-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 900px;
  margin: 0 auto;
  padding: 40px 24px;
  overflow: hidden;
}

/* Stepper */
.stepper {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  margin-bottom: 32px;
  padding: 0 20px;
  flex-shrink: 0;
}

.step-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  flex: 1;
  max-width: 160px;
}

.step-circle {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--hn-bg-surface);
  border: 2px solid var(--hn-border-default);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  font-weight: 600;
  color: var(--hn-text-muted);
  transition: all 0.3s ease;
  z-index: 1;
}

.step-indicator.active .step-circle {
  border-color: var(--hn-purple);
  background: var(--hn-purple-muted);
  color: var(--hn-purple-light);
}

.step-indicator.completed .step-circle {
  border-color: var(--hn-green);
  background: var(--hn-green);
  color: #fff;
}

.step-label {
  margin-top: 10px;
  font-size: 0.85rem;
  color: var(--hn-text-muted);
  text-align: center;
  transition: color 0.3s ease;
}

.step-indicator.active .step-label {
  color: var(--hn-text-primary);
  font-weight: 500;
}

.step-indicator.completed .step-label {
  color: var(--hn-green-light);
}

.step-connector {
  position: absolute;
  top: 22px;
  left: calc(50% + 28px);
  width: calc(100% - 56px);
  height: 2px;
  background: var(--hn-border-default);
  transition: background 0.3s ease;
}

.step-connector.completed {
  background: var(--hn-green);
}

/* Step Content */
.step-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0; /* Important for flex children to allow scrolling */
  padding-bottom: 16px;
}

.step-panel {
  animation: fadeSlideIn 0.3s ease;
  flex-shrink: 0;
}

@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.step-icon-container {
  display: flex;
  justify-content: center;
  margin-bottom: 24px;
}

.step-icon {
  font-size: 64px;
  color: var(--hn-purple);
}

.app-logo {
  width: 100px;
  height: 100px;
  object-fit: contain;
}

.step-title {
  font-size: 2rem;
  font-weight: 700;
  color: var(--hn-text-primary);
  text-align: center;
  margin: 0 0 12px 0;
}

.step-description {
  font-size: 1.1rem;
  color: var(--hn-text-secondary);
  text-align: center;
  margin: 0 auto 32px auto;
  max-width: 600px;
  line-height: 1.6;
}

.step-hint {
  font-size: 0.95rem;
  color: var(--hn-text-muted);
  text-align: center;
  margin-top: 32px;
}

/* Features Grid (Welcome) */
.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin: 24px 0;
}

.feature-card {
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  transition: all 0.2s ease;
}

.feature-card:hover {
  border-color: var(--hn-purple);
  transform: translateY(-2px);
}

.feature-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  background: var(--hn-purple-muted);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.feature-icon ion-icon {
  font-size: 24px;
  color: var(--hn-purple);
}

.feature-card h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--hn-text-primary);
  margin: 0 0 8px 0;
}

.feature-card p {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
  margin: 0;
  line-height: 1.5;
}

/* Config Sections */
.config-section {
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
}

/* Toggle Options */
.toggle-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--hn-bg-deep);
  border-radius: 8px;
  margin-bottom: 16px;
}

.toggle-option.small {
  padding: 12px;
  margin-bottom: 12px;
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toggle-info label {
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--hn-text-primary);
}

.toggle-hint {
  font-size: 0.8rem;
  color: var(--hn-text-secondary);
}

/* Toggle Switch */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 52px;
  height: 28px;
  flex-shrink: 0;
}

.toggle-switch.small {
  width: 44px;
  height: 24px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-switch .slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: var(--hn-border-strong);
  transition: 0.3s;
  border-radius: 28px;
}

.toggle-switch .slider:before {
  position: absolute;
  content: "";
  height: 22px;
  width: 22px;
  left: 3px;
  bottom: 3px;
  background-color: var(--hn-text-secondary);
  transition: 0.3s;
  border-radius: 50%;
}

.toggle-switch.small .slider:before {
  height: 18px;
  width: 18px;
}

.toggle-switch input:checked + .slider {
  background-color: var(--hn-purple);
}

.toggle-switch input:checked + .slider:before {
  background-color: #fff;
  transform: translateX(24px);
}

.toggle-switch.small input:checked + .slider:before {
  transform: translateX(20px);
}

/* Directory Picker */
.directory-config {
  margin-top: 16px;
}

.directory-config > label {
  display: block;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--hn-text-primary);
  margin-bottom: 8px;
}

.directory-picker {
  display: flex;
  gap: 12px;
  align-items: stretch;
}

.directory-display {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  color: var(--hn-text-secondary);
  font-size: 0.95rem;
}

.directory-display.connected {
  border-color: var(--hn-green-light);
  background: var(--hn-green-muted);
  color: var(--hn-green-light);
}

.directory-display .placeholder {
  color: var(--hn-text-muted);
  font-style: italic;
}

.sub-options {
  margin-top: 16px;
  padding-left: 12px;
  border-left: 2px solid var(--hn-border-default);
}

/* Provider Grid */
.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.provider-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 16px;
  background: var(--hn-bg-surface);
  border: 2px solid var(--hn-border-default);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  text-align: center;
}

.provider-card:hover {
  border-color: var(--hn-border-strong);
  background: var(--hn-bg-elevated);
}

.provider-card.selected {
  border-color: var(--hn-purple);
  background: var(--hn-purple-muted);
}

.provider-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--hn-bg-elevated);
  border-radius: 10px;
}

.provider-card.selected .provider-icon {
  background: var(--hn-purple);
  color: #fff;
}

.provider-icon :deep(svg) {
  width: 28px;
  height: 28px;
}

.provider-info h3 {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--hn-text-primary);
  margin: 0;
}

.provider-info p {
  font-size: 0.8rem;
  color: var(--hn-text-secondary);
  margin: 4px 0 0 0;
}

.selected-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  color: var(--hn-purple);
}

.selected-badge ion-icon {
  font-size: 1.3rem;
}

/* Provider Config */
.provider-config {
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
}

/* Field Groups */
.field-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.field-group:last-child {
  margin-bottom: 0;
}

.field-group label {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--hn-text-primary);
}

.field-group input,
.field-group select,
.field-group textarea {
  padding: 12px 16px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  color: var(--hn-text-primary);
  font-size: 0.95rem;
  transition: border-color 0.2s ease;
}

.field-group input:focus,
.field-group select:focus,
.field-group textarea:focus {
  outline: none;
  border-color: var(--hn-purple);
}

.field-group input::placeholder,
.field-group textarea::placeholder {
  color: var(--hn-text-muted);
}

.field-group select {
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239aa5b5' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 16px center;
  padding-right: 40px;
}

.field-group textarea {
  resize: vertical;
  min-height: 100px;
  font-family: inherit;
}

.field-hint {
  font-size: 0.8rem;
  color: var(--hn-text-secondary);
}

.field-hint a {
  color: var(--hn-purple);
  text-decoration: none;
}

.field-hint a:hover {
  text-decoration: underline;
}

/* Input with toggle visibility */
.input-wrapper {
  position: relative;
  display: flex;
}

.input-wrapper input {
  flex: 1;
  padding-right: 48px;
}

.toggle-visibility {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--hn-text-muted);
  cursor: pointer;
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toggle-visibility:hover {
  color: var(--hn-text-primary);
}

/* Test Connection Section */
.test-connection-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-radius: 10px;
  font-size: 0.9rem;
}

.connection-status.success {
  background: var(--hn-green-muted);
  color: var(--hn-green-light);
  border: 1px solid rgba(63, 185, 80, 0.3);
}

.connection-status.error {
  background: var(--hn-danger-muted);
  color: var(--hn-danger);
  border: 1px solid rgba(248, 81, 73, 0.3);
}

.connection-status ion-icon {
  font-size: 1.3rem;
  flex-shrink: 0;
}

/* Info Banners */
.info-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  background: var(--hn-info-muted);
  border: 1px solid rgba(88, 166, 255, 0.3);
  border-radius: 10px;
  color: var(--hn-info);
  font-size: 0.9rem;
}

.info-banner.warning {
  background: var(--hn-warning-muted);
  border-color: rgba(210, 153, 34, 0.3);
  color: var(--hn-warning);
}

.info-banner ion-icon {
  font-size: 1.3rem;
  flex-shrink: 0;
  margin-top: 2px;
}

.info-banner p {
  margin: 0;
  line-height: 1.5;
}

.info-banner div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-banner strong {
  font-weight: 600;
}

/* Completion Message */
.completion-message {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--hn-green-muted);
  border: 1px solid rgba(63, 185, 80, 0.3);
  border-radius: 12px;
  margin-top: 24px;
}

.completion-message ion-icon {
  font-size: 2.5rem;
  color: var(--hn-green);
  flex-shrink: 0;
}

.completion-message h3 {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--hn-green-light);
  margin: 0 0 4px 0;
}

.completion-message p {
  font-size: 0.9rem;
  color: var(--hn-text-secondary);
  margin: 0;
}

/* Navigation */
.wizard-navigation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 24px;
  margin-top: auto;
  border-top: 1px solid var(--hn-border-default);
  flex-shrink: 0;
  background: var(--hn-bg-deepest);
}

.step-dots {
  display: flex;
  gap: 8px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--hn-border-strong);
  transition: all 0.3s ease;
}

.dot.active {
  background: var(--hn-purple);
  transform: scale(1.25);
}

.dot.completed {
  background: var(--hn-green);
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 24px;
  border: none;
  border-radius: 10px;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn ion-icon {
  font-size: 1.2rem;
}

.btn ion-spinner {
  width: 20px;
  height: 20px;
}

.btn-primary {
  background: linear-gradient(135deg, var(--hn-purple), var(--hn-purple-light));
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.btn-primary.finish {
  background: linear-gradient(135deg, var(--hn-green), var(--hn-green-light));
}

.btn-secondary {
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  color: var(--hn-text-primary);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--hn-bg-elevated);
  border-color: var(--hn-border-strong);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

/* Indexer Section */
.indexer-section {
  margin-top: 24px;
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  border-radius: 12px;
  overflow: hidden;
}

.indexer-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: transparent;
  border: none;
  color: var(--hn-text-primary);
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease;
}

.indexer-toggle:hover {
  background: var(--hn-bg-hover);
}

.indexer-toggle ion-icon {
  font-size: 1.2rem;
  color: var(--hn-purple);
}

.indexer-toggle .chevron {
  margin-left: auto;
  color: var(--hn-text-muted);
}

.indexer-config {
  padding: 0 20px 20px 20px;
  animation: fadeSlideIn 0.2s ease;
}

.indexer-description {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
  margin: 0 0 16px 0;
  line-height: 1.5;
}

.provider-grid.small {
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.provider-card.small {
  padding: 14px 10px;
  gap: 8px;
}

.provider-card.small .provider-icon {
  width: 36px;
  height: 36px;
}

.provider-card.small .provider-icon :deep(svg) {
  width: 20px;
  height: 20px;
}

.provider-card.small .provider-info h3 {
  font-size: 0.9rem;
}

.provider-card.small .provider-info p {
  display: none;
}

.provider-config.compact {
  padding: 16px;
  margin-bottom: 0;
}

.provider-config.compact .field-group {
  margin-bottom: 12px;
}

.provider-config.compact .field-group:last-child {
  margin-bottom: 0;
}

/* Responsive */
@media (max-width: 640px) {
  .wizard-container {
    padding: 24px 16px;
    height: 100vh;
  }

  .stepper {
    flex-wrap: wrap;
    gap: 8px;
  }

  .step-connector {
    display: none;
  }

  .step-label {
    display: none;
  }

  .step-title {
    font-size: 1.5rem;
  }

  .step-description {
    font-size: 1rem;
  }

  .features-grid {
    grid-template-columns: 1fr;
  }

  .provider-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .wizard-navigation {
    flex-wrap: wrap;
    gap: 16px;
  }

  .step-dots {
    order: 3;
    width: 100%;
    justify-content: center;
  }

  .btn {
    flex: 1;
  }
}
</style>

