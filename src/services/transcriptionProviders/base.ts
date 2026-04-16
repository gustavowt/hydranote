/**
 * Base interface for all transcription providers.
 * Each provider implements `transcribe()` which accepts a WAV audio blob
 * and returns the transcribed text.
 */

import type { TranscriptionResult } from '../../types';

export interface TranscriptionProviderInterface {
  readonly name: string;
  transcribe(audioBlob: Blob, language?: string): Promise<TranscriptionResult>;
  isConfigured(): boolean;
}
