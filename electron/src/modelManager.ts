/**
 * Model Manager for HydraNote
 * Handles downloading, storing, and managing local ML models from Hugging Face
 *
 * Responsibilities:
 * - Download models with streaming and progress reporting
 * - Manage local model registry (JSON)
 * - Verify file integrity with checksums
 * - Allowlist validation for download sources
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app, BrowserWindow } from 'electron';

// ============================================
// Types
// ============================================

export interface HFModelFile {
  filename: string;
  sha256?: string;
  size: number;
  isPrimary?: boolean;
}

export interface HFModelRef {
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
  /** User-friendly description of what the model is best for */
  bestFor?: string;
  /** Resource requirements info (RAM, GPU, etc.) */
  resourceInfo?: string;
}

export interface LocalModelFile {
  filename: string;
  path: string;
  size: number;
  sha256?: string;
  downloaded: boolean;
}

export type ModelInstallState = 'not_installed' | 'downloading' | 'installed' | 'failed' | 'paused';

export interface LocalModel {
  id: string;
  huggingFaceId: string;
  name: string;
  version: string;
  files: LocalModelFile[];
  state: ModelInstallState;
  installedAt?: string;
  lastUsed?: string;
  totalSize: number;
  downloadedSize: number;
  primaryModelPath?: string;
  architecture?: string;
  contextLength?: number;
  error?: string;
}

export interface ModelDownloadProgress {
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

export interface LocalModelSettings {
  modelsDirectory?: string;
  defaultGpuLayers: number;
  defaultContextLength: number;
  huggingFaceToken?: string;
  autoLoadLastModel: boolean;
}

export const DEFAULT_LOCAL_MODEL_SETTINGS: LocalModelSettings = {
  defaultGpuLayers: -1, // -1 = auto (let node-llama-cpp detect optimal GPU layers based on VRAM)
  defaultContextLength: 4096,
  autoLoadLastModel: false,
};

// ============================================
// Constants
// ============================================

const REGISTRY_FILENAME = 'registry.json';
const SETTINGS_FILENAME = 'model-settings.json';
const MODELS_DIRNAME = 'models';

// Allowlist of domains for downloads
const ALLOWED_DOWNLOAD_HOSTS = [
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'cdn-lfs-us-1.huggingface.co',
  'cdn-lfs-eu-1.huggingface.co',
];

// Suggested models catalog
// Organized by use case with user-friendly descriptions
const CATALOG_MODELS: HFModelRef[] = [
  // ========== BEST FOR TOOL USE / STRUCTURED OUTPUT ==========
  {
    id: 'meetkai/functionary-small-v3.2-GGUF',
    name: 'Functionary Small v3.2',
    description: 'Specialized for function calling and tool use',
    size: 0,
    files: [],
    architecture: 'llama',
    contextLength: 8192,
    bestFor: 'Best choice for HydraNote tools (summarize, search, etc.). Specifically trained to follow instructions and output structured data.',
    resourceInfo: 'Medium: Needs ~6GB RAM. Runs well on most modern computers.',
  },
  {
    id: 'NousResearch/Hermes-3-Llama-3.1-8B-GGUF',
    name: 'Hermes 3 (Llama 3.1 8B)',
    description: 'Excellent for tool use with improved reasoning',
    size: 0,
    files: [],
    architecture: 'llama',
    contextLength: 131072,
    bestFor: 'Excellent at following complex instructions, using tools, and reasoning. Supports very long context.',
    resourceInfo: 'Medium-Heavy: Needs ~8GB RAM. Best with 16GB+ system memory.',
  },
  {
    id: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF',
    name: 'Qwen 2.5 Coder 7B',
    description: 'Optimized for code and structured output',
    size: 0,
    files: [],
    architecture: 'qwen2',
    contextLength: 131072,
    bestFor: 'Excellent for code-related tasks and structured JSON output. Great for tool use and agents.',
    resourceInfo: 'Medium: Needs ~6GB RAM. Runs well on most modern computers.',
  },
  
  // ========== GENERAL PURPOSE ==========
  {
    id: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
    name: 'Llama 3.2 3B Instruct',
    description: 'Fast, lightweight model for quick responses',
    size: 0,
    files: [],
    architecture: 'llama',
    contextLength: 131072,
    bestFor: 'Lightweight and fast. Great for quick tasks on limited hardware. Good starting point.',
    resourceInfo: 'Light: Needs ~3GB RAM. Runs well on most computers.',
  },
  {
    id: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',
    name: 'Llama 3.1 8B Instruct',
    description: 'Meta\'s reliable model with strong instruction following',
    size: 0,
    files: [],
    architecture: 'llama',
    contextLength: 131072,
    bestFor: 'Reliable general-purpose assistant. Good at conversations, writing, and answering questions.',
    resourceInfo: 'Medium-Heavy: Needs ~8GB RAM. Best with 16GB+ system memory.',
  },
  {
    id: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
    name: 'Qwen 2.5 7B Instruct',
    description: 'Alibaba\'s latest model with excellent instruction following',
    size: 0,
    files: [],
    architecture: 'qwen2',
    contextLength: 131072,
    bestFor: 'Excellent at following detailed instructions. Strong at coding and structured tasks.',
    resourceInfo: 'Medium: Needs ~6GB RAM. Runs well on most modern computers.',
  },
  {
    id: 'bartowski/Mistral-Nemo-Instruct-2407-GGUF',
    name: 'Mistral Nemo 12B',
    description: 'Mistral & NVIDIA collaboration with strong multilingual support',
    size: 0,
    files: [],
    architecture: 'mistral',
    contextLength: 131072,
    bestFor: 'Great multilingual support. Strong reasoning and 128k context window.',
    resourceInfo: 'Medium-Heavy: Needs ~10GB RAM. Best with 16GB+ system memory.',
  },
];

// ============================================
// Model Manager Class
// ============================================

export class ModelManager {
  private modelsDir: string;
  private registry: Map<string, LocalModel>;
  private settings: LocalModelSettings;
  private mainWindow: BrowserWindow | null = null;
  private activeDownloads: Map<string, AbortController>;

  constructor() {
    this.modelsDir = path.join(app.getPath('userData'), MODELS_DIRNAME);
    this.registry = new Map();
    this.settings = { ...DEFAULT_LOCAL_MODEL_SETTINGS };
    this.activeDownloads = new Map();

    this.ensureModelsDirectory();
    this.loadRegistry();
    this.loadSettings();
  }

  /**
   * Set the main window for IPC communication
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Get the models directory path
   */
  getModelsDirectory(): string {
    return this.settings.modelsDirectory || this.modelsDir;
  }

  // ============================================
  // Directory & Registry Management
  // ============================================

  private ensureModelsDirectory(): void {
    const dir = this.getModelsDirectory();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private getRegistryPath(): string {
    return path.join(this.getModelsDirectory(), REGISTRY_FILENAME);
  }

  private getSettingsPath(): string {
    return path.join(app.getPath('userData'), SETTINGS_FILENAME);
  }

  private loadRegistry(): void {
    try {
      const registryPath = this.getRegistryPath();
      if (fs.existsSync(registryPath)) {
        const data = fs.readFileSync(registryPath, 'utf-8');
        const models: LocalModel[] = JSON.parse(data);
        this.registry = new Map(models.map(m => [m.id, m]));
      }
    } catch (error) {
      console.error('[ModelManager] Failed to load registry:', error);
      this.registry = new Map();
    }
  }

  private saveRegistry(): void {
    try {
      const registryPath = this.getRegistryPath();
      const models = Array.from(this.registry.values());
      fs.writeFileSync(registryPath, JSON.stringify(models, null, 2));
    } catch (error) {
      console.error('[ModelManager] Failed to save registry:', error);
    }
  }

  private loadSettings(): void {
    try {
      const settingsPath = this.getSettingsPath();
      if (fs.existsSync(settingsPath)) {
        const data = fs.readFileSync(settingsPath, 'utf-8');
        this.settings = { ...DEFAULT_LOCAL_MODEL_SETTINGS, ...JSON.parse(data) };
      }
    } catch (error) {
      console.error('[ModelManager] Failed to load settings:', error);
    }
  }

  // ============================================
  // Public API - Settings
  // ============================================

  getSettings(): LocalModelSettings {
    return { ...this.settings };
  }

  saveSettings(settings: LocalModelSettings): void {
    this.settings = { ...this.settings, ...settings };
    try {
      const settingsPath = this.getSettingsPath();
      fs.writeFileSync(settingsPath, JSON.stringify(this.settings, null, 2));
    } catch (error) {
      console.error('[ModelManager] Failed to save settings:', error);
    }
  }

  // ============================================
  // Public API - Catalog
  // ============================================

  getCatalog(): HFModelRef[] {
    return [...CATALOG_MODELS];
  }

  /**
   * Fetch model info from Hugging Face API
   */
  async fetchModelInfo(repoId: string): Promise<HFModelRef> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (this.settings.huggingFaceToken) {
      headers['Authorization'] = `Bearer ${this.settings.huggingFaceToken}`;
    }

    // Fetch repo info
    const repoResponse = await fetch(`https://huggingface.co/api/models/${repoId}`, { headers });
    if (!repoResponse.ok) {
      throw new Error(`Failed to fetch model info: ${repoResponse.statusText}`);
    }
    const repoData = await repoResponse.json();

    // Fetch file list
    const filesResponse = await fetch(`https://huggingface.co/api/models/${repoId}/tree/main`, { headers });
    if (!filesResponse.ok) {
      throw new Error(`Failed to fetch file list: ${filesResponse.statusText}`);
    }
    const filesData = await filesResponse.json();

    // Filter for GGUF files
    const ggufFiles: HFModelFile[] = filesData
      .filter((f: { path: string; type: string }) => f.type === 'file' && f.path.endsWith('.gguf'))
      .map((f: { path: string; size?: number; lfs?: { sha256?: string } }) => ({
        filename: f.path,
        size: f.size || 0,
        sha256: f.lfs?.sha256,
        isPrimary: f.path.includes('Q4_K_M') || f.path.includes('Q5_K_M'),
      }));

    const totalSize = ggufFiles.reduce((sum, f) => sum + f.size, 0);

    return {
      id: repoId,
      name: repoData.modelId?.split('/').pop() || repoId,
      description: repoData.description || '',
      size: totalSize,
      files: ggufFiles,
      gated: repoData.gated || false,
      architecture: repoData.config?.model_type,
      contextLength: repoData.config?.max_position_embeddings,
    };
  }

  /**
   * Parse a Hugging Face URL or repo ID to extract the repo ID
   * Supports formats:
   * - "owner/repo" (direct repo ID)
   * - "https://huggingface.co/owner/repo"
   * - "https://huggingface.co/owner/repo/tree/main"
   * - "https://huggingface.co/owner/repo/blob/main/file.gguf"
   */
  parseHuggingFaceUrl(input: string): string | null {
    // Trim whitespace
    const trimmed = input.trim();
    
    // Check if it's already a repo ID (owner/repo format)
    if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(trimmed)) {
      return trimmed;
    }
    
    // Try to parse as URL
    try {
      const url = new URL(trimmed);
      
      // Must be huggingface.co
      if (!url.hostname.endsWith('huggingface.co')) {
        return null;
      }
      
      // Extract path parts (e.g., /owner/repo/tree/main -> ['', 'owner', 'repo', 'tree', 'main'])
      const pathParts = url.pathname.split('/').filter(Boolean);
      
      // Need at least owner and repo
      if (pathParts.length < 2) {
        return null;
      }
      
      // Return owner/repo
      return `${pathParts[0]}/${pathParts[1]}`;
    } catch {
      return null;
    }
  }

  /**
   * Validate a custom model URL/repo ID
   * Checks if the model exists and has GGUF files
   */
  async validateCustomModel(input: string): Promise<{
    valid: boolean;
    repoId?: string;
    model?: HFModelRef;
    error?: string;
  }> {
    // Parse the input to get repo ID
    const repoId = this.parseHuggingFaceUrl(input);
    
    if (!repoId) {
      return {
        valid: false,
        error: 'Invalid format. Use "owner/repo" or a Hugging Face URL (e.g., https://huggingface.co/owner/repo)',
      };
    }
    
    try {
      // Fetch model info
      const model = await this.fetchModelInfo(repoId);
      
      // Check if it has GGUF files
      if (model.files.length === 0) {
        return {
          valid: false,
          repoId,
          error: `No GGUF files found in ${repoId}. This model may not be compatible with local inference.`,
        };
      }
      
      // Check if gated and no token
      if (model.gated && !this.settings.huggingFaceToken) {
        return {
          valid: false,
          repoId,
          model,
          error: 'This is a gated model. Please add your Hugging Face token first.',
        };
      }
      
      return {
        valid: true,
        repoId,
        model,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      // Provide helpful error messages
      if (message.includes('404') || message.includes('Not Found')) {
        return {
          valid: false,
          repoId,
          error: `Model "${repoId}" not found on Hugging Face. Check the URL or repo ID.`,
        };
      }
      
      if (message.includes('401') || message.includes('Unauthorized')) {
        return {
          valid: false,
          repoId,
          error: 'This model requires authentication. Please add your Hugging Face token.',
        };
      }
      
      return {
        valid: false,
        repoId,
        error: `Failed to validate model: ${message}`,
      };
    }
  }

  // ============================================
  // Public API - Registry
  // ============================================

  getInstalledModels(): LocalModel[] {
    return Array.from(this.registry.values());
  }

  getModel(modelId: string): LocalModel | undefined {
    return this.registry.get(modelId);
  }

  // ============================================
  // Public API - Download
  // ============================================

  /**
   * Install a model from Hugging Face
   */
  async installModel(modelRef: HFModelRef): Promise<string> {
    // Generate local model ID
    const modelId = crypto.randomUUID();

    // Create model directory
    const modelDir = path.join(this.getModelsDirectory(), this.sanitizeRepoId(modelRef.id));
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
    }

    // Determine which file to download (prefer Q4_K_M for balance of quality/size)
    const primaryFile = modelRef.files.find(f => f.isPrimary) ||
      modelRef.files.find(f => f.filename.includes('Q4_K_M')) ||
      modelRef.files.find(f => f.filename.includes('Q5_K_M')) ||
      modelRef.files[0];

    if (!primaryFile) {
      throw new Error('No downloadable model files found');
    }

    // Create registry entry
    const localModel: LocalModel = {
      id: modelId,
      huggingFaceId: modelRef.id,
      name: modelRef.name,
      version: 'main',
      files: [{
        filename: primaryFile.filename,
        path: path.join(modelDir, primaryFile.filename),
        size: primaryFile.size,
        sha256: primaryFile.sha256,
        downloaded: false,
      }],
      state: 'downloading',
      totalSize: primaryFile.size,
      downloadedSize: 0,
      architecture: modelRef.architecture,
      contextLength: modelRef.contextLength,
    };

    this.registry.set(modelId, localModel);
    this.saveRegistry();

    // Start download
    this.downloadModel(modelId, modelRef.id, primaryFile).catch(error => {
      console.error('[ModelManager] Download failed:', error);
      const model = this.registry.get(modelId);
      if (model) {
        model.state = 'failed';
        model.error = error.message;
        this.saveRegistry();
        this.emitStatusChange();
      }
    });

    return modelId;
  }

  /**
   * Cancel an ongoing download
   */
  cancelInstall(modelId: string): boolean {
    const controller = this.activeDownloads.get(modelId);
    if (controller) {
      controller.abort();
      this.activeDownloads.delete(modelId);

      const model = this.registry.get(modelId);
      if (model) {
        model.state = 'paused';
        this.saveRegistry();
      }
      return true;
    }
    return false;
  }

  /**
   * Remove an installed model
   */
  async removeModel(modelId: string): Promise<boolean> {
    const model = this.registry.get(modelId);
    if (!model) {
      return false;
    }

    // Cancel any ongoing download
    this.cancelInstall(modelId);

    // Delete files
    for (const file of model.files) {
      try {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (error) {
        console.error(`[ModelManager] Failed to delete file ${file.path}:`, error);
      }
    }

    // Try to remove the model directory if empty
    const modelDir = path.dirname(model.files[0]?.path || '');
    if (modelDir && fs.existsSync(modelDir)) {
      try {
        const remaining = fs.readdirSync(modelDir);
        if (remaining.length === 0) {
          fs.rmdirSync(modelDir);
        }
      } catch {
        // Ignore
      }
    }

    // Remove from registry
    this.registry.delete(modelId);
    this.saveRegistry();

    return true;
  }

  // ============================================
  // Download Implementation
  // ============================================

  private async downloadModel(
    modelId: string,
    repoId: string,
    file: HFModelFile
  ): Promise<void> {
    const model = this.registry.get(modelId);
    if (!model) return;

    const localFile = model.files[0];
    const downloadUrl = `https://huggingface.co/${repoId}/resolve/main/${file.filename}`;

    // Validate URL
    const url = new URL(downloadUrl);
    if (!ALLOWED_DOWNLOAD_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) {
      throw new Error(`Download from ${url.hostname} is not allowed`);
    }

    // Setup abort controller
    const controller = new AbortController();
    this.activeDownloads.set(modelId, controller);

    const headers: Record<string, string> = {};
    if (this.settings.huggingFaceToken) {
      headers['Authorization'] = `Bearer ${this.settings.huggingFaceToken}`;
    }

    try {
      const response = await fetch(downloadUrl, {
        headers,
        signal: controller.signal,
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      const totalSize = parseInt(response.headers.get('content-length') || '0', 10) || file.size;
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body not readable');
      }

      // Open file for writing
      const filePath = localFile.path;
      const writeStream = fs.createWriteStream(filePath);
      const hashStream = crypto.createHash('sha256');

      let downloaded = 0;
      let lastProgressTime = Date.now();
      let lastDownloaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        writeStream.write(value);
        hashStream.update(value);
        downloaded += value.length;

        // Calculate speed and emit progress
        const now = Date.now();
        const elapsed = (now - lastProgressTime) / 1000;
        if (elapsed >= 0.5) {
          const speed = (downloaded - lastDownloaded) / elapsed;
          const eta = speed > 0 ? (totalSize - downloaded) / speed : undefined;

          this.emitProgress({
            modelId,
            currentFile: file.filename,
            fileDownloaded: downloaded,
            fileTotal: totalSize,
            totalDownloaded: downloaded,
            totalSize,
            speed,
            eta,
            status: 'downloading',
          });

          lastProgressTime = now;
          lastDownloaded = downloaded;
        }

        // Update registry
        model.downloadedSize = downloaded;
      }

      writeStream.end();

      // Wait for write to complete
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      // Verify checksum if provided
      const computedHash = hashStream.digest('hex');
      if (file.sha256 && computedHash !== file.sha256) {
        fs.unlinkSync(filePath);
        throw new Error(`Checksum mismatch: expected ${file.sha256}, got ${computedHash}`);
      }

      // Update registry
      localFile.downloaded = true;
      localFile.sha256 = computedHash;
      model.state = 'installed';
      model.installedAt = new Date().toISOString();
      model.primaryModelPath = filePath;
      this.saveRegistry();

      this.emitProgress({
        modelId,
        currentFile: file.filename,
        fileDownloaded: totalSize,
        fileTotal: totalSize,
        totalDownloaded: totalSize,
        totalSize,
        speed: 0,
        status: 'completed',
      });

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log('[ModelManager] Download cancelled');
      } else {
        throw error;
      }
    } finally {
      this.activeDownloads.delete(modelId);
    }
  }

  // ============================================
  // Helpers
  // ============================================

  private sanitizeRepoId(repoId: string): string {
    return repoId.replace(/\//g, '--');
  }

  private emitProgress(progress: ModelDownloadProgress): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('models:progress', progress);
    }
  }

  private emitStatusChange(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // Will be implemented with runtime status
    }
  }

  /**
   * Update last used timestamp for a model
   */
  updateLastUsed(modelId: string): void {
    const model = this.registry.get(modelId);
    if (model) {
      model.lastUsed = new Date().toISOString();
      this.saveRegistry();
    }
  }
}

// ============================================
// Singleton Instance
// ============================================

let modelManagerInstance: ModelManager | null = null;

export function getModelManager(): ModelManager {
  if (!modelManagerInstance) {
    modelManagerInstance = new ModelManager();
  }
  return modelManagerInstance;
}
