/**
 * LLM Service
 * Handles communication with OpenAI, Ollama, Anthropic, Google, and local Hugging Face LLM providers
 */

import type {
  LLMSettings,
  LLMMessage,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMStreamCallback,
  NoteSettings,
  ImageGenerationSettings,
  AnthropicConfig,
  GoogleConfig,
  HuggingFaceLocalConfig,
  OllamaConfig,
} from '../types';
import { DEFAULT_LLM_SETTINGS, DEFAULT_NOTE_SETTINGS, DEFAULT_IMAGE_GENERATION_SETTINGS, OLLAMA_CLOUD_BASE_URL } from '../types';
import { isLocalModelsAvailable, runInference, getRuntimeStatus, loadModel } from './localModelService';

const STORAGE_KEY = 'hydranote_llm_settings';
const ANTHROPIC_API_VERSION = '2023-06-01';

// ============================================
// Settings Management
// ============================================

/**
 * Load LLM settings from localStorage.
 *
 * Migrates legacy `ollama.mode === 'cloud'` configurations to local mode.
 * The local Ollama daemon (since v0.6+) transparently proxies cloud-tagged
 * models (e.g. `qwen3-coder:480b-cloud`) to ollama.com when the user has
 * authenticated via `ollama signin`. This means the renderer only needs
 * to talk to the local daemon — no CORS, no API key managed in HydraNote.
 *
 * The legacy `apiKey` is preserved on disk (dormant) to avoid silent data
 * loss; it is no longer read or sent on requests.
 */
export function loadSettings(): LLMSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Deep merge to ensure nested settings are properly initialized
      const merged: LLMSettings = {
        ...DEFAULT_LLM_SETTINGS,
        ...parsed,
        noteSettings: {
          ...DEFAULT_NOTE_SETTINGS,
          ...(parsed.noteSettings || {}),
        },
        imageGeneration: {
          ...DEFAULT_IMAGE_GENERATION_SETTINGS,
          ...(parsed.imageGeneration || {}),
          openai: {
            ...DEFAULT_IMAGE_GENERATION_SETTINGS.openai,
            ...(parsed.imageGeneration?.openai || {}),
          },
          google: {
            ...DEFAULT_IMAGE_GENERATION_SETTINGS.google,
            ...(parsed.imageGeneration?.google || {}),
          },
        },
      };

      // Cloud → local migration. Preserve apiKey (dormant on disk) and the
      // model name (cloud-tagged models continue to work via the local
      // daemon's proxy). Reset baseUrl to localhost only if it was empty.
      if (merged.ollama.mode === 'cloud') {
        merged.ollama = {
          ...merged.ollama,
          mode: 'local',
          baseUrl: merged.ollama.baseUrl?.trim() ? merged.ollama.baseUrl : 'http://localhost:11434',
        };
      }

      return merged;
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
  switch (settings.provider) {
    case 'openai':
      return !!settings.openai.apiKey;
    case 'ollama':
      if (!settings.ollama.model) return false;
      return !!settings.ollama.baseUrl;
    case 'anthropic':
      return !!settings.anthropic.apiKey;
    case 'google':
      return !!settings.google.apiKey;
    case 'huggingface_local':
      return !!settings.huggingfaceLocal?.modelId;
    default:
      return false;
  }
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
 * Get project rotation instructions for use in project routing prompts
 */
export function getProjectRotationInstructions(): string {
  const noteSettings = loadNoteSettings();
  return noteSettings.projectRotationInstructions || '';
}

/**
 * Get directory rotation instructions for use in directory routing prompts
 */
export function getDirectoryRotationInstructions(): string {
  const noteSettings = loadNoteSettings();
  return noteSettings.directoryRotationInstructions || '';
}

/**
 * Get default note directory
 */
export function getDefaultNoteDirectory(): string {
  const noteSettings = loadNoteSettings();
  return noteSettings.defaultDirectory || 'notes';
}

/**
 * Check if auto-formatting is enabled for note saves
 */
export function isAutoFormatEnabled(): boolean {
  const noteSettings = loadNoteSettings();
  return noteSettings.autoFormat !== false;
}

/**
 * Check if AI project routing is enabled for note saves
 */
export function isAutoProjectRoutingEnabled(): boolean {
  const noteSettings = loadNoteSettings();
  return noteSettings.autoProjectRouting !== false;
}

/**
 * Check if AI directory routing is enabled for note saves
 */
export function isAutoDirectoryRoutingEnabled(): boolean {
  const noteSettings = loadNoteSettings();
  return noteSettings.autoDirectoryRouting !== false;
}

// ============================================
// Image Generation Settings Management
// ============================================

/**
 * Load image generation settings from stored settings
 */
export function loadImageGenerationSettings(): ImageGenerationSettings {
  const settings = loadSettings();
  return settings.imageGeneration || { ...DEFAULT_IMAGE_GENERATION_SETTINGS };
}

/**
 * Save image generation settings to storage
 */
export function saveImageGenerationSettings(imageGenSettings: ImageGenerationSettings): void {
  const settings = loadSettings();
  settings.imageGeneration = imageGenSettings;
  saveSettings(settings);
}

/**
 * Get image generation global instructions for use in prompts
 */
export function getImageGenerationInstructions(): string {
  const imgSettings = loadImageGenerationSettings();
  return imgSettings.globalInstructions || '';
}

/**
 * Check if image generation is configured (provider has an API key set)
 */
export function isImageGenerationConfigured(): boolean {
  const settings = loadSettings();
  const imgSettings = settings.imageGeneration || DEFAULT_IMAGE_GENERATION_SETTINGS;
  switch (imgSettings.provider) {
    case 'openai':
      return !!settings.openai.apiKey;
    case 'google':
      return !!settings.google.apiKey;
    default:
      return false;
  }
}

// ============================================
// OpenAI API
// ============================================

/**
 * Check if the model is an OpenAI reasoning model (o-series and GPT-5 series)
 * These models don't support the temperature parameter and use max_completion_tokens
 */
function isOpenAIReasoningModel(model: string): boolean {
  const reasoningPrefixes = ['o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o4-mini', 'gpt-5'];
  return reasoningPrefixes.some(rm => model.startsWith(rm));
}

/**
 * Default reasoning effort for OpenAI reasoning-capable models.
 * OpenAI reasoning models reject "none" and require low/medium/high/xhigh.
 */
const OPENAI_DEFAULT_REASONING_EFFORT = 'low';

/**
 * Check if the Anthropic model supports extended thinking
 * Extended thinking is available on Claude 3.7 Sonnet and later models (including Claude 4.x)
 * Model names: claude-opus-4-6, claude-sonnet-4-5, claude-haiku-4-5, claude-sonnet-4-20250514, etc.
 */
function isAnthropicThinkingModel(model: string): boolean {
  const thinkingPrefixes = [
    'claude-3-7', 'claude-3.7',           // Claude 3.7 Sonnet
    'claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4',  // Claude 4.x named format
    'claude-4',                             // Claude 4 generic prefix
  ];
  return thinkingPrefixes.some(prefix => model.startsWith(prefix));
}

/**
 * Check if the Google model supports thinking (Gemini 2.5 and 3 series)
 * Note: gemini-2.5-flash-lite does not think by default but can be enabled
 */
function isGoogleThinkingModel(model: string): boolean {
  return model.startsWith('gemini-2.5') || model.startsWith('gemini-3') || model.includes('thinking');
}

async function callOpenAI(
  request: LLMCompletionRequest,
  config: LLMSettings['openai']
): Promise<LLMCompletionResponse> {
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const isReasoning = isOpenAIReasoningModel(config.model);
  
  // Build request body based on model type
  const body: Record<string, unknown> = {
    model: config.model,
    messages: request.messages,
  };

  if (isReasoning) {
    // GPT-5 series and o-series use max_completion_tokens and don't support temperature
    body.max_completion_tokens = request.maxTokens ?? 16384;
    // Reasoning models require a supported reasoning_effort value.
    body.reasoning_effort = OPENAI_DEFAULT_REASONING_EFFORT;
  } else {
    // Older models use max_tokens and support temperature
    body.temperature = request.temperature ?? 0.7;
    body.max_tokens = request.maxTokens ?? 4096;
  }
  
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
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

/**
 * Resolve the effective base URL + headers for an Ollama request.
 *
 * The chat path is local-daemon-only: cloud-tagged models (`*-cloud`) are
 * proxied automatically by a local Ollama daemon that the user has
 * authenticated via `ollama signin`, so HydraNote always talks to the
 * configured local URL.
 *
 * For backwards compatibility, this helper still tolerates an optional
 * `mode: 'cloud'` discriminator on `OllamaConfig` (used by the embeddings
 * indexer config, which retains its own local/cloud split). When `cloud`
 * is supplied it returns the fixed `OLLAMA_CLOUD_BASE_URL` and attaches a
 * bearer header; in chat code, this branch is unreachable because
 * `loadSettings()` migrates `mode: 'cloud'` to `'local'`.
 *
 * Exported for the embedding/vision services that share the same daemon.
 */
export function getOllamaRequestConfig(
  config: Pick<OllamaConfig, 'mode' | 'baseUrl' | 'apiKey'>
): { baseUrl: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.mode === 'cloud') {
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    return { baseUrl: OLLAMA_CLOUD_BASE_URL, headers };
  }
  return { baseUrl: config.baseUrl, headers };
}

/**
 * Whether the renderer can route HTTP requests through the Electron main
 * process via the `web:fetch` IPC bridge.
 *
 * Used by the embeddings indexer's Ollama cloud mode (still supported)
 * and shared services that talk to ollama.com directly. The chat path
 * never needs IPC — it goes to localhost.
 */
function isElectronWebFetchAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.web?.fetch;
}

interface OllamaFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

interface OllamaFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
  json<T = unknown>(): T;
}

/**
 * Issue a non-streaming HTTP request to an Ollama endpoint, routing through
 * the Electron `web:fetch` IPC bridge when available and falling back to
 * native `fetch`.
 *
 * Exported for `embeddingService` (whose Ollama indexer config still has
 * a `mode: 'local' | 'cloud'` discriminator and needs the IPC bridge for
 * the cloud branch under the `capacitor-electron://-` origin).
 */
export async function ollamaJsonFetch(url: string, init: OllamaFetchInit = {}): Promise<OllamaFetchResult> {
  const { method = 'GET', headers = {}, body, timeout = 30000 } = init;

  if (isElectronWebFetchAvailable()) {
    const result = await window.electronAPI!.web.fetch({ url, method, headers, body, timeout });
    if (!result.success) {
      // Surface the same shape regardless of transport so callers can
      // inspect status/text without knowing whether IPC or fetch was used.
      throw new Error(result.error || `Ollama request failed: ${url}`);
    }
    const status = result.status ?? 0;
    const responseBody = result.body ?? '';
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      body: responseBody,
      json<T = unknown>(): T {
        return JSON.parse(responseBody) as T;
      },
    };
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ?? undefined,
  });
  const responseBody = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body: responseBody,
    json<T = unknown>(): T {
      return JSON.parse(responseBody) as T;
    },
  };
}

interface OllamaChatResponse {
  message?: { content?: string; thinking?: string };
  done?: boolean;
  eval_count?: number;
  prompt_eval_count?: number;
}

async function callOllama(
  request: LLMCompletionRequest,
  config: LLMSettings['ollama']
): Promise<LLMCompletionResponse> {
  // Route through ollamaJsonFetch so Electron uses the main-process IPC bridge:
  // the local daemon rejects the renderer's `capacitor-electron://-` origin (403),
  // so the request must originate where no browser origin is attached.
  // Generous timeout covers cold cloud-model pulls on first use.
  const result = await ollamaJsonFetch(`${config.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: request.messages,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 4096,
      },
    }),
    timeout: 300000,
  });

  if (!result.ok) {
    throw new Error(`Ollama API error: ${result.body || result.status}`);
  }

  const data = result.json<OllamaChatResponse>();

  const content = data.message?.content?.trim() ?? '';
  const thinking = data.message?.thinking?.trim() ?? '';

  return {
    content: content || thinking,
    finishReason: data.done ? 'stop' : undefined,
    usage: data.eval_count ? {
      promptTokens: data.prompt_eval_count || 0,
      completionTokens: data.eval_count || 0,
      totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
    } : undefined,
  };
}

// ============================================
// Anthropic (Claude) API
// ============================================

async function callAnthropic(
  request: LLMCompletionRequest,
  config: AnthropicConfig
): Promise<LLMCompletionResponse> {
  // Convert messages to Anthropic format
  // Anthropic requires system message to be passed separately
  let systemPrompt = '';
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  
  for (const msg of request.messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
    } else {
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: request.maxTokens ?? 4096,
    messages,
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  
  // Extract text from content blocks
  const content = data.content
    ?.filter((block: { type: string }) => block.type === 'text')
    .map((block: { text: string }) => block.text)
    .join('') || '';

  return {
    content,
    finishReason: data.stop_reason,
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens,
    } : undefined,
  };
}

// ============================================
// Google (Gemini) API
// ============================================

async function callGoogle(
  request: LLMCompletionRequest,
  config: GoogleConfig
): Promise<LLMCompletionResponse> {
  // Convert messages to Gemini format
  // Gemini uses 'user' and 'model' roles, and system prompt goes in systemInstruction
  let systemInstruction = '';
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  
  for (const msg of request.messages) {
    if (msg.role === 'system') {
      systemInstruction = msg.content;
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }
  }

  const isThinking = isGoogleThinkingModel(config.model);

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: request.maxTokens ?? 4096,
      ...(isThinking ? {} : { temperature: request.temperature ?? 0.7 }),
    },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  
  // Extract text from response (filter out thought parts for thinking models)
  const content = data.candidates?.[0]?.content?.parts
    ?.filter((part: { text: string; thought?: boolean }) => !part.thought)
    ?.map((part: { text: string }) => part.text)
    .join('') || '';

  return {
    content,
    finishReason: data.candidates?.[0]?.finishReason,
    usage: data.usageMetadata ? {
      promptTokens: data.usageMetadata.promptTokenCount || 0,
      completionTokens: data.usageMetadata.candidatesTokenCount || 0,
      totalTokens: data.usageMetadata.totalTokenCount || 0,
    } : undefined,
  };
}

// ============================================
// Streaming API - OpenAI
// ============================================

async function streamOpenAI(
  request: LLMCompletionRequest,
  config: LLMSettings['openai'],
  onChunk: LLMStreamCallback
): Promise<LLMCompletionResponse> {
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const isReasoning = isOpenAIReasoningModel(config.model);

  // Build request body based on model type
  const body: Record<string, unknown> = {
    model: config.model,
    messages: request.messages,
    stream: true,
  };

  if (isReasoning) {
    // GPT-5 series and o-series use max_completion_tokens and don't support temperature
    body.max_completion_tokens = request.maxTokens ?? 16384;
    // Reasoning models require a supported reasoning_effort value.
    body.reasoning_effort = OPENAI_DEFAULT_REASONING_EFFORT;
  } else {
    // Older models use max_tokens and support temperature
    body.temperature = request.temperature ?? 0.7;
    body.max_tokens = request.maxTokens ?? 4096;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';

  try {
    let hasMore = true;
    while (hasMore) {
      const { done, value } = await reader.read();
      if (done) {
        hasMore = false;
        continue;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            fullContent += content;
            onChunk(content, false);
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  onChunk('', true);

  return {
    content: fullContent,
    finishReason: 'stop',
  };
}

// ============================================
// Streaming API - Ollama
// ============================================

async function streamOllama(
  request: LLMCompletionRequest,
  config: LLMSettings['ollama'],
  onChunk: LLMStreamCallback
): Promise<LLMCompletionResponse> {
  const url = `${config.baseUrl}/api/chat`;
  const body = JSON.stringify({
    model: config.model,
    messages: request.messages,
    stream: true,
    options: {
      temperature: request.temperature ?? 0.7,
      num_predict: request.maxTokens ?? 4096,
    },
  });

  // Shared NDJSON line handler: accumulates content, forwards deltas via
  // onChunk, and captures the terminal response when Ollama sends `done`.
  let fullContent = '';
  let fullThinking = '';
  let finalResponse: LLMCompletionResponse | null = null;
  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const json = JSON.parse(trimmed) as OllamaChatResponse;
      const thinking = json.message?.thinking;
      if (thinking) {
        fullThinking += thinking;
        onChunk(thinking, false, 'reasoning');
      }
      const content = json.message?.content;
      if (content) {
        fullContent += content;
        onChunk(content, false, 'content');
      }
      if (json.done) {
        finalResponse = {
          content: fullContent || fullThinking,
          finishReason: 'stop',
          usage: json.eval_count ? {
            promptTokens: json.prompt_eval_count || 0,
            completionTokens: json.eval_count || 0,
            totalTokens: (json.prompt_eval_count || 0) + (json.eval_count || 0),
          } : undefined,
        };
      }
    } catch {
      // Skip malformed JSON lines
    }
  };

  // Electron: stream through the main-process IPC bridge so the request carries
  // no browser origin (the local daemon 403s the renderer's custom-scheme origin).
  if (isElectronWebFetchAvailable()) {
    let buffer = '';
    const result = await window.electronAPI!.web.fetchStream(
      {
        requestId: `ollama-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        timeout: 300000,
      },
      (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) handleLine(line);
      },
    );

    if (!result.success) {
      throw new Error(`Ollama API error: ${result.error || result.status}`);
    }

    if (buffer.trim()) handleLine(buffer);
    onChunk('', true);
    return finalResponse ?? { content: fullContent || fullThinking, finishReason: 'stop' };
  }

  // Web/PWA fallback: native streaming fetch (no custom-scheme origin there).
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama API error: ${error || response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    let hasMore = true;
    while (hasMore) {
      const { done, value } = await reader.read();
      if (done) {
        hasMore = false;
        continue;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        handleLine(line);
        if (finalResponse) {
          onChunk('', true);
          return finalResponse;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (buffer.trim()) handleLine(buffer);
  onChunk('', true);

  return finalResponse ?? {
    content: fullContent || fullThinking,
    finishReason: 'stop',
  };
}

// ============================================
// Streaming API - Anthropic (Claude)
// ============================================

async function streamAnthropic(
  request: LLMCompletionRequest,
  config: AnthropicConfig,
  onChunk: LLMStreamCallback
): Promise<LLMCompletionResponse> {
  // Convert messages to Anthropic format
  let systemPrompt = '';
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  
  for (const msg of request.messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
    } else {
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  const isThinking = isAnthropicThinkingModel(config.model);
  const maxTokens = request.maxTokens ?? (isThinking ? 16384 : 4096);
  // Extended thinking requires enough token budget: max_tokens must be > budget_tokens
  // Only enable thinking when there's enough room (at least 2000 tokens for budget + output)
  const canThink = isThinking && maxTokens >= 2000;

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: canThink ? Math.max(maxTokens, 16384) : maxTokens,
    messages,
    stream: true,
  };

  // Enable extended thinking for supported models (when budget allows)
  if (canThink) {
    const budgetTokens = Math.min(10000, Math.max(1024, Math.floor(maxTokens * 0.6)));
    body.thinking = {
      type: 'enabled',
      budget_tokens: budgetTokens,
    };
  }

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Anthropic API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';

  try {
    let hasMore = true;
    while (hasMore) {
      const { done, value } = await reader.read();
      if (done) {
        hasMore = false;
        continue;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          
          // Handle thinking_delta events (extended thinking)
          if (json.type === 'content_block_delta' && json.delta?.type === 'thinking_delta' && json.delta?.thinking) {
            onChunk(json.delta.thinking, false, 'reasoning');
          }
          
          // Handle text content_block_delta events
          if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta' && json.delta?.text) {
            fullContent += json.delta.text;
            onChunk(json.delta.text, false, 'content');
          }
          
          // Handle legacy format (non-thinking models)
          if (json.type === 'content_block_delta' && json.delta?.text && !json.delta?.type) {
            fullContent += json.delta.text;
            onChunk(json.delta.text, false, 'content');
          }
          
          // Handle message_stop event
          if (json.type === 'message_stop') {
            onChunk('', true);
            return {
              content: fullContent,
              finishReason: 'stop',
            };
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  onChunk('', true);

  return {
    content: fullContent,
    finishReason: 'stop',
  };
}

// ============================================
// Streaming API - Google (Gemini)
// ============================================

async function streamGoogle(
  request: LLMCompletionRequest,
  config: GoogleConfig,
  onChunk: LLMStreamCallback
): Promise<LLMCompletionResponse> {
  // Convert messages to Gemini format
  let systemInstruction = '';
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  
  for (const msg of request.messages) {
    if (msg.role === 'system') {
      systemInstruction = msg.content;
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }
  }

  const isThinking = isGoogleThinkingModel(config.model);
  // Only include thought summaries when there's enough output token room
  const includeThoughts = isThinking && (request.maxTokens ?? 4096) >= 2000;

  console.log('[streamGoogle] model:', config.model, 'isThinking:', isThinking, 'includeThoughts:', includeThoughts, 'maxTokens:', request.maxTokens);

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: request.maxTokens ?? 4096,
      ...(isThinking ? {} : { temperature: request.temperature ?? 0.7 }),
      ...(includeThoughts ? { thinkingConfig: { includeThoughts: true } } : {}),
    },
  };

  console.log('[streamGoogle] Request body:', JSON.stringify(body, null, 2));

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:streamGenerateContent?alt=sse&key=${config.apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error('[streamGoogle] API error:', error);
    throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';
  let debugChunkCount = 0;

  try {
    let hasMore = true;
    while (hasMore) {
      const { done, value } = await reader.read();
      if (done) {
        hasMore = false;
        continue;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          
          // Extract parts from candidates
          const parts = json.candidates?.[0]?.content?.parts || [];
          
          // Debug: log first few chunks to see the raw structure
          if (debugChunkCount < 5) {
            console.log(`[streamGoogle] Chunk #${debugChunkCount}:`, JSON.stringify(parts));
            debugChunkCount++;
          }
          
          for (const part of parts) {
            // Gemini 2.5+ models flag thinking parts with thought: true
            if (part.thought && part.text) {
              onChunk(part.text, false, 'reasoning');
            } else if (part.text) {
              fullContent += part.text;
              onChunk(part.text, false, 'content');
            }
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  onChunk('', true);

  return {
    content: fullContent,
    finishReason: 'stop',
  };
}

// ============================================
// Hugging Face Local API
// ============================================

/**
 * Check and ensure the model is loaded before inference
 */
async function ensureModelLoaded(config: HuggingFaceLocalConfig): Promise<void> {
  if (!isLocalModelsAvailable()) {
    throw new Error('Local models are only available in the Electron app');
  }

  const status = await getRuntimeStatus();
  
  // If a different model is loaded, we need to load the correct one
  if (status.loadedModelId !== config.modelId) {
    await loadModel(config.modelId, {
      gpuLayers: config.gpuLayers,
      contextLength: config.contextLength,
    });
  }
  
  // Verify the model is ready
  const newStatus = await getRuntimeStatus();
  if (!newStatus.ready) {
    throw new Error(newStatus.error || 'Model failed to load');
  }
}

/**
 * Call local Hugging Face model for completion
 */
async function callHuggingFaceLocal(
  request: LLMCompletionRequest,
  config: HuggingFaceLocalConfig
): Promise<LLMCompletionResponse> {
  await ensureModelLoaded(config);

  const content = await runInference(request.messages, {
    maxTokens: request.maxTokens ?? 2048,
    temperature: request.temperature ?? 0.7,
    stream: false,
  });

  return {
    content,
    finishReason: 'stop',
  };
}

/**
 * Stream completion from local Hugging Face model
 * Note: True streaming would require IPC event handling
 * For now, this fetches the complete response and emits it as chunks
 */
async function streamHuggingFaceLocal(
  request: LLMCompletionRequest,
  config: HuggingFaceLocalConfig,
  onChunk: LLMStreamCallback
): Promise<LLMCompletionResponse> {
  await ensureModelLoaded(config);

  // TODO: Implement true streaming via IPC events
  // For now, get the full response and simulate streaming
  const content = await runInference(request.messages, {
    maxTokens: request.maxTokens ?? 2048,
    temperature: request.temperature ?? 0.7,
    stream: false, // Would be true with proper IPC streaming
  });

  // Emit the content in small chunks to simulate streaming
  const chunkSize = 20;
  for (let i = 0; i < content.length; i += chunkSize) {
    const chunk = content.slice(i, i + chunkSize);
    onChunk(chunk, false);
    // Small delay to simulate streaming
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  onChunk('', true);

  return {
    content,
    finishReason: 'stop',
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
  
  switch (settings.provider) {
    case 'openai':
      if (!settings.openai.apiKey) {
        throw new Error('OpenAI API key not configured. Please add your API key in Settings.');
      }
      return callOpenAI(request, settings.openai);
    
    case 'ollama':
      if (!settings.ollama.baseUrl) {
        throw new Error('Ollama URL not configured. Please configure Ollama in Settings.');
      }
      return callOllama(request, settings.ollama);
    
    case 'anthropic':
      if (!settings.anthropic.apiKey) {
        throw new Error('Anthropic API key not configured. Please add your API key in Settings.');
      }
      return callAnthropic(request, settings.anthropic);
    
    case 'google':
      if (!settings.google.apiKey) {
        throw new Error('Google API key not configured. Please add your API key in Settings.');
      }
      return callGoogle(request, settings.google);
    
    case 'huggingface_local':
      if (!settings.huggingfaceLocal?.modelId) {
        throw new Error('No local model selected. Please select a model in Settings.');
      }
      return callHuggingFaceLocal(request, settings.huggingfaceLocal);
    
    default:
      throw new Error(`Unknown LLM provider: ${settings.provider}`);
  }
}

/**
 * Send a streaming chat completion request to the configured LLM provider
 * Calls the onChunk callback with each text chunk as it arrives
 */
export async function chatCompletionStreaming(
  request: LLMCompletionRequest,
  onChunk: LLMStreamCallback
): Promise<LLMCompletionResponse> {
  const settings = loadSettings();
  
  switch (settings.provider) {
    case 'openai':
      if (!settings.openai.apiKey) {
        throw new Error('OpenAI API key not configured. Please add your API key in Settings.');
      }
      return streamOpenAI(request, settings.openai, onChunk);
    
    case 'ollama':
      if (!settings.ollama.baseUrl) {
        throw new Error('Ollama URL not configured. Please configure Ollama in Settings.');
      }
      return streamOllama(request, settings.ollama, onChunk);
    
    case 'anthropic':
      if (!settings.anthropic.apiKey) {
        throw new Error('Anthropic API key not configured. Please add your API key in Settings.');
      }
      return streamAnthropic(request, settings.anthropic, onChunk);
    
    case 'google':
      if (!settings.google.apiKey) {
        throw new Error('Google API key not configured. Please add your API key in Settings.');
      }
      return streamGoogle(request, settings.google, onChunk);
    
    case 'huggingface_local':
      if (!settings.huggingfaceLocal?.modelId) {
        throw new Error('No local model selected. Please select a model in Settings.');
      }
      // Note: Streaming for local models would be handled differently
      // For now, we call non-streaming and emit the full result
      return streamHuggingFaceLocal(request, settings.huggingfaceLocal, onChunk);
    
    default:
      throw new Error(`Unknown LLM provider: ${settings.provider}`);
  }
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
      maxTokens: 512,
    });

    const message = response.content?.trim() ?? '';
    if (!message) {
      return {
        success: false,
        message: 'Connected but model returned empty content (try a higher token budget or a non-thinking model).',
      };
    }
    
    return {
      success: true,
      message,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get available Ollama models for the given daemon.
 *
 * Accepts either a plain base URL (legacy local-only call sites) or a full
 * Ollama config object. The chat path is local-daemon-only after the
 * cloud → local migration in `loadSettings`; the config-object overload
 * is retained for the embeddings indexer, which still has its own
 * `mode: 'local' | 'cloud'` discriminator.
 */
export async function getOllamaModels(
  configOrBaseUrl: string | Pick<OllamaConfig, 'mode' | 'baseUrl' | 'apiKey'>
): Promise<string[]> {
  const { baseUrl, headers } =
    typeof configOrBaseUrl === 'string'
      ? { baseUrl: configOrBaseUrl, headers: { 'Content-Type': 'application/json' } as Record<string, string> }
      : getOllamaRequestConfig(configOrBaseUrl);
  try {
    // Route through ollamaJsonFetch (main-process IPC in Electron) — the daemon
    // rejects the renderer's custom-scheme origin with 403, which would otherwise
    // leave the "Available Models" list empty.
    const result = await ollamaJsonFetch(`${baseUrl}/api/tags`, { method: 'GET', headers });
    if (!result.ok) {
      throw new Error(`Failed to fetch models: ${result.status}`);
    }
    const data = result.json<{ models?: Array<{ name: string }> }>();
    return data.models?.map((m) => m.name) || [];
  } catch {
    return [];
  }
}


