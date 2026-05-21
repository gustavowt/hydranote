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
  saveSettings,
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

describe('getOllamaRequestConfig', () => {
  test('local mode uses configured baseUrl and no Authorization header', () => {
    const result = getOllamaRequestConfig({
      mode: 'local',
      baseUrl: 'http://localhost:11434',
      apiKey: '',
    });

    expect(result.baseUrl).toBe('http://localhost:11434');
    expect(result.headers['Content-Type']).toBe('application/json');
    expect(result.headers.Authorization).toBeUndefined();
  });

  test('cloud mode uses the fixed cloud URL and attaches a bearer token', () => {
    const result = getOllamaRequestConfig({
      mode: 'cloud',
      baseUrl: 'http://localhost:11434',
      apiKey: 'sk-cloud-key',
    });

    expect(result.baseUrl).toBe(OLLAMA_CLOUD_BASE_URL);
    expect(result.headers.Authorization).toBe('Bearer sk-cloud-key');
  });

  test('cloud mode without an apiKey omits the Authorization header', () => {
    const result = getOllamaRequestConfig({
      mode: 'cloud',
      baseUrl: 'http://localhost:11434',
      apiKey: '',
    });

    expect(result.baseUrl).toBe(OLLAMA_CLOUD_BASE_URL);
    expect(result.headers.Authorization).toBeUndefined();
  });
});

describe('getOllamaModels', () => {
  test('legacy string baseUrl call still works and hits the local tags endpoint', async () => {
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

  test('config-object call in cloud mode sends bearer token to the cloud URL', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ models: [{ name: 'gpt-oss:120b-cloud' }] }));

    const models = await getOllamaModels({
      mode: 'cloud',
      baseUrl: 'http://localhost:11434',
      apiKey: 'test-token',
    });

    expect(models).toEqual(['gpt-oss:120b-cloud']);
    expect(fetchMock).toHaveBeenCalledWith(
      `${OLLAMA_CLOUD_BASE_URL}/api/tags`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    const sentHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBe('Bearer test-token');
  });
});

describe('chatCompletion - Ollama', () => {
  test('local mode posts to configured URL with no auth header', async () => {
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

  test('cloud mode posts to https://ollama.com with bearer token', async () => {
    saveSettings({
      ...DEFAULT_LLM_SETTINGS,
      provider: 'ollama',
      ollama: {
        mode: 'cloud',
        baseUrl: 'http://localhost:11434',
        apiKey: 'cloud-token',
        model: 'gpt-oss:120b-cloud',
      },
    });

    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        message: { content: 'hi from cloud' },
        done: true,
      }),
    );

    const result = await chatCompletion({
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.content).toBe('hi from cloud');
    expect(fetchMock).toHaveBeenCalledWith(
      `${OLLAMA_CLOUD_BASE_URL}/api/chat`,
      expect.objectContaining({ method: 'POST' }),
    );
    const sentHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBe('Bearer cloud-token');
  });

  test('cloud mode without apiKey throws a clear configuration error', async () => {
    saveSettings({
      ...DEFAULT_LLM_SETTINGS,
      provider: 'ollama',
      ollama: {
        mode: 'cloud',
        baseUrl: 'http://localhost:11434',
        apiKey: '',
        model: 'gpt-oss:120b-cloud',
      },
    });

    await expect(
      chatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/Ollama Cloud API key not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

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
