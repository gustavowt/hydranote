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

