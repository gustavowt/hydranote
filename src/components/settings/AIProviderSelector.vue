<template>
  <div class="ai-provider-selector">
    <!-- Main Provider Cards -->
    <div class="provider-cards" :class="{ compact }">
      <button
        v-for="provider in mainProviders"
        :key="provider.id"
        class="provider-card"
        :class="{ selected: modelValue.provider === provider.id }"
        @click="selectProvider(provider.id)"
      >
        <div class="provider-icon">
          <component :is="provider.iconComponent" />
        </div>
        <div class="provider-info">
          <h3>{{ provider.name }}</h3>
          <p>{{ provider.description }}</p>
        </div>
        <div class="selected-indicator" v-if="modelValue.provider === provider.id">
          <ion-icon :icon="checkmarkCircle" />
        </div>
      </button>
    </div>

    <!-- Advanced Options Section -->
    <div class="advanced-section">
      <button class="advanced-toggle" @click="showAdvanced = !showAdvanced" type="button">
        <ion-icon :icon="settingsOutline" />
        <span>Advanced</span>
        <ion-icon :icon="showAdvanced ? chevronUpOutline : chevronDownOutline" class="chevron" />
      </button>

      <!-- Advanced Providers (collapsible content) -->
      <div v-if="showAdvanced" class="advanced-content">
        <div class="experimental-warning">
          <ion-icon :icon="warningOutline" />
          <span>These are experimental options and might not work as expected depending on the chosen model.</span>
        </div>

        <div class="provider-cards" :class="{ compact }">
          <button
            v-for="provider in advancedProviders"
            :key="provider.id"
            class="provider-card"
            :class="{ selected: modelValue.provider === provider.id }"
            @click="selectProvider(provider.id)"
          >
            <div class="provider-icon">
              <component :is="provider.iconComponent" />
            </div>
            <div class="provider-info">
              <div class="provider-name-row">
                <h3>{{ provider.name }}</h3>
                <span v-if="provider.id === 'huggingface_local'" class="experimental-badge">Experimental</span>
              </div>
              <p>{{ provider.description }}</p>
            </div>
            <div class="selected-indicator" v-if="modelValue.provider === provider.id">
              <ion-icon :icon="checkmarkCircle" />
            </div>
          </button>
        </div>
      </div>
    </div>

    <!-- OpenAI Configuration -->
    <div v-if="modelValue.provider === 'openai'" class="config-panel">
      <h3 v-if="!compact" class="config-title">OpenAI Configuration</h3>
      <div class="config-fields">
        <div class="field-group">
          <label>API Key</label>
          <div class="input-wrapper">
            <input
              :value="modelValue.openai.apiKey"
              @input="updateNestedField('openai', 'apiKey', ($event.target as HTMLInputElement).value)"
              :type="showApiKey ? 'text' : 'password'"
              placeholder="sk-..."
            />
            <button class="toggle-visibility" @click="showApiKey = !showApiKey" type="button">
              <ion-icon :icon="showApiKey ? eyeOffOutline : eyeOutline" />
            </button>
          </div>
          <span class="field-hint">
            Get your key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>
          </span>
        </div>

        <div class="field-group">
          <label>Model</label>
          <select
            :value="modelValue.openai.model"
            @change="updateNestedField('openai', 'model', ($event.target as HTMLSelectElement).value)"
          >
            <optgroup label="Latest (2025)">
              <option value="gpt-4.1">GPT-4.1</option>
              <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
              <option value="gpt-4.1-nano">GPT-4.1 Nano</option>
              <option value="o3">o3 (Reasoning)</option>
              <option value="o3-mini">o3 Mini (Reasoning)</option>
            </optgroup>
            <optgroup label="GPT-4o Series">
              <option value="gpt-4o">GPT-4o</option>
              <option value="gpt-4o-mini">GPT-4o Mini</option>
            </optgroup>
            <optgroup v-if="!compact" label="Previous">
              <option value="gpt-4-turbo">GPT-4 Turbo</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
            </optgroup>
          </select>
        </div>

        <div v-if="!compact" class="field-group">
          <label>Custom Base URL <span class="optional">(Optional)</span></label>
          <input
            :value="modelValue.openai.baseUrl"
            @input="updateNestedField('openai', 'baseUrl', ($event.target as HTMLInputElement).value)"
            type="text"
            placeholder="https://api.openai.com/v1"
          />
        </div>
      </div>
    </div>

    <!-- Anthropic (Claude) Configuration -->
    <div v-if="modelValue.provider === 'anthropic'" class="config-panel">
      <h3 v-if="!compact" class="config-title">Claude Configuration</h3>
      <div class="config-fields">
        <div class="field-group">
          <label>API Key</label>
          <div class="input-wrapper">
            <input
              :value="modelValue.anthropic.apiKey"
              @input="updateNestedField('anthropic', 'apiKey', ($event.target as HTMLInputElement).value)"
              :type="showApiKey ? 'text' : 'password'"
              placeholder="sk-ant-..."
            />
            <button class="toggle-visibility" @click="showApiKey = !showApiKey" type="button">
              <ion-icon :icon="showApiKey ? eyeOffOutline : eyeOutline" />
            </button>
          </div>
          <span class="field-hint">
            Get your key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>
          </span>
        </div>

        <div class="field-group">
          <label>Model</label>
          <select
            :value="modelValue.anthropic.model"
            @change="updateNestedField('anthropic', 'model', ($event.target as HTMLSelectElement).value)"
          >
            <optgroup label="Claude 4 (2025)">
              <option value="claude-opus-4-5-20251101">Claude Opus 4.5 (Most Powerful)</option>
              <option value="claude-opus-4-1-20250805">Claude Opus 4.1</option>
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
            </optgroup>
            <optgroup label="Claude 3.5 (2024)">
              <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
              <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku (Fast)</option>
            </optgroup>
            <optgroup v-if="!compact" label="Claude 3">
              <option value="claude-3-opus-20240229">Claude 3 Opus</option>
              <option value="claude-3-sonnet-20240229">Claude 3 Sonnet</option>
              <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
            </optgroup>
          </select>
        </div>
      </div>
    </div>

    <!-- Google (Gemini) Configuration -->
    <div v-if="modelValue.provider === 'google'" class="config-panel">
      <h3 v-if="!compact" class="config-title">Gemini Configuration</h3>
      <div class="config-fields">
        <div class="field-group">
          <label>API Key</label>
          <div class="input-wrapper">
            <input
              :value="modelValue.google.apiKey"
              @input="updateNestedField('google', 'apiKey', ($event.target as HTMLInputElement).value)"
              :type="showApiKey ? 'text' : 'password'"
              placeholder="AIza..."
            />
            <button class="toggle-visibility" @click="showApiKey = !showApiKey" type="button">
              <ion-icon :icon="showApiKey ? eyeOffOutline : eyeOutline" />
            </button>
          </div>
          <span class="field-hint">
            Get your key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>
          </span>
        </div>

        <div class="field-group">
          <label>Model</label>
          <select
            :value="modelValue.google.model"
            @change="updateNestedField('google', 'model', ($event.target as HTMLSelectElement).value)"
          >
            <optgroup label="Gemini 2.5 (2025)">
              <option value="gemini-2.5-pro">Gemini 2.5 Pro (Most Powerful)</option>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite (Fastest)</option>
            </optgroup>
            <optgroup label="Gemini 2.0">
              <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
              <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash (Experimental)</option>
            </optgroup>
            <optgroup v-if="!compact" label="Gemini 1.5">
              <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
              <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
              <option value="gemini-1.5-flash-8b">Gemini 1.5 Flash 8B</option>
            </optgroup>
          </select>
        </div>
      </div>
    </div>

    <!-- Ollama Configuration -->
    <div v-if="modelValue.provider === 'ollama'" class="config-panel">
      <h3 v-if="!compact" class="config-title">Ollama Configuration</h3>
      <div class="config-fields">
        <div class="field-group">
          <label>Ollama URL</label>
          <input
            :value="modelValue.ollama.baseUrl"
            @input="updateNestedField('ollama', 'baseUrl', ($event.target as HTMLInputElement).value)"
            type="text"
            placeholder="http://localhost:11434"
          />
          <span class="field-hint">Local Ollama server address</span>
        </div>

        <div class="field-group">
          <label>Model</label>
          <div v-if="!compact" class="model-input-row">
            <input
              :value="modelValue.ollama.model"
              @input="updateNestedField('ollama', 'model', ($event.target as HTMLInputElement).value)"
              type="text"
              placeholder="llama3.2"
            />
            <button 
              class="fetch-models-btn" 
              @click="$emit('fetch-ollama-models')"
              :disabled="loadingModels"
              type="button"
            >
              <ion-spinner v-if="loadingModels" name="crescent" />
              <span v-else>Fetch Models</span>
            </button>
          </div>
          <input
            v-else
            :value="modelValue.ollama.model"
            @input="updateNestedField('ollama', 'model', ($event.target as HTMLInputElement).value)"
            type="text"
            placeholder="llama3.2"
          />
        </div>

        <!-- Available Models (full mode only) -->
        <div v-if="!compact && ollamaModels.length > 0" class="field-group">
          <label>Available Models</label>
          <div class="models-list">
            <button 
              v-for="model in ollamaModels" 
              :key="model"
              class="model-item"
              :class="{ selected: modelValue.ollama.model === model }"
              @click="updateNestedField('ollama', 'model', model)"
              type="button"
            >
              <ion-icon :icon="cubeOutline" />
              <span>{{ model }}</span>
              <ion-icon 
                v-if="modelValue.ollama.model === model" 
                :icon="checkmarkOutline" 
                class="check-icon"
              />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Local Model Configuration -->
    <div v-if="modelValue.provider === 'huggingface_local'" class="config-panel">
      <h3 v-if="!compact" class="config-title">Local Model Configuration</h3>
      
      <!-- GPU Requirements Banner -->
      <div class="gpu-info-banner">
        <ion-icon :icon="hardwareChipOutline" />
        <div>
          <p><strong>GPU Recommended:</strong> This experimental option works best with a dedicated graphics card (NVIDIA CUDA or Apple Metal).</p>
          <div v-if="hardwareInfo" class="hardware-badge" :class="hardwareInfo.backend !== 'cpu' && hardwareInfo.backend !== 'unknown' ? 'has-gpu' : 'cpu-only'">
            <ion-icon :icon="hardwareInfo.backend !== 'cpu' && hardwareInfo.backend !== 'unknown' ? checkmarkCircleOutline : alertCircleOutline" />
            <span>{{ formatHardwareInfo(hardwareInfo) }}</span>
          </div>
          <div v-else-if="localModelsAvailable" class="hardware-badge loading">
            <ion-spinner name="crescent" />
            <span>Detecting hardware...</span>
          </div>
        </div>
      </div>
      
      <div v-if="!localModelsAvailable" class="notice warning">
        <ion-icon :icon="alertCircleOutline" />
        <span>Local models are only available in the desktop (Electron) app.</span>
      </div>

      <div v-else-if="compact" class="config-fields">
        <!-- Compact mode: Basic info + link to settings -->
        <div class="info-banner">
          <ion-icon :icon="informationCircleOutline" />
          <div>
            <p>Local models let you run AI completely offline using your computer's hardware.</p>
            <p class="hint">You can download and manage models in Settings after completing the wizard.</p>
          </div>
        </div>

        <!-- Show installed models if any -->
        <div v-if="installedModels.length > 0" class="field-group">
          <label>Installed Models</label>
          <div class="models-list">
            <button
              v-for="model in installedModels"
              :key="model.id"
              class="model-item"
              :class="{ selected: modelValue.huggingfaceLocal?.modelId === model.id }"
              @click="selectLocalModel(model)"
              :disabled="model.state !== 'installed'"
              type="button"
            >
              <ion-icon :icon="cubeOutline" />
              <div class="model-item-info">
                <span class="model-name">{{ model.name }}</span>
                <span class="model-size">{{ formatFileSize(model.totalSize) }}</span>
              </div>
              <ion-icon
                v-if="modelValue.huggingfaceLocal?.modelId === model.id"
                :icon="checkmarkOutline"
                class="check-icon"
              />
            </button>
          </div>
        </div>
        <div v-else class="empty-state">
          <ion-icon :icon="cubeOutline" />
          <span>No models installed yet. Download one from Settings after setup.</span>
        </div>
      </div>

      <!-- Full mode: Complete model management -->
      <div v-else class="config-fields">
        <!-- Runtime Status -->
        <div v-if="runtimeStatus" class="runtime-status" :class="{ ready: runtimeStatus.ready, loading: loadingModel }">
          <div class="status-row">
            <span class="status-label">Runtime:</span>
            <span v-if="loadingModel" class="status-value text-loading">
              <ion-spinner name="crescent" /> Loading model...
            </span>
            <span v-else class="status-value" :class="runtimeStatus.ready ? 'text-success' : 'text-muted'">
              {{ runtimeStatus.ready ? 'Ready' : 'Not loaded' }}
            </span>
          </div>
          <div v-if="runtimeStatus.loadedModelName" class="status-row">
            <span class="status-label">Loaded:</span>
            <span class="status-value">{{ runtimeStatus.loadedModelName }}</span>
          </div>
          <div v-if="runtimeStatus.error && !loadingModel" class="status-row error">
            <ion-icon :icon="alertCircleOutline" />
            <span>{{ runtimeStatus.error }}</span>
          </div>
        </div>

        <!-- Installed Models -->
        <div class="field-group">
          <label>Installed Models</label>
          <div v-if="loadingLocalModels" class="loading-state">
            <ion-spinner name="crescent" />
            <span>Loading models...</span>
          </div>
          <div v-else-if="installedModels.length === 0" class="empty-state">
            <ion-icon :icon="cubeOutline" />
            <span>No models installed. Download one from the catalog below.</span>
          </div>
          <div v-else class="models-list">
            <button
              v-for="model in installedModels"
              :key="model.id"
              class="model-item"
              :class="{ 
                selected: modelValue.huggingfaceLocal?.modelId === model.id,
                downloading: model.state === 'downloading'
              }"
              @click="selectLocalModel(model)"
              :disabled="model.state !== 'installed'"
              type="button"
            >
              <ion-icon :icon="cubeOutline" />
              <div class="model-item-info">
                <span class="model-name">{{ model.name }}</span>
                <span class="model-size">{{ formatFileSize(model.totalSize) }}</span>
              </div>
              <span v-if="model.state === 'downloading'" class="model-status downloading">
                Downloading...
              </span>
              <span v-else-if="model.state === 'failed'" class="model-status failed">
                Failed
              </span>
              <ion-icon
                v-else-if="modelValue.huggingfaceLocal?.modelId === model.id"
                :icon="checkmarkOutline"
                class="check-icon"
              />
              <button 
                class="remove-model-btn" 
                @click.stop="$emit('remove-model', model.id)"
                title="Remove model"
                type="button"
              >
                <ion-icon :icon="trashOutline" />
              </button>
            </button>
          </div>
        </div>

        <!-- Download Progress -->
        <div v-if="downloadProgress" class="download-progress">
          <div class="progress-header">
            <span class="progress-label">Downloading: {{ downloadProgress.currentFile }}</span>
            <span class="progress-stats">
              {{ formatSpeed(downloadProgress.speed) }} · ETA: {{ formatEta(downloadProgress.eta || 0) }}
            </span>
          </div>
          <div class="progress-bar">
            <div 
              class="progress-fill" 
              :style="{ width: getProgressPercent(downloadProgress) + '%' }"
            />
          </div>
          <div class="progress-footer">
            <span>{{ formatFileSize(downloadProgress.totalDownloaded) }} / {{ formatFileSize(downloadProgress.totalSize) }}</span>
            <button class="cancel-btn" @click="$emit('cancel-download')" type="button">Cancel</button>
          </div>
        </div>

        <!-- Model Catalog -->
        <div class="field-group">
          <label>Model Catalog</label>
          <p class="field-hint">Download a GGUF model from Hugging Face to run locally.</p>
          <div class="catalog-list">
            <div
              v-for="model in modelCatalog"
              :key="model.id"
              class="catalog-item"
            >
              <div class="catalog-info">
                <div class="catalog-name-row">
                  <span class="catalog-name">{{ model.name }}</span>
                  <div 
                    v-if="model.bestFor || model.resourceInfo" 
                    class="info-icon-wrapper"
                  >
                    <ion-icon :icon="informationCircleOutline" class="info-icon" />
                    <div class="info-tooltip">
                      <div v-if="model.bestFor" class="tooltip-section">
                        <strong>Best for:</strong>
                        <p>{{ model.bestFor }}</p>
                      </div>
                      <div v-if="model.resourceInfo" class="tooltip-section">
                        <strong>System requirements:</strong>
                        <p>{{ model.resourceInfo }}</p>
                      </div>
                    </div>
                  </div>
                </div>
                <span class="catalog-desc">{{ model.description }}</span>
              </div>
              <button 
                class="btn btn-small"
                @click="$emit('install-model', model)"
                :disabled="installingModel !== null || isModelInstalled(model.id)"
                type="button"
              >
                <ion-spinner v-if="installingModel === model.id" name="crescent" />
                <span v-else-if="isModelInstalled(model.id)">Installed</span>
                <span v-else>Download</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Custom Model URL -->
        <div class="field-group">
          <label>Custom Model</label>
          <p class="field-hint">Enter a Hugging Face repo URL or ID to download a custom GGUF model.</p>
          <div class="custom-model-input-row">
            <input
              v-model="customModelUrl"
              type="text"
              placeholder="e.g., bartowski/Phi-4-GGUF or https://huggingface.co/..."
              @keyup.enter="validateCustomUrl"
            />
            <button 
              class="btn btn-small"
              @click="validateCustomUrl"
              :disabled="!customModelUrl.trim() || validatingCustomModel"
              type="button"
            >
              <ion-spinner v-if="validatingCustomModel" name="crescent" />
              <span v-else>Validate</span>
            </button>
          </div>
          
          <!-- Validation Result -->
          <div v-if="customModelValidation" class="custom-model-validation" :class="{ valid: customModelValidation.valid, invalid: !customModelValidation.valid }">
            <div v-if="customModelValidation.valid && customModelValidation.model" class="validation-success">
              <div class="validation-header">
                <ion-icon :icon="checkmarkCircleOutline" />
                <span class="model-found-name">{{ customModelValidation.model.name }}</span>
              </div>
              <p class="model-found-desc">{{ customModelValidation.model.description || 'No description available' }}</p>
              <div class="model-found-files">
                <span>{{ customModelValidation.model.files?.length || 0 }} GGUF file(s) available</span>
                <span v-if="customModelValidation.model.gated" class="gated-badge">
                  <ion-icon :icon="lockClosedOutline" /> Gated
                </span>
              </div>
              <button 
                class="btn btn-small btn-primary"
                @click="downloadCustomModel"
                :disabled="installingModel !== null || isModelInstalled(customModelValidation.model.id)"
                type="button"
              >
                <span v-if="isModelInstalled(customModelValidation.model.id)">Already Installed</span>
                <span v-else>Download Model</span>
              </button>
            </div>
            <div v-else class="validation-error">
              <ion-icon :icon="alertCircleOutline" />
              <span>{{ customModelValidation.error }}</span>
            </div>
          </div>
        </div>

        <!-- HuggingFace Token -->
        <div class="field-group">
          <label>Hugging Face Token (Optional)</label>
          <div class="input-wrapper">
            <input
              :value="localModelToken"
              @input="$emit('update:localModelToken', ($event.target as HTMLInputElement).value)"
              :type="showHfToken ? 'text' : 'password'"
              placeholder="hf_..."
            />
            <button class="toggle-visibility" @click="showHfToken = !showHfToken" type="button">
              <ion-icon :icon="showHfToken ? eyeOffOutline : eyeOutline" />
            </button>
          </div>
          <span class="field-hint">
            Required for gated/private models. Get your token at
            <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener">huggingface.co</a>
          </span>
        </div>
      </div>
    </div>

    <!-- Test Connection (compact mode) -->
    <div v-if="compact && hasApiKey" class="test-connection-section">
      <button class="btn btn-secondary" @click="$emit('test-connection')" :disabled="testingConnection" type="button">
        <ion-spinner v-if="testingConnection" name="crescent" />
        <ion-icon v-else :icon="flashOutline" />
        <span>Test Connection</span>
      </button>
      
      <div v-if="connectionStatus" :class="['connection-status', connectionStatus.success ? 'success' : 'error']">
        <ion-icon :icon="connectionStatus.success ? checkmarkCircleOutline : closeCircleOutline" />
        <span>{{ connectionStatus.message }}</span>
      </div>
    </div>

    <div v-if="compact && !hasApiKey && modelValue.provider !== 'huggingface_local'" class="info-banner warning">
      <ion-icon :icon="alertCircleOutline" />
      <p>You can configure the API key later in Settings. AI features will be disabled until configured.</p>
    </div>

    <!-- Connection Status (full mode) -->
    <div v-if="!compact && connectionStatus" :class="['connection-status', connectionStatus.success ? 'success' : 'error']">
      <ion-icon :icon="connectionStatus.success ? checkmarkCircleOutline : closeCircleOutline" />
      <span>{{ connectionStatus.message }}</span>
    </div>

    <!-- Action Buttons (full mode only) -->
    <div v-if="!compact" class="action-buttons">
      <button class="btn btn-secondary" @click="$emit('test-connection')" :disabled="testingConnection" type="button">
        <ion-spinner v-if="testingConnection" name="crescent" />
        <ion-icon v-else :icon="flashOutline" />
        <span>Test Connection</span>
      </button>
      <button class="btn btn-primary" @click="$emit('save')" type="button">
        <ion-icon :icon="saveOutline" />
        <span>Save Settings</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { IonIcon, IonSpinner } from '@ionic/vue';
import {
  checkmarkCircle,
  checkmarkCircleOutline,
  closeCircleOutline,
  eyeOutline,
  eyeOffOutline,
  cubeOutline,
  checkmarkOutline,
  alertCircleOutline,
  informationCircleOutline,
  trashOutline,
  flashOutline,
  saveOutline,
  settingsOutline,
  chevronUpOutline,
  chevronDownOutline,
  warningOutline,
  hardwareChipOutline,
  lockClosedOutline,
} from 'ionicons/icons';
import type { LLMSettings, LLMProvider, LocalModel, HFModelRef, ModelDownloadProgress, RuntimeStatus, HardwareInfo } from '@/types';
import type { CustomModelValidationResult } from '@/services';
import { OpenAiIcon, ClaudeIcon, GeminiIcon, OllamaIcon, HuggingFaceIcon } from '@/icons';
import { formatFileSize, validateCustomModel } from '@/services';

// Props
interface Props {
  modelValue: LLMSettings;
  compact?: boolean;
  // Connection testing
  testingConnection?: boolean;
  connectionStatus?: { success: boolean; message: string } | null;
  // Ollama
  loadingModels?: boolean;
  ollamaModels?: string[];
  // Local models
  localModelsAvailable?: boolean;
  installedModels?: LocalModel[];
  modelCatalog?: HFModelRef[];
  loadingLocalModels?: boolean;
  downloadProgress?: ModelDownloadProgress | null;
  runtimeStatus?: RuntimeStatus | null;
  installingModel?: string | null;
  loadingModel?: boolean;
  localModelToken?: string;
  // Hardware acceleration info
  hardwareInfo?: HardwareInfo | null;
}

const props = withDefaults(defineProps<Props>(), {
  compact: false,
  testingConnection: false,
  connectionStatus: null,
  loadingModels: false,
  ollamaModels: () => [],
  localModelsAvailable: false,
  installedModels: () => [],
  modelCatalog: () => [],
  loadingLocalModels: false,
  downloadProgress: null,
  runtimeStatus: null,
  installingModel: null,
  loadingModel: false,
  localModelToken: '',
  hardwareInfo: null,
});

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: LLMSettings];
  'update:localModelToken': [value: string];
  'test-connection': [];
  'save': [];
  'fetch-ollama-models': [];
  'select-local-model': [model: LocalModel];
  'install-model': [model: HFModelRef];
  'remove-model': [modelId: string];
  'cancel-download': [];
}>();

// Local state
const showApiKey = ref(false);
const showHfToken = ref(false);
const showAdvanced = ref(false);

// Custom model validation state
const customModelUrl = ref('');
const validatingCustomModel = ref(false);
const customModelValidation = ref<CustomModelValidationResult | null>(null);

// Advanced provider IDs
const advancedProviderIds = ['ollama', 'huggingface_local'];

// Auto-expand advanced section if an advanced provider is selected
onMounted(() => {
  if (advancedProviderIds.includes(props.modelValue.provider)) {
    showAdvanced.value = true;
  }
});

// Also watch for provider changes to auto-expand
watch(() => props.modelValue.provider, (newProvider) => {
  if (advancedProviderIds.includes(newProvider)) {
    showAdvanced.value = true;
  }
});

// Provider type
type ProviderConfig = { id: LLMProvider; name: string; description: string; iconComponent: typeof OpenAiIcon };

// Main provider configurations (cloud-based, well-tested)
const mainProviders: ProviderConfig[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4.1, o3, GPT-4o series',
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
];

// Advanced provider configurations (local, experimental)
const advancedProviders: ProviderConfig[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local LLMs: Llama, Mistral',
    iconComponent: OllamaIcon,
  },
  {
    id: 'huggingface_local',
    name: 'Local Model',
    description: 'Run Hugging Face GGUF models locally',
    iconComponent: HuggingFaceIcon,
  },
];

// Computed
const hasApiKey = computed(() => {
  const provider = props.modelValue.provider;
  if (provider === 'openai') return !!props.modelValue.openai.apiKey;
  if (provider === 'anthropic') return !!props.modelValue.anthropic.apiKey;
  if (provider === 'google') return !!props.modelValue.google.apiKey;
  if (provider === 'ollama') return !!props.modelValue.ollama.baseUrl;
  if (provider === 'huggingface_local') return props.localModelsAvailable && props.installedModels.length > 0;
  return false;
});

// Methods
function selectProvider(providerId: LLMProvider) {
  emit('update:modelValue', { ...props.modelValue, provider: providerId });
}

function updateNestedField(provider: 'openai' | 'ollama' | 'anthropic' | 'google' | 'huggingfaceLocal', field: string, value: string) {
  const updated = { ...props.modelValue };
  // Type-safe nested update
  if (provider === 'openai') {
    updated.openai = { ...updated.openai, [field]: value };
  } else if (provider === 'ollama') {
    updated.ollama = { ...updated.ollama, [field]: value };
  } else if (provider === 'anthropic') {
    updated.anthropic = { ...updated.anthropic, [field]: value };
  } else if (provider === 'google') {
    updated.google = { ...updated.google, [field]: value };
  } else if (provider === 'huggingfaceLocal') {
    updated.huggingfaceLocal = { ...updated.huggingfaceLocal, [field]: value };
  }
  emit('update:modelValue', updated);
}

function selectLocalModel(model: LocalModel) {
  if (model.state === 'installed') {
    const updated = { ...props.modelValue };
    updated.huggingfaceLocal = {
      ...updated.huggingfaceLocal,
      modelId: model.id,
    };
    emit('update:modelValue', updated);
    emit('select-local-model', model);
  }
}

function isModelInstalled(huggingFaceId: string): boolean {
  return props.installedModels.some(m => m.huggingFaceId === huggingFaceId && m.state === 'installed');
}

// Custom model validation
async function validateCustomUrl() {
  const url = customModelUrl.value.trim();
  if (!url) return;
  
  validatingCustomModel.value = true;
  customModelValidation.value = null;
  
  try {
    customModelValidation.value = await validateCustomModel(url);
  } catch (error) {
    customModelValidation.value = {
      valid: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  } finally {
    validatingCustomModel.value = false;
  }
}

function downloadCustomModel() {
  if (customModelValidation.value?.valid && customModelValidation.value.model) {
    emit('install-model', customModelValidation.value.model);
    // Clear the validation after starting download
    customModelUrl.value = '';
    customModelValidation.value = null;
  }
}

// Format helpers
function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function getProgressPercent(progress: ModelDownloadProgress): number {
  if (!progress.totalSize) return 0;
  return Math.min(100, (progress.totalDownloaded / progress.totalSize) * 100);
}

// Format hardware info for display
function formatHardwareInfo(info: HardwareInfo): string {
  const backendNames: Record<string, string> = {
    cuda: 'CUDA (NVIDIA GPU)',
    metal: 'Metal (Apple Silicon)',
    vulkan: 'Vulkan (GPU)',
    cpu: 'CPU only',
    unknown: 'Unknown',
  };

  const backendName = backendNames[info.backend] || info.backend;
  
  if (info.backend === 'cpu' || info.backend === 'unknown') {
    const supported = info.supportedBackends.length > 0 
      ? ` (Available: ${info.supportedBackends.join(', ')})`
      : '';
    return `${backendName}${supported}`;
  }

  return `${backendName} detected`;
}
</script>

<style scoped>
/* Provider Cards */
.provider-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.provider-cards.compact {
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
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

.compact .provider-card {
  flex-direction: column;
  padding: 20px 16px;
  gap: 12px;
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
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--hn-text-primary);
  margin: 0;
}

.provider-info p {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
  margin: 4px 0 0 0;
}

.compact .provider-info p {
  font-size: 0.8rem;
}

.selected-indicator {
  position: absolute;
  top: 10px;
  right: 10px;
  color: var(--hn-purple);
}

.selected-indicator ion-icon {
  font-size: 1.3rem;
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
  gap: 16px;
}

/* Field Groups */
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

.field-group input,
.field-group select {
  padding: 12px 16px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  color: var(--hn-text-primary);
  font-size: 0.95rem;
  transition: border-color 0.2s ease;
}

.field-group input:focus,
.field-group select:focus {
  outline: none;
  border-color: var(--hn-purple);
}

.field-group input::placeholder {
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

.optional {
  font-weight: 400;
  color: var(--hn-text-muted);
}

/* Input wrapper with visibility toggle */
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

/* Model Input Row */
.model-input-row {
  display: flex;
  gap: 12px;
}

.model-input-row input {
  flex: 1;
}

.fetch-models-btn {
  padding: 12px 16px;
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  color: var(--hn-text-primary);
  cursor: pointer;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 8px;
}

.fetch-models-btn:hover:not(:disabled) {
  background: var(--hn-bg-elevated);
  border-color: var(--hn-border-strong);
}

.fetch-models-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Models List */
.models-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.model-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.model-item:hover:not(:disabled) {
  border-color: var(--hn-border-strong);
  background: var(--hn-bg-elevated);
}

.model-item.selected {
  border-color: var(--hn-purple);
  background: var(--hn-purple-muted);
}

.model-item:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.model-item-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-name {
  font-weight: 500;
  color: var(--hn-text-primary);
}

.model-size {
  font-size: 0.8rem;
  color: var(--hn-text-muted);
}

.model-status {
  font-size: 0.8rem;
  padding: 2px 8px;
  border-radius: 4px;
}

.model-status.downloading {
  background: var(--hn-info-muted);
  color: var(--hn-info);
}

.model-status.failed {
  background: var(--hn-danger-muted);
  color: var(--hn-danger);
}

.check-icon {
  color: var(--hn-purple);
}

.remove-model-btn {
  padding: 6px;
  background: transparent;
  border: none;
  color: var(--hn-text-muted);
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.remove-model-btn:hover {
  background: var(--hn-danger-muted);
  color: var(--hn-danger);
}

/* Notice/Warning */
.notice {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 8px;
  font-size: 0.9rem;
}

.notice.warning {
  background: var(--hn-warning-muted);
  border: 1px solid rgba(210, 153, 34, 0.3);
  color: var(--hn-warning);
}

/* Info Banner */
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

.info-banner .hint {
  margin-top: 8px;
  font-size: 0.85rem;
  opacity: 0.9;
}

/* Empty/Loading States */
.empty-state,
.loading-state {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px;
  background: var(--hn-bg-deep);
  border: 1px dashed var(--hn-border-default);
  border-radius: 8px;
  color: var(--hn-text-muted);
  justify-content: center;
}

/* Runtime Status */
.runtime-status {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  margin-bottom: 16px;
}

.runtime-status.ready {
  border-color: var(--hn-green);
  background: var(--hn-green-muted);
}

.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
}

.status-label {
  color: var(--hn-text-secondary);
}

.status-value {
  font-weight: 500;
}

.text-success {
  color: var(--hn-green);
}

.text-muted {
  color: var(--hn-text-muted);
}

.text-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--hn-info);
}

.status-row.error {
  color: var(--hn-danger);
}

/* Download Progress */
.download-progress {
  padding: 16px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  margin-bottom: 16px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.progress-label {
  font-weight: 500;
  color: var(--hn-text-primary);
}

.progress-stats {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
}

.progress-bar {
  height: 8px;
  background: var(--hn-border-default);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--hn-purple);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
}

.cancel-btn {
  padding: 4px 12px;
  background: var(--hn-danger-muted);
  border: none;
  border-radius: 4px;
  color: var(--hn-danger);
  cursor: pointer;
  font-size: 0.85rem;
}

.cancel-btn:hover {
  background: var(--hn-danger);
  color: #fff;
}

/* Model Catalog */
.catalog-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.catalog-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
}

.catalog-info {
  flex: 1;
}

.catalog-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.catalog-name {
  font-weight: 500;
  color: var(--hn-text-primary);
}

.catalog-desc {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
  display: block;
  margin-top: 4px;
}

.info-icon-wrapper {
  position: relative;
}

.info-icon {
  color: var(--hn-text-muted);
  cursor: help;
}

.info-tooltip {
  display: none;
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 280px;
  padding: 12px;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-strong);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 100;
}

.info-icon-wrapper:hover .info-tooltip {
  display: block;
}

.tooltip-section {
  margin-bottom: 8px;
}

.tooltip-section:last-child {
  margin-bottom: 0;
}

.tooltip-section strong {
  color: var(--hn-text-primary);
  font-size: 0.85rem;
}

.tooltip-section p {
  color: var(--hn-text-secondary);
  font-size: 0.8rem;
  margin: 4px 0 0 0;
}

/* Custom Model Input */
.custom-model-input-row {
  display: flex;
  gap: 12px;
}

.custom-model-input-row input {
  flex: 1;
}

.custom-model-validation {
  margin-top: 12px;
  padding: 14px 16px;
  border-radius: 8px;
}

.custom-model-validation.valid {
  background: var(--hn-green-muted);
  border: 1px solid rgba(63, 185, 80, 0.3);
}

.custom-model-validation.invalid {
  background: var(--hn-danger-muted);
  border: 1px solid rgba(248, 81, 73, 0.3);
}

.validation-success {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.validation-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--hn-green);
}

.validation-header ion-icon {
  font-size: 1.2rem;
}

.model-found-name {
  font-weight: 600;
  color: var(--hn-text-primary);
}

.model-found-desc {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
  margin: 0;
}

.model-found-files {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.85rem;
  color: var(--hn-text-muted);
}

.gated-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--hn-warning-muted);
  border-radius: 4px;
  color: var(--hn-warning);
  font-size: 0.75rem;
}

.validation-error {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: var(--hn-danger);
  font-size: 0.9rem;
}

.validation-error ion-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
  margin-top: 2px;
}

/* Connection Status */
.connection-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-radius: 10px;
  font-size: 0.9rem;
  margin-bottom: 16px;
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

/* Test Connection Section (compact) */
.test-connection-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 24px;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  gap: 12px;
  margin-top: 24px;
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

.btn-secondary {
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  color: var(--hn-text-primary);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--hn-bg-elevated);
  border-color: var(--hn-border-strong);
}

.btn-small {
  padding: 8px 16px;
  font-size: 0.85rem;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Advanced Toggle */
.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 14px 20px;
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  border-radius: 10px;
  color: var(--hn-text-secondary);
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 16px;
}

.advanced-toggle:hover {
  background: var(--hn-bg-elevated);
  border-color: var(--hn-border-strong);
  color: var(--hn-text-primary);
}

.advanced-toggle ion-icon {
  font-size: 1.2rem;
}

.advanced-toggle .chevron {
  margin-left: auto;
  color: var(--hn-text-muted);
}

/* Advanced Section */
.advanced-section {
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border);
  border-radius: 12px;
  margin-bottom: 24px;
}

.advanced-section .advanced-toggle {
  width: 100%;
  border: none;
  border-radius: 12px;
}

.advanced-section .advanced-toggle:hover {
  background: var(--hn-bg-hover);
}

.advanced-content {
  padding: 0 16px 16px 16px;
  animation: fadeSlideIn 0.2s ease;
}

.advanced-content .provider-cards {
  margin-bottom: 0;
}

@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Experimental Warning */
.experimental-warning {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px;
  background: var(--hn-warning-muted);
  border: 1px solid rgba(210, 153, 34, 0.3);
  border-radius: 10px;
  color: var(--hn-warning);
  font-size: 0.9rem;
  margin-bottom: 16px;
  line-height: 1.5;
}

.experimental-warning ion-icon {
  font-size: 1.3rem;
  flex-shrink: 0;
  margin-top: 2px;
}

/* Provider Name Row (for badges) */
.provider-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Experimental Badge */
.experimental-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: var(--hn-warning-muted);
  border: 1px solid rgba(210, 153, 34, 0.4);
  border-radius: 4px;
  color: var(--hn-warning);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* GPU Info Banner */
.gpu-info-banner {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px 20px;
  background: var(--hn-info-muted);
  border: 1px solid rgba(88, 166, 255, 0.3);
  border-radius: 10px;
  margin-bottom: 20px;
}

.gpu-info-banner > ion-icon {
  font-size: 1.5rem;
  color: var(--hn-info);
  flex-shrink: 0;
  margin-top: 2px;
}

.gpu-info-banner p {
  margin: 0 0 10px 0;
  font-size: 0.9rem;
  color: var(--hn-text-secondary);
  line-height: 1.5;
}

.gpu-info-banner p strong {
  color: var(--hn-text-primary);
}

/* Hardware Badge */
.hardware-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 6px;
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
}

.hardware-badge.has-gpu {
  background: var(--hn-green-muted);
  border-color: rgba(63, 185, 80, 0.3);
  color: var(--hn-green-light);
}

.hardware-badge.has-gpu ion-icon {
  color: var(--hn-green);
}

.hardware-badge.cpu-only {
  background: var(--hn-warning-muted);
  border-color: rgba(210, 153, 34, 0.3);
  color: var(--hn-warning);
}

.hardware-badge.cpu-only ion-icon {
  color: var(--hn-warning);
}

.hardware-badge.loading {
  color: var(--hn-text-muted);
}

.hardware-badge.loading ion-spinner {
  width: 14px;
  height: 14px;
}

.hardware-badge ion-icon {
  font-size: 1rem;
}

/* Responsive */
@media (max-width: 640px) {
  .provider-cards {
    grid-template-columns: 1fr;
  }
  
  .model-input-row {
    flex-direction: column;
  }
  
  .action-buttons {
    flex-direction: column;
  }
}
</style>
