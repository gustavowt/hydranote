import { type Ref, watch, onUnmounted } from 'vue';
import type { WikilinkFileItem } from '@/components/WikilinkAutocomplete.vue';

export interface WikilinkMenuState {
  visible: boolean;
  query: string;
  startIndex: number;
  anchorRect: DOMRect | null;
}

interface UseEditorWikilinkAutocompleteOptions {
  textareaRef: Ref<HTMLTextAreaElement | null>;
  content: Ref<string>;
  onContentChange: (value: string) => void;
  onMenuChange: (state: WikilinkMenuState) => void;
}

const CLOSED_STATE: WikilinkMenuState = {
  visible: false,
  query: '',
  startIndex: -1,
  anchorRect: null,
};

function getCaretRect(textarea: HTMLTextAreaElement): DOMRect {
  const { selectionStart } = textarea;
  const style = window.getComputedStyle(textarea);
  const div = document.createElement('div');
  const span = document.createElement('span');
  const textBefore = textarea.value.substring(0, selectionStart);
  const textAfter = textarea.value.substring(selectionStart);

  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.fontFamily = style.fontFamily;
  div.style.fontSize = style.fontSize;
  div.style.lineHeight = style.lineHeight;
  div.style.padding = style.padding;
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

function detectWikilinkContext(textarea: HTMLTextAreaElement): WikilinkMenuState | null {
  const { selectionStart, selectionEnd, value } = textarea;
  if (selectionStart !== selectionEnd) return null;

  const textBefore = value.substring(0, selectionStart);
  const openIndex = textBefore.lastIndexOf('[[');
  if (openIndex === -1) return null;

  const textAfterOpen = textBefore.substring(openIndex + 2);
  if (textAfterOpen.includes(']]') || textAfterOpen.includes('\n')) return null;

  return {
    visible: true,
    query: textAfterOpen,
    startIndex: openIndex,
    anchorRect: getCaretRect(textarea),
  };
}

export function useEditorWikilinkAutocomplete(options: UseEditorWikilinkAutocompleteOptions) {
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
    const state = detectWikilinkContext(textarea);
    onMenuChange(state ?? CLOSED_STATE);
  }

  function applyFile(file: WikilinkFileItem) {
    const textarea = textareaRef.value;
    if (!textarea) return;

    const { selectionStart, value } = textarea;
    const textBefore = value.substring(0, selectionStart);
    const openIndex = textBefore.lastIndexOf('[[');
    if (openIndex === -1) return;

    const linkPath = file.path || file.name;
    const before = value.substring(0, openIndex);
    const after = value.substring(selectionStart);
    const insert = `[[${linkPath}]]`;
    const newValue = before + insert + after;
    const cursor = before.length + insert.length;

    textarea.value = newValue;
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
    content.value = newValue;
    onContentChange(newValue);
    closeMenu();
    textarea.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    const textarea = textareaRef.value;
    if (!textarea) return;

    const state = detectWikilinkContext(textarea);
    if (!state?.visible) return;

    if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
      return;
    }

    if (e.key === ' ' || e.key === ']') {
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

  return { applyFile, closeMenu, refreshMenu };
}
