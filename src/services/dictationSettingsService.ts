/**
 * Dictation Settings Service
 * Manages persistence of dictation/speech-to-text configuration in localStorage.
 */

import type { DictationSettings } from '../types';
import { DEFAULT_DICTATION_SETTINGS, DEFAULT_DICTATION_PIPELINE, DEFAULT_TRANSCRIPTION_PROVIDER_CONFIG, DEFAULT_CLEANUP_CONFIG } from '../types';

const STORAGE_KEY = 'hydranote_dictation_settings';

/** Dispatched on `window` when the Electron dictation tray requests a workspace action. */
export const ELECTRON_TRAY_WORKSPACE_EVENT = 'hydranote-tray-workspace-action';

export function loadDictationSettings(): DictationSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_DICTATION_SETTINGS,
        ...parsed,
        providerConfig: {
          ...DEFAULT_TRANSCRIPTION_PROVIDER_CONFIG,
          openaiWhisper: {
            ...DEFAULT_TRANSCRIPTION_PROVIDER_CONFIG.openaiWhisper,
            ...(parsed.providerConfig?.openaiWhisper || {}),
          },
          deepgram: {
            ...DEFAULT_TRANSCRIPTION_PROVIDER_CONFIG.deepgram,
            ...(parsed.providerConfig?.deepgram || {}),
          },
          localWhisper: {
            ...DEFAULT_TRANSCRIPTION_PROVIDER_CONFIG.localWhisper,
            ...(parsed.providerConfig?.localWhisper || {}),
          },
        },
        cleanup: {
          ...DEFAULT_CLEANUP_CONFIG,
          ...(parsed.cleanup || {}),
        },
        pipeline: parsed.pipeline?.length
          ? parsed.pipeline.filter((a: { type: string }) => a.type !== 'format_with_ai')
          : [...DEFAULT_DICTATION_PIPELINE],
      };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_DICTATION_SETTINGS, pipeline: [...DEFAULT_DICTATION_PIPELINE], cleanup: { ...DEFAULT_CLEANUP_CONFIG } };
}

/**
 * Sync dictation companion tray in the Electron main process (no-op on web).
 */
export async function syncElectronDictationCompanionTray(enabled: boolean): Promise<void> {
  const api = (
    window as unknown as {
      electronAPI?: { dictation?: { setCompanionTrayEnabled?: (v: boolean) => Promise<unknown> } };
    }
  ).electronAPI;
  await api?.dictation?.setCompanionTrayEnabled?.(enabled);
}

export function saveDictationSettings(settings: DictationSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  void syncElectronDictationCompanionTray(settings.enabled);
}

export function isDictationConfigured(): boolean {
  const settings = loadDictationSettings();
  if (!settings.enabled) return false;

  switch (settings.provider) {
    case 'openai_whisper': {
      const llmStored = localStorage.getItem('hydranote_llm_settings');
      if (!llmStored) return false;
      const llm = JSON.parse(llmStored);
      return !!llm?.openai?.apiKey;
    }
    case 'deepgram':
      return !!settings.providerConfig.deepgram.apiKey;
    case 'local_whisper':
      return !!(window as unknown as Record<string, unknown>).electronAPI;
    default:
      return false;
  }
}
