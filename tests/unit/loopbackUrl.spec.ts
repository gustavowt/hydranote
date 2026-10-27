import { describe, expect, test } from 'vitest';
import { rewriteLoopbackUrl } from '../../electron/src/loopbackUrl';

describe('rewriteLoopbackUrl', () => {
  test('rewrites localhost to 127.0.0.1 with port and path', () => {
    expect(rewriteLoopbackUrl('http://localhost:11434/api/tags')).toBe('http://127.0.0.1:11434/api/tags');
  });

  test('rewrites uppercase/mixed-case localhost', () => {
    expect(rewriteLoopbackUrl('http://LocalHost:11434/api/version')).toBe('http://127.0.0.1:11434/api/version');
  });

  test('rewrites localhost with query parameters and hash', () => {
    expect(rewriteLoopbackUrl('http://localhost:11434/api/tags?verbose=true#section')).toBe(
      'http://127.0.0.1:11434/api/tags?verbose=true#section'
    );
  });

  test('rewrites https localhost', () => {
    expect(rewriteLoopbackUrl('https://localhost:8443/api')).toBe('https://127.0.0.1:8443/api');
  });

  test('does not modify 127.0.0.1 URLs', () => {
    expect(rewriteLoopbackUrl('http://127.0.0.1:11434/api/tags')).toBe('http://127.0.0.1:11434/api/tags');
  });

  test('does not modify external hostnames', () => {
    expect(rewriteLoopbackUrl('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
  });

  test('returns malformed input untouched without throwing', () => {
    expect(rewriteLoopbackUrl('not-a-valid-url')).toBe('not-a-valid-url');
  });
});
