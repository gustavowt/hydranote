/**
 * Deepgram transcription provider.
 * Uses a dedicated Deepgram API key configured in dictation settings.
 */

import type { TranscriptionResult } from '../../types';
import type { TranscriptionProviderInterface } from './base';

export class DeepgramProvider implements TranscriptionProviderInterface {
  readonly name = 'Deepgram';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'nova-3') {
    this.apiKey = apiKey;
    this.model = model;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async transcribe(audioBlob: Blob, language?: string): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      throw new Error('Deepgram API key not configured. Set it in Settings > Dictation.');
    }

    const arrayBuffer = await audioBlob.arrayBuffer();

    const params = new URLSearchParams({
      model: this.model,
      smart_format: 'true',
      punctuate: 'true',
    });
    if (language) {
      params.set('language', language);
    }

    const isElectron = !!(window as unknown as Record<string, unknown>).electronAPI;
    let responseBody: string;

    if (isElectron) {
      const electronAPI = (window as unknown as { electronAPI: { web: { fetch: (opts: Record<string, unknown>) => Promise<{ success: boolean; body?: string; error?: string }> } } }).electronAPI;
      const base64Data = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      const result = await electronAPI.web.fetch({
        url: `https://api.deepgram.com/v1/listen?${params.toString()}`,
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': audioBlob.type || 'audio/wav',
          'X-Binary-Base64': 'true',
        },
        body: base64Data,
        timeout: 60000,
      });

      if (!result.success) {
        throw new Error(`Deepgram API error: ${result.error}`);
      }
      responseBody = result.body || '{}';
    } else {
      const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': audioBlob.type || 'audio/wav',
        },
        body: arrayBuffer,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Deepgram API error (${response.status}): ${errorBody}`);
      }
      responseBody = await response.text();
    }

    const data = JSON.parse(responseBody) as {
      results?: {
        channels?: Array<{
          alternatives?: Array<{
            transcript?: string;
          }>;
        }>;
      };
      metadata?: {
        duration?: number;
        detected_language?: string;
      };
    };

    const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

    return {
      text: transcript,
      language: data.metadata?.detected_language,
      duration: data.metadata?.duration,
    };
  }
}
