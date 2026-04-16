/**
 * Dictation Pipeline Service
 * Two-stage processing:
 *   1. Cleanup — optional LLM pass to fix grammar, filler words, punctuation
 *   2. Actions — insert at cursor, create note, send to chat, copy to clipboard
 */

import type { TranscriptionResult, DictationPipelineAction } from '../types';
import { loadDictationSettings } from './dictationSettingsService';
import { formatNote } from './noteService';
import { globalAddNote } from './noteService';
import { dictationState } from './dictationService';

type PipelineEventType = 'insert_at_cursor' | 'send_to_chat';
type PipelineEventCallback = (text: string) => void;

const pipelineListeners = new Map<PipelineEventType, PipelineEventCallback[]>();

export function onPipelineAction(event: PipelineEventType, callback: PipelineEventCallback): void {
  if (!pipelineListeners.has(event)) {
    pipelineListeners.set(event, []);
  }
  pipelineListeners.get(event)!.push(callback);
}

export function offPipelineAction(event: PipelineEventType, callback: PipelineEventCallback): void {
  const cbs = pipelineListeners.get(event);
  if (cbs) {
    const idx = cbs.indexOf(callback);
    if (idx !== -1) cbs.splice(idx, 1);
  }
}

function emitPipelineAction(event: PipelineEventType, text: string): void {
  const cbs = pipelineListeners.get(event);
  if (cbs) {
    for (const cb of cbs) {
      try { cb(text); } catch { /* ignore */ }
    }
  }
}

async function executeAction(action: DictationPipelineAction, text: string): Promise<string> {
  switch (action.type) {
    case 'insert_at_cursor':
      emitPipelineAction('insert_at_cursor', text);
      return text;

    case 'create_note':
      await globalAddNote({ rawNoteText: text });
      return text;

    case 'send_to_chat':
      emitPipelineAction('send_to_chat', text);
      return text;

    case 'copy_to_clipboard':
      await navigator.clipboard.writeText(text);
      return text;

    default:
      return text;
  }
}

/**
 * Run only the cleanup stage (LLM post-processing).
 * Returns the cleaned text, or the original text if cleanup is disabled.
 */
export async function runCleanup(rawText: string): Promise<string> {
  const settings = loadDictationSettings();
  if (!settings.cleanup.enabled) return rawText;

  dictationState.value = { status: 'cleaning_up' };
  const prompt = `${settings.cleanup.instructions}\n\n${rawText}`;
  return await formatNote(prompt);
}

/**
 * Run only the pipeline actions stage on already-confirmed text.
 */
export async function runActions(text: string): Promise<void> {
  const settings = loadDictationSettings();
  const enabledActions = settings.pipeline.filter((a) => a.enabled);

  if (enabledActions.length === 0) {
    await navigator.clipboard.writeText(text);
    return;
  }

  dictationState.value = { status: 'processing' };
  for (const action of enabledActions) {
    await executeAction(action, text);
  }
  dictationState.value = { status: 'idle' };
}

/**
 * Run the full dictation pipeline on a transcription result.
 *   Stage 1: Cleanup via LLM (if enabled in settings.cleanup)
 *   Stage 2: Execute enabled pipeline actions
 */
export async function runPipeline(result: TranscriptionResult): Promise<void> {
  const text = await runCleanup(result.text);
  await runActions(text);
}
