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

          <StorageSettings
            v-model="fsSettings"
            :is-file-system-supported="isFileSystemSupported"
            :selecting-directory="selectingDirectory"
            compact
            @select-directory="handleSelectDirectory"
          />
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

          <AIProviderSelector
            v-model="llmSettings"
            :testing-connection="testingConnection"
            :connection-status="connectionStatus"
            :local-models-available="localModelsAvailable"
            :installed-models="installedModels"
            compact
            @test-connection="handleTestConnection"
            @select-local-model="handleSelectLocalModel"
          />

          <!-- Indexer Configuration (collapsible) -->
          <IndexerProviderSelector
            v-model="indexerSettings"
            compact
            collapsible
            :llm-api-keys="{ openai: llmSettings.openai.apiKey, gemini: llmSettings.google.apiKey }"
          />
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
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonIcon, toastController } from '@ionic/vue';
import {
  checkmarkOutline,
  checkmarkCircleOutline,
  documentsOutline,
  chatbubblesOutline,
  createOutline,
  syncOutline,
  folderOpenOutline,
  sparklesOutline,
  settingsOutline,
  arrowBackOutline,
  arrowForwardOutline,
  rocketOutline,
} from 'ionicons/icons';
import type { LLMSettings, FileSystemSettings, IndexerSettings, LocalModel } from '@/types';
import { DEFAULT_LLM_SETTINGS, DEFAULT_FILESYSTEM_SETTINGS, DEFAULT_INDEXER_SETTINGS } from '@/types';
import { AIProviderSelector, IndexerProviderSelector, StorageSettings } from '@/components/settings';
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
  // Local models
  isLocalModelsAvailable,
  getInstalledModels,
  loadModel,
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

// Test connection state
const testingConnection = ref(false);
const connectionStatus = ref<{ success: boolean; message: string } | null>(null);

// Local models state
const localModelsAvailable = ref(false);
const installedModels = ref<LocalModel[]>([]);

// Lifecycle
onMounted(async () => {
  llmSettings.value = loadSettings();
  fsSettings.value = loadFileSystemSettings();
  indexerSettings.value = loadIndexerSettings();
  isFileSystemSupported.value = isFileSystemAccessSupported();

  // Load local models if available
  localModelsAvailable.value = isLocalModelsAvailable();
  if (localModelsAvailable.value) {
    try {
      installedModels.value = await getInstalledModels();
    } catch (error) {
      console.error('Failed to load installed models:', error);
    }
  }
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

async function handleSelectLocalModel(model: LocalModel) {
  // Load the model when selected
  try {
    await loadModel(model.id, {
      gpuLayers: llmSettings.value.huggingfaceLocal?.gpuLayers || -1,
      contextLength: llmSettings.value.huggingfaceLocal?.contextLength || 4096,
    });
    
    const toast = await toastController.create({
      message: `Model "${model.name}" loaded successfully`,
      duration: 2000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
  } catch (error) {
    const toast = await toastController.create({
      message: error instanceof Error ? error.message : 'Failed to load model',
      duration: 3000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}

// Storage handlers
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
  min-height: 0;
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
.field-group textarea:focus {
  outline: none;
  border-color: var(--hn-purple);
}

.field-group input::placeholder,
.field-group textarea::placeholder {
  color: var(--hn-text-muted);
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

/* Toggle Options */
.toggle-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--hn-bg-deep);
  border-radius: 8px;
  margin-top: 16px;
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

.toggle-switch input:checked + .slider {
  background-color: var(--hn-purple);
}

.toggle-switch input:checked + .slider:before {
  background-color: #fff;
  transform: translateX(24px);
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
