require('./rt/electron-rt');
//////////////////////////////
// User Defined Preload scripts below

import { contextBridge, ipcRenderer } from 'electron';

// MCP Settings type
interface MCPSettings {
  enabled: boolean;
  port: number;
  bearerToken: string;
}

// MCP Tool Request type
interface MCPToolRequest {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
}

// Local Models Types
interface HFModelFile {
  filename: string;
  sha256?: string;
  size: number;
  isPrimary?: boolean;
}

interface HFModelRef {
  id: string;
  name: string;
  description: string;
  size: number;
  files: HFModelFile[];
  quantization?: string;
  contextLength?: number;
  architecture?: string;
  gated?: boolean;
  recommendedGpuLayers?: number;
  bestFor?: string;
  resourceInfo?: string;
}

interface LocalModelSettings {
  modelsDirectory?: string;
  defaultGpuLayers: number;
  defaultContextLength: number;
  huggingFaceToken?: string;
  autoLoadLastModel: boolean;
}

interface InferenceMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface InferenceOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  stream?: boolean;
}

interface ModelDownloadProgress {
  modelId: string;
  currentFile: string;
  fileDownloaded: number;
  fileTotal: number;
  totalDownloaded: number;
  totalSize: number;
  speed: number;
  eta?: number;
  status: string;
}

interface RuntimeStatus {
  running: boolean;
  loadedModelId?: string;
  loadedModelName?: string;
  memoryUsage?: number;
  gpuMemoryUsage?: number;
  ready: boolean;
  error?: string;
}

// Local Embeddings Types
interface HFEmbeddingRuntimeStatus {
  status: 'not_loaded' | 'loading' | 'ready' | 'error';
  loadedModel?: string;
  error?: string;
  progress?: number;
}

interface SuggestedEmbeddingModel {
  id: string;
  name: string;
  description: string;
  dimensions: number;
}

// Expose Electron APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // File System Operations
  fs: {
    selectDirectory: () => ipcRenderer.invoke('fs:selectDirectory'),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
    readBinaryFile: (filePath: string) => ipcRenderer.invoke('fs:readBinaryFile', filePath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    deleteFile: (filePath: string) => ipcRenderer.invoke('fs:deleteFile', filePath),
    createDirectory: (dirPath: string) => ipcRenderer.invoke('fs:createDirectory', dirPath),
    deleteDirectory: (dirPath: string) => ipcRenderer.invoke('fs:deleteDirectory', dirPath),
    listDirectory: (dirPath: string) => ipcRenderer.invoke('fs:listDirectory', dirPath),
    exists: (path: string) => ipcRenderer.invoke('fs:exists', path),
    getStats: (path: string) => ipcRenderer.invoke('fs:getStats', path),
  },
  // Shell Operations (open files/URLs in system applications)
  shell: {
    openPath: (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),
  },
  // Web Fetch Operations (bypasses CORS by running in main process)
  web: {
    fetch: (options: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      timeout?: number;
    }) => ipcRenderer.invoke('web:fetch', options),
  },
  // MCP Server Operations
  mcp: {
    getSettings: () => ipcRenderer.invoke('mcp:getSettings'),
    saveSettings: (settings: MCPSettings) => {
      // Create a plain object copy to ensure serializability
      const plainSettings = {
        enabled: settings.enabled,
        port: settings.port,
        bearerToken: settings.bearerToken,
      };
      return ipcRenderer.invoke('mcp:saveSettings', plainSettings);
    },
    generateToken: () => ipcRenderer.invoke('mcp:generateToken'),
    getStatus: () => ipcRenderer.invoke('mcp:getStatus'),
    start: () => ipcRenderer.invoke('mcp:start'),
    stop: () => ipcRenderer.invoke('mcp:stop'),
    // Listen for tool execution requests from main process
    onToolRequest: (callback: (request: MCPToolRequest) => void) => {
      ipcRenderer.on('mcp:tool-request', (_event, request: MCPToolRequest) => {
        callback(request);
      });
    },
    // Send tool execution response back to main process
    sendToolResponse: (requestId: string, response: { success: boolean; data?: unknown; error?: string }) => {
      ipcRenderer.send('mcp:tool-response', { requestId, result: response });
    },
  },
  // Local Models Operations
  models: {
    // Get available models from catalog
    getCatalog: () => ipcRenderer.invoke('models:getCatalog'),
    // Fetch model info from Hugging Face
    fetchModelInfo: (repoId: string) => ipcRenderer.invoke('models:fetchModelInfo', repoId),
    // Get installed models from local registry
    getInstalled: () => ipcRenderer.invoke('models:getInstalled'),
    // Get a specific installed model
    getModel: (modelId: string) => ipcRenderer.invoke('models:getModel', modelId),
    // Start downloading a model
    install: (modelRef: HFModelRef) => {
      const plainRef = {
        id: modelRef.id,
        name: modelRef.name,
        description: modelRef.description,
        size: modelRef.size,
        files: modelRef.files,
        quantization: modelRef.quantization,
        contextLength: modelRef.contextLength,
        architecture: modelRef.architecture,
        gated: modelRef.gated,
        recommendedGpuLayers: modelRef.recommendedGpuLayers,
      };
      return ipcRenderer.invoke('models:install', plainRef);
    },
    // Cancel an ongoing download
    cancelInstall: (modelId: string) => ipcRenderer.invoke('models:cancelInstall', modelId),
    // Remove an installed model
    remove: (modelId: string) => ipcRenderer.invoke('models:remove', modelId),
    // Get runtime status
    getRuntimeStatus: () => ipcRenderer.invoke('models:getRuntimeStatus'),
    // Load a model into the runtime
    loadModel: (modelId: string, options?: { gpuLayers?: number; contextLength?: number }) => 
      ipcRenderer.invoke('models:loadModel', modelId, options),
    // Unload the current model
    unloadModel: () => ipcRenderer.invoke('models:unloadModel'),
    // Run inference (non-streaming)
    infer: (messages: InferenceMessage[], options?: InferenceOptions) => {
      const plainMessages = messages.map(m => ({ role: m.role, content: m.content }));
      return ipcRenderer.invoke('models:infer', plainMessages, options);
    },
    // Get local model settings
    getSettings: () => ipcRenderer.invoke('models:getSettings'),
    // Save local model settings
    saveSettings: (settings: LocalModelSettings) => {
      const plainSettings = {
        modelsDirectory: settings.modelsDirectory,
        defaultGpuLayers: settings.defaultGpuLayers,
        defaultContextLength: settings.defaultContextLength,
        huggingFaceToken: settings.huggingFaceToken,
        autoLoadLastModel: settings.autoLoadLastModel,
      };
      return ipcRenderer.invoke('models:saveSettings', plainSettings);
    },
    // Listen for download progress events
    onDownloadProgress: (callback: (progress: ModelDownloadProgress) => void) => {
      ipcRenderer.on('models:progress', (_event, progress: ModelDownloadProgress) => {
        callback(progress);
      });
    },
    // Listen for runtime status changes
    onRuntimeStatusChange: (callback: (status: RuntimeStatus) => void) => {
      ipcRenderer.on('models:runtime-status', (_event, status: RuntimeStatus) => {
        callback(status);
      });
    },
    // Remove download progress listener
    offDownloadProgress: () => {
      ipcRenderer.removeAllListeners('models:progress');
    },
    // Remove runtime status listener
    offRuntimeStatusChange: () => {
      ipcRenderer.removeAllListeners('models:runtime-status');
    },
  },
  // Local Embeddings Operations (Hugging Face Transformers.js)
  embeddings: {
    // Get embedding model catalog
    getCatalog: () => ipcRenderer.invoke('embeddings:getCatalog'),
    // Get embedding runtime status
    getStatus: () => ipcRenderer.invoke('embeddings:getStatus'),
    // Load an embedding model
    loadModel: (modelId: string) => ipcRenderer.invoke('embeddings:loadModel', modelId),
    // Unload current embedding model
    unloadModel: () => ipcRenderer.invoke('embeddings:unloadModel'),
    // Generate embedding for single text
    generate: (text: string, modelId?: string) => ipcRenderer.invoke('embeddings:generate', text, modelId),
    // Generate embeddings for multiple texts (batch)
    generateBatch: (texts: string[], modelId?: string) => ipcRenderer.invoke('embeddings:generateBatch', texts, modelId),
    // Clear model cache (useful for corrupted downloads)
    clearCache: (modelId?: string) => ipcRenderer.invoke('embeddings:clearCache', modelId),
    // Listen for status updates
    onStatusChange: (callback: (status: HFEmbeddingRuntimeStatus) => void) => {
      ipcRenderer.on('embeddings:status', (_event, status: HFEmbeddingRuntimeStatus) => {
        callback(status);
      });
    },
    // Remove status listener
    offStatusChange: () => {
      ipcRenderer.removeAllListeners('embeddings:status');
    },
  },
  // App info
  platform: process.platform,
  isElectron: true,
});

console.log('HydraNote Electron Preload Initialized');
