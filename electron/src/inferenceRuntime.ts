/**
 * Inference Runtime for HydraNote
 * Handles loading and running local GGUF models using node-llama-cpp
 *
 * This is an adapter layer that abstracts the runtime implementation,
 * making it easier to swap out or support multiple backends in the future.
 */

import { BrowserWindow } from 'electron';
import { getModelManager } from './modelManager';

// Dynamic import helper to bypass CommonJS transformation
// node-llama-cpp v3 is ESM-only, so we need true dynamic import
const dynamicImport = new Function('modulePath', 'return import(modulePath)') as (modulePath: string) => Promise<unknown>;

// ============================================
// Types
// ============================================

export interface RuntimeStatus {
  running: boolean;
  loadedModelId?: string;
  loadedModelName?: string;
  memoryUsage?: number;
  gpuMemoryUsage?: number;
  ready: boolean;
  error?: string;
}

export interface InferenceMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InferenceOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  stream?: boolean;
}

export interface InferenceResult {
  content: string;
  tokensGenerated: number;
  tokensPrompt: number;
  timeMs: number;
}

export interface LoadModelOptions {
  gpuLayers?: number;
  contextLength?: number;
}

// ============================================
// Inference Runtime Class
// ============================================

/**
 * InferenceRuntime manages the lifecycle of local model inference.
 * 
 * Implementation note: This uses dynamic imports for node-llama-cpp
 * to handle cases where the dependency might not be installed yet.
 */
export class InferenceRuntime {
  private mainWindow: BrowserWindow | null = null;
  private status: RuntimeStatus = {
    running: false,
    ready: false,
  };

  // Runtime state - will be populated when node-llama-cpp is loaded
  private llama: unknown = null;
  private model: unknown = null;
  private context: unknown = null;
  private session: unknown = null;
  private loadedModelId: string | null = null;

  constructor() {
    // Runtime starts uninitialized
  }

  /**
   * Set the main window for IPC communication
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Get current runtime status
   */
  getStatus(): RuntimeStatus {
    return { ...this.status };
  }

  /**
   * Check if runtime is ready for inference
   */
  isReady(): boolean {
    return this.status.ready && this.model !== null;
  }

  /**
   * Load a model into the runtime
   */
  async loadModel(modelId: string, options: LoadModelOptions = {}): Promise<void> {
    const modelManager = getModelManager();
    const model = modelManager.getModel(modelId);

    if (!model) {
      throw new Error(`Model ${modelId} not found in registry`);
    }

    if (model.state !== 'installed') {
      throw new Error(`Model ${modelId} is not installed (state: ${model.state})`);
    }

    if (!model.primaryModelPath) {
      throw new Error(`Model ${modelId} has no primary model path`);
    }

    // Unload any existing model first
    if (this.model) {
      await this.unloadModel();
    }

    this.updateStatus({
      running: true,
      ready: false,
      loadedModelId: modelId,
      loadedModelName: model.name,
    });

    try {
      // Dynamically import node-llama-cpp
      // This allows the app to run even if the dependency isn't installed
      // Using dynamicImport helper to bypass CommonJS transformation
      const nodeLlamaCpp = await dynamicImport('node-llama-cpp') as typeof import('node-llama-cpp');
      const { getLlama, LlamaChatSession } = nodeLlamaCpp;

      // Initialize llama
      this.llama = await getLlama();

      // Load the model
      const gpuLayers = options.gpuLayers ?? 0;
      const contextLength = options.contextLength ?? model.contextLength ?? 4096;

      console.log(`[InferenceRuntime] Loading model: ${model.primaryModelPath}`);
      console.log(`[InferenceRuntime] GPU layers: ${gpuLayers}, Context: ${contextLength}`);

      this.model = await (this.llama as any).loadModel({
        modelPath: model.primaryModelPath,
        gpuLayers,
      });

      // Create context
      this.context = await (this.model as any).createContext({
        contextSize: contextLength,
      });

      // Create chat session
      this.session = new LlamaChatSession({
        contextSequence: (this.context as any).getSequence(),
      });

      this.loadedModelId = modelId;
      modelManager.updateLastUsed(modelId);

      this.updateStatus({
        running: true,
        ready: true,
        loadedModelId: modelId,
        loadedModelName: model.name,
      });

      console.log(`[InferenceRuntime] Model loaded successfully: ${model.name}`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load model';
      console.error('[InferenceRuntime] Failed to load model:', error);

      this.updateStatus({
        running: false,
        ready: false,
        error: errorMessage,
      });

      throw error;
    }
  }

  /**
   * Unload the current model
   */
  async unloadModel(): Promise<void> {
    try {
      if (this.session) {
        if (typeof (this.session as any).dispose === 'function') {
          await (this.session as any).dispose();
        }
        this.session = null;
      }

      if (this.context) {
        if (typeof (this.context as any).dispose === 'function') {
          await (this.context as any).dispose();
        }
        this.context = null;
      }

      if (this.model) {
        if (typeof (this.model as any).dispose === 'function') {
          await (this.model as any).dispose();
        }
        this.model = null;
      }

      this.loadedModelId = null;

      this.updateStatus({
        running: false,
        ready: false,
        loadedModelId: undefined,
        loadedModelName: undefined,
      });

      console.log('[InferenceRuntime] Model unloaded');

    } catch (error) {
      console.error('[InferenceRuntime] Error unloading model:', error);
    }
  }

  /**
   * Run inference on the loaded model
   */
  async infer(
    messages: InferenceMessage[],
    options: InferenceOptions = {}
  ): Promise<InferenceResult> {
    if (!this.isReady() || !this.session) {
      throw new Error('Runtime is not ready. Load a model first.');
    }

    const startTime = Date.now();

    try {
      // Build the prompt from messages
      const systemMessage = messages.find(m => m.role === 'system');
      const userMessages = messages.filter(m => m.role !== 'system');
      const lastUserMessage = userMessages[userMessages.length - 1];

      if (!lastUserMessage || lastUserMessage.role !== 'user') {
        throw new Error('Last message must be from user');
      }

      // Configure generation options
      const maxTokens = options.maxTokens ?? 2048;
      const temperature = options.temperature ?? 0.7;

      let content = '';
      let tokensGenerated = 0;

      if (options.stream) {
        // Streaming response
        const response = await (this.session as any).prompt(lastUserMessage.content, {
          maxTokens,
          temperature,
          onToken: (token: string) => {
            content += token;
            tokensGenerated++;
            
            // Emit streaming chunk to renderer
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('models:inference-chunk', {
                modelId: this.loadedModelId,
                chunk: token,
                done: false,
              });
            }
          },
        });

        content = response;

        // Emit completion
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('models:inference-chunk', {
            modelId: this.loadedModelId,
            chunk: '',
            done: true,
          });
        }

      } else {
        // Non-streaming response
        content = await (this.session as any).prompt(lastUserMessage.content, {
          maxTokens,
          temperature,
        });
      }

      const timeMs = Date.now() - startTime;

      return {
        content,
        tokensGenerated,
        tokensPrompt: 0, // Would need to count input tokens
        timeMs,
      };

    } catch (error) {
      console.error('[InferenceRuntime] Inference failed:', error);
      throw error;
    }
  }

  /**
   * Stop ongoing inference (if streaming)
   */
  async stopInference(): Promise<void> {
    if (this.session && typeof (this.session as any).stop === 'function') {
      await (this.session as any).stop();
    }
  }

  /**
   * Get memory usage statistics
   */
  getMemoryUsage(): { used: number; total: number } | null {
    // node-llama-cpp doesn't expose memory stats directly
    // We could use process.memoryUsage() as a rough estimate
    const usage = process.memoryUsage();
    return {
      used: usage.heapUsed,
      total: usage.heapTotal,
    };
  }

  // ============================================
  // Private Helpers
  // ============================================

  private updateStatus(update: Partial<RuntimeStatus>): void {
    this.status = { ...this.status, ...update };
    this.emitStatusChange();
  }

  private emitStatusChange(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('models:runtime-status', this.status);
    }
  }
}

// ============================================
// Singleton Instance
// ============================================

let runtimeInstance: InferenceRuntime | null = null;

export function getInferenceRuntime(): InferenceRuntime {
  if (!runtimeInstance) {
    runtimeInstance = new InferenceRuntime();
  }
  return runtimeInstance;
}

/**
 * Check if node-llama-cpp is available
 */
export async function isRuntimeAvailable(): Promise<boolean> {
  try {
    await dynamicImport('node-llama-cpp');
    return true;
  } catch {
    return false;
  }
}
