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

    <ion-content :fullscreen="true" class="ion-padding">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Settings</ion-title>
        </ion-toolbar>
      </ion-header>

      <!-- Provider Selection -->
      <ion-list-header>
        <ion-label>LLM Provider</ion-label>
      </ion-list-header>
      <ion-list inset>
        <ion-radio-group v-model="settings.provider">
          <ion-item>
            <ion-radio value="openai" justify="space-between">
              <ion-label>
                <h2>OpenAI</h2>
                <p>GPT-4o, GPT-4o-mini, GPT-3.5</p>
              </ion-label>
            </ion-radio>
          </ion-item>
          <ion-item>
            <ion-radio value="ollama" justify="space-between">
              <ion-label>
                <h2>Ollama (Local)</h2>
                <p>Llama, Mistral, and other local models</p>
              </ion-label>
            </ion-radio>
          </ion-item>
        </ion-radio-group>
      </ion-list>

      <!-- OpenAI Settings -->
      <template v-if="settings.provider === 'openai'">
        <ion-list-header>
          <ion-label>OpenAI Configuration</ion-label>
        </ion-list-header>
        <ion-list inset>
          <ion-item>
            <ion-input
              v-model="settings.openai.apiKey"
              label="API Key"
              label-placement="stacked"
              type="password"
              placeholder="sk-..."
              :clear-input="true"
            />
          </ion-item>
          <ion-item lines="none" class="api-key-help">
            <ion-label class="ion-text-wrap">
              <p>
                Create an API key at 
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">
                  platform.openai.com/api-keys
                </a>
              </p>
            </ion-label>
          </ion-item>
          <ion-item>
            <ion-select
              v-model="settings.openai.model"
              label="Model"
              label-placement="stacked"
              interface="action-sheet"
            >
              <ion-select-option value="gpt-4o">GPT-4o</ion-select-option>
              <ion-select-option value="gpt-4o-mini">GPT-4o Mini</ion-select-option>
              <ion-select-option value="gpt-4-turbo">GPT-4 Turbo</ion-select-option>
              <ion-select-option value="gpt-3.5-turbo">GPT-3.5 Turbo</ion-select-option>
            </ion-select>
          </ion-item>
          <ion-item>
            <ion-input
              v-model="settings.openai.baseUrl"
              label="Custom Base URL (Optional)"
              label-placement="stacked"
              placeholder="https://api.openai.com/v1"
              :clear-input="true"
            />
          </ion-item>
        </ion-list>
      </template>

      <!-- Ollama Settings -->
      <template v-if="settings.provider === 'ollama'">
        <ion-list-header>
          <ion-label>Ollama Configuration</ion-label>
        </ion-list-header>
        <ion-list inset>
          <ion-item>
            <ion-input
              v-model="settings.ollama.baseUrl"
              label="Ollama URL"
              label-placement="stacked"
              placeholder="http://localhost:11434"
              :clear-input="true"
            />
          </ion-item>
          <ion-item>
            <ion-input
              v-model="settings.ollama.model"
              label="Model"
              label-placement="stacked"
              placeholder="llama3.2"
              :clear-input="true"
            />
          </ion-item>
          <ion-item button @click="fetchOllamaModels" :disabled="loadingModels">
            <ion-label color="primary">
              <ion-spinner v-if="loadingModels" name="crescent" />
              <span v-else>Fetch Available Models</span>
            </ion-label>
          </ion-item>
        </ion-list>

        <!-- Available Models -->
        <template v-if="ollamaModels.length > 0">
          <ion-list-header>
            <ion-label>Available Models</ion-label>
          </ion-list-header>
          <ion-list inset>
            <ion-item 
              v-for="model in ollamaModels" 
              :key="model"
              button
              @click="selectOllamaModel(model)"
              :color="settings.ollama.model === model ? 'primary' : undefined"
            >
              <ion-icon :icon="cubeOutline" slot="start" />
              <ion-label>{{ model }}</ion-label>
              <ion-icon 
                v-if="settings.ollama.model === model" 
                :icon="checkmarkOutline" 
                slot="end" 
              />
            </ion-item>
          </ion-list>
        </template>
      </template>

      <!-- Note Settings (Phase 9) -->
      <ion-list-header>
        <ion-label>Note Settings</ion-label>
      </ion-list-header>
      <ion-list inset>
        <ion-item>
          <ion-textarea
            v-model="settings.noteSettings.formatInstructions"
            label="Format Instructions"
            label-placement="stacked"
            placeholder="Custom instructions for note formatting (e.g., 'Always use bullet points', 'Include a summary section')"
            :rows="3"
            :auto-grow="true"
          />
        </ion-item>
        <ion-item>
          <ion-input
            v-model="settings.noteSettings.defaultDirectory"
            label="Default Notes Directory"
            label-placement="stacked"
            placeholder="notes"
            :clear-input="true"
          />
        </ion-item>
        <ion-item>
          <ion-toggle
            v-model="settings.noteSettings.autoGenerateTitle"
            justify="space-between"
          >
            <ion-label>
              <h3>Auto-generate Note Titles</h3>
              <p>Use AI to generate titles from note content</p>
            </ion-label>
          </ion-toggle>
        </ion-item>
      </ion-list>

      <!-- Test Connection -->
      <div class="action-buttons">
        <ion-button expand="block" @click="handleTestConnection" :disabled="testing">
          <ion-spinner v-if="testing" name="crescent" slot="start" />
          <ion-icon v-else :icon="flashOutline" slot="start" />
          Test Connection
        </ion-button>
        
        <ion-button expand="block" color="success" @click="handleSave">
          <ion-icon :icon="saveOutline" slot="start" />
          Save Settings
        </ion-button>
      </div>

      <!-- Connection Status -->
      <div v-if="connectionStatus" :class="['connection-status', connectionStatus.success ? 'success' : 'error']">
        <ion-icon :icon="connectionStatus.success ? checkmarkCircleOutline : closeCircleOutline" />
        <span>{{ connectionStatus.message }}</span>
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
  IonList,
  IonListHeader,
  IonItem,
  IonLabel,
  IonInput,
  IonTextarea,
  IonSelect,
  IonSelectOption,
  IonRadio,
  IonRadioGroup,
  IonButton,
  IonIcon,
  IonSpinner,
  IonToggle,
  toastController,
} from '@ionic/vue';
import {
  flashOutline,
  saveOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  cubeOutline,
  checkmarkOutline,
} from 'ionicons/icons';
import type { LLMSettings } from '@/types';
import { DEFAULT_LLM_SETTINGS } from '@/types';
import { loadSettings, saveSettings, testConnection, getOllamaModels } from '@/services';

const settings = ref<LLMSettings>({ ...DEFAULT_LLM_SETTINGS });
const testing = ref(false);
const loadingModels = ref(false);
const ollamaModels = ref<string[]>([]);
const connectionStatus = ref<{ success: boolean; message: string } | null>(null);

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
ion-content {
  --background: #1a1a2e;
}

ion-header ion-toolbar {
  --background: #16162a;
  --color: #e2e2e8;
  --border-color: #2d2d44;
}

ion-title {
  color: #e2e2e8;
}

ion-list-header {
  margin-top: 16px;
  color: #8b8b9e;
  --background: transparent;
}

ion-list-header ion-label {
  color: #8b8b9e;
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.5px;
}

ion-list-header:first-of-type {
  margin-top: 0;
}

ion-list[inset] {
  --ion-background-color: #2d2d44;
  border-radius: 12px;
  overflow: hidden;
}

ion-item {
  --background: #2d2d44;
  --color: #e2e2e8;
  --border-color: #3d3d5c;
}

ion-item h2 {
  color: #e2e2e8 !important;
}

ion-item p {
  color: #8b8b9e !important;
}

ion-radio {
  --color: #6b6b80;
  --color-checked: #6366f1;
}

ion-input,
ion-textarea {
  --color: #e2e2e8;
  --placeholder-color: #6b6b80;
}

ion-select {
  --color: #e2e2e8;
  --placeholder-color: #6b6b80;
}

.action-buttons {
  margin-top: 32px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-buttons ion-button {
  --background: linear-gradient(135deg, #6366f1, #8b5cf6);
  --color: #ffffff;
  --border-radius: 12px;
}

.action-buttons ion-button[color="success"] {
  --background: linear-gradient(135deg, #10b981, #059669);
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 0.9rem;
}

.connection-status.success {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.connection-status.error {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.connection-status ion-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
}

ion-spinner {
  --color: #6366f1;
}

ion-toggle {
  --track-background: #3d3d5c;
  --track-background-checked: #6366f1;
  --handle-background: #e2e2e8;
  --handle-background-checked: #ffffff;
}

ion-toggle ion-label h3 {
  color: #e2e2e8;
  font-size: 1rem;
  margin: 0;
}

ion-toggle ion-label p {
  color: #8b8b9e;
  font-size: 0.85rem;
  margin: 4px 0 0;
}

ion-textarea {
  --color: #e2e2e8;
  --placeholder-color: #6b6b80;
}

.api-key-help {
  --background: transparent;
  --padding-top: 0;
  --inner-padding-top: 0;
}

.api-key-help p {
  font-size: 0.8rem;
  color: #8b8b9e !important;
  margin: 0;
}

.api-key-help a {
  color: #6366f1;
  text-decoration: none;
}

.api-key-help a:hover {
  text-decoration: underline;
}
</style>

