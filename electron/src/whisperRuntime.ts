/**
 * Whisper Runtime for HydraNote
 * Handles local speech-to-text using Transformers.js (Hugging Face)
 * following the same pattern as embeddingRuntime.ts.
 */

import { BrowserWindow, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// Speech model ID → ONNX Hugging Face model ID mapping
// Kept in sync with LOCAL_SPEECH_MODELS in src/types/index.ts
const WHISPER_MODELS: Record<string, string> = {
  'tiny.en':  'onnx-community/whisper-tiny.en',
  'base.en':  'onnx-community/whisper-base.en',
  'small.en': 'onnx-community/whisper-small.en',
  'tiny':     'onnx-community/whisper-tiny',
  'base':     'onnx-community/whisper-base',
  'small':    'onnx-community/whisper-small',
  'medium':   'onnx-community/whisper-medium',
  'large-v3': 'onnx-community/whisper-large-v3-turbo',
};

export interface WhisperTranscriptionResult {
  success: boolean;
  text?: string;
  language?: string;
  duration?: number;
  error?: string;
}

class WhisperRuntime {
  private mainWindow: BrowserWindow | null = null;
  private pipeline: any = null;
  private loadedSpeechModelId: string | null = null;
  private loadPromise: Promise<void> | null = null;
  private downloadPromise: Promise<void> | null = null;
  private downloadingSpeechModelId: string | null = null;

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  isReady(): boolean {
    return this.pipeline !== null;
  }

  private getCacheDir(): string {
    return path.join(app.getPath('userData'), 'whisper-models');
  }

  /**
   * Check if a speech model has been downloaded by looking for the ONNX files
   * in the Transformers.js cache directory.
   */
  isModelDownloaded(speechModelId: string): boolean {
    const modelId = WHISPER_MODELS[speechModelId];
    if (!modelId) return false;

    const cacheDir = this.getCacheDir();
    const modelDir = path.join(cacheDir, modelId, 'onnx');
    try {
      if (!fs.existsSync(modelDir)) return false;
      const files = fs.readdirSync(modelDir);
      return files.some(f => f.endsWith('.onnx'));
    } catch {
      return false;
    }
  }

  /**
   * Get download status for all known speech models.
   */
  getAllModelStatuses(): Record<string, boolean> {
    const statuses: Record<string, boolean> = {};
    for (const id of Object.keys(WHISPER_MODELS)) {
      statuses[id] = this.isModelDownloaded(id);
    }
    return statuses;
  }

  /**
   * Pre-download a speech model (without loading into the pipeline).
   * Sends progress via the dictation:whisper-status IPC channel.
   */
  async downloadModel(speechModelId: string): Promise<void> {
    const modelId = WHISPER_MODELS[speechModelId];
    if (!modelId) {
      throw new Error(`Unknown speech model: ${speechModelId}. Available: ${Object.keys(WHISPER_MODELS).join(', ')}`);
    }

    if (this.downloadPromise && this.downloadingSpeechModelId === speechModelId) {
      return this.downloadPromise;
    }

    this.downloadingSpeechModelId = speechModelId;
    this.downloadPromise = this._downloadModel(speechModelId, modelId);
    try {
      await this.downloadPromise;
    } finally {
      this.downloadPromise = null;
      this.downloadingSpeechModelId = null;
    }
  }

  private async _downloadModel(speechModelId: string, modelId: string): Promise<void> {
    console.log(`[WhisperRuntime] Downloading model: ${modelId}`);
    this.sendStatus('downloading', speechModelId, 0);

    try {
      const { pipeline: createPipeline, env } = await import('@huggingface/transformers');

      const cacheDir = this.getCacheDir();
      env.cacheDir = cacheDir;
      env.allowLocalModels = true;
      env.allowRemoteModels = true;

      const p = await createPipeline('automatic-speech-recognition', modelId, {
        dtype: 'fp32',
        progress_callback: (progress: any) => {
          if (progress.status === 'progress' && progress.progress !== undefined) {
            const percent = Math.round(progress.progress);
            this.sendStatus('downloading', speechModelId, percent);
          } else if (progress.status === 'done') {
            this.sendStatus('loading', speechModelId);
          }
        },
      });

      // If no other model is currently loaded, keep this one ready
      if (!this.pipeline) {
        this.pipeline = p;
        this.loadedSpeechModelId = speechModelId;
      }

      this.sendStatus('ready', speechModelId, 100);
      console.log(`[WhisperRuntime] Model downloaded successfully: ${modelId}`);
    } catch (error) {
      console.error(`[WhisperRuntime] Error downloading model:`, error);
      this.sendStatus('error', speechModelId);
      throw error;
    }
  }

  /**
   * Delete a downloaded speech model from disk.
   */
  async deleteModel(speechModelId: string): Promise<void> {
    const modelId = WHISPER_MODELS[speechModelId];
    if (!modelId) {
      throw new Error(`Unknown speech model: ${speechModelId}`);
    }

    // Unload if currently loaded
    if (this.loadedSpeechModelId === speechModelId) {
      this.pipeline = null;
      this.loadedSpeechModelId = null;
    }

    const cacheDir = this.getCacheDir();
    const modelDir = path.join(cacheDir, modelId);

    if (fs.existsSync(modelDir)) {
      fs.rmSync(modelDir, { recursive: true, force: true });
      console.log(`[WhisperRuntime] Deleted model cache: ${modelDir}`);
    }
  }

  private async ensureModel(speechModelId: string): Promise<void> {
    if (this.loadedSpeechModelId === speechModelId && this.pipeline) {
      return;
    }
    if (this.loadPromise && this.loadedSpeechModelId === speechModelId) {
      return this.loadPromise;
    }

    // Unload previous model
    if (this.pipeline) {
      this.pipeline = null;
      this.loadedSpeechModelId = null;
    }

    this.loadPromise = this._loadModel(speechModelId);
    return this.loadPromise;
  }

  private async _loadModel(speechModelId: string): Promise<void> {
    const modelId = WHISPER_MODELS[speechModelId];
    if (!modelId) {
      throw new Error(`Unknown speech model: ${speechModelId}. Available: ${Object.keys(WHISPER_MODELS).join(', ')}`);
    }

    console.log(`[WhisperRuntime] Loading model: ${modelId}`);

    try {
      const { pipeline: createPipeline, env } = await import('@huggingface/transformers');

      const cacheDir = this.getCacheDir();
      env.cacheDir = cacheDir;
      env.allowLocalModels = true;
      env.allowRemoteModels = true;

      this.sendStatus('loading', speechModelId);

      this.pipeline = await createPipeline('automatic-speech-recognition', modelId, {
        dtype: 'fp32',
        progress_callback: (progress: any) => {
          if (progress.status === 'progress' && progress.progress !== undefined) {
            const percent = Math.round(progress.progress);
            console.log(`[WhisperRuntime] Download progress: ${percent}%`);
            this.sendStatus('loading', speechModelId, percent);
          }
        },
      });

      this.loadedSpeechModelId = speechModelId;
      this.sendStatus('ready', speechModelId);
      console.log(`[WhisperRuntime] Model loaded successfully: ${modelId}`);
    } catch (error) {
      console.error(`[WhisperRuntime] Error loading model:`, error);
      this.pipeline = null;
      this.loadedSpeechModelId = null;
      this.sendStatus('error', speechModelId);
      throw error;
    } finally {
      this.loadPromise = null;
    }
  }

  /**
   * Transcribe audio from base64-encoded raw 16 kHz mono Float32 PCM samples.
   * The renderer decodes WebM→PCM via AudioContext before sending over IPC.
   */
  async transcribe(
    base64Audio: string,
    options: { speechModelId: string; language?: string }
  ): Promise<WhisperTranscriptionResult> {
    try {
      await this.ensureModel(options.speechModelId);

      if (!this.pipeline) {
        return { success: false, error: 'Whisper model not loaded' };
      }

      // Reconstruct Float32Array from the base64-encoded PCM bytes
      const raw = Buffer.from(base64Audio, 'base64');
      const aligned = new ArrayBuffer(raw.byteLength);
      new Uint8Array(aligned).set(raw);
      const float32 = new Float32Array(aligned);

      console.log(`[WhisperRuntime] Transcribing audio (${float32.length} samples, ~${(float32.length / 16000).toFixed(1)}s)`);

      const transcribeOptions: Record<string, unknown> = {};
      if (options.language) {
        transcribeOptions.language = options.language;
      }

      const result = await this.pipeline(float32, transcribeOptions);

      console.log(`[WhisperRuntime] Transcription complete: "${(result.text || '').substring(0, 100)}"`);

      return {
        success: true,
        text: result.text || '',
        language: options.language,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Transcription failed';
      console.error(`[WhisperRuntime] Transcription error:`, error);
      return { success: false, error: errorMsg };
    }
  }

  private sendStatus(status: string, speechModelId: string, progress?: number): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('dictation:whisper-status', { status, speechModelId, progress });
    }
  }
}

// Singleton
let instance: WhisperRuntime | null = null;

export function getWhisperRuntime(): WhisperRuntime {
  if (!instance) {
    instance = new WhisperRuntime();
  }
  return instance;
}
