/**
 * Project Service
 * Main API for managing projects and document ingestion
 * Provides helper functions as specified in the roadmap
 */

import type { Project, ProjectFile, Chunk, Embedding, ChunkingConfig, SearchResult, SupportedFileType, FileTreeNode, ProjectFileTree } from '../types';
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

// ============================================
// Phase 11: File Tree API
// ============================================

/**
 * Build a hierarchical file tree from flat file list
 */
function buildFileTree(files: ProjectFile[]): FileTreeNode[] {
  const root: Map<string, FileTreeNode> = new Map();
  
  // Sort files by path for consistent ordering
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));
  
  for (const file of sortedFiles) {
    const pathParts = file.name.split('/');
    const fileName = pathParts.pop()!;
    
    // Build directory structure
    let currentLevel = root;
    let currentPath = '';
    
    for (const part of pathParts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      
      if (!currentLevel.has(part)) {
        const dirNode: FileTreeNode = {
          id: `dir:${currentPath}`,
          name: part,
          path: currentPath,
          type: 'directory',
          children: [],
          expanded: false,
        };
        currentLevel.set(part, dirNode);
      }
      
      const dirNode = currentLevel.get(part)!;
      if (!dirNode.children) {
        dirNode.children = [];
      }
      
      // Convert children array to a map for easier lookup
      const childMap = new Map<string, FileTreeNode>();
      for (const child of dirNode.children) {
        childMap.set(child.name, child);
      }
      currentLevel = childMap;
      
      // Update the parent's children with the map values
      dirNode.children = Array.from(childMap.values());
    }
    
    // Add the file node
    const fileNode: FileTreeNode = {
      id: file.id,
      name: fileName,
      path: file.name,
      type: 'file',
      fileType: file.type,
      size: file.size,
      status: file.status,
    };
    
    if (pathParts.length === 0) {
      // File at root level
      root.set(fileName, fileNode);
    } else {
      // File inside a directory - find the parent
      let parent = root.get(pathParts[0])!;
      for (let i = 1; i < pathParts.length; i++) {
        const child = parent.children?.find(c => c.name === pathParts[i]);
        if (child) {
          parent = child;
        }
      }
      if (parent.children) {
        parent.children.push(fileNode);
      }
    }
  }
  
  // Convert root map to array and sort (directories first, then files)
  const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    }).map(node => {
      if (node.children) {
        node.children = sortNodes(node.children);
      }
      return node;
    });
  };
  
  return sortNodes(Array.from(root.values()));
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
  
  const files = await get_project_files(projectId);
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

