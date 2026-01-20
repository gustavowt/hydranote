/**
 * Type declarations for Electron IPC API
 * Exposed via preload script through contextBridge
 */

// Web Fetch Options
interface ElectronWebFetchOptions {
  /** URL to fetch */
  url: string;
  /** HTTP method (default: 'GET') */
  method?: string;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body (for POST/PUT) */
  body?: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

// Web Fetch Result
interface ElectronWebFetchResult {
  /** Whether the fetch succeeded */
  success: boolean;
  /** HTTP status code */
  status?: number;
  /** Response headers */
  headers?: Record<string, string>;
  /** Response body as text */
  body?: string;
  /** Final URL after redirects */
  finalUrl?: string;
  /** Error message if failed */
  error?: string;
}

// File System Operation Results
interface ElectronFsResult {
  success: boolean;
  error?: string;
}

interface ElectronFsSelectDirectoryResult extends ElectronFsResult {
  path?: string;
}

interface ElectronFsReadFileResult extends ElectronFsResult {
  content?: string;
}

interface ElectronFsReadBinaryFileResult extends ElectronFsResult {
  data?: string; // base64 encoded
}

interface ElectronFsExistsResult extends ElectronFsResult {
  exists?: boolean;
}

interface ElectronFsListDirectoryResult extends ElectronFsResult {
  entries?: Array<{
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modifiedTime: string;
  }>;
}

interface ElectronFsStatsResult extends ElectronFsResult {
  stats?: {
    isDirectory: boolean;
    isFile: boolean;
    size: number;
    modifiedTime: string;
    createdTime: string;
  };
}

// MCP Settings
interface ElectronMCPSettings {
  /** Whether MCP server is enabled */
  enabled: boolean;
  /** Port to run MCP server on */
  port: number;
  /** Bearer token for authentication */
  bearerToken: string;
}

// MCP Tool Request (from main process)
interface ElectronMCPToolRequest {
  /** Unique request ID */
  requestId: string;
  /** Tool name to execute */
  toolName: string;
  /** Tool arguments */
  args: Record<string, unknown>;
}

// MCP Tool Response
interface ElectronMCPToolResponse {
  /** Whether execution succeeded */
  success: boolean;
  /** Result data */
  data?: unknown;
  /** Error message if failed */
  error?: string;
}

// ============================================
// Local Models Types
// ============================================

// Model file reference
interface ElectronHFModelFile {
  filename: string;
  sha256?: string;
  size: number;
  isPrimary?: boolean;
}

// Hugging Face model reference
interface ElectronHFModelRef {
  id: string;
  name: string;
  description: string;
  size: number;
  files: ElectronHFModelFile[];
  quantization?: string;
  contextLength?: number;
  architecture?: string;
  gated?: boolean;
  recommendedGpuLayers?: number;
}

// Local model file
interface ElectronLocalModelFile {
  filename: string;
  path: string;
  size: number;
  sha256?: string;
  downloaded: boolean;
}

// Local model registry entry
interface ElectronLocalModel {
  id: string;
  huggingFaceId: string;
  name: string;
  version: string;
  files: ElectronLocalModelFile[];
  state: 'not_installed' | 'downloading' | 'installed' | 'failed' | 'paused';
  installedAt?: string;
  lastUsed?: string;
  totalSize: number;
  downloadedSize: number;
  primaryModelPath?: string;
  architecture?: string;
  contextLength?: number;
  error?: string;
}

// Download progress event
interface ElectronModelDownloadProgress {
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

// Runtime status
interface ElectronRuntimeStatus {
  running: boolean;
  loadedModelId?: string;
  loadedModelName?: string;
  memoryUsage?: number;
  gpuMemoryUsage?: number;
  ready: boolean;
  error?: string;
}

// Local model settings
interface ElectronLocalModelSettings {
  modelsDirectory?: string;
  defaultGpuLayers: number;
  defaultContextLength: number;
  huggingFaceToken?: string;
  autoLoadLastModel: boolean;
}

// Inference options
interface ElectronLocalInferenceOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  stream?: boolean;
}

// Inference message
interface ElectronInferenceMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Hardware acceleration info
interface ElectronHardwareInfo {
  backend: 'cuda' | 'metal' | 'vulkan' | 'cpu' | 'unknown';
  supportedBackends: string[];
  deviceName?: string;
}

// ============================================
// Local Embeddings Types (Hugging Face)
// ============================================

// Embedding runtime status
interface ElectronHFEmbeddingRuntimeStatus {
  status: 'not_loaded' | 'loading' | 'ready' | 'error';
  loadedModel?: string;
  error?: string;
  progress?: number;
}

// Suggested embedding model
interface ElectronSuggestedEmbeddingModel {
  id: string;
  name: string;
  description: string;
  dimensions: number;
}

// Embedding result
interface ElectronEmbeddingResult {
  success: boolean;
  embedding?: number[];
  error?: string;
}

// Batch embedding result
interface ElectronBatchEmbeddingResult {
  success: boolean;
  embeddings?: number[][];
  error?: string;
}

// Electron API interface
interface ElectronAPI {
  // File System Operations
  fs: {
    selectDirectory: () => Promise<ElectronFsSelectDirectoryResult>;
    readFile: (filePath: string) => Promise<ElectronFsReadFileResult>;
    readBinaryFile: (filePath: string) => Promise<ElectronFsReadBinaryFileResult>;
    writeFile: (filePath: string, content: string) => Promise<ElectronFsResult>;
    deleteFile: (filePath: string) => Promise<ElectronFsResult>;
    createDirectory: (dirPath: string) => Promise<ElectronFsResult>;
    deleteDirectory: (dirPath: string) => Promise<ElectronFsResult>;
    listDirectory: (dirPath: string) => Promise<ElectronFsListDirectoryResult>;
    exists: (path: string) => Promise<ElectronFsExistsResult>;
    getStats: (path: string) => Promise<ElectronFsStatsResult>;
  };
  // Shell Operations (open files/URLs in system applications)
  shell: {
    openPath: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  };
  // Web Fetch Operations (bypasses CORS by running in main process)
  web: {
    fetch: (options: ElectronWebFetchOptions) => Promise<ElectronWebFetchResult>;
  };
  // MCP Server Operations
  mcp: {
    getSettings: () => Promise<{ success: boolean; settings?: ElectronMCPSettings; error?: string }>;
    saveSettings: (settings: ElectronMCPSettings) => Promise<{ success: boolean; error?: string }>;
    generateToken: () => Promise<{ success: boolean; token?: string; error?: string }>;
    getStatus: () => Promise<{ success: boolean; running?: boolean; error?: string }>;
    start: () => Promise<{ success: boolean; error?: string }>;
    stop: () => Promise<{ success: boolean; error?: string }>;
    onToolRequest: (callback: (request: ElectronMCPToolRequest) => void) => void;
    sendToolResponse: (requestId: string, response: ElectronMCPToolResponse) => void;
  };
  // Local Models Operations
  models: {
    /** Get available models from catalog */
    getCatalog: () => Promise<{ success: boolean; models?: ElectronHFModelRef[]; error?: string }>;
    /** Fetch model info from Hugging Face */
    fetchModelInfo: (repoId: string) => Promise<{ success: boolean; model?: ElectronHFModelRef; error?: string }>;
    /** Get installed models from local registry */
    getInstalled: () => Promise<{ success: boolean; models?: ElectronLocalModel[]; error?: string }>;
    /** Get a specific installed model */
    getModel: (modelId: string) => Promise<{ success: boolean; model?: ElectronLocalModel; error?: string }>;
    /** Start downloading a model */
    install: (modelRef: ElectronHFModelRef) => Promise<{ success: boolean; modelId?: string; error?: string }>;
    /** Cancel an ongoing download */
    cancelInstall: (modelId: string) => Promise<{ success: boolean; error?: string }>;
    /** Remove an installed model */
    remove: (modelId: string) => Promise<{ success: boolean; error?: string }>;
    /** Get runtime status */
    getRuntimeStatus: () => Promise<{ success: boolean; status?: ElectronRuntimeStatus; error?: string }>;
    /** Load a model into the runtime */
    loadModel: (modelId: string, options?: { gpuLayers?: number; contextLength?: number }) => Promise<{ success: boolean; error?: string }>;
    /** Unload the current model */
    unloadModel: () => Promise<{ success: boolean; error?: string }>;
    /** Run inference (non-streaming) */
    infer: (messages: ElectronInferenceMessage[], options?: ElectronLocalInferenceOptions) => Promise<{ success: boolean; content?: string; error?: string }>;
    /** Get local model settings */
    getSettings: () => Promise<{ success: boolean; settings?: ElectronLocalModelSettings; error?: string }>;
    /** Save local model settings */
    saveSettings: (settings: ElectronLocalModelSettings) => Promise<{ success: boolean; error?: string }>;
    /** Get hardware acceleration info (CUDA, Metal, Vulkan, CPU) */
    getHardwareInfo: () => Promise<{ success: boolean; info?: ElectronHardwareInfo; error?: string }>;
    /** Listen for download progress events */
    onDownloadProgress: (callback: (event: unknown, progress: ElectronModelDownloadProgress) => void) => void;
    /** Listen for runtime status changes */
    onRuntimeStatusChange: (callback: (event: unknown, status: ElectronRuntimeStatus) => void) => void;
    /** Remove download progress listener */
    offDownloadProgress: () => void;
    /** Remove runtime status listener */
    offRuntimeStatusChange: () => void;
  };
  // Local Embeddings Operations (Hugging Face Transformers.js)
  embeddings: {
    /** Get embedding model catalog */
    getCatalog: () => Promise<{ success: boolean; models?: ElectronSuggestedEmbeddingModel[]; error?: string }>;
    /** Get embedding runtime status */
    getStatus: () => Promise<{ success: boolean; status?: ElectronHFEmbeddingRuntimeStatus; error?: string }>;
    /** Load an embedding model */
    loadModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
    /** Unload current embedding model */
    unloadModel: () => Promise<{ success: boolean; error?: string }>;
    /** Generate embedding for single text */
    generate: (text: string, modelId?: string) => Promise<ElectronEmbeddingResult>;
    /** Generate embeddings for multiple texts (batch) */
    generateBatch: (texts: string[], modelId?: string) => Promise<ElectronBatchEmbeddingResult>;
    /** Clear model cache (useful for corrupted downloads) */
    clearCache: (modelId?: string) => Promise<{ success: boolean; error?: string }>;
    /** Listen for status updates */
    onStatusChange: (callback: (status: ElectronHFEmbeddingRuntimeStatus) => void) => void;
    /** Remove status listener */
    offStatusChange: () => void;
  };
  // App info
  platform: string;
  isElectron: boolean;
}

// Extend Window interface
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};





