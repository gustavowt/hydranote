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
} from 'ionicons/icons';
import type { LLMSettings, LLMProvider, FileSystemSettings, WebSearchSettings, WebSearchProvider, IndexerSettings, EmbeddingProvider } from '@/types';
import { DEFAULT_LLM_SETTINGS, DEFAULT_FILESYSTEM_SETTINGS, DEFAULT_WEB_SEARCH_SETTINGS, DEFAULT_INDEXER_SETTINGS } from '@/types';
import { 
  OpenAiIcon, 
  ClaudeIcon, 
  GeminiIcon, 
  OllamaIcon,
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
} from '@/services';

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
];

const activeSection = ref<'providers' | 'indexer' | 'instructions' | 'webresearch' | 'storage'>('providers');
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

onMounted(() => {
  settings.value = loadSettings();
  fsSettings.value = loadFileSystemSettings();
  webSearchSettings.value = loadWebSearchSettings();
  indexerSettings.value = loadIndexerSettings();
  isFileSystemSupported.value = isFileSystemAccessSupported();
  
  // Start file watcher if enabled
  if (fsSettings.value.enabled && fsSettings.value.watchForChanges) {
    startFileWatcher();
  }
});

onUnmounted(() => {
  // Stop file watcher when leaving settings
  stopFileWatcher();
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
</style>
