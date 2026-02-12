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
  AnthropicConfig,
  GoogleConfig,
  HuggingFaceLocalConfig,
} from '../types';
import { DEFAULT_LLM_SETTINGS, DEFAULT_NOTE_SETTINGS } from '../types';
import { isLocalModelsAvailable, runInference, getRuntimeStatus, loadModel } from './localModelService';

const STORAGE_KEY = 'hydranote_llm_settings';
const ANTHROPIC_API_VERSION = '2023-06-01';

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
  switch (settings.provider) {
    case 'openai':
      return !!settings.openai.apiKey;
    case 'ollama':
      return !!settings.ollama.baseUrl && !!settings.ollama.model;
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
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

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
  const response = await fetch(`${config.baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: request.messages,
      stream: true,
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

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const json = JSON.parse(trimmed);
          const content = json.message?.content;
          if (content) {
            fullContent += content;
            onChunk(content, false);
          }
          if (json.done) {
            onChunk('', true);
            return {
              content: fullContent,
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
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

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
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

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


