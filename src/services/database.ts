/**
 * DuckDB WASM Database Service
 * Handles database initialization, schema creation, and core operations
 */

import * as duckdb from '@duckdb/duckdb-wasm';
import type { Project, ProjectFile, Chunk, Embedding } from '../types';

let db: duckdb.AsyncDuckDB | null = null;
let connection: duckdb.AsyncDuckDBConnection | null = null;

const OPFS_DB_PATH = 'opfs://hydranote.duckdb';

/**
 * Initialize DuckDB WASM with OPFS persistence
 */
export async function initializeDatabase(): Promise<void> {
  if (db) return;

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
 * Update file's project and/or name (for moving files)
 */
export async function updateFileProject(fileId: string, newProjectId: string, newName: string): Promise<void> {
  const conn = getConnection();
  const escapedName = newName.replace(/'/g, "''");
  
  // Update file's project_id and name
  await conn.query(`
    UPDATE files 
    SET project_id = '${newProjectId}', name = '${escapedName}', updated_at = CURRENT_TIMESTAMP 
    WHERE id = '${fileId}'
  `);
  
  // Update chunks' project_id
  await conn.query(`
    UPDATE chunks SET project_id = '${newProjectId}' WHERE file_id = '${fileId}'
  `);
  
  // Update embeddings' project_id
  await conn.query(`
    UPDATE embeddings SET project_id = '${newProjectId}' WHERE file_id = '${fileId}'
  `);
  
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

