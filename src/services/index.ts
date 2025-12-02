/**
 * Services Index
 * Central export point for all services
 */

// Database
export { initializeDatabase, getConnection, flushDatabase } from './database';

// Project Service
export {
  initialize,
  createProject,
  getProject,
  getAllProjects,
  ingestDocument,
  get_project_files,
  get_file_chunks,
  get_embeddings,
  vector_search,
  searchProject,
  getFile,
  getFileWithChunks,
  getProjectStats,
} from './projectService';

// Chat Service
export {
  buildSystemPrompt,
  estimateTokens,
  manageContext,
  formatContextForPrompt,
  createChatSession,
  getChatSession,
  getOrCreateSession,
  addMessage,
  getMessages,
  clearSession,
  deleteSession,
  prepareChatRequest,
  recordAssistantResponse,
} from './chatService';

// LLM Service
export {
  loadSettings,
  saveSettings,
  isConfigured,
  chatCompletion,
  prompt,
  chat,
  testConnection,
  getOllamaModels,
  loadNoteSettings,
  saveNoteSettings,
  getNoteFormatInstructions,
  getDefaultNoteDirectory,
} from './llmService';

// Tool Service
export {
  routeMessage,
  executeReadTool,
  executeSearchTool,
  executeSummarizeTool,
  executeWriteTool,
  executeAddNoteTool,
  executeTool,
  executeToolCalls,
  formatToolResults,
  orchestrateToolExecution,
} from './toolService';

// Export types from toolService
export type { ExecutionStep, ExecutionLogCallback, RoutingResult, OrchestratedResult } from './toolService';

// Document Generator Service
export {
  generatePDF,
  generateDOCX,
  generateMarkdown,
  generateDocument,
  getGeneratedDocument,
  downloadGeneratedDocument,
  storeGeneratedDocument,
  downloadDocument,
  downloadBlob,
} from './documentGeneratorService';

// Document Processor
export {
  detectFileType,
  extractText,
  chunkText,
  chunkMarkdownText,
  processDocument,
  isFileTypeSupported,
  getSupportedExtensions,
} from './documentProcessor';

// Embedding Service
export {
  generateEmbedding,
  generateEmbeddingsForChunks,
} from './embeddingService';

// Note Service (Phase 9 + Phase 10)
export {
  formatNote,
  generateNoteTitle,
  titleToSlug,
  generateUniqueFileName,
  getProjectDirectories,
  decideNoteDirectory,
  persistNote,
  indexNote,
  addNote,
  addNoteWithTitle,
  // Phase 10: Global note routing
  decideTargetProject,
  globalAddNote,
} from './noteService';

// Export types from noteService
export type { NoteExecutionStep, NoteExecutionCallback } from './noteService';
