import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { ref, effectScope } from 'vue';
import { useMarkdownShortcuts } from '../../src/composables/useMarkdownShortcuts';

function dispatchKey(
  textarea: HTMLTextAreaElement,
  handler: (e: KeyboardEvent) => void,
  key: string,
  opts: Partial<KeyboardEventInit> = {},
) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  handler(event);
  return event;
}

function setup(initial = '') {
  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);
  textarea.value = initial;
  textarea.selectionStart = initial.length;
  textarea.selectionEnd = initial.length;

  const content = ref(initial);
  const textareaRef = ref(textarea);
  const onContentChange = vi.fn((val: string) => {
    content.value = val;
  });
  const onToggleShortcuts = vi.fn();

  const scope = effectScope();
  const { handleKeydown } = scope.run(() =>
    useMarkdownShortcuts({
      textareaRef,
      content,
      onContentChange,
      onToggleShortcuts,
    }),
  )!;

  function setCursor(pos: number, end = pos) {
    textarea.selectionStart = pos;
    textarea.selectionEnd = end;
  }

  function press(key: string, opts: Partial<KeyboardEventInit> = {}) {
    dispatchKey(textarea, handleKeydown, key, opts);
  }

  return {
    textarea,
    content,
    onContentChange,
    onToggleShortcuts,
    press,
    setCursor,
    cleanup: () => {
      scope.stop();
      textarea.remove();
    },
  };
}

describe('useMarkdownShortcuts', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  test('auto-pairs [ into [] with cursor between', () => {
    ctx.setCursor(4);
    ctx.textarea.value = 'word';
    ctx.press('[');
    expect(ctx.textarea.value).toBe('word[]');
    expect(ctx.textarea.selectionStart).toBe(5);
    expect(ctx.onContentChange).toHaveBeenCalled();
  });

  test('auto-pairs backtick mid-word', () => {
    ctx.textarea.value = 'code';
    ctx.setCursor(4);
    ctx.press('`');
    expect(ctx.textarea.value).toBe('code``');
    expect(ctx.textarea.selectionStart).toBe(5);
  });

  test('skips * auto-pair at line start', () => {
    ctx.textarea.value = '';
    ctx.setCursor(0);
    ctx.press('*');
    expect(ctx.textarea.value).toBe('');
  });

  test('auto-pairs * mid-word', () => {
    ctx.textarea.value = 'ab';
    ctx.setCursor(2);
    ctx.press('*');
    expect(ctx.textarea.value).toBe('ab**');
    expect(ctx.textarea.selectionStart).toBe(3);
  });

  test('wraps selection with brackets', () => {
    ctx.textarea.value = 'sel';
    ctx.setCursor(0, 3);
    ctx.press('[');
    expect(ctx.textarea.value).toBe('[sel]');
    expect(ctx.textarea.selectionStart).toBe(1);
    expect(ctx.textarea.selectionEnd).toBe(4);
  });

  test('backspace deletes empty pair', () => {
    ctx.textarea.value = '[]';
    ctx.setCursor(1);
    ctx.press('Backspace');
    expect(ctx.textarea.value).toBe('');
    expect(ctx.textarea.selectionStart).toBe(0);
  });

  test('Enter continues unordered list', () => {
    ctx.textarea.value = '- item';
    ctx.setCursor(6);
    ctx.press('Enter');
    expect(ctx.textarea.value).toBe('- item\n- ');
    expect(ctx.textarea.selectionStart).toBe(9);
  });

  test('Enter continues checkbox list', () => {
    ctx.textarea.value = '- [ ] task';
    ctx.setCursor(10);
    ctx.press('Enter');
    expect(ctx.textarea.value).toBe('- [ ] task\n- [ ] ');
    expect(ctx.textarea.selectionStart).toBe(17);
  });

  test('Enter continues ordered list', () => {
    ctx.textarea.value = '1. first';
    ctx.setCursor(8);
    ctx.press('Enter');
    expect(ctx.textarea.value).toBe('1. first\n2. ');
    expect(ctx.textarea.selectionStart).toBe(12);
  });

  test('Enter on empty list marker exits list', () => {
    ctx.textarea.value = '- ';
    ctx.setCursor(2);
    ctx.press('Enter');
    expect(ctx.textarea.value).toBe('');
    expect(ctx.textarea.selectionStart).toBe(0);
  });

  test('Enter auto-closes fenced code block', () => {
    ctx.textarea.value = '```js';
    ctx.setCursor(5);
    ctx.press('Enter');
    expect(ctx.textarea.value).toBe('```js\n\n```');
    expect(ctx.textarea.selectionStart).toBe(6);
  });

  test('Enter continues blockquote', () => {
    ctx.textarea.value = '> quote';
    ctx.setCursor(7);
    ctx.press('Enter');
    expect(ctx.textarea.value).toBe('> quote\n> ');
    expect(ctx.textarea.selectionStart).toBe(10);
  });

  test('Enter after horizontal rule adds blank line', () => {
    ctx.textarea.value = '---';
    ctx.setCursor(3);
    ctx.press('Enter');
    expect(ctx.textarea.value).toBe('---\n\n');
    expect(ctx.textarea.selectionStart).toBe(5);
  });

  test('Cmd+B wraps selection in bold', () => {
    ctx.textarea.value = 'hello';
    ctx.setCursor(0, 5);
    ctx.press('b', { metaKey: true });
    expect(ctx.textarea.value).toBe('**hello**');
    expect(ctx.textarea.selectionStart).toBe(2);
    expect(ctx.textarea.selectionEnd).toBe(7);
  });

  test('Cmd+K inserts link syntax', () => {
    ctx.textarea.value = 'link';
    ctx.setCursor(0, 4);
    ctx.press('k', { metaKey: true });
    expect(ctx.textarea.value).toBe('[link](url)');
    expect(ctx.textarea.selectionStart).toBe(7);
    expect(ctx.textarea.selectionEnd).toBe(10);
  });

  test('Alt+X toggles checkbox', () => {
    ctx.textarea.value = '- [ ] todo';
    ctx.setCursor(5);
    ctx.press('x', { altKey: true });
    expect(ctx.textarea.value).toBe('- [x] todo');
  });

  test('Cmd+/ opens shortcuts catalog', () => {
    ctx.press('/', { metaKey: true });
    expect(ctx.onToggleShortcuts).toHaveBeenCalled();
    expect(ctx.textarea.value).toBe('');
  });
});
