/**
 * Project Service
 * Main API for managing projects and document ingestion
 * Provides helper functions as specified in the roadmap
 */

import type { Project, ProjectFile, Chunk, Embedding, ChunkingConfig, SearchResult } from '../types';
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
  createChunks as dbCreateChunks,
  createEmbeddings as dbCreateEmbeddings,
  vectorSearch as dbVectorSearch,
  getConnection,
} from './database';
import { processDocument, isFileTypeSupported } from './documentProcessor';
import { generateEmbeddingsForChunks, generateEmbedding } from './embeddingService';

let initialized = false;

/**
 * Initialize the project service
 */
export async function initialize(): Promise<void> {
  if (initialized) return;
  await initializeDatabase();
  initialized = true;
}

/**
 * Ensure service is initialized
 */
async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    await initialize();
  }
}

// ============================================
// Project Management
// ============================================

/**
 * Create a new project
 */
export async function createProject(name: string, description?: string): Promise<Project> {
  await ensureInitialized();
  
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    description,
    status: 'created',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  await dbCreateProject(project);
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

// ============================================
// Document Ingestion
// ============================================

/**
 * Ingest a document into a project
 * Extracts text, creates chunks, and generates embeddings
 */
export async function ingestDocument(
  file: File,
  projectId: string,
  chunkingConfig?: ChunkingConfig
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
  
  // Create file record
  const projectFile: ProjectFile = {
    id: crypto.randomUUID(),
    projectId,
    name: file.name,
    type: file.name.split('.').pop()?.toLowerCase() as ProjectFile['type'],
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
    
    return projectFile;
  } catch (error) {
    await updateFileStatus(projectFile.id, 'error');
    await updateProjectStatus(projectId, 'error');
    throw error;
  }
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
  
  return result.toArray().map((row: Record<string, unknown>) => ({
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
    type: row.type as ProjectFile['type'],
    size: row.size as number,
    status: row.status as ProjectFile['status'],
    content: row.content as string | undefined,
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
// File Operations
// ============================================

/**
 * Get a file by ID
 */
export async function getFile(fileId: string): Promise<ProjectFile | null> {
  await ensureInitialized();
  return dbGetFile(fileId);
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


