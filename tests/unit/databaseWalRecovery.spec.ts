import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// `database.ts` pulls in `@duckdb/duckdb-wasm`, which is a heavy module that
// instantiates Web Workers when its functions are called. We're testing only
// the pure `isWalReplayError` matcher and the OPFS-poking `clearOrphanWal`
// helper, so stubbing the duckdb namespace is sufficient — neither function
// touches a duckdb API at runtime.
vi.mock('@duckdb/duckdb-wasm', () => ({
  AsyncDuckDB: class {},
  ConsoleLogger: class {},
  DuckDBAccessMode: { READ_WRITE: 0 },
  getJsDelivrBundles: () => [],
  selectBundle: vi.fn(),
}));

describe('isWalReplayError', () => {
  test('matches the canonical WAL replay phrase', async () => {
    const { isWalReplayError } = await import('../../src/services/database');

    const realProductionError = new Error(
      'Opening the database failed with error: ' +
      '{"exception_type":"Binder","exception_message":"Failure while replaying WAL file ' +
      '\\"opfs://hydranote.duckdb.wal\\": Catalog \\"hydranote\\" does not exist!"}',
    );

    expect(isWalReplayError(realProductionError)).toBe(true);
  });

  test('matches a Binder error referencing the .wal even without the canonical phrase', async () => {
    const { isWalReplayError } = await import('../../src/services/database');

    const variant = new Error(
      'Opening the database failed: ' +
      '{"exception_type":"Binder","exception_message":"Table \\"x\\" does not exist when applying ' +
      'opfs://hydranote.duckdb.wal"}',
    );

    expect(isWalReplayError(variant)).toBe(true);
  });

  test('rejects unrelated initialization errors', async () => {
    const { isWalReplayError } = await import('../../src/services/database');

    expect(isWalReplayError(new Error('Failed to fetch wasm bundle'))).toBe(false);
    expect(isWalReplayError(new Error('Network error'))).toBe(false);
    expect(isWalReplayError('plain string error')).toBe(false);
    expect(isWalReplayError(null)).toBe(false);
    expect(isWalReplayError(undefined)).toBe(false);
    expect(isWalReplayError({})).toBe(false);
  });

  test('rejects a Binder error that does not reference the WAL file', async () => {
    const { isWalReplayError } = await import('../../src/services/database');

    const unrelatedBinderError = new Error(
      '{"exception_type":"Binder","exception_message":"Column \\"foo\\" does not exist"}',
    );

    expect(isWalReplayError(unrelatedBinderError)).toBe(false);
  });
});

describe('clearOrphanWal', () => {
  const originalNavigator = globalThis.navigator;

  function stubNavigatorStorage(removeEntry: (name: string) => Promise<void>): {
    calls: string[];
  } {
    const calls: string[] = [];
    const root = {
      removeEntry: async (name: string) => {
        calls.push(name);
        await removeEntry(name);
      },
    } as unknown as FileSystemDirectoryHandle;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        storage: {
          getDirectory: async () => root,
        },
      },
    });
    return { calls };
  }

  beforeEach(() => {
    // Each test installs its own navigator stub; we restore between tests
    // so unrelated globals stay clean.
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });

  test('removes both WAL sidecar files when present and returns true', async () => {
    const { calls } = stubNavigatorStorage(async () => {
      // Both entries "exist" and remove successfully.
    });

    const { clearOrphanWal } = await import('../../src/services/database');
    const result = await clearOrphanWal();

    expect(result).toBe(true);
    expect(calls).toEqual([
      'hydranote.duckdb.wal',
      'hydranote.duckdb.wal-shm',
    ]);
  });

  test('returns true when only the primary WAL exists and shm is missing', async () => {
    const { calls } = stubNavigatorStorage(async (name) => {
      if (name === 'hydranote.duckdb.wal-shm') {
        const err = new Error('NotFoundError');
        err.name = 'NotFoundError';
        throw err;
      }
    });

    const { clearOrphanWal } = await import('../../src/services/database');
    const result = await clearOrphanWal();

    expect(result).toBe(true);
    expect(calls).toEqual([
      'hydranote.duckdb.wal',
      'hydranote.duckdb.wal-shm',
    ]);
  });

  test('returns false when every removal throws (e.g. file is locked)', async () => {
    stubNavigatorStorage(async () => {
      const err = new Error('NoModificationAllowedError');
      err.name = 'NoModificationAllowedError';
      throw err;
    });

    const { clearOrphanWal } = await import('../../src/services/database');
    const result = await clearOrphanWal();

    expect(result).toBe(false);
  });

  test('returns false when navigator.storage is unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    });

    const { clearOrphanWal } = await import('../../src/services/database');
    const result = await clearOrphanWal();

    expect(result).toBe(false);
  });

  test('returns false when getDirectory itself rejects', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        storage: {
          getDirectory: async () => {
            throw new Error('OPFS unavailable');
          },
        },
      },
    });

    const { clearOrphanWal } = await import('../../src/services/database');
    const result = await clearOrphanWal();

    expect(result).toBe(false);
  });
});
