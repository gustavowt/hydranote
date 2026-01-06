/**
 * Embedding Service
 * Handles generation of embeddings for text chunks
 * Supports multiple providers: OpenAI, Gemini, Ollama
 * Provider configuration is independent from LLM settings
 */

import type { Chunk, Embedding, IndexerSettings } from "../types";
import { DEFAULT_INDEXER_SETTINGS } from "../types";

const INDEXER_STORAGE_KEY = "hydranote_indexer_settings";

// ============================================
// Indexer Settings Management
// ============================================

/**
 * Load indexer settings from localStorage
 */
export function loadIndexerSettings(): IndexerSettings {
  try {
    const stored = localStorage.getItem(INDEXER_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_INDEXER_SETTINGS,
        ...parsed,
        openai: { ...DEFAULT_INDEXER_SETTINGS.openai, ...parsed.openai },
        gemini: { ...DEFAULT_INDEXER_SETTINGS.gemini, ...parsed.gemini },
        ollama: { ...DEFAULT_INDEXER_SETTINGS.ollama, ...parsed.ollama },
      };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_INDEXER_SETTINGS };
}

/**
 * Save indexer settings to localStorage
 */
export function saveIndexerSettings(settings: IndexerSettings): void {
  localStorage.setItem(INDEXER_STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Check if the indexer is properly configured
 */
export function isIndexerConfigured(): boolean {
  const settings = loadIndexerSettings();

  switch (settings.provider) {
    case "openai":
      return !!settings.openai.apiKey;
    case "gemini":
      return !!settings.gemini.apiKey;
    case "ollama":
      return !!settings.ollama.baseUrl && !!settings.ollama.model;
    default:
      return false;
  }
}

/**
 * Get the current indexer provider name for display
 */
export function getIndexerProviderName(): string {
  const settings = loadIndexerSettings();
  switch (settings.provider) {
    case "openai":
      return "OpenAI";
    case "gemini":
      return "Google Gemini";
    case "ollama":
      return `Ollama (${settings.ollama.model})`;
    default:
      return "Unknown";
  }
}

// ============================================
// OpenAI Embedding Provider
// ============================================

/**
 * Generate embedding using OpenAI API
 */
async function generateEmbeddingOpenAI(
  text: string,
  apiKey: string,
  model: string
): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      input: text,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `OpenAI Embedding API error: ${error.error?.message || response.statusText}`
    );
  }

  const data = await response.json();
  return data.data[0].embedding;
}

// ============================================
// Gemini Embedding Provider
// ============================================

/**
 * Generate embedding using Google Gemini API
 */
async function generateEmbeddingGemini(
  text: string,
  apiKey: string,
  model: string
): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: `models/${model}`,
      content: {
        parts: [{ text: text }],
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `Gemini Embedding API error: ${error.error?.message || response.statusText}`
    );
  }

  const data = await response.json();
  return data.embedding.values;
}

// ============================================
// Ollama Embedding Provider
// ============================================

/**
 * Generate embedding using Ollama API
 */
async function generateEmbeddingOllama(
  text: string,
  baseUrl: string,
  model: string
): Promise<number[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/embeddings`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model,
      prompt: text,
    }),
  });

  if (!response.ok) {
    let errorMessage = response.statusText;
    try {
      const error = await response.json();
      errorMessage = error.error || errorMessage;
    } catch {
      // Ignore JSON parse error
    }
    throw new Error(`Ollama Embedding API error: ${errorMessage}`);
  }

  const data = await response.json();
  return data.embedding;
}

// ============================================
// Local Fallback (for unconfigured state)
// ============================================

/**
 * Simple string hash function
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
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
  const magnitude = Math.sqrt(
    embedding.reduce((sum, val) => sum + val * val, 0)
  );
  if (magnitude > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= magnitude;
    }
  }

  return embedding;
}

// ============================================
// Main Embedding Function (Router)
// ============================================

/**
 * Generate embedding for text
 * Routes to the appropriate provider based on IndexerSettings
 * Falls back to local embedding if no provider is configured
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const settings = loadIndexerSettings();

  switch (settings.provider) {
    case "openai":
      if (settings.openai.apiKey) {
        return generateEmbeddingOpenAI(
          text,
          settings.openai.apiKey,
          settings.openai.model
        );
      }
      break;

    case "gemini":
      if (settings.gemini.apiKey) {
        return generateEmbeddingGemini(
          text,
          settings.gemini.apiKey,
          settings.gemini.model
        );
      }
      break;

    case "ollama":
      if (settings.ollama.baseUrl && settings.ollama.model) {
        return generateEmbeddingOllama(
          text,
          settings.ollama.baseUrl,
          settings.ollama.model
        );
      }
      break;
  }

  // Fallback to local embedding if no provider is configured
  console.warn(
    "No indexer provider configured, using local fallback embedding (low quality)"
  );
  return generateLocalEmbedding(text, 384);
}

// ============================================
// Batch Embedding Functions
// ============================================

/**
 * Generate embeddings for multiple chunks
 */
export async function generateEmbeddingsForChunks(
  chunks: Chunk[]
): Promise<Embedding[]> {
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
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return embeddings;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
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

/**
 * Test the indexer connection
 * Returns success status and any error message
 */
export async function testIndexerConnection(): Promise<{
  success: boolean;
  message: string;
  provider: string;
}> {
  const settings = loadIndexerSettings();

  try {
    // Generate a test embedding
    const testText = "This is a test sentence for embedding generation.";
    const embedding = await generateEmbedding(testText);

    if (embedding && embedding.length > 0) {
      return {
        success: true,
        message: `Successfully generated embedding with ${embedding.length} dimensions`,
        provider: getIndexerProviderName(),
      };
    } else {
      return {
        success: false,
        message: "Embedding generation returned empty result",
        provider: getIndexerProviderName(),
      };
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
      provider: getIndexerProviderName(),
    };
  }
}

// ============================================
// Stale Embedding Detection & Re-indexing
// ============================================

/**
 * Compute a simple hash for content comparison
 */
export function computeContentHash(content: string): string {
  // Simple DJB2 hash for content comparison
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 33) ^ content.charCodeAt(i);
  }
  // Convert to unsigned 32-bit and then to hex
  return (hash >>> 0).toString(16);
}

/**
 * Stale file information
 */
export interface StaleFile {
  fileId: string;
  fileName: string;
  projectId: string;
  projectName: string;
  currentHash: string | null;
  expectedHash: string;
}

/**
 * Re-indexing progress callback
 */
export type ReindexProgressCallback = (
  current: number,
  total: number,
  fileName: string
) => void;

/**
 * Detect stale embeddings - files where content_hash doesn't match current content
 * Returns list of files that need re-indexing
 */
export async function detectStaleEmbeddings(
  projectId?: string
): Promise<StaleFile[]> {
  const { getConnection } = await import("./database");
  const conn = getConnection();

  // Get all text-based files with their content and hash
  let query = `
    SELECT 
      f.id as file_id,
      f.name as file_name,
      f.project_id,
      p.name as project_name,
      f.content,
      f.content_hash
    FROM files f
    JOIN projects p ON p.id = f.project_id
    WHERE f.type IN ('md', 'txt')
    AND f.content IS NOT NULL
  `;

  if (projectId) {
    query += ` AND f.project_id = '${projectId}'`;
  }

  const result = await conn.query(query);
  const rows = result.toArray();
  const staleFiles: StaleFile[] = [];

  for (const row of rows) {
    const content = row.content as string;
    const expectedHash = computeContentHash(content);
    const currentHash = row.content_hash as string | null;

    // If no hash stored, or hash doesn't match, file is stale
    if (!currentHash || currentHash !== expectedHash) {
      staleFiles.push({
        fileId: row.file_id as string,
        fileName: row.file_name as string,
        projectId: row.project_id as string,
        projectName: row.project_name as string,
        currentHash,
        expectedHash,
      });
    }
  }

  return staleFiles;
}

/**
 * Re-index all stale files
 * Returns count of files re-indexed
 */
export async function reindexStaleFiles(
  projectId?: string,
  onProgress?: ReindexProgressCallback
): Promise<{ reindexed: number; failed: number; errors: string[] }> {
  const staleFiles = await detectStaleEmbeddings(projectId);
  const { reindexFile } = await import("./projectService");
  const { getConnection, flushDatabase } = await import("./database");
  const conn = getConnection();

  let reindexed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < staleFiles.length; i++) {
    const file = staleFiles[i];

    if (onProgress) {
      onProgress(i + 1, staleFiles.length, file.fileName);
    }

    try {
      // Get file content
      const contentResult = await conn.query(
        `SELECT content FROM files WHERE id = '${file.fileId}'`
      );
      const contentRows = contentResult.toArray();
      if (contentRows.length === 0) continue;

      const content = contentRows[0].content as string;

      // Re-index the file
      await reindexFile(
        file.fileId,
        content,
        file.fileName.endsWith(".md") ? "md" : "txt"
      );

      // Update the content_hash
      const newHash = computeContentHash(content);
      await conn.query(
        `UPDATE files SET content_hash = '${newHash}' WHERE id = '${file.fileId}'`
      );

      reindexed++;
    } catch (error) {
      failed++;
      errors.push(
        `${file.fileName}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  await flushDatabase();

  return { reindexed, failed, errors };
}

/**
 * Re-index all files in the database (full re-index)
 * Useful when switching embedding providers
 */
export async function reindexAllFiles(
  onProgress?: ReindexProgressCallback
): Promise<{ reindexed: number; failed: number; errors: string[] }> {
  const { getConnection, flushDatabase } = await import("./database");
  const { reindexFile } = await import("./projectService");
  const conn = getConnection();

  // Get all text-based files
  const result = await conn.query(`
    SELECT id, name, content
    FROM files
    WHERE type IN ('md', 'txt')
    AND content IS NOT NULL
  `);

  const rows = result.toArray();
  let reindexed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fileId = row.id as string;
    const fileName = row.name as string;
    const content = row.content as string;

    if (onProgress) {
      onProgress(i + 1, rows.length, fileName);
    }

    try {
      // Re-index the file
      await reindexFile(
        fileId,
        content,
        fileName.endsWith(".md") ? "md" : "txt"
      );

      // Update the content_hash
      const newHash = computeContentHash(content);
      await conn.query(
        `UPDATE files SET content_hash = '${newHash}' WHERE id = '${fileId}'`
      );

      reindexed++;
    } catch (error) {
      failed++;
      errors.push(
        `${fileName}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  await flushDatabase();

  return { reindexed, failed, errors };
}
