/**
 * DuckDB WASM Database Service
 * Handles database initialization, schema creation, and core operations
 */

import * as duckdb from '@duckdb/duckdb-wasm';
import type { Project, ProjectFile, Chunk, Embedding } from '../types';

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

let db: duckdb.AsyncDuckDB | null = null;
let connection: duckdb.AsyncDuckDBConnection | null = null;

// Initialization lock to prevent concurrent initialization attempts
// This prevents OPFS "Access Handles cannot be created" errors
let initializationPromise: Promise<void> | null = null;

const OPFS_DB_PATH = 'opfs://hydranote.duckdb';
/**
 * OPFS sidecar files that DuckDB may write alongside the data file. We try to
 * delete each one during WAL-replay recovery; missing entries are ignored. The
 * `.wal-shm` companion is defensive — current duckdb-wasm builds don't write
 * it, but older / future variants may, and removing it is harmless when it
 * doesn't exist.
 */
const OPFS_WAL_FILENAMES = ['hydranote.duckdb.wal', 'hydranote.duckdb.wal-shm'];

/**
 * Detects the specific DuckDB WASM error raised when the WAL file references
 * a catalog the data file no longer has. This happens after an unclean
 * shutdown (page closed mid-write, OS sleep killed the worker, crashed
 * migration) — the on-disk `.duckdb` file is fine, but the orphan `.wal`
 * cannot be replayed because it points at a catalog name that doesn't exist.
 *
 * Exported for testing.
 */
export function isWalReplayError(err: unknown): boolean {
  const message = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : '';
  if (!message) return false;
  // The canonical signature DuckDB uses for replay failures — present even
  // when the inner exception JSON varies across versions.
  if (message.includes('Failure while replaying WAL')) return true;
  // Defensive fallback: a Binder error whose message mentions a missing
  // catalog and references the WAL file is the same class of failure.
  return (
    message.includes('"exception_type":"Binder"') &&
    message.includes('does not exist') &&
    message.includes('.wal')
  );
}

/**
 * Detects DuckDB constraint / foreign-key violations surfaced during writes.
 * Exported for testing.
 */
export function isConstraintError(err: unknown): boolean {
  const message = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : '';
  if (!message) return false;
  const lower = message.toLowerCase();
  if (lower.includes('foreign key')) return true;
  if (lower.includes('constraint error')) return true;
  if (lower.includes('violates foreign key')) return true;
  if (
    message.includes('"exception_type":"Constraint"') ||
    message.includes('"exception_type":"Integrity"')
  ) {
    return true;
  }
  return false;
}

/**
 * User-facing database error text for file-tree and chat UI alerts.
 */
export function formatDatabaseErrorMessage(error: unknown, action: string): string {
  if (isConstraintError(error)) {
    return `Failed to ${action}. The library was repaired — please try again.`;
  }
  return `Failed to ${action}: ${error instanceof Error ? error.message : 'Unknown error'}`;
}

const ORPHAN_HEAL_MIGRATION_KEY = 'hydranote.migration.orphanHeal.v2';

interface TableRebuildSpec {
  tableName: string;
  tempTableName: string;
  createDdl: string;
  expectedColumns: string[];
  indexDdls: string[];
}

/** Tables that historically carried FOREIGN KEY clauses (pre-79b91d3). Rebuild deepest-first. */
const FK_STRIP_TABLE_SPECS: TableRebuildSpec[] = [
  {
    tableName: 'embeddings',
    tempTableName: 'embeddings__fkfree',
    createDdl: `
      CREATE TABLE embeddings__fkfree (
        id VARCHAR PRIMARY KEY,
        chunk_id VARCHAR NOT NULL,
        file_id VARCHAR NOT NULL,
        project_id VARCHAR NOT NULL,
        vector DOUBLE[] NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
    expectedColumns: ['id', 'chunk_id', 'file_id', 'project_id', 'vector', 'created_at'],
    indexDdls: [],
  },
  {
    tableName: 'chunks',
    tempTableName: 'chunks__fkfree',
    createDdl: `
      CREATE TABLE chunks__fkfree (
        id VARCHAR PRIMARY KEY,
        file_id VARCHAR NOT NULL,
        project_id VARCHAR NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        page_number INTEGER,
        section VARCHAR,
        kind VARCHAR DEFAULT 'text',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
    expectedColumns: [
      'id', 'file_id', 'project_id', 'chunk_index', 'text',
      'start_offset', 'end_offset', 'page_number', 'section', 'kind', 'created_at',
    ],
    indexDdls: ['CREATE INDEX IF NOT EXISTS idx_chunks_file_page ON chunks(file_id, page_number)'],
  },
  {
    tableName: 'file_versions',
    tempTableName: 'file_versions__fkfree',
    createDdl: `
      CREATE TABLE file_versions__fkfree (
        id VARCHAR PRIMARY KEY,
        file_id VARCHAR NOT NULL,
        version_number INTEGER NOT NULL,
        is_full_content BOOLEAN NOT NULL,
        content_or_patch TEXT NOT NULL,
        source VARCHAR NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
    expectedColumns: [
      'id', 'file_id', 'version_number', 'is_full_content',
      'content_or_patch', 'source', 'created_at',
    ],
    indexDdls: [
      'CREATE INDEX IF NOT EXISTS idx_file_versions_file_id ON file_versions(file_id)',
      'CREATE INDEX IF NOT EXISTS idx_file_versions_version ON file_versions(file_id, version_number)',
    ],
  },
  {
    tableName: 'chat_messages',
    tempTableName: 'chat_messages__fkfree',
    createDdl: `
      CREATE TABLE chat_messages__fkfree (
        id VARCHAR PRIMARY KEY,
        session_id VARCHAR NOT NULL,
        role VARCHAR NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        attachments TEXT
      )
    `,
    expectedColumns: ['id', 'session_id', 'role', 'content', 'created_at', 'attachments'],
    indexDdls: ['CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)'],
  },
  {
    tableName: 'web_search_chunks',
    tempTableName: 'web_search_chunks__fkfree',
    createDdl: `
      CREATE TABLE web_search_chunks__fkfree (
        id VARCHAR PRIMARY KEY,
        cache_id VARCHAR NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding DOUBLE[] NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
    expectedColumns: ['id', 'cache_id', 'chunk_index', 'text', 'embedding', 'created_at'],
    indexDdls: [],
  },
  {
    tableName: 'files',
    tempTableName: 'files__fkfree',
    createDdl: `
      CREATE TABLE files__fkfree (
        id VARCHAR PRIMARY KEY,
        project_id VARCHAR NOT NULL,
        name VARCHAR NOT NULL,
        type VARCHAR NOT NULL,
        size INTEGER NOT NULL,
        status VARCHAR NOT NULL DEFAULT 'pending',
        content TEXT,
        binary_data BLOB,
        html_content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        binary_data_base64 TEXT,
        system_file_path TEXT,
        content_hash VARCHAR
      )
    `,
    expectedColumns: [
      'id', 'project_id', 'name', 'type', 'size', 'status', 'content',
      'binary_data', 'html_content', 'created_at', 'updated_at',
      'binary_data_base64', 'system_file_path', 'content_hash',
    ],
    indexDdls: [],
  },
];

/** SQL statements used by healOrphanRows — exported for unit tests. */
export const ORPHAN_HEAL_STATEMENTS: string[] = [
  `DELETE FROM files
    WHERE project_id NOT IN (SELECT id FROM projects)`,
  `DELETE FROM embeddings
    WHERE chunk_id NOT IN (SELECT id FROM chunks)
       OR file_id NOT IN (SELECT id FROM files)
       OR project_id NOT IN (SELECT id FROM projects)`,
  `DELETE FROM chunks
    WHERE file_id NOT IN (SELECT id FROM files)
       OR project_id NOT IN (SELECT id FROM projects)`,
  `DELETE FROM file_versions
    WHERE file_id NOT IN (SELECT id FROM files)`,
  `DELETE FROM chat_messages
    WHERE session_id NOT IN (SELECT id FROM chat_sessions)`,
  `DELETE FROM web_search_chunks
    WHERE cache_id NOT IN (SELECT id FROM web_search_cache)`,
  `UPDATE chat_sessions
    SET project_id = NULL
    WHERE project_id IS NOT NULL
      AND project_id NOT IN (SELECT id FROM projects)`,
];

async function getTableColumns(
  conn: duckdb.AsyncDuckDBConnection,
  tableName: string,
): Promise<string[]> {
  const result = await conn.query(`DESCRIBE ${tableName}`);
  return result.toArray().map((row: Record<string, unknown>) => row.column_name as string);
}

/**
 * Returns true when the database still has FOREIGN KEY constraints from
 * pre-79b91d3 schemas (CREATE TABLE IF NOT EXISTS does not remove them).
 * Exported for testing.
 */
export async function hasForeignKeyConstraints(
  conn: duckdb.AsyncDuckDBConnection,
): Promise<boolean> {
  try {
    const result = await conn.query(`
      SELECT COUNT(*)::INTEGER AS cnt
      FROM duckdb_constraints()
      WHERE constraint_type = 'FOREIGN KEY'
    `);
    const row = result.toArray()[0] as Record<string, unknown> | undefined;
    return Number(row?.cnt ?? 0) > 0;
  } catch {
    return false;
  }
}

async function rebuildTableWithoutForeignKeys(
  conn: duckdb.AsyncDuckDBConnection,
  spec: TableRebuildSpec,
): Promise<void> {
  const existingColumns = await getTableColumns(conn, spec.tableName);
  const columnsToCopy = spec.expectedColumns.filter((col) => existingColumns.includes(col));
  if (columnsToCopy.length === 0) return;

  const columnList = columnsToCopy.join(', ');
  const oldTableName = `${spec.tableName}__old`;

  await conn.query(`DROP TABLE IF EXISTS ${spec.tempTableName}`);
  await conn.query(`DROP TABLE IF EXISTS ${oldTableName}`);

  await runInTransaction(conn, [
    spec.createDdl,
    `INSERT INTO ${spec.tempTableName} (${columnList}) SELECT ${columnList} FROM ${spec.tableName}`,
    `ALTER TABLE ${spec.tableName} RENAME TO ${oldTableName}`,
    `ALTER TABLE ${spec.tempTableName} RENAME TO ${spec.tableName}`,
    `DROP TABLE ${oldTableName}`,
  ]);

  for (const indexDdl of spec.indexDdls) {
    await conn.query(indexDdl);
  }
}

/**
 * Rebuild tables that still carry legacy FOREIGN KEY constraints.
 * Exported for testing.
 */
export async function stripForeignKeyConstraints(
  conn: duckdb.AsyncDuckDBConnection,
): Promise<boolean> {
  if (!(await hasForeignKeyConstraints(conn))) {
    return false;
  }

  for (const spec of FK_STRIP_TABLE_SPECS) {
    await rebuildTableWithoutForeignKeys(conn, spec);
  }

  if (await hasForeignKeyConstraints(conn)) {
    throw new Error('Foreign key strip migration incomplete — constraints remain');
  }

  return true;
}

/**
 * Remove orphaned child rows and detach chat sessions from deleted projects.
 * Exported for testing.
 */
export async function healOrphanRows(
  conn: duckdb.AsyncDuckDBConnection,
): Promise<void> {
  for (const statement of ORPHAN_HEAL_STATEMENTS) {
    await conn.query(statement);
  }
}

async function runInTransaction(
  conn: duckdb.AsyncDuckDBConnection,
  statements: string[],
): Promise<void> {
  await conn.query('BEGIN TRANSACTION');
  try {
    for (const statement of statements) {
      await conn.query(statement);
    }
    await conn.query('COMMIT');
  } catch (error) {
    try {
      await conn.query('ROLLBACK');
    } catch {
      // Rollback may fail if the transaction was already aborted.
    }
    throw error;
  }
}

async function withConstraintRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isConstraintError(error)) {
      throw error;
    }
    console.warn('[HydraNote] Constraint error — healing orphans and retrying once:', error);
    await healOrphanRows(getConnection());
    return operation();
  }
}

async function runSchemaIntegrityMigrations(): Promise<void> {
  if (!connection) return;

  try {
    const stripped = await stripForeignKeyConstraints(connection);
    if (stripped) {
      console.info('[HydraNote] Removed legacy foreign key constraints from database schema');
      await flushDatabase();
    }
  } catch (error) {
    console.warn('[HydraNote] FK strip migration failed (database remains usable):', error);
  }

  const shouldHeal =
    typeof localStorage === 'undefined' ||
    !localStorage.getItem(ORPHAN_HEAL_MIGRATION_KEY);

  if (!shouldHeal) return;

  try {
    await healOrphanRows(connection);
    await flushDatabase();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ORPHAN_HEAL_MIGRATION_KEY, 'done');
    }
  } catch (error) {
    console.warn('[HydraNote] Orphan heal failed:', error);
  }
}

/**
 * Best-effort deletion of the orphaned WAL sidecar file(s) from the origin
 * private file system. Returns `true` if at least one entry was successfully
 * removed; `false` if OPFS is unavailable, none of the files existed, or every
 * removal raised (typically because the file is still locked by a worker).
 *
 * Note: WAL removal MUST happen after the duckdb worker that failed to open
 * has been terminated — otherwise the worker still holds an OPFS access
 * handle and `removeEntry` will throw `NoModificationAllowedError`.
 *
 * Exported for testing.
 */
export async function clearOrphanWal(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return false;
  }
  let root: FileSystemDirectoryHandle;
  try {
    root = await navigator.storage.getDirectory();
  } catch {
    return false;
  }
  let removedAny = false;
  for (const name of OPFS_WAL_FILENAMES) {
    try {
      await root.removeEntry(name);
      removedAny = true;
    } catch {
      // Either the entry doesn't exist (NotFoundError) or it's locked. Move
      // on — partial success is still useful, and a fully missing WAL means
      // we have nothing to clean up anyway.
    }
  }
  return removedAny;
}

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
 * Internal initialization logic.
 *
 * If the first connection attempt fails with the WAL-replay signature
 * (`isWalReplayError`) we run a full recovery cycle:
 *
 *   1. Tear down the failed worker so it releases its OPFS access handles —
 *      without this, step 2 would always fail with
 *      `NoModificationAllowedError`.
 *   2. Remove `hydranote.duckdb.wal` (and its `-shm` companion if present)
 *      from OPFS.
 *   3. Open a brand new worker + `AsyncDuckDB` and retry `open()` against the
 *      now WAL-less data file.
 *
 * Any other initialization error (network, wasm load, schema migration, etc.)
 * is re-thrown unchanged.
 */
async function doInitializeDatabase(): Promise<void> {
  let workerUrl: string | null = null;
  try {
    workerUrl = await openFreshConnection();
  } catch (firstError) {
    if (!isWalReplayError(firstError)) {
      throw firstError;
    }
    // Recovery: terminate the failed worker FIRST so OPFS releases its lock
    // on the WAL file, then delete the WAL and rebuild from scratch.
    await teardownFailedConnection(workerUrl);
    workerUrl = null;
    await clearOrphanWal();
    workerUrl = await openFreshConnection();
  }

  await createSchema();
  await runSchemaIntegrityMigrations();

  // Register beforeunload to flush database
  window.addEventListener('beforeunload', handleBeforeUnload);

  if (workerUrl) URL.revokeObjectURL(workerUrl);
}

/**
 * Build and open a fresh duckdb-wasm worker + database connection. Sets the
 * module-level `db` and `connection` on success. Returns the blob worker URL
 * so the caller can revoke it.
 *
 * On failure the partial state (worker / db / connection) is intentionally
 * left in place so `teardownFailedConnection` can clean it up — that helper
 * is the single source of truth for releasing OPFS handles.
 */
async function openFreshConnection(): Promise<string> {
  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger();

  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  await db.open({
    path: OPFS_DB_PATH,
    accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
  });

  connection = await db.connect();
  return workerUrl;
}

/**
 * Best-effort teardown of a half-initialized duckdb-wasm worker after a
 * failed `openFreshConnection`. Every step is wrapped in its own try/catch
 * because, by definition, the instance is in an inconsistent state and any
 * of these calls may throw.
 *
 * Critically, this is what releases the OPFS access handle held by the
 * worker — without terminating the worker, the subsequent WAL removal would
 * fail with `NoModificationAllowedError`.
 */
async function teardownFailedConnection(workerUrl: string | null): Promise<void> {
  if (connection) {
    try { await connection.close(); } catch { /* connection may be invalid */ }
    connection = null;
  }
  if (db) {
    try { await db.terminate(); } catch { /* worker may already be dead */ }
    db = null;
  }
  if (workerUrl) {
    try { URL.revokeObjectURL(workerUrl); } catch { /* ignore */ }
  }
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
      binary_data BLOB,
      html_content TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      page_number INTEGER,
      section VARCHAR,
      kind VARCHAR DEFAULT 'text',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Idempotent migration for chunks columns added after the initial schema
  // (DuckDB's ADD COLUMN IF NOT EXISTS prevents errors on existing databases)
  await connection.query(`ALTER TABLE chunks ADD COLUMN IF NOT EXISTS page_number INTEGER`);
  await connection.query(`ALTER TABLE chunks ADD COLUMN IF NOT EXISTS section VARCHAR`);
  await connection.query(`ALTER TABLE chunks ADD COLUMN IF NOT EXISTS kind VARCHAR DEFAULT 'text'`);
  await connection.query(`CREATE INDEX IF NOT EXISTS idx_chunks_file_page ON chunks(file_id, page_number)`);

  // Embeddings table with vector storage
  await connection.query(`
    CREATE TABLE IF NOT EXISTS embeddings (
      id VARCHAR PRIMARY KEY,
      chunk_id VARCHAR NOT NULL,
      file_id VARCHAR NOT NULL,
      project_id VARCHAR NOT NULL,
      vector DOUBLE[] NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes for chat sessions
  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(project_id)
  `);

  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)
  `);

  // File versions table for version history
  await connection.query(`
    CREATE TABLE IF NOT EXISTS file_versions (
      id VARCHAR PRIMARY KEY,
      file_id VARCHAR NOT NULL,
      version_number INTEGER NOT NULL,
      is_full_content BOOLEAN NOT NULL,
      content_or_patch TEXT NOT NULL,
      source VARCHAR NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes for file versions
  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_file_versions_file_id ON file_versions(file_id)
  `);

  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_file_versions_version ON file_versions(file_id, version_number)
  `);

  // Calendar events table (synced from Google Calendar)
  await connection.query(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id VARCHAR PRIMARY KEY,
      google_event_id VARCHAR NOT NULL,
      calendar_id VARCHAR NOT NULL,
      calendar_name VARCHAR,
      summary VARCHAR,
      description TEXT,
      location VARCHAR,
      start_time TIMESTAMP NOT NULL,
      end_time TIMESTAMP NOT NULL,
      all_day BOOLEAN DEFAULT FALSE,
      attendees TEXT,
      hangout_link VARCHAR,
      html_link VARCHAR,
      status VARCHAR,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_calendar_events_google_id ON calendar_events(google_event_id)
  `);

  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_time)
  `);

  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_calendar_events_range ON calendar_events(start_time, end_time)
  `);

  // Note date index (parsed from md/txt content for Timeline)
  await connection.query(`
    CREATE TABLE IF NOT EXISTS note_dates (
      id VARCHAR PRIMARY KEY,
      file_id VARCHAR NOT NULL,
      project_id VARCHAR NOT NULL,
      file_name VARCHAR NOT NULL,
      date_str VARCHAR NOT NULL,
      date_text VARCHAR NOT NULL,
      type VARCHAR NOT NULL,
      context_snippet VARCHAR,
      start_index INTEGER NOT NULL
    )
  `);

  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_note_dates_range ON note_dates(date_str)
  `);

  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_note_dates_project ON note_dates(project_id)
  `);

  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_note_dates_file ON note_dates(file_id)
  `);

  // Note link index (parsed from md/txt content for File Map)
  await connection.query(`
    CREATE TABLE IF NOT EXISTS note_links (
      id VARCHAR PRIMARY KEY,
      source_file_id VARCHAR NOT NULL,
      source_project_id VARCHAR NOT NULL,
      source_file_name VARCHAR NOT NULL,
      target_raw VARCHAR NOT NULL,
      target_file_id VARCHAR,
      target_project_id VARCHAR,
      target_file_name VARCHAR,
      link_type VARCHAR NOT NULL,
      context_snippet VARCHAR,
      start_index INTEGER NOT NULL
    )
  `);

  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_file_id)
  `);

  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_file_id)
  `);

  await connection.query(`
    CREATE INDEX IF NOT EXISTS idx_note_links_source_project ON note_links(source_project_id)
  `);

  // Migration: Add binary_data and html_content columns to files table
  // These columns store original file data for PDF/DOCX viewing
  try {
    await connection.query(`ALTER TABLE files ADD COLUMN IF NOT EXISTS binary_data BLOB`);
  } catch {
    // Column may already exist, ignore error
  }
  try {
    await connection.query(`ALTER TABLE files ADD COLUMN IF NOT EXISTS html_content TEXT`);
  } catch {
    // Column may already exist, ignore error
  }
  
  // Migration: Add binary_data_base64 TEXT column for simpler base64 storage
  // This avoids BLOB conversion issues that can corrupt binary data
  try {
    await connection.query(`ALTER TABLE files ADD COLUMN IF NOT EXISTS binary_data_base64 TEXT`);
  } catch {
    // Column may already exist, ignore error
  }
  
  // Migration: Add system_file_path TEXT column for PDF files
  // PDFs are now viewed directly from the file system instead of storing binary data
  try {
    await connection.query(`ALTER TABLE files ADD COLUMN IF NOT EXISTS system_file_path TEXT`);
  } catch {
    // Column may already exist, ignore error
  }

  // Migration: Add content_hash column for stale embedding detection
  // Used to detect when file content has changed and re-indexing is needed
  try {
    await connection.query(`ALTER TABLE files ADD COLUMN IF NOT EXISTS content_hash VARCHAR`);
  } catch {
    // Column may already exist, ignore error
  }

  // Migration: Add attachments column to chat_messages for tool attachments (e.g. summaries)
  try {
    await connection.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachments TEXT`);
  } catch {
    // Column may already exist, ignore error
  }
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

export async function updateProjectName(projectId: string, newName: string): Promise<void> {
  const conn = getConnection();
  const escapedName = newName.replace(/'/g, "''");
  await conn.query(`
    UPDATE projects SET name = '${escapedName}', updated_at = CURRENT_TIMESTAMP WHERE id = '${projectId}'
  `);
  await flushDatabase();
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

  await withConstraintRetry(async () => {
    await runInTransaction(conn, [
      `DELETE FROM embeddings WHERE project_id = '${projectId}'`,
      `DELETE FROM chunks WHERE project_id = '${projectId}'`,
      `DELETE FROM file_versions WHERE file_id IN (SELECT id FROM files WHERE project_id = '${projectId}')`,
      `DELETE FROM files WHERE project_id = '${projectId}'`,
      `UPDATE chat_sessions SET project_id = NULL WHERE project_id = '${projectId}'`,
      `DELETE FROM projects WHERE id = '${projectId}'`,
    ]);
  });

  await flushDatabase();
}

// ============================================
// File Operations
// ============================================

export async function createFile(file: ProjectFile): Promise<void> {
  const conn = getConnection();

  // Use prepared statement to safely handle large binary data and special characters
  const stmt = await conn.prepare(`
    INSERT INTO files (id, project_id, name, type, size, status, content, binary_data_base64, html_content, system_file_path, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `);

  await stmt.query(
    file.id,
    file.projectId,
    file.name,
    file.type,
    file.size,
    file.status,
    file.content || '',
    file.binaryData || null,
    file.htmlContent || null,
    file.systemFilePath || null,
    file.createdAt.toISOString(),
    file.updatedAt.toISOString(),
  );

  await stmt.close();
}

export async function getFile(fileId: string): Promise<ProjectFile | null> {
  const conn = getConnection();
  const result = await conn.query(`SELECT * FROM files WHERE id = '${fileId}'`);
  const rows = result.toArray();
  if (rows.length === 0) return null;
  
  const row = rows[0];
  
  // binary_data_base64 is stored as TEXT, so we get it directly as a string
  // Fall back to old binary_data column for backward compatibility
  let binaryData: string | undefined = row.binary_data_base64 as string | undefined;
  if (!binaryData && row.binary_data) {
    // Legacy: convert from BLOB if new column is empty
    binaryData = uint8ArrayToBase64(new Uint8Array(row.binary_data));
  }
  
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    type: row.type,
    size: row.size,
    status: row.status,
    content: row.content,
    binaryData,
    htmlContent: row.html_content,
    systemFilePath: row.system_file_path as string | undefined,
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
 * Delete a file and cascade delete its chunks, embeddings, and versions
 */
export async function deleteFile(fileId: string): Promise<void> {
  const conn = getConnection();

  await withConstraintRetry(async () => {
    await runInTransaction(conn, [
      `DELETE FROM embeddings WHERE file_id = '${fileId}'`,
      `DELETE FROM chunks WHERE file_id = '${fileId}'`,
      `DELETE FROM file_versions WHERE file_id = '${fileId}'`,
      `DELETE FROM files WHERE id = '${fileId}'`,
    ]);
  });

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
 */
export async function updateFileProject(fileId: string, newProjectId: string, newName: string): Promise<void> {
  const conn = getConnection();
  const escapedName = newName.replace(/'/g, "''");

  await withConstraintRetry(async () => {
    await runInTransaction(conn, [
      `UPDATE files SET project_id = '${newProjectId}', name = '${escapedName}', updated_at = CURRENT_TIMESTAMP WHERE id = '${fileId}'`,
      `UPDATE chunks SET project_id = '${newProjectId}' WHERE file_id = '${fileId}'`,
      `UPDATE embeddings SET project_id = '${newProjectId}' WHERE file_id = '${fileId}'`,
    ]);
  });

  await flushDatabase();
}

/**
 * Delete all chunks and embeddings for a file (for re-indexing).
 * Uses child-first order inside a transaction with constraint retry.
 */
export async function deleteFileSearchData(fileId: string): Promise<void> {
  const conn = getConnection();
  await withConstraintRetry(async () => {
    await runInTransaction(conn, [
      `DELETE FROM embeddings WHERE file_id = '${fileId}'`,
      `DELETE FROM chunks WHERE file_id = '${fileId}'`,
    ]);
  });
}

/**
 * Update the content hash on a file row after indexing.
 */
export async function updateFileContentHash(fileId: string, contentHash: string): Promise<void> {
  const conn = getConnection();
  const escapedHash = contentHash.replace(/'/g, "''");
  await conn.query(`UPDATE files SET content_hash = '${escapedHash}' WHERE id = '${fileId}'`);
}

// ============================================
// Chunk Operations
// ============================================

export async function createChunk(chunk: Chunk): Promise<void> {
  const conn = getConnection();
  const escapedText = chunk.text.replace(/'/g, "''");
  const pageSql = chunk.pageNumber == null ? 'NULL' : `${chunk.pageNumber}`;
  const sectionSql = chunk.section == null
    ? 'NULL'
    : `'${chunk.section.replace(/'/g, "''")}'`;
  const kindSql = `'${(chunk.kind ?? 'text').replace(/'/g, "''")}'`;
  await conn.query(`
    INSERT INTO chunks (id, file_id, project_id, chunk_index, text, start_offset, end_offset, page_number, section, kind, created_at)
    VALUES ('${chunk.id}', '${chunk.fileId}', '${chunk.projectId}', ${chunk.index}, '${escapedText}', ${chunk.startOffset}, ${chunk.endOffset}, ${pageSql}, ${sectionSql}, ${kindSql}, '${chunk.createdAt.toISOString()}')
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
    pageNumber: row.page_number ?? undefined,
    section: row.section ?? undefined,
    kind: (row.kind as Chunk['kind']) ?? undefined,
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
): Promise<Array<{
  chunkId: string;
  fileId: string;
  text: string;
  score: number;
  pageNumber?: number;
  section?: string;
  kind?: string;
}>> {
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
      c.page_number,
      c.section,
      c.kind,
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
    pageNumber: row.page_number != null ? Number(row.page_number) : undefined,
    section: row.section != null ? String(row.section) : undefined,
    kind: row.kind != null ? String(row.kind) : undefined,
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

  await withConstraintRetry(async () => {
    await runInTransaction(conn, [
      `DELETE FROM web_search_chunks WHERE cache_id IN (${idsStr})`,
      `DELETE FROM web_search_cache WHERE id IN (${idsStr})`,
    ]);
  });

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
  /** JSON-serialized ToolAttachment[] for persisting tool attachments */
  attachments?: string;
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

  await withConstraintRetry(async () => {
    await runInTransaction(conn, [
      `DELETE FROM chat_messages WHERE session_id = '${sessionId}'`,
      `DELETE FROM chat_sessions WHERE id = '${sessionId}'`,
    ]);
  });

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

  await withConstraintRetry(async () => {
    await runInTransaction(conn, [
      `DELETE FROM chat_messages WHERE session_id IN (${idsStr})`,
      `DELETE FROM chat_sessions WHERE id IN (${idsStr})`,
    ]);
  });

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
  const attachmentsValue = message.attachments
    ? `'${message.attachments.replace(/'/g, "''")}'`
    : 'NULL';

  await withConstraintRetry(async () => {
    const session = await getChatSession(message.sessionId);
    if (!session) {
      const escapedTitle = 'Recovered session'.replace(/'/g, "''");
      await conn.query(`
        INSERT INTO chat_sessions (id, project_id, title, created_at, updated_at)
        VALUES ('${message.sessionId}', NULL, '${escapedTitle}', '${message.createdAt.toISOString()}', '${message.createdAt.toISOString()}')
      `);
    }

    await conn.query(`
      INSERT INTO chat_messages (id, session_id, role, content, created_at, attachments)
      VALUES ('${message.id}', '${message.sessionId}', '${message.role}', '${escapedContent}', '${message.createdAt.toISOString()}', ${attachmentsValue})
    `);
  });

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
    attachments: row.attachments as string | undefined,
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

// ============================================
// File Version Operations
// ============================================

export interface DBFileVersion {
  id: string;
  fileId: string;
  versionNumber: number;
  isFullContent: boolean;
  contentOrPatch: string;
  source: 'create' | 'update' | 'format' | 'restore';
  createdAt: Date;
}

/**
 * Create a new file version
 */
export async function createFileVersion(version: DBFileVersion): Promise<void> {
  const file = await getFile(version.fileId);
  if (!file) {
    console.warn('[HydraNote] Skipping file version write — file not found:', version.fileId);
    return;
  }

  const conn = getConnection();
  const escapedContent = version.contentOrPatch.replace(/'/g, "''");

  await withConstraintRetry(async () => {
    await conn.query(`
      INSERT INTO file_versions (id, file_id, version_number, is_full_content, content_or_patch, source, created_at)
      VALUES ('${version.id}', '${version.fileId}', ${version.versionNumber}, ${version.isFullContent}, '${escapedContent}', '${version.source}', '${version.createdAt.toISOString()}')
    `);
  });

  await flushDatabase();
}

/**
 * Get all versions for a file (ordered by version number descending)
 */
export async function getFileVersions(fileId: string): Promise<DBFileVersion[]> {
  const conn = getConnection();
  
  const result = await conn.query(`
    SELECT * FROM file_versions 
    WHERE file_id = '${fileId}'
    ORDER BY version_number DESC
  `);
  
  return result.toArray().map((row: Record<string, unknown>) => ({
    id: row.id as string,
    fileId: row.file_id as string,
    versionNumber: row.version_number as number,
    isFullContent: row.is_full_content as boolean,
    contentOrPatch: row.content_or_patch as string,
    source: row.source as 'create' | 'update' | 'format' | 'restore',
    createdAt: new Date(row.created_at as string),
  }));
}

/**
 * Get a specific version by file ID and version number
 */
export async function getFileVersion(fileId: string, versionNumber: number): Promise<DBFileVersion | null> {
  const conn = getConnection();
  
  const result = await conn.query(`
    SELECT * FROM file_versions 
    WHERE file_id = '${fileId}' AND version_number = ${versionNumber}
  `);
  
  const rows = result.toArray();
  if (rows.length === 0) return null;
  
  const row = rows[0];
  return {
    id: row.id as string,
    fileId: row.file_id as string,
    versionNumber: row.version_number as number,
    isFullContent: row.is_full_content as boolean,
    contentOrPatch: row.content_or_patch as string,
    source: row.source as 'create' | 'update' | 'format' | 'restore',
    createdAt: new Date(row.created_at as string),
  };
}

/**
 * Get the latest version number for a file
 */
export async function getLatestVersionNumber(fileId: string): Promise<number> {
  const conn = getConnection();
  
  const result = await conn.query(`
    SELECT MAX(version_number) as max_version FROM file_versions 
    WHERE file_id = '${fileId}'
  `);
  
  const rows = result.toArray();
  const maxVersion = rows[0]?.max_version;
  return maxVersion !== null && maxVersion !== undefined ? Number(maxVersion) : 0;
}

/**
 * Delete versions older than a certain version number (for pruning)
 */
export async function deleteOldVersions(fileId: string, keepCount: number): Promise<number> {
  const conn = getConnection();
  
  // Get versions to delete (keeping the most recent keepCount versions)
  const versionsToDelete = await conn.query(`
    SELECT id FROM file_versions
    WHERE file_id = '${fileId}'
    ORDER BY version_number DESC
    OFFSET ${keepCount}
  `);
  
  const idsToDelete = versionsToDelete.toArray().map((row: Record<string, unknown>) => row.id as string);
  
  if (idsToDelete.length === 0) return 0;
  
  const idsStr = idsToDelete.map(id => `'${id}'`).join(', ');
  await conn.query(`DELETE FROM file_versions WHERE id IN (${idsStr})`);
  await flushDatabase();
  
  return idsToDelete.length;
}

/**
 * Delete all versions for a file
 */
export async function deleteFileVersions(fileId: string): Promise<void> {
  const conn = getConnection();
  await conn.query(`DELETE FROM file_versions WHERE file_id = '${fileId}'`);
  await flushDatabase();
}

/**
 * Update a version to store full content (used when converting patch to full for pruning)
 */
export async function updateVersionToFullContent(versionId: string, fullContent: string): Promise<void> {
  const conn = getConnection();
  const escapedContent = fullContent.replace(/'/g, "''");
  
  await conn.query(`
    UPDATE file_versions 
    SET is_full_content = true, content_or_patch = '${escapedContent}'
    WHERE id = '${versionId}'
  `);
  await flushDatabase();
}

// ============================================
// Calendar Event Operations
// ============================================

export interface DBCalendarEvent {
  id: string;
  googleEventId: string;
  calendarId: string;
  calendarName?: string;
  summary?: string;
  description?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  attendees?: string;
  hangoutLink?: string;
  htmlLink?: string;
  status?: string;
  syncedAt: Date;
}

function escapeSQL(val: string | undefined | null): string {
  if (val == null) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

export async function upsertCalendarEvent(event: DBCalendarEvent): Promise<void> {
  const conn = getConnection();

  const existing = await conn.query(
    `SELECT id FROM calendar_events WHERE google_event_id = ${escapeSQL(event.googleEventId)} LIMIT 1`
  );

  if (existing.toArray().length > 0) {
    await conn.query(`
      UPDATE calendar_events SET
        calendar_id = ${escapeSQL(event.calendarId)},
        calendar_name = ${escapeSQL(event.calendarName)},
        summary = ${escapeSQL(event.summary)},
        description = ${escapeSQL(event.description)},
        location = ${escapeSQL(event.location)},
        start_time = '${event.startTime.toISOString()}',
        end_time = '${event.endTime.toISOString()}',
        all_day = ${event.allDay},
        attendees = ${escapeSQL(event.attendees)},
        hangout_link = ${escapeSQL(event.hangoutLink)},
        html_link = ${escapeSQL(event.htmlLink)},
        status = ${escapeSQL(event.status)},
        synced_at = '${event.syncedAt.toISOString()}'
      WHERE google_event_id = ${escapeSQL(event.googleEventId)}
    `);
  } else {
    await conn.query(`
      INSERT INTO calendar_events (
        id, google_event_id, calendar_id, calendar_name, summary, description,
        location, start_time, end_time, all_day, attendees, hangout_link,
        html_link, status, synced_at
      ) VALUES (
        ${escapeSQL(event.id)}, ${escapeSQL(event.googleEventId)}, ${escapeSQL(event.calendarId)},
        ${escapeSQL(event.calendarName)}, ${escapeSQL(event.summary)}, ${escapeSQL(event.description)},
        ${escapeSQL(event.location)}, '${event.startTime.toISOString()}', '${event.endTime.toISOString()}',
        ${event.allDay}, ${escapeSQL(event.attendees)}, ${escapeSQL(event.hangoutLink)},
        ${escapeSQL(event.htmlLink)}, ${escapeSQL(event.status)}, '${event.syncedAt.toISOString()}'
      )
    `);
  }

  await flushDatabase();
}

function mapCalendarEventRow(row: Record<string, unknown>): DBCalendarEvent {
  return {
    id: row.id as string,
    googleEventId: row.google_event_id as string,
    calendarId: row.calendar_id as string,
    calendarName: row.calendar_name as string | undefined,
    summary: row.summary as string | undefined,
    description: row.description as string | undefined,
    location: row.location as string | undefined,
    startTime: new Date(row.start_time as string),
    endTime: new Date(row.end_time as string),
    allDay: row.all_day as boolean,
    attendees: row.attendees as string | undefined,
    hangoutLink: row.hangout_link as string | undefined,
    htmlLink: row.html_link as string | undefined,
    status: row.status as string | undefined,
    syncedAt: new Date(row.synced_at as string),
  };
}

export async function getCalendarEventsByDateRange(
  startDate: Date,
  endDate: Date,
): Promise<DBCalendarEvent[]> {
  const conn = getConnection();
  const result = await conn.query(`
    SELECT * FROM calendar_events
    WHERE start_time <= '${endDate.toISOString()}'
      AND end_time >= '${startDate.toISOString()}'
    ORDER BY start_time ASC
  `);
  return result.toArray().map(mapCalendarEventRow);
}

export async function getCalendarEventByGoogleId(
  googleEventId: string,
): Promise<DBCalendarEvent | null> {
  const conn = getConnection();
  const result = await conn.query(
    `SELECT * FROM calendar_events WHERE google_event_id = ${escapeSQL(googleEventId)} LIMIT 1`
  );
  const rows = result.toArray();
  if (rows.length === 0) return null;
  return mapCalendarEventRow(rows[0]);
}

export async function deleteCalendarEventsByCalendarId(calendarId: string): Promise<void> {
  const conn = getConnection();
  await conn.query(`DELETE FROM calendar_events WHERE calendar_id = ${escapeSQL(calendarId)}`);
  await flushDatabase();
}

export async function getAllCalendarEvents(): Promise<DBCalendarEvent[]> {
  const conn = getConnection();
  const result = await conn.query(`SELECT * FROM calendar_events ORDER BY start_time ASC`);
  return result.toArray().map(mapCalendarEventRow);
}

export async function getCalendarEventsForDate(date: Date): Promise<DBCalendarEvent[]> {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);
  return getCalendarEventsByDateRange(dayStart, dayEnd);
}

// ============================================
// Note Date Index Operations (Timeline)
// ============================================

export interface DBNoteDate {
  id: string;
  fileId: string;
  projectId: string;
  fileName: string;
  dateStr: string;
  dateText: string;
  type: 'regular' | 'deadline';
  contextSnippet?: string;
  startIndex: number;
}

function mapNoteDateRow(row: Record<string, unknown>): DBNoteDate {
  return {
    id: row.id as string,
    fileId: row.file_id as string,
    projectId: row.project_id as string,
    fileName: row.file_name as string,
    dateStr: row.date_str as string,
    dateText: row.date_text as string,
    type: row.type as 'regular' | 'deadline',
    contextSnippet: row.context_snippet as string | undefined,
    startIndex: row.start_index as number,
  };
}

export async function countNoteDates(): Promise<number> {
  const conn = getConnection();
  const result = await conn.query(`SELECT COUNT(*) AS cnt FROM note_dates`);
  const rows = result.toArray();
  return Number(rows[0]?.cnt ?? 0);
}

export async function replaceNoteDatesForFile(
  fileId: string,
  rows: DBNoteDate[],
): Promise<void> {
  const conn = getConnection();
  await conn.query(`DELETE FROM note_dates WHERE file_id = ${escapeSQL(fileId)}`);

  for (const row of rows) {
    await conn.query(`
      INSERT INTO note_dates (
        id, file_id, project_id, file_name, date_str, date_text, type, context_snippet, start_index
      ) VALUES (
        ${escapeSQL(row.id)},
        ${escapeSQL(row.fileId)},
        ${escapeSQL(row.projectId)},
        ${escapeSQL(row.fileName)},
        ${escapeSQL(row.dateStr)},
        ${escapeSQL(row.dateText)},
        ${escapeSQL(row.type)},
        ${escapeSQL(row.contextSnippet)},
        ${row.startIndex}
      )
    `);
  }

  await flushDatabase();
}

export async function deleteNoteDatesForFile(fileId: string): Promise<void> {
  const conn = getConnection();
  await conn.query(`DELETE FROM note_dates WHERE file_id = ${escapeSQL(fileId)}`);
  await flushDatabase();
}

export async function updateNoteDatesFileName(fileId: string, fileName: string): Promise<void> {
  const conn = getConnection();
  await conn.query(`
    UPDATE note_dates SET file_name = ${escapeSQL(fileName)}
    WHERE file_id = ${escapeSQL(fileId)}
  `);
  await flushDatabase();
}

export async function updateNoteDatesProject(
  fileId: string,
  projectId: string,
  fileName: string,
): Promise<void> {
  const conn = getConnection();
  await conn.query(`
    UPDATE note_dates SET
      project_id = ${escapeSQL(projectId)},
      file_name = ${escapeSQL(fileName)}
    WHERE file_id = ${escapeSQL(fileId)}
  `);
  await flushDatabase();
}

export async function getNoteDatesByRange(
  startStr: string,
  endStr: string,
  projectId?: string,
): Promise<DBNoteDate[]> {
  const conn = getConnection();
  const projectFilter = projectId
    ? `AND project_id = ${escapeSQL(projectId)}`
    : '';
  const result = await conn.query(`
    SELECT * FROM note_dates
    WHERE date_str >= ${escapeSQL(startStr)}
      AND date_str <= ${escapeSQL(endStr)}
      ${projectFilter}
    ORDER BY date_str ASC, file_name ASC, start_index ASC
  `);
  return result.toArray().map(mapNoteDateRow);
}

// ============================================
// Note Link Index Operations (File Map)
// ============================================

export type NoteLinkType = 'wikilink' | 'markdown' | 'at_file';

export interface DBNoteLink {
  id: string;
  sourceFileId: string;
  sourceProjectId: string;
  sourceFileName: string;
  targetRaw: string;
  targetFileId: string | null;
  targetProjectId: string | null;
  targetFileName: string | null;
  linkType: NoteLinkType;
  contextSnippet?: string;
  startIndex: number;
}

function mapNoteLinkRow(row: Record<string, unknown>): DBNoteLink {
  return {
    id: row.id as string,
    sourceFileId: row.source_file_id as string,
    sourceProjectId: row.source_project_id as string,
    sourceFileName: row.source_file_name as string,
    targetRaw: row.target_raw as string,
    targetFileId: (row.target_file_id as string) || null,
    targetProjectId: (row.target_project_id as string) || null,
    targetFileName: (row.target_file_name as string) || null,
    linkType: row.link_type as NoteLinkType,
    contextSnippet: row.context_snippet as string | undefined,
    startIndex: row.start_index as number,
  };
}

export async function countNoteLinks(): Promise<number> {
  const conn = getConnection();
  const result = await conn.query(`SELECT COUNT(*) AS cnt FROM note_links`);
  const rows = result.toArray();
  return Number(rows[0]?.cnt ?? 0);
}

export async function replaceNoteLinksForFile(
  sourceFileId: string,
  rows: DBNoteLink[],
): Promise<void> {
  const conn = getConnection();
  await conn.query(`DELETE FROM note_links WHERE source_file_id = ${escapeSQL(sourceFileId)}`);

  for (const row of rows) {
    await conn.query(`
      INSERT INTO note_links (
        id, source_file_id, source_project_id, source_file_name,
        target_raw, target_file_id, target_project_id, target_file_name,
        link_type, context_snippet, start_index
      ) VALUES (
        ${escapeSQL(row.id)},
        ${escapeSQL(row.sourceFileId)},
        ${escapeSQL(row.sourceProjectId)},
        ${escapeSQL(row.sourceFileName)},
        ${escapeSQL(row.targetRaw)},
        ${escapeSQL(row.targetFileId)},
        ${escapeSQL(row.targetProjectId)},
        ${escapeSQL(row.targetFileName)},
        ${escapeSQL(row.linkType)},
        ${escapeSQL(row.contextSnippet)},
        ${row.startIndex}
      )
    `);
  }

  await flushDatabase();
}

export async function deleteNoteLinksForFile(fileId: string): Promise<void> {
  const conn = getConnection();
  await conn.query(`
    DELETE FROM note_links
    WHERE source_file_id = ${escapeSQL(fileId)}
       OR target_file_id = ${escapeSQL(fileId)}
  `);
  await flushDatabase();
}

export async function updateNoteLinksSourceFileName(
  fileId: string,
  fileName: string,
): Promise<void> {
  const conn = getConnection();
  await conn.query(`
    UPDATE note_links SET source_file_name = ${escapeSQL(fileName)}
    WHERE source_file_id = ${escapeSQL(fileId)}
  `);
  await conn.query(`
    UPDATE note_links SET target_file_name = ${escapeSQL(fileName)}
    WHERE target_file_id = ${escapeSQL(fileId)}
  `);
  await flushDatabase();
}

export async function updateNoteLinksSourceProject(
  fileId: string,
  projectId: string,
  fileName: string,
): Promise<void> {
  const conn = getConnection();
  await conn.query(`
    UPDATE note_links SET
      source_project_id = ${escapeSQL(projectId)},
      source_file_name = ${escapeSQL(fileName)}
    WHERE source_file_id = ${escapeSQL(fileId)}
  `);
  await conn.query(`
    UPDATE note_links SET
      target_project_id = ${escapeSQL(projectId)},
      target_file_name = ${escapeSQL(fileName)}
    WHERE target_file_id = ${escapeSQL(fileId)}
  `);
  await flushDatabase();
}

export async function getNoteLinks(projectId?: string): Promise<DBNoteLink[]> {
  const conn = getConnection();
  const projectFilter = projectId
    ? `WHERE source_project_id = ${escapeSQL(projectId)}
        OR target_project_id = ${escapeSQL(projectId)}`
    : '';
  const result = await conn.query(`
    SELECT * FROM note_links
    ${projectFilter}
    ORDER BY source_file_name ASC, start_index ASC
  `);
  return result.toArray().map(mapNoteLinkRow);
}

export async function getResolvedNoteLinks(projectId?: string): Promise<DBNoteLink[]> {
  const conn = getConnection();
  const projectFilter = projectId
    ? `AND (source_project_id = ${escapeSQL(projectId)}
         OR target_project_id = ${escapeSQL(projectId)})`
    : '';
  const result = await conn.query(`
    SELECT * FROM note_links
    WHERE target_file_id IS NOT NULL
      ${projectFilter}
    ORDER BY source_file_name ASC, start_index ASC
  `);
  return result.toArray().map(mapNoteLinkRow);
}

