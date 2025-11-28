/**
 * Core type definitions for DocuSage AI Pipeline
 */

// Supported file types for document ingestion
export type SupportedFileType = 'pdf' | 'txt' | 'docx' | 'md' | 'png' | 'jpg' | 'jpeg' | 'webp';

// Project status
export type ProjectStatus = 'created' | 'indexing' | 'indexed' | 'error';

// File processing status
export type FileStatus = 'pending' | 'processing' | 'indexed' | 'error';

/**
 * Project entity - represents a document collection
 */
export interface Project {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * File entity - represents a document within a project
 */
export interface ProjectFile {
  id: string;
  projectId: string;
  name: string;
  type: SupportedFileType;
  size: number;
  status: FileStatus;
  content?: string; // Raw extracted text
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Chunk entity - represents a segment of a document
 */
export interface Chunk {
  id: string;
  fileId: string;
  projectId: string;
  index: number; // Position within the file
  text: string;
  startOffset: number;
  endOffset: number;
  createdAt: Date;
}

/**
 * Embedding entity - stores vector representation of a chunk
 */
export interface Embedding {
  id: string;
  chunkId: string;
  fileId: string;
  projectId: string;
  vector: number[]; // Embedding vector (typically 384, 768, or 1536 dimensions)
  createdAt: Date;
}

/**
 * Combined chunk with embedding for storage
 */
export interface ChunkWithEmbedding {
  projectId: string;
  fileId: string;
  chunkId: string;
  text: string;
  embeddingVector: number[];
}

/**
 * Search result from vector similarity search
 */
export interface SearchResult {
  chunkId: string;
  fileId: string;
  fileName: string;
  text: string;
  score: number; // Similarity score
}

/**
 * Document ingestion input
 */
export interface DocumentInput {
  file: File;
  projectId: string;
}

/**
 * Chunking configuration
 */
export interface ChunkingConfig {
  maxChunkSize: number; // Maximum characters per chunk
  overlap: number; // Character overlap between chunks
  separator?: string; // Optional separator pattern
}

/**
 * Default chunking configuration
 */
export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  maxChunkSize: 1000,
  overlap: 200,
};

/**
 * Embedding model configuration
 */
export interface EmbeddingConfig {
  model: string;
  dimensions: number;
  apiEndpoint?: string;
}

// ============================================
// Chat Types (Phase 2)
// ============================================

/**
 * Chat message role
 */
export type ChatRole = 'system' | 'user' | 'assistant';

/**
 * Chat message entity
 */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: Date;
  /** Optional context chunks used for this message */
  contextChunks?: SearchResult[];
}

/**
 * Chat session for a project
 */
export interface ChatSession {
  id: string;
  projectId: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Available tools for the LLM
 */
export type ToolName = 'read' | 'search' | 'summarize' | 'write';

/**
 * Tool definition for system prompt
 */
export interface ToolDefinition {
  name: ToolName;
  description: string;
  triggers: string[];
}

/**
 * Context window configuration
 */
export interface ContextWindowConfig {
  maxTokens: number;
  reservedForResponse: number;
  reservedForSystemPrompt: number;
}

/**
 * Default context window configuration (GPT-4 turbo style limits)
 */
export const DEFAULT_CONTEXT_CONFIG: ContextWindowConfig = {
  maxTokens: 128000,
  reservedForResponse: 4096,
  reservedForSystemPrompt: 2000,
};

/**
 * Context chunk with token count
 */
export interface ContextChunk {
  chunk: SearchResult;
  estimatedTokens: number;
}

/**
 * Managed context for a chat turn
 */
export interface ManagedContext {
  systemPrompt: string;
  messages: ChatMessage[];
  relevantChunks: SearchResult[];
  totalTokens: number;
  truncated: boolean;
}

// ============================================
// LLM Settings Types
// ============================================

/**
 * LLM Provider type
 */
export type LLMProvider = 'openai' | 'ollama';

/**
 * OpenAI configuration
 */
export interface OpenAIConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/**
 * Ollama configuration
 */
export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

/**
 * Complete LLM settings
 */
export interface LLMSettings {
  provider: LLMProvider;
  openai: OpenAIConfig;
  ollama: OllamaConfig;
}

/**
 * Default LLM settings
 */
export const DEFAULT_LLM_SETTINGS: LLMSettings = {
  provider: 'openai',
  openai: {
    apiKey: '',
    model: 'gpt-4o-mini',
  },
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2',
  },
};

/**
 * LLM API message format
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM completion request
 */
export interface LLMCompletionRequest {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * LLM completion response
 */
export interface LLMCompletionResponse {
  content: string;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

