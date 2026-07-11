/**
 * Project Service
 * Main API for managing projects and document ingestion
 * Provides helper functions as specified in the roadmap
 */

import type { Project, ProjectFile, Chunk, Embedding, ChunkingConfig, SearchResult, SupportedFileType, FileTreeNode, ProjectFileTree } from '../types';

// In-memory cache for image binary data to avoid storing large blobs in DuckDB WASM
// (DuckDB WASM has limited memory and crashes on large base64 strings)
const imageBinaryCache = new Map<string, string>(); // fileId → base64

/** Max image size stored in DuckDB when filesystem sync is unavailable */
const MAX_IMAGE_DB_BYTES = 5 * 1024 * 1024;

/**
 * Get cached image binary data by file ID
 */
export function getCachedImageBinary(fileId: string): string | undefined {
  return imageBinaryCache.get(fileId);
}

/**
 * Convert Uint8Array to base64 string efficiently (avoids stack overflow for large files)
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Process in small chunks to avoid call stack size issues with apply()
  const CHUNK_SIZE = 0x1000; // 4KB chunks (safe for all JS engines)
  let binary = '';
  
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  
  return btoa(binary);
}

import {
  initializeDatabase,
  createProject as dbCreateProject,
  getProject as dbGetProject,
  getAllProjects as dbGetAllProjects,
  updateProjectStatus,
  createFile as dbCreateFile,
  getFile as dbGetFile,
  updateFileStatus,
  updateFileContent,
  updateFileName as dbUpdateFileName,
  updateProjectName as dbUpdateProjectName,
  createChunks as dbCreateChunks,
  createEmbeddings as dbCreateEmbeddings,
  vectorSearch as dbVectorSearch,
  getConnection,
  deleteProject as dbDeleteProject,
  deleteFile as dbDeleteFile,
  updateFileProject as dbUpdateFileProject,
  flushDatabase,
  deleteFileSearchData,
  updateFileContentHash,
} from './database';
import { processDocument, isFileTypeSupported } from './documentProcessor';
import { generateEmbeddingsForChunks, generateEmbedding } from './embeddingService';
import {
  reindexFileDates,
  clearFileDates,
  syncNoteDatesFileName,
  syncNoteDatesProject,
} from './dateIndexService';
import {
  reindexFileLinks,
  clearFileLinks,
  syncNoteLinksFileName,
  syncNoteLinksProject,
} from './linkIndexService';
import {
  syncFileToFileSystem,
  syncFileDelete,
  syncProjectCreate,
  syncProjectDelete,
} from './syncService';
import { writeBinaryFile as writeBinaryFileToFS } from './fileSystemService';
import {
  createInitialVersion,
  createUpdateVersion,
} from './versionService';

let initialized = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Initialize the project service
 * Uses a lock to prevent concurrent initialization attempts.
 */
export async function initialize(): Promise<void> {
  if (initialized) return;
  
  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }
  
  // Start initialization and store the promise
  initializationPromise = initializeDatabase();
  
  try {
    await initializationPromise;
    initialized = true;
    await runStartupMigrations();
  } catch (error) {
    // Reset on failure so it can be retried
    initializationPromise = null;
    throw error;
  }
}

/**
 * Ensure service is initialized
 */
async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    await initialize();
  }
}

const STARTUP_MIGRATION_KEY = 'hydranote.migration.reindexMissingChunks.v1';

async function runStartupMigrations(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(STARTUP_MIGRATION_KEY)) return;

  try {
    const { reindexFilesMissingChunks } = await import('./embeddingService');
    const result = await reindexFilesMissingChunks();
    if (result.reindexed > 0) {
      console.info(
        `[HydraNote] Indexed ${result.reindexed} previously unindexed file(s) for search.`,
      );
    }
    localStorage.setItem(STARTUP_MIGRATION_KEY, 'done');
  } catch (err) {
    console.warn('[HydraNote] Startup reindex migration failed:', err);
  }
}

// ============================================
// Project Management
// ============================================

/**
 * Create a new project
 * Returns the project and an optional sync error if file system sync failed
 * 
 * Note: If a project with the same name already exists (case-insensitive),
 * returns the existing project instead of creating a duplicate.
 * This makes the operation idempotent and safe to use in pipelines.
 */
export async function createProject(name: string, description?: string): Promise<Project & { syncError?: string }> {
  await ensureInitialized();
  
  // Check if a project with the same name already exists (case-insensitive)
  const existingProjects = await dbGetAllProjects();
  const existingProject = existingProjects.find(
    (p) => p.name.toLowerCase() === name.toLowerCase()
  );
  
  if (existingProject) {
    // Return existing project instead of creating a duplicate
    // Still ensure the file system directory exists
    const syncResult = await syncProjectCreate(existingProject.name);
    if (!syncResult.success) {
      return { ...existingProject, syncError: syncResult.error };
    }
    return existingProject;
  }
  
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    description,
    status: 'created',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  await dbCreateProject(project);
  
  // Sync to file system (creates project directory)
  const syncResult = await syncProjectCreate(name);
  
  if (!syncResult.success) {
    return { ...project, syncError: syncResult.error };
  }
  
  return project;
}

/**
 * Get a project by ID
 */
export async function getProject(projectId: string): Promise<Project | null> {
  await ensureInitialized();
  return dbGetProject(projectId);
}

/**
 * Get all projects
 */
export async function getAllProjects(): Promise<Project[]> {
  await ensureInitialized();
  return dbGetAllProjects();
}

/**
 * Delete a project and all its files, chunks, and embeddings
 */
export async function deleteProject(projectId: string): Promise<void> {
  await ensureInitialized();
  
  // Get project name before deletion for file system sync
  const project = await dbGetProject(projectId);
  const projectName = project?.name;
  
  await dbDeleteProject(projectId);
  
  // Sync to file system (deletes project directory)
  if (projectName) {
    await syncProjectDelete(projectName);
  }
}

// ============================================
// Document Ingestion
// ============================================

/**
 * Ingest a document into a project
 * Extracts text, creates chunks, and generates embeddings
 * For PDF files: stores system file path (readonly viewing from file system)
 * For DOCX files: stores binary data and HTML for rich viewing/editing
 */
export async function ingestDocument(
  file: File,
  projectId: string,
  chunkingConfig?: ChunkingConfig,
  systemFilePath?: string
): Promise<ProjectFile> {
  await ensureInitialized();
  
  // Validate project exists
  const project = await dbGetProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  
  // Validate file type
  if (!isFileTypeSupported(file.name)) {
    throw new Error(`Unsupported file type: ${file.name}`);
  }
  
  const fileType = file.name.split('.').pop()?.toLowerCase() as ProjectFile['type'];
  
  // Create file record
  const projectFile: ProjectFile = {
    id: crypto.randomUUID(),
    projectId,
    name: file.name,
    type: fileType,
    size: file.size,
    status: 'processing',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  await dbCreateFile(projectFile);
  await updateProjectStatus(projectId, 'indexing');
  
  try {
    // Process document
    const { text, chunks } = await processDocument(file, projectFile.id, projectId, chunkingConfig);
    
    // Store extracted text
    await updateFileContent(projectFile.id, text);
    
    // For PDF files: store the system file path for readonly viewing
    if (fileType === 'pdf' && systemFilePath) {
      await updateFileSystemPath(projectFile.id, systemFilePath);
      projectFile.systemFilePath = systemFilePath;
    }
    
    // For DOCX files: store binary data and convert to HTML for rich viewing/editing
    if (fileType === 'docx') {
      const { getFileBinaryData, convertDOCXToHTML } = await import('./documentProcessor');
      const binaryData = await getFileBinaryData(file);
      await updateFileBinaryData(projectFile.id, binaryData);
      projectFile.binaryData = binaryData;
      
      const { html } = await convertDOCXToHTML(file);
      await updateFileHtmlContent(projectFile.id, html);
      projectFile.htmlContent = html;
    }
    
    // Store chunks
    await dbCreateChunks(chunks);
    
    // Generate and store embeddings
    const embeddings = await generateEmbeddingsForChunks(chunks);
    await dbCreateEmbeddings(embeddings);
    
    // Update statuses
    await updateFileStatus(projectFile.id, 'indexed');
    await updateProjectStatus(projectId, 'indexed');
    
    projectFile.status = 'indexed';
    projectFile.content = text;
    
    // Sync to file system (for markdown files)
    if (projectFile.type === 'md' && text) {
      await syncFileToFileSystem(project.name, projectFile.name, text);
    }
    
    return projectFile;
  } catch (error) {
    await updateFileStatus(projectFile.id, 'error');
    await updateProjectStatus(projectId, 'error');
    throw error;
  }
}

/**
 * Update file binary data (for PDF/DOCX viewing)
 */
async function updateFileBinaryData(fileId: string, binaryData: string): Promise<void> {
  const conn = getConnection();
  const stmt = await conn.prepare(`
    UPDATE files 
    SET binary_data_base64 = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `);
  await stmt.query(binaryData, fileId);
  await stmt.close();
}

/**
 * Update file HTML content (for DOCX rich viewing)
 */
async function updateFileHtmlContent(fileId: string, htmlContent: string): Promise<void> {
  const conn = getConnection();
  const escaped = htmlContent.replace(/'/g, "''");
  await conn.query(`
    UPDATE files 
    SET html_content = '${escaped}', updated_at = CURRENT_TIMESTAMP
    WHERE id = '${fileId}'
  `);
}

/**
 * Update file system path (for PDF viewing from file system)
 */
async function updateFileSystemPath(fileId: string, systemFilePath: string): Promise<void> {
  const conn = getConnection();
  const escaped = systemFilePath.replace(/'/g, "''");
  await conn.query(`
    UPDATE files 
    SET system_file_path = '${escaped}', updated_at = CURRENT_TIMESTAMP
    WHERE id = '${fileId}'
  `);
}

// ============================================
// Helper Functions (as per roadmap)
// ============================================

/**
 * Get all files belonging to a project
 * Roadmap: get_project_files(project_id)
 */
export async function get_project_files(projectId: string): Promise<ProjectFile[]> {
  await ensureInitialized();
  
  const conn = getConnection();
  const result = await conn.query(`
    SELECT * FROM files WHERE project_id = '${projectId}' ORDER BY created_at DESC
  `);
  
  return result.toArray().map((row: Record<string, unknown>) => {
    const fileId = row.id as string;

    // binary_data_base64 is stored as TEXT, get it directly
    // Fall back to old binary_data column for backward compatibility
    let binaryData: string | undefined = row.binary_data_base64 as string | undefined;
    if (!binaryData && row.binary_data) {
      binaryData = uint8ArrayToBase64(new Uint8Array(row.binary_data as ArrayBuffer));
    }
    // Check in-memory cache for images not stored in DB
    if (!binaryData) {
      binaryData = imageBinaryCache.get(fileId);
    }

    return {
      id: fileId,
      projectId: row.project_id as string,
      name: row.name as string,
      type: row.type as ProjectFile['type'],
      size: row.size as number,
      status: row.status as ProjectFile['status'],
      content: row.content as string | undefined,
      binaryData,
      htmlContent: row.html_content as string | undefined,
      systemFilePath: row.system_file_path as string | undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  });
}

/**
 * Get file metadata only (no content, binary data, or HTML) for tree building.
 * Much faster than get_project_files for large projects.
 */
export async function get_project_files_metadata(projectId: string): Promise<ProjectFile[]> {
  await ensureInitialized();
  
  const conn = getConnection();
  const result = await conn.query(`
    SELECT id, project_id, name, type, size, status, system_file_path, created_at, updated_at
    FROM files WHERE project_id = '${projectId}' ORDER BY created_at DESC
  `);
  
  return result.toArray().map((row: Record<string, unknown>) => ({
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
    type: row.type as ProjectFile['type'],
    size: row.size as number,
    status: row.status as ProjectFile['status'],
    systemFilePath: row.system_file_path as string | undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }));
}

/**
 * Get all chunks belonging to a file
 * Roadmap: get_file_chunks(file_id)
 */
export async function get_file_chunks(fileId: string): Promise<Chunk[]> {
  await ensureInitialized();
  
  const conn = getConnection();
  const result = await conn.query(`
    SELECT * FROM chunks WHERE file_id = '${fileId}' ORDER BY chunk_index ASC
  `);
  
  return result.toArray().map((row: Record<string, unknown>) => ({
    id: row.id as string,
    fileId: row.file_id as string,
    projectId: row.project_id as string,
    index: row.chunk_index as number,
    text: row.text as string,
    startOffset: row.start_offset as number,
    endOffset: row.end_offset as number,
    pageNumber: row.page_number != null ? Number(row.page_number) : undefined,
    section: row.section != null ? String(row.section) : undefined,
    kind: row.kind != null ? (String(row.kind) as Chunk['kind']) : undefined,
    createdAt: new Date(row.created_at as string),
  }));
}

/**
 * Get all embeddings belonging to a project
 * Roadmap: get_embeddings(project_id)
 */
export async function get_embeddings(projectId: string): Promise<Embedding[]> {
  await ensureInitialized();
  
  const conn = getConnection();
  const result = await conn.query(`
    SELECT * FROM embeddings WHERE project_id = '${projectId}'
  `);
  
  return result.toArray().map((row: Record<string, unknown>) => ({
    id: row.id as string,
    chunkId: row.chunk_id as string,
    fileId: row.file_id as string,
    projectId: row.project_id as string,
    vector: row.vector as number[],
    createdAt: new Date(row.created_at as string),
  }));
}

/**
 * Perform vector similarity search across project documents
 * Roadmap: vector_search(project_id, query_embedding, k=5)
 */
export async function vector_search(
  projectId: string,
  queryEmbedding: number[],
  k: number = 5
): Promise<SearchResult[]> {
  await ensureInitialized();
  
  const results = await dbVectorSearch(projectId, queryEmbedding, k);
  
  // Enrich results with file names
  const enrichedResults: SearchResult[] = [];
  
  for (const result of results) {
    const file = await dbGetFile(result.fileId);
    enrichedResults.push({
      chunkId: result.chunkId,
      fileId: result.fileId,
      fileName: file?.name || 'Unknown',
      text: result.text,
      score: result.score,
      pageNumber: result.pageNumber,
      section: result.section,
      kind: result.kind as SearchResult['kind'],
    });
  }
  
  return enrichedResults;
}

/**
 * Search project by text query (convenience wrapper)
 * Generates embedding from query text and performs vector search
 */
export async function searchProject(
  projectId: string,
  query: string,
  k: number = 5
): Promise<SearchResult[]> {
  await ensureInitialized();
  
  const queryEmbedding = await generateEmbedding(query);
  return vector_search(projectId, queryEmbedding, k);
}

// ============================================
// File Operations (Centralized - Single Source of Truth)
// ============================================

/**
 * Get a file by ID
 */
export async function getFile(fileId: string): Promise<ProjectFile | null> {
  await ensureInitialized();
  const file = await dbGetFile(fileId);
  if (!file) return null;

  const imageTypes: SupportedFileType[] = ['png', 'jpg', 'jpeg', 'webp'];
  if (imageTypes.includes(file.type) && !file.binaryData) {
    const cached = imageBinaryCache.get(fileId);
    if (cached) {
      file.binaryData = cached;
    } else {
      const project = await dbGetProject(file.projectId);
      if (project) {
        try {
          const { readBinaryFile } = await import('./fileSystemService');
          const result = await readBinaryFile(project.name, file.name);
          if (result.success && result.data) {
            const bytes = new Uint8Array(result.data);
            const base64 = uint8ArrayToBase64(bytes);
            file.binaryData = base64;
            imageBinaryCache.set(fileId, base64);
            if (bytes.byteLength <= MAX_IMAGE_DB_BYTES) {
              await updateFileBinaryData(fileId, base64);
              await flushDatabase();
            }
          }
        } catch (err) {
          console.warn('Failed to hydrate image binary:', fileId, err);
        }
      }
      if (!file.binaryData && file.systemFilePath) {
        const diskFile = await loadBinaryFileFromSystem(file);
        if (diskFile) {
          const bytes = new Uint8Array(await diskFile.arrayBuffer());
          const base64 = uint8ArrayToBase64(bytes);
          file.binaryData = base64;
          imageBinaryCache.set(fileId, base64);
          if (bytes.byteLength <= MAX_IMAGE_DB_BYTES) {
            await updateFileBinaryData(fileId, base64);
            await flushDatabase();
          }
        }
      }
    }
  }

  return file;
}

/**
 * Create a new file in a project (centralized function)
 * This is the SINGLE SOURCE OF TRUTH for file creation.
 * All services should use this function to create files.
 * 
 * Handles:
 * - Database insertion
 * - File system sync (for markdown files)
 * - Automatic flushing
 * - Search indexing for md/txt files (chunks/embeddings)
 */
export async function createFile(
  projectId: string,
  filePath: string,
  content: string,
  fileType: SupportedFileType = 'md',
  binaryData?: Uint8Array,
  htmlContent?: string,
  systemFilePath?: string,
): Promise<ProjectFile> {
  await ensureInitialized();
  
  // Validate project exists
  const project = await dbGetProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  
  const now = new Date();
  const fileId = crypto.randomUUID();
  const size = binaryData ? binaryData.length : new Blob([content]).size;
  const imageTypes: SupportedFileType[] = ['png', 'jpg', 'jpeg', 'webp'];
  const isImage = imageTypes.includes(fileType);

  // Convert binary data to base64
  let binaryDataBase64: string | undefined;
  if (binaryData) {
    binaryDataBase64 = uint8ArrayToBase64(binaryData);
  }

  // Images: prefer filesystem; fall back to DB when sync is off or write fails (mirrors PDF drop-ingest).
  let dbBinaryData: string | undefined;
  if (isImage) {
    dbBinaryData = undefined;
    if (binaryDataBase64 && binaryData) {
      imageBinaryCache.set(fileId, binaryDataBase64);
      const fsResult = await writeBinaryFileToFS(project.name, filePath, binaryData);
      if (!fsResult.success) {
        if (binaryData.byteLength > MAX_IMAGE_DB_BYTES) {
          throw new Error(
            `Image is too large (${Math.round(binaryData.byteLength / (1024 * 1024))}MB) to store without file system sync. Enable sync or use a smaller image.`,
          );
        }
        dbBinaryData = binaryDataBase64;
      }
    }
  } else {
    dbBinaryData = binaryDataBase64;
  }

  // Create file record
  const projectFile: ProjectFile = {
    id: fileId,
    projectId,
    name: filePath,
    type: fileType,
    size,
    status: 'indexed',
    content,
    binaryData: isImage ? binaryDataBase64 : dbBinaryData,
    htmlContent,
    systemFilePath,
    createdAt: now,
    updatedAt: now,
  };

  // DB record: images use DB only when FS sync unavailable; other binaries always stored
  const dbFile: ProjectFile = { ...projectFile, binaryData: dbBinaryData };
  await dbCreateFile(dbFile);
  await flushDatabase();

  // Create initial version for version history
  await createInitialVersion(fileId, content);

  // Sync text files to file system (images already written above when sync enabled)
  if (!isImage && (fileType === 'md' || fileType === 'txt')) {
    await syncFileToFileSystem(project.name, filePath, content);
  }

  if ((fileType === 'md' || fileType === 'txt') && content.trim()) {
    try {
      await indexFileForSearch(projectId, fileId, content, fileType);
    } catch (err) {
      console.warn('Failed to index new file:', fileId, err);
    }
  }

  if (fileType === 'md' || fileType === 'txt') {
    try {
      await reindexFileDates(fileId, projectId, filePath, content, fileType);
    } catch (err) {
      console.warn('Failed to index note dates for new file:', fileId, err);
    }
    try {
      await reindexFileLinks(fileId, projectId, filePath, content, fileType);
    } catch (err) {
      console.warn('Failed to index note links for new file:', fileId, err);
    }
  }

  // Return the full projectFile (with binaryData for immediate use in the session)
  return projectFile;
}

/**
 * Index a file for semantic search (create chunks and embeddings)
 * Call this after createFile() if the file should be searchable.
 *
 * Note: this helper is intentionally limited to `md` / `txt`. PDFs use the
 * page-aware pipeline in `pdfIngestionService.ingestPdfForSearch`, which is
 * invoked directly by `syncService` after `createFile(...,'pdf',...)` and by
 * `reindexFile('pdf', ...)`. We keep `'pdf'` in the signature so callers can
 * use one accept-list with the file type, but route it to a no-op here.
 */
export async function indexFileForSearch(
  projectId: string,
  fileId: string,
  content: string,
  fileType: 'md' | 'txt' | 'pdf' = 'md'
): Promise<void> {
  await ensureInitialized();

  if (fileType === 'pdf') {
    // PDFs cannot be indexed from a plain `content` string — they need the
    // original binary so we can render visual pages. Callers with a `File`
    // should use `pdfIngestionService.ingestPdfForSearch` directly.
    return;
  }

  const { chunkText, chunkMarkdownText } = await import('./documentProcessor');
  const { generateEmbeddingsForChunks } = await import('./embeddingService');
  const { computeContentHash } = await import('./embeddingService');

  // Chunk the content based on file type
  const chunks = fileType === 'md'
    ? chunkMarkdownText(content, fileId, projectId)
    : chunkText(content, fileId, projectId);

  await deleteFileSearchData(fileId);

  // Store chunks
  await dbCreateChunks(chunks);

  // Generate and store embeddings
  try {
    const embeddings = await generateEmbeddingsForChunks(chunks);
    await dbCreateEmbeddings(embeddings);
  } catch (error) {
    console.warn('Failed to generate embeddings for file:', fileId, error);
  }

  await updateFileContentHash(fileId, computeContentHash(content));

  await flushDatabase();
}

/**
 * Re-index a file: delete old chunks/embeddings and create new ones
 * Use this when file content has been updated to keep search results accurate.
 *
 * - For `'md'` / `'txt'`: chunks the new `content` string and re-embeds.
 * - For `'pdf'`: re-runs the page-aware ingestion pipeline (text extraction,
 *   visual detection, vision-model description for visual pages, then chunk +
 *   embed). The caller must pass either a fresh `File` object or the file must
 *   have a `systemFilePath` so the binary can be re-read from disk. The
 *   `content` argument is ignored for PDFs.
 */
export async function reindexFile(
  fileId: string,
  content: string,
  fileType: 'md' | 'txt' | 'pdf' = 'md',
  pdfFile?: File,
): Promise<void> {
  await ensureInitialized();

  // Get file to retrieve projectId
  const file = await dbGetFile(fileId);
  if (!file) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (fileType === 'pdf') {
    // Source the binary either from the caller or from the system file path.
    // The PDF ingestion pipeline takes care of deleting prior chunks/embeddings.
    const source = pdfFile ?? (await loadPdfFileFromSystem(file));
    if (!source) {
      throw new Error(`Cannot re-index PDF "${file.name}": no binary source available`);
    }
    const { ingestPdfForSearch } = await import('./pdfIngestionService');
    await ingestPdfForSearch(file.projectId, fileId, source);
    return;
  }
  
  // indexFileForSearch clears prior chunks/embeddings before re-indexing
  await indexFileForSearch(file.projectId, fileId, content, fileType);
}

/**
 * Read a binary file back from disk (via Electron IPC) and rebuild a `File`
 * object the ingestion pipeline can consume. Returns `null` when the file has
 * no `systemFilePath` (e.g. a pure in-DB PDF) or the read fails.
 */
async function loadBinaryFileFromSystem(
  file: ProjectFile,
  mimeType = 'application/octet-stream',
): Promise<File | null> {
  if (!file.systemFilePath) return null;
  try {
    const electronAPI = (window as unknown as {
      electronAPI?: {
        fs?: { readBinaryFile?: (path: string) => Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> };
      };
    }).electronAPI;
    if (!electronAPI?.fs?.readBinaryFile) return null;
    const result = await electronAPI.fs.readBinaryFile(file.systemFilePath);
    if (!result.success || !result.data) return null;
    const baseName = file.name.split('/').pop() ?? file.name;
    return new File([new Uint8Array(result.data)], baseName, { type: mimeType });
  } catch {
    return null;
  }
}

async function loadPdfFileFromSystem(file: ProjectFile): Promise<File | null> {
  return loadBinaryFileFromSystem(file, 'application/pdf');
}

/**
 * Get file with its chunks
 */
export async function getFileWithChunks(fileId: string): Promise<{ file: ProjectFile; chunks: Chunk[] } | null> {
  await ensureInitialized();
  
  const file = await dbGetFile(fileId);
  if (!file) return null;
  
  const chunks = await get_file_chunks(fileId);
  return { file, chunks };
}

export interface UpdateFileOptions {
  /** When false, skip version-history entry (e.g. idle auto-save). Default true. */
  createVersion?: boolean;
}

/**
 * Update file content and sync to file system
 * Creates a version of the current content before updating (unless createVersion is false)
 * Re-indexes the file for accurate search results
 */
export async function updateFile(
  fileId: string,
  content: string,
  options?: UpdateFileOptions,
): Promise<ProjectFile | null> {
  await ensureInitialized();
  
  // Get file info for sync
  const file = await dbGetFile(fileId);
  if (!file) {
    return null;
  }
  
  // Get project name for file system sync
  const project = await dbGetProject(file.projectId);
  
  const createVersion = options?.createVersion !== false;
  if (createVersion) {
    await createUpdateVersion(fileId, file.content ?? '');
  }
  
  // Update content in database
  await updateFileContent(fileId, content);
  await flushDatabase();
  
  // Sync to file system
  if (project && file.type === 'md') {
    await syncFileToFileSystem(project.name, file.name, content);
  }
  
  // Re-index for search (update chunks and embeddings)
  // Only re-index text-based files that support search
  if (file.type === 'md' || file.type === 'txt') {
    try {
      await reindexFile(fileId, content, file.type as 'md' | 'txt');
    } catch (error) {
      // Don't fail the update if re-indexing fails
      console.warn('Failed to re-index file after update:', fileId, error);
    }
    try {
      await reindexFileDates(fileId, file.projectId, file.name, content, file.type);
    } catch (error) {
      console.warn('Failed to re-index note dates after update:', fileId, error);
    }
    try {
      await reindexFileLinks(fileId, file.projectId, file.name, content, file.type);
    } catch (error) {
      console.warn('Failed to re-index note links after update:', fileId, error);
    }
  }
  
  // Return updated file
  return {
    ...file,
    content,
    size: new Blob([content]).size,
    updatedAt: new Date(),
  };
}

/**
 * Rename a file (update the file name/path within the same project)
 * Handles database update and file system sync
 */
export async function renameFile(fileId: string, newName: string): Promise<ProjectFile | null> {
  await ensureInitialized();
  
  // Get file info
  const file = await dbGetFile(fileId);
  if (!file) {
    return null;
  }
  
  // Get project name for file system sync
  const project = await dbGetProject(file.projectId);
  
  // Get the directory from the old path (if any)
  const oldPath = file.name;
  const lastSlash = oldPath.lastIndexOf('/');
  const directory = lastSlash > 0 ? oldPath.substring(0, lastSlash) : '';
  
  // Build new full path with same directory
  const newFullPath = directory ? `${directory}/${newName}` : newName;
  
  // Update name in database
  await dbUpdateFileName(fileId, newFullPath);

  try {
    await syncNoteDatesFileName(fileId, newFullPath);
  } catch (error) {
    console.warn('Failed to sync note date file name after rename:', fileId, error);
  }
  try {
    await syncNoteLinksFileName(fileId, newFullPath);
  } catch (error) {
    console.warn('Failed to sync note link file name after rename:', fileId, error);
  }

  // Sync to file system: delete old file, write new file
  if (project && file.type === 'md' && file.content) {
    await syncFileDelete(project.name, oldPath);
    await syncFileToFileSystem(project.name, newFullPath, file.content);
  }
  
  // Return updated file
  return {
    ...file,
    name: newFullPath,
    updatedAt: new Date(),
  };
}

/**
 * Rename a project (update name in DB + sync filesystem directory)
 */
export async function renameProject(projectId: string, newName: string): Promise<Project | null> {
  await ensureInitialized();
  
  const project = await dbGetProject(projectId);
  if (!project) return null;
  
  const oldName = project.name;
  
  // Create new project directory on filesystem
  await syncProjectCreate(newName);
  
  // Get all files for this project to re-sync them
  const files = await get_project_files(projectId);
  
  // Re-sync all files: delete from old project dir, write to new
  for (const file of files) {
    if (file.content) {
      await syncFileDelete(oldName, file.name);
      await syncFileToFileSystem(newName, file.name, file.content);
    }
  }
  
  // Delete old project directory
  await syncProjectDelete(oldName);
  
  // Update project name in database
  await dbUpdateProjectName(projectId, newName);
  
  return {
    ...project,
    name: newName,
    updatedAt: new Date(),
  };
}

/**
 * Rename a directory (update all file paths within the directory)
 * Handles database update and file system sync for all affected files
 */
export async function renameDirectory(projectId: string, oldDirPath: string, newDirName: string): Promise<void> {
  await ensureInitialized();
  
  const project = await dbGetProject(projectId);
  if (!project) return;
  
  // Build the new directory path (replace last segment of the old path)
  const lastSlash = oldDirPath.lastIndexOf('/');
  const parentDir = lastSlash > 0 ? oldDirPath.substring(0, lastSlash) : '';
  const newDirPath = parentDir ? `${parentDir}/${newDirName}` : newDirName;
  
  // Get all files for this project
  const files = await get_project_files(projectId);
  
  // Find files that are inside the old directory
  const affectedFiles = files.filter(f => 
    f.name === oldDirPath || f.name.startsWith(oldDirPath + '/')
  );
  
  // Update each affected file's path
  for (const file of affectedFiles) {
    const oldPath = file.name;
    const newPath = newDirPath + oldPath.substring(oldDirPath.length);
    
    // Update in database
    await dbUpdateFileName(file.id, newPath);
    
    // Sync filesystem: delete old, write new
    if (file.content) {
      await syncFileDelete(project.name, oldPath);
      await syncFileToFileSystem(project.name, newPath, file.content);
    }
  }
}

/**
 * Delete a file and its chunks and embeddings
 */
export async function deleteFile(fileId: string): Promise<void> {
  await ensureInitialized();
  
  // Get file and project info before deletion for file system sync
  const file = await dbGetFile(fileId);
  let projectName: string | undefined;
  if (file) {
    const project = await dbGetProject(file.projectId);
    projectName = project?.name;
  }
  
  await dbDeleteFile(fileId);

  try {
    await clearFileDates(fileId);
  } catch (error) {
    console.warn('Failed to clear note dates for deleted file:', fileId, error);
  }
  try {
    await clearFileLinks(fileId);
  } catch (error) {
    console.warn('Failed to clear note links for deleted file:', fileId, error);
  }

  // Sync to file system (deletes file)
  if (projectName && file) {
    await syncFileDelete(projectName, file.name);
  }
}

/**
 * Move a file to a different project and/or directory
 */
export async function moveFile(
  fileId: string,
  targetProjectId: string,
  targetDirectory?: string
): Promise<ProjectFile> {
  await ensureInitialized();
  
  const file = await dbGetFile(fileId);
  if (!file) {
    throw new Error(`File not found: ${fileId}`);
  }
  
  // Get source project name for file system sync
  const sourceProject = await dbGetProject(file.projectId);
  const sourceProjectName = sourceProject?.name;
  
  // Get target project name for file system sync
  const targetProject = await dbGetProject(targetProjectId);
  const targetProjectName = targetProject?.name;
  
  // Get the file name (without path)
  const fileName = file.name.split('/').pop() || file.name;
  
  // Build new path
  const newName = targetDirectory 
    ? `${targetDirectory}/${fileName}`
    : fileName;
  
  await dbUpdateFileProject(fileId, targetProjectId, newName);

  try {
    await syncNoteDatesProject(fileId, targetProjectId, newName);
  } catch (error) {
    console.warn('Failed to sync note dates after move:', fileId, error);
  }
  try {
    await syncNoteLinksProject(fileId, targetProjectId, newName);
  } catch (error) {
    console.warn('Failed to sync note links after move:', fileId, error);
  }

  // Sync to file system: delete from old location, write to new location
  if (sourceProjectName && file.content) {
    await syncFileDelete(sourceProjectName, file.name);
  }
  if (targetProjectName && file.content) {
    await syncFileToFileSystem(targetProjectName, newName, file.content);
  }
  
  // Return updated file
  return {
    ...file,
    projectId: targetProjectId,
    name: newName,
    updatedAt: new Date(),
  };
}

/**
 * Create an empty markdown file in a project
 */
export async function createEmptyMarkdownFile(
  projectId: string,
  fileName: string,
  directory?: string
): Promise<ProjectFile> {
  const name = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
  const fullPath = directory ? `${directory}/${name}` : name;
  const content = `# ${fileName.replace(/\.md$/, '')}\n\n`;
  return createFile(projectId, fullPath, content, 'md');
}

// ============================================
// Statistics & Metadata
// ============================================

/**
 * Get project statistics
 */
export async function getProjectStats(projectId: string): Promise<{
  fileCount: number;
  chunkCount: number;
  embeddingCount: number;
}> {
  await ensureInitialized();
  
  const conn = getConnection();
  
  const fileResult = await conn.query(`
    SELECT COUNT(*) as count FROM files WHERE project_id = '${projectId}'
  `);
  const chunkResult = await conn.query(`
    SELECT COUNT(*) as count FROM chunks WHERE project_id = '${projectId}'
  `);
  const embeddingResult = await conn.query(`
    SELECT COUNT(*) as count FROM embeddings WHERE project_id = '${projectId}'
  `);
  
  return {
    fileCount: Number(fileResult.toArray()[0]?.count || 0),
    chunkCount: Number(chunkResult.toArray()[0]?.count || 0),
    embeddingCount: Number(embeddingResult.toArray()[0]?.count || 0),
  };
}

// ============================================
// Phase 11: File Tree API
// ============================================

/**
 * Build a hierarchical file tree from flat file list
 */
export function buildFileTree(files: ProjectFile[]): FileTreeNode[] {
  const rootChildren: FileTreeNode[] = [];
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));

  for (const file of sortedFiles) {
    const pathParts = file.name.split('/');
    const fileName = pathParts.pop()!;

    let parentChildren = rootChildren;
    let currentPath = '';

    for (const part of pathParts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      let dir = parentChildren.find((child) => child.name === part && child.type === 'directory');
      if (!dir) {
        dir = {
          id: `dir:${currentPath}`,
          name: part,
          path: currentPath,
          type: 'directory',
          children: [],
          expanded: false,
        };
        parentChildren.push(dir);
      }

      if (!dir.children) {
        dir.children = [];
      }
      parentChildren = dir.children;
    }

    parentChildren.push({
      id: file.id,
      name: fileName,
      path: file.name,
      type: 'file',
      fileType: file.type,
      size: file.size,
      status: file.status,
    });
  }

  const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    }).map((node) => {
      if (node.children) {
        node.children = sortNodes(node.children);
      }
      return node;
    });
  };

  return sortNodes(rootChildren);
}

/**
 * Count directories in tree
 */
function countDirectories(nodes: FileTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === 'directory') {
      count++;
      if (node.children) {
        count += countDirectories(node.children);
      }
    }
  }
  return count;
}

/**
 * Get hierarchical file tree for a project
 * Phase 11: Sidebar file tree API
 */
export async function getProjectFileTree(projectId: string): Promise<ProjectFileTree> {
  await ensureInitialized();
  
  const files = await get_project_files_metadata(projectId);
  const nodes = buildFileTree(files);
  
  return {
    projectId,
    nodes,
    totalFiles: files.length,
    totalDirectories: countDirectories(nodes),
  };
}

/**
 * Get flat list of files for autocomplete
 * Returns files sorted by name for easy filtering
 */
export async function getProjectFilesForAutocomplete(projectId: string): Promise<Array<{
  id: string;
  name: string;
  path: string;
  type: SupportedFileType;
}>> {
  await ensureInitialized();
  
  const files = await get_project_files(projectId);
  
  return files
    .map(f => ({
      id: f.id,
      name: f.name.split('/').pop() || f.name,
      path: f.name,
      type: f.type,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Find file by path or name
 * Used for resolving @file: references
 */
export async function findFileByPath(
  projectId: string,
  pathOrName: string
): Promise<ProjectFile | null> {
  await ensureInitialized();
  
  const files = await get_project_files(projectId);
  
  // Try exact path match first
  let file = files.find(f => f.name === pathOrName);
  if (file) return file;
  
  // Try matching just the filename
  file = files.find(f => {
    const fileName = f.name.split('/').pop();
    return fileName === pathOrName;
  });
  if (file) return file;
  
  // Try case-insensitive match
  const lowerPath = pathOrName.toLowerCase();
  file = files.find(f => f.name.toLowerCase() === lowerPath);
  if (file) return file;
  
  // Try case-insensitive filename match
  file = files.find(f => {
    const fileName = f.name.split('/').pop()?.toLowerCase();
    return fileName === lowerPath;
  });
  
  return file || null;
}

// ============================================
// Global/Cross-Project Functions
// ============================================

/**
 * Get flat list of files from ALL projects for autocomplete
 * Returns files sorted by project name, then file name
 * Each file includes the project name for disambiguation
 */
export async function getAllFilesForAutocomplete(): Promise<Array<{
  id: string;
  name: string;
  path: string;
  type: SupportedFileType;
  projectId: string;
  projectName: string;
}>> {
  await ensureInitialized();

  const conn = getConnection();
  const result = await conn.query(`
    SELECT f.id, f.name, f.type, f.project_id, p.name AS project_name
    FROM files f
    INNER JOIN projects p ON p.id = f.project_id
    ORDER BY p.name ASC, f.name ASC
  `);

  const allFiles = result.toArray().map((row: Record<string, unknown>) => {
    const path = row.name as string;
    return {
      id: row.id as string,
      name: path.split('/').pop() || path,
      path,
      type: row.type as SupportedFileType,
      projectId: row.project_id as string,
      projectName: row.project_name as string,
    };
  });

  return allFiles.sort((a, b) => {
    const projectCompare = a.projectName.localeCompare(b.projectName);
    if (projectCompare !== 0) return projectCompare;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Search across ALL projects
 * Returns results from all projects with project info
 */
export async function searchAllProjects(
  query: string,
  k: number = 5
): Promise<Array<SearchResult & { projectId: string; projectName: string }>> {
  await ensureInitialized();
  
  const projects = await dbGetAllProjects();
  const allResults: Array<SearchResult & { projectId: string; projectName: string }> = [];
  
  // Generate query embedding once
  const queryEmbedding = await generateEmbedding(query);
  
  for (const project of projects) {
    const results = await vector_search(project.id, queryEmbedding, k);
    
    for (const result of results) {
      allResults.push({
        ...result,
        projectId: project.id,
        projectName: project.name,
      });
    }
  }
  
  // Sort by score (highest first) and limit to k results
  return allResults
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * Find file by path or name across ALL projects
 * Used for resolving @file: references in global mode
 */
export async function findFileGlobal(
  pathOrName: string
): Promise<{ file: ProjectFile; projectId: string; projectName: string } | null> {
  await ensureInitialized();

  const projects = await dbGetAllProjects();

  for (const project of projects) {
    // Try the path as-is first
    let file = await findFileByPath(project.id, pathOrName);
    if (file) {
      return { file, projectId: project.id, projectName: project.name };
    }

    // In global mode, autocomplete produces "ProjectName/path/to/file.md"
    // Strip the project name prefix and try again
    const prefix = project.name + '/';
    if (pathOrName.startsWith(prefix)) {
      const stripped = pathOrName.substring(prefix.length);
      file = await findFileByPath(project.id, stripped);
      if (file) {
        return { file, projectId: project.id, projectName: project.name };
      }
    }

    // Also try case-insensitive prefix match
    if (pathOrName.toLowerCase().startsWith(prefix.toLowerCase())) {
      const stripped = pathOrName.substring(prefix.length);
      file = await findFileByPath(project.id, stripped);
      if (file) {
        return { file, projectId: project.id, projectName: project.name };
      }
    }
  }

  return null;
}

