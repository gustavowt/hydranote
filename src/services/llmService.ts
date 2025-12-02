/**
 * LLM Service
 * Handles communication with OpenAI and Ollama LLM providers
 */

import type {
  LLMSettings,
  LLMMessage,
  LLMCompletionRequest,
  LLMCompletionResponse,
  NoteSettings,
} from '../types';
import { DEFAULT_LLM_SETTINGS, DEFAULT_NOTE_SETTINGS } from '../types';

const STORAGE_KEY = 'docusage_llm_settings';

// ============================================
// Settings Management
// ============================================

/**
 * Load LLM settings from localStorage
 */
export function loadSettings(): LLMSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Deep merge to ensure noteSettings is properly initialized
      return {
        ...DEFAULT_LLM_SETTINGS,
        ...parsed,
        noteSettings: {
          ...DEFAULT_NOTE_SETTINGS,
          ...(parsed.noteSettings || {}),
        },
      };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_LLM_SETTINGS };
}

/**
 * Save LLM settings to localStorage
 */
export function saveSettings(settings: LLMSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Check if LLM is configured
 */
export function isConfigured(): boolean {
  const settings = loadSettings();
  if (settings.provider === 'openai') {
    return !!settings.openai.apiKey;
  }
  return !!settings.ollama.baseUrl && !!settings.ollama.model;
}

// ============================================
// Note Settings Management (Phase 9)
// ============================================

/**
 * Load note settings from stored settings
 */
export function loadNoteSettings(): NoteSettings {
  const settings = loadSettings();
  return settings.noteSettings || { ...DEFAULT_NOTE_SETTINGS };
}

/**
 * Save note settings to storage
 */
export function saveNoteSettings(noteSettings: NoteSettings): void {
  const settings = loadSettings();
  settings.noteSettings = noteSettings;
  saveSettings(settings);
}

/**
 * Get note format instructions for use in prompts
 */
export function getNoteFormatInstructions(): string {
  const noteSettings = loadNoteSettings();
  return noteSettings.formatInstructions || '';
}

/**
 * Get default note directory
 */
export function getDefaultNoteDirectory(): string {
  const noteSettings = loadNoteSettings();
  return noteSettings.defaultDirectory || 'notes';
}

// ============================================
// OpenAI API
// ============================================

async function callOpenAI(
  request: LLMCompletionRequest,
  config: LLMSettings['openai']
): Promise<LLMCompletionResponse> {
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  
  return {
    content: data.choices[0]?.message?.content || '',
    finishReason: data.choices[0]?.finish_reason,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  };
}

// ============================================
// Ollama API
// ============================================

async function callOllama(
  request: LLMCompletionRequest,
  config: LLMSettings['ollama']
): Promise<LLMCompletionResponse> {
  const response = await fetch(`${config.baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: request.messages,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 4096,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama API error: ${error || response.status}`);
  }

  const data = await response.json();
  
  return {
    content: data.message?.content || '',
    finishReason: data.done ? 'stop' : undefined,
    usage: data.eval_count ? {
      promptTokens: data.prompt_eval_count || 0,
      completionTokens: data.eval_count || 0,
      totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
    } : undefined,
  };
}

// ============================================
// Main API
// ============================================

/**
 * Send a chat completion request to the configured LLM provider
 */
export async function chatCompletion(
  request: LLMCompletionRequest
): Promise<LLMCompletionResponse> {
  const settings = loadSettings();
  
  if (settings.provider === 'openai') {
    if (!settings.openai.apiKey) {
      throw new Error('OpenAI API key not configured. Please add your API key in Settings.');
    }
    return callOpenAI(request, settings.openai);
  }
  
  if (settings.provider === 'ollama') {
    if (!settings.ollama.baseUrl) {
      throw new Error('Ollama URL not configured. Please configure Ollama in Settings.');
    }
    return callOllama(request, settings.ollama);
  }
  
  throw new Error(`Unknown LLM provider: ${settings.provider}`);
}

/**
 * Send a simple prompt and get a response
 */
export async function prompt(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const response = await chatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });
  return response.content;
}

/**
 * Send a conversation and get a response
 */
export async function chat(
  systemPrompt: string,
  messages: LLMMessage[]
): Promise<LLMCompletionResponse> {
  const fullMessages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];
  
  return chatCompletion({ messages: fullMessages });
}

/**
 * Test the LLM connection
 */
export async function testConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const response = await chatCompletion({
      messages: [
        { role: 'user', content: 'Say "Connection successful!" in exactly those words.' },
      ],
      maxTokens: 50,
    });
    
    return {
      success: true,
      message: response.content,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get available Ollama models
 */
export async function getOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    const data = await response.json();
    return data.models?.map((m: { name: string }) => m.name) || [];
  } catch {
    return [];
  }
}


