import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export interface WikilinkPayload {
  query: string;
  from: number;
  to: number;
  anchorRect: DOMRect | null;
}

export interface WikilinkAutocompleteExtensionOptions {
  onChange: (payload: WikilinkPayload | null) => void;
}

export const wikilinkAutocompletePluginKey = new PluginKey('wikilinkAutocomplete');

function getCoordsAtPos(view: EditorView, pos: number): DOMRect | null {
  try {
    const coords = view.coordsAtPos(pos);
    return new DOMRect(coords.left, coords.bottom, 0, 0);
  } catch {
    return null;
  }
}

function detectWikilinkAtCursor(view: EditorView): WikilinkPayload | null {
  const { state } = view;
  const { from } = state.selection;
  if (!state.selection.empty) return null;

  const $from = state.doc.resolve(from);
  const textBefore = $from.parent.textBetween(
    Math.max(0, $from.parentOffset - 80),
    $from.parentOffset,
    undefined,
    '\ufffc',
  );

  const openIndex = textBefore.lastIndexOf('[[');
  if (openIndex === -1) return null;

  const textAfterOpen = textBefore.substring(openIndex + 2);
  if (textAfterOpen.includes(']]') || textAfterOpen.includes('\n')) return null;

  const openFrom = from - (textBefore.length - openIndex);
  return {
    query: textAfterOpen,
    from: openFrom,
    to: from,
    anchorRect: getCoordsAtPos(view, from),
  };
}

export const WikilinkAutocompleteExtension = Extension.create<WikilinkAutocompleteExtensionOptions>({
  name: 'wikilinkAutocomplete',

  addOptions() {
    return {
      onChange: () => {},
    };
  },

  addProseMirrorPlugins() {
    const onChange = this.options.onChange;

    return [
      new Plugin({
        key: wikilinkAutocompletePluginKey,
        view() {
          return {
            update(view, prevState) {
              if (view.state.doc.eq(prevState.doc) && view.state.selection.eq(prevState.selection)) {
                return;
              }
              onChange(detectWikilinkAtCursor(view));
            },
            destroy() {
              onChange(null);
            },
          };
        },
      }),
    ];
  },
});

export function applyWikilinkToEditor(
  editor: import('@tiptap/core').Editor,
  linkPath: string,
  from: number,
  to: number,
): void {
  editor.chain().focus().deleteRange({ from, to }).insertContent(`[[${linkPath}]]`).run();
}
