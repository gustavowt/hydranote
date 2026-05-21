/**
 * Vision Service
 *
 * Provider-aware adapter for "describe this image" calls. The PDF ingestion
 * pipeline renders a page to an in-memory PNG, hands the bytes to this service,
 * and persists the returned text as a `visual_description` chunk.
 *
 * The LLM provider is the one currently configured in `loadSettings()`. Each
 * provider has a hardcoded vision-capable default model — we do not expose a
 * separate setting for this iteration. Hugging Face Local has no vision model
 * support today and returns `null` so the caller can degrade gracefully.
 */

import { loadSettings, getOllamaModels, getOllamaRequestConfig } from './llmService';
import type { LLMSettings, OllamaConfig } from '../types';

const ANTHROPIC_API_VERSION = '2023-06-01';

/**
 * Default vision-capable model per provider. Kept in code (not settings) so the
 * pipeline always has a sensible fallback even on a fresh install.
 */
const DEFAULT_VISION_MODELS: Record<LLMSettings['provider'], string | null> = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-latest',
  google: 'gemini-3.1-flash',
  // Ollama: probe for an installed vision model. The static default below is
  // only used if probing fails; the runtime probe in `pickOllamaVisionModel`
  // takes precedence.
  ollama: 'llava',
  // No local Hugging Face GGUF runtime in HydraNote currently exposes vision
  // input. Returning null causes the ingestion pipeline to skip visual analysis
  // and ingest text-only chunks for that file.
  huggingface_local: null,
};

/**
 * Ordered candidates we accept as vision-capable Ollama tags. The first
 * installed match wins. Substring match against the local tag list keeps the
 * check version-tolerant (e.g. "llava:13b", "llama3.2-vision:latest").
 */
const OLLAMA_VISION_CANDIDATES = [
  'llama3.2-vision',
  'llama3.2-vision:11b',
  'llama3.2-vision:90b',
  'llava',
  'llava:13b',
  'llava:34b',
  'llava-llama3',
  'bakllava',
  'minicpm-v',
];

export interface VisionRequest {
  /** Base64-encoded image bytes (no data: prefix) */
  base64: string;
  /** MIME type of the image bytes (typically image/png) */
  mime: string;
  /**
   * Short prompt giving the model a goal. The PDF ingestion pipeline supplies
   * a page-context prompt so the description carries identifiers usable by
   * downstream retrieval.
   */
  prompt: string;
}

/**
 * Describe an image using the configured LLM provider's vision-capable model.
 *
 * Returns `null` when the active provider has no vision support (Hugging Face
 * Local) or when an Ollama instance has no compatible model installed. Network
 * / API errors are thrown to the caller so the ingestion pipeline can record
 * them and continue with the next page.
 */
export async function describeImage(req: VisionRequest): Promise<string | null> {
  const settings = loadSettings();
  switch (settings.provider) {
    case 'openai':
      return describeWithOpenAI(req, settings);
    case 'anthropic':
      return describeWithAnthropic(req, settings);
    case 'google':
      return describeWithGoogle(req, settings);
    case 'ollama':
      return describeWithOllama(req, settings);
    case 'huggingface_local':
      return null;
    default:
      return null;
  }
}

/**
 * Returns true when the active provider has a usable vision pathway right now.
 * Used by the PDF ingestion pipeline to short-circuit page rendering when no
 * description can be produced.
 */
export async function isVisionAvailable(): Promise<boolean> {
  const settings = loadSettings();
  switch (settings.provider) {
    case 'openai':
      return !!settings.openai.apiKey;
    case 'anthropic':
      return !!settings.anthropic.apiKey;
    case 'google':
      return !!settings.google.apiKey;
    case 'ollama':
      return (await pickOllamaVisionModel(settings.ollama)) !== null;
    case 'huggingface_local':
      return false;
    default:
      return false;
  }
}

// ============================================
// OpenAI
// ============================================

async function describeWithOpenAI(
  req: VisionRequest,
  settings: LLMSettings,
): Promise<string> {
  const config = settings.openai;
  if (!config.apiKey) {
    throw new Error('OpenAI API key is not configured');
  }
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const model = DEFAULT_VISION_MODELS.openai as string;

  const body = {
    model,
    max_tokens: 1024,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: req.prompt },
          {
            type: 'image_url',
            image_url: { url: `data:${req.mime};base64,${req.base64}` },
          },
        ],
      },
    ],
  };

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `OpenAI vision error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.toString() ?? '';
}

// ============================================
// Anthropic (Claude)
// ============================================

async function describeWithAnthropic(
  req: VisionRequest,
  settings: LLMSettings,
): Promise<string> {
  const config = settings.anthropic;
  if (!config.apiKey) {
    throw new Error('Anthropic API key is not configured');
  }
  const model = DEFAULT_VISION_MODELS.anthropic as string;

  const body = {
    model,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: req.mime,
              data: req.base64,
            },
          },
          { type: 'text', text: req.prompt },
        ],
      },
    ],
  };

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
    throw new Error(error.error?.message || `Anthropic vision error: ${response.status}`);
  }

  const data = await response.json();
  return (data.content as Array<{ type: string; text?: string }> | undefined)
    ?.filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('') ?? '';
}

// ============================================
// Google (Gemini)
// ============================================

async function describeWithGoogle(
  req: VisionRequest,
  settings: LLMSettings,
): Promise<string> {
  const config = settings.google;
  if (!config.apiKey) {
    throw new Error('Google API key is not configured');
  }
  const model = DEFAULT_VISION_MODELS.google as string;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: req.prompt },
          { inlineData: { mimeType: req.mime, data: req.base64 } },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.2,
    },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Gemini vision error: ${response.status}`);
  }

  const data = await response.json();
  return (data.candidates?.[0]?.content?.parts as Array<{ text?: string; thought?: boolean }> | undefined)
    ?.filter((p) => !p.thought)
    .map((p) => p.text || '')
    .join('') ?? '';
}

// ============================================
// Ollama
// ============================================

/**
 * Discover a vision-capable model installed in the configured Ollama daemon
 * (local or Ollama Cloud), falling back through `OLLAMA_VISION_CANDIDATES`.
 * Result is `null` when the daemon is unreachable or has no compatible model.
 */
async function pickOllamaVisionModel(
  config: Pick<OllamaConfig, 'mode' | 'baseUrl' | 'apiKey'>,
): Promise<string | null> {
  if (config.mode !== 'cloud' && !config.baseUrl) return null;
  if (config.mode === 'cloud' && !config.apiKey) return null;
  const installed = await getOllamaModels(config);
  if (installed.length === 0) return null;
  for (const candidate of OLLAMA_VISION_CANDIDATES) {
    const match = installed.find((tag) => tag === candidate || tag.startsWith(candidate));
    if (match) return match;
  }
  return null;
}

async function describeWithOllama(
  req: VisionRequest,
  settings: LLMSettings,
): Promise<string | null> {
  const config = settings.ollama;
  if (config.mode !== 'cloud' && !config.baseUrl) {
    throw new Error('Ollama baseUrl is not configured');
  }
  if (config.mode === 'cloud' && !config.apiKey) {
    throw new Error('Ollama Cloud apiKey is not configured');
  }
  const model = await pickOllamaVisionModel(config);
  if (!model) return null;

  const body = {
    model,
    stream: false,
    messages: [
      {
        role: 'user',
        content: req.prompt,
        images: [req.base64],
      },
    ],
    options: { temperature: 0.2, num_predict: 1024 },
  };

  const { baseUrl, headers } = getOllamaRequestConfig(config);
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama vision error: ${error || response.status}`);
  }

  const data = await response.json();
  return data.message?.content?.toString() ?? '';
}
