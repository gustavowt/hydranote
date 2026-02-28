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

            <AIProviderSelector
              v-model="settings"
              :testing-connection="testing"
              :connection-status="connectionStatus"
              :loading-models="loadingModels"
              :ollama-models="ollamaModels"
              :local-models-available="localModelsAvailable"
              :installed-models="installedModels"
              :model-catalog="modelCatalog"
              :loading-local-models="loadingLocalModels"
              :download-progress="downloadProgress"
              :runtime-status="runtimeStatus"
              :installing-model="installingModel"
              :loading-model="loadingModel"
              :local-model-token="localModelToken"
              :hardware-info="hardwareInfo"
              @update:local-model-token="localModelToken = $event"
              @test-connection="handleTestConnection"
              @save="handleSave"
              @fetch-ollama-models="fetchOllamaModels"
              @select-local-model="handleSelectLocalModel"
              @install-model="handleInstallModel"
              @remove-model="handleRemoveModel"
              @cancel-download="handleCancelDownload"
            />
          </section>

          <!-- Indexer Section -->
          <section v-if="activeSection === 'indexer'" class="content-section">
            <h2 class="section-title">Indexer</h2>
            <p class="section-description">
              Configure the embedding provider for semantic search and document indexing. 
              This is separate from your AI provider—you can mix and match (e.g., use Claude for chat + OpenAI for embeddings).
            </p>

            <IndexerProviderSelector
              v-model="indexerSettings"
              :ai-provider-settings="settings"
              :hf-local-available="hfLocalAvailable"
              :hf-local-status="hfLocalStatus"
              :testing-connection="testingIndexer"
              :connection-status="indexerStatus"
              :loading-models="loadingEmbeddingModels"
              :ollama-models="ollamaEmbeddingModels"
              :reindexing="reindexing"
              :reindex-progress="reindexProgress"
              :reindex-status="reindexStatus"
              @test-connection="handleTestIndexer"
              @save="handleSaveIndexer"
              @fetch-ollama-models="fetchOllamaEmbeddingModels"
              @download-model="handleDownloadEmbeddingModel"
              @reindex-all="handleReindexAll"
            />
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
                  <label>Project Rotation Instructions</label>
                  <textarea
                    v-model="settings.noteSettings.projectRotationInstructions"
                    placeholder="Custom instructions for project selection (e.g., 'Always use the Work project for meeting notes', 'Create a new project for each client')"
                    rows="4"
                  ></textarea>
                  <span class="field-hint">
                    These instructions guide how the AI decides which project to assign notes to.
                  </span>
                </div>

                <div class="field-group">
                  <label>Directory Rotation Instructions</label>
                  <textarea
                    v-model="settings.noteSettings.directoryRotationInstructions"
                    placeholder="Custom instructions for directory organization (e.g., 'Put all meeting notes in meetings/', 'Never create new directories')"
                    rows="4"
                  ></textarea>
                  <span class="field-hint">
                    These instructions guide how the AI decides which directory to save notes in.
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

                <div class="field-group toggle-field">
                  <div class="toggle-info">
                    <label>Auto-format Notes</label>
                    <span class="toggle-description">AI formats and structures note content on save</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="settings.noteSettings.autoFormat" />
                    <span class="slider"></span>
                  </label>
                </div>

                <div class="field-group toggle-field">
                  <div class="toggle-info">
                    <label>Auto Project Routing</label>
                    <span class="toggle-description">AI selects the target project when saving notes</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="settings.noteSettings.autoProjectRouting" />
                    <span class="slider"></span>
                  </label>
                </div>

                <div class="field-group toggle-field">
                  <div class="toggle-info">
                    <label>Auto Directory Routing</label>
                    <span class="toggle-description">AI selects the target directory when saving notes</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="settings.noteSettings.autoDirectoryRouting" />
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
                    <div class="tool-item">
                      <code>update_file</code>
                      <span>Update file with line-based editing (replace, insert_after, insert_before)</span>
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
import { ref, computed, onMounted, onUnmounted } from 'vue';
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
  informationCircleOutline,
} from 'ionicons/icons';
import type { LLMSettings, LLMProvider, FileSystemSettings, WebSearchSettings, WebSearchProvider, IndexerSettings, EmbeddingProvider, LocalModel, HFModelRef, ModelDownloadProgress, RuntimeStatus, HFEmbeddingRuntimeStatus, HardwareInfo } from '@/types';
import { DEFAULT_LLM_SETTINGS, DEFAULT_FILESYSTEM_SETTINGS, DEFAULT_WEB_SEARCH_SETTINGS, DEFAULT_INDEXER_SETTINGS, SUGGESTED_HF_LOCAL_EMBEDDING_MODELS } from '@/types';
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
import { AIProviderSelector, IndexerProviderSelector } from '@/components/settings';
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
  isHuggingFaceLocalAvailable,
  getHuggingFaceLocalStatus,
  onHuggingFaceLocalStatusChange,
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
  getHardwareInfo,
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

// Hugging Face local embeddings availability
const hfLocalAvailable = ref(isHuggingFaceLocalAvailable());
const hfLocalStatus = ref<HFEmbeddingRuntimeStatus | null>(null);
const downloadedEmbeddingModels = ref<Set<string>>(new Set());
let unsubscribeHFStatus: (() => void) | null = null;

// Indexer (embedding) provider configurations - computed to include HF local conditionally
const indexerProviders = computed(() => {
  const providers: { id: EmbeddingProvider; name: string; description: string; iconComponent: typeof OpenAiIcon }[] = [
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

  // Add Hugging Face local if available (Electron only)
  if (hfLocalAvailable.value) {
    providers.push({
      id: 'huggingface_local',
      name: 'Hugging Face',
      description: 'Local models (no API)',
      iconComponent: HuggingFaceIcon,
    });
  }

  return providers;
});

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
const hardwareInfo = ref<HardwareInfo | null>(null);
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
    
    // Load hardware acceleration info
    hardwareInfo.value = await getHardwareInfo();
    
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

  // Load HF local embedding status if available
  if (hfLocalAvailable.value) {
    hfLocalStatus.value = await getHuggingFaceLocalStatus();
    
    // If a model is already loaded, mark it as downloaded
    if (hfLocalStatus.value?.status === 'ready' && hfLocalStatus.value?.loadedModel) {
      downloadedEmbeddingModels.value.add(hfLocalStatus.value.loadedModel);
    }
    
    unsubscribeHFStatus = onHuggingFaceLocalStatusChange((status) => {
      hfLocalStatus.value = status;
      // Track downloaded models when they become ready
      if (status.status === 'ready' && status.loadedModel) {
        downloadedEmbeddingModels.value.add(status.loadedModel);
      }
    });
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

  // Unsubscribe from HF local status
  if (unsubscribeHFStatus) {
    unsubscribeHFStatus();
    unsubscribeHFStatus = null;
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

// Hugging Face local embedding model functions
function isEmbeddingModelReady(modelId: string): boolean {
  // Model is ready if it's been successfully downloaded (status is ready with this model)
  // or if we've tracked it as downloaded in this session
  return downloadedEmbeddingModels.value.has(modelId) || 
    (hfLocalStatus.value?.status === 'ready' && hfLocalStatus.value?.loadedModel === modelId);
}

function selectEmbeddingModel(modelId: string) {
  indexerSettings.value.huggingfaceLocal.model = modelId;
}

async function handleDownloadEmbeddingModel(modelId: string) {
  if (!hfLocalAvailable.value) {
    const toast = await toastController.create({
      message: 'Local embeddings only available in desktop app',
      duration: 3000,
      color: 'warning',
      position: 'top',
    });
    await toast.present();
    return;
  }

  try {
    // Start download via IPC - this will trigger status updates
    await window.electronAPI!.embeddings.loadModel(modelId);
    
    // Mark as downloaded and select it
    downloadedEmbeddingModels.value.add(modelId);
    indexerSettings.value.huggingfaceLocal.model = modelId;

    const toast = await toastController.create({
      message: `Model ${modelId.split('/').pop()} downloaded successfully!`,
      duration: 3000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
  } catch (error) {
    const toast = await toastController.create({
      message: `Failed to download model: ${error instanceof Error ? error.message : 'Unknown error'}`,
      duration: 4000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}

async function handleRetryEmbeddingDownload() {
  if (!hfLocalAvailable.value || !hfLocalStatus.value?.loadedModel) {
    return;
  }

  const modelId = hfLocalStatus.value.loadedModel;

  try {
    // Clear cache for the failed model
    const toast1 = await toastController.create({
      message: 'Clearing corrupted cache...',
      duration: 2000,
      color: 'medium',
      position: 'top',
    });
    await toast1.present();

    await window.electronAPI!.embeddings.clearCache(modelId);
    
    // Retry download
    await handleDownloadEmbeddingModel(modelId);
  } catch (error) {
    const toast = await toastController.create({
      message: `Retry failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      duration: 4000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
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
    saveSettings(settings.value);

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

function getInstalledModelId(huggingFaceId: string): string | null {
  const model = installedModels.value.find(m => m.huggingFaceId === huggingFaceId && m.state === 'installed');
  return model?.id || null;
}

function selectLocalModelById(huggingFaceId: string) {
  const model = installedModels.value.find(m => m.huggingFaceId === huggingFaceId && m.state === 'installed');
  if (model) {
    selectLocalModel(model);
  }
}

// Handler for select-local-model event from AIProviderSelector
function handleSelectLocalModel(model: LocalModel) {
  selectLocalModel(model);
}

async function handleRemoveModelByHfId(huggingFaceId: string) {
  const model = installedModels.value.find(m => m.huggingFaceId === huggingFaceId);
  if (model) {
    await handleRemoveModel(model.id);
  }
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

/* Hugging Face Local Embedding Models Catalog */
.embedding-models-catalog {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.embedding-model-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 10px;
  transition: all 0.2s ease;
}

.embedding-model-item:hover {
  border-color: var(--hn-border-hover);
}

.embedding-model-item.clickable {
  cursor: pointer;
}

.embedding-model-item.clickable:hover {
  border-color: var(--hn-purple);
  background: var(--hn-purple-muted);
}

.embedding-model-item.selected {
  border-color: var(--hn-purple);
  background: var(--hn-purple-muted);
}

.embedding-model-item.downloading {
  border-color: var(--hn-purple);
  border-radius: 10px 10px 0 0;
  margin-bottom: 0;
}

.embedding-model-item .model-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.embedding-model-item .model-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.embedding-model-item .model-name {
  font-weight: 600;
  color: var(--hn-text-primary);
}

.embedding-model-item .model-dims {
  font-size: 0.75rem;
  color: var(--hn-text-muted);
  background: var(--hn-border-default);
  padding: 2px 8px;
  border-radius: 4px;
}

.embedding-model-item .model-description {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
}

.embedding-model-item .model-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.embedding-model-item .download-status {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--hn-purple);
  font-size: 0.9rem;
}

.embedding-model-item .download-status ion-spinner {
  width: 18px;
  height: 18px;
}

.embedding-model-item .selected-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--hn-green-muted);
  color: var(--hn-green-light);
  border: 1px solid rgba(63, 185, 80, 0.3);
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 500;
}

.embedding-model-item .ready-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--hn-green-light);
  font-size: 1.2rem;
}

.btn-success {
  background: var(--hn-green-muted) !important;
  color: var(--hn-green-light) !important;
  border: 1px solid rgba(63, 185, 80, 0.3) !important;
}

.btn-success:hover {
  background: rgba(63, 185, 80, 0.25) !important;
}

/* HF Download Progress */
/* Embedding Download Progress (inline - below model item) */
.embedding-download-progress-inline {
  margin-top: -1px;
  margin-bottom: 12px;
  padding: 14px 18px;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-purple);
  border-top: none;
  border-radius: 0 0 10px 10px;
}

.embedding-download-progress-inline .progress-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 0.85rem;
  color: var(--hn-text-primary);
}

.embedding-download-progress-inline .progress-bar {
  height: 8px;
  background: var(--hn-border-default);
  border-radius: 4px;
  overflow: hidden;
}

.embedding-download-progress-inline .progress-fill {
  height: 100%;
  background: var(--hn-purple);
  border-radius: 4px;
  transition: width 0.3s ease;
}

/* HF Error Status */
.hf-error-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 16px;
  padding: 14px 18px;
  background: var(--hn-danger-muted);
  border: 1px solid rgba(248, 81, 73, 0.3);
  border-radius: 10px;
  color: var(--hn-danger);
  font-size: 0.9rem;
}

.hf-error-status .error-content {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.hf-error-status ion-icon {
  font-size: 1.2rem;
}

/* LLM Runtime Status (compact) */
.llm-runtime-status {
  margin-bottom: 16px;
  padding: 12px 16px;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 10px;
}

.llm-runtime-status .status-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.9rem;
}

.llm-runtime-status .status-item.loading {
  color: var(--hn-purple);
}

.llm-runtime-status .status-item.loading ion-spinner {
  width: 18px;
  height: 18px;
}

.llm-runtime-status .status-item.ready {
  color: var(--hn-green-light);
}

.llm-runtime-status .status-item.error {
  color: var(--hn-danger);
}

/* LLM Models Catalog */
.llm-models-catalog {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.llm-model-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 10px;
  transition: all 0.2s ease;
}

.llm-model-item:hover {
  border-color: var(--hn-border-hover);
}

.llm-model-item.clickable {
  cursor: pointer;
}

.llm-model-item.clickable:hover {
  border-color: var(--hn-purple);
  background: var(--hn-purple-muted);
}

.llm-model-item.selected {
  border-color: var(--hn-purple);
  background: var(--hn-purple-muted);
}

.llm-model-item.downloading {
  border-color: var(--hn-purple);
  opacity: 0.8;
}

.llm-model-item .model-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.llm-model-item .model-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.llm-model-item .model-name {
  font-weight: 600;
  color: var(--hn-text-primary);
}

.llm-model-item .model-description {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
}

.llm-model-item .model-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.llm-model-item .download-status {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--hn-purple);
  font-size: 0.9rem;
}

.llm-model-item .download-status ion-spinner {
  width: 18px;
  height: 18px;
}

.llm-model-item .selected-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--hn-green-muted);
  color: var(--hn-green-light);
  border: 1px solid rgba(63, 185, 80, 0.3);
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 500;
}

.llm-model-item .ready-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--hn-green-light);
  font-size: 1.2rem;
}

.btn-icon {
  padding: 8px !important;
  min-width: auto !important;
}

.btn-icon ion-icon {
  margin: 0;
}

/* LLM Download Progress (inline - below model item) */
.llm-download-progress-inline {
  margin-top: -1px;
  margin-bottom: 12px;
  padding: 14px 18px;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-purple);
  border-top: none;
  border-radius: 0 0 10px 10px;
}

.llm-download-progress-inline .progress-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 0.85rem;
  color: var(--hn-text-primary);
}

.llm-download-progress-inline .progress-bar {
  height: 8px;
  background: var(--hn-border-default);
  border-radius: 4px;
  overflow: hidden;
}

.llm-download-progress-inline .progress-fill {
  height: 100%;
  background: var(--hn-purple);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.llm-download-progress-inline .progress-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
}

.llm-download-progress-inline .cancel-btn {
  background: transparent;
  border: 1px solid var(--hn-danger);
  color: var(--hn-danger);
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.llm-download-progress-inline .cancel-btn:hover {
  background: var(--hn-danger-muted);
}

/* Model item with active download - adjust border radius */
.llm-model-item.downloading {
  border-radius: 10px 10px 0 0;
  margin-bottom: 0;
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

.catalog-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
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

/* Info icon and tooltip */
.info-icon-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.info-icon {
  font-size: 16px;
  color: var(--hn-text-muted);
  cursor: help;
  transition: color 0.2s ease;
}

.info-icon-wrapper:hover .info-icon {
  color: var(--hn-purple);
}

.info-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: 280px;
  padding: 12px;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 100;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, visibility 0.2s ease;
  pointer-events: none;
}

.info-icon-wrapper:hover .info-tooltip {
  opacity: 1;
  visibility: visible;
}

.info-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: var(--hn-bg-elevated);
}

.tooltip-section {
  margin-bottom: 10px;
}

.tooltip-section:last-child {
  margin-bottom: 0;
}

.tooltip-section strong {
  display: block;
  font-size: 0.8rem;
  color: var(--hn-purple);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.tooltip-section p {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
  margin: 0;
  line-height: 1.4;
}

.btn-small {
  padding: 6px 14px;
  font-size: 0.85rem;
  min-width: 90px;
}
</style>
