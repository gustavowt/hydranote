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
          <ion-segment-button value="indexer">
            <ion-icon :icon="searchOutline" />
            <ion-label>Indexer</ion-label>
          </ion-segment-button>
          <ion-segment-button value="instructions">
            <ion-icon :icon="documentTextOutline" />
            <ion-label>AI Instructions</ion-label>
          </ion-segment-button>
          <ion-segment-button value="webresearch">
            <ion-icon :icon="globeOutline" />
            <ion-label>Web Research</ion-label>
          </ion-segment-button>
          <ion-segment-button value="storage">
            <ion-icon :icon="folderOutline" />
            <ion-label>Storage</ion-label>
          </ion-segment-button>
          <ion-segment-button value="mcp" v-if="isMcpAvailable">
            <ion-icon :icon="serverOutline" />
            <ion-label>MCP Server</ion-label>
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
              :class="{ active: activeSection === 'indexer' }"
              @click="activeSection = 'indexer'"
            >
              <ion-icon :icon="searchOutline" />
              <span>Indexer</span>
            </button>
            <button 
              class="nav-item" 
              :class="{ active: activeSection === 'instructions' }"
              @click="activeSection = 'instructions'"
            >
              <ion-icon :icon="documentTextOutline" />
              <span>AI Instructions</span>
            </button>
            <button 
              class="nav-item" 
              :class="{ active: activeSection === 'webresearch' }"
              @click="activeSection = 'webresearch'"
            >
              <ion-icon :icon="globeOutline" />
              <span>Web Research</span>
            </button>
            <button 
              class="nav-item" 
              :class="{ active: activeSection === 'storage' }"
              @click="activeSection = 'storage'"
            >
              <ion-icon :icon="folderOutline" />
              <span>Storage</span>
            </button>
            <button 
              v-if="isMcpAvailable"
              class="nav-item" 
              :class="{ active: activeSection === 'mcp' }"
              @click="activeSection = 'mcp'"
            >
              <ion-icon :icon="serverOutline" />
              <span>MCP Server</span>
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
                <div class="provider-icon">
                  <component :is="provider.iconComponent" />
                </div>
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
                    <optgroup label="Previous">
                      <option value="gpt-4-turbo">GPT-4 Turbo</option>
                      <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                    </optgroup>
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

            <!-- Anthropic (Claude) Configuration -->
            <div v-if="settings.provider === 'anthropic'" class="config-panel">
              <h3 class="config-title">Claude Configuration</h3>
              <div class="config-fields">
                <div class="field-group">
                  <label>API Key</label>
                  <div class="input-wrapper">
                    <input
                      v-model="settings.anthropic.apiKey"
                      :type="showAnthropicApiKey ? 'text' : 'password'"
                      placeholder="sk-ant-..."
                    />
                    <button class="toggle-visibility" @click="showAnthropicApiKey = !showAnthropicApiKey">
                      <ion-icon :icon="showAnthropicApiKey ? eyeOffOutline : eyeOutline" />
                    </button>
                  </div>
                  <span class="field-hint">
                    Create an API key at 
                    <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">
                      console.anthropic.com
                    </a>
                  </span>
                </div>

                <div class="field-group">
                  <label>Model</label>
                  <select v-model="settings.anthropic.model">
                    <optgroup label="Claude 4 (2025)">
                      <option value="claude-opus-4-5-20251101">Claude Opus 4.5 (Most Powerful)</option>
                      <option value="claude-opus-4-1-20250805">Claude Opus 4.1</option>
                      <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                    </optgroup>
                    <optgroup label="Claude 3.5 (2024)">
                      <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                      <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku (Fast)</option>
                    </optgroup>
                    <optgroup label="Claude 3">
                      <option value="claude-3-opus-20240229">Claude 3 Opus</option>
                      <option value="claude-3-sonnet-20240229">Claude 3 Sonnet</option>
                      <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
                    </optgroup>
                  </select>
                </div>
              </div>
            </div>

            <!-- Google (Gemini) Configuration -->
            <div v-if="settings.provider === 'google'" class="config-panel">
              <h3 class="config-title">Gemini Configuration</h3>
              <div class="config-fields">
                <div class="field-group">
                  <label>API Key</label>
                  <div class="input-wrapper">
                    <input
                      v-model="settings.google.apiKey"
                      :type="showGoogleApiKey ? 'text' : 'password'"
                      placeholder="AIza..."
                    />
                    <button class="toggle-visibility" @click="showGoogleApiKey = !showGoogleApiKey">
                      <ion-icon :icon="showGoogleApiKey ? eyeOffOutline : eyeOutline" />
                    </button>
                  </div>
                  <span class="field-hint">
                    Create an API key at 
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">
                      Google AI Studio
                    </a>
                  </span>
                </div>

                <div class="field-group">
                  <label>Model</label>
                  <select v-model="settings.google.model">
                    <optgroup label="Gemini 2.5 (2025)">
                      <option value="gemini-2.5-pro">Gemini 2.5 Pro (Most Powerful)</option>
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                      <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite (Fastest)</option>
                    </optgroup>
                    <optgroup label="Gemini 2.0">
                      <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                      <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash (Experimental)</option>
                    </optgroup>
                    <optgroup label="Gemini 1.5">
                      <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                      <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                      <option value="gemini-1.5-flash-8b">Gemini 1.5 Flash 8B</option>
                    </optgroup>
                  </select>
                </div>
              </div>
            </div>

            <!-- Local Model Configuration -->
            <div v-if="settings.provider === 'huggingface_local'" class="config-panel">
              <h3 class="config-title">Local Model Configuration</h3>
              
              <div v-if="!localModelsAvailable" class="notice warning">
                <ion-icon :icon="alertCircleOutline" />
                <span>Local models are only available in the desktop (Electron) app.</span>
              </div>

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
                        selected: settings.huggingfaceLocal?.modelId === model.id,
                        downloading: model.state === 'downloading'
                      }"
                      @click="selectLocalModel(model)"
                      :disabled="model.state !== 'installed'"
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
                        v-else-if="settings.huggingfaceLocal?.modelId === model.id"
                        :icon="checkmarkOutline"
                        class="check-icon"
                      />
                      <button 
                        class="remove-model-btn" 
                        @click.stop="handleRemoveModel(model.id)"
                        title="Remove model"
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
                    <button class="cancel-btn" @click="handleCancelDownload">Cancel</button>
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
                        <span class="catalog-name">{{ model.name }}</span>
                        <span class="catalog-desc">{{ model.description }}</span>
                      </div>
                      <button 
                        class="btn btn-small"
                        @click="handleInstallModel(model)"
                        :disabled="installingModel !== null || isModelInstalled(model.id)"
                      >
                        <ion-spinner v-if="installingModel === model.id" name="crescent" />
                        <span v-else-if="isModelInstalled(model.id)">Installed</span>
                        <span v-else>Download</span>
                      </button>
                    </div>
                  </div>
                </div>

                <!-- HuggingFace Token (for gated models) -->
                <div class="field-group">
                  <label>Hugging Face Token (Optional)</label>
                  <div class="input-wrapper">
                    <input
                      v-model="localModelToken"
                      :type="showHfToken ? 'text' : 'password'"
                      placeholder="hf_..."
                    />
                    <button class="toggle-visibility" @click="showHfToken = !showHfToken">
                      <ion-icon :icon="showHfToken ? eyeOffOutline : eyeOutline" />
                    </button>
                  </div>
                  <span class="field-hint">
                    Required for gated/private models. Get your token at
                    <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener">
                      huggingface.co/settings/tokens
                    </a>
                  </span>
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

          <!-- Indexer Section -->
          <section v-if="activeSection === 'indexer'" class="content-section">
            <h2 class="section-title">Indexer</h2>
            <p class="section-description">
              Configure the embedding provider for semantic search and document indexing. 
              This is separate from your AI provider—you can mix and match (e.g., use Claude for chat + OpenAI for embeddings).
            </p>

            <!-- Indexer Provider Cards -->
            <div class="provider-cards">
              <button
                v-for="provider in indexerProviders"
                :key="provider.id"
                class="provider-card"
                :class="{ selected: indexerSettings.provider === provider.id }"
                @click="indexerSettings.provider = provider.id"
              >
                <div class="provider-icon">
                  <component :is="provider.iconComponent" />
                </div>
                <div class="provider-info">
                  <h3>{{ provider.name }}</h3>
                  <p>{{ provider.description }}</p>
                </div>
                <div class="selected-indicator" v-if="indexerSettings.provider === provider.id">
                  <ion-icon :icon="checkmarkCircle" />
                </div>
              </button>
            </div>

            <!-- OpenAI Embedding Configuration -->
            <div v-if="indexerSettings.provider === 'openai'" class="config-panel">
              <h3 class="config-title">OpenAI Embedding Configuration</h3>
              <div class="config-fields">
                <div class="field-group">
                  <label>API Key</label>
                  <div class="input-wrapper">
                    <input
                      v-model="indexerSettings.openai.apiKey"
                      :type="showIndexerOpenAIKey ? 'text' : 'password'"
                      placeholder="sk-..."
                    />
                    <button class="toggle-visibility" @click="showIndexerOpenAIKey = !showIndexerOpenAIKey">
                      <ion-icon :icon="showIndexerOpenAIKey ? eyeOffOutline : eyeOutline" />
                    </button>
                  </div>
                  <span class="field-hint">
                    Can be the same or different from your AI Provider API key.
                    <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">
                      Get an API key
                    </a>
                  </span>
                </div>

                <div class="field-group">
                  <label>Embedding Model</label>
                  <select v-model="indexerSettings.openai.model">
                    <option value="text-embedding-3-small">text-embedding-3-small (1536 dims, efficient)</option>
                    <option value="text-embedding-3-large">text-embedding-3-large (3072 dims, highest quality)</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Gemini Embedding Configuration -->
            <div v-if="indexerSettings.provider === 'gemini'" class="config-panel">
              <h3 class="config-title">Gemini Embedding Configuration</h3>
              <div class="config-fields">
                <div class="field-group">
                  <label>API Key</label>
                  <div class="input-wrapper">
                    <input
                      v-model="indexerSettings.gemini.apiKey"
                      :type="showIndexerGeminiKey ? 'text' : 'password'"
                      placeholder="AIza..."
                    />
                    <button class="toggle-visibility" @click="showIndexerGeminiKey = !showIndexerGeminiKey">
                      <ion-icon :icon="showIndexerGeminiKey ? eyeOffOutline : eyeOutline" />
                    </button>
                  </div>
                  <span class="field-hint">
                    Can be the same or different from your AI Provider API key.
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">
                      Get an API key
                    </a>
                  </span>
                </div>

                <div class="field-group">
                  <label>Embedding Model</label>
                  <select v-model="indexerSettings.gemini.model">
                    <option value="text-embedding-004">text-embedding-004 (768 dims, latest)</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Ollama Embedding Configuration -->
            <div v-if="indexerSettings.provider === 'ollama'" class="config-panel">
              <h3 class="config-title">Ollama Embedding Configuration</h3>
              <div class="config-fields">
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
                  <div class="model-input-row">
                    <input
                      v-model="indexerSettings.ollama.model"
                      type="text"
                      placeholder="nomic-embed-text"
                    />
                    <button 
                      class="fetch-models-btn" 
                      @click="fetchOllamaEmbeddingModels" 
                      :disabled="loadingEmbeddingModels"
                    >
                      <ion-spinner v-if="loadingEmbeddingModels" name="crescent" />
                      <span v-else>Fetch Models</span>
                    </button>
                  </div>
                  <span class="field-hint">
                    Suggested models: nomic-embed-text, mxbai-embed-large, all-minilm
                  </span>
                </div>

                <!-- Available Embedding Models -->
                <div v-if="ollamaEmbeddingModels.length > 0" class="field-group">
                  <label>Available Models</label>
                  <div class="models-list">
                    <button 
                      v-for="model in ollamaEmbeddingModels" 
                      :key="model"
                      class="model-item"
                      :class="{ selected: indexerSettings.ollama.model === model }"
                      @click="selectOllamaEmbeddingModel(model)"
                    >
                      <ion-icon :icon="cubeOutline" />
                      <span>{{ model }}</span>
                      <ion-icon 
                        v-if="indexerSettings.ollama.model === model" 
                        :icon="checkmarkOutline" 
                        class="check-icon"
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Indexer Connection Status -->
            <div v-if="indexerStatus" :class="['connection-status', indexerStatus.success ? 'success' : 'error']">
              <ion-icon :icon="indexerStatus.success ? checkmarkCircleOutline : closeCircleOutline" />
              <span>{{ indexerStatus.message }}</span>
            </div>

            <!-- Re-indexing Section -->
            <div class="config-panel">
              <h3 class="config-title">Re-index Documents</h3>
              <p class="section-description" style="margin-bottom: 16px; font-size: 0.9rem;">
                Re-generate embeddings for all documents. Useful after changing embedding providers or if search results seem stale.
              </p>
              
              <!-- Re-index Progress -->
              <div v-if="reindexProgress" class="reindex-progress">
                <div class="progress-info">
                  <span>{{ reindexProgress.current }} / {{ reindexProgress.total }}</span>
                  <span class="progress-file">{{ reindexProgress.fileName }}</span>
                </div>
                <div class="progress-bar">
                  <div 
                    class="progress-fill" 
                    :style="{ width: `${(reindexProgress.current / reindexProgress.total) * 100}%` }"
                  />
                </div>
              </div>

              <!-- Re-index Status -->
              <div v-if="reindexStatus" :class="['connection-status', reindexStatus.success ? 'success' : 'error']">
                <ion-icon :icon="reindexStatus.success ? checkmarkCircleOutline : closeCircleOutline" />
                <span>{{ reindexStatus.message }}</span>
              </div>

              <button 
                class="btn btn-secondary" 
                @click="handleReindexAll" 
                :disabled="reindexing"
                style="margin-top: 12px;"
              >
                <ion-spinner v-if="reindexing" name="crescent" />
                <ion-icon v-else :icon="refreshOutline" />
                <span>Re-index All Files</span>
              </button>
            </div>

            <!-- Action Buttons -->
            <div class="action-buttons">
              <button class="btn btn-secondary" @click="handleTestIndexer" :disabled="testingIndexer">
                <ion-spinner v-if="testingIndexer" name="crescent" />
                <ion-icon v-else :icon="flashOutline" />
                <span>Test Connection</span>
              </button>
              <button class="btn btn-primary" @click="handleSaveIndexer">
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

          <!-- Web Research Section -->
          <section v-if="activeSection === 'webresearch'" class="content-section">
            <h2 class="section-title">Web Research</h2>
            <p class="section-description">Configure web search to get information from the internet.</p>

            <div class="config-panel">
              <h3 class="config-title">Search Provider</h3>
              <div class="config-fields">
                <!-- Provider Selection -->
                <div class="provider-cards">
                  <button
                    v-for="provider in webSearchProviders"
                    :key="provider.id"
                    class="provider-card small"
                    :class="{ selected: webSearchSettings.provider === provider.id }"
                    @click="webSearchSettings.provider = provider.id"
                  >
                    <div class="provider-icon">
                      <component :is="provider.iconComponent" />
                    </div>
                    <div class="provider-info">
                      <h3>{{ provider.name }}</h3>
                      <p>{{ provider.description }}</p>
                    </div>
                    <div class="selected-indicator" v-if="webSearchSettings.provider === provider.id">
                      <ion-icon :icon="checkmarkCircle" />
                    </div>
                  </button>
                </div>

                <!-- SearXNG Configuration -->
                <div v-if="webSearchSettings.provider === 'searxng'" class="field-group">
                  <label>SearXNG Instance URL</label>
                  <input
                    v-model="webSearchSettings.searxngUrl"
                    type="text"
                    placeholder="https://searx.example.com"
                  />
                  <span class="field-hint">
                    URL of your SearXNG instance. You can use a public instance or 
                    <a href="https://docs.searxng.org/admin/installation.html" target="_blank" rel="noopener">self-host one</a>.
                  </span>
                </div>

                <!-- Brave API Key Configuration -->
                <div v-if="webSearchSettings.provider === 'brave'" class="field-group">
                  <label>Brave Search API Key</label>
                  <div class="input-wrapper">
                    <input
                      v-model="webSearchSettings.braveApiKey"
                      :type="showBraveApiKey ? 'text' : 'password'"
                      placeholder="BSA..."
                    />
                    <button class="toggle-visibility" @click="showBraveApiKey = !showBraveApiKey">
                      <ion-icon :icon="showBraveApiKey ? eyeOffOutline : eyeOutline" />
                    </button>
                  </div>
                  <span class="field-hint">
                    Get a free API key at 
                    <a href="https://brave.com/search/api/" target="_blank" rel="noopener">brave.com/search/api</a>
                    (2000 queries/month free).
                  </span>
                </div>

                <!-- DuckDuckGo Notice -->
                <div v-if="webSearchSettings.provider === 'duckduckgo'" class="connection-status success">
                  <ion-icon :icon="checkmarkCircleOutline" />
                  <span>DuckDuckGo Instant Answers API requires no configuration.</span>
                </div>
              </div>
            </div>

            <div class="config-panel">
              <h3 class="config-title">Search Settings</h3>
              <div class="config-fields">
                <!-- Max Results -->
                <div class="field-group">
                  <label>Maximum Results per Search</label>
                  <select v-model.number="webSearchSettings.maxResults">
                    <option :value="3">3 results</option>
                    <option :value="5">5 results (default)</option>
                    <option :value="10">10 results</option>
                  </select>
                </div>

                <!-- Cache Max Age -->
                <div class="field-group">
                  <label>Cache Duration (minutes)</label>
                  <select v-model.number="webSearchSettings.cacheMaxAge">
                    <option :value="30">30 minutes</option>
                    <option :value="60">1 hour (default)</option>
                    <option :value="120">2 hours</option>
                    <option :value="360">6 hours</option>
                  </select>
                  <span class="field-hint">
                    Cached results will be reused within this time window.
                  </span>
                </div>
              </div>
            </div>

            <!-- Web Search Status -->
            <div v-if="webSearchStatus" :class="['connection-status', webSearchStatus.success ? 'success' : 'error']">
              <div class="status-content">
                <div class="status-header">
                  <ion-icon :icon="webSearchStatus.success ? checkmarkCircleOutline : closeCircleOutline" />
                  <span>{{ webSearchStatus.message }}</span>
                </div>
                <div v-if="webSearchStatus.details" class="status-details">
                  {{ webSearchStatus.details }}
                </div>
                <ul v-if="webSearchStatus.suggestions && webSearchStatus.suggestions.length > 0" class="status-suggestions">
                  <li v-for="(suggestion, idx) in webSearchStatus.suggestions" :key="idx">
                    {{ suggestion }}
                  </li>
                </ul>
              </div>
            </div>

            <!-- Action Buttons -->
            <div class="action-buttons">
              <button class="btn btn-secondary" @click="handleTestWebSearch" :disabled="testingWebSearch">
                <ion-spinner v-if="testingWebSearch" name="crescent" />
                <ion-icon v-else :icon="searchOutline" />
                <span>Test Search</span>
              </button>
              <button class="btn btn-secondary" @click="handleClearWebCache" :disabled="clearingCache">
                <ion-spinner v-if="clearingCache" name="crescent" />
                <ion-icon v-else :icon="trashOutline" />
                <span>Clear Cache</span>
              </button>
              <button class="btn btn-primary" @click="handleSaveWebSearch">
                <ion-icon :icon="saveOutline" />
                <span>Save Settings</span>
              </button>
            </div>
          </section>

          <!-- Storage Section -->
          <section v-if="activeSection === 'storage'" class="content-section">
            <h2 class="section-title">Storage</h2>
            <p class="section-description">Configure file system sync to keep your notes as files on your computer.</p>

            <!-- Browser Support Warning -->
            <div v-if="!isFileSystemSupported" class="connection-status error">
              <ion-icon :icon="alertCircleOutline" />
              <span>File System Access API is not supported in this browser. Please use Chrome, Edge, or Opera for file system sync.</span>
            </div>

            <div v-else class="config-panel">
              <div class="config-fields">
                <!-- Enable Sync Toggle -->
                <div class="field-group toggle-field">
                  <div class="toggle-info">
                    <label>Enable File System Sync</label>
                    <span class="toggle-description">Mirror your projects and notes to a folder on your computer</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="fsSettings.enabled" @change="handleFsToggle" />
                    <span class="slider"></span>
                  </label>
                </div>

                <!-- Root Directory Selection -->
                <div class="field-group">
                  <label>Root Directory</label>
                  <div class="directory-picker">
                    <div class="directory-display" :class="{ connected: fsSettings.rootPath }">
                      <ion-icon :icon="fsSettings.rootPath ? folderOpenOutline : folderOutline" />
                      <span v-if="fsSettings.rootPath">{{ fsSettings.rootPath }}</span>
                      <span v-else class="placeholder">No directory selected</span>
                    </div>
                    <button 
                      class="btn btn-secondary" 
                      @click="handleSelectDirectory"
                      :disabled="selectingDirectory"
                    >
                      <ion-spinner v-if="selectingDirectory" name="crescent" />
                      <ion-icon v-else :icon="folderOutline" />
                      <span>{{ fsSettings.rootPath ? 'Change' : 'Select' }}</span>
                    </button>
                  </div>
                  <span class="field-hint">
                    Each project will be created as a subdirectory with its files inside.
                  </span>
                </div>

                <!-- Sync on Save Toggle -->
                <div class="field-group toggle-field">
                  <div class="toggle-info">
                    <label>Sync on Save</label>
                    <span class="toggle-description">Automatically sync files when you save changes</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="fsSettings.syncOnSave" :disabled="!fsSettings.enabled" />
                    <span class="slider"></span>
                  </label>
                </div>

                <!-- Watch for Changes Toggle -->
                <div class="field-group toggle-field">
                  <div class="toggle-info">
                    <label>Watch for External Changes</label>
                    <span class="toggle-description">Detect when files are modified outside HydraNote</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="fsSettings.watchForChanges" :disabled="!fsSettings.enabled" />
                    <span class="slider"></span>
                  </label>
                </div>

                <!-- Last Sync Time -->
                <div v-if="fsSettings.lastSyncTime" class="field-group">
                  <label>Last Sync</label>
                  <div class="last-sync-info">
                    <ion-icon :icon="timeOutline" />
                    <span>{{ formatLastSyncTime(fsSettings.lastSyncTime) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Sync Status -->
            <div v-if="syncStatus" :class="['connection-status', syncStatus.success ? 'success' : 'error']">
              <ion-icon :icon="syncStatus.success ? checkmarkCircleOutline : closeCircleOutline" />
              <span>{{ syncStatus.message }}</span>
            </div>

            <!-- Action Buttons -->
            <div class="action-buttons" v-if="isFileSystemSupported">
              <button 
                class="btn btn-secondary" 
                @click="handleSyncNow" 
                :disabled="!fsSettings.enabled || syncing"
              >
                <ion-spinner v-if="syncing" name="crescent" />
                <ion-icon v-else :icon="syncOutline" />
                <span>Sync Now</span>
              </button>
              <button 
                v-if="fsSettings.rootPath"
                class="btn btn-danger" 
                @click="handleDisconnect"
              >
                <ion-icon :icon="unlinkOutline" />
                <span>Disconnect</span>
              </button>
              <button class="btn btn-primary" @click="handleSaveStorage">
                <ion-icon :icon="saveOutline" />
                <span>Save Settings</span>
              </button>
            </div>
          </section>

          <!-- MCP Server Section -->
          <section v-if="activeSection === 'mcp'" class="content-section">
            <h2 class="section-title">MCP Server</h2>
            <p class="section-description">Expose HydraNote capabilities via the Model Context Protocol (MCP) for integration with external LLM tools.</p>

            <!-- Only available in Electron -->
            <div v-if="!isMcpAvailable" class="connection-status error">
              <ion-icon :icon="alertCircleOutline" />
              <span>MCP Server is only available in the Electron desktop app.</span>
            </div>

            <div v-else class="config-panel">
              <div class="config-fields">
                <!-- Enable MCP Server Toggle -->
                <div class="field-group toggle-field">
                  <div class="toggle-info">
                    <label>Enable MCP Server</label>
                    <span class="toggle-description">Start a local MCP server for external tool integration</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="mcpSettings.enabled" @change="handleMcpToggle" />
                    <span class="slider"></span>
                  </label>
                </div>

                <!-- Server Status -->
                <div v-if="mcpSettings.enabled" class="field-group">
                  <label>Server Status</label>
                  <div class="connection-status" :class="mcpServerRunning ? 'success' : 'warning'">
                    <ion-icon :icon="mcpServerRunning ? checkmarkCircleOutline : alertCircleOutline" />
                    <span>{{ mcpServerRunning ? 'Running' : 'Stopped' }}</span>
                    <span class="status-url" v-if="mcpServerRunning">http://127.0.0.1:{{ mcpSettings.port }}/mcp</span>
                  </div>
                </div>

                <!-- Port Configuration -->
                <div class="field-group">
                  <label>Port</label>
                  <div class="input-wrapper">
                    <input
                      v-model.number="mcpSettings.port"
                      type="number"
                      min="1024"
                      max="65535"
                      placeholder="3847"
                    />
                  </div>
                  <span class="field-hint">
                    Default port is 3847. Only listens on localhost (127.0.0.1).
                  </span>
                </div>

                <!-- Bearer Token -->
                <div class="field-group">
                  <label>Bearer Token</label>
                  <div class="input-wrapper">
                    <input
                      v-model="mcpSettings.bearerToken"
                      :type="showMcpToken ? 'text' : 'password'"
                      placeholder="Click 'Generate Token' to create one"
                      readonly
                    />
                    <button class="toggle-visibility" @click="showMcpToken = !showMcpToken">
                      <ion-icon :icon="showMcpToken ? eyeOffOutline : eyeOutline" />
                    </button>
                    <button class="btn btn-icon" @click="copyMcpToken" title="Copy token">
                      <ion-icon :icon="copyOutline" />
                    </button>
                  </div>
                  <div class="button-row" style="margin-top: 8px;">
                    <button class="btn btn-secondary" @click="handleGenerateToken" :disabled="generatingToken">
                      <ion-spinner v-if="generatingToken" name="crescent" />
                      <ion-icon v-else :icon="refreshOutline" />
                      <span>Generate Token</span>
                    </button>
                  </div>
                  <span class="field-hint">
                    This token is required for authentication. Keep it secret.
                  </span>
                </div>

                <!-- Download Configuration -->
                <div class="field-group">
                  <label>MCP Configuration</label>
                  <p class="field-hint" style="margin-bottom: 8px;">
                    Download the configuration file to use with MCP clients (Claude Desktop, etc.)
                  </p>
                  <button class="btn btn-primary" @click="handleDownloadMcpConfig" :disabled="!mcpSettings.bearerToken">
                    <ion-icon :icon="downloadOutline" />
                    <span>Download MCP Config</span>
                  </button>
                </div>

                <!-- Available Tools Info -->
                <div class="field-group">
                  <label>Available Tools</label>
                  <div class="tools-list">
                    <div class="tool-item">
                      <code>list_projects</code>
                      <span>List all projects/workspaces</span>
                    </div>
                    <div class="tool-item">
                      <code>get_project</code>
                      <span>Get project details</span>
                    </div>
                    <div class="tool-item">
                      <code>list_files</code>
                      <span>List files in a project</span>
                    </div>
                    <div class="tool-item">
                      <code>read_file</code>
                      <span>Read file content</span>
                    </div>
                    <div class="tool-item">
                      <code>search</code>
                      <span>Semantic search across documents</span>
                    </div>
                    <div class="tool-item">
                      <code>create_note</code>
                      <span>Create a new note</span>
                    </div>
                  </div>
                </div>

                <!-- MCP Status -->
                <div v-if="mcpStatus" class="connection-status" :class="mcpStatus.success ? 'success' : 'error'">
                  <ion-icon :icon="mcpStatus.success ? checkmarkCircleOutline : closeCircleOutline" />
                  <span>{{ mcpStatus.message }}</span>
                </div>
              </div>

              <!-- Save Button -->
              <div class="action-buttons">
                <button class="btn btn-primary" @click="handleSaveMcp">
                  <ion-icon :icon="saveOutline" />
                  <span>Save Settings</span>
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
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
  folderOutline,
  folderOpenOutline,
  syncOutline,
  timeOutline,
  alertCircleOutline,
  unlinkOutline,
  globeOutline,
  searchOutline,
  trashOutline,
  refreshOutline,
  serverOutline,
  copyOutline,
  downloadOutline,
} from 'ionicons/icons';
import type { LLMSettings, LLMProvider, FileSystemSettings, WebSearchSettings, WebSearchProvider, IndexerSettings, EmbeddingProvider, LocalModel, HFModelRef, ModelDownloadProgress, RuntimeStatus } from '@/types';
import { DEFAULT_LLM_SETTINGS, DEFAULT_FILESYSTEM_SETTINGS, DEFAULT_WEB_SEARCH_SETTINGS, DEFAULT_INDEXER_SETTINGS } from '@/types';
import { 
  OpenAiIcon, 
  ClaudeIcon, 
  GeminiIcon, 
  OllamaIcon,
  HuggingFaceIcon,
  SearxngIcon,
  BraveIcon,
  DuckDuckGoIcon,
} from '@/icons';
import { 
  loadSettings, 
  saveSettings, 
  testConnection, 
  getOllamaModels,
  loadFileSystemSettings,
  saveFileSystemSettings,
  isFileSystemAccessSupported,
  selectRootDirectory,
  disconnectRootDirectory,
  syncAll,
  startFileWatcher,
  stopFileWatcher,
  loadWebSearchSettings,
  saveWebSearchSettings,
  testWebSearchConnection,
  clearWebSearchCache,
  // Indexer settings
  loadIndexerSettings,
  saveIndexerSettings,
  testIndexerConnection,
  reindexAllFiles,
  // MCP settings
  loadMCPSettings,
  saveMCPSettings,
  generateMCPToken,
  getMCPServerStatus,
  generateMCPConfig,
  isMCPAvailable,
  // Local models
  isLocalModelsAvailable,
  getInstalledModels,
  getModelCatalog,
  installModel,
  removeModel,
  cancelInstallation,
  onDownloadProgress,
  getRuntimeStatus,
  loadLocalModelSettings,
  saveLocalModelSettings,
  loadModel,
  unloadModel,
  formatFileSize,
  formatSpeed,
  formatEta,
  getProgressPercent,
} from '@/services';
import type { MCPSettings } from '@/services';

// Provider configurations for modularity
const providerConfigs: { id: LLMProvider; name: string; description: string; iconComponent: typeof OpenAiIcon }[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4.1, o3, GPT-4o series',
    iconComponent: OpenAiIcon,
  },
  {
    id: 'anthropic',
    name: 'Claude',
    description: 'Claude 4 Opus, Sonnet, 3.5 series',
    iconComponent: ClaudeIcon,
  },
  {
    id: 'google',
    name: 'Gemini',
    description: 'Gemini 2.5 Pro, Flash, 2.0 series',
    iconComponent: GeminiIcon,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local LLMs: Llama, Mistral, etc.',
    iconComponent: OllamaIcon,
  },
  {
    id: 'huggingface_local',
    name: 'Local Model',
    description: 'Run Hugging Face GGUF models locally',
    iconComponent: HuggingFaceIcon,
  },
];

const activeSection = ref<'providers' | 'indexer' | 'instructions' | 'webresearch' | 'storage' | 'mcp'>('providers');
const settings = ref<LLMSettings>({ ...DEFAULT_LLM_SETTINGS });
const testing = ref(false);
const loadingModels = ref(false);
const ollamaModels = ref<string[]>([]);
const connectionStatus = ref<{ success: boolean; message: string } | null>(null);
const showApiKey = ref(false);
const showAnthropicApiKey = ref(false);
const showGoogleApiKey = ref(false);

// Storage section state
const fsSettings = ref<FileSystemSettings>({ ...DEFAULT_FILESYSTEM_SETTINGS });
const isFileSystemSupported = ref(false);
const selectingDirectory = ref(false);
const syncing = ref(false);
const syncStatus = ref<{ success: boolean; message: string } | null>(null);

// Web Search section state
const webSearchSettings = ref<WebSearchSettings>({ ...DEFAULT_WEB_SEARCH_SETTINGS });
const showBraveApiKey = ref(false);
const testingWebSearch = ref(false);
const clearingCache = ref(false);
const webSearchStatus = ref<{ 
  success: boolean; 
  message: string; 
  details?: string;
  suggestions?: string[];
} | null>(null);

// Web search provider configurations
const webSearchProviders: { id: WebSearchProvider; name: string; description: string; iconComponent: typeof SearxngIcon }[] = [
  {
    id: 'searxng',
    name: 'SearXNG',
    description: 'Self-hosted, private meta-search',
    iconComponent: SearxngIcon,
  },
  {
    id: 'brave',
    name: 'Brave Search',
    description: 'Privacy-focused, 2000 free queries/month',
    iconComponent: BraveIcon,
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    description: 'Instant Answers API, no setup required',
    iconComponent: DuckDuckGoIcon,
  },
];

// Indexer (embedding) provider configurations
const indexerProviders: { id: EmbeddingProvider; name: string; description: string; iconComponent: typeof OpenAiIcon }[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'text-embedding-3-small/large',
    iconComponent: OpenAiIcon,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'text-embedding-004 (768 dims)',
    iconComponent: GeminiIcon,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local: nomic-embed-text, mxbai, etc.',
    iconComponent: OllamaIcon,
  },
];

// Indexer section state
const indexerSettings = ref<IndexerSettings>({ ...DEFAULT_INDEXER_SETTINGS });
const showIndexerOpenAIKey = ref(false);
const showIndexerGeminiKey = ref(false);
const loadingEmbeddingModels = ref(false);
const ollamaEmbeddingModels = ref<string[]>([]);
const testingIndexer = ref(false);
const indexerStatus = ref<{ success: boolean; message: string } | null>(null);

// Re-indexing state
const reindexing = ref(false);
const reindexProgress = ref<{ current: number; total: number; fileName: string } | null>(null);
const reindexStatus = ref<{ success: boolean; message: string } | null>(null);

// MCP Server section state
const isMcpAvailable = ref(false);
const mcpSettings = ref<MCPSettings>({
  enabled: false,
  port: 3847,
  bearerToken: '',
});
const showMcpToken = ref(false);
const generatingToken = ref(false);
const mcpServerRunning = ref(false);
const mcpStatus = ref<{ success: boolean; message: string } | null>(null);

// Local Models section state
const localModelsAvailable = ref(false);
const installedModels = ref<LocalModel[]>([]);
const modelCatalog = ref<HFModelRef[]>([]);
const loadingLocalModels = ref(false);
const downloadProgress = ref<ModelDownloadProgress | null>(null);
const runtimeStatus = ref<RuntimeStatus | null>(null);
const installingModel = ref<string | null>(null);
const loadingModel = ref(false);
const showHfToken = ref(false);
let progressUnsubscribe: (() => void) | null = null;

// Local model token (stored separately from settings for security)
const localModelToken = ref('');

onMounted(async () => {
  settings.value = loadSettings();
  fsSettings.value = loadFileSystemSettings();
  webSearchSettings.value = loadWebSearchSettings();
  indexerSettings.value = loadIndexerSettings();
  isFileSystemSupported.value = isFileSystemAccessSupported();

  // Start file watcher if enabled
  if (fsSettings.value.enabled && fsSettings.value.watchForChanges) {
    startFileWatcher();
  }

  // Load MCP settings if available
  isMcpAvailable.value = isMCPAvailable();
  if (isMcpAvailable.value) {
    mcpSettings.value = await loadMCPSettings();
    const status = await getMCPServerStatus();
    mcpServerRunning.value = status.running;
  }

  // Load local models if available
  localModelsAvailable.value = isLocalModelsAvailable();
  if (localModelsAvailable.value) {
    await loadLocalModelsData();
    
    // Subscribe to download progress
    progressUnsubscribe = onDownloadProgress((progress) => {
      downloadProgress.value = progress;
      if (progress.status === 'completed') {
        downloadProgress.value = null;
        installingModel.value = null;
        loadLocalModelsData(); // Refresh the list
      }
    });

    // Load settings including token
    const localSettings = await loadLocalModelSettings();
    localModelToken.value = localSettings.huggingFaceToken || '';
  }
});

onUnmounted(() => {
  // Stop file watcher when leaving settings
  stopFileWatcher();
  
  // Unsubscribe from download progress
  if (progressUnsubscribe) {
    progressUnsubscribe();
    progressUnsubscribe = null;
  }
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

// Storage section handlers
async function handleSelectDirectory() {
  selectingDirectory.value = true;
  syncStatus.value = null;
  
  try {
    const result = await selectRootDirectory();
    
    if (result.success) {
      fsSettings.value.rootPath = result.path;
      fsSettings.value.enabled = true;
      saveFileSystemSettings(fsSettings.value);
      
      const toast = await toastController.create({
        message: `Connected to: ${result.path}`,
        duration: 2000,
        color: 'success',
        position: 'top',
      });
      await toast.present();
    } else if (result.error && result.error !== 'Directory selection was cancelled') {
      syncStatus.value = {
        success: false,
        message: result.error,
      };
    }
  } catch (error) {
    syncStatus.value = {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to select directory',
    };
  } finally {
    selectingDirectory.value = false;
  }
}

async function handleFsToggle() {
  if (fsSettings.value.enabled && !fsSettings.value.rootPath) {
    // Need to select a directory first
    await handleSelectDirectory();
    if (!fsSettings.value.rootPath) {
      fsSettings.value.enabled = false;
    }
  }
  
  // Update file watcher
  if (fsSettings.value.enabled && fsSettings.value.watchForChanges) {
    startFileWatcher();
  } else {
    stopFileWatcher();
  }
  
  saveFileSystemSettings(fsSettings.value);
}

async function handleSyncNow() {
  syncing.value = true;
  syncStatus.value = null;
  
  try {
    const result = await syncAll();
    
    if (result.success) {
      fsSettings.value.lastSyncTime = result.syncTime.toISOString();
      saveFileSystemSettings(fsSettings.value);
      
      syncStatus.value = {
        success: true,
        message: `Sync complete: ${result.filesWritten} written, ${result.filesRead} imported`,
      };
    } else {
      syncStatus.value = {
        success: false,
        message: result.error || 'Sync failed',
      };
    }
  } catch (error) {
    syncStatus.value = {
      success: false,
      message: error instanceof Error ? error.message : 'Sync failed',
    };
  } finally {
    syncing.value = false;
  }
}

async function handleDisconnect() {
  await disconnectRootDirectory();
  stopFileWatcher();
  
  fsSettings.value = { ...DEFAULT_FILESYSTEM_SETTINGS };
  syncStatus.value = null;
  
  const toast = await toastController.create({
    message: 'Disconnected from file system',
    duration: 2000,
    color: 'warning',
    position: 'top',
  });
  await toast.present();
}

async function handleSaveStorage() {
  saveFileSystemSettings(fsSettings.value);
  
  // Update file watcher based on settings
  if (fsSettings.value.enabled && fsSettings.value.watchForChanges) {
    startFileWatcher();
  } else {
    stopFileWatcher();
  }
  
  const toast = await toastController.create({
    message: 'Storage settings saved',
    duration: 2000,
    color: 'success',
    position: 'top',
  });
  await toast.present();
}

function formatLastSyncTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString();
  }
}

// Web Search handlers
async function handleSaveWebSearch() {
  saveWebSearchSettings(webSearchSettings.value);
  
  const toast = await toastController.create({
    message: 'Web search settings saved',
    duration: 2000,
    color: 'success',
    position: 'top',
  });
  await toast.present();
}

async function handleTestWebSearch() {
  testingWebSearch.value = true;
  webSearchStatus.value = null;

  // Save settings first so test uses current values
  saveWebSearchSettings(webSearchSettings.value);

  try {
    const result = await testWebSearchConnection();
    webSearchStatus.value = result;
  } catch (error) {
    webSearchStatus.value = {
      success: false,
      message: error instanceof Error ? error.message : 'Search test failed',
    };
  } finally {
    testingWebSearch.value = false;
  }
}

async function handleClearWebCache() {
  clearingCache.value = true;
  
  try {
    const deletedCount = await clearWebSearchCache();
    
    const toast = await toastController.create({
      message: `Cleared ${deletedCount} cached entries`,
      duration: 2000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
  } catch (error) {
    const toast = await toastController.create({
      message: error instanceof Error ? error.message : 'Failed to clear cache',
      duration: 3000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  } finally {
    clearingCache.value = false;
  }
}

// Indexer handlers
async function handleSaveIndexer() {
  saveIndexerSettings(indexerSettings.value);
  
  const toast = await toastController.create({
    message: 'Indexer settings saved',
    duration: 2000,
    color: 'success',
    position: 'top',
  });
  await toast.present();
}

async function handleTestIndexer() {
  testingIndexer.value = true;
  indexerStatus.value = null;
  
  // Save settings first so test uses current values
  saveIndexerSettings(indexerSettings.value);
  
  try {
    const result = await testIndexerConnection();
    indexerStatus.value = {
      success: result.success,
      message: result.success 
        ? `${result.provider}: ${result.message}`
        : `${result.provider}: ${result.message}`,
    };
  } catch (error) {
    indexerStatus.value = {
      success: false,
      message: error instanceof Error ? error.message : 'Connection test failed',
    };
  } finally {
    testingIndexer.value = false;
  }
}

async function fetchOllamaEmbeddingModels() {
  loadingEmbeddingModels.value = true;
  
  try {
    const models = await getOllamaModels(indexerSettings.value.ollama.baseUrl);
    ollamaEmbeddingModels.value = models;
    
    if (models.length === 0) {
      const toast = await toastController.create({
        message: 'No models found. Make sure Ollama is running and has embedding models installed.',
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
    loadingEmbeddingModels.value = false;
  }
}

function selectOllamaEmbeddingModel(model: string) {
  indexerSettings.value.ollama.model = model;
}

async function handleReindexAll() {
  reindexing.value = true;
  reindexProgress.value = null;
  reindexStatus.value = null;
  
  try {
    const result = await reindexAllFiles((current, total, fileName) => {
      reindexProgress.value = { current, total, fileName };
    });
    
    reindexProgress.value = null;
    
    if (result.failed === 0) {
      reindexStatus.value = {
        success: true,
        message: `Successfully re-indexed ${result.reindexed} files`,
      };
    } else {
      reindexStatus.value = {
        success: false,
        message: `Re-indexed ${result.reindexed} files, ${result.failed} failed`,
      };
    }
  } catch (error) {
    reindexProgress.value = null;
    reindexStatus.value = {
      success: false,
      message: error instanceof Error ? error.message : 'Re-indexing failed',
    };
  } finally {
    reindexing.value = false;
  }
}

// MCP Server handlers
async function handleMcpToggle() {
  mcpStatus.value = null;
  
  if (mcpSettings.value.enabled && !mcpSettings.value.bearerToken) {
    // Generate a token first
    await handleGenerateToken();
    if (!mcpSettings.value.bearerToken) {
      mcpSettings.value.enabled = false;
      return;
    }
  }
  
  // Save and apply settings
  const result = await saveMCPSettings(mcpSettings.value);
  
  if (result.success) {
    const status = await getMCPServerStatus();
    mcpServerRunning.value = status.running;
    
    mcpStatus.value = {
      success: true,
      message: mcpSettings.value.enabled ? 'MCP server enabled' : 'MCP server disabled',
    };
  } else {
    mcpStatus.value = {
      success: false,
      message: result.error || 'Failed to update MCP server',
    };
  }
}

async function handleGenerateToken() {
  generatingToken.value = true;
  mcpStatus.value = null;
  
  try {
    const result = await generateMCPToken();
    
    if (result.success && result.token) {
      mcpSettings.value.bearerToken = result.token;
      
      const toast = await toastController.create({
        message: 'New token generated',
        duration: 2000,
        color: 'success',
        position: 'top',
      });
      await toast.present();
    } else {
      mcpStatus.value = {
        success: false,
        message: result.error || 'Failed to generate token',
      };
    }
  } catch (error) {
    mcpStatus.value = {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to generate token',
    };
  } finally {
    generatingToken.value = false;
  }
}

async function copyMcpToken() {
  if (!mcpSettings.value.bearerToken) return;
  
  try {
    await navigator.clipboard.writeText(mcpSettings.value.bearerToken);
    
    const toast = await toastController.create({
      message: 'Token copied to clipboard',
      duration: 2000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
  } catch (error) {
    const toast = await toastController.create({
      message: 'Failed to copy token',
      duration: 2000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}

async function handleDownloadMcpConfig() {
  if (!mcpSettings.value.bearerToken) {
    const toast = await toastController.create({
      message: 'Please generate a token first',
      duration: 2000,
      color: 'warning',
      position: 'top',
    });
    await toast.present();
    return;
  }
  
  try {
    const configJson = generateMCPConfig(mcpSettings.value);
    const blob = new Blob([configJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hydranote-mcp.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    const toast = await toastController.create({
      message: 'MCP configuration downloaded',
      duration: 2000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
  } catch (error) {
    const toast = await toastController.create({
      message: 'Failed to download configuration',
      duration: 2000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}

async function handleSaveMcp() {
  mcpStatus.value = null;
  
  const result = await saveMCPSettings(mcpSettings.value);
  
  if (result.success) {
    const status = await getMCPServerStatus();
    mcpServerRunning.value = status.running;
    
    const toast = await toastController.create({
      message: 'MCP settings saved',
      duration: 2000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
  } else {
    mcpStatus.value = {
      success: false,
      message: result.error || 'Failed to save MCP settings',
    };
  }
}

// ============================================
// Local Models Functions
// ============================================

async function loadLocalModelsData() {
  loadingLocalModels.value = true;
  
  try {
    const [installed, catalog, status] = await Promise.all([
      getInstalledModels(),
      getModelCatalog(),
      getRuntimeStatus(),
    ]);
    
    installedModels.value = installed;
    modelCatalog.value = catalog;
    runtimeStatus.value = status;
  } catch (error) {
    console.error('Failed to load local models:', error);
  } finally {
    loadingLocalModels.value = false;
  }
}

async function selectLocalModel(model: LocalModel) {
  if (model.state === 'installed') {
    // Update settings with selected model
    settings.value.huggingfaceLocal = {
      ...settings.value.huggingfaceLocal,
      modelId: model.id,
    };
    
    // Load the model into runtime
    loadingModel.value = true;
    runtimeStatus.value = {
      ...runtimeStatus.value,
      running: true,
      ready: false,
      loadedModelId: model.id,
      loadedModelName: model.name,
    } as RuntimeStatus;
    
    try {
      await loadModel(model.id, {
        gpuLayers: settings.value.huggingfaceLocal.gpuLayers,
        contextLength: settings.value.huggingfaceLocal.contextLength,
      });
      
      // Refresh runtime status
      runtimeStatus.value = await getRuntimeStatus();
      
      const toast = await toastController.create({
        message: `Model "${model.name}" loaded successfully`,
        duration: 2000,
        color: 'success',
        position: 'top',
      });
      await toast.present();
    } catch (error) {
      runtimeStatus.value = {
        running: false,
        ready: false,
        error: error instanceof Error ? error.message : 'Failed to load model',
      };
      
      const toast = await toastController.create({
        message: error instanceof Error ? error.message : 'Failed to load model',
        duration: 3000,
        color: 'danger',
        position: 'top',
      });
      await toast.present();
    } finally {
      loadingModel.value = false;
    }
  }
}

function isModelInstalled(huggingFaceId: string): boolean {
  return installedModels.value.some(m => m.huggingFaceId === huggingFaceId && m.state === 'installed');
}

async function handleInstallModel(modelRef: HFModelRef) {
  installingModel.value = modelRef.id;
  
  try {
    // First fetch full model info to get file list
    const fullModelInfo = await import('@/services').then(s => s.fetchModelInfo(modelRef.id));
    
    // Start the installation
    await installModel(fullModelInfo);
    
    const toast = await toastController.create({
      message: `Started downloading ${modelRef.name}...`,
      duration: 2000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
    
    // Refresh the list
    await loadLocalModelsData();
  } catch (error) {
    installingModel.value = null;
    
    const toast = await toastController.create({
      message: error instanceof Error ? error.message : 'Failed to install model',
      duration: 3000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}

async function handleRemoveModel(modelId: string) {
  try {
    await removeModel(modelId);
    
    // If this was the selected model, clear the selection
    if (settings.value.huggingfaceLocal?.modelId === modelId) {
      settings.value.huggingfaceLocal.modelId = '';
    }
    
    const toast = await toastController.create({
      message: 'Model removed',
      duration: 2000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
    
    // Refresh the list
    await loadLocalModelsData();
  } catch (error) {
    const toast = await toastController.create({
      message: error instanceof Error ? error.message : 'Failed to remove model',
      duration: 3000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}

async function handleCancelDownload() {
  if (downloadProgress.value) {
    try {
      await cancelInstallation(downloadProgress.value.modelId);
      downloadProgress.value = null;
      installingModel.value = null;
      
      // Refresh the list
      await loadLocalModelsData();
      
      const toast = await toastController.create({
        message: 'Download cancelled',
        duration: 2000,
        color: 'warning',
        position: 'top',
      });
      await toast.present();
    } catch (error) {
      const toast = await toastController.create({
        message: error instanceof Error ? error.message : 'Failed to cancel download',
        duration: 3000,
        color: 'danger',
        position: 'top',
      });
      await toast.present();
    }
  }
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

.btn-danger {
  background: var(--hn-danger-muted);
  border: 1px solid var(--hn-danger);
  color: var(--hn-danger);
}

.btn-danger:hover {
  background: var(--hn-danger);
  color: #ffffff;
}

/* Directory Picker */
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

.directory-display ion-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.directory-display .placeholder {
  color: var(--hn-text-muted);
  font-style: italic;
}

/* Last Sync Info */
.last-sync-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  color: var(--hn-text-secondary);
  font-size: 0.9rem;
}

.last-sync-info ion-icon {
  font-size: 1.1rem;
  color: var(--hn-text-muted);
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

/* Small provider cards for web search */
.provider-card.small {
  padding: 16px;
}

.provider-card.small .provider-icon {
  width: 40px;
  height: 40px;
}

.provider-card.small .provider-icon :deep(svg) {
  width: 24px;
  height: 24px;
}

.provider-card.small .provider-info h3 {
  font-size: 1rem;
}

.provider-card.small .provider-info p {
  font-size: 0.8rem;
}

/* Status content with suggestions */
.status-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.status-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-header ion-icon {
  font-size: 1.3rem;
  flex-shrink: 0;
}

.status-details {
  font-size: 0.85rem;
  opacity: 0.8;
  margin-left: 33px;
}

.status-suggestions {
  margin: 8px 0 0 33px;
  padding-left: 20px;
  font-size: 0.85rem;
}

.status-suggestions li {
  margin-bottom: 4px;
  opacity: 0.9;
}

.status-suggestions li:last-child {
  margin-bottom: 0;
}

.connection-status.error .status-suggestions {
  list-style-type: disc;
}

.connection-status.success .status-suggestions {
  list-style-type: none;
  padding-left: 0;
}

/* Re-index Progress */
.reindex-progress {
  margin-bottom: 16px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
}

.progress-file {
  color: var(--hn-text-primary);
  font-weight: 500;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress-bar {
  height: 8px;
  background: var(--hn-bg-deep);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--hn-purple), var(--hn-purple-light));
  border-radius: 4px;
  transition: width 0.2s ease;
}

/* MCP Server Section */
.status-url {
  margin-left: auto;
  font-family: monospace;
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
  background: var(--hn-bg-deep);
  padding: 2px 8px;
  border-radius: 4px;
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
}

.tool-item code {
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 0.85rem;
  color: var(--hn-purple-light);
  background: var(--hn-purple-muted);
  padding: 4px 8px;
  border-radius: 4px;
  min-width: 140px;
}

.tool-item span {
  font-size: 0.9rem;
  color: var(--hn-text-secondary);
}

.btn-icon {
  padding: 8px;
  min-width: auto;
  background: transparent;
  border: 1px solid var(--hn-border-default);
}

.btn-icon:hover {
  background: var(--hn-bg-medium);
  border-color: var(--hn-border-strong);
}

/* Local Models Section */
.runtime-status {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  margin-bottom: 16px;
}

.runtime-status.ready {
  border-color: var(--hn-green-light);
  background: var(--hn-green-muted);
}

.runtime-status.loading {
  border-color: var(--hn-purple);
  background: var(--hn-purple-muted);
}

.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-row.error {
  color: var(--hn-danger);
}

.status-label {
  font-size: 0.85rem;
  color: var(--hn-text-muted);
  min-width: 60px;
}

.status-value {
  font-size: 0.9rem;
  color: var(--hn-text-primary);
}

.status-value.text-success {
  color: var(--hn-green-light);
}

.status-value.text-muted {
  color: var(--hn-text-muted);
}

.status-value.text-loading {
  color: var(--hn-purple);
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-value.text-loading ion-spinner {
  width: 16px;
  height: 16px;
}

.loading-state,
.empty-state {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--hn-bg-deep);
  border: 1px dashed var(--hn-border-default);
  border-radius: 8px;
  color: var(--hn-text-muted);
  font-size: 0.9rem;
}

.empty-state ion-icon {
  font-size: 1.5rem;
}

.model-item {
  position: relative;
}

.model-item-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-name {
  font-size: 0.95rem;
  color: var(--hn-text-primary);
}

.model-size {
  font-size: 0.8rem;
  color: var(--hn-text-muted);
}

.model-status {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 4px;
}

.model-status.downloading {
  background: var(--hn-purple-muted);
  color: var(--hn-purple);
}

.model-status.failed {
  background: var(--hn-danger-muted);
  color: var(--hn-danger);
}

.remove-model-btn {
  opacity: 0;
  padding: 6px;
  background: transparent;
  border: none;
  color: var(--hn-text-muted);
  cursor: pointer;
  transition: opacity 0.2s, color 0.2s;
}

.model-item:hover .remove-model-btn {
  opacity: 1;
}

.remove-model-btn:hover {
  color: var(--hn-danger);
}

/* Download Progress */
.download-progress {
  padding: 16px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-purple);
  border-radius: 8px;
  margin-bottom: 16px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.progress-label {
  font-size: 0.9rem;
  color: var(--hn-text-primary);
}

.progress-stats {
  font-size: 0.8rem;
  color: var(--hn-text-muted);
}

.progress-bar {
  height: 8px;
  background: var(--hn-bg-deepest);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 10px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--hn-purple) 0%, var(--hn-purple-light) 100%);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
  color: var(--hn-text-muted);
}

.cancel-btn {
  padding: 4px 12px;
  background: transparent;
  border: 1px solid var(--hn-border-default);
  border-radius: 4px;
  color: var(--hn-text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.cancel-btn:hover {
  border-color: var(--hn-danger);
  color: var(--hn-danger);
}

/* Model Catalog */
.catalog-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.catalog-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
}

.catalog-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.catalog-name {
  font-size: 0.95rem;
  color: var(--hn-text-primary);
  font-weight: 500;
}

.catalog-desc {
  font-size: 0.85rem;
  color: var(--hn-text-muted);
}

.btn-small {
  padding: 6px 14px;
  font-size: 0.85rem;
  min-width: 90px;
}
</style>
