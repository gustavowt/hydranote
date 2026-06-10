import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

// Node 22+ ships a native `localStorage` global that shadows
// `window.localStorage` from jsdom and is broken in this env (its prototype
// methods come back as `undefined` on bare `localStorage.setItem(...)` calls).
// Replace the global with an in-memory polyfill BEFORE any service module is
// imported, so production code that does `localStorage.setItem(...)` works.
{
  const store = new Map<string, string>();
  const polyfill: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: polyfill,
    writable: true,
    configurable: true,
  });
}

// llmService transitively imports localModelService which pulls Electron-only
// runtime modules. Stub it before the import chain resolves.
vi.mock('../../src/services/localModelService', () => ({
  isLocalModelsAvailable: () => false,
  runInference: vi.fn(),
  getRuntimeStatus: vi.fn(),
  loadModel: vi.fn(),
}));

import {
  getOllamaRequestConfig,
  getOllamaModels,
  chatCompletion,
  chatCompletionStreaming,
  saveSettings,
  loadSettings,
} from '../../src/services/llmService';
import {
  generateEmbedding,
  saveIndexerSettings,
} from '../../src/services/embeddingService';
import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_INDEXER_SETTINGS,
  OLLAMA_CLOUD_BASE_URL,
} from '../../src/types';

const fetchMock = vi.fn();

const STORAGE_KEYS = ['hydranote_llm_settings', 'hydranote_indexer_settings'];

function clearTestStorage() {
  for (const key of STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  clearTestStorage();
});

afterEach(() => {
  clearTestStorage();
});

function makeJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  } as unknown as Response;
}

// ============================================================================
// Local-only chat path
// ============================================================================
//
// The chat Ollama provider is local-daemon-only. Cloud-tagged models
// (`*-cloud`) work because the local Ollama daemon proxies them to
// ollama.com after the user runs `ollama signin` on their machine.
// HydraNote always talks to the configured local URL.

describe('getOllamaRequestConfig', () => {
  test('returns the configured baseUrl with no Authorization header in local mode', () => {
    const result = getOllamaRequestConfig({
      mode: 'local',
      baseUrl: 'http://localhost:11434',
      apiKey: '',
    });

    expect(result.baseUrl).toBe('http://localhost:11434');
    expect(result.headers['Content-Type']).toBe('application/json');
    expect(result.headers.Authorization).toBeUndefined();
  });

  // The 'cloud' branch is preserved on the helper for the embeddings indexer
  // (which still has its own local/cloud discriminator). The chat path can
  // never reach it because `loadSettings` migrates cloud→local on read.
  test('still routes to ollama.com when callers explicitly pass mode:"cloud" (used by embeddings indexer)', () => {
    const result = getOllamaRequestConfig({
      mode: 'cloud',
      baseUrl: 'http://localhost:11434',
      apiKey: 'sk-cloud-key',
    });

    expect(result.baseUrl).toBe(OLLAMA_CLOUD_BASE_URL);
    expect(result.headers.Authorization).toBe('Bearer sk-cloud-key');
  });
});

describe('getOllamaModels', () => {
  test('legacy string baseUrl call hits the local tags endpoint', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ models: [{ name: 'llama3.2' }] }));

    const models = await getOllamaModels('http://localhost:11434');

    expect(models).toEqual(['llama3.2']);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    const sentHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBeUndefined();
  });
});

describe('chatCompletion - Ollama (local-only)', () => {
  test('posts to the configured local URL with no auth header', async () => {
    saveSettings({
      ...DEFAULT_LLM_SETTINGS,
      provider: 'ollama',
      ollama: {
        mode: 'local',
        baseUrl: 'http://localhost:11434',
        apiKey: '',
        model: 'llama3.2',
      },
    });

    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        message: { content: 'hi from local' },
        done: true,
      }),
    );

    const result = await chatCompletion({
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.content).toBe('hi from local');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
    const sentHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBeUndefined();
  });

  test('cloud-tagged model name (`*-cloud`) is sent to the local URL — the daemon does the proxying', async () => {
    saveSettings({
      ...DEFAULT_LLM_SETTINGS,
      provider: 'ollama',
      ollama: {
        mode: 'local',
        baseUrl: 'http://localhost:11434',
        apiKey: '',
        model: 'qwen3-coder:480b-cloud',
      },
    });

    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        message: { content: 'hi via local-proxied cloud model' },
        done: true,
      }),
    );

    const result = await chatCompletion({
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.content).toBe('hi via local-proxied cloud model');
    // Crucially, the renderer NEVER hits ollama.com directly — the local
    // daemon at localhost:11434 handles the cloud proxy when configured
    // with `ollama signin`.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('ollama.com');
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.model).toBe('qwen3-coder:480b-cloud');
  });

  test('throws a clear error when baseUrl is missing', async () => {
    saveSettings({
      ...DEFAULT_LLM_SETTINGS,
      provider: 'ollama',
      ollama: {
        mode: 'local',
        baseUrl: '',
        apiKey: '',
        model: 'llama3.2',
      },
    });

    await expect(
      chatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/Ollama URL not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Cloud → local migration in loadSettings
// ============================================================================
//
// Older builds shipped an explicit Ollama "Cloud" mode. The new model is
// local-daemon-only because the local daemon transparently proxies cloud
// models. On load, persisted `mode: 'cloud'` configurations are migrated
// in-place. The model name is preserved (cloud-tagged models keep working
// via the local daemon) and `apiKey` stays on disk dormant (preserved to
// avoid silent data loss; no longer read or sent on requests).

describe('loadSettings - Cloud → local migration', () => {
  test('migrates persisted mode:"cloud" to mode:"local" while preserving the model name', () => {
    localStorage.setItem(
      'hydranote_llm_settings',
      JSON.stringify({
        provider: 'ollama',
        ollama: {
          mode: 'cloud',
          baseUrl: '',
          apiKey: 'sk-old-cloud-key',
          model: 'qwen3-coder:480b-cloud',
        },
      }),
    );

    const settings = loadSettings();

    expect(settings.ollama.mode).toBe('local');
    // Empty baseUrl is filled in with the localhost default so the daemon
    // is reachable out of the box.
    expect(settings.ollama.baseUrl).toBe('http://localhost:11434');
    // Model name is preserved — `*-cloud` continues to work via local proxy.
    expect(settings.ollama.model).toBe('qwen3-coder:480b-cloud');
    // apiKey is preserved on disk (dormant) to avoid silent data loss.
    expect(settings.ollama.apiKey).toBe('sk-old-cloud-key');
  });

  test('does not overwrite a non-empty baseUrl when migrating', () => {
    localStorage.setItem(
      'hydranote_llm_settings',
      JSON.stringify({
        provider: 'ollama',
        ollama: {
          mode: 'cloud',
          baseUrl: 'http://my-remote-daemon:11434',
          apiKey: 'unused',
          model: 'gpt-oss:120b-cloud',
        },
      }),
    );

    const settings = loadSettings();

    expect(settings.ollama.mode).toBe('local');
    expect(settings.ollama.baseUrl).toBe('http://my-remote-daemon:11434');
    expect(settings.ollama.model).toBe('gpt-oss:120b-cloud');
  });

  test('leaves mode:"local" configurations untouched', () => {
    localStorage.setItem(
      'hydranote_llm_settings',
      JSON.stringify({
        provider: 'ollama',
        ollama: {
          mode: 'local',
          baseUrl: 'http://localhost:11434',
          apiKey: '',
          model: 'llama3.2',
        },
      }),
    );

    const settings = loadSettings();

    expect(settings.ollama.mode).toBe('local');
    expect(settings.ollama.baseUrl).toBe('http://localhost:11434');
    expect(settings.ollama.model).toBe('llama3.2');
    expect(settings.ollama.apiKey).toBe('');
  });
});

// ============================================================================
// Embedding indexer Ollama (still has local + cloud modes)
// ============================================================================
//
// The embeddings indexer keeps its own `mode: 'local' | 'cloud'`
// discriminator on `OllamaEmbeddingConfig`. The cloud branch routes
// through the Electron `web:fetch` IPC bridge to bypass renderer CORS
// when running under `capacitor-electron://-`.

describe('generateEmbedding - Ollama', () => {
  test('local mode hits the local embeddings endpoint without auth header', async () => {
    saveIndexerSettings({
      ...DEFAULT_INDEXER_SETTINGS,
      provider: 'ollama',
      ollama: {
        mode: 'local',
        baseUrl: 'http://localhost:11434',
        apiKey: '',
        model: 'nomic-embed-text',
      },
    });

    fetchMock.mockResolvedValueOnce(makeJsonResponse({ embedding: [0.1, 0.2, 0.3] }));

    const vec = await generateEmbedding('hello world');

    expect(vec).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/embeddings',
      expect.objectContaining({ method: 'POST' }),
    );
    const sentHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBeUndefined();
  });

  test('cloud mode hits the cloud embeddings endpoint with bearer token', async () => {
    saveIndexerSettings({
      ...DEFAULT_INDEXER_SETTINGS,
      provider: 'ollama',
      ollama: {
        mode: 'cloud',
        baseUrl: 'http://localhost:11434',
        apiKey: 'embed-token',
        model: 'nomic-embed-text',
      },
    });

    fetchMock.mockResolvedValueOnce(makeJsonResponse({ embedding: [0.4, 0.5] }));

    const vec = await generateEmbedding('hello world');

    expect(vec).toEqual([0.4, 0.5]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${OLLAMA_CLOUD_BASE_URL}/api/embeddings`,
      expect.objectContaining({ method: 'POST' }),
    );
    const sentHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBe('Bearer embed-token');
  });
});

// ============================================================================
// Electron IPC routing (still used by embeddings indexer cloud mode)
// ============================================================================
//
// Embeddings cloud mode targets `https://ollama.com`, which rejects the
// `capacitor-electron://-` origin via CORS. When running under Electron,
// `ollamaJsonFetch` routes through `window.electronAPI.web.fetch` so the
// request is performed by the main process where browser CORS does not
// apply. Chat does not use IPC because it always targets localhost.

describe('Electron IPC routing - embeddings cloud mode', () => {
  const ipcFetchMock = vi.fn();
  let originalElectronAPI: unknown;

  beforeEach(() => {
    ipcFetchMock.mockReset();
    originalElectronAPI = (globalThis as { window?: { electronAPI?: unknown } }).window?.electronAPI;
    Object.defineProperty(window, 'electronAPI', {
      value: { web: { fetch: ipcFetchMock } },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      value: originalElectronAPI,
      writable: true,
      configurable: true,
    });
  });

  test('generateEmbedding routes Ollama Cloud requests through electronAPI.web.fetch (not globalThis.fetch)', async () => {
    saveIndexerSettings({
      ...DEFAULT_INDEXER_SETTINGS,
      provider: 'ollama',
      ollama: {
        mode: 'cloud',
        baseUrl: 'http://localhost:11434',
        apiKey: 'embed-token',
        model: 'nomic-embed-text',
      },
    });

    ipcFetchMock.mockResolvedValueOnce({
      success: true,
      status: 200,
      headers: {},
      body: JSON.stringify({ embedding: [0.7, 0.8] }),
      finalUrl: `${OLLAMA_CLOUD_BASE_URL}/api/embeddings`,
    });

    const vec = await generateEmbedding('hello via ipc');

    expect(vec).toEqual([0.7, 0.8]);
    expect(ipcFetchMock).toHaveBeenCalledTimes(1);
    expect(ipcFetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${OLLAMA_CLOUD_BASE_URL}/api/embeddings`,
        method: 'POST',
      }),
    );
    const ipcArgs = ipcFetchMock.mock.calls[0][0] as { headers: Record<string, string> };
    expect(ipcArgs.headers.Authorization).toBe('Bearer embed-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Electron IPC routing - chat (local daemon) path
// ============================================================================
//
// The local Ollama daemon rejects the renderer's `capacitor-electron://-`
// origin with 403. Under Electron, all chat-side Ollama calls must route
// through the main-process bridge (`web.fetch` for non-streaming + tags,
// `web.fetchStream` for streaming) so the request carries no browser origin.

describe('Electron IPC routing - Ollama chat', () => {
  const ipcFetchMock = vi.fn();
  const ipcFetchStreamMock = vi.fn();
  let originalElectronAPI: unknown;

  beforeEach(() => {
    ipcFetchMock.mockReset();
    ipcFetchStreamMock.mockReset();
    originalElectronAPI = (globalThis as { window?: { electronAPI?: unknown } }).window?.electronAPI;
    Object.defineProperty(window, 'electronAPI', {
      value: { web: { fetch: ipcFetchMock, fetchStream: ipcFetchStreamMock } },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      value: originalElectronAPI,
      writable: true,
      configurable: true,
    });
  });

  test('non-streaming chat routes through electronAPI.web.fetch (not globalThis.fetch)', async () => {
    saveSettings({
      ...DEFAULT_LLM_SETTINGS,
      provider: 'ollama',
      ollama: { mode: 'local', baseUrl: 'http://localhost:11434', apiKey: '', model: 'qwen3-coder:480b-cloud' },
    });

    ipcFetchMock.mockResolvedValueOnce({
      success: true,
      status: 200,
      headers: {},
      body: JSON.stringify({ message: { content: 'hi via ipc' }, done: true }),
      finalUrl: 'http://localhost:11434/api/chat',
    });

    const result = await chatCompletion({ messages: [{ role: 'user', content: 'hello' }] });

    expect(result.content).toBe('hi via ipc');
    expect(ipcFetchMock).toHaveBeenCalledTimes(1);
    expect(ipcFetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://localhost:11434/api/chat', method: 'POST' }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('getOllamaModels routes through electronAPI.web.fetch', async () => {
    ipcFetchMock.mockResolvedValueOnce({
      success: true,
      status: 200,
      headers: {},
      body: JSON.stringify({ models: [{ name: 'qwen3-coder:480b-cloud' }, { name: 'llama3.2' }] }),
      finalUrl: 'http://localhost:11434/api/tags',
    });

    const models = await getOllamaModels('http://localhost:11434');

    expect(models).toEqual(['qwen3-coder:480b-cloud', 'llama3.2']);
    expect(ipcFetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://localhost:11434/api/tags', method: 'GET' }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('streaming chat routes through electronAPI.web.fetchStream and assembles chunked NDJSON', async () => {
    saveSettings({
      ...DEFAULT_LLM_SETTINGS,
      provider: 'ollama',
      ollama: { mode: 'local', baseUrl: 'http://localhost:11434', apiKey: '', model: 'qwen3-coder:480b-cloud' },
    });

    // Simulate the main process delivering NDJSON across arbitrary chunk
    // boundaries (a token split mid-line), then resolving on stream end.
    ipcFetchStreamMock.mockImplementationOnce(async (_options, onChunk: (c: string) => void) => {
      onChunk('{"message":{"content":"Hel');
      onChunk('lo"},"done":false}\n');
      onChunk('{"message":{"content":" world"},"done":true,"eval_count":2,"prompt_eval_count":5}\n');
      return { success: true, status: 200 };
    });

    const deltas: string[] = [];
    const result = await chatCompletionStreaming(
      { messages: [{ role: 'user', content: 'hello' }] },
      (chunk, done) => { if (!done && chunk) deltas.push(chunk); },
    );

    expect(deltas).toEqual(['Hello', ' world']);
    expect(result.content).toBe('Hello world');
    expect(result.usage?.totalTokens).toBe(7);
    expect(ipcFetchStreamMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('streaming chat surfaces a clear error when the daemon rejects the request', async () => {
    saveSettings({
      ...DEFAULT_LLM_SETTINGS,
      provider: 'ollama',
      ollama: { mode: 'local', baseUrl: 'http://localhost:11434', apiKey: '', model: 'llama3.2' },
    });

    ipcFetchStreamMock.mockResolvedValueOnce({ success: false, status: 403, error: 'Forbidden' });

    await expect(
      chatCompletionStreaming({ messages: [{ role: 'user', content: 'hi' }] }, () => {}),
    ).rejects.toThrow(/Ollama API error/i);
  });
});
