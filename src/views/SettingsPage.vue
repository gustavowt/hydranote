<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home" />
        </ion-buttons>
        <ion-title>Settings</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <!-- Mobile Tabs -->
      <div class="mobile-tabs">
        <ion-segment v-model="activeSection" mode="ios">
          <ion-segment-button value="providers">
            <ion-icon :icon="cloudOutline" />
            <ion-label>AI Providers</ion-label>
          </ion-segment-button>
          <ion-segment-button value="instructions">
            <ion-icon :icon="documentTextOutline" />
            <ion-label>AI Instructions</ion-label>
          </ion-segment-button>
        </ion-segment>
      </div>

      <div class="settings-layout">
        <!-- Desktop Sidebar -->
        <aside class="settings-sidebar">
          <nav class="sidebar-nav">
            <button 
              class="nav-item" 
              :class="{ active: activeSection === 'providers' }"
              @click="activeSection = 'providers'"
            >
              <ion-icon :icon="cloudOutline" />
              <span>AI Providers</span>
            </button>
            <button 
              class="nav-item" 
              :class="{ active: activeSection === 'instructions' }"
              @click="activeSection = 'instructions'"
            >
              <ion-icon :icon="documentTextOutline" />
              <span>AI Instructions</span>
            </button>
          </nav>
        </aside>

        <!-- Content Area -->
        <main class="settings-content">
          <!-- AI Providers Section -->
          <section v-if="activeSection === 'providers'" class="content-section">
            <h2 class="section-title">AI Providers</h2>
            <p class="section-description">Choose your preferred AI provider and configure its settings.</p>

            <!-- Provider Cards -->
            <div class="provider-cards">
              <button
                v-for="provider in providerConfigs"
                :key="provider.id"
                class="provider-card"
                :class="{ selected: settings.provider === provider.id }"
                @click="settings.provider = provider.id"
              >
                <div class="provider-icon" v-html="provider.icon"></div>
                <div class="provider-info">
                  <h3>{{ provider.name }}</h3>
                  <p>{{ provider.description }}</p>
                </div>
                <div class="selected-indicator" v-if="settings.provider === provider.id">
                  <ion-icon :icon="checkmarkCircle" />
                </div>
              </button>
            </div>

            <!-- OpenAI Configuration -->
            <div v-if="settings.provider === 'openai'" class="config-panel">
              <h3 class="config-title">OpenAI Configuration</h3>
              <div class="config-fields">
                <div class="field-group">
                  <label>API Key</label>
                  <div class="input-wrapper">
                    <input
                      v-model="settings.openai.apiKey"
                      :type="showApiKey ? 'text' : 'password'"
                      placeholder="sk-..."
                    />
                    <button class="toggle-visibility" @click="showApiKey = !showApiKey">
                      <ion-icon :icon="showApiKey ? eyeOffOutline : eyeOutline" />
                    </button>
                  </div>
                  <span class="field-hint">
                    Create an API key at 
                    <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">
                      platform.openai.com/api-keys
                    </a>
                  </span>
                </div>

                <div class="field-group">
                  <label>Model</label>
                  <select v-model="settings.openai.model">
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="gpt-4-turbo">GPT-4 Turbo</option>
                    <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                  </select>
                </div>

                <div class="field-group">
                  <label>Custom Base URL <span class="optional">(Optional)</span></label>
                  <input
                    v-model="settings.openai.baseUrl"
                    type="text"
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
              </div>
            </div>

            <!-- Ollama Configuration -->
            <div v-if="settings.provider === 'ollama'" class="config-panel">
              <h3 class="config-title">Ollama Configuration</h3>
              <div class="config-fields">
                <div class="field-group">
                  <label>Ollama URL</label>
                  <input
                    v-model="settings.ollama.baseUrl"
                    type="text"
                    placeholder="http://localhost:11434"
                  />
                </div>

                <div class="field-group">
                  <label>Model</label>
                  <div class="model-input-row">
                    <input
                      v-model="settings.ollama.model"
                      type="text"
                      placeholder="llama3.2"
                    />
                    <button 
                      class="fetch-models-btn" 
                      @click="fetchOllamaModels" 
                      :disabled="loadingModels"
                    >
                      <ion-spinner v-if="loadingModels" name="crescent" />
                      <span v-else>Fetch Models</span>
                    </button>
                  </div>
                </div>

                <!-- Available Models -->
                <div v-if="ollamaModels.length > 0" class="field-group">
                  <label>Available Models</label>
                  <div class="models-list">
                    <button 
                      v-for="model in ollamaModels" 
                      :key="model"
                      class="model-item"
                      :class="{ selected: settings.ollama.model === model }"
                      @click="selectOllamaModel(model)"
                    >
                      <ion-icon :icon="cubeOutline" />
                      <span>{{ model }}</span>
                      <ion-icon 
                        v-if="settings.ollama.model === model" 
                        :icon="checkmarkOutline" 
                        class="check-icon"
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Connection Status -->
            <div v-if="connectionStatus" :class="['connection-status', connectionStatus.success ? 'success' : 'error']">
              <ion-icon :icon="connectionStatus.success ? checkmarkCircleOutline : closeCircleOutline" />
              <span>{{ connectionStatus.message }}</span>
            </div>

            <!-- Action Buttons -->
            <div class="action-buttons">
              <button class="btn btn-secondary" @click="handleTestConnection" :disabled="testing">
                <ion-spinner v-if="testing" name="crescent" />
                <ion-icon v-else :icon="flashOutline" />
                <span>Test Connection</span>
              </button>
              <button class="btn btn-primary" @click="handleSave">
                <ion-icon :icon="saveOutline" />
                <span>Save Settings</span>
              </button>
            </div>
          </section>

          <!-- AI Instructions Section -->
          <section v-if="activeSection === 'instructions'" class="content-section">
            <h2 class="section-title">AI Instructions</h2>
            <p class="section-description">Customize how the AI formats and organizes your notes.</p>

            <div class="config-panel">
              <div class="config-fields">
                <div class="field-group">
                  <label>Format Instructions</label>
                  <textarea
                    v-model="settings.noteSettings.formatInstructions"
                    placeholder="Custom instructions for note formatting (e.g., 'Always use bullet points', 'Include a summary section')"
                    rows="4"
                  ></textarea>
                  <span class="field-hint">
                    These instructions will be used when the AI formats your notes.
                  </span>
                </div>

                <div class="field-group">
                  <label>Default Notes Directory</label>
                  <input
                    v-model="settings.noteSettings.defaultDirectory"
                    type="text"
                    placeholder="notes"
                  />
                  <span class="field-hint">
                    The default folder where new notes will be saved.
                  </span>
                </div>

                <div class="field-group toggle-field">
                  <div class="toggle-info">
                    <label>Auto-generate Note Titles</label>
                    <span class="toggle-description">Use AI to generate titles from note content</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="settings.noteSettings.autoGenerateTitle" />
                    <span class="slider"></span>
                  </label>
                </div>
              </div>
            </div>

            <!-- Action Buttons -->
            <div class="action-buttons">
              <button class="btn btn-primary" @click="handleSave">
                <ion-icon :icon="saveOutline" />
                <span>Save Settings</span>
              </button>
            </div>
          </section>
        </main>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonIcon,
  IonSpinner,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  toastController,
} from '@ionic/vue';
import {
  flashOutline,
  saveOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  cubeOutline,
  checkmarkOutline,
  checkmarkCircle,
  cloudOutline,
  documentTextOutline,
  eyeOutline,
  eyeOffOutline,
} from 'ionicons/icons';
import type { LLMSettings, LLMProvider } from '@/types';
import { DEFAULT_LLM_SETTINGS } from '@/types';
import { loadSettings, saveSettings, testConnection, getOllamaModels } from '@/services';

// Provider configurations for modularity
const providerConfigs: { id: LLMProvider; name: string; description: string; icon: string }[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4o-mini, GPT-3.5',
    icon: `<svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.0993 3.8558L12.6 8.3829l2.02-1.1638a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>
    </svg>`,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local LLMs: Llama, Mistral, etc.',
    icon: `<svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" opacity="0"/>
      <ellipse cx="12" cy="10" rx="6" ry="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <circle cx="9.5" cy="9" r="1"/>
      <circle cx="14.5" cy="9" r="1"/>
      <ellipse cx="12" cy="12" rx="2" ry="1" fill="none" stroke="currentColor" stroke-width="1"/>
      <path d="M8 14c0 2 1.5 4 4 4s4-2 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M6 10c-1-1-2-1.5-2-3s1.5-2.5 2-2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M18 10c1-1 2-1.5 2-3s-1.5-2.5-2-2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,
  },
];

const activeSection = ref<'providers' | 'instructions'>('providers');
const settings = ref<LLMSettings>({ ...DEFAULT_LLM_SETTINGS });
const testing = ref(false);
const loadingModels = ref(false);
const ollamaModels = ref<string[]>([]);
const connectionStatus = ref<{ success: boolean; message: string } | null>(null);
const showApiKey = ref(false);

onMounted(() => {
  settings.value = loadSettings();
});

async function handleSave() {
  saveSettings(settings.value);
  
  const toast = await toastController.create({
    message: 'Settings saved successfully',
    duration: 2000,
    color: 'success',
    position: 'top',
  });
  await toast.present();
}

async function handleTestConnection() {
  testing.value = true;
  connectionStatus.value = null;
  
  // Save settings first so test uses current values
  saveSettings(settings.value);
  
  try {
    const result = await testConnection();
    connectionStatus.value = result;
  } catch (error) {
    connectionStatus.value = {
      success: false,
      message: error instanceof Error ? error.message : 'Connection failed',
    };
  } finally {
    testing.value = false;
  }
}

async function fetchOllamaModels() {
  loadingModels.value = true;
  
  try {
    const models = await getOllamaModels(settings.value.ollama.baseUrl);
    ollamaModels.value = models;
    
    if (models.length === 0) {
      const toast = await toastController.create({
        message: 'No models found. Make sure Ollama is running.',
        duration: 3000,
        color: 'warning',
        position: 'top',
      });
      await toast.present();
    }
  } catch (error) {
    const toast = await toastController.create({
      message: 'Failed to fetch models. Check Ollama URL.',
      duration: 3000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  } finally {
    loadingModels.value = false;
  }
}

function selectOllamaModel(model: string) {
  settings.value.ollama.model = model;
}
</script>

<style scoped>
/* Header */
ion-header ion-toolbar {
  --background: var(--hn-bg-deep);
  --color: var(--hn-text-primary);
  --border-color: var(--hn-border-default);
}

ion-title {
  color: var(--hn-text-primary);
}

ion-content {
  --background: var(--hn-bg-deepest);
}

/* Mobile Tabs */
.mobile-tabs {
  display: none;
  padding: 16px 16px 0 16px;
  background: var(--hn-bg-deep);
}

.mobile-tabs ion-segment {
  --background: var(--hn-bg-surface);
  border-radius: 10px;
  padding: 4px;
}

.mobile-tabs ion-segment-button {
  --color: var(--hn-text-secondary);
  --color-checked: var(--hn-purple);
  --indicator-color: transparent;
  --background-checked: var(--hn-purple-muted);
  --border-radius: 8px;
  font-size: 0.85rem;
  min-height: 48px;
  margin: 0;
}

.mobile-tabs ion-segment-button::part(indicator-background) {
  background: var(--hn-purple-muted);
  border-radius: 8px;
}

.mobile-tabs ion-segment-button ion-icon {
  font-size: 1.1rem;
  margin-bottom: 4px;
}

.mobile-tabs ion-segment-button ion-label {
  font-size: 0.8rem;
  text-transform: none;
}

/* Settings Layout */
.settings-layout {
  display: flex;
  min-height: 100%;
}

/* Sidebar */
.settings-sidebar {
  width: 240px;
  min-width: 240px;
  background: var(--hn-bg-deep);
  border-right: 1px solid var(--hn-border-default);
  padding: 20px 0;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 12px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--hn-text-secondary);
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.nav-item ion-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.nav-item:hover {
  background: var(--hn-bg-hover);
  color: var(--hn-text-primary);
}

.nav-item.active {
  background: var(--hn-purple-muted);
  color: var(--hn-purple-light);
}

/* Content Area */
.settings-content {
  flex: 1;
  padding: 32px;
  overflow-y: auto;
  max-width: 800px;
}

.content-section {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.section-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--hn-text-primary);
  margin: 0 0 8px 0;
}

.section-description {
  color: var(--hn-text-secondary);
  font-size: 0.95rem;
  margin: 0 0 24px 0;
}

/* Provider Cards */
.provider-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.provider-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--hn-bg-surface);
  border: 2px solid var(--hn-border-default);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
  position: relative;
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
  flex-shrink: 0;
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
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--hn-text-primary);
  margin: 0 0 4px 0;
}

.provider-info p {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
  margin: 0;
}

.selected-indicator {
  position: absolute;
  top: 12px;
  right: 12px;
  color: var(--hn-purple);
}

.selected-indicator ion-icon {
  font-size: 1.4rem;
}

/* Config Panel */
.config-panel {
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
}

.config-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--hn-text-primary);
  margin: 0 0 20px 0;
}

.config-fields {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-group label {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--hn-text-primary);
}

.field-group .optional {
  color: var(--hn-text-muted);
  font-weight: 400;
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

/* Model input row */
.model-input-row {
  display: flex;
  gap: 12px;
}

.model-input-row input {
  flex: 1;
}

.fetch-models-btn {
  padding: 12px 20px;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  color: var(--hn-purple);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
}

.fetch-models-btn:hover:not(:disabled) {
  background: var(--hn-purple-muted);
  border-color: var(--hn-purple);
}

.fetch-models-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.fetch-models-btn ion-spinner {
  width: 18px;
  height: 18px;
  --color: var(--hn-purple);
}

/* Models list */
.models-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.model-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  color: var(--hn-text-secondary);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.model-item:hover {
  border-color: var(--hn-border-strong);
  color: var(--hn-text-primary);
}

.model-item.selected {
  border-color: var(--hn-purple);
  background: var(--hn-purple-muted);
  color: var(--hn-purple-light);
}

.model-item .check-icon {
  color: var(--hn-purple);
}

/* Toggle field */
.toggle-field {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--hn-bg-deep);
  border-radius: 8px;
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toggle-info label {
  margin: 0;
}

.toggle-description {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
}

/* Toggle switch */
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

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--hn-border-strong);
  transition: 0.3s;
  border-radius: 28px;
}

.slider:before {
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
  background-color: #ffffff;
  transform: translateX(24px);
}

/* Connection Status */
.connection-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-radius: 10px;
  font-size: 0.9rem;
  margin-bottom: 24px;
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

/* Action Buttons */
.action-buttons {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

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
  color: #ffffff;
}

.btn-primary:hover {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.btn-secondary {
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  color: var(--hn-text-primary);
}

.btn-secondary:hover {
  background: var(--hn-bg-elevated);
  border-color: var(--hn-border-strong);
}

.btn-secondary ion-spinner {
  --color: var(--hn-purple);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

/* Responsive: Mobile */
@media (max-width: 768px) {
  .mobile-tabs {
    display: block;
  }

  .settings-sidebar {
    display: none;
  }

  .settings-content {
    padding: 24px 16px;
    max-width: 100%;
  }

  .provider-cards {
    grid-template-columns: 1fr;
  }

  .model-input-row {
    flex-direction: column;
  }

  .toggle-field {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .action-buttons {
    flex-direction: column;
  }

  .btn {
    justify-content: center;
    width: 100%;
  }
}
</style>
