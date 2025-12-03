/**
 * Core type definitions for HydraNote AI Pipeline
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
export type ToolName = 'read' | 'search' | 'summarize' | 'write' | 'addNote';

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
  /** Note formatting settings (Phase 9) */
  noteSettings: NoteSettings;
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
  noteSettings: {
    formatInstructions: '',
    defaultDirectory: 'notes',
    autoGenerateTitle: true,
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

// ============================================
// Tool Types (Phase 3+)
// ============================================

/**
 * Tool call parsed from LLM response
 */
export interface ToolCall {
  tool: ToolName;
  params: Record<string, string>;
}

/**
 * Result from executing a tool
 */
export interface ToolResult {
  success: boolean;
  tool: ToolName;
  data?: string;
  error?: string;
  metadata?: {
    fileName?: string;
    fileId?: string;
    fileSize?: number;
    chunkCount?: number;
    truncated?: boolean;
    downloadUrl?: string;
  };
}

/**
 * Read tool specific parameters
 */
export interface ReadToolParams {
  fileId?: string;
  fileName?: string;
  maxChunks?: number;
}

/**
 * Search tool specific parameters
 */
export interface SearchToolParams {
  query: string;
  maxResults?: number;
}

/**
 * Summarize tool specific parameters
 */
export interface SummarizeToolParams {
  fileId?: string;
  fileName?: string;
  /** Maximum tokens for direct summarization before switching to hierarchical */
  maxDirectTokens?: number;
}

/**
 * Configuration for progressive file reading
 */
export interface ProgressiveReadConfig {
  maxCharacters: number;
  summarizeIfLarge: boolean;
}

export const DEFAULT_PROGRESSIVE_READ_CONFIG: ProgressiveReadConfig = {
  maxCharacters: 50000,
  summarizeIfLarge: true,
};

// ============================================
// Write Tool Types (Phase 6 + Phase 8)
// ============================================

/**
 * Supported output formats for document generation
 */
export type DocumentFormat = 'pdf' | 'docx' | 'md';

/**
 * File type for write operations (Phase 8)
 */
export type WriteFileType = 'pdf' | 'docx' | 'markdown';

/**
 * Markdown file constants (Phase 8)
 */
export const MARKDOWN_FILE_CONFIG = {
  extension: '.md',
  mimeType: 'text/markdown',
  encoding: 'utf-8',
} as const;

/**
 * Write tool specific parameters
 */
export interface WriteToolParams {
  /** Output format: pdf, docx, or md */
  format: DocumentFormat;
  /** Document title */
  title: string;
  /** Document content (markdown or plain text) */
  content: string;
  /** Optional: Use project context to enrich content */
  useContext?: boolean;
  /** Optional: File type hint (Phase 8) - defaults to format */
  fileType?: WriteFileType;
}

/**
 * Generated document result
 */
export interface GeneratedDocument {
  /** Generated file ID */
  fileId: string;
  /** File name */
  fileName: string;
  /** Document format */
  format: DocumentFormat;
  /** File size in bytes */
  size: number;
  /** Blob URL for download */
  downloadUrl: string;
  /** Creation timestamp */
  createdAt: Date;
}

// ============================================
// Note Settings Types (Phase 9)
// ============================================

/**
 * Note formatting settings for the AddNote pipeline
 */
export interface NoteSettings {
  /** User instructions for note formatting (injected into FormatNote prompt) */
  formatInstructions: string;
  /** Default note directory within projects */
  defaultDirectory: string;
  /** Whether to auto-generate note titles */
  autoGenerateTitle: boolean;
}

/**
 * Default note settings
 */
export const DEFAULT_NOTE_SETTINGS: NoteSettings = {
  formatInstructions: '',
  defaultDirectory: 'notes',
  autoGenerateTitle: true,
};

/**
 * AddNote tool input parameters
 */
export interface AddNoteParams {
  /** The project to add the note to */
  projectId: string;
  /** Raw note text to be formatted and saved */
  rawNoteText: string;
  /** Optional context metadata */
  contextMetadata?: NoteContextMetadata;
}

/**
 * Optional metadata for note context
 */
export interface NoteContextMetadata {
  /** Tags associated with the note */
  tags?: string[];
  /** Topic or category */
  topic?: string;
  /** Source of the note (e.g., meeting, research) */
  source?: string;
  /** Language preference */
  language?: string;
}

/**
 * Result from AddNote pipeline
 */
export interface AddNoteResult {
  /** Success indicator */
  success: boolean;
  /** Final file path */
  filePath: string;
  /** Generated note title */
  title: string;
  /** Directory where note was saved */
  directory: string;
  /** File ID in database */
  fileId: string;
  /** Creation timestamp */
  createdAt: Date;
  /** Error message if failed */
  error?: string;
}

/**
 * Directory decision result from AI
 */
export interface DirectoryDecision {
  /** Target directory path */
  targetDirectory: string;
  /** Whether a new directory should be created */
  shouldCreateDirectory: boolean;
}

// ============================================
// Phase 11: File Tree & @ References Types
// ============================================

/**
 * Represents a file node in the file tree
 */
export interface FileTreeNode {
  /** Unique identifier (file ID for files, path for directories) */
  id: string;
  /** Display name */
  name: string;
  /** Full path relative to project root */
  path: string;
  /** Node type */
  type: 'file' | 'directory';
  /** File type (only for files) */
  fileType?: SupportedFileType;
  /** File size in bytes (only for files) */
  size?: number;
  /** File status (only for files) */
  status?: FileStatus;
  /** Children nodes (only for directories) */
  children?: FileTreeNode[];
  /** Whether directory is expanded (UI state) */
  expanded?: boolean;
}

/**
 * File tree for a project
 */
export interface ProjectFileTree {
  /** Project ID */
  projectId: string;
  /** Root nodes of the tree */
  nodes: FileTreeNode[];
  /** Total file count */
  totalFiles: number;
  /** Total directory count */
  totalDirectories: number;
}

/**
 * File reference parsed from @file:... syntax
 */
export interface FileReference {
  /** Original matched text (e.g., "@file:notes/meeting.md") */
  original: string;
  /** File path or name */
  filePath: string;
  /** Start position in text */
  startIndex: number;
  /** End position in text */
  endIndex: number;
}

/**
 * File reference syntax constants
 */
export const FILE_REFERENCE_SYNTAX = {
  /** Prefix for file references */
  prefix: '@file:',
  /** Regex pattern to match file references */
  pattern: /@file:([^\s]+)/g,
} as const;

// ============================================
// Phase 12: Telemetry & Metrics Types
// ============================================

/**
 * Telemetry event types
 */
export type TelemetryEventType =
  | 'note_created'
  | 'project_created'
  | 'directory_created'
  | 'note_creation_failed';

/**
 * Note creation source
 */
export type NoteCreationSource = 'dashboard' | 'project_chat';

/**
 * Base telemetry event
 */
export interface TelemetryEvent {
  /** Event type */
  type: TelemetryEventType;
  /** Timestamp */
  timestamp: Date;
  /** Event-specific data */
  data: Record<string, unknown>;
}

/**
 * Note created event data
 */
export interface NoteCreatedEventData {
  /** Source of note creation */
  source: NoteCreationSource;
  /** Project ID where note was saved */
  projectId: string;
  /** Whether project was auto-selected or manually specified */
  autoSelected: boolean;
  /** File path of the created note */
  filePath: string;
}

/**
 * Project created event data
 */
export interface ProjectCreatedEventData {
  /** Project ID */
  projectId: string;
  /** Whether project was created automatically (via AI routing) */
  automatic: boolean;
  /** Reason for creation */
  reason: 'user_initiated' | 'ai_suggested';
}

/**
 * Directory created event data
 */
export interface DirectoryCreatedEventData {
  /** Project ID */
  projectId: string;
  /** Directory path */
  directoryPath: string;
  /** Note title that triggered directory creation */
  triggeringNoteTitle: string;
  /** AI reasoning for creating new directory */
  reasoning?: string;
}

/**
 * Telemetry metrics summary
 */
export interface TelemetryMetrics {
  /** Total notes created */
  notesCreated: number;
  /** Notes created from dashboard */
  notesFromDashboard: number;
  /** Notes created from project chat */
  notesFromProjectChat: number;
  /** Projects created automatically */
  projectsAutoCreated: number;
  /** Projects created by user */
  projectsUserCreated: number;
  /** Directories created by AI */
  directoriesCreated: number;
}

// ============================================
// Phase 12: Project Router Decision Extended
// ============================================

/**
 * Extended project router decision with confirmation flag
 */
export interface ProjectRouterDecision {
  /** Action to take */
  action: 'use_existing' | 'create_project';
  /** Target project ID (only if action is 'use_existing') */
  targetProjectId?: string;
  /** Proposed project name (only if action is 'create_project') */
  proposedProjectName?: string;
  /** Proposed project description (only if action is 'create_project') */
  proposedProjectDescription?: string;
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low';
  /** AI reasoning */
  reasoning?: string;
  /** Whether user confirmation is required (for create_project) */
  requiresConfirmation?: boolean;
}

/**
 * Summary of a project for routing decisions
 */
export interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
}

/**
 * Global add note parameters (from dashboard)
 */
export interface GlobalAddNoteParams {
  /** Raw note text */
  rawNoteText: string;
  /** Optional tags */
  tags?: string[];
  /** Skip confirmation for new projects (user already confirmed) */
  skipProjectConfirmation?: boolean;
  /** Pre-selected project ID (if user confirmed a suggestion) */
  confirmedProjectId?: string;
  /** Pre-confirmed new project details */
  confirmedNewProject?: {
    name: string;
    description?: string;
  };
}

/**
 * Global add note result
 */
export interface GlobalAddNoteResult {
  /** Success indicator */
  success: boolean;
  /** Project ID where note was saved */
  projectId: string;
  /** Project name */
  projectName: string;
  /** Whether a new project was created */
  newProjectCreated: boolean;
  /** Final file path */
  filePath: string;
  /** Generated note title */
  title: string;
  /** File ID in database */
  fileId: string;
  /** Error message if failed */
  error?: string;
  /** Pending confirmation for new project (if needed) */
  pendingConfirmation?: {
    proposedProjectName: string;
    proposedProjectDescription?: string;
    reasoning?: string;
  };
}
