/**
 * Local Model Service
 * Provides a clean API for interacting with local Hugging Face models
 * via the Electron IPC bridge.
 *
 * This service is the frontend interface to the model manager and
 * inference runtime running in the Electron main process.
 */

import type {
  HFModelRef,
  LocalModel,
  LocalModelSettings,
  ModelDownloadProgress,
  RuntimeStatus,
  HardwareInfo,
  LLMMessage,
  LocalInferenceOptions,
} from '../types';
import { DEFAULT_LOCAL_MODEL_SETTINGS } from '../types';

// ============================================
// Environment Detection
// ============================================

/**
 * Check if running in Electron with models API available
 */
export function isLocalModelsAvailable(): boolean {
  return !!(window.electronAPI?.models);
}

// ============================================
// Catalog & Model Info
// ============================================

/**
 * Get the suggested models catalog
 */
export async function getModelCatalog(): Promise<HFModelRef[]> {
  if (!isLocalModelsAvailable()) {
    throw new Error('Local models are only available in the Electron app');
  }

  const result = await window.electronAPI!.models.getCatalog();
  if (!result.success) {
    throw new Error(result.error || 'Failed to get model catalog');
  }

  return result.models || [];
}

/**
 * Fetch detailed model info from Hugging Face
 */
export async function fetchModelInfo(repoId: string): Promise<HFModelRef> {
  if (!isLocalModelsAvailable()) {
    throw new Error('Local models are only available in the Electron app');
  }

  const result = await window.electronAPI!.models.fetchModelInfo(repoId);
  if (!result.success || !result.model) {
    throw new Error(result.error || 'Failed to fetch model info');
  }

  return result.model;
}

/**
 * Validation result for custom model URL/repo
 */
export interface CustomModelValidationResult {
  valid: boolean;
  repoId?: string;
  model?: HFModelRef;
  error?: string;
}

/**
 * Validate a custom model URL or repo ID
 * Checks if the model exists on Hugging Face and has compatible GGUF files
 */
export async function validateCustomModel(input: string): Promise<CustomModelValidationResult> {
  if (!isLocalModelsAvailable()) {
    return {
      valid: false,
      error: 'Local models are only available in the Electron app',
    };
  }

  const result = await window.electronAPI!.models.validateCustomUrl(input);
  
  if (!result.success) {
    return {
      valid: false,
      error: result.error || 'Failed to validate model',
    };
  }

  return {
    valid: result.valid,
    repoId: result.repoId,
    model: result.model,
    error: result.error,
  };
}

// ============================================
// Installed Models
// ============================================

/**
 * Get all installed models
 */
export async function getInstalledModels(): Promise<LocalModel[]> {
  if (!isLocalModelsAvailable()) {
    return [];
  }

  const result = await window.electronAPI!.models.getInstalled();
  if (!result.success) {
    throw new Error(result.error || 'Failed to get installed models');
  }

  // Convert date strings back to Date objects
  return (result.models || []).map(model => ({
    ...model,
    installedAt: model.installedAt ? new Date(model.installedAt) : undefined,
    lastUsed: model.lastUsed ? new Date(model.lastUsed) : undefined,
  }));
}

/**
 * Get a specific installed model
 */
export async function getInstalledModel(modelId: string): Promise<LocalModel | null> {
  if (!isLocalModelsAvailable()) {
    return null;
  }

  const result = await window.electronAPI!.models.getModel(modelId);
  if (!result.success) {
    return null;
  }

  if (!result.model) {
    return null;
  }

  return {
    ...result.model,
    installedAt: result.model.installedAt ? new Date(result.model.installedAt) : undefined,
    lastUsed: result.model.lastUsed ? new Date(result.model.lastUsed) : undefined,
  };
}

// ============================================
// Model Installation
// ============================================

/**
 * Install a model from Hugging Face
 * Returns the local model ID
 */
export async function installModel(modelRef: HFModelRef): Promise<string> {
  if (!isLocalModelsAvailable()) {
    throw new Error('Local models are only available in the Electron app');
  }

  const result = await window.electronAPI!.models.install(modelRef);
  if (!result.success || !result.modelId) {
    throw new Error(result.error || 'Failed to install model');
  }

  return result.modelId;
}

/**
 * Cancel an ongoing model installation
 */
export async function cancelInstallation(modelId: string): Promise<void> {
  if (!isLocalModelsAvailable()) {
    throw new Error('Local models are only available in the Electron app');
  }

  const result = await window.electronAPI!.models.cancelInstall(modelId);
  if (!result.success) {
    throw new Error(result.error || 'Failed to cancel installation');
  }
}

/**
 * Remove an installed model
 */
export async function removeModel(modelId: string): Promise<void> {
  if (!isLocalModelsAvailable()) {
    throw new Error('Local models are only available in the Electron app');
  }

  const result = await window.electronAPI!.models.remove(modelId);
  if (!result.success) {
    throw new Error(result.error || 'Failed to remove model');
  }
}

// ============================================
// Download Progress
// ============================================

type ProgressCallback = (progress: ModelDownloadProgress) => void;
let progressCallbacks: ProgressCallback[] = [];
let progressListenerActive = false;

/**
 * Subscribe to download progress updates
 */
export function onDownloadProgress(callback: ProgressCallback): () => void {
  if (!isLocalModelsAvailable()) {
    return () => {};
  }

  progressCallbacks.push(callback);

  // Set up the IPC listener if not already active
  if (!progressListenerActive) {
    progressListenerActive = true;
    window.electronAPI!.models.onDownloadProgress((progress: unknown) => {
      progressCallbacks.forEach(cb => cb(progress as ModelDownloadProgress));
    });
  }

  // Return unsubscribe function
  return () => {
    progressCallbacks = progressCallbacks.filter(cb => cb !== callback);
    if (progressCallbacks.length === 0 && progressListenerActive) {
      window.electronAPI!.models.offDownloadProgress();
      progressListenerActive = false;
    }
  };
}

// ============================================
// Runtime Status
// ============================================

type StatusCallback = (status: RuntimeStatus) => void;
let statusCallbacks: StatusCallback[] = [];
let statusListenerActive = false;

/**
 * Get current runtime status
 */
export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  if (!isLocalModelsAvailable()) {
    return {
      running: false,
      ready: false,
      error: 'Local models are only available in the Electron app',
    };
  }

  const result = await window.electronAPI!.models.getRuntimeStatus();
  if (!result.success || !result.status) {
    return {
      running: false,
      ready: false,
      error: result.error || 'Failed to get runtime status',
    };
  }

  return result.status;
}

/**
 * Get hardware acceleration info (CUDA, Metal, Vulkan, CPU)
 * Returns null if not running in Electron
 */
export async function getHardwareInfo(): Promise<HardwareInfo | null> {
  if (!isLocalModelsAvailable()) {
    return null;
  }

  try {
    const result = await window.electronAPI!.models.getHardwareInfo();
    if (!result.success || !result.info) {
      return {
        backend: 'unknown',
        supportedBackends: [],
      };
    }

    return result.info;
  } catch (error) {
    console.error('[LocalModelService] Failed to get hardware info:', error);
    return null;
  }
}

/**
 * Subscribe to runtime status updates
 */
export function onRuntimeStatusChange(callback: StatusCallback): () => void {
  if (!isLocalModelsAvailable()) {
    return () => {};
  }

  statusCallbacks.push(callback);

  // Set up the IPC listener if not already active
  if (!statusListenerActive) {
    statusListenerActive = true;
    window.electronAPI!.models.onRuntimeStatusChange((status: unknown) => {
      statusCallbacks.forEach(cb => cb(status as RuntimeStatus));
    });
  }

  // Return unsubscribe function
  return () => {
    statusCallbacks = statusCallbacks.filter(cb => cb !== callback);
    if (statusCallbacks.length === 0 && statusListenerActive) {
      window.electronAPI!.models.offRuntimeStatusChange();
      statusListenerActive = false;
    }
  };
}

// ============================================
// Model Loading
// ============================================

/**
 * Load a model into the inference runtime
 */
export async function loadModel(
  modelId: string,
  options?: { gpuLayers?: number; contextLength?: number }
): Promise<void> {
  if (!isLocalModelsAvailable()) {
    throw new Error('Local models are only available in the Electron app');
  }

  const result = await window.electronAPI!.models.loadModel(modelId, options);
  if (!result.success) {
    throw new Error(result.error || 'Failed to load model');
  }
}

/**
 * Unload the current model from runtime
 */
export async function unloadModel(): Promise<void> {
  if (!isLocalModelsAvailable()) {
    throw new Error('Local models are only available in the Electron app');
  }

  const result = await window.electronAPI!.models.unloadModel();
  if (!result.success) {
    throw new Error(result.error || 'Failed to unload model');
  }
}

// ============================================
// Inference
// ============================================

/**
 * Run inference on the loaded model
 */
export async function runInference(
  messages: LLMMessage[],
  options?: LocalInferenceOptions
): Promise<string> {
  if (!isLocalModelsAvailable()) {
    throw new Error('Local models are only available in the Electron app');
  }

  // Convert LLMMessage to the expected format
  const inferenceMessages = messages.map(m => ({
    role: m.role as 'system' | 'user' | 'assistant',
    content: m.content,
  }));

  // DEBUG: Log what we're sending to the inference runtime
  console.log('[LocalModelService] runInference called with:');
  console.log('  - Message count:', inferenceMessages.length);
  inferenceMessages.forEach((m, i) => {
    console.log(`  - [${i}] ${m.role}: "${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}" (${m.content.length} chars)`);
  });
  console.log('  - Options:', options);

  const result = await window.electronAPI!.models.infer(inferenceMessages, options);
  
  console.log('[LocalModelService] Inference result:', {
    success: result.success,
    contentLength: result.content?.length,
    error: result.error,
    contentPreview: result.content?.substring(0, 200),
  });
  
  if (!result.success) {
    throw new Error(result.error || 'Inference failed');
  }

  return result.content || '';
}

// ============================================
// Settings
// ============================================

const SETTINGS_STORAGE_KEY = 'hydranote_local_model_settings';

/**
 * Load local model settings
 * Combines localStorage cache with Electron settings
 */
export async function loadLocalModelSettings(): Promise<LocalModelSettings> {
  // First try to get from Electron
  if (isLocalModelsAvailable()) {
    const result = await window.electronAPI!.models.getSettings();
    if (result.success && result.settings) {
      // Cache in localStorage
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(result.settings));
      return result.settings;
    }
  }

  // Fall back to localStorage
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_LOCAL_MODEL_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }

  return { ...DEFAULT_LOCAL_MODEL_SETTINGS };
}

/**
 * Save local model settings
 */
export async function saveLocalModelSettings(settings: LocalModelSettings): Promise<void> {
  // Save to localStorage first
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));

  // Then save to Electron if available
  if (isLocalModelsAvailable()) {
    const result = await window.electronAPI!.models.saveSettings(settings);
    if (!result.success) {
      console.error('Failed to save settings to Electron:', result.error);
    }
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format download speed in human-readable format
 */
export function formatSpeed(bytesPerSecond: number): string {
  return formatFileSize(bytesPerSecond) + '/s';
}

/**
 * Format remaining time in human-readable format
 */
export function formatEta(seconds: number): string {
  if (!seconds || seconds <= 0) return '--';
  
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

/**
 * Get download progress percentage
 */
export function getProgressPercent(progress: ModelDownloadProgress): number {
  if (progress.totalSize === 0) return 0;
  return Math.round((progress.totalDownloaded / progress.totalSize) * 100);
}
