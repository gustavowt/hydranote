/**
 * Image Generation Service
 * Handles image generation via OpenAI (DALL-E / GPT Image) and Google Gemini APIs
 */

import { loadSettings } from './llmService';
import { DEFAULT_IMAGE_GENERATION_SETTINGS } from '../types';

export interface ImageGenerationResult {
  success: boolean;
  imageBase64?: string;
  mimeType?: string;
  revisedPrompt?: string;
  error?: string;
}

export interface ImageGenerationOptions {
  size?: string;
}

/**
 * Generate an image from a text prompt using the configured provider
 */
export async function generateImage(
  prompt: string,
  options?: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  const settings = loadSettings();
  const imgSettings = settings.imageGeneration || DEFAULT_IMAGE_GENERATION_SETTINGS;

  const globalInstructions = imgSettings.globalInstructions?.trim();
  const fullPrompt = globalInstructions
    ? `${globalInstructions}\n\n${prompt}`
    : prompt;

  switch (imgSettings.provider) {
    case 'openai':
      return generateWithOpenAI(fullPrompt, settings.openai.apiKey, settings.openai.baseUrl, imgSettings.openai.model, options);
    case 'google':
      return generateWithGoogle(fullPrompt, settings.google.apiKey, imgSettings.google.model, options);
    default:
      return { success: false, error: `Unknown image generation provider: ${imgSettings.provider}` };
  }
}

/**
 * Check if image generation is properly configured
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
// OpenAI Image Generation
// ============================================

async function generateWithOpenAI(
  prompt: string,
  apiKey: string,
  baseUrl: string | undefined,
  model: string,
  options?: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  if (!apiKey) {
    return { success: false, error: 'OpenAI API key is not configured. Set it in Settings > AI Providers.' };
  }

  const url = `${baseUrl || 'https://api.openai.com/v1'}/images/generations`;

  const body: Record<string, unknown> = {
    model,
    prompt,
    n: 1,
    response_format: 'b64_json',
  };

  if (options?.size) {
    body.size = options.size;
  } else {
    body.size = model === 'dall-e-2' ? '512x512' : '1024x1024';
  }

  if (model === 'dall-e-3') {
    body.quality = 'standard';
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      return { success: false, error: `OpenAI image generation failed: ${errorMessage}` };
    }

    const data = await response.json();

    if (!data.data || data.data.length === 0) {
      return { success: false, error: 'No image data returned from OpenAI.' };
    }

    const imageData = data.data[0];
    return {
      success: true,
      imageBase64: imageData.b64_json,
      mimeType: 'image/png',
      revisedPrompt: imageData.revised_prompt,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'OpenAI image generation failed',
    };
  }
}

// ============================================
// Google Gemini Image Generation
// ============================================

async function generateWithGoogle(
  prompt: string,
  apiKey: string,
  model: string,
  _options?: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  if (!apiKey) {
    return { success: false, error: 'Google API key is not configured. Set it in Settings > AI Providers.' };
  }

  const isImagen = model.startsWith('imagen');

  if (isImagen) {
    return generateWithImagen(prompt, apiKey, model);
  }

  return generateWithGeminiNative(prompt, apiKey, model);
}

/**
 * Generate image using Gemini's native multimodal generation (e.g. gemini-2.0-flash)
 */
async function generateWithGeminiNative(
  prompt: string,
  apiKey: string,
  model: string,
): Promise<ImageGenerationResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      return { success: false, error: `Gemini image generation failed: ${errorMessage}` };
    }

    const data = await response.json();
    const candidates = data.candidates;
    if (!candidates || candidates.length === 0) {
      return { success: false, error: 'No response candidates from Gemini.' };
    }

    const parts = candidates[0].content?.parts || [];
    let imageBase64: string | undefined;
    let mimeType: string | undefined;
    let textContent: string | undefined;

    for (const part of parts) {
      if (part.inlineData) {
        imageBase64 = part.inlineData.data;
        mimeType = part.inlineData.mimeType || 'image/png';
      } else if (part.text) {
        textContent = part.text;
      }
    }

    if (!imageBase64) {
      return { success: false, error: textContent || 'No image data in Gemini response.' };
    }

    return {
      success: true,
      imageBase64,
      mimeType,
      revisedPrompt: textContent,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Gemini image generation failed',
    };
  }
}

/**
 * Generate image using Google Imagen API
 */
async function generateWithImagen(
  prompt: string,
  apiKey: string,
  model: string,
): Promise<ImageGenerationResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;

  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
    },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      return { success: false, error: `Imagen generation failed: ${errorMessage}` };
    }

    const data = await response.json();
    const predictions = data.predictions;
    if (!predictions || predictions.length === 0) {
      return { success: false, error: 'No predictions returned from Imagen.' };
    }

    return {
      success: true,
      imageBase64: predictions[0].bytesBase64Encoded,
      mimeType: predictions[0].mimeType || 'image/png',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Imagen generation failed',
    };
  }
}
