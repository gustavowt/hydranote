import { describe, expect, it, vi } from 'vitest';
import { createDatabaseWorkerSource } from '../../src/services/databaseWorker';

interface Response {
  type: string;
  requestId: number;
  data?: unknown;
}

function workerHarness(files: Map<string, unknown> = new Map()) {
  const calls: string[] = [];
  const responses: Response[] = [];
  const scope = {
    DUCKDB_RUNTIME: { _files: files } as { _files: Map<string, unknown> } | undefined,
    onmessage: ({ data }: { data: { type: string; messageId: number } }) => {
      calls.push(data.type);
    },
    postMessage: (response: Response) => {
      calls.push('response');
      responses.push(response);
    },
  };
  const importScripts = vi.fn();
  // Execute the exact classic-worker bootstrap emitted by database.ts.
  new Function('globalThis', 'importScripts', createDatabaseWorkerSource('https://example.test/worker.js'))(
    scope, importScripts,
  );
  return { scope, calls, responses, importScripts };
}

describe('database OPFS flush acknowledgement', () => {
  it('publishes in-run messages before the awaited flush resolves, without teardown', () => {
    let disk = ['welcome'];
    const live = [...disk, 'plan-probe', 'execution plan', 'cancelled'];
    const files = new Map<string, unknown>();
    const { scope, calls, responses, importScripts } = workerHarness(files);
    files.set('opfs://hydranote.duckdb', { flush: () => {
      calls.push('database flush');
      disk = [...live];
    } });
    files.set('opfs://hydranote.duckdb.wal', { flush: () => calls.push('wal flush') });
    files.set('import.csv', new Blob(['data']));

    scope.onmessage({ data: { type: 'FLUSH_FILES', messageId: 1 } });
    // The upstream page-buffer flush does not publish direct OPFS writes.
    expect(disk).toEqual(['welcome']);
    scope.postMessage({ type: 'OK', requestId: 1 });

    expect(importScripts).toHaveBeenCalledWith('https://example.test/worker.js');
    expect(calls).toEqual(['FLUSH_FILES', 'database flush', 'wal flush', 'response']);
    expect(responses).toEqual([{ type: 'OK', requestId: 1 }]);
    // A fresh reader (reload or relaunch) sees the completed write.
    expect([...disk]).toEqual(live);
  });

  it('rejects the flush request when an OPFS flush fails', () => {
    const { scope, responses } = workerHarness(new Map([
      ['opfs://hydranote.duckdb', { flush: () => { throw new Error('disk full'); } }],
    ]));
    scope.onmessage({ data: { type: 'FLUSH_FILES', messageId: 2 } });
    scope.postMessage({ type: 'OK', requestId: 2 });
    expect(responses[0]).toMatchObject({
      type: 'ERROR', requestId: 2, data: { message: 'Error: disk full' },
    });
  });

  it('fails explicitly if a dependency upgrade removes the runtime', () => {
    const { scope, responses } = workerHarness();
    scope.DUCKDB_RUNTIME = undefined;
    scope.onmessage({ data: { type: 'FLUSH_FILES', messageId: 3 } });
    scope.postMessage({ type: 'OK', requestId: 3 });
    expect(responses[0]).toMatchObject({ type: 'ERROR', requestId: 3 });
  });

  it('preserves upstream errors and removes the pending request', () => {
    const flush = vi.fn();
    const { scope, responses } = workerHarness(new Map([
      ['opfs://hydranote.duckdb', { flush }],
    ]));
    scope.onmessage({ data: { type: 'FLUSH_FILES', messageId: 4 } });
    const failure = { type: 'ERROR', requestId: 4, data: { message: 'upstream failure' } };
    scope.postMessage(failure);
    scope.postMessage({ type: 'OK', requestId: 4 });
    expect(responses[0]).toBe(failure);
    expect(flush).not.toHaveBeenCalled();
  });

  it('matches acknowledgements by request ID and ignores log traffic', () => {
    const flush = vi.fn();
    const { scope } = workerHarness(new Map([
      ['opfs://hydranote.duckdb', { flush }],
    ]));
    scope.onmessage({ data: { type: 'FLUSH_FILES', messageId: 0 } });
    scope.onmessage({ data: { type: 'QUERY', messageId: 1 } });
    scope.postMessage({ type: 'LOG', requestId: 0 });
    scope.postMessage({ type: 'OK', requestId: 1 });
    expect(flush).not.toHaveBeenCalled();
    scope.postMessage({ type: 'OK', requestId: 0 });
    scope.postMessage({ type: 'OK', requestId: 0 });
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
