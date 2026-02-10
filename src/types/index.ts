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
  /** Original binary data as base64 (for DOCX files only) */
  binaryData?: string;
  /** HTML content (for DOCX files converted via mammoth) */
  htmlContent?: string;
  /** System file path for external file viewing (for PDF files) */
  systemFilePath?: string;
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
// Indexer Settings Types (Embedding Provider)
// ============================================

/**
 * Available embedding providers (separate from LLM providers)
 */
export type EmbeddingProvider = 'openai' | 'gemini' | 'ollama' | 'huggingface_local';

/**
 * OpenAI embedding configuration
 */
export interface OpenAIEmbeddingConfig {
  apiKey: string;
  model: string; // 'text-embedding-3-small' or 'text-embedding-3-large'
}

/**
 * Gemini embedding configuration
 */
export interface GeminiEmbeddingConfig {
  apiKey: string;
  model: string; // 'text-embedding-004'
}

/**
 * Ollama embedding configuration
 */
export interface OllamaEmbeddingConfig {
  baseUrl: string;
  model: string; // user picks: 'nomic-embed-text', 'mxbai-embed-large', etc.
}

/**
 * Hugging Face Local embedding configuration
 * Models are downloaded and run locally via Transformers.js
 */
export interface HuggingFaceLocalEmbeddingConfig {
  model: string; // Hugging Face model ID (e.g., 'Xenova/all-MiniLM-L6-v2')
}

/**
 * Indexer settings - independent from LLM provider
 * Users can mix and match: e.g., Claude for chat + OpenAI for embeddings
 */
export interface IndexerSettings {
  provider: EmbeddingProvider;
  openai: OpenAIEmbeddingConfig;
  gemini: GeminiEmbeddingConfig;
  ollama: OllamaEmbeddingConfig;
  huggingfaceLocal: HuggingFaceLocalEmbeddingConfig;
}

/**
 * Default indexer settings
 */
export const DEFAULT_INDEXER_SETTINGS: IndexerSettings = {
  provider: 'openai',
  openai: {
    apiKey: '',
    model: 'text-embedding-3-small',
  },
  gemini: {
    apiKey: '',
    model: 'text-embedding-004',
  },
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'nomic-embed-text',
  },
  huggingfaceLocal: {
    model: 'Xenova/all-MiniLM-L6-v2',
  },
};

/**
 * Suggested Ollama embedding models for the UI
 */
export const SUGGESTED_OLLAMA_EMBEDDING_MODELS = [
  { name: 'nomic-embed-text', description: 'Best overall performance (768 dimensions)' },
  { name: 'mxbai-embed-large', description: 'High quality, larger model (1024 dimensions)' },
  { name: 'all-minilm', description: 'Fast and lightweight (384 dimensions)' },
  { name: 'snowflake-arctic-embed', description: 'Good for retrieval tasks (1024 dimensions)' },
] as const;

/**
 * OpenAI embedding model options
 */
export const OPENAI_EMBEDDING_MODELS = [
  { name: 'text-embedding-3-small', description: 'Efficient, 1536 dimensions' },
  { name: 'text-embedding-3-large', description: 'Highest quality, 3072 dimensions' },
] as const;

/**
 * Gemini embedding model options
 */
export const GEMINI_EMBEDDING_MODELS = [
  { name: 'text-embedding-004', description: 'Latest model, 768 dimensions' },
] as const;

/**
 * Suggested Hugging Face local embedding models
 * These are ONNX-optimized models that run with Transformers.js
 */
export const SUGGESTED_HF_LOCAL_EMBEDDING_MODELS = [
  { id: 'nomic-ai/nomic-embed-text-v1.5', name: 'Nomic Embed v1.5', description: 'High quality, fast (768 dims, ~137MB)', dimensions: 768 },
  { id: 'Xenova/all-MiniLM-L6-v2', name: 'MiniLM L6 v2', description: 'Fast & compact (384 dims, ~23MB)', dimensions: 384 },
  { id: 'Xenova/bge-small-en-v1.5', name: 'BGE Small EN', description: 'High quality small (384 dims, ~33MB)', dimensions: 384 },
  { id: 'Xenova/gte-small', name: 'GTE Small', description: 'Alibaba GTE small (384 dims, ~33MB)', dimensions: 384 },
  { id: 'Xenova/bge-base-en-v1.5', name: 'BGE Base EN', description: 'Best quality (768 dims, ~109MB)', dimensions: 768 },
] as const;

/**
 * Hugging Face local embedding model status
 */
export type HFEmbeddingModelStatus = 'not_loaded' | 'loading' | 'ready' | 'error';

/**
 * Hugging Face local embedding runtime status
 */
export interface HFEmbeddingRuntimeStatus {
  status: HFEmbeddingModelStatus;
  loadedModel?: string;
  error?: string;
  progress?: number; // 0-100 during loading
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
  /** Tool executions associated with this message (for assistant messages) */
  toolExecutions?: ToolExecutionRecord[];
}

/**
 * Chat session for a project (or global if projectId is undefined)
 */
export interface ChatSession {
  id: string;
  /** Project ID - undefined means global session with access to all projects */
  projectId?: string;
  /** Session title (auto-generated from first message or set manually) */
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Working context for global chat sessions
 * Tracks recently created projects/files within the current conversation
 * so subsequent messages can reference them without explicit specification
 */
export interface WorkingContext {
  /** Currently active project from recent creation */
  projectId?: string;
  /** Name of the active project */
  projectName?: string;
  /** Recently created files in this session */
  recentFiles: Array<{
    fileId: string;
    fileName: string;
    projectId: string;
    projectName: string;
  }>;
}

/**
 * Available tools for the LLM
 */
export type ToolName = 'read' | 'search' | 'summarize' | 'write' | 'updateFile' | 'createProject' | 'moveFile' | 'deleteFile' | 'deleteProject' | 'webResearch';

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
export type LLMProvider = 'openai' | 'ollama' | 'anthropic' | 'google' | 'huggingface_local';

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
 * Anthropic (Claude) configuration
 */
export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

/**
 * Google (Gemini) configuration
 */
export interface GoogleConfig {
  apiKey: string;
  model: string;
}

/**
 * Hugging Face Local model configuration
 */
export interface HuggingFaceLocalConfig {
  /** Local model ID (from registry) */
  modelId: string;
  /** Context window size */
  contextLength?: number;
  /** Number of layers to offload to GPU. -1 = auto (detect optimal based on VRAM), 0 = CPU only */
  gpuLayers?: number;
}

/**
 * Complete LLM settings
 */
export interface LLMSettings {
  provider: LLMProvider;
  openai: OpenAIConfig;
  ollama: OllamaConfig;
  anthropic: AnthropicConfig;
  google: GoogleConfig;
  huggingfaceLocal: HuggingFaceLocalConfig;
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
    model: 'gpt-5-mini',
  },
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2',
  },
  anthropic: {
    apiKey: '',
    model: 'claude-sonnet-4-5',
  },
  google: {
    apiKey: '',
    model: 'gemini-2.5-flash',
  },
  huggingfaceLocal: {
    modelId: '',
    contextLength: 4096,
    gpuLayers: -1, // -1 = auto (let node-llama-cpp detect optimal GPU layers)
  },
  noteSettings: {
    formatInstructions: '',
    projectRotationInstructions: '',
    directoryRotationInstructions: '',
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

/**
 * Callback for streaming LLM responses
 * @param chunk - The text chunk received
 * @param done - Whether the stream is complete
 */
export type LLMStreamCallback = (chunk: string, done: boolean) => void;

/**
 * Streaming completion request options
 */
export interface LLMStreamingRequest extends LLMCompletionRequest {
  onChunk: LLMStreamCallback;
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
  /** Whether this tool made persisting changes (files/projects created, updated, deleted) */
  persistedChanges?: boolean;
  metadata?: {
    fileName?: string;
    fileId?: string;
    projectId?: string;
    projectName?: string;
    fileSize?: number;
    chunkCount?: number;
    truncated?: boolean;
    downloadUrl?: string;
    wasExisting?: boolean; // For createProject upsert - true if project already existed
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
  /** Document title/filename */
  title: string;
  /** Document content (markdown or plain text) */
  content: string;
  /** Optional: Directory path to save the file in (e.g., "docs", "notes/meetings") */
  path?: string;
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
  /** User instructions for project routing decisions (injected into decideTargetProject prompt) */
  projectRotationInstructions: string;
  /** User instructions for directory routing decisions (injected into decideNoteDirectory prompt) */
  directoryRotationInstructions: string;
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
  projectRotationInstructions: '',
  directoryRotationInstructions: '',
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

// ============================================
// UpdateFile Tool Types
// ============================================

/**
 * Document section for structural parsing
 */
export interface DocumentSection {
  /** Section type */
  type: 'heading' | 'paragraph' | 'list' | 'code' | 'blockquote';
  /** Heading level (1-6) for heading type */
  level?: number;
  /** Section title (for headings) */
  title?: string;
  /** Normalized title (lowercase, trimmed) for matching */
  normalizedTitle?: string;
  /** Full content of the section including children */
  content: string;
  /** Start offset in original document */
  startOffset: number;
  /** End offset in original document */
  endOffset: number;
  /** Line number where section starts (1-based) */
  startLine: number;
  /** Line number where section ends (1-based) */
  endLine: number;
  /** Child sections (for nested headings) */
  children?: DocumentSection[];
}

/**
 * Selection context from editor (when user selects text and references it)
 */
export interface SelectionContext {
  /** File path from the selection reference */
  filePath: string;
  /** Start line number (1-based) */
  startLine: number;
  /** End line number (1-based) */
  endLine: number;
  /** The selected text content */
  selectedText: string;
}

/**
 * UpdateFile tool input parameters
 * The tool itself handles analysis and diff generation via chain-of-thought reasoning
 */
export interface UpdateFileToolParams {
  /** File ID to update */
  fileId?: string;
  /** File name to update */
  fileName?: string;
  /** Natural language instruction describing what to change */
  instruction: string;
  /** Optional selection context from editor (@selection: reference) */
  selectionContext?: SelectionContext;
}

/**
 * Diff line for preview
 */
export interface DiffLine {
  /** Line type: added, removed, or unchanged */
  type: 'added' | 'removed' | 'unchanged';
  /** Line content */
  content: string;
  /** Original line number (for removed/unchanged) */
  oldLineNumber?: number;
  /** New line number (for added/unchanged) */
  newLineNumber?: number;
}

/**
 * Preview result for file update
 */
export interface UpdateFilePreview {
  /** Unique preview ID for confirmation */
  previewId: string;
  /** Target file ID */
  fileId: string;
  /** Target file name */
  fileName: string;
  /** File type (md or docx) */
  fileType: 'md' | 'docx';
  /** Chain-of-thought reasoning from the LLM */
  reasoning: string;
  /** Full original file content */
  originalFullContent: string;
  /** Full new file content after update */
  newFullContent: string;
  /** Diff lines for display */
  diffLines: DiffLine[];
  /** Raw unified diff from LLM */
  unifiedDiff: string;
  /** Creation timestamp */
  createdAt: Date;
}

/**
 * Result from applying a file update
 */
export interface UpdateFileResult {
  /** Success indicator */
  success: boolean;
  /** Updated file ID */
  fileId: string;
  /** Updated file name */
  fileName: string;
  /** Error message if failed */
  error?: string;
  /** Whether file was re-indexed */
  reIndexed: boolean;
}

// ============================================
// File Tree Context Menu Types
// ============================================

/**
 * Target type for context menu actions
 */
export type ContextMenuTargetType = 'project' | 'directory' | 'file';

/**
 * Available context menu actions
 */
export type ContextMenuAction = 'new-file' | 'delete-project' | 'delete-directory' | 'delete-file' | 'rename-file' | 'rename-directory' | 'rename-project';

/**
 * Context menu event payload
 */
export interface ContextMenuEvent {
  event: MouseEvent;
  node: FileTreeNode;
}

/**
 * Drag and drop event payload
 */
export interface DragDropEvent {
  sourceNode: FileTreeNode;
  targetNode: FileTreeNode;
}

// ============================================
// Conversation Checkpoint Types (Sequential Messages)
// ============================================

/**
 * Represents the state of a conversation at a checkpoint
 */
export interface ConversationCheckpoint {
  /** Whether there are pending actions awaiting execution */
  hasPendingActions: boolean;
  /** Tools that should be executed based on conversation state */
  toolsToExecute: ToolCall[];
  /** Whether the user has confirmed a pending action */
  userConfirmed: boolean;
  /** Whether the user has rejected/cancelled a pending action */
  userRejected: boolean;
  /** Whether the conversation turn is complete (no more actions needed) */
  turnComplete: boolean;
  /** Reasoning for the decision */
  reasoning: string;
}

/**
 * Represents a pending tool action proposed by the assistant
 */
export interface PendingToolAction {
  /** Unique ID for this pending action */
  id: string;
  /** The tool call to execute */
  toolCall: ToolCall;
  /** Project ID where the tool will execute */
  projectId: string;
  /** Session ID for the chat session */
  sessionId: string;
  /** Description shown to user */
  description: string;
  /** Content preview (e.g., file content for write tool) */
  contentPreview?: string;
  /** Original user message that initiated this action */
  originalUserMessage: string;
  /** Creation timestamp */
  createdAt: Date;
  /** Expiration timestamp (pending actions expire after some time) */
  expiresAt: Date;
}

/**
 * Constants for pending actions
 */
export const PENDING_ACTION_CONFIG = {
  /** How long pending actions remain valid (in milliseconds) - 10 minutes */
  expirationMs: 10 * 60 * 1000,
} as const;

// ============================================
// File System Sync Types
// ============================================

/**
 * Sync status for a file
 */
export type FileSyncStatus = 'synced' | 'pending' | 'conflict' | 'error';

/**
 * Sync direction
 */
export type SyncDirection = 'to_filesystem' | 'from_filesystem' | 'bidirectional';

/**
 * File system settings for directory sync
 */
export interface FileSystemSettings {
  /** Whether file system sync is enabled */
  enabled: boolean;
  /** Root directory path on the file system */
  rootPath: string;
  /** Sync on every save operation */
  syncOnSave: boolean;
  /** Watch for external file changes */
  watchForChanges: boolean;
  /** Polling interval for file watching (in milliseconds) */
  watchInterval: number;
  /** Last successful sync timestamp */
  lastSyncTime?: string;
}

/**
 * Default file system settings
 */
export const DEFAULT_FILESYSTEM_SETTINGS: FileSystemSettings = {
  enabled: false,
  rootPath: '',
  syncOnSave: true,
  watchForChanges: true,
  watchInterval: 5000,
};

/**
 * Represents a file on the file system for sync comparison
 */
export interface FileSystemEntry {
  /** Relative path from project root */
  relativePath: string;
  /** File name */
  name: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** File size in bytes (for files only) */
  size?: number;
  /** Last modified timestamp */
  modifiedTime: Date;
  /** File content (for files only, loaded on demand) */
  content?: string;
}

/**
 * Sync conflict information
 */
export interface SyncConflict {
  /** File ID in database */
  fileId: string;
  /** File path */
  filePath: string;
  /** Project ID */
  projectId: string;
  /** Database version modified time */
  dbModifiedTime: Date;
  /** File system version modified time */
  fsModifiedTime: Date;
  /** Database content */
  dbContent: string;
  /** File system content */
  fsContent: string;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /** Whether sync was successful */
  success: boolean;
  /** Number of files synced to file system */
  filesWritten: number;
  /** Number of files read from file system */
  filesRead: number;
  /** Number of files deleted */
  filesDeleted: number;
  /** Number of conflicts detected */
  conflictsDetected: number;
  /** List of conflicts (if any) */
  conflicts: SyncConflict[];
  /** Error message if sync failed */
  error?: string;
  /** Timestamp of sync */
  syncTime: Date;
}

/**
 * Change detected during sync
 */
export interface SyncChange {
  /** Type of change */
  type: 'created' | 'modified' | 'deleted';
  /** Direction of change */
  direction: 'db_to_fs' | 'fs_to_db';
  /** File path */
  filePath: string;
  /** Project ID */
  projectId: string;
  /** File ID (if exists in DB) */
  fileId?: string;
}

// ============================================
// Web Research Tool Types
// ============================================

/**
 * Web search provider options
 */
export type WebSearchProvider = 'searxng' | 'brave' | 'duckduckgo';

/**
 * Web search settings
 */
export interface WebSearchSettings {
  /** Search provider */
  provider: WebSearchProvider;
  /** SearXNG instance URL (required for searxng provider) */
  searxngUrl?: string;
  /** Brave Search API key (required for brave provider) */
  braveApiKey?: string;
  /** Cache max age in minutes (default: 60) */
  cacheMaxAge: number;
  /** Maximum results to fetch per search (default: 5) */
  maxResults: number;
}

/**
 * Default web search settings
 */
export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
  provider: 'searxng',
  searxngUrl: '',
  braveApiKey: '',
  cacheMaxAge: 60,
  maxResults: 5,
};

/**
 * Search result from web search API
 */
export interface WebSearchApiResult {
  /** Page title */
  title: string;
  /** Page URL */
  url: string;
  /** Snippet/description from search results */
  snippet: string;
}

/**
 * Fetched web page content
 */
export interface WebPageContent {
  /** Source URL */
  url: string;
  /** Page title */
  title: string;
  /** Extracted text content */
  content: string;
  /** When the page was fetched */
  fetchedAt: Date;
  /** Content length in characters */
  contentLength: number;
}

/**
 * Cached web search entry (stored in DuckDB)
 */
export interface WebSearchCacheEntry {
  /** Unique cache entry ID */
  id: string;
  /** Hash of the search query for lookup */
  queryHash: string;
  /** Original search query */
  query: string;
  /** Source URL */
  url: string;
  /** Page title */
  title: string;
  /** Raw extracted content */
  rawContent: string;
  /** When the page was fetched */
  fetchedAt: Date;
  /** When the cache entry was created */
  createdAt: Date;
}

/**
 * Web content chunk with embedding
 */
export interface WebChunk {
  /** Chunk ID */
  id: string;
  /** Reference to cache entry */
  cacheId: string;
  /** Source URL */
  url: string;
  /** Page title */
  title: string;
  /** Chunk text */
  text: string;
  /** Chunk index within the page */
  chunkIndex: number;
  /** Embedding vector */
  embedding: number[];
  /** Similarity score (populated after vector search) */
  score?: number;
}

/**
 * Web research tool parameters
 */
export interface WebResearchToolParams {
  /** Search query */
  query: string;
  /** Maximum number of URLs to fetch (default: 5) */
  maxResults?: number;
  /** Maximum chunks to return after filtering (default: 10) */
  maxChunks?: number;
  /** Callback for progress updates */
  onProgress?: WebResearchProgressCallback;
}

/**
 * Web research options
 */
/**
 * Progress callback for web research status updates
 */
export type WebResearchProgressCallback = (status: string) => void;

export interface WebResearchOptions {
  /** Maximum URLs to fetch (default: 5) */
  maxResults?: number;
  /** Maximum chunks to return (default: 10) */
  maxChunks?: number;
  /** Whether to use cache (default: true) */
  useCache?: boolean;
  /** Override default cache age in minutes */
  cacheMaxAge?: number;
  /** Callback for progress updates */
  onProgress?: WebResearchProgressCallback;
}

/**
 * Web research result
 */
export interface WebResearchResult {
  /** Original search query */
  query: string;
  /** Sources that were searched */
  sources: Array<{ url: string; title: string }>;
  /** Relevant content chunks after vector filtering */
  relevantContent: WebChunk[];
  /** Whether results came from cache */
  fromCache: boolean;
  /** Total search time in milliseconds */
  searchTime: number;
  /** Error message if search failed */
  error?: string;
}

// ============================================
// File Version History Types
// ============================================

/**
 * Source that triggered version creation
 */
export type VersionSource = 'create' | 'update' | 'format' | 'restore';

/**
 * File version entity - represents a version snapshot or diff
 */
export interface FileVersion {
  /** Unique version ID */
  id: string;
  /** Reference to the file */
  fileId: string;
  /** Sequential version number (1-based) */
  versionNumber: number;
  /** Whether this stores full content (true) or a patch (false) */
  isFullContent: boolean;
  /** Full content or JSON-encoded patch */
  contentOrPatch: string;
  /** What triggered this version */
  source: VersionSource;
  /** When this version was created */
  createdAt: Date;
}

/**
 * Version metadata (without content/patch for listing)
 */
export interface FileVersionMeta {
  /** Unique version ID */
  id: string;
  /** Reference to the file */
  fileId: string;
  /** Sequential version number */
  versionNumber: number;
  /** What triggered this version */
  source: VersionSource;
  /** When this version was created */
  createdAt: Date;
}

/**
 * Configuration for version history
 */
export const VERSION_HISTORY_CONFIG = {
  /** Maximum versions to keep per file */
  maxVersions: 10,
} as const;

// ============================================
// Execution Plan Types (Planner-Executor-Checker Flow)
// ============================================

/**
 * Status of a plan step during execution
 */
export type PlanStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * A single step in an execution plan
 */
export interface PlanStep {
  /** Unique step identifier */
  id: string;
  /** Tool to execute */
  tool: ToolName;
  /** Tool parameters */
  params: Record<string, string>;
  /** Human-readable description of what this step does */
  description: string;
  /** IDs of steps that must complete before this one */
  dependsOn?: string[];
  /** Context keys this step needs from previous steps */
  contextNeeded?: string[];
  /** Context keys this step will provide to subsequent steps */
  providesContext?: string[];
  /** Current status during execution */
  status?: PlanStepStatus;
  /** Detailed status message (e.g., progress info) */
  detail?: string;
  /** Error message if step failed */
  error?: string;
  /** Whether this step made persisting changes (set after execution) */
  persistedChanges?: boolean;
}

/**
 * Execution plan created by the Planner
 */
export interface ExecutionPlan {
  /** Unique plan identifier */
  id: string;
  /** Human-readable summary of the plan */
  summary: string;
  /** Ordered sequence of steps to execute */
  steps: PlanStep[];
  /** Whether clarification is needed from user */
  needsClarification: boolean;
  /** Question to ask user if clarification needed */
  clarificationQuestion?: string;
  /** Estimated duration (e.g., "~30 seconds") */
  estimatedDuration?: string;
  /** Original user message that triggered this plan */
  originalQuery: string;
  /** Timestamp when plan was created */
  createdAt: Date;
  /** Plan complexity level - determines auto-execute behavior */
  complexity: 'low' | 'high';
  /** Reasoning for the complexity assessment */
  complexityReason?: string;
}

/**
 * Result of a completed step
 */
export interface CompletedStep {
  /** Step ID */
  stepId: string;
  /** Tool that was executed */
  tool: ToolName;
  /** Tool result */
  result: ToolResult;
  /** Context extracted from this step for subsequent steps */
  extractedContext: Record<string, unknown>;
  /** Execution duration in milliseconds */
  durationMs: number;
}

/**
 * Result of a failed step
 */
export interface FailedStep {
  /** Step ID */
  stepId: string;
  /** Tool that failed */
  tool: ToolName;
  /** Error message */
  error: string;
  /** Whether execution should continue despite this failure */
  recoverable: boolean;
}

/**
 * Result from the Executor after running a plan
 */
export interface ExecutionResult {
  /** Plan ID that was executed */
  planId: string;
  /** Successfully completed steps */
  completedSteps: CompletedStep[];
  /** Failed steps */
  failedSteps: FailedStep[];
  /** Accumulated context from all steps */
  accumulatedContext: Record<string, unknown>;
  /** Final response to show user */
  finalResponse: string;
  /** Total execution time in milliseconds */
  totalDurationMs: number;
  /** Whether all steps completed successfully */
  allSuccessful: boolean;
}

/**
 * Result from the Continuation Checker
 */
export interface CompletionCheck {
  /** Whether all requested tasks are complete */
  isComplete: boolean;
  /** List of completed task descriptions */
  completedTasks: string[];
  /** List of missing/incomplete task descriptions */
  missingTasks: string[];
  /** Whether the planner should re-plan */
  shouldReplan: boolean;
  /** Context to pass to planner if re-planning */
  replanContext?: string;
  /** Reasoning for the decision */
  reasoning: string;
}

/**
 * Callback for plan step updates during execution
 */
export type PlanStepCallback = (step: PlanStep, index: number, total: number) => void;

/**
 * Callback for step result (called after each step completes with result data)
 */
export type PlanStepResultCallback = (stepId: string, tool: ToolName, resultData: string | undefined) => void;

/**
 * Options for plan execution
 */
export interface ExecutePlanOptions {
  /** Callback for step status updates */
  onStepUpdate?: PlanStepCallback;
  /** Callback for step result data (called after each step completes) */
  onStepResult?: PlanStepResultCallback;
  /** Callback for streaming content (for tools that stream) */
  onStreamChunk?: LLMStreamCallback;
  /** Whether to stop on first failure */
  stopOnFailure?: boolean;
  /** Maximum re-plan attempts */
  maxReplanAttempts?: number;
  /** Callback for tool child progress updates (e.g., web research page fetches) */
  onToolChildUpdate?: (stepId: string, child: ToolExecutionChild) => void;
}

/**
 * State of the entire Planner-Executor-Checker flow
 */
export interface PlannerFlowState {
  /** Current phase of the flow */
  phase: 'planning' | 'awaiting_confirmation' | 'executing' | 'checking' | 'replanning' | 'complete' | 'cancelled';
  /** Current execution plan (if created) */
  plan?: ExecutionPlan;
  /** Execution result (if executed) */
  executionResult?: ExecutionResult;
  /** Completion check result (if checked) */
  completionCheck?: CompletionCheck;
  /** Number of re-plan attempts */
  replanAttempts: number;
  /** Error if flow failed */
  error?: string;
}

// ============================================
// Tool Execution Log Types (for Chat UX)
// ============================================

/**
 * Status of a tool log entry
 */
export type ToolLogStatus = 'running' | 'completed' | 'failed';

/**
 * A single tool execution log entry
 */
export interface ToolLogEntry {
  /** Unique log entry ID */
  id: string;
  /** Tool that was executed */
  tool: ToolName;
  /** Human-readable description */
  description: string;
  /** Current status */
  status: ToolLogStatus;
  /** Brief result preview (for completed tools) */
  resultPreview?: string;
  /** Full result data (for expanding) */
  resultData?: string;
  /** Error message (for failed tools) */
  error?: string;
  /** Timestamp when tool started */
  startTime: Date;
  /** Timestamp when tool completed */
  endTime?: Date;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Child execution steps (for nested tools like webResearch) */
  children?: ToolExecutionChild[];
}

/**
 * Child execution step for nested tools (e.g., web research page fetches)
 */
export interface ToolExecutionChild {
  /** Unique child ID */
  id: string;
  /** Display label (e.g., "vuejs.org/guide" or "Processing results") */
  label: string;
  /** Current status */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** Timestamp */
  timestamp: Date;
}

/**
 * Tool execution record for persistence in chat history
 */
export interface ToolExecutionRecord {
  /** Unique record ID */
  id: string;
  /** Tool that was executed */
  tool: ToolName;
  /** Compact description for display */
  description: string;
  /** Final status */
  status: ToolLogStatus;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Brief result preview */
  resultPreview?: string;
  /** Full result data (for expansion) */
  resultData?: string;
  /** Error message if failed */
  error?: string;
  /** Execution timestamp */
  timestamp: Date;
  /** Child steps for nested tools */
  children?: ToolExecutionChild[];
}

/**
 * Enhanced planner flow result with tool logs
 */
export interface EnhancedPlannerFlowResult {
  /** Final state of the flow */
  state: PlannerFlowState;
  /** Final response to show user */
  response: string;
  /** All tool results from execution */
  toolResults: ToolResult[];
  /** Tool execution logs for UI display */
  toolLogs: ToolLogEntry[];
  /** Raw tool outputs (formatted for display) */
  formattedToolOutputs: string[];
  /** Whether the flow completed successfully */
  success: boolean;
}

// ============================================
// Local Model Types (Hugging Face)
// ============================================

/**
 * Model installation state
 */
export type ModelInstallState = 'not_installed' | 'downloading' | 'installed' | 'failed' | 'paused';

/**
 * Hugging Face model file reference
 */
export interface HFModelFile {
  /** File name (e.g., "llama-2-7b.Q4_K_M.gguf") */
  filename: string;
  /** SHA256 checksum for verification */
  sha256?: string;
  /** File size in bytes */
  size: number;
  /** Whether this is the primary model file */
  isPrimary?: boolean;
}

/**
 * Hugging Face model reference (from catalog)
 */
export interface HFModelRef {
  /** Hugging Face repository ID (e.g., "TheBloke/Llama-2-7B-GGUF") */
  id: string;
  /** Display name */
  name: string;
  /** Model description */
  description: string;
  /** Total size in bytes (all files) */
  size: number;
  /** List of model files */
  files: HFModelFile[];
  /** Quantization type (e.g., "Q4_K_M", "Q5_K_S") */
  quantization?: string;
  /** Maximum context length */
  contextLength?: number;
  /** Model architecture (e.g., "llama", "mistral") */
  architecture?: string;
  /** Whether model requires authentication */
  gated?: boolean;
  /** Recommended GPU layers */
  recommendedGpuLayers?: number;
  /** User-friendly description of what the model is best for */
  bestFor?: string;
  /** Resource requirements info (RAM, GPU, etc.) */
  resourceInfo?: string;
}

/**
 * Local model file (downloaded)
 */
export interface LocalModelFile {
  /** File name */
  filename: string;
  /** Full path on disk */
  path: string;
  /** File size in bytes */
  size: number;
  /** SHA256 checksum (verified) */
  sha256?: string;
  /** Download state */
  downloaded: boolean;
}

/**
 * Local model registry entry
 */
export interface LocalModel {
  /** Local model ID (UUID) */
  id: string;
  /** Hugging Face repository ID */
  huggingFaceId: string;
  /** Display name */
  name: string;
  /** Model version/revision */
  version: string;
  /** List of downloaded files */
  files: LocalModelFile[];
  /** Current installation state */
  state: ModelInstallState;
  /** When model was installed */
  installedAt?: Date;
  /** When model was last used */
  lastUsed?: Date;
  /** Total size in bytes */
  totalSize: number;
  /** Downloaded size in bytes */
  downloadedSize: number;
  /** Path to primary model file */
  primaryModelPath?: string;
  /** Model architecture */
  architecture?: string;
  /** Maximum context length */
  contextLength?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Model download progress event
 */
export interface ModelDownloadProgress {
  /** Model ID */
  modelId: string;
  /** Current file being downloaded */
  currentFile: string;
  /** Bytes downloaded for current file */
  fileDownloaded: number;
  /** Total bytes for current file */
  fileTotal: number;
  /** Total bytes downloaded across all files */
  totalDownloaded: number;
  /** Total bytes to download */
  totalSize: number;
  /** Download speed in bytes per second */
  speed: number;
  /** Estimated time remaining in seconds */
  eta?: number;
  /** Current status message */
  status: string;
}

/**
 * Inference runtime status
 */
export interface RuntimeStatus {
  /** Whether runtime is active */
  running: boolean;
  /** Currently loaded model ID */
  loadedModelId?: string;
  /** Loaded model name */
  loadedModelName?: string;
  /** Memory usage in bytes */
  memoryUsage?: number;
  /** GPU memory usage in bytes */
  gpuMemoryUsage?: number;
  /** Whether model is ready for inference */
  ready: boolean;
  /** Error message if runtime failed */
  error?: string;
}

/**
 * Hardware acceleration info for local models (CUDA, Metal, Vulkan, CPU)
 */
export interface HardwareInfo {
  /** Detected backend being used */
  backend: 'cuda' | 'metal' | 'vulkan' | 'cpu' | 'unknown';
  /** List of supported backends on this system */
  supportedBackends: string[];
  /** Device name (e.g., GPU name) if available */
  deviceName?: string;
}

/**
 * Model inference options
 */
export interface LocalInferenceOptions {
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature for sampling */
  temperature?: number;
  /** Top-p nucleus sampling */
  topP?: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** Stream output */
  stream?: boolean;
}

/**
 * Local model settings
 */
export interface LocalModelSettings {
  /** Models storage directory (defaults to userData/models) */
  modelsDirectory?: string;
  /** Default GPU layers to use. -1 = auto (detect optimal based on VRAM), 0 = CPU only */
  defaultGpuLayers: number;
  /** Default context length */
  defaultContextLength: number;
  /** Hugging Face API token for gated models */
  huggingFaceToken?: string;
  /** Auto-load last used model on startup */
  autoLoadLastModel: boolean;
}

/**
 * Default local model settings
 */
export const DEFAULT_LOCAL_MODEL_SETTINGS: LocalModelSettings = {
  defaultGpuLayers: -1, // -1 = auto (let node-llama-cpp detect optimal GPU layers based on VRAM)
  defaultContextLength: 4096,
  autoLoadLastModel: false,
};

/**
 * Suggested local models for the catalog
 */
export const SUGGESTED_LOCAL_MODELS: Partial<HFModelRef>[] = [
  {
    id: 'TheBloke/Llama-2-7B-Chat-GGUF',
    name: 'Llama 2 7B Chat',
    description: 'Meta Llama 2 7B parameter chat model, quantized for efficient inference',
    architecture: 'llama',
    contextLength: 4096,
  },
  {
    id: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF',
    name: 'Mistral 7B Instruct v0.2',
    description: 'Mistral AI instruction-tuned model with 32k context window',
    architecture: 'mistral',
    contextLength: 32768,
  },
  {
    id: 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF',
    name: 'TinyLlama 1.1B Chat',
    description: 'Compact 1.1B parameter model, great for testing and low-resource systems',
    architecture: 'llama',
    contextLength: 2048,
  },
  {
    id: 'TheBloke/Phi-2-GGUF',
    name: 'Phi-2 2.7B',
    description: 'Microsoft Phi-2 small language model with strong reasoning capabilities',
    architecture: 'phi',
    contextLength: 2048,
  },
];
