/**
 * Inference Runtime for HydraNote
 * Handles loading and running local GGUF models using node-llama-cpp
 *
 * This is an adapter layer that abstracts the runtime implementation,
 * making it easier to swap out or support multiple backends in the future.
 */

import path from 'path';
import { pathToFileURL } from 'url';
import { app, BrowserWindow } from 'electron';
import { getModelManager } from './modelManager';

// Dynamic import helper for ESM modules from CommonJS context.
// node-llama-cpp v3 is ESM-only, requires special handling.
// In packaged Electron apps the bare specifier 'node-llama-cpp' fails with
// new Function (no module-scope context), so we fall back to importing via
// an explicit file:// URL resolved from app.getAppPath().
// asar is disabled for this app because Electron v26's ESM loader cannot read
// from asar archives, and node-llama-cpp's entire dependency tree is ESM.
async function importNodeLlamaCpp(): Promise<typeof import('node-llama-cpp')> {
  const dynamicImport = new Function('modulePath', 'return import(modulePath)') as 
    (modulePath: string) => Promise<typeof import('node-llama-cpp')>;

  try {
    return await dynamicImport('node-llama-cpp');
  } catch {
    const appRoot = app.getAppPath();
    const entryPoint = path.join(appRoot, 'node_modules', 'node-llama-cpp', 'dist', 'index.js');
    return dynamicImport(pathToFileURL(entryPoint).href);
  }
}

/**
 * Get a human-readable description of the GPU backend
 */
function getGpuBackendDescription(backend: unknown): string {
  if (!backend) {
    return 'CPU (no GPU acceleration)';
  }
  switch (backend) {
    case 'metal':
      return 'Metal (Apple GPU)';
    case 'cuda':
      return 'CUDA (NVIDIA GPU)';
    case 'vulkan':
      return 'Vulkan (cross-platform GPU)';
    default:
      return String(backend);
  }
}

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

export interface HardwareInfo {
  backend: 'cuda' | 'metal' | 'vulkan' | 'cpu' | 'unknown';
  supportedBackends: string[];
  deviceName?: string;
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
  private loadedModelId: string | null = null;
  
  // Store the LlamaChatSession class for creating sessions on-demand
  private LlamaChatSessionClass: unknown = null;

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
    return this.status.ready && this.model !== null && this.context !== null;
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
      const nodeLlamaCpp = await importNodeLlamaCpp();
      const { getLlama, LlamaChatSession } = nodeLlamaCpp;

      // Store the LlamaChatSession class for later use
      this.LlamaChatSessionClass = LlamaChatSession;

      // Initialize llama with GPU acceleration
      // GPU auto-detection: node-llama-cpp will select Metal, CUDA, or Vulkan based on availability
      this.llama = await getLlama({ gpu: 'auto' });
      
      const gpuBackend = (this.llama as any).gpu;
      console.log(`[InferenceRuntime] GPU backend: ${getGpuBackendDescription(gpuBackend)}`);

      // Load the model
      // gpuLayers: -1, 0, or undefined = let node-llama-cpp auto-detect optimal GPU layers
      // gpuLayers: N (positive) = specific number of layers on GPU
      const gpuLayers = options.gpuLayers;
      const isAutoGpu = gpuLayers === undefined || gpuLayers === -1 || gpuLayers === 0;
      const contextLength = options.contextLength ?? model.contextLength ?? 4096;

      const loadOptions: { modelPath: string; gpuLayers?: number } = {
        modelPath: model.primaryModelPath,
      };
      if (!isAutoGpu && gpuLayers && gpuLayers > 0) {
        loadOptions.gpuLayers = gpuLayers;
      }

      this.model = await (this.llama as any).loadModel(loadOptions);

      // Create context
      this.context = await (this.model as any).createContext({
        contextSize: contextLength,
      });

      this.loadedModelId = modelId;
      modelManager.updateLastUsed(modelId);

      this.updateStatus({
        running: true,
        ready: true,
        loadedModelId: modelId,
        loadedModelName: model.name,
      });

      console.log(`[InferenceRuntime] Model loaded: ${model.name}`);

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
      this.LlamaChatSessionClass = null;

      this.updateStatus({
        running: false,
        ready: false,
        loadedModelId: undefined,
        loadedModelName: undefined,
      });

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
    if (!this.isReady()) {
      throw new Error('Runtime is not ready. Load a model first.');
    }

    if (!this.LlamaChatSessionClass) {
      throw new Error('LlamaChatSession class not available');
    }

    const startTime = Date.now();

    try {
      // Extract system prompt from messages
      const systemMessage = messages.find(m => m.role === 'system');
      const systemPrompt = systemMessage?.content || '';
      
      // Get non-system messages for conversation history
      const conversationMessages = messages.filter(m => m.role !== 'system');
      
      // Validate we have at least one user message
      const lastMessage = conversationMessages[conversationMessages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user') {
        throw new Error('Last message must be from user');
      }

      // Get model info for context recreation
      const modelManager = getModelManager();
      const modelInfo = modelManager.getModel(this.loadedModelId!);
      const contextLength = modelInfo?.contextLength ?? 4096;
      
      // Dispose old context and create a fresh one for this inference
      if (this.context) {
        try {
          await (this.context as any).dispose();
        } catch {
          // Ignore dispose errors
        }
      }
      
      this.context = await (this.model as any).createContext({
        contextSize: contextLength,
      });
      
      // Get a fresh sequence from the new context
      const contextSequence = (this.context as any).getSequence();
      
      // Create a fresh chat session
      const LlamaChatSession = this.LlamaChatSessionClass as any;
      const session = new LlamaChatSession({
        contextSequence,
      });

      // Build complete chat history including system prompt
      const chatHistory: Array<
        | { type: 'system'; text: string }
        | { type: 'user'; text: string }
        | { type: 'model'; response: string[] }
      > = [];
      
      // Add system prompt first if present
      if (systemPrompt) {
        chatHistory.push({
          type: 'system',
          text: systemPrompt,
        });
      }
      
      // Add previous messages (excluding the last user message which will be sent via prompt())
      if (conversationMessages.length > 1) {
        const historyMessages = conversationMessages.slice(0, -1);
        for (const msg of historyMessages) {
          if (msg.role === 'user') {
            chatHistory.push({
              type: 'user',
              text: msg.content,
            });
          } else {
            chatHistory.push({
              type: 'model',
              response: [msg.content],
            });
          }
        }
      }
      
      // Track if we successfully set the history
      let historySet = false;
      
      // Set the chat history if we have any
      if (chatHistory.length > 0) {
        try {
          await session.setChatHistory(chatHistory);
          historySet = true;
        } catch {
          historySet = false;
        }
      }

      // Configure generation options
      const maxTokens = options.maxTokens ?? 2048;
      const temperature = options.temperature ?? 0.7;

      let content = '';
      let tokensGenerated = 0;

      // Get the last user message to send as the prompt
      let userPrompt = lastMessage.content;
      
      // If history wasn't set and we have a system prompt, use a fallback approach
      if (!historySet && systemPrompt) {
        const maxSystemLength = 2000;
        const truncatedSystem = systemPrompt.length > maxSystemLength 
          ? systemPrompt.substring(0, maxSystemLength) + '\n\n[System instructions truncated for brevity]'
          : systemPrompt;
        
        userPrompt = `### System Instructions:\n${truncatedSystem}\n\n### User Message:\n${lastMessage.content}\n\n### Assistant Response:`;
      }

      if (options.stream) {
        // Streaming response
        const response = await session.prompt(userPrompt, {
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
        content = await session.prompt(userPrompt, {
          maxTokens,
          temperature,
        });
      }

      // Clean up the session after use
      if (typeof session.dispose === 'function') {
        try {
          await session.dispose();
        } catch {
          // Ignore dispose errors
        }
      }

      const timeMs = Date.now() - startTime;

      return {
        content,
        tokensGenerated,
        tokensPrompt: 0,
        timeMs,
      };

    } catch (error) {
      console.error('[InferenceRuntime] Inference failed:', error);
      throw error;
    }
  }

  /**
   * Get hardware acceleration information
   * Detects available GPU backends: Metal (macOS), CUDA (NVIDIA), Vulkan (cross-platform)
   */
  async getHardwareInfo(): Promise<HardwareInfo> {
    try {
      const nodeLlamaCpp = await importNodeLlamaCpp();
      const { getLlama } = nodeLlamaCpp;

      // Get supported GPU types (if available in this version)
      let supportedBackends: string[] = [];
      try {
        if ('getLlamaGpuTypes' in nodeLlamaCpp) {
          const getLlamaGpuTypes = (nodeLlamaCpp as any).getLlamaGpuTypes;
          supportedBackends = await getLlamaGpuTypes('supported') as string[];
        }
      } catch {
        // Fallback: list all possible backends, actual availability determined by node-llama-cpp
        supportedBackends = ['metal', 'cuda', 'vulkan'];
      }

      // If we already have a llama instance loaded, use its GPU info
      if (this.llama) {
        const backend = (this.llama as any).gpu;
        const resolvedBackend = (typeof backend === 'string' && backend) ? backend : 'cpu';
        return {
          backend: resolvedBackend as HardwareInfo['backend'],
          supportedBackends,
        };
      }

      // Otherwise, create a temporary instance to check hardware
      const llama = await getLlama({ gpu: 'auto' });
      const detectedBackend = (llama as any).gpu;
      const resolvedBackend = (typeof detectedBackend === 'string' && detectedBackend) ? detectedBackend : 'cpu';

      return {
        backend: resolvedBackend as HardwareInfo['backend'],
        supportedBackends,
      };
    } catch (error) {
      console.error('[InferenceRuntime] Error getting hardware info:', error);
      return {
        backend: 'unknown',
        supportedBackends: [],
      };
    }
  }

  /**
   * Stop ongoing inference (if streaming)
   */
  async stopInference(): Promise<void> {
    // Sessions are now created per-inference and disposed after.
    // For now, this is a no-op - the inference will complete naturally.
  }

  /**
   * Get memory usage statistics
   */
  getMemoryUsage(): { used: number; total: number } | null {
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
    await importNodeLlamaCpp();
    return true;
  } catch {
    return false;
  }
}
