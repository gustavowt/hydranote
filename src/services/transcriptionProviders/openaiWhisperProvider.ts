/**
 * OpenAI Whisper API transcription provider.
 * Uses the configured OpenAI API key from LLM settings.
 */

import type { TranscriptionResult } from '../../types';
import type { TranscriptionProviderInterface } from './base';
import { loadSettings as loadLLMSettings } from '../llmService';

export class OpenAIWhisperProvider implements TranscriptionProviderInterface {
  readonly name = 'OpenAI Whisper';
  private model: string;

  constructor(model = 'whisper-1') {
    this.model = model;
  }

  isConfigured(): boolean {
    const llmSettings = loadLLMSettings();
    return !!llmSettings.openai?.apiKey;
  }

  async transcribe(audioBlob: Blob, language?: string): Promise<TranscriptionResult> {
    const llmSettings = loadLLMSettings();
    const apiKey = llmSettings.openai?.apiKey;

    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Set it in Settings > AI Providers.');
    }

    const baseUrl = llmSettings.openai?.baseUrl || 'https://api.openai.com/v1';

    // Match file extension to the actual recorded MIME type.
    // OpenAI Whisper rejects files where extension doesn't match content.
    const mimeType = audioBlob.type || 'audio/webm';
    let extension = 'webm';
    if (mimeType.includes('wav')) extension = 'wav';
    else if (mimeType.includes('ogg')) extension = 'ogg';
    else if (mimeType.includes('mp4') || mimeType.includes('m4a')) extension = 'mp4';
    else if (mimeType.includes('mpeg') || mimeType.includes('mp3')) extension = 'mp3';
    else if (mimeType.includes('flac')) extension = 'flac';

    const formData = new FormData();
    formData.append('file', audioBlob, `recording.${extension}`);
    formData.append('model', this.model);
    formData.append('response_format', 'verbose_json');
    if (language) {
      formData.append('language', language);
    }

    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI Whisper API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as {
      text: string;
      language?: string;
      duration?: number;
    };

    return {
      text: data.text,
      language: data.language,
      duration: data.duration,
    };
  }
}
