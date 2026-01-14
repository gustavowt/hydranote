/**
 * Services Index
 * Central export point for all services
 */

// Database
export { initializeDatabase, getConnection, flushDatabase, fuzzySearchFiles } from './database';
export type { FuzzySearchResult } from './database';

// Project Service
export {
  initialize,
  createProject,
  getProject,
  getAllProjects,
  deleteProject,
  ingestDocument,
  get_project_files,
  get_file_chunks,
  get_embeddings,
  vector_search,
  searchProject,
  getFile,
  getFileWithChunks,
  updateFile,
  renameFile,
  getProjectStats,
  deleteFile,
  moveFile,
  createEmptyMarkdownFile,
  // Centralized file operations (single source of truth)
  createFile,
  indexFileForSearch,
  reindexFile,
  // Phase 11: File tree API
  getProjectFileTree,
  getProjectFilesForAutocomplete,
  findFileByPath,
  // Global/Cross-project functions
  getAllFilesForAutocomplete,
  searchAllProjects,
  findFileGlobal,
} from './projectService';

// Chat Service
export {
  buildSystemPrompt,
  buildGlobalSystemPrompt,
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
  // Chat history
  getSessionHistory,
  switchToSession,
  startNewSession,
} from './chatService';

// LLM Service
export {
  loadSettings,
  saveSettings,
  isConfigured,
  chatCompletion,
  chatCompletionStreaming,
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
  executeReadTool,
  executeSearchTool,
  executeSummarizeTool,
  executeWriteTool,
  executeAddNoteTool,
  executeUpdateFileTool,
  executeCreateProjectTool,
  executeMoveFileTool,
  executeDeleteFileTool,
  executeDeleteProjectTool,
  executeWebResearchTool,
  executeTool,
  executeToolCalls,
  formatToolResults,
  // Inline tool call parser
  parseToolCallsFromResponse,
  // UpdateFile tool helpers
  getPendingPreview,
  removePendingPreview,
  applyFileUpdate,
  // Planner-Executor-Checker flow
  createExecutionPlan,
  executePlan,
  checkCompletion,
  runPlannerFlow,
  getToolIcon,
  // Auto-execute helpers
  shouldAutoExecutePlan,
  AUTO_EXECUTE_TOOLS,
} from './toolService';

// Export types from toolService
export type { ExecutionStep, ExecutionLogCallback, ParsedToolCalls, PlannerFlowResult } from './toolService';

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

// Export Service
export {
  exportToFile,
  exportToPDF,
  exportToDOCX,
  exportToMarkdown,
  generateExportBlob,
  getFileNameWithoutExtension,
  getExtensionForFormat,
  getMimeTypeForFormat,
} from './exportService';

export type { ExportResult, ExportOptions } from './exportService';

// Document Processor
export {
  detectFileType,
  extractText,
  chunkText,
  chunkMarkdownText,
  processDocument,
  isFileTypeSupported,
  getSupportedExtensions,
  // Section identification helpers
  parseDocumentStructure,
  buildSectionTree,
  findSectionByTitle,
  findSectionByPath,
  findMatchingSections,
  fuzzyMatchSections,
  getAllSectionTitles,
  stringSimilarity,
  parseLineNumberSpec,
  getOffsetFromLineNumbers,
  // DOCX/PDF conversion helpers
  convertDOCXToHTML,
  convertDOCXBufferToHTML,
  getFileBinaryData,
  base64ToArrayBuffer,
} from './documentProcessor';

// Embedding Service (with multi-provider indexer support)
export {
  // Settings management
  loadIndexerSettings,
  saveIndexerSettings,
  isIndexerConfigured,
  getIndexerProviderName,
  testIndexerConnection,
  // Embedding generation
  generateEmbedding,
  generateEmbeddingsForChunks,
  generateEmbeddingsBatch,
  cosineSimilarity,
  // Stale detection & re-indexing
  computeContentHash,
  detectStaleEmbeddings,
  reindexStaleFiles,
  reindexAllFiles,
} from './embeddingService';

export type { StaleFile, ReindexProgressCallback } from './embeddingService';

// Note Service (Phase 9 + Phase 10 + Phase 13 Optimization)
export {
  formatNote,
  generateNoteTitle,
  titleToSlug,
  generateUniqueFileName,
  getProjectDirectories,
  decideNoteDirectory,
  decideNoteDirectoryWithDirs, // Phase 13: For parallel execution optimization
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

// Telemetry Service (Phase 12)
export {
  trackEvent,
  trackNoteCreated,
  trackProjectCreated,
  trackDirectoryCreated,
  trackNoteCreationFailed,
  getMetrics,
  getAllEvents,
  getEventsByType,
  getRecentEvents,
  clearEvents,
  getMetricsSummary,
} from './telemetryService';

// File System Service
export {
  isElectron,
  isFileSystemAccessSupported,
  loadFileSystemSettings,
  saveFileSystemSettings,
  updateFileSystemSettings,
  selectRootDirectory,
  getRootDirectoryHandle,
  requestDirectoryPermission,
  ensureFileSystemPermission,
  disconnectRootDirectory,
  writeFile as fsWriteFile,
  readFile as fsReadFile,
  deleteFile as fsDeleteFile,
  createDirectory as fsCreateDirectory,
  deleteDirectory as fsDeleteDirectory,
  deleteProjectDirectory as fsDeleteProjectDirectory,
  listProjectFiles as fsListProjectFiles,
  getFileMetadata as fsGetFileMetadata,
  isSyncAvailable,
  getRootPath,
  listRootDirectories,
} from './fileSystemService';

// Sync Service
export {
  onSyncEvent,
  syncAll,
  syncProject,
  syncFileToFileSystem,
  syncFileFromFileSystem,
  syncFileDelete,
  syncProjectCreate,
  syncProjectDelete,
  startFileWatcher,
  stopFileWatcher,
  isSyncInProgress,
  getSyncStatus,
} from './syncService';

// Web Search Service
export {
  loadWebSearchSettings,
  saveWebSearchSettings,
  isWebSearchConfigured,
  searchWeb,
  fetchPageContent,
  extractTextFromHTML,
  webResearch,
  formatWebResearchResults,
  clearWebSearchCache,
  testWebSearchConnection,
} from './webSearchService';

// Version Service (File History)
export {
  createVersion,
  getVersionHistory,
  reconstructVersion,
  pruneVersions,
  deleteAllVersions,
  getVersionContent,
  hasVersionHistory,
  getLatestVersionNumber,
  createInitialVersion,
  createUpdateVersion,
  createFormatVersion,
  createRestoreVersion,
} from './versionService';

// Setup Wizard Service
export {
  isWizardCompleted,
  markWizardCompleted,
  resetWizardState,
  shouldShowWizard,
} from './setupWizardService';

// MCP Service (Model Context Protocol)
export {
  initializeMCPService,
  loadMCPSettings,
  saveMCPSettings,
  generateMCPToken,
  getMCPServerStatus,
  generateMCPConfig,
  isMCPAvailable,
  DEFAULT_MCP_SETTINGS,
} from './mcpService';

export type { MCPSettings } from './mcpService';

// Local Model Service (Hugging Face models)
export {
  isLocalModelsAvailable,
  getModelCatalog,
  fetchModelInfo,
  getInstalledModels,
  getInstalledModel,
  installModel,
  cancelInstallation,
  removeModel,
  onDownloadProgress,
  getRuntimeStatus,
  onRuntimeStatusChange,
  loadModel,
  unloadModel,
  runInference,
  loadLocalModelSettings,
  saveLocalModelSettings,
  // Utility functions
  formatFileSize,
  formatSpeed,
  formatEta,
  getProgressPercent,
} from './localModelService';
