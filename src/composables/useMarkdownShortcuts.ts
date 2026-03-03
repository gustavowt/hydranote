import { type Ref, watch, onUnmounted } from 'vue';

type ContentUpdater = (newValue: string) => void;

export interface ShortcutEntry {
  keys: string;
  description: string;
  category: 'lists' | 'formatting' | 'editing';
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? 'Cmd' : 'Ctrl';

export const SHORTCUTS_CATALOG: ShortcutEntry[] = [
  { keys: 'Enter', description: 'Continue list / blockquote / auto-close code fence', category: 'lists' },
  { keys: 'Tab', description: 'Indent line or selection', category: 'lists' },
  { keys: 'Shift+Tab', description: 'Outdent line or selection', category: 'lists' },
  { keys: 'Alt+X', description: 'Toggle checkbox checked / unchecked', category: 'lists' },

  { keys: `${MOD}+B`, description: 'Bold', category: 'formatting' },
  { keys: `${MOD}+I`, description: 'Italic', category: 'formatting' },
  { keys: `${MOD}+K`, description: 'Insert link', category: 'formatting' },
  { keys: `${MOD}+Shift+K`, description: 'Inline code', category: 'formatting' },
  { keys: '*, `, ~, [, (', description: 'Auto-pair & wrap selection', category: 'formatting' },
  { keys: 'Backspace', description: 'Delete empty auto-pair', category: 'formatting' },

  { keys: 'Alt+Up', description: 'Move line up', category: 'editing' },
  { keys: 'Alt+Down', description: 'Move line down', category: 'editing' },
  { keys: `${MOD}+Shift+D`, description: 'Duplicate line', category: 'editing' },
  { keys: `${MOD}+Shift+Backspace`, description: 'Delete line', category: 'editing' },
  { keys: `${MOD}+/`, description: 'Show keyboard shortcuts', category: 'editing' },
];

export const SHORTCUT_CATEGORIES: Record<ShortcutEntry['category'], string> = {
  lists: 'Lists & Blocks',
  formatting: 'Formatting',
  editing: 'Editing',
};

interface UseMarkdownShortcutsOptions {
  textareaRef: Ref<HTMLTextAreaElement | null>;
  content: Ref<string>;
  onContentChange: ContentUpdater;
  onToggleShortcuts?: () => void;
}

const LIST_MARKER_RE = /^(\s*)([-*+])(\s+\[[ x]\])?\s(.*)$/;
const ORDERED_LIST_RE = /^(\s*)(\d+)(\.)\s(.*)$/;
const BLOCKQUOTE_RE = /^(\s*(?:>\s*)+)(.*)/;
const FENCED_CODE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const HR_RE = /^(\s*)([-*_])\2{2,}\s*$/;
const CHECKBOX_RE = /^(\s*[-*+]\s+\[)([ x])(\].*)$/;

const PAIR_CHARS: Record<string, string> = {
  '*': '*',
  '`': '`',
  '~': '~',
  '[': ']',
  '(': ')',
};

const CLOSE_SKIP: Record<string, string> = {
  ']': '[',
  ')': '(',
};

function getLineAt(text: string, pos: number): { line: string; lineStart: number; lineEnd: number } {
  let lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = text.indexOf('\n', pos);
  if (lineEnd === -1) lineEnd = text.length;
  return { line: text.substring(lineStart, lineEnd), lineStart, lineEnd };
}

function replaceRange(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number,
  replacement: string,
): void {
  const before = textarea.value.substring(0, start);
  const after = textarea.value.substring(end);
  textarea.value = before + replacement + after;
}

function setCursor(textarea: HTMLTextAreaElement, pos: number): void {
  textarea.selectionStart = pos;
  textarea.selectionEnd = pos;
}

function setSelection(textarea: HTMLTextAreaElement, start: number, end: number): void {
  textarea.selectionStart = start;
  textarea.selectionEnd = end;
}

// ─── Enter Key: List & Blockquote Continuation ──────────────────────

function handleEnter(e: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
  const { selectionStart, selectionEnd, value } = textarea;
  if (selectionStart !== selectionEnd) return false;

  const { line, lineStart } = getLineAt(value, selectionStart);

  // Ordered list
  const orderedMatch = line.match(ORDERED_LIST_RE);
  if (orderedMatch) {
    const [, indent, numStr, dot, text] = orderedMatch;
    if (text.trim() === '') {
      e.preventDefault();
      replaceRange(textarea, lineStart, lineStart + line.length, '');
      setCursor(textarea, lineStart);
      return true;
    }
    e.preventDefault();
    const nextNum = parseInt(numStr, 10) + 1;
    const marker = `\n${indent}${nextNum}${dot} `;
    replaceRange(textarea, selectionStart, selectionStart, marker);
    setCursor(textarea, selectionStart + marker.length);
    return true;
  }

  // Unordered / checkbox list
  const listMatch = line.match(LIST_MARKER_RE);
  if (listMatch) {
    const [, indent, bullet, checkbox, text] = listMatch;
    if (text.trim() === '') {
      e.preventDefault();
      replaceRange(textarea, lineStart, lineStart + line.length, '');
      setCursor(textarea, lineStart);
      return true;
    }
    e.preventDefault();
    const checkboxPart = checkbox ? ' [ ]' : '';
    const marker = `\n${indent}${bullet}${checkboxPart} `;
    replaceRange(textarea, selectionStart, selectionStart, marker);
    setCursor(textarea, selectionStart + marker.length);
    return true;
  }

  // Blockquote
  const bqMatch = line.match(BLOCKQUOTE_RE);
  if (bqMatch) {
    const [, prefix, text] = bqMatch;
    if (text.trim() === '') {
      e.preventDefault();
      replaceRange(textarea, lineStart, lineStart + line.length, '');
      setCursor(textarea, lineStart);
      return true;
    }
    e.preventDefault();
    const marker = `\n${prefix}`;
    replaceRange(textarea, selectionStart, selectionStart, marker);
    setCursor(textarea, selectionStart + marker.length);
    return true;
  }

  // Fenced code block auto-close: ``` or ~~~ + Enter inserts closing fence
  const fenceMatch = line.match(FENCED_CODE_RE);
  if (fenceMatch) {
    const [, indent, fence] = fenceMatch;
    const fenceChar = fence[0];
    const fenceLen = fence.length;
    const closingFence = fenceChar.repeat(fenceLen);
    // Only auto-close if there's no matching closing fence below
    const textBelow = value.substring(lineStart + line.length);
    const closingRe = new RegExp(`^\\s*${fenceChar === '`' ? '`' : '~'}{${fenceLen},}\\s*$`, 'm');
    if (!closingRe.test(textBelow)) {
      e.preventDefault();
      const insert = `\n${indent}\n${indent}${closingFence}`;
      replaceRange(textarea, selectionStart, selectionStart, insert);
      setCursor(textarea, selectionStart + 1 + indent.length);
      return true;
    }
  }

  // Horizontal rule: --- or *** or ___ + Enter adds blank line after
  const hrMatch = line.match(HR_RE);
  if (hrMatch && selectionStart === lineStart + line.length) {
    e.preventDefault();
    const insert = '\n\n';
    replaceRange(textarea, selectionStart, selectionStart, insert);
    setCursor(textarea, selectionStart + insert.length);
    return true;
  }

  return false;
}

// ─── Tab / Shift+Tab: Indentation ───────────────────────────────────

const INDENT = '  ';

function handleTab(e: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
  const { selectionStart, selectionEnd, value } = textarea;
  const hasSelection = selectionStart !== selectionEnd;

  if (hasSelection) {
    e.preventDefault();
    const firstLineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const lastLineEnd = value.indexOf('\n', selectionEnd - 1);
    const blockEnd = lastLineEnd === -1 ? value.length : lastLineEnd;
    const block = value.substring(firstLineStart, blockEnd);
    const lines = block.split('\n');

    let newLines: string[];
    let deltaFirst = 0;
    let deltaTotal = 0;

    if (e.shiftKey) {
      newLines = lines.map((l, i) => {
        if (l.startsWith(INDENT)) {
          const stripped = l.substring(INDENT.length);
          if (i === 0) deltaFirst = -INDENT.length;
          deltaTotal -= INDENT.length;
          return stripped;
        } else if (l.startsWith('\t')) {
          const stripped = l.substring(1);
          if (i === 0) deltaFirst = -1;
          deltaTotal -= 1;
          return stripped;
        }
        return l;
      });
    } else {
      newLines = lines.map((l, i) => {
        if (i === 0) deltaFirst = INDENT.length;
        deltaTotal += INDENT.length;
        return INDENT + l;
      });
    }

    const newBlock = newLines.join('\n');
    replaceRange(textarea, firstLineStart, blockEnd, newBlock);

    const newStart = Math.max(firstLineStart, selectionStart + deltaFirst);
    const newEnd = selectionEnd + deltaTotal;
    setSelection(textarea, newStart, newEnd);
    return true;
  }

  // Single line (no selection)
  e.preventDefault();
  if (e.shiftKey) {
    const { line, lineStart } = getLineAt(value, selectionStart);
    if (line.startsWith(INDENT)) {
      replaceRange(textarea, lineStart, lineStart + INDENT.length, '');
      setCursor(textarea, Math.max(lineStart, selectionStart - INDENT.length));
    } else if (line.startsWith('\t')) {
      replaceRange(textarea, lineStart, lineStart + 1, '');
      setCursor(textarea, Math.max(lineStart, selectionStart - 1));
    }
  } else {
    replaceRange(textarea, selectionStart, selectionStart, INDENT);
    setCursor(textarea, selectionStart + INDENT.length);
  }
  return true;
}

// ─── Auto-Pairing ───────────────────────────────────────────────────

function handleAutoPair(e: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
  const char = e.key;
  const { selectionStart, selectionEnd, value } = textarea;

  // Skip-over for closing brackets: typing ] when next char is ] just moves past it
  if (CLOSE_SKIP[char] && selectionStart === selectionEnd) {
    const nextChar = value[selectionStart];
    if (nextChar === char) {
      e.preventDefault();
      setCursor(textarea, selectionStart + 1);
      return true;
    }
  }

  const closer = PAIR_CHARS[char];
  if (!closer) return false;

  // For symmetric chars (*, ~, `), skip auto-pair at line start or after whitespace
  // to avoid interfering with list markers (*, +, -) and other markdown syntax
  if (char === closer && selectionStart === selectionEnd) {
    const prevChar = selectionStart > 0 ? value[selectionStart - 1] : '\n';
    if (prevChar === '\n' || prevChar === ' ' || prevChar === '\t' || selectionStart === 0) {
      return false;
    }
  }

  // Closing char typed when it's already the next char -> just move cursor forward
  if (selectionStart === selectionEnd) {
    const nextChar = value[selectionStart];
    if (char === closer && nextChar === closer) {
      e.preventDefault();
      setCursor(textarea, selectionStart + 1);
      return true;
    }
  }

  // Wrap selection
  if (selectionStart !== selectionEnd) {
    e.preventDefault();
    const selected = value.substring(selectionStart, selectionEnd);
    const wrapped = char + selected + closer;
    replaceRange(textarea, selectionStart, selectionEnd, wrapped);
    setSelection(textarea, selectionStart + 1, selectionEnd + 1);
    return true;
  }

  // Insert pair at cursor
  e.preventDefault();
  replaceRange(textarea, selectionStart, selectionStart, char + closer);
  setCursor(textarea, selectionStart + 1);
  return true;
}

// ─── Backspace: Delete Empty Pairs ──────────────────────────────────

function handleBackspace(e: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
  const { selectionStart, selectionEnd, value } = textarea;
  if (selectionStart !== selectionEnd || selectionStart === 0) return false;

  const before = value[selectionStart - 1];
  const after = value[selectionStart];

  if (PAIR_CHARS[before] === after) {
    e.preventDefault();
    replaceRange(textarea, selectionStart - 1, selectionStart + 1, '');
    setCursor(textarea, selectionStart - 1);
    return true;
  }

  return false;
}

// ─── Checkbox Toggle (Alt+X) ─────────────────────────────────────────

function handleCheckboxToggle(e: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
  if (!e.altKey || e.key !== 'x') return false;

  const { selectionStart, value } = textarea;
  const { line, lineStart } = getLineAt(value, selectionStart);
  const cbMatch = line.match(CHECKBOX_RE);
  if (!cbMatch) return false;

  e.preventDefault();
  const [, before, state, after] = cbMatch;
  const newState = state === ' ' ? 'x' : ' ';
  const newLine = before + newState + after;
  replaceRange(textarea, lineStart, lineStart + line.length, newLine);
  setCursor(textarea, selectionStart);
  return true;
}

// ─── Move Line Up/Down (Alt+Arrow) ──────────────────────────────────

function handleMoveLine(e: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return false;

  const { selectionStart, selectionEnd, value } = textarea;
  const firstLineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  let lastLineEnd = value.indexOf('\n', selectionEnd);
  if (lastLineEnd === -1) lastLineEnd = value.length;

  const block = value.substring(firstLineStart, lastLineEnd);

  if (e.key === 'ArrowUp') {
    if (firstLineStart === 0) return false;
    e.preventDefault();
    const prevLineStart = value.lastIndexOf('\n', firstLineStart - 2) + 1;
    const prevLine = value.substring(prevLineStart, firstLineStart - 1);
    const newText = block + '\n' + prevLine;
    replaceRange(textarea, prevLineStart, lastLineEnd, newText);
    const offset = firstLineStart - prevLineStart;
    setSelection(textarea, selectionStart - offset, selectionEnd - offset);
  } else {
    if (lastLineEnd >= value.length) return false;
    e.preventDefault();
    let nextLineEnd = value.indexOf('\n', lastLineEnd + 1);
    if (nextLineEnd === -1) nextLineEnd = value.length;
    const nextLine = value.substring(lastLineEnd + 1, nextLineEnd);
    const newText = nextLine + '\n' + block;
    replaceRange(textarea, firstLineStart, nextLineEnd, newText);
    const offset = nextLine.length + 1;
    setSelection(textarea, selectionStart + offset, selectionEnd + offset);
  }

  return true;
}

// ─── Duplicate Line (Cmd/Ctrl+Shift+D) ──────────────────────────────

function handleDuplicateLine(e: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
  const { selectionStart, selectionEnd, value } = textarea;
  const firstLineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  let lastLineEnd = value.indexOf('\n', selectionEnd);
  if (lastLineEnd === -1) lastLineEnd = value.length;

  const block = value.substring(firstLineStart, lastLineEnd);

  e.preventDefault();
  const insert = '\n' + block;
  replaceRange(textarea, lastLineEnd, lastLineEnd, insert);
  const offset = insert.length;
  setSelection(textarea, selectionStart + offset, selectionEnd + offset);
  return true;
}

// ─── Delete Line (Cmd/Ctrl+Shift+K) ─────────────────────────────────

function handleDeleteLine(e: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
  const { selectionStart, selectionEnd, value } = textarea;
  const firstLineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  let lastLineEnd = value.indexOf('\n', selectionEnd);

  if (lastLineEnd === -1) {
    // Last line in document — also remove the preceding newline if it exists
    const deleteStart = firstLineStart > 0 ? firstLineStart - 1 : 0;
    e.preventDefault();
    replaceRange(textarea, deleteStart, value.length, '');
    setCursor(textarea, deleteStart);
  } else {
    e.preventDefault();
    replaceRange(textarea, firstLineStart, lastLineEnd + 1, '');
    setCursor(textarea, firstLineStart);
  }
  return true;
}

// ─── Formatting Shortcuts (Cmd/Ctrl + B/I/K) ────────────────────────

function toggleWrap(
  textarea: HTMLTextAreaElement,
  wrapper: string,
  placeholder: string,
): void {
  const { selectionStart, selectionEnd, value } = textarea;
  const wLen = wrapper.length;

  if (selectionStart !== selectionEnd) {
    const selected = value.substring(selectionStart, selectionEnd);

    // Unwrap if already wrapped
    if (selected.startsWith(wrapper) && selected.endsWith(wrapper) && selected.length >= wLen * 2) {
      const unwrapped = selected.substring(wLen, selected.length - wLen);
      replaceRange(textarea, selectionStart, selectionEnd, unwrapped);
      setSelection(textarea, selectionStart, selectionStart + unwrapped.length);
      return;
    }

    // Check surrounding text for wrapper
    const outerBefore = value.substring(selectionStart - wLen, selectionStart);
    const outerAfter = value.substring(selectionEnd, selectionEnd + wLen);
    if (outerBefore === wrapper && outerAfter === wrapper) {
      replaceRange(textarea, selectionStart - wLen, selectionEnd + wLen, selected);
      setSelection(textarea, selectionStart - wLen, selectionEnd - wLen);
      return;
    }

    // Wrap selected text
    const wrapped = wrapper + selected + wrapper;
    replaceRange(textarea, selectionStart, selectionEnd, wrapped);
    setSelection(textarea, selectionStart + wLen, selectionEnd + wLen);
  } else {
    // No selection: insert wrapper + placeholder + wrapper
    const insert = wrapper + placeholder + wrapper;
    replaceRange(textarea, selectionStart, selectionStart, insert);
    setSelection(textarea, selectionStart + wLen, selectionStart + wLen + placeholder.length);
  }
}

function insertLink(textarea: HTMLTextAreaElement): void {
  const { selectionStart, selectionEnd, value } = textarea;

  if (selectionStart !== selectionEnd) {
    const selected = value.substring(selectionStart, selectionEnd);
    const linkSyntax = `[${selected}](url)`;
    replaceRange(textarea, selectionStart, selectionEnd, linkSyntax);
    // Select "url" for easy replacement
    const urlStart = selectionStart + selected.length + 3;
    setSelection(textarea, urlStart, urlStart + 3);
  } else {
    const linkSyntax = '[text](url)';
    replaceRange(textarea, selectionStart, selectionStart, linkSyntax);
    // Select "text" for easy replacement
    setSelection(textarea, selectionStart + 1, selectionStart + 5);
  }
}

function handleFormatShortcut(e: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return false;

  if (e.key === 'b') {
    e.preventDefault();
    toggleWrap(textarea, '**', 'bold');
    return true;
  }

  if (e.key === 'i') {
    e.preventDefault();
    toggleWrap(textarea, '*', 'italic');
    return true;
  }

  if (e.key === 'k' && e.shiftKey) {
    e.preventDefault();
    toggleWrap(textarea, '`', 'code');
    return true;
  }

  if (e.key === 'k' && !e.shiftKey) {
    e.preventDefault();
    insertLink(textarea);
    return true;
  }

  return false;
}

// ─── Main Composable ─────────────────────────────────────────────────

export function useMarkdownShortcuts(options: UseMarkdownShortcutsOptions) {
  const { textareaRef, content, onContentChange, onToggleShortcuts } = options;

  function syncContent(textarea: HTMLTextAreaElement) {
    content.value = textarea.value;
    onContentChange(textarea.value);
  }

  function handleKeydown(e: KeyboardEvent) {
    const textarea = textareaRef.value;
    if (!textarea) return;

    // Cmd/Ctrl + / → toggle shortcuts catalog (no textarea mutation)
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      e.preventDefault();
      onToggleShortcuts?.();
      return;
    }

    let handled = false;

    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      handled = handleEnter(e, textarea);
    } else if (e.key === 'Tab') {
      handled = handleTab(e, textarea);
    } else if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey) {
      handled = handleBackspace(e, textarea);
    } else if (e.altKey && e.key === 'x') {
      handled = handleCheckboxToggle(e, textarea);
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      handled = handleMoveLine(e, textarea);
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'd') {
      handled = handleDuplicateLine(e, textarea);
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Backspace') {
      handled = handleDeleteLine(e, textarea);
    } else if (e.metaKey || e.ctrlKey) {
      handled = handleFormatShortcut(e, textarea);
    } else if (PAIR_CHARS[e.key] || CLOSE_SKIP[e.key]) {
      handled = handleAutoPair(e, textarea);
    }

    if (handled) {
      syncContent(textarea);
    }
  }

  let currentTextarea: HTMLTextAreaElement | null = null;

  function attach(el: HTMLTextAreaElement | null) {
    if (currentTextarea) {
      currentTextarea.removeEventListener('keydown', handleKeydown);
    }
    currentTextarea = el;
    if (el) {
      el.addEventListener('keydown', handleKeydown);
    }
  }

  watch(textareaRef, (el) => {
    attach(el);
  }, { immediate: true });

  onUnmounted(() => {
    attach(null);
  });

  return { handleKeydown };
}
