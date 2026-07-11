import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { filterSlashCommands, type SlashCommand } from '@/composables/markdownSlashCommands';

export interface SlashCommandPayload {
  query: string;
  from: number;
  to: number;
  commands: SlashCommand[];
  anchorRect: DOMRect | null;
}

export interface SlashCommandExtensionOptions {
  onChange: (payload: SlashCommandPayload | null) => void;
}

export const slashCommandPluginKey = new PluginKey('slashCommand');

function getCoordsAtPos(view: EditorView, pos: number): DOMRect | null {
  try {
    const coords = view.coordsAtPos(pos);
    return new DOMRect(coords.left, coords.bottom, 0, 0);
  } catch {
    return null;
  }
}

function detectSlashAtCursor(view: EditorView): SlashCommandPayload | null {
  const { state } = view;
  const { from } = state.selection;
  if (!state.selection.empty) return null;

  const $from = state.doc.resolve(from);
  const textBefore = $from.parent.textBetween(
    Math.max(0, $from.parentOffset - 50),
    $from.parentOffset,
    undefined,
    '\ufffc',
  );

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

  const slashFrom = from - (textBefore.length - slashIndex);
  return {
    query,
    from: slashFrom,
    to: from,
    commands,
    anchorRect: getCoordsAtPos(view, from),
  };
}

export const SlashCommandExtension = Extension.create<SlashCommandExtensionOptions>({
  name: 'slashCommand',

  addOptions() {
    return {
      onChange: () => {},
    };
  },

  addProseMirrorPlugins() {
    const onChange = this.options.onChange;

    return [
      new Plugin({
        key: slashCommandPluginKey,
        view() {
          return {
            update(view, prevState) {
              if (view.state.doc.eq(prevState.doc) && view.state.selection.eq(prevState.selection)) {
                return;
              }
              onChange(detectSlashAtCursor(view));
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

export function applySlashCommandToEditor(
  editor: import('@tiptap/core').Editor,
  command: SlashCommand,
  from: number,
  to: number,
): void {
  editor.chain().focus().deleteRange({ from, to }).run();
  if (command.tiptapAction) {
    command.tiptapAction(editor);
  } else {
    editor.chain().focus().insertContent(command.markdown).run();
  }
}
