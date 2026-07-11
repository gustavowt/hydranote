import { describe, expect, test, vi } from 'vitest';

vi.mock('@duckdb/duckdb-wasm', () => ({
  AsyncDuckDB: class {},
  ConsoleLogger: class {},
  DuckDBAccessMode: { READ_WRITE: 0 },
  getJsDelivrBundles: () => [],
  selectBundle: vi.fn(),
}));

type MockRow = Record<string, unknown>;

function createMockConnection(handlers: {
  onQuery?: (sql: string) => MockRow[] | Promise<MockRow[]>;
} = {}) {
  const queries: string[] = [];
  const conn = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql.trim());
      const rows = handlers.onQuery ? await handlers.onQuery(sql) : [];
      return { toArray: () => rows };
    }),
  };
  return { conn, queries };
}

describe('isConstraintError', () => {
  test('matches foreign key violation messages', async () => {
    const { isConstraintError } = await import('../../src/services/database');

    expect(isConstraintError(new Error('Constraint Error: Violates foreign key constraint'))).toBe(true);
    expect(isConstraintError(new Error('FOREIGN KEY constraint failed'))).toBe(true);
    expect(
      isConstraintError(
        new Error('{"exception_type":"Constraint","exception_message":"Violates foreign key"}'),
      ),
    ).toBe(true);
  });

  test('rejects not-null violations (must not trigger orphan heal)', async () => {
    const { isConstraintError } = await import('../../src/services/database');

    expect(isConstraintError(new Error('Violates not-null constraint on column content'))).toBe(false);
  });
});

describe('formatDatabaseErrorMessage', () => {
  test('returns repair hint for constraint errors', async () => {
    const { formatDatabaseErrorMessage } = await import('../../src/services/database');

    expect(
      formatDatabaseErrorMessage(new Error('FOREIGN KEY constraint failed'), 'move file'),
    ).toBe('Failed to move file. The library was repaired — please try again.');
  });

  test('returns raw message for other errors', async () => {
    const { formatDatabaseErrorMessage } = await import('../../src/services/database');

    expect(
      formatDatabaseErrorMessage(new Error('Disk full'), 'delete file'),
    ).toBe('Failed to delete file: Disk full');
  });
});

describe('hasForeignKeyConstraints', () => {
  test('returns true when duckdb_constraints reports foreign keys', async () => {
    const { conn } = createMockConnection({
      onQuery: (sql) => {
        if (sql.includes('duckdb_constraints')) {
          return [{ cnt: 3 }];
        }
        return [];
      },
    });

    const { hasForeignKeyConstraints } = await import('../../src/services/database');
    await expect(hasForeignKeyConstraints(conn as never)).resolves.toBe(true);
  });

  test('returns false when no foreign keys exist', async () => {
    const { conn } = createMockConnection({
      onQuery: (sql) => {
        if (sql.includes('duckdb_constraints')) {
          return [{ cnt: 0 }];
        }
        return [];
      },
    });

    const { hasForeignKeyConstraints } = await import('../../src/services/database');
    await expect(hasForeignKeyConstraints(conn as never)).resolves.toBe(false);
  });
});

describe('stripForeignKeyConstraints', () => {
  test('rebuilds tables in dependency order without FOREIGN KEY clauses', async () => {
    let fkChecks = 0;
    const tableColumns: Record<string, string[]> = {
      embeddings: ['id', 'chunk_id', 'file_id', 'project_id', 'vector', 'created_at'],
      chunks: [
        'id', 'file_id', 'project_id', 'chunk_index', 'text',
        'start_offset', 'end_offset', 'page_number', 'section', 'kind', 'created_at',
      ],
      file_versions: [
        'id', 'file_id', 'version_number', 'is_full_content',
        'content_or_patch', 'source', 'created_at',
      ],
      chat_messages: ['id', 'session_id', 'role', 'content', 'created_at', 'attachments'],
      web_search_chunks: ['id', 'cache_id', 'chunk_index', 'text', 'embedding', 'created_at'],
      files: [
        'id', 'project_id', 'name', 'type', 'size', 'status', 'content',
        'binary_data', 'html_content', 'created_at', 'updated_at',
        'binary_data_base64', 'system_file_path', 'content_hash',
      ],
    };

    const { conn, queries } = createMockConnection({
      onQuery: (sql) => {
        if (sql.includes('duckdb_constraints')) {
          fkChecks += 1;
          return [{ cnt: fkChecks === 1 ? 1 : 0 }];
        }
        for (const [table, columns] of Object.entries(tableColumns)) {
          if (sql.startsWith(`DESCRIBE ${table}`)) {
            return columns.map((column_name) => ({ column_name }));
          }
        }
        return [];
      },
    });

    const { stripForeignKeyConstraints } = await import('../../src/services/database');
    const stripped = await stripForeignKeyConstraints(conn as never);

    expect(stripped).toBe(true);
    expect(queries.some((q) => q.includes('CREATE TABLE embeddings__fkfree'))).toBe(true);
    expect(queries.some((q) => q.includes('CREATE TABLE files__fkfree'))).toBe(true);
    const ddlQueries = queries.filter((q) => q.startsWith('CREATE TABLE'));
    expect(ddlQueries.every((q) => !q.includes('FOREIGN KEY'))).toBe(true);

    const embeddingsIdx = queries.findIndex((q) => q.includes('CREATE TABLE embeddings__fkfree'));
    const filesIdx = queries.findIndex((q) => q.includes('CREATE TABLE files__fkfree'));
    expect(embeddingsIdx).toBeGreaterThan(-1);
    expect(filesIdx).toBeGreaterThan(embeddingsIdx);
  });

  test('skips rebuild when database is already FK-free', async () => {
    const { conn, queries } = createMockConnection({
      onQuery: (sql) => {
        if (sql.includes('duckdb_constraints')) {
          return [{ cnt: 0 }];
        }
        return [];
      },
    });

    const { stripForeignKeyConstraints } = await import('../../src/services/database');
    const stripped = await stripForeignKeyConstraints(conn as never);

    expect(stripped).toBe(false);
    expect(queries.filter((q) => q.includes('__fkfree'))).toHaveLength(0);
  });
});

describe('healOrphanRows', () => {
  test('runs orphan cleanup statements in order', async () => {
    const { conn, queries } = createMockConnection();
    const { healOrphanRows, ORPHAN_HEAL_STATEMENTS } = await import('../../src/services/database');

    await healOrphanRows(conn as never);

    expect(queries).toHaveLength(ORPHAN_HEAL_STATEMENTS.length);
    expect(queries[0]).toContain('DELETE FROM files');
    expect(queries[1]).toContain('DELETE FROM embeddings');
    expect(queries[queries.length - 1]).toContain('UPDATE chat_sessions');
  });
});

describe('ORPHAN_HEAL_STATEMENTS', () => {
  test('covers all child tables with logical foreign keys', async () => {
    const { ORPHAN_HEAL_STATEMENTS } = await import('../../src/services/database');
    const joined = ORPHAN_HEAL_STATEMENTS.join('\n');

    expect(joined).toContain('embeddings');
    expect(joined).toContain('chunks');
    expect(joined).toContain('file_versions');
    expect(joined).toContain('files');
    expect(joined).toContain('chat_messages');
    expect(joined).toContain('web_search_chunks');
    expect(joined).toContain('chat_sessions');
  });
});
