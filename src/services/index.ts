/**
 * Services barrel export
 */

// Database
export {
  initializeDatabase,
  getConnection,
  getDatabase,
  closeDatabase,
} from './database';

// Document Processing
export {
  extractText,
  chunkText,
  processDocument,
  detectFileType,
  isFileTypeSupported,
  getSupportedExtensions,
} from './documentProcessor';

// Embedding Service
export {
  configureEmbeddingService,
  getEmbeddingConfig,
  setApiKey,
  generateEmbedding,
  generateEmbeddingsForChunks,
  generateEmbeddingsBatch,
  cosineSimilarity,
} from './embeddingService';

// Project Service (main API)
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

// Chat Service (Phase 2)
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

// Tool Service (Phase 3+)
export {
  routeMessage,
  executeTool,
  executeToolCalls,
  executeReadTool,
  executeSearchTool,
  executeSummarizeTool,
  executeWriteTool,
  formatToolResults,
  orchestrateToolExecution,
} from './toolService';
export type { ExecutionStep, ExecutionLogCallback, OrchestratedResult, RoutingResult } from './toolService';

// Document Generator Service (Phase 6)
export {
  generatePDF,
  generateDOCX,
  generateDocument,
  downloadDocument,
  downloadBlob,
  getGeneratedDocument,
  downloadGeneratedDocument,
} from './documentGeneratorService';

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
} from './llmService';

