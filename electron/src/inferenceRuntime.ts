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
      // This allows the app to run even if the dependency isn't installed
      // Using dynamicImport helper to bypass CommonJS transformation
      const nodeLlamaCpp = await dynamicImport('node-llama-cpp') as typeof import('node-llama-cpp');
      const { getLlama, LlamaChatSession } = nodeLlamaCpp;

      // Store the LlamaChatSession class for later use
      this.LlamaChatSessionClass = LlamaChatSession;

      // Initialize llama
      this.llama = await getLlama({gpu: true});

      // Load the model
      // gpuLayers: -1 or undefined = let node-llama-cpp auto-detect optimal GPU layers based on VRAM
      // gpuLayers: 0 = CPU only
      // gpuLayers: N (positive) = specific number of layers on GPU
      const gpuLayers = options.gpuLayers;
      const isAutoGpu = gpuLayers === undefined || gpuLayers === -1;
      const contextLength = options.contextLength ?? model.contextLength ?? 4096;

      console.log(`[InferenceRuntime] Loading model: ${model.primaryModelPath}`);
      console.log(`[InferenceRuntime] GPU layers: ${isAutoGpu ? 'auto (node-llama-cpp will detect optimal based on VRAM)' : gpuLayers}, Context: ${contextLength}`);
      console.log(`[InferenceRuntime] Detected GPU type: ${(this.llama as any).gpu || 'none/cpu'}`);

      // Only pass gpuLayers if explicitly set to a non-auto value
      // When undefined or -1, node-llama-cpp auto-detects optimal layers based on available VRAM
      const loadOptions: { modelPath: string; gpuLayers?: number } = {
        modelPath: model.primaryModelPath,
      };
      if (!isAutoGpu) {
        loadOptions.gpuLayers = gpuLayers;
      }

      this.model = await (this.llama as any).loadModel(loadOptions);

      // Create context
      this.context = await (this.model as any).createContext({
        contextSize: contextLength,
      });

      // Note: We don't create a session here anymore.
      // Sessions are created on-demand in infer() with the proper system prompt.

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
    console.log('\n[InferenceRuntime] ========== INFER CALLED ==========');
    console.log('[InferenceRuntime] Received messages:', messages.length);
    messages.forEach((m, i) => {
      console.log(`[InferenceRuntime]   [${i}] ${m.role}: "${m.content.substring(0, 80)}${m.content.length > 80 ? '...' : ''}" (${m.content.length} chars)`);
    });
    console.log('[InferenceRuntime] Options:', JSON.stringify(options));
    
    if (!this.isReady()) {
      console.error('[InferenceRuntime] ERROR: Runtime not ready');
      throw new Error('Runtime is not ready. Load a model first.');
    }

    if (!this.LlamaChatSessionClass) {
      console.error('[InferenceRuntime] ERROR: LlamaChatSessionClass not available');
      throw new Error('LlamaChatSession class not available');
    }

    const startTime = Date.now();

    try {
      // Extract system prompt from messages
      const systemMessage = messages.find(m => m.role === 'system');
      const systemPrompt = systemMessage?.content || '';
      console.log(`[InferenceRuntime] System prompt found: ${systemMessage ? 'YES' : 'NO'} (${systemPrompt.length} chars)`);
      
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
      // This ensures no leftover state from previous inferences
      if (this.context) {
        console.log('[InferenceRuntime] Disposing old context...');
        try {
          await (this.context as any).dispose();
        } catch (disposeErr) {
          console.warn('[InferenceRuntime] Error disposing old context:', disposeErr);
        }
      }
      
      console.log('[InferenceRuntime] Creating fresh context...');
      this.context = await (this.model as any).createContext({
        contextSize: contextLength,
      });
      
      // Get a fresh sequence from the new context
      const contextSequence = (this.context as any).getSequence();
      console.log('[InferenceRuntime] Got fresh context sequence');
      
      // Create a fresh chat session
      // We'll set the system prompt via setChatHistory for better compatibility
      const LlamaChatSession = this.LlamaChatSessionClass as any;
      const session = new LlamaChatSession({
        contextSequence,
      });

      // Build complete chat history including system prompt
      // The chat history format expected by node-llama-cpp v3:
      // - system: { type: 'system', text: string }
      // - user: { type: 'user', text: string }
      // - model: { type: 'model', response: string[] }  // Note: 'response' not 'text'!
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
            // Model responses use 'response' array, not 'text'
            chatHistory.push({
              type: 'model',
              response: [msg.content],
            });
          }
        }
      }
      
      // Track if we successfully set the history
      let historySet = false;
      
      console.log('[InferenceRuntime] Chat history to set:', JSON.stringify(chatHistory.map(h => ({
        type: h.type,
        length: h.type === 'model' ? (h as any).response?.[0]?.length : (h as any).text?.length,
      })), null, 2));
      
      // Set the chat history if we have any
      if (chatHistory.length > 0) {
        try {
          console.log('[InferenceRuntime] Calling setChatHistory...');
          await session.setChatHistory(chatHistory);
          historySet = true;
          console.log(`[InferenceRuntime] setChatHistory SUCCESS with ${chatHistory.length} items`);
        } catch (historyError) {
          // If setChatHistory fails, log the error
          console.error('[InferenceRuntime] setChatHistory FAILED:', historyError);
          historySet = false;
        }
      } else {
        console.log('[InferenceRuntime] No chat history to set');
      }

      // Configure generation options
      const maxTokens = options.maxTokens ?? 2048;
      const temperature = options.temperature ?? 0.7;

      let content = '';
      let tokensGenerated = 0;

      // Get the last user message to send as the prompt
      let userPrompt = lastMessage.content;
      
      // If history wasn't set and we have a system prompt, use a fallback approach
      // by constructing a manual prompt that includes context
      if (!historySet && systemPrompt) {
        console.log('[InferenceRuntime] Using fallback: constructing manual prompt with system context');
        
        // For the fallback, we'll create a simplified prompt that includes key context
        // We truncate the system prompt to avoid overwhelming the model
        const maxSystemLength = 2000; // Reasonable limit for context
        const truncatedSystem = systemPrompt.length > maxSystemLength 
          ? systemPrompt.substring(0, maxSystemLength) + '\n\n[System instructions truncated for brevity]'
          : systemPrompt;
        
        // Build a simple context-aware prompt
        // Most models understand this format even without proper chat templates
        userPrompt = `### System Instructions:\n${truncatedSystem}\n\n### User Message:\n${lastMessage.content}\n\n### Assistant Response:`;
      }

      console.log('[InferenceRuntime] -------- PROMPT DETAILS --------');
      console.log(`[InferenceRuntime] historySet: ${historySet}`);
      console.log(`[InferenceRuntime] userPrompt length: ${userPrompt.length}`);
      console.log(`[InferenceRuntime] userPrompt preview: "${userPrompt.substring(0, 200)}${userPrompt.length > 200 ? '...' : ''}"`);
      console.log(`[InferenceRuntime] maxTokens: ${maxTokens}, temperature: ${temperature}`);
      console.log('[InferenceRuntime] Calling session.prompt()...');

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
        console.log('[InferenceRuntime] Awaiting non-streaming response...');
        content = await session.prompt(userPrompt, {
          maxTokens,
          temperature,
        });
        console.log(`[InferenceRuntime] Got response: ${content.length} chars`);
        console.log(`[InferenceRuntime] Response preview: "${content.substring(0, 300)}${content.length > 300 ? '...' : ''}"`);
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
        tokensPrompt: 0, // Would need to count input tokens
        timeMs,
      };

    } catch (error) {
      console.error('[InferenceRuntime] Inference failed:', error);
      throw error;
    }
  }

  /**
   * Get hardware acceleration information
   * Returns info about detected GPU backends (CUDA, Metal, Vulkan) or CPU-only mode
   */
  async getHardwareInfo(): Promise<HardwareInfo> {
    try {
      const nodeLlamaCpp = await dynamicImport('node-llama-cpp') as typeof import('node-llama-cpp');
      const { getLlama, getLlamaGpuTypes } = nodeLlamaCpp;

      // Get supported GPU types
      let supportedBackends: string[] = [];
      try {
        supportedBackends = await getLlamaGpuTypes('supported') as string[];
      } catch {
        // getLlamaGpuTypes might not be available in all versions
        supportedBackends = [];
      }

      // If we already have a llama instance loaded, use its GPU info
      if (this.llama) {
        const llamaInstance = this.llama as { gpu?: string | false };
        const backend = llamaInstance.gpu || 'cpu';
        return {
          backend: backend === false ? 'cpu' : (backend as HardwareInfo['backend']),
          supportedBackends,
        };
      }

      // Otherwise, create a temporary instance to check hardware
      const llama = await getLlama();
      const llamaAny = llama as { gpu?: string | false };
      const detectedBackend = llamaAny.gpu || 'cpu';

      return {
        backend: detectedBackend === false ? 'cpu' : (detectedBackend as HardwareInfo['backend']),
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
   * Note: With on-demand sessions, stopping is handled by the session's internal state.
   * A more robust implementation would track the active session and call stop on it.
   */
  async stopInference(): Promise<void> {
    // Sessions are now created per-inference and disposed after.
    // To properly implement stop, we would need to track the active session.
    // For now, this is a no-op - the inference will complete naturally.
    console.log('[InferenceRuntime] Stop inference requested (currently no-op)');
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
