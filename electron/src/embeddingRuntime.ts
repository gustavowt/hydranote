/**
 * Embedding Runtime for HydraNote
 * Handles local embedding generation using Transformers.js (Hugging Face)
 *
 * Responsibilities:
 * - Load and manage embedding models
 * - Generate embeddings for text
 * - Report loading progress to renderer
 * - Cache loaded models for performance
 */

import { BrowserWindow, app } from 'electron';
import * as path from 'path';

// ============================================
// Types
// ============================================

export type HFEmbeddingModelStatus = 'not_loaded' | 'loading' | 'ready' | 'error';

export interface HFEmbeddingRuntimeStatus {
  status: HFEmbeddingModelStatus;
  loadedModel?: string;
  error?: string;
  progress?: number;
}

export interface EmbeddingResult {
  success: boolean;
  embedding?: number[];
  error?: string;
}

export interface BatchEmbeddingResult {
  success: boolean;
  embeddings?: number[][];
  error?: string;
}

// Suggested models catalog
export interface SuggestedEmbeddingModel {
  id: string;
  name: string;
  description: string;
  dimensions: number;
}

export const SUGGESTED_EMBEDDING_MODELS: SuggestedEmbeddingModel[] = [
  { id: 'nomic-ai/nomic-embed-text-v1.5', name: 'Nomic Embed v1.5', description: 'High quality, fast (768 dims, ~137MB)', dimensions: 768 },
  { id: 'Xenova/all-MiniLM-L6-v2', name: 'MiniLM L6 v2', description: 'Fast & compact (384 dims, ~23MB)', dimensions: 384 },
  { id: 'Xenova/bge-small-en-v1.5', name: 'BGE Small EN', description: 'High quality small (384 dims, ~33MB)', dimensions: 384 },
  { id: 'Xenova/gte-small', name: 'GTE Small', description: 'Alibaba GTE small (384 dims, ~33MB)', dimensions: 384 },
  { id: 'Xenova/bge-base-en-v1.5', name: 'BGE Base EN', description: 'Best quality (768 dims, ~109MB)', dimensions: 768 },
];

// ============================================
// Embedding Runtime Class
// ============================================

class EmbeddingRuntime {
  private mainWindow: BrowserWindow | null = null;
  private status: HFEmbeddingRuntimeStatus = { status: 'not_loaded' };
  private pipeline: any = null;
  private loadedModelId: string | null = null;
  private modelLoadPromise: Promise<void> | null = null;

  /**
   * Set the main window for IPC communication
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * Get current runtime status
   */
  getStatus(): HFEmbeddingRuntimeStatus {
    return { ...this.status };
  }

  /**
   * Get suggested embedding models catalog
   */
  getCatalog(): SuggestedEmbeddingModel[] {
    return SUGGESTED_EMBEDDING_MODELS;
  }

  /**
   * Check if a model is loaded and ready
   */
  isReady(): boolean {
    return this.status.status === 'ready' && this.pipeline !== null;
  }

  /**
   * Check if the requested model is already loaded
   */
  isModelLoaded(modelId: string): boolean {
    return this.isReady() && this.loadedModelId === modelId;
  }

  /**
   * Load an embedding model
   */
  async loadModel(modelId: string): Promise<void> {
    // If already loading or loaded with same model, return existing promise
    if (this.loadedModelId === modelId) {
      if (this.status.status === 'ready') {
        return;
      }
      if (this.modelLoadPromise) {
        return this.modelLoadPromise;
      }
    }

    // Unload current model if different
    if (this.loadedModelId && this.loadedModelId !== modelId) {
      await this.unloadModel();
    }

    this.modelLoadPromise = this._loadModelInternal(modelId);
    return this.modelLoadPromise;
  }

  private async _loadModelInternal(modelId: string): Promise<void> {
    console.log(`[EmbeddingRuntime] Loading model: ${modelId}`);
    
    this.updateStatus({ status: 'loading', loadedModel: modelId, progress: 0 });

    try {
      // Dynamic import of @huggingface/transformers
      const { pipeline, env } = await import('@huggingface/transformers');

      // Configure cache directory in userData
      const cacheDir = path.join(app.getPath('userData'), 'embedding-models');
      env.cacheDir = cacheDir;
      
      // Allow local models
      env.allowLocalModels = true;
      env.allowRemoteModels = true;

      console.log(`[EmbeddingRuntime] Cache directory: ${cacheDir}`);
      console.log(`[EmbeddingRuntime] Creating pipeline for model: ${modelId}`);

      // Create the feature extraction pipeline with progress callback
      // Use fp32 dtype for maximum compatibility with different models
      this.pipeline = await pipeline('feature-extraction', modelId, {
        dtype: 'fp32',
        progress_callback: (progress: any) => {
          if (progress.status === 'progress' && progress.progress !== undefined) {
            const percent = Math.round(progress.progress);
            this.updateStatus({ status: 'loading', loadedModel: modelId, progress: percent });
          } else if (progress.status === 'done') {
            console.log(`[EmbeddingRuntime] Download complete for: ${progress.file || 'model'}`);
          }
        },
      });

      this.loadedModelId = modelId;
      this.updateStatus({ status: 'ready', loadedModel: modelId });
      console.log(`[EmbeddingRuntime] Model loaded successfully: ${modelId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load model';
      console.error(`[EmbeddingRuntime] Error loading model:`, error);
      this.updateStatus({ status: 'error', error: errorMessage });
      this.pipeline = null;
      this.loadedModelId = null;
      throw error;
    } finally {
      this.modelLoadPromise = null;
    }
  }

  /**
   * Unload the current model
   */
  async unloadModel(): Promise<void> {
    if (this.pipeline) {
      console.log(`[EmbeddingRuntime] Unloading model: ${this.loadedModelId}`);
      // Transformers.js pipelines don't have explicit cleanup, but we can null the reference
      this.pipeline = null;
      this.loadedModelId = null;
      this.updateStatus({ status: 'not_loaded' });
    }
  }

  /**
   * Clear model cache for a specific model or all models
   */
  async clearModelCache(modelId?: string): Promise<void> {
    const fs = await import('fs/promises');
    const cacheDir = path.join(app.getPath('userData'), 'embedding-models');
    
    console.log(`[EmbeddingRuntime] Clearing cache: ${modelId || 'all models'}`);

    try {
      if (modelId) {
        // Clear specific model - the cache structure uses model name as folder
        const modelCachePath = path.join(cacheDir, modelId.replace('/', '--'));
        try {
          await fs.rm(modelCachePath, { recursive: true, force: true });
          console.log(`[EmbeddingRuntime] Cleared cache for: ${modelId}`);
        } catch {
          // Also try without the namespace transformation
          const altPath = path.join(cacheDir, 'models--' + modelId.replace('/', '--'));
          await fs.rm(altPath, { recursive: true, force: true });
          console.log(`[EmbeddingRuntime] Cleared cache (alt path) for: ${modelId}`);
        }
      } else {
        // Clear entire cache
        await fs.rm(cacheDir, { recursive: true, force: true });
        console.log(`[EmbeddingRuntime] Cleared entire embedding cache`);
      }

      // Unload if the cleared model was loaded
      if (this.loadedModelId === modelId || !modelId) {
        this.pipeline = null;
        this.loadedModelId = null;
        this.updateStatus({ status: 'not_loaded' });
      }
    } catch (error) {
      console.error(`[EmbeddingRuntime] Error clearing cache:`, error);
      throw error;
    }
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string, modelId?: string): Promise<EmbeddingResult> {
    try {
      // Load model if needed
      if (modelId && !this.isModelLoaded(modelId)) {
        await this.loadModel(modelId);
      }

      if (!this.isReady()) {
        return { success: false, error: 'Model not loaded' };
      }

      console.log(`[EmbeddingRuntime] Generating embedding for text (${text.length} chars)`);

      // Generate embedding using the pipeline
      const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
      
      // Convert to regular array
      const embedding = Array.from(output.data as Float32Array);

      console.log(`[EmbeddingRuntime] Generated embedding with ${embedding.length} dimensions`);

      return { success: true, embedding };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate embedding';
      console.error(`[EmbeddingRuntime] Error generating embedding:`, error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   */
  async generateEmbeddings(texts: string[], modelId?: string): Promise<BatchEmbeddingResult> {
    try {
      // Load model if needed
      if (modelId && !this.isModelLoaded(modelId)) {
        await this.loadModel(modelId);
      }

      if (!this.isReady()) {
        return { success: false, error: 'Model not loaded' };
      }

      console.log(`[EmbeddingRuntime] Generating embeddings for ${texts.length} texts`);

      const embeddings: number[][] = [];

      // Process texts - Transformers.js handles batching internally but we'll process one at a time
      // for better progress tracking and memory management
      for (const text of texts) {
        const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
        embeddings.push(Array.from(output.data as Float32Array));
      }

      console.log(`[EmbeddingRuntime] Generated ${embeddings.length} embeddings`);

      return { success: true, embeddings };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate embeddings';
      console.error(`[EmbeddingRuntime] Error generating embeddings:`, error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Update status and notify renderer
   */
  private updateStatus(status: Partial<HFEmbeddingRuntimeStatus>): void {
    this.status = { ...this.status, ...status };
    
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('embeddings:status', this.status);
    }
  }
}

// ============================================
// Singleton Instance
// ============================================

let embeddingRuntimeInstance: EmbeddingRuntime | null = null;

export function getEmbeddingRuntime(): EmbeddingRuntime {
  if (!embeddingRuntimeInstance) {
    embeddingRuntimeInstance = new EmbeddingRuntime();
  }
  return embeddingRuntimeInstance;
}

/**
 * Check if the embedding runtime is available
 */
export async function isEmbeddingRuntimeAvailable(): Promise<boolean> {
  try {
    await import('@huggingface/transformers');
    return true;
  } catch {
    return false;
  }
}
