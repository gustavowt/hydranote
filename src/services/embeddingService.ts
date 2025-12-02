/**
 * Embedding Service
 * Handles generation of embeddings for text chunks
 */

import type { Chunk, Embedding, EmbeddingConfig } from '../types';
import { loadSettings } from './llmService';

// Default embedding configuration
const DEFAULT_CONFIG: EmbeddingConfig = {
  model: 'text-embedding-3-small',
  dimensions: 1536,
};

let currentConfig: EmbeddingConfig = { ...DEFAULT_CONFIG };

/**
 * Configure the embedding service
 */
export function configureEmbeddingService(config: Partial<EmbeddingConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

/**
 * Get current embedding configuration
 */
export function getEmbeddingConfig(): EmbeddingConfig {
  return { ...currentConfig };
}

/**
 * Get API key from LLM settings if OpenAI is selected
 */
function getOpenAIApiKey(): string | null {
  const settings = loadSettings();
  if (settings.provider === 'openai' && settings.openai.apiKey) {
    return settings.openai.apiKey;
  }
  return null;
}

/**
 * Generate embedding for a single text using OpenAI API
 */
async function generateEmbeddingFromAPI(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: currentConfig.model,
      input: text,
      dimensions: currentConfig.dimensions,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Embedding API error: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Generate a simple local embedding (for development/offline use)
 * This is a basic implementation using character frequency - NOT suitable for production
 */
function generateLocalEmbedding(text: string, dimensions: number = 384): number[] {
  const embedding = new Array(dimensions).fill(0);
  const normalizedText = text.toLowerCase();
  
  // Simple character-based embedding
  for (let i = 0; i < normalizedText.length; i++) {
    const charCode = normalizedText.charCodeAt(i);
    const index = charCode % dimensions;
    embedding[index] += 1;
  }
  
  // Add word-level features
  const words = normalizedText.split(/\s+/);
  for (const word of words) {
    const hash = simpleHash(word) % dimensions;
    embedding[hash] += 0.5;
  }
  
  // Normalize the vector
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= magnitude;
    }
  }
  
  return embedding;
}

/**
 * Simple string hash function
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Generate embedding for text
 * Uses OpenAI API if configured, otherwise falls back to local embedding
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = getOpenAIApiKey();
  if (apiKey) {
    return generateEmbeddingFromAPI(text, apiKey);
  }
  
  // Fallback to local embedding for development/Ollama
  return generateLocalEmbedding(text, currentConfig.dimensions);
}

/**
 * Generate embeddings for multiple chunks
 */
export async function generateEmbeddingsForChunks(chunks: Chunk[]): Promise<Embedding[]> {
  const embeddings: Embedding[] = [];
  
  for (const chunk of chunks) {
    const vector = await generateEmbedding(chunk.text);
    
    embeddings.push({
      id: crypto.randomUUID(),
      chunkId: chunk.id,
      fileId: chunk.fileId,
      projectId: chunk.projectId,
      vector,
      createdAt: new Date(),
    });
  }
  
  return embeddings;
}

/**
 * Batch generate embeddings with rate limiting
 */
export async function generateEmbeddingsBatch(
  chunks: Chunk[],
  batchSize: number = 10,
  delayMs: number = 100
): Promise<Embedding[]> {
  const embeddings: Embedding[] = [];
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchEmbeddings = await generateEmbeddingsForChunks(batch);
    embeddings.push(...batchEmbeddings);
    
    // Add delay between batches to avoid rate limiting
    if (i + batchSize < chunks.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return embeddings;
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }
  
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  
  if (magnitude === 0) return 0;
  
  return dotProduct / magnitude;
}



