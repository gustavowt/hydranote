<template>
  <div class="indexer-provider-selector" :class="{ compact, collapsible }">
    <!-- Collapsible toggle (for compact mode) -->
    <button v-if="collapsible" class="indexer-toggle" @click="expanded = !expanded" type="button">
      <ion-icon :icon="searchOutline" />
      <span>Embedding Provider (for search)</span>
      <ion-icon :icon="expanded ? chevronUpOutline : chevronDownOutline" class="chevron" />
    </button>

    <div v-if="!collapsible || expanded" class="indexer-content">
      <p v-if="compact" class="indexer-description">
        Choose a separate provider for document embeddings. By default, we'll use the same provider as your AI chat.
      </p>

      <!-- Main Provider Cards -->
      <div class="provider-cards" :class="{ compact }">
        <button
          v-for="provider in mainIndexerProviders"
          :key="provider.id"
          class="provider-card"
          :class="{ selected: modelValue.provider === provider.id }"
          @click="selectProvider(provider.id)"
          type="button"
        >
          <div class="provider-icon">
            <component :is="provider.iconComponent" />
          </div>
          <div class="provider-info">
            <h3>{{ provider.name }}</h3>
            <p v-if="!compact">{{ provider.description }}</p>
          </div>
          <div v-if="!compact" class="selected-indicator" v-show="modelValue.provider === provider.id">
            <ion-icon :icon="checkmarkCircle" />
          </div>
        </button>
      </div>

      <!-- Advanced Options Section -->
      <div class="advanced-section">
        <button class="advanced-toggle" @click="showAdvancedIndexer = !showAdvancedIndexer" type="button">
          <ion-icon :icon="settingsOutline" />
          <span>Advanced</span>
          <ion-icon :icon="showAdvancedIndexer ? chevronUpOutline : chevronDownOutline" class="chevron" />
        </button>

        <!-- Advanced Indexer Providers (collapsible content) -->
        <div v-if="showAdvancedIndexer" class="advanced-content">
          <div class="experimental-warning">
            <ion-icon :icon="warningOutline" />
            <span>These are experimental options and might not work as expected depending on the chosen model.</span>
          </div>

          <div class="provider-cards" :class="{ compact }">
            <button
              v-for="provider in advancedIndexerProviders"
              :key="provider.id"
              class="provider-card"
              :class="{ selected: modelValue.provider === provider.id }"
              @click="selectProvider(provider.id)"
              type="button"
            >
              <div class="provider-icon">
                <component :is="provider.iconComponent" />
              </div>
              <div class="provider-info">
                <div class="provider-name-row">
                  <h3>{{ provider.name }}</h3>
                  <span v-if="provider.id === 'huggingface_local'" class="experimental-badge">Experimental</span>
                </div>
                <p v-if="!compact">{{ provider.description }}</p>
              </div>
              <div v-if="!compact" class="selected-indicator" v-show="modelValue.provider === provider.id">
                <ion-icon :icon="checkmarkCircle" />
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- OpenAI Indexer Config -->
      <div v-if="modelValue.provider === 'openai'" class="config-panel" :class="{ compact }">
        <div class="config-fields">
          <div class="field-group">
            <label>API Key</label>
            <div class="input-wrapper">
              <input
                :value="modelValue.openai.apiKey"
                @input="updateField('openai', 'apiKey', ($event.target as HTMLInputElement).value)"
                :type="showApiKey ? 'text' : 'password'"
                :placeholder="compact ? 'sk-... (can be same as AI provider)' : 'sk-...'"
              />
              <button class="toggle-visibility" @click="showApiKey = !showApiKey" type="button">
                <ion-icon :icon="showApiKey ? eyeOffOutline : eyeOutline" />
              </button>
            </div>
            <div class="field-actions">
              <button 
                v-if="effectiveLlmApiKeys?.openai && effectiveLlmApiKeys.openai !== modelValue.openai.apiKey"
                class="copy-key-btn"
                @click="copyFromAIProvider('openai')"
                type="button"
              >
                <ion-icon :icon="copyOutline" />
                <span>Copy from AI Provider</span>
              </button>
              <span v-if="!compact" class="field-hint">
                Same key can be used as your AI provider. Get it at
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>
              </span>
            </div>
          </div>

          <div v-if="!compact" class="field-group">
            <label>Embedding Model</label>
            <select
              :value="modelValue.openai.model"
              @change="updateField('openai', 'model', ($event.target as HTMLSelectElement).value)"
            >
              <option value="text-embedding-3-small">text-embedding-3-small (1536 dims)</option>
              <option value="text-embedding-3-large">text-embedding-3-large (3072 dims)</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Gemini Indexer Config -->
      <div v-if="modelValue.provider === 'gemini'" class="config-panel" :class="{ compact }">
        <div class="config-fields">
          <div class="field-group">
            <label>API Key</label>
            <div class="input-wrapper">
              <input
                :value="modelValue.gemini.apiKey"
                @input="updateField('gemini', 'apiKey', ($event.target as HTMLInputElement).value)"
                :type="showApiKey ? 'text' : 'password'"
                :placeholder="compact ? 'AIza... (can be same as AI provider)' : 'AIza...'"
              />
              <button class="toggle-visibility" @click="showApiKey = !showApiKey" type="button">
                <ion-icon :icon="showApiKey ? eyeOffOutline : eyeOutline" />
              </button>
            </div>
            <div class="field-actions">
              <button 
                v-if="effectiveLlmApiKeys?.gemini && effectiveLlmApiKeys.gemini !== modelValue.gemini.apiKey"
                class="copy-key-btn"
                @click="copyFromAIProvider('gemini')"
                type="button"
              >
                <ion-icon :icon="copyOutline" />
                <span>Copy from AI Provider</span>
              </button>
              <span v-if="!compact" class="field-hint">
                Same key can be used as your AI provider. Get it at
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>
              </span>
            </div>
          </div>

          <div v-if="!compact" class="field-group">
            <label>Embedding Model</label>
            <select
              :value="modelValue.gemini.model"
              @change="updateField('gemini', 'model', ($event.target as HTMLSelectElement).value)"
            >
              <option value="text-embedding-004">text-embedding-004 (768 dims)</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Ollama Indexer Config -->
      <div v-if="modelValue.provider === 'ollama'" class="config-panel" :class="{ compact }">
        <div class="config-fields">
          <div class="field-group">
            <label>Ollama URL</label>
            <input
              :value="modelValue.ollama.baseUrl"
              @input="updateField('ollama', 'baseUrl', ($event.target as HTMLInputElement).value)"
              type="text"
              placeholder="http://localhost:11434"
            />
          </div>
          <div class="field-group">
            <label>Embedding Model</label>
            <input
              :value="modelValue.ollama.model"
              @input="updateField('ollama', 'model', ($event.target as HTMLInputElement).value)"
              type="text"
              placeholder="nomic-embed-text"
            />
            <span class="field-hint">Suggested: nomic-embed-text, mxbai-embed-large</span>
          </div>
        </div>
      </div>

      <!-- Hugging Face Local Indexer Config -->
      <div v-if="modelValue.provider === 'huggingface_local'" class="config-panel" :class="{ compact }">
        <div class="config-fields">
          <div class="field-group">
            <label>Embedding Model</label>
            <select
              :value="modelValue.huggingfaceLocal.model"
              @change="updateField('huggingfaceLocal', 'model', ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="model in SUGGESTED_HF_LOCAL_EMBEDDING_MODELS" :key="model.id" :value="model.id">
                {{ model.name }} - {{ model.description }}
              </option>
            </select>
            <span class="field-hint">
              Models are downloaded automatically on first use. No API key required.
            </span>
          </div>

          <!-- Model Loading Status -->
          <div v-if="hfLocalStatus" class="hf-status">
            <div v-if="isHFModelLoading" class="hf-loading">
              <ion-spinner name="crescent" />
              <span>Downloading model... {{ hfModelProgress }}%</span>
              <div class="progress-bar small">
                <div class="progress-fill" :style="{ width: hfModelProgress + '%' }"></div>
              </div>
            </div>
            <div v-else-if="hfLocalStatusComputed?.status === 'ready'" class="hf-ready">
              <ion-icon :icon="checkmarkCircleOutline" />
              <span>Model ready: {{ hfLocalStatusComputed?.loadedModel?.split('/').pop() }}</span>
            </div>
            <div v-else-if="hfLocalStatusComputed?.status === 'error'" class="hf-error">
              <ion-icon :icon="closeCircleOutline" />
              <span>{{ hfLocalStatusComputed?.error }}</span>
            </div>
            <div v-else class="hf-not-loaded">
              <ion-icon :icon="downloadOutline" />
              <span>Model will download on first embedding</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Test & Re-index Actions (full mode only) -->
      <div v-if="!compact && showActions" class="action-buttons">
        <button class="btn btn-secondary" @click="$emit('test-connection')" :disabled="testingConnection" type="button">
          <ion-spinner v-if="testingConnection" name="crescent" />
          <ion-icon v-else :icon="flashOutline" />
          <span>Test Connection</span>
        </button>
        <button class="btn btn-secondary" @click="$emit('reindex-all')" :disabled="reindexing" type="button">
          <ion-spinner v-if="reindexing" name="crescent" />
          <ion-icon v-else :icon="refreshOutline" />
          <span>Re-index All Files</span>
        </button>
        <button class="btn btn-primary" @click="$emit('save')" type="button">
          <ion-icon :icon="saveOutline" />
          <span>Save Settings</span>
        </button>
      </div>

      <!-- Connection Status -->
      <div v-if="connectionStatus" :class="['connection-status', connectionStatus.success ? 'success' : 'error']">
        <ion-icon :icon="connectionStatus.success ? checkmarkCircleOutline : closeCircleOutline" />
        <span>{{ connectionStatus.message }}</span>
      </div>

      <!-- Re-index Status -->
      <div v-if="reindexStatus" :class="['connection-status', reindexStatus.success ? 'success' : 'error']">
        <ion-icon :icon="reindexStatus.success ? checkmarkCircleOutline : closeCircleOutline" />
        <span>{{ reindexStatus.message }}</span>
      </div>

      <!-- Re-index Progress -->
      <div v-if="reindexProgress" class="reindex-progress">
        <div class="progress-header">
          <span>Re-indexing files... {{ reindexProgress.current }}/{{ reindexProgress.total }}</span>
        </div>
        <div class="progress-bar">
          <div 
            class="progress-fill" 
            :style="{ width: ((reindexProgress.current / reindexProgress.total) * 100) + '%' }"
          />
        </div>
        <p v-if="reindexProgress.fileName" class="current-file">{{ reindexProgress.fileName }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { IonIcon, IonSpinner } from '@ionic/vue';
import {
  checkmarkCircle,
  checkmarkCircleOutline,
  closeCircleOutline,
  eyeOutline,
  eyeOffOutline,
  searchOutline,
  chevronUpOutline,
  chevronDownOutline,
  flashOutline,
  refreshOutline,
  saveOutline,
  downloadOutline,
  copyOutline,
  settingsOutline,
  warningOutline,
} from 'ionicons/icons';
import type { IndexerSettings, EmbeddingProvider, HFEmbeddingRuntimeStatus, LLMSettings } from '@/types';
import { SUGGESTED_HF_LOCAL_EMBEDDING_MODELS } from '@/types';
import { OpenAiIcon, GeminiIcon, OllamaIcon, HuggingFaceIcon } from '@/icons';
import { 
  isHuggingFaceLocalAvailable, 
  getHuggingFaceLocalStatus, 
  onHuggingFaceLocalStatusChange 
} from '@/services';

// Props
interface Props {
  modelValue: IndexerSettings;
  compact?: boolean;
  collapsible?: boolean;
  showActions?: boolean;
  // Connection testing
  testingConnection?: boolean;
  connectionStatus?: { success: boolean; message: string } | null;
  // Ollama
  loadingModels?: boolean;
  ollamaModels?: string[];
  // Re-indexing
  reindexing?: boolean;
  reindexProgress?: { current: number; total: number; fileName?: string } | null;
  reindexStatus?: { success: boolean; message: string } | null;
  // HF Local (can be passed from parent or managed internally)
  hfLocalAvailable?: boolean;
  hfLocalStatus?: HFEmbeddingRuntimeStatus | null;
  // AI Provider settings for "Copy from AI Provider" feature
  aiProviderSettings?: LLMSettings;
  // Legacy support: LLM API keys for "Copy from AI Provider" feature
  llmApiKeys?: { openai?: string; gemini?: string };
}

const props = withDefaults(defineProps<Props>(), {
  compact: false,
  collapsible: false,
  showActions: true,
  testingConnection: false,
  connectionStatus: null,
  loadingModels: false,
  ollamaModels: () => [],
  reindexing: false,
  reindexProgress: null,
  reindexStatus: null,
  hfLocalAvailable: undefined, // undefined means manage internally
  hfLocalStatus: undefined, // undefined means manage internally
  aiProviderSettings: undefined,
  llmApiKeys: () => ({}),
});

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: IndexerSettings];
  'test-connection': [];
  'save': [];
  'fetch-ollama-models': [];
  'download-model': [modelId: string];
  'reindex-all': [];
}>();

// Local state
const showApiKey = ref(false);
const expanded = ref(false);
const showAdvancedIndexer = ref(false);

// Internal state for when props are not provided
const internalHfLocalAvailable = ref(false);
const internalHfLocalStatus = ref<HFEmbeddingRuntimeStatus | null>(null);
let unsubscribeStatus: (() => void) | null = null;

// Computed: use props or internal state
const hfLocalAvailableComputed = computed(() => {
  return props.hfLocalAvailable !== undefined ? props.hfLocalAvailable : internalHfLocalAvailable.value;
});

const hfLocalStatusComputed = computed(() => {
  return props.hfLocalStatus !== undefined ? props.hfLocalStatus : internalHfLocalStatus.value;
});

// Advanced provider IDs
const advancedIndexerProviderIds = ['ollama', 'huggingface_local'];

// Initialize internal state only if props not provided
onMounted(async () => {
  // Only manage internal state if props not provided
  if (props.hfLocalAvailable === undefined) {
    internalHfLocalAvailable.value = isHuggingFaceLocalAvailable();
    if (internalHfLocalAvailable.value) {
      internalHfLocalStatus.value = await getHuggingFaceLocalStatus();
      unsubscribeStatus = onHuggingFaceLocalStatusChange((status) => {
        internalHfLocalStatus.value = status;
      });
    }
  }
  // Auto-expand advanced section if an advanced provider is selected
  if (advancedIndexerProviderIds.includes(props.modelValue.provider)) {
    showAdvancedIndexer.value = true;
  }
});

// Watch for provider changes to auto-expand
watch(() => props.modelValue.provider, (newProvider) => {
  if (advancedIndexerProviderIds.includes(newProvider)) {
    showAdvancedIndexer.value = true;
  }
});

onUnmounted(() => {
  if (unsubscribeStatus) {
    unsubscribeStatus();
  }
});

// Computed: is HF model loading?
const isHFModelLoading = computed(() => {
  return hfLocalStatusComputed.value?.status === 'loading';
});

// Computed: HF model loading progress
const hfModelProgress = computed(() => {
  return hfLocalStatusComputed.value?.progress ?? 0;
});

// Computed: API keys from AI provider settings or legacy llmApiKeys
const effectiveLlmApiKeys = computed(() => {
  if (props.aiProviderSettings) {
    return {
      openai: props.aiProviderSettings.openai?.apiKey,
      gemini: props.aiProviderSettings.google?.apiKey,
    };
  }
  return props.llmApiKeys;
});

// Provider type
type ProviderConfig = { id: EmbeddingProvider; name: string; description: string; iconComponent: typeof OpenAiIcon };

// Main provider configurations (cloud-based, well-tested)
const mainIndexerProviders: ProviderConfig[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'text-embedding-3-small/large',
    iconComponent: OpenAiIcon,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'text-embedding-004',
    iconComponent: GeminiIcon,
  },
];

// Advanced provider configurations (local, experimental)
const advancedIndexerProviders = computed(() => {
  const providers: ProviderConfig[] = [
    {
      id: 'ollama',
      name: 'Ollama',
      description: 'nomic-embed-text, mxbai-embed-large',
      iconComponent: OllamaIcon,
    },
  ];

  // Only add HuggingFace local if running in Electron
  if (hfLocalAvailableComputed.value) {
    providers.push({
      id: 'huggingface_local',
      name: 'Hugging Face',
      description: 'Local models (no API needed)',
      iconComponent: HuggingFaceIcon,
    });
  }

  return providers;
});

// Methods
function selectProvider(providerId: EmbeddingProvider) {
  emit('update:modelValue', { ...props.modelValue, provider: providerId });
}

function updateField(provider: 'openai' | 'gemini' | 'ollama' | 'huggingfaceLocal', field: string, value: string) {
  const updated = { ...props.modelValue };
  // Type-safe nested update
  if (provider === 'openai') {
    updated.openai = { ...updated.openai, [field]: value };
  } else if (provider === 'gemini') {
    updated.gemini = { ...updated.gemini, [field]: value };
  } else if (provider === 'ollama') {
    updated.ollama = { ...updated.ollama, [field]: value };
  } else if (provider === 'huggingfaceLocal') {
    updated.huggingfaceLocal = { ...updated.huggingfaceLocal, [field]: value };
  }
  emit('update:modelValue', updated);
}

// Copy API key from LLM settings
function copyFromAIProvider(provider: 'openai' | 'gemini') {
  const key = effectiveLlmApiKeys.value?.[provider];
  if (key) {
    updateField(provider, 'apiKey', key);
  }
}
</script>

<style scoped>
.indexer-provider-selector {
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  border-radius: 12px;
  overflow: hidden;
}

.indexer-provider-selector:not(.collapsible) {
  background: transparent;
  border: none;
  border-radius: 0;
}

/* Collapsible toggle */
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

.indexer-content {
  padding: 0 20px 20px 20px;
}

.collapsible .indexer-content {
  animation: fadeSlideIn 0.2s ease;
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

.indexer-description {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
  margin: 0 0 16px 0;
  line-height: 1.5;
}

/* Provider Cards */
.provider-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.provider-cards.compact {
  grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
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
  padding: 14px 10px;
  gap: 8px;
  text-align: center;
}

.collapsible .provider-card {
  background: var(--hn-bg-deep);
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

.compact .provider-icon {
  width: 36px;
  height: 36px;
}

.provider-card.selected .provider-icon {
  background: var(--hn-purple);
  color: #fff;
}

.provider-icon :deep(svg) {
  width: 28px;
  height: 28px;
}

.compact .provider-icon :deep(svg) {
  width: 20px;
  height: 20px;
}

.provider-info h3 {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--hn-text-primary);
  margin: 0;
}

.compact .provider-info h3 {
  font-size: 0.9rem;
}

.provider-info p {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
  margin: 4px 0 0 0;
}

.compact .provider-info p {
  display: none;
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

.config-panel.compact {
  padding: 16px;
  margin-bottom: 0;
}

.collapsible .config-panel {
  background: var(--hn-bg-deep);
}

.config-fields {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.config-panel.compact .config-fields {
  gap: 12px;
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

/* Field actions container */
.field-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

/* Copy from AI Provider button */
.copy-key-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--hn-purple-muted);
  border: 1px solid var(--hn-purple);
  border-radius: 6px;
  color: var(--hn-purple-light);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.copy-key-btn:hover {
  background: var(--hn-purple);
  color: #fff;
}

.copy-key-btn ion-icon {
  font-size: 0.9rem;
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

/* Connection Status */
.connection-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-radius: 10px;
  font-size: 0.9rem;
  margin-top: 16px;
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

/* Re-index Progress */
.reindex-progress {
  margin-top: 16px;
  padding: 16px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
}

.progress-header {
  margin-bottom: 12px;
  font-size: 0.9rem;
  color: var(--hn-text-primary);
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

.current-file {
  margin: 8px 0 0 0;
  font-size: 0.8rem;
  color: var(--hn-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  flex-wrap: wrap;
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

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Hugging Face Status */
.hf-status {
  margin-top: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
}

.hf-loading,
.hf-ready,
.hf-error,
.hf-not-loaded {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.9rem;
  flex-wrap: wrap;
}

.hf-loading {
  color: var(--hn-purple);
}

.hf-loading ion-spinner {
  width: 18px;
  height: 18px;
}

.hf-loading .progress-bar {
  width: 100%;
  margin-top: 8px;
}

.hf-ready {
  color: var(--hn-green-light);
}

.hf-ready ion-icon {
  font-size: 1.2rem;
}

.hf-error {
  color: var(--hn-danger);
}

.hf-error ion-icon {
  font-size: 1.2rem;
}

.hf-not-loaded {
  color: var(--hn-text-muted);
}

.hf-not-loaded ion-icon {
  font-size: 1.2rem;
}

.progress-bar.small {
  height: 6px;
}

/* Advanced Toggle */
.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 16px;
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  color: var(--hn-text-secondary);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 16px;
}

.collapsible .advanced-toggle {
  background: var(--hn-bg-deep);
}

.advanced-toggle:hover {
  background: var(--hn-bg-elevated);
  border-color: var(--hn-border-strong);
  color: var(--hn-text-primary);
}

.advanced-toggle ion-icon {
  font-size: 1.1rem;
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

/* Experimental Warning */
.experimental-warning {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  background: var(--hn-warning-muted);
  border: 1px solid rgba(210, 153, 34, 0.3);
  border-radius: 8px;
  color: var(--hn-warning);
  font-size: 0.85rem;
  margin-bottom: 16px;
  line-height: 1.5;
}

.experimental-warning ion-icon {
  font-size: 1.2rem;
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
  padding: 2px 6px;
  background: var(--hn-warning-muted);
  border: 1px solid rgba(210, 153, 34, 0.4);
  border-radius: 4px;
  color: var(--hn-warning);
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Responsive */
@media (max-width: 640px) {
  .provider-cards {
    grid-template-columns: 1fr;
  }
  
  .provider-cards.compact {
    grid-template-columns: repeat(auto-fit, minmax(70px, 1fr));
  }
  
  .action-buttons {
    flex-direction: column;
  }
}
</style>
