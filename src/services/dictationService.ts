/**
 * Dictation Service
 * Manages microphone capture, recording lifecycle, transcription dispatch,
 * and coordinates with the pipeline service.
 */

import { ref } from 'vue';
import type { DictationState, DictationSettings, TranscriptionResult } from '../types';
import { loadDictationSettings } from './dictationSettingsService';
import { OpenAIWhisperProvider } from './transcriptionProviders/openaiWhisperProvider';
import { DeepgramProvider } from './transcriptionProviders/deepgramProvider';
import { LocalWhisperProvider } from './transcriptionProviders/localWhisperProvider';
import type { TranscriptionProviderInterface } from './transcriptionProviders/base';

// Reactive state visible to the UI
export const dictationState = ref<DictationState>({ status: 'idle' });

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let mediaStream: MediaStream | null = null;

type DictationEventCallback = (result: TranscriptionResult) => void;
const listeners: DictationEventCallback[] = [];

export function onTranscriptionComplete(callback: DictationEventCallback): void {
  listeners.push(callback);
}

export function offTranscriptionComplete(callback: DictationEventCallback): void {
  const idx = listeners.indexOf(callback);
  if (idx !== -1) listeners.splice(idx, 1);
}

function emit(result: TranscriptionResult): void {
  for (const cb of listeners) {
    try {
      cb(result);
    } catch (err) {
      console.error('[Dictation] Listener error:', err);
    }
  }
}

function getProvider(settings: DictationSettings): TranscriptionProviderInterface {
  switch (settings.provider) {
    case 'openai_whisper':
      return new OpenAIWhisperProvider(settings.providerConfig.openaiWhisper.model);
    case 'deepgram':
      return new DeepgramProvider(
        settings.providerConfig.deepgram.apiKey,
        settings.providerConfig.deepgram.model,
      );
    case 'local_whisper':
      return new LocalWhisperProvider(settings.providerConfig.localWhisper.speechModelId);
    default:
      throw new Error(`Unknown transcription provider: ${settings.provider}`);
  }
}

function getLanguage(settings: DictationSettings): string | undefined {
  switch (settings.provider) {
    case 'openai_whisper':
      return settings.providerConfig.openaiWhisper.language || undefined;
    case 'deepgram':
      return settings.providerConfig.deepgram.language || undefined;
    default:
      return undefined;
  }
}

export async function startRecording(): Promise<void> {
  if (dictationState.value.status === 'recording') return;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    console.log('[Dictation] Starting recording, mimeType:', mimeType);

    mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onerror = (event) => {
      console.error('[Dictation] MediaRecorder error:', event);
    };

    mediaRecorder.start(250);
    dictationState.value = { status: 'recording' };
  } catch (err) {
    console.error('[Dictation] Failed to start recording:', err);
    dictationState.value = {
      status: 'error',
      error: err instanceof Error ? err.message : 'Failed to access microphone',
    };
  }
}

export async function stopRecording(): Promise<TranscriptionResult | null> {
  if (dictationState.value.status !== 'recording' || !mediaRecorder) {
    return null;
  }

  return new Promise<TranscriptionResult | null>((resolve) => {
    if (!mediaRecorder) { resolve(null); return; }

    mediaRecorder.onstop = async () => {
      // Release the microphone
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
        mediaStream = null;
      }

      if (audioChunks.length === 0) {
        console.warn('[Dictation] No audio chunks captured');
        dictationState.value = { status: 'idle' };
        resolve(null);
        return;
      }

      const recordedMimeType = mediaRecorder?.mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunks, { type: recordedMimeType });
      audioChunks = [];

      console.log('[Dictation] Recording stopped. Blob size:', audioBlob.size, 'type:', recordedMimeType);
      dictationState.value = { status: 'transcribing' };

      try {
        const settings = loadDictationSettings();
        const provider = getProvider(settings);
        const language = getLanguage(settings);
        console.log('[Dictation] Transcribing with provider:', settings.provider);
        const result = await provider.transcribe(audioBlob, language);

        console.log('[Dictation] Transcription complete:', result.text?.substring(0, 100));
        dictationState.value = {
          status: 'idle',
          lastTranscription: result.text,
        };

        emit(result);
        resolve(result);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Transcription failed';
        console.error('[Dictation] Transcription error:', err);
        dictationState.value = {
          status: 'error',
          error: errorMsg,
        };
        // Auto-clear error after 5 seconds
        setTimeout(() => {
          if (dictationState.value.status === 'error') {
            dictationState.value = { status: 'idle' };
          }
        }, 5000);
        resolve(null);
      }
    };

    mediaRecorder.stop();
  });
}

export function cancelRecording(): void {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  audioChunks = [];
  dictationState.value = { status: 'idle' };
}

export function isRecording(): boolean {
  return dictationState.value.status === 'recording';
}

/**
 * No-op kept for API compatibility. The actual IPC wiring (onToggle listener,
 * shortcut registration) is handled in App.vue on mount.
 */
export function initDictationIPC(): void {
  // Intentionally empty — toggle listener is registered in App.vue
}
