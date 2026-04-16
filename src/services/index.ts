/**
 * Services Index
 * Central export point for all services
 */

// Database
export { initializeDatabase, getConnection, flushDatabase, fuzzySearchFiles, updateProjectStatus, upsertCalendarEvent, getCalendarEventsByDateRange, getCalendarEventByGoogleId, getCalendarEventsForDate, deleteCalendarEventsByCalendarId, getAllCalendarEvents } from './database';
export type { FuzzySearchResult, DBCalendarEvent } from './database';

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
  renameProject,
  renameDirectory,
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
  loadActiveSessionAndHistory,
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
  isAutoFormatEnabled,
  isAutoProjectRoutingEnabled,
  isAutoDirectoryRoutingEnabled,
  loadImageGenerationSettings,
  saveImageGenerationSettings,
  getImageGenerationInstructions,
  isImageGenerationConfigured as isImageGenConfiguredFromLLM,
} from './llmService';

// Tool Service
export {
  executeReadTool,
  executeSearchTool,
  executeSummarizeTool,
  executeWriteTool,
  executeUpdateFileTool,
  executeCreateProjectTool,
  executeMoveFileTool,
  executeDeleteFileTool,
  executeDeleteProjectTool,
  executeWebResearchTool,
  executeListEventsTool,
  executeCreateEventTool,
  executeSearchTranscriptsTool,
  executePrepareMeetingTool,
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
  // Auto-execute helper (uses LLM complexity assessment)
  shouldAutoExecutePlan,
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
  // Hugging Face local embeddings (Electron only)
  isHuggingFaceLocalAvailable,
  getHuggingFaceLocalStatus,
  onHuggingFaceLocalStatusChange,
  getHuggingFaceLocalCatalog,
} from './embeddingService';

export type { StaleFile, ReindexProgressCallback } from './embeddingService';

// Note Service (Phase 9 + Phase 10 + Phase 13 Optimization)
export {
  formatNote,
  formatNoteWithConversation,
  buildFormatNotePrompt,
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
  writeBinaryFile as fsWriteBinaryFile,
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
  validateCustomModel,
  getInstalledModels,
  getInstalledModel,
  installModel,
  cancelInstallation,
  removeModel,
  onDownloadProgress,
  getRuntimeStatus,
  getHardwareInfo,
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

export type { CustomModelValidationResult } from './localModelService';

// Image Generation Service
export {
  generateImage,
  isImageGenerationConfigured,
} from './imageGenerationService';

export type { ImageGenerationResult, ImageGenerationOptions } from './imageGenerationService';

// Integration Service
export {
  loadIntegrationSettings,
  saveIntegrationSettings,
  toggleIntegration,
  isIntegrationEnabled,
  isGoogleAppEnabled,
} from './integrationService';

// Google Workspace Auth Service
export {
  loadGoogleWorkspaceSettings,
  saveGoogleWorkspaceSettings,
  getWorkspaceAccessToken,
  startGoogleOAuth,
  googleFetch,
  buildScopesForEnabledApps,
  MEET_SCOPES,
  CALENDAR_SCOPES,
} from './googleWorkspaceAuthService';

// Zoom Service
export {
  loadZoomSettings,
  saveZoomSettings,
  getAccessToken as getZoomAccessToken,
  testConnection as testZoomConnection,
  listRecordings as listZoomRecordings,
  downloadTranscript as downloadZoomTranscript,
  filterNewMeetingsWithTranscripts,
  getTranscriptDownloadUrl,
} from './zoomService';

// Zoom Sync Service
export {
  startSync as startZoomSync,
  stopSync as stopZoomSync,
  restartSync as restartZoomSync,
  syncNow as zoomSyncNow,
  onSyncEvent as onZoomSyncEvent,
  isSyncing as isZoomSyncing,
  isSyncRunning as isZoomSyncRunning,
} from './zoomSyncService';

// VTT Parser
export {
  vttToMarkdown,
  extractSpeakers,
} from './vttParser';

// Google Meet Service
export {
  testMeetConnection,
  listConferenceRecords,
  listTranscripts as listGoogleMeetTranscripts,
  downloadTranscriptDoc,
  filterNewConferencesWithTranscripts,
  getTranscriptDocumentId,
  getMeetingTopic,
} from './googleMeetService';

// Google Meet Sync Service
export {
  startSync as startGoogleMeetSync,
  stopSync as stopGoogleMeetSync,
  restartSync as restartGoogleMeetSync,
  syncNow as googleMeetSyncNow,
  onSyncEvent as onGoogleMeetSyncEvent,
  isSyncing as isGoogleMeetSyncing,
  isSyncRunning as isGoogleMeetSyncRunning,
} from './googleMeetSyncService';

// Date Detection Service
export {
  detectDates,
  clearDateCache,
  formatDetectedDate,
  getRelativeTime,
} from './dateDetectionService';

// Google Calendar Service
export {
  testCalendarConnection,
  listCalendars,
  listEvents as listCalendarEvents,
  createEvent as createCalendarEvent,
  getUpcomingEventsForContext,
  filterNewEvents,
  formatEventToMarkdown,
  getEventDatePrefix,
  sanitizeFileName as sanitizeCalendarFileName,
} from './googleCalendarService';

// Google Calendar Sync Service
export {
  startSync as startGoogleCalendarSync,
  stopSync as stopGoogleCalendarSync,
  restartSync as restartGoogleCalendarSync,
  syncNow as googleCalendarSyncNow,
  onSyncEvent as onGoogleCalendarSyncEvent,
  isSyncing as isGoogleCalendarSyncing,
  isSyncRunning as isGoogleCalendarSyncRunning,
} from './googleCalendarSyncService';

// Dictation Services
export {
  ELECTRON_TRAY_WORKSPACE_EVENT,
  loadDictationSettings,
  saveDictationSettings,
  isDictationConfigured,
  syncElectronDictationCompanionTray,
} from './dictationSettingsService';

export {
  dictationState,
  startRecording,
  stopRecording,
  cancelRecording,
  isRecording,
  onTranscriptionComplete,
  offTranscriptionComplete,
  initDictationIPC,
} from './dictationService';

export {
  runPipeline as runDictationPipeline,
  runCleanup as runDictationCleanup,
  runActions as runDictationActions,
  onPipelineAction,
  offPipelineAction,
} from './dictationPipelineService';

// Update Service (GitHub version check)
export {
  currentVersion,
  latestVersion,
  hasUpdate,
  releaseUrl,
  checkForUpdates,
  dismissUpdate,
  startUpdateChecker,
  stopUpdateChecker,
} from './updateService';
