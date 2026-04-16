/**
 * Local Whisper transcription provider.
 * Delegates to the Electron main process which runs Whisper via Transformers.js.
 * The first transcription for a given model size downloads the model (~75MB–3GB).
 */

import type { TranscriptionResult } from '../../types';
import type { TranscriptionProviderInterface } from './base';

export class LocalWhisperProvider implements TranscriptionProviderInterface {
  readonly name = 'Local Whisper';
  private speechModelId: string;

  constructor(speechModelId = 'small.en') {
    this.speechModelId = speechModelId;
  }

  isConfigured(): boolean {
    return !!window.electronAPI?.dictation?.transcribeLocal;
  }

  /**
   * Decode a WebM/Opus blob to 16 kHz mono Float32 PCM using the renderer's
   * AudioContext (not available in the Electron main process).
   */
  private async decodeToPCM(audioBlob: Blob): Promise<Float32Array> {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    try {
      const decoded = await audioCtx.decodeAudioData(arrayBuffer);
      const mono = decoded.getChannelData(0);

      if (decoded.sampleRate === 16000) return mono;

      // Manual resample when the context didn't honour the requested rate
      const ratio = decoded.sampleRate / 16000;
      const len = Math.round(mono.length / ratio);
      const out = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        out[i] = mono[Math.round(i * ratio)];
      }
      return out;
    } finally {
      await audioCtx.close();
    }
  }

  async transcribe(audioBlob: Blob, language?: string): Promise<TranscriptionResult> {
    if (!window.electronAPI?.dictation?.transcribeLocal) {
      throw new Error(
        'Local Whisper is only available in the Electron desktop app. ' +
        'Please switch to OpenAI Whisper or Deepgram in Settings > Dictation.'
      );
    }

    const pcm = await this.decodeToPCM(audioBlob);

    // Encode the Float32Array bytes as base64 for IPC transfer
    const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Audio = btoa(binary);

    console.log(`[LocalWhisper] Sending ${pcm.length} PCM samples (~${(pcm.length / 16000).toFixed(1)}s) to main process, model: ${this.speechModelId}`);

    const result = await window.electronAPI.dictation.transcribeLocal(base64Audio, {
      speechModelId: this.speechModelId,
      language,
    });

    if (!result.success) {
      throw new Error(`Local Whisper error: ${result.error}`);
    }

    return {
      text: result.text || '',
      language: result.language,
      duration: result.duration,
    };
  }
}
