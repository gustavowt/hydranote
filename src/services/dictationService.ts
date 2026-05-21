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

export type MicPermissionStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown';

// Reactive snapshot of the OS-level microphone permission. Used by UI elements
// (e.g. the chat dictation button) to disable themselves when access is denied.
export const micPermissionState = ref<MicPermissionStatus>('unknown');

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let mediaStream: MediaStream | null = null;

type DictationEventCallback = (result: TranscriptionResult) => void;
const listeners: DictationEventCallback[] = [];

// One-shot raw handler used by push-to-talk callers (e.g. the chat input mic
// button). When set, the next transcription bypasses the normal listener
// broadcast and is delivered only to this handler — no cleanup, no review.
let rawTranscriptionHandler: DictationEventCallback | null = null;

export function onTranscriptionComplete(callback: DictationEventCallback): void {
  listeners.push(callback);
}

export function offTranscriptionComplete(callback: DictationEventCallback): void {
  const idx = listeners.indexOf(callback);
  if (idx !== -1) listeners.splice(idx, 1);
}

function emit(result: TranscriptionResult): void {
  if (rawTranscriptionHandler) {
    const handler = rawTranscriptionHandler;
    rawTranscriptionHandler = null;
    try {
      handler(result);
    } catch (err) {
      console.error('[Dictation] Raw handler error:', err);
    }
    return;
  }
  for (const cb of listeners) {
    try {
      cb(result);
    } catch (err) {
      console.error('[Dictation] Listener error:', err);
    }
  }
}

/**
 * Refresh `micPermissionState` from the best available source. Does NOT
 * trigger an OS prompt — safe to call on UI mount.
 */
export async function refreshMicPermissionState(): Promise<MicPermissionStatus> {
  const electronGetStatus = window.electronAPI?.dictation?.getMicrophoneAccessStatus;
  if (electronGetStatus) {
    try {
      const result = await electronGetStatus();
      const status = (result?.status ?? 'unknown') as MicPermissionStatus;
      micPermissionState.value = status;
      return status;
    } catch {
      micPermissionState.value = 'unknown';
      return 'unknown';
    }
  }

  // Browser fallback — Permissions API is not universally supported for the
  // 'microphone' name, so we treat unknowns as 'unknown' (which the UI treats
  // as enabled and lets the native prompt happen on click).
  const permissions = (navigator as Navigator & {
    permissions?: { query: (descriptor: { name: string }) => Promise<{ state: PermissionState }> };
  }).permissions;
  if (permissions?.query) {
    try {
      const result = await permissions.query({ name: 'microphone' });
      const mapped: MicPermissionStatus =
        result.state === 'granted'
          ? 'granted'
          : result.state === 'denied'
            ? 'denied'
            : 'not-determined';
      micPermissionState.value = mapped;
      return mapped;
    } catch {
      // Fall through to unknown
    }
  }

  micPermissionState.value = 'unknown';
  return 'unknown';
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
    // In Electron, ensure the OS-level microphone permission is granted before
    // calling getUserMedia. On macOS, an unauthorized app receives a silent
    // stream rather than an error, which causes dictation to "work" but capture
    // nothing.
    const ensureMic = window.electronAPI?.dictation?.ensureMicrophoneAccess;
    if (ensureMic) {
      const result = await ensureMic();
      if (result.status && result.status !== 'not-applicable') {
        micPermissionState.value = result.status as MicPermissionStatus;
      } else if (result.granted) {
        micPermissionState.value = 'granted';
      }
      if (!result.granted) {
        rawTranscriptionHandler = null;
        dictationState.value = {
          status: 'error',
          error:
            result.status === 'denied' || result.status === 'restricted'
              ? 'Microphone access is blocked. Enable HydraNote under System Settings → Privacy & Security → Microphone, then try again.'
              : result.error || 'Microphone access was not granted.',
        };
        return;
      }
    }

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
    rawTranscriptionHandler = null;
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
  rawTranscriptionHandler = null;
  dictationState.value = { status: 'idle' };
}

export function isRecording(): boolean {
  return dictationState.value.status === 'recording';
}

/**
 * Start a raw push-to-talk recording. The transcription result is delivered
 * to `onComplete` only — global listeners (cleanup + review modal) are
 * bypassed for this one recording. Use this for callers that want raw text
 * inserted directly somewhere (e.g. the chat input mic button).
 */
export async function startPushToTalk(
  onComplete: (result: TranscriptionResult) => void,
): Promise<void> {
  rawTranscriptionHandler = onComplete;
  await startRecording();
  // If startRecording failed (e.g. permission denied), the handler is already
  // cleared inside startRecording so we don't keep stale state around.
}

/**
 * Stop a push-to-talk recording started via `startPushToTalk`. Returns the
 * transcription result (also delivered to the onComplete callback).
 */
export async function stopPushToTalk(): Promise<TranscriptionResult | null> {
  return stopRecording();
}

/**
 * No-op kept for API compatibility. The actual IPC wiring (onToggle listener,
 * shortcut registration) is handled in App.vue on mount.
 */
export function initDictationIPC(): void {
  // Intentionally empty — toggle listener is registered in App.vue
}
