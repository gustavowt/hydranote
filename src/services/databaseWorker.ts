/**
 * DuckDB-WASM 1.30 uses direct I/O for OPFS, but FLUSH_FILES only flushes
 * its page buffer and WebFileSystem::FileSync is a no-op. Flush the live
 * OPFS handles before acknowledging that request, while the page is alive.
 *
 * This adapter depends on the worker protocol and DUCKDB_RUNTIME._files
 * from duckdb-wasm; recheck both when upgrading the dependency.
 */
export function createDatabaseWorkerSource(workerUrl: string): string {
  return `
importScripts(${JSON.stringify(workerUrl)});
const pendingFlushes = new Set();
const dispatch = globalThis.onmessage;
const post = globalThis.postMessage.bind(globalThis);

globalThis.onmessage = (event) => {
  if (event.data.type === 'FLUSH_FILES') {
    pendingFlushes.add(event.data.messageId);
  }
  return dispatch(event);
};

globalThis.postMessage = (response, transfer) => {
  if (response.type === 'OK' || response.type === 'ERROR') {
    const flushing = pendingFlushes.delete(response.requestId);
    if (flushing && response.type === 'OK') {
      try {
        const files = globalThis.DUCKDB_RUNTIME?._files;
        if (!files) throw new Error('DuckDB OPFS flush runtime is unavailable');
        for (const [name, handle] of files) {
          if (name.startsWith('opfs://')) handle.flush();
        }
      } catch (error) {
        response = {
          ...response,
          type: 'ERROR',
          data: { name: 'Error', message: String(error), stack: error?.stack },
        };
      }
    }
  }
  post(response, transfer);
};
`;
}
