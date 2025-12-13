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
  deleteProject as dbDeleteProject,
  deleteFile as dbDeleteFile,
  updateFileProject as dbUpdateFileProject,
  flushDatabase,
} from './database';
import { processDocument, isFileTypeSupported } from './documentProcessor';
import { generateEmbeddingsForChunks, generateEmbedding } from './embeddingService';
import {
  syncFileToFileSystem,
  syncFileDelete,
  syncProjectCreate,
  syncProjectDelete,
} from './syncService';

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
// File Operations (Centralized - Single Source of Truth)
// ============================================

/**
 * Get a file by ID
 */
export async function getFile(fileId: string): Promise<ProjectFile | null> {
  await ensureInitialized();
  return dbGetFile(fileId);
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
 * 
 * Does NOT handle indexing (chunks/embeddings) - use indexFileForSearch() after creation if needed.
 */
export async function createFile(
  projectId: string,
  filePath: string,
  content: string,
  fileType: 'md' | 'txt' | 'pdf' | 'docx' = 'md'
): Promise<ProjectFile> {
  await ensureInitialized();
  
  // Validate project exists
  const project = await dbGetProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  
  const now = new Date();
  const fileId = crypto.randomUUID();
  const size = new Blob([content]).size;
  
  // Create file record
  const projectFile: ProjectFile = {
    id: fileId,
    projectId,
    name: filePath,
    type: fileType,
    size,
    status: 'indexed',
    content,
    createdAt: now,
    updatedAt: now,
  };
  
  await dbCreateFile(projectFile);
  await flushDatabase();
  
  // Sync to file system (for text-based files)
  if (fileType === 'md' || fileType === 'txt') {
    await syncFileToFileSystem(project.name, filePath, content);
  }
  
  return projectFile;
}

/**
 * Index a file for semantic search (create chunks and embeddings)
 * Call this after createFile() if the file should be searchable.
 */
export async function indexFileForSearch(
  projectId: string,
  fileId: string,
  content: string,
  fileType: 'md' | 'txt' = 'md'
): Promise<void> {
  await ensureInitialized();
  
  const { chunkText, chunkMarkdownText } = await import('./documentProcessor');
  const { generateEmbeddingsForChunks } = await import('./embeddingService');
  const conn = getConnection();
  
  // Chunk the content based on file type
  const chunks = fileType === 'md'
    ? chunkMarkdownText(content, fileId, projectId)
    : chunkText(content, fileId, projectId);
  
  // Store chunks
  for (const chunk of chunks) {
    const escapedText = chunk.text.replace(/'/g, "''");
    await conn.query(`
      INSERT INTO chunks (id, file_id, project_id, chunk_index, text, start_offset, end_offset, created_at)
      VALUES ('${chunk.id}', '${chunk.fileId}', '${chunk.projectId}', ${chunk.index}, '${escapedText}', ${chunk.startOffset}, ${chunk.endOffset}, '${chunk.createdAt.toISOString()}')
    `);
  }
  
  // Generate and store embeddings
  try {
    const embeddings = await generateEmbeddingsForChunks(chunks);
    for (const embedding of embeddings) {
      const vectorStr = `[${embedding.vector.join(', ')}]`;
      await conn.query(`
        INSERT INTO embeddings (id, chunk_id, file_id, project_id, vector, created_at)
        VALUES ('${embedding.id}', '${embedding.chunkId}', '${embedding.fileId}', '${embedding.projectId}', ${vectorStr}::DOUBLE[], '${embedding.createdAt.toISOString()}')
      `);
    }
  } catch (error) {
    console.warn('Failed to generate embeddings for file:', fileId, error);
  }
  
  await flushDatabase();
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

/**
 * Update file content and sync to file system
 */
export async function updateFile(fileId: string, content: string): Promise<ProjectFile | null> {
  await ensureInitialized();
  
  // Get file info for sync
  const file = await dbGetFile(fileId);
  if (!file) {
    return null;
  }
  
  // Get project name for file system sync
  const project = await dbGetProject(file.projectId);
  
  // Update content in database
  await updateFileContent(fileId, content);
  await flushDatabase();
  
  // Sync to file system
  if (project && file.type === 'md') {
    await syncFileToFileSystem(project.name, file.name, content);
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
  await ensureInitialized();
  
  // Validate project exists
  const project = await dbGetProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  
  // Ensure filename has .md extension
  const name = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
  
  // Build full path
  const fullPath = directory ? `${directory}/${name}` : name;
  
  // Create empty markdown content
  const content = `# ${fileName.replace(/\.md$/, '')}\n\n`;
  
  // Create file record
  const projectFile: ProjectFile = {
    id: crypto.randomUUID(),
    projectId,
    name: fullPath,
    type: 'md',
    size: content.length,
    status: 'indexed',
    content,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  await dbCreateFile(projectFile);
  await flushDatabase();
  
  // Sync to file system
  await syncFileToFileSystem(project.name, fullPath, content);
  
  return projectFile;
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
  
  const projects = await dbGetAllProjects();
  const allFiles: Array<{
    id: string;
    name: string;
    path: string;
    type: SupportedFileType;
    projectId: string;
    projectName: string;
  }> = [];
  
  for (const project of projects) {
    const files = await get_project_files(project.id);
    
    for (const f of files) {
      allFiles.push({
        id: f.id,
        name: f.name.split('/').pop() || f.name,
        path: f.name,
        type: f.type,
        projectId: project.id,
        projectName: project.name,
      });
    }
  }
  
  // Sort by project name, then file name
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
    const file = await findFileByPath(project.id, pathOrName);
    if (file) {
      return {
        file,
        projectId: project.id,
        projectName: project.name,
      };
    }
  }
  
  return null;
}

