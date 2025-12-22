/**
 * DuckDB WASM Database Service
 * Handles database initialization, schema creation, and core operations
 */

import * as duckdb from '@duckdb/duckdb-wasm';
import type { Project, ProjectFile, Chunk, Embedding } from '../types';

let db: duckdb.AsyncDuckDB | null = null;
let connection: duckdb.AsyncDuckDBConnection | null = null;

// Initialization lock to prevent concurrent initialization attempts
// This prevents OPFS "Access Handles cannot be created" errors
let initializationPromise: Promise<void> | null = null;

const OPFS_DB_PATH = 'opfs://hydranote.duckdb';

/**
 * Initialize DuckDB WASM with OPFS persistence
 * Uses a lock to prevent concurrent initialization attempts which would cause
 * OPFS access handle conflicts.
 */
export async function initializeDatabase(): Promise<void> {
  // Already initialized
  if (db && connection) return;

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization and store the promise
  initializationPromise = doInitializeDatabase();
  
  try {
    await initializationPromise;
  } catch (error) {
    // Reset on failure so it can be retried
    initializationPromise = null;
    throw error;
  }
}

/**
 * Internal initialization logic
 */
async function doInitializeDatabase(): Promise<void> {
  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();

  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

  const worker_url = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
  );

  const worker = new Worker(worker_url);
  const logger = new duckdb.ConsoleLogger();
  
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  
  // Open database with OPFS persistence
  await db.open({
    path: OPFS_DB_PATH,
    accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
  });
  
  connection = await db.connect();

  await createSchema();

  // Register beforeunload to flush database
  window.addEventListener('beforeunload', handleBeforeUnload);

  URL.revokeObjectURL(worker_url);
}

/**
 * Handle page unload - flush database to persist changes
 */
function handleBeforeUnload(): void {
  if (db) {
    db.flushFiles();
  }
}

/**
 * Create database schema for projects, files, chunks, and embeddings
 */
async function createSchema(): Promise<void> {
  if (!connection) throw new Error('Database not initialized');

  // Projects table
  await connection.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      description VARCHAR,
      status VARCHAR NOT NULL DEFAULT 'created',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Files table
  await connection.query(`
    CREATE TABLE IF NOT EXISTS files (
      id VARCHAR PRIMARY KEY,
      project_id VARCHAR NOT NULL,
      name VARCHAR NOT NULL,
      type VARCHAR NOT NULL,
      size INTEGER NOT NULL,
      status VARCHAR NOT NULL DEFAULT 'pending',
      content TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  // Chunks table
  await connection.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id VARCHAR PRIMARY KEY,
      file_id VARCHAR NOT NULL,
      project_id VARCHAR NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (file_id) REFERENCES files(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  // Embeddings table with vector storage
  await connection.query(`
    CREATE TABLE IF NOT EXISTS embeddings (
      id VARCHAR PRIMARY KEY,
      chunk_id VARCHAR NOT NULL,
      file_id VARCHAR NOT NULL,
      project_id VARCHAR NOT NULL,
      vector DOUBLE[] NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chunk_id) REFERENCES chunks(id),
      FOREIGN KEY (file_id) REFERENCES files(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  // Web search cache table
  await connection.query(`
    CREATE TABLE IF NOT EXISTS web_search_cache (
      id VARCHAR PRIMARY KEY,
      query_hash VARCHAR NOT NULL,
      query VARCHAR NOT NULL,
      url VARCHAR NOT NULL,
      title VARCHAR,
      raw_content TEXT,
      fetched_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Web search chunks with embeddings
  await connection.query(`
    CREATE TABLE IF NOT EXISTS web_search_chunks (
      id VARCHAR PRIMARY KEY,
      cache_id VARCHAR NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding DOUBLE[] NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cache_id) REFERENCES web_search_cache(id)
    )
  `);

  // Create indexes for web search cache
  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_web_cache_query_hash ON web_search_cache(query_hash)
  `);
  
  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_web_cache_fetched ON web_search_cache(fetched_at)
  `);

  // Chat sessions table
  await connection.query(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id VARCHAR PRIMARY KEY,
      project_id VARCHAR,
      title VARCHAR NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Chat messages table
  await connection.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id VARCHAR PRIMARY KEY,
      session_id VARCHAR NOT NULL,
      role VARCHAR NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
    )
  `);

  // Create indexes for chat sessions
  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(project_id)
  `);

  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)
  `);
}

/**
 * Get database connection
 */
export function getConnection(): duckdb.AsyncDuckDBConnection {
  if (!connection) throw new Error('Database not initialized');
  return connection;
}

/**
 * Get database instance
 */
export function getDatabase(): duckdb.AsyncDuckDB {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// ============================================
// Project Operations
// ============================================

export async function createProject(project: Project): Promise<void> {
  const conn = getConnection();
  const escapedName = project.name.replace(/'/g, "''");
  const escapedDesc = (project.description || '').replace(/'/g, "''");
  await conn.query(`
    INSERT INTO projects (id, name, description, status, created_at, updated_at)
    VALUES ('${project.id}', '${escapedName}', '${escapedDesc}', '${project.status}', '${project.createdAt.toISOString()}', '${project.updatedAt.toISOString()}')
  `);
  // Flush to persist immediately
  await flushDatabase();
}

export async function getProject(projectId: string): Promise<Project | null> {
  const conn = getConnection();
  const result = await conn.query(`SELECT * FROM projects WHERE id = '${projectId}'`);
  const rows = result.toArray();
  if (rows.length === 0) return null;
  
  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function updateProjectStatus(projectId: string, status: string): Promise<void> {
  const conn = getConnection();
  await conn.query(`
    UPDATE projects SET status = '${status}', updated_at = CURRENT_TIMESTAMP WHERE id = '${projectId}'
  `);
}

export async function getAllProjects(): Promise<Project[]> {
  const conn = getConnection();
  const result = await conn.query('SELECT * FROM projects ORDER BY created_at DESC');
  return result.toArray().map((row: Record<string, unknown>) => ({
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    status: row.status as Project['status'],
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }));
}

/**
 * Delete a project and cascade delete all files, chunks, and embeddings
 */
export async function deleteProject(projectId: string): Promise<void> {
  const conn = getConnection();
  
  // Delete embeddings for this project
  await conn.query(`DELETE FROM embeddings WHERE project_id = '${projectId}'`);
  
  // Delete chunks for this project
  await conn.query(`DELETE FROM chunks WHERE project_id = '${projectId}'`);
  
  // Delete files for this project
  await conn.query(`DELETE FROM files WHERE project_id = '${projectId}'`);
  
  // Delete the project
  await conn.query(`DELETE FROM projects WHERE id = '${projectId}'`);
  
  await flushDatabase();
}

// ============================================
// File Operations
// ============================================

export async function createFile(file: ProjectFile): Promise<void> {
  const conn = getConnection();
  const escapedContent = file.content ? file.content.replace(/'/g, "''") : '';
  await conn.query(`
    INSERT INTO files (id, project_id, name, type, size, status, content, created_at, updated_at)
    VALUES ('${file.id}', '${file.projectId}', '${file.name}', '${file.type}', ${file.size}, '${file.status}', '${escapedContent}', '${file.createdAt.toISOString()}', '${file.updatedAt.toISOString()}')
  `);
}

export async function getFile(fileId: string): Promise<ProjectFile | null> {
  const conn = getConnection();
  const result = await conn.query(`SELECT * FROM files WHERE id = '${fileId}'`);
  const rows = result.toArray();
  if (rows.length === 0) return null;
  
  const row = rows[0];
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    type: row.type,
    size: row.size,
    status: row.status,
    content: row.content,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function updateFileStatus(fileId: string, status: string): Promise<void> {
  const conn = getConnection();
  await conn.query(`
    UPDATE files SET status = '${status}', updated_at = CURRENT_TIMESTAMP WHERE id = '${fileId}'
  `);
}

export async function updateFileContent(fileId: string, content: string): Promise<void> {
  const conn = getConnection();
  const escapedContent = content.replace(/'/g, "''");
  await conn.query(`
    UPDATE files SET content = '${escapedContent}', updated_at = CURRENT_TIMESTAMP WHERE id = '${fileId}'
  `);
}

/**
 * Delete a file and cascade delete its chunks and embeddings
 */
export async function deleteFile(fileId: string): Promise<void> {
  const conn = getConnection();
  
  // Delete embeddings for this file
  await conn.query(`DELETE FROM embeddings WHERE file_id = '${fileId}'`);
  
  // Delete chunks for this file
  await conn.query(`DELETE FROM chunks WHERE file_id = '${fileId}'`);
  
  // Delete the file
  await conn.query(`DELETE FROM files WHERE id = '${fileId}'`);
  
  await flushDatabase();
}

/**
 * Update only the file name (for renaming within the same project)
 * This is simpler than updateFileProject since we don't need to update
 * the project_id in chunks and embeddings tables.
 */
export async function updateFileName(fileId: string, newName: string): Promise<void> {
  const conn = getConnection();
  const escapedName = newName.replace(/'/g, "''");
  await conn.query(`
    UPDATE files SET name = '${escapedName}', updated_at = CURRENT_TIMESTAMP 
    WHERE id = '${fileId}'
  `);
  await flushDatabase();
}

/**
 * Update file's project and/or name (for moving files)
 * 
 * Due to DuckDB's strict FK constraint enforcement during updates,
 * we delete and recreate the dependent records with the new project_id.
 */
export async function updateFileProject(fileId: string, newProjectId: string, newName: string): Promise<void> {
  const conn = getConnection();
  const escapedName = newName.replace(/'/g, "''");
  
  // Helper to convert DuckDB timestamp to ISO string
  const toISOString = (ts: unknown): string => {
    if (ts instanceof Date) return ts.toISOString();
    if (typeof ts === 'string') return ts;
    if (typeof ts === 'number' || typeof ts === 'bigint') {
      return new Date(Number(ts)).toISOString();
    }
    return new Date().toISOString();
  };
  
  // First, gather all existing chunks and embeddings data
  const chunksResult = await conn.query(`
    SELECT * FROM chunks WHERE file_id = '${fileId}'
  `);
  const chunks = chunksResult.toArray();
  
  const embeddingsResult = await conn.query(`
    SELECT * FROM embeddings WHERE file_id = '${fileId}'
  `);
  const embeddings = embeddingsResult.toArray();
  
  // Delete embeddings first (depends on chunks)
  await conn.query(`DELETE FROM embeddings WHERE file_id = '${fileId}'`);
  
  // Delete chunks (depends on files)
  await conn.query(`DELETE FROM chunks WHERE file_id = '${fileId}'`);
  
  // Update the file's project_id and name
  await conn.query(`
    UPDATE files 
    SET project_id = '${newProjectId}', name = '${escapedName}', updated_at = CURRENT_TIMESTAMP 
    WHERE id = '${fileId}'
  `);
  
  // Re-insert chunks with new project_id
  for (const chunk of chunks) {
    const escapedText = (chunk.text as string).replace(/'/g, "''");
    const createdAt = toISOString(chunk.created_at);
    await conn.query(`
      INSERT INTO chunks (id, file_id, project_id, chunk_index, text, start_offset, end_offset, created_at)
      VALUES ('${chunk.id}', '${chunk.file_id}', '${newProjectId}', ${chunk.chunk_index}, '${escapedText}', ${chunk.start_offset}, ${chunk.end_offset}, '${createdAt}')
    `);
  }
  
  // Re-insert embeddings with new project_id
  for (const embedding of embeddings) {
    // Convert vector to regular array (DuckDB may return typed arrays like Float64Array)
    const vectorArray = Array.from(embedding.vector as ArrayLike<number>);
    const vectorStr = `[${vectorArray.join(', ')}]`;
    const createdAt = toISOString(embedding.created_at);
    await conn.query(`
      INSERT INTO embeddings (id, chunk_id, file_id, project_id, vector, created_at)
      VALUES ('${embedding.id}', '${embedding.chunk_id}', '${embedding.file_id}', '${newProjectId}', ${vectorStr}::DOUBLE[], '${createdAt}')
    `);
  }
  
  await flushDatabase();
}

// ============================================
// Chunk Operations
// ============================================

export async function createChunk(chunk: Chunk): Promise<void> {
  const conn = getConnection();
  const escapedText = chunk.text.replace(/'/g, "''");
  await conn.query(`
    INSERT INTO chunks (id, file_id, project_id, chunk_index, text, start_offset, end_offset, created_at)
    VALUES ('${chunk.id}', '${chunk.fileId}', '${chunk.projectId}', ${chunk.index}, '${escapedText}', ${chunk.startOffset}, ${chunk.endOffset}, '${chunk.createdAt.toISOString()}')
  `);
}

export async function createChunks(chunks: Chunk[]): Promise<void> {
  for (const chunk of chunks) {
    await createChunk(chunk);
  }
}

export async function getChunk(chunkId: string): Promise<Chunk | null> {
  const conn = getConnection();
  const result = await conn.query(`SELECT * FROM chunks WHERE id = '${chunkId}'`);
  const rows = result.toArray();
  if (rows.length === 0) return null;
  
  const row = rows[0];
  return {
    id: row.id,
    fileId: row.file_id,
    projectId: row.project_id,
    index: row.chunk_index,
    text: row.text,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    createdAt: new Date(row.created_at),
  };
}

// ============================================
// Embedding Operations
// ============================================

export async function createEmbedding(embedding: Embedding): Promise<void> {
  const conn = getConnection();
  const vectorStr = `[${embedding.vector.join(', ')}]`;
  await conn.query(`
    INSERT INTO embeddings (id, chunk_id, file_id, project_id, vector, created_at)
    VALUES ('${embedding.id}', '${embedding.chunkId}', '${embedding.fileId}', '${embedding.projectId}', ${vectorStr}::DOUBLE[], '${embedding.createdAt.toISOString()}')
  `);
}

export async function createEmbeddings(embeddings: Embedding[]): Promise<void> {
  for (const embedding of embeddings) {
    await createEmbedding(embedding);
  }
}

/**
 * Compute cosine similarity between two vectors using DuckDB
 */
export async function vectorSearch(
  projectId: string,
  queryVector: number[],
  k: number = 5
): Promise<Array<{ chunkId: string; fileId: string; text: string; score: number }>> {
  const conn = getConnection();
  const queryVectorStr = `[${queryVector.join(', ')}]`;
  
  // Cosine similarity calculation using DuckDB
  const result = await conn.query(`
    WITH query AS (
      SELECT ${queryVectorStr}::DOUBLE[] as qvec
    )
    SELECT 
      e.chunk_id,
      e.file_id,
      c.text,
      (
        list_sum(list_transform(list_zip(e.vector, q.qvec), x -> x[1] * x[2])) /
        (sqrt(list_sum(list_transform(e.vector, x -> x * x))) * sqrt(list_sum(list_transform(q.qvec, x -> x * x))))
      ) as score
    FROM embeddings e
    CROSS JOIN query q
    JOIN chunks c ON c.id = e.chunk_id
    WHERE e.project_id = '${projectId}'
    ORDER BY score DESC
    LIMIT ${k}
  `);
  
  return result.toArray().map((row: Record<string, unknown>) => ({
    chunkId: row.chunk_id as string,
    fileId: row.file_id as string,
    text: row.text as string,
    score: row.score as number,
  }));
}

/**
 * Flush database to persist changes to OPFS
 * Uses CHECKPOINT to force WAL to be written to the database file
 */
export async function flushDatabase(): Promise<void> {
  if (connection) {
    // Force WAL checkpoint to persist all changes to the database file
    await connection.query('CHECKPOINT');
  }
  if (db) {
    await db.flushFiles();
  }
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  window.removeEventListener('beforeunload', handleBeforeUnload);
  
  if (db) {
    await db.flushFiles();
  }
  if (connection) {
    await connection.close();
    connection = null;
  }
  if (db) {
    await db.terminate();
    db = null;
  }
}

// ============================================
// Web Search Cache Operations
// ============================================

/**
 * Store a web search cache entry
 */
export async function createWebSearchCache(entry: {
  id: string;
  queryHash: string;
  query: string;
  url: string;
  title: string;
  rawContent: string;
  fetchedAt: Date;
}): Promise<void> {
  const conn = getConnection();
  const escapedQuery = entry.query.replace(/'/g, "''");
  const escapedUrl = entry.url.replace(/'/g, "''");
  const escapedTitle = (entry.title || '').replace(/'/g, "''");
  const escapedContent = entry.rawContent.replace(/'/g, "''");
  
  await conn.query(`
    INSERT INTO web_search_cache (id, query_hash, query, url, title, raw_content, fetched_at, created_at)
    VALUES ('${entry.id}', '${entry.queryHash}', '${escapedQuery}', '${escapedUrl}', '${escapedTitle}', '${escapedContent}', '${entry.fetchedAt.toISOString()}', CURRENT_TIMESTAMP)
  `);
}

/**
 * Store a web search chunk with embedding
 */
export async function createWebSearchChunk(chunk: {
  id: string;
  cacheId: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
}): Promise<void> {
  const conn = getConnection();
  const escapedText = chunk.text.replace(/'/g, "''");
  const vectorStr = `[${chunk.embedding.join(', ')}]`;
  
  await conn.query(`
    INSERT INTO web_search_chunks (id, cache_id, chunk_index, text, embedding, created_at)
    VALUES ('${chunk.id}', '${chunk.cacheId}', ${chunk.chunkIndex}, '${escapedText}', ${vectorStr}::DOUBLE[], CURRENT_TIMESTAMP)
  `);
}

/**
 * Get cached web search results by query hash within max age
 */
export async function getWebSearchCache(
  queryHash: string,
  maxAgeMinutes: number = 60
): Promise<Array<{
  id: string;
  query: string;
  url: string;
  title: string;
  rawContent: string;
  fetchedAt: Date;
}>> {
  const conn = getConnection();
  const minTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
  
  const result = await conn.query(`
    SELECT id, query, url, title, raw_content, fetched_at
    FROM web_search_cache
    WHERE query_hash = '${queryHash}'
      AND fetched_at >= '${minTime.toISOString()}'
    ORDER BY fetched_at DESC
  `);
  
  return result.toArray().map((row: Record<string, unknown>) => ({
    id: row.id as string,
    query: row.query as string,
    url: row.url as string,
    title: row.title as string,
    rawContent: row.raw_content as string,
    fetchedAt: new Date(row.fetched_at as string),
  }));
}

/**
 * Get web search chunks by cache IDs
 */
export async function getWebSearchChunks(
  cacheIds: string[]
): Promise<Array<{
  id: string;
  cacheId: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
}>> {
  if (cacheIds.length === 0) return [];
  
  const conn = getConnection();
  const idsStr = cacheIds.map(id => `'${id}'`).join(', ');
  
  const result = await conn.query(`
    SELECT id, cache_id, chunk_index, text, embedding
    FROM web_search_chunks
    WHERE cache_id IN (${idsStr})
    ORDER BY cache_id, chunk_index
  `);
  
  return result.toArray().map((row: Record<string, unknown>) => ({
    id: row.id as string,
    cacheId: row.cache_id as string,
    chunkIndex: row.chunk_index as number,
    text: row.text as string,
    embedding: row.embedding as number[],
  }));
}

/**
 * Vector search on web search chunks
 */
export async function webVectorSearch(
  queryVector: number[],
  cacheIds: string[],
  k: number = 10
): Promise<Array<{
  chunkId: string;
  cacheId: string;
  text: string;
  url: string;
  title: string;
  score: number;
}>> {
  if (cacheIds.length === 0) return [];
  
  const conn = getConnection();
  const queryVectorStr = `[${queryVector.join(', ')}]`;
  const idsStr = cacheIds.map(id => `'${id}'`).join(', ');
  
  const result = await conn.query(`
    WITH query AS (
      SELECT ${queryVectorStr}::DOUBLE[] as qvec
    )
    SELECT 
      wc.id as chunk_id,
      wc.cache_id,
      wc.text,
      wsc.url,
      wsc.title,
      (
        list_sum(list_transform(list_zip(wc.embedding, q.qvec), x -> x[1] * x[2])) /
        (sqrt(list_sum(list_transform(wc.embedding, x -> x * x))) * sqrt(list_sum(list_transform(q.qvec, x -> x * x))))
      ) as score
    FROM web_search_chunks wc
    CROSS JOIN query q
    JOIN web_search_cache wsc ON wsc.id = wc.cache_id
    WHERE wc.cache_id IN (${idsStr})
    ORDER BY score DESC
    LIMIT ${k}
  `);
  
  return result.toArray().map((row: Record<string, unknown>) => ({
    chunkId: row.chunk_id as string,
    cacheId: row.cache_id as string,
    text: row.text as string,
    url: row.url as string,
    title: row.title as string,
    score: row.score as number,
  }));
}

/**
 * Delete expired web search cache entries
 */
export async function cleanExpiredWebCache(maxAgeMinutes: number = 60): Promise<number> {
  const conn = getConnection();
  const minTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
  
  // Get expired cache IDs first
  const expiredResult = await conn.query(`
    SELECT id FROM web_search_cache
    WHERE fetched_at < '${minTime.toISOString()}'
  `);
  
  const expiredIds = expiredResult.toArray().map((row: Record<string, unknown>) => row.id as string);
  
  if (expiredIds.length === 0) return 0;
  
  const idsStr = expiredIds.map(id => `'${id}'`).join(', ');
  
  // Delete chunks first (foreign key)
  await conn.query(`DELETE FROM web_search_chunks WHERE cache_id IN (${idsStr})`);
  
  // Delete cache entries
  await conn.query(`DELETE FROM web_search_cache WHERE id IN (${idsStr})`);
  
  await flushDatabase();
  
  return expiredIds.length;
}

// ============================================
// Fuzzy Search Operations
// ============================================

export interface FuzzySearchResult {
  fileId: string;
  fileName: string;
  filePath: string;
  fileType: string;
  projectId: string;
  projectName: string;
  matchType: 'name' | 'content';
  matchScore: number;
  matchSnippet?: string;
}

/**
 * Fuzzy search across all files in all projects
 * Searches both file names and content using Jaro-Winkler similarity and ILIKE
 */
export async function fuzzySearchFiles(
  query: string,
  limit: number = 10
): Promise<FuzzySearchResult[]> {
  if (!query || query.trim().length === 0) return [];
  
  const conn = getConnection();
  const escapedQuery = query.replace(/'/g, "''").toLowerCase();
  const likePattern = `%${escapedQuery}%`;
  
  // Search file names with Jaro-Winkler similarity + ILIKE fallback
  // Also search content with ILIKE
  const result = await conn.query(`
    WITH name_matches AS (
      SELECT 
        f.id as file_id,
        f.name as file_name,
        f.name as file_path,
        f.type as file_type,
        f.project_id,
        p.name as project_name,
        'name' as match_type,
        GREATEST(
          jaro_winkler_similarity(LOWER(f.name), '${escapedQuery}'),
          CASE WHEN LOWER(f.name) LIKE '${likePattern}' THEN 0.7 ELSE 0 END
        ) as match_score,
        NULL as match_snippet
      FROM files f
      JOIN projects p ON p.id = f.project_id
      WHERE LOWER(f.name) LIKE '${likePattern}'
         OR jaro_winkler_similarity(LOWER(f.name), '${escapedQuery}') > 0.6
    ),
    content_matches AS (
      SELECT 
        f.id as file_id,
        f.name as file_name,
        f.name as file_path,
        f.type as file_type,
        f.project_id,
        p.name as project_name,
        'content' as match_type,
        0.5 as match_score,
        SUBSTRING(f.content, 
          GREATEST(1, POSITION('${escapedQuery}' IN LOWER(f.content)) - 30),
          100
        ) as match_snippet
      FROM files f
      JOIN projects p ON p.id = f.project_id
      WHERE f.content IS NOT NULL 
        AND LOWER(f.content) LIKE '${likePattern}'
        AND f.id NOT IN (SELECT file_id FROM name_matches)
    ),
    all_matches AS (
      SELECT * FROM name_matches
      UNION ALL
      SELECT * FROM content_matches
    )
    SELECT DISTINCT ON (file_id)
      file_id,
      file_name,
      file_path,
      file_type,
      project_id,
      project_name,
      match_type,
      match_score,
      match_snippet
    FROM all_matches
    ORDER BY file_id, match_score DESC, match_type ASC
    LIMIT ${limit * 2}
  `);
  
  const rows = result.toArray();
  
  // Map and sort by score
  const results: FuzzySearchResult[] = rows.map((row: Record<string, unknown>) => ({
    fileId: row.file_id as string,
    fileName: row.file_name as string,
    filePath: row.file_path as string,
    fileType: row.file_type as string,
    projectId: row.project_id as string,
    projectName: row.project_name as string,
    matchType: row.match_type as 'name' | 'content',
    matchScore: row.match_score as number,
    matchSnippet: row.match_snippet as string | undefined,
  }));
  
  // Sort by score descending and limit
  return results
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
}

// ============================================
// Chat Session Operations
// ============================================

export interface DBChatSession {
  id: string;
  projectId: string | null;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DBChatMessage {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

/**
 * Create a new chat session
 */
export async function createChatSession(session: DBChatSession): Promise<void> {
  const conn = getConnection();
  const escapedTitle = session.title.replace(/'/g, "''");
  const projectIdValue = session.projectId ? `'${session.projectId}'` : 'NULL';
  
  await conn.query(`
    INSERT INTO chat_sessions (id, project_id, title, created_at, updated_at)
    VALUES ('${session.id}', ${projectIdValue}, '${escapedTitle}', '${session.createdAt.toISOString()}', '${session.updatedAt.toISOString()}')
  `);
  await flushDatabase();
}

/**
 * Get a chat session by ID
 */
export async function getChatSession(sessionId: string): Promise<DBChatSession | null> {
  const conn = getConnection();
  const result = await conn.query(`SELECT * FROM chat_sessions WHERE id = '${sessionId}'`);
  const rows = result.toArray();
  if (rows.length === 0) return null;
  
  const row = rows[0];
  return {
    id: row.id as string,
    projectId: row.project_id as string | null,
    title: row.title as string,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/**
 * Get all chat sessions for a project (or global sessions if projectId is null)
 */
export async function getChatSessionsByProject(projectId: string | null, limit: number = 20): Promise<DBChatSession[]> {
  const conn = getConnection();
  const whereClause = projectId 
    ? `WHERE project_id = '${projectId}'` 
    : `WHERE project_id IS NULL`;
  
  const result = await conn.query(`
    SELECT * FROM chat_sessions 
    ${whereClause}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `);
  
  return result.toArray().map((row: Record<string, unknown>) => ({
    id: row.id as string,
    projectId: row.project_id as string | null,
    title: row.title as string,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }));
}

/**
 * Update chat session title and updated_at timestamp
 */
export async function updateChatSession(sessionId: string, title: string): Promise<void> {
  const conn = getConnection();
  const escapedTitle = title.replace(/'/g, "''");
  await conn.query(`
    UPDATE chat_sessions 
    SET title = '${escapedTitle}', updated_at = CURRENT_TIMESTAMP 
    WHERE id = '${sessionId}'
  `);
  await flushDatabase();
}

/**
 * Update chat session updated_at timestamp
 */
export async function touchChatSession(sessionId: string): Promise<void> {
  const conn = getConnection();
  await conn.query(`
    UPDATE chat_sessions 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE id = '${sessionId}'
  `);
  await flushDatabase();
}

/**
 * Delete a chat session and all its messages
 */
export async function deleteChatSession(sessionId: string): Promise<void> {
  const conn = getConnection();
  
  // Delete messages first (foreign key)
  await conn.query(`DELETE FROM chat_messages WHERE session_id = '${sessionId}'`);
  
  // Delete the session
  await conn.query(`DELETE FROM chat_sessions WHERE id = '${sessionId}'`);
  
  await flushDatabase();
}

/**
 * Delete oldest chat sessions for a project, keeping only the most recent N sessions
 */
export async function pruneOldChatSessions(projectId: string | null, keepCount: number = 20): Promise<number> {
  const conn = getConnection();
  const whereClause = projectId 
    ? `WHERE project_id = '${projectId}'` 
    : `WHERE project_id IS NULL`;
  
  // Get sessions to delete (older than the keepCount most recent)
  const result = await conn.query(`
    SELECT id FROM chat_sessions
    ${whereClause}
    ORDER BY updated_at DESC
    OFFSET ${keepCount}
  `);
  
  const sessionsToDelete = result.toArray().map((row: Record<string, unknown>) => row.id as string);
  
  if (sessionsToDelete.length === 0) return 0;
  
  const idsStr = sessionsToDelete.map(id => `'${id}'`).join(', ');
  
  // Delete messages first
  await conn.query(`DELETE FROM chat_messages WHERE session_id IN (${idsStr})`);
  
  // Delete sessions
  await conn.query(`DELETE FROM chat_sessions WHERE id IN (${idsStr})`);
  
  await flushDatabase();
  
  return sessionsToDelete.length;
}

// ============================================
// Chat Message Operations
// ============================================

/**
 * Create a new chat message
 */
export async function createChatMessage(message: DBChatMessage): Promise<void> {
  const conn = getConnection();
  const escapedContent = message.content.replace(/'/g, "''");
  
  await conn.query(`
    INSERT INTO chat_messages (id, session_id, role, content, created_at)
    VALUES ('${message.id}', '${message.sessionId}', '${message.role}', '${escapedContent}', '${message.createdAt.toISOString()}')
  `);
  await flushDatabase();
}

/**
 * Get all messages for a chat session
 */
export async function getChatMessages(sessionId: string): Promise<DBChatMessage[]> {
  const conn = getConnection();
  
  const result = await conn.query(`
    SELECT * FROM chat_messages 
    WHERE session_id = '${sessionId}'
    ORDER BY created_at ASC
  `);
  
  return result.toArray().map((row: Record<string, unknown>) => ({
    id: row.id as string,
    sessionId: row.session_id as string,
    role: row.role as 'system' | 'user' | 'assistant',
    content: row.content as string,
    createdAt: new Date(row.created_at as string),
  }));
}

/**
 * Delete all messages for a session
 */
export async function deleteChatMessages(sessionId: string): Promise<void> {
  const conn = getConnection();
  await conn.query(`DELETE FROM chat_messages WHERE session_id = '${sessionId}'`);
  await flushDatabase();
}

