import { type Ref, watch, onUnmounted } from 'vue';
import {
  filterSlashCommands,
  type SlashCommand,
} from '@/composables/markdownSlashCommands';

export interface SlashMenuState {
  visible: boolean;
  query: string;
  startIndex: number;
  commands: SlashCommand[];
  anchorRect: DOMRect | null;
}

interface UseEditorSlashCommandsOptions {
  textareaRef: Ref<HTMLTextAreaElement | null>;
  content: Ref<string>;
  onContentChange: (value: string) => void;
  onMenuChange: (state: SlashMenuState) => void;
}

const CLOSED_STATE: SlashMenuState = {
  visible: false,
  query: '',
  startIndex: -1,
  commands: [],
  anchorRect: null,
};

function getCaretRect(textarea: HTMLTextAreaElement): DOMRect {
  const { selectionStart } = textarea;
  const style = window.getComputedStyle(textarea);
  const div = document.createElement('div');
  const span = document.createElement('span');
  const textBefore = textarea.value.substring(0, selectionStart);
  const textAfter = textarea.value.substring(selectionStart);

  const properties = [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'padding',
    'border',
    'boxSizing',
    'whiteSpace',
    'wordWrap',
    'overflowWrap',
  ] as const;

  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  for (const prop of properties) {
    div.style[prop] = style[prop];
  }
  div.style.width = `${textarea.clientWidth}px`;

  div.textContent = textBefore;
  span.textContent = textAfter.length > 0 ? textAfter[0] : '.';
  div.appendChild(span);
  document.body.appendChild(div);

  const textareaRect = textarea.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();
  const divRect = div.getBoundingClientRect();
  document.body.removeChild(div);

  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
  const top = textareaRect.top + (spanRect.top - divRect.top) - textarea.scrollTop + lineHeight;
  const left = textareaRect.left + (spanRect.left - divRect.left) - textarea.scrollLeft;

  return new DOMRect(left, top, 0, lineHeight);
}

function detectSlashContext(textarea: HTMLTextAreaElement): SlashMenuState | null {
  const { selectionStart, selectionEnd, value } = textarea;
  if (selectionStart !== selectionEnd) return null;

  const textBefore = value.substring(0, selectionStart);
  const slashIndex = textBefore.lastIndexOf('/');
  if (slashIndex === -1) return null;

  const charBefore = slashIndex > 0 ? textBefore[slashIndex - 1] : '\n';
  if (charBefore !== '\n' && charBefore !== ' ' && charBefore !== '\t' && slashIndex !== 0) {
    return null;
  }

  const query = textBefore.substring(slashIndex + 1);
  if (query.includes(' ') || query.includes('\n')) return null;

  const commands = filterSlashCommands(query);
  if (commands.length === 0) return null;

  return {
    visible: true,
    query,
    startIndex: slashIndex,
    commands,
    anchorRect: getCaretRect(textarea),
  };
}

export function useEditorSlashCommands(options: UseEditorSlashCommandsOptions) {
  const { textareaRef, content, onContentChange, onMenuChange } = options;

  function closeMenu() {
    onMenuChange(CLOSED_STATE);
  }

  function refreshMenu() {
    const textarea = textareaRef.value;
    if (!textarea) {
      closeMenu();
      return;
    }
    const state = detectSlashContext(textarea);
    onMenuChange(state ?? CLOSED_STATE);
  }

  function applyCommand(command: SlashCommand) {
    const textarea = textareaRef.value;
    if (!textarea) return;

    const { selectionStart, value } = textarea;
    const textBefore = value.substring(0, selectionStart);
    const slashIndex = textBefore.lastIndexOf('/');
    if (slashIndex === -1) return;

    const before = value.substring(0, slashIndex);
    const after = value.substring(selectionStart);
    const insert = command.markdown;
    const newValue = before + insert + after;
    let cursor = before.length + insert.length;

    // Place cursor inside fenced code block
    if (command.id === 'code' && insert.includes('```')) {
      const inner = insert.indexOf('\n') + 1;
      cursor = before.length + inner;
    }

    textarea.value = newValue;
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
    content.value = newValue;
    onContentChange(newValue);
    closeMenu();
    textarea.focus();

    // File reference inserts [[ so the wikilink picker can open immediately.
    if (command.id === 'file') {
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    const textarea = textareaRef.value;
    if (!textarea) return;

    const state = detectSlashContext(textarea);
    if (!state?.visible) return;

    if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
      // MarkdownSlashMenu handles these at document level
      return;
    }

    if (e.key === ' ') {
      closeMenu();
    }
  }

  function handleInput() {
    refreshMenu();
  }

  let currentTextarea: HTMLTextAreaElement | null = null;

  function attach(el: HTMLTextAreaElement | null) {
    if (currentTextarea) {
      currentTextarea.removeEventListener('keydown', handleKeydown);
      currentTextarea.removeEventListener('input', handleInput);
      currentTextarea.removeEventListener('click', refreshMenu);
    }
    currentTextarea = el;
    if (el) {
      el.addEventListener('keydown', handleKeydown);
      el.addEventListener('input', handleInput);
      el.addEventListener('click', refreshMenu);
    } else {
      closeMenu();
    }
  }

  watch(textareaRef, (el) => attach(el), { immediate: true });

  onUnmounted(() => {
    attach(null);
  });

  return { applyCommand, closeMenu, refreshMenu };
}
