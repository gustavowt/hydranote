import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('../../src/services/localModelService', () => ({
  isLocalModelsAvailable: () => false,
  runInference: vi.fn(),
  getRuntimeStatus: vi.fn(),
  loadModel: vi.fn(),
}));

import {
  chatCompletion,
  chatCompletionStreaming,
  saveSettings,
  testConnection,
} from '../../src/services/llmService';
import { DEFAULT_LLM_SETTINGS } from '../../src/types';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  localStorage.clear();
  saveSettings({
    ...DEFAULT_LLM_SETTINGS,
    provider: 'ollama',
    ollama: {
      ...DEFAULT_LLM_SETTINGS.ollama,
      baseUrl: 'http://127.0.0.1:11434',
      model: 'kimi-k2.6:cloud',
    },
  });
});

afterEach(() => {
  localStorage.clear();
});

describe('Ollama thinking stream', () => {
  test('forwards thinking chunks as reasoning and content as content', async () => {
    const streamBody = [
      '{"message":{"thinking":"Let me think"},"done":false}\n',
      '{"message":{"content":"Hello"},"done":false}\n',
      '{"message":{"content":" world"},"done":true,"eval_count":2,"prompt_eval_count":1}\n',
    ].join('');

    fetchMock.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: async () => {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: new TextEncoder().encode(streamBody) };
            },
            releaseLock: () => {},
          };
        },
      },
    });

    const chunks: Array<{ text: string; type?: string }> = [];
    await chatCompletionStreaming(
      { messages: [{ role: 'user', content: 'Hi' }] },
      (chunk, _done, type) => {
        if (chunk) chunks.push({ text: chunk, type });
      },
    );

    expect(chunks.some((c) => c.type === 'reasoning' && c.text.includes('Let me think'))).toBe(true);
    expect(chunks.some((c) => c.type === 'content' && c.text.includes('Hello'))).toBe(true);
  });
});

describe('Ollama non-stream thinking fallback', () => {
  test('returns thinking as content when content is empty', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        message: { thinking: '{"isComplete": true}' },
        done: true,
      }),
    } as unknown as Response);

    const response = await chatCompletion({
      messages: [{ role: 'user', content: 'Check completion' }],
    });

    expect(response.content).toBe('{"isComplete": true}');
  });
});

describe('testConnection empty content', () => {
  test('succeeds when model returns only thinking', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        message: { thinking: 'Only thinking tokens here' },
        done: true,
      }),
    } as unknown as Response);

    const result = await testConnection();

    expect(result.success).toBe(true);
    expect(result.message).toBe('Only thinking tokens here');
  });

  test('fails when model returns neither content nor thinking', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        message: {},
        done: true,
      }),
    } as unknown as Response);

    const result = await testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain('empty content');
  });
});
