import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, ref, effectScope } from 'vue';
import EditorOutline from '@/components/EditorOutline.vue';
import { useMarkdownShortcuts } from '@/composables/useMarkdownShortcuts';
import { markdownToHtml, htmlToMarkdown, rewriteTaskListHtml } from '@/services/markdownConverter';
import { rewriteCalloutHtml } from '@/services/calloutConverter';

vi.mock('@/services/documentProcessor', () => ({
  chunkText: vi.fn(),
  chunkMarkdownText: vi.fn(),
  processDocument: vi.fn(),
  isFileTypeSupported: vi.fn(),
  detectFileType: vi.fn(),
  getFileBinaryData: vi.fn(),
  convertDOCXToHTML: vi.fn(),
  parseDocumentStructure: vi.fn((content: string) => {
    const sections: Array<{
      type: string;
      level?: number;
      title?: string;
      startOffset: number;
      startLine: number;
    }> = [];
    const lines = content.split('\n');
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^(#{1,6})\s+(.+)$/);
      if (m) {
        sections.push({
          type: 'heading',
          level: m[1].length,
          title: m[2].trim(),
          startOffset: offset,
          startLine: i + 1,
        });
      }
      offset += line.length + 1;
    }
    return sections;
  }),
}));

vi.mock('@/services/editorImagePaste', () => ({
  savePastedImage: vi.fn(),
  readClipboardImage: vi.fn(),
}));

vi.mock('@/components/WikilinkAutocomplete.vue', () => ({
  default: {
    name: 'WikilinkAutocomplete',
    template: '<div />',
    props: ['projectId', 'searchQuery', 'isVisible', 'anchorRect'],
    emits: ['select', 'close'],
  },
}));

vi.mock('@/components/MarkdownTableBubbleMenu.vue', () => ({
  default: {
    name: 'MarkdownTableBubbleMenu',
    template: '<div class="table-bubble-menu-stub" />',
    props: ['editor'],
  },
}));

import MarkdownLiveEditor from '@/components/MarkdownLiveEditor.vue';
import { filterSlashCommands } from '@/composables/markdownSlashCommands';
import { applySlashCommandToEditor } from '@/extensions/slashCommandExtension';

describe('editor feature smoke', () => {
  describe('callout Live round-trip', () => {
    test('markdown → html → markdown preserves note callout', () => {
      const md = '> [!note]\n> Remember this.';
      const html = rewriteCalloutHtml(rewriteTaskListHtml(markdownToHtml(md)));
      expect(html).toContain('data-callout="note"');

      const restored = htmlToMarkdown(html);
      expect(restored).toContain('> [!note]');
      expect(restored).toContain('> Remember this.');
    });

    test('markdown → html → markdown preserves tip with title', () => {
      const md = '> [!tip] Pro tip\n> Use shortcuts.';
      const html = rewriteCalloutHtml(markdownToHtml(md));
      const restored = htmlToMarkdown(html);
      expect(restored).toContain('> [!tip] Pro tip');
      expect(restored).toContain('> Use shortcuts.');
    });
  });

  describe('EditorOutline', () => {
    test('lists headings and emits navigate with index', async () => {
      const content = '# Intro\n\n## Details\n\nBody';
      const wrapper = mount(EditorOutline, {
        props: { content, visible: true },
      });

      const items = wrapper.findAll('.outline-item');
      expect(items).toHaveLength(2);
      expect(items[0].text()).toBe('Intro');
      expect(items[1].text()).toBe('Details');

      await items[1].trigger('click');
      const events = wrapper.emitted('navigate');
      expect(events).toBeTruthy();
      expect(events![0][1]).toBe(1);
      expect((events![0][0] as { title: string }).title).toBe('Details');
    });

    test('hides rail when no headings', () => {
      const wrapper = mount(EditorOutline, {
        props: { content: 'Plain paragraph only.', visible: true },
      });
      expect(wrapper.find('aside.editor-outline').exists()).toBe(false);
    });
  });

  describe('table scaffold via Enter', () => {
    let textarea: HTMLTextAreaElement;
    let scope: ReturnType<typeof effectScope>;

    beforeEach(() => {
      textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      const content = ref('');
      const textareaRef = ref(textarea);
      scope = effectScope();
      scope.run(() =>
        useMarkdownShortcuts({
          textareaRef,
          content,
          onContentChange: (val) => {
            content.value = val;
            textarea.value = val;
          },
          onToggleShortcuts: vi.fn(),
        }),
      );
    });

    afterEach(() => {
      scope.stop();
      textarea.remove();
    });

    test('Enter after table header inserts separator and body row', () => {
      textarea.value = '| Name | Score |';
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;

      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );

      expect(textarea.value).toContain('| --- | --- |');
      expect(textarea.value).toContain('|  |  |');
      expect(textarea.selectionStart).toBeGreaterThan('| Name | Score |'.length);
    });
  });

  describe('MarkdownLiveEditor callouts + outline jump', () => {
    async function mountLive(md: string) {
      const wrapper = mount(MarkdownLiveEditor, { props: { modelValue: md } });
      await flushPromises();
      await nextTick();
      await flushPromises();
      return wrapper;
    }

    test('renders callout aside in Live mode', async () => {
      const wrapper = await mountLive('> [!warning]\n> Watch out.');
      expect(wrapper.find('aside[data-callout="warning"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('Watch out');
    });

    test('scrollToHeading selects the requested heading', async () => {
      const wrapper = await mountLive('# First\n\n## Second\n\n### Third');
      const vm = wrapper.vm as unknown as {
        scrollToHeading: (i: number) => void;
        getEditor: () => {
          state: {
            selection: { from: number };
            doc: { textBetween: (from: number, to: number, sep: string) => string };
          };
        };
      };

      vm.scrollToHeading(1);
      const ed = vm.getEditor();
      const $from = ed.state.selection.$from;
      expect($from.parent.textContent).toBe('Second');
    });

    test('/table slash inserts a TipTap table in Live mode', async () => {
      const wrapper = await mountLive('');
      const vm = wrapper.vm as unknown as {
        getEditor: () => import('@tiptap/core').Editor;
      };
      const ed = vm.getEditor();
      const tableCmd = filterSlashCommands('table').find((c) => c.id === 'table')!;
      expect(tableCmd.tiptapAction).toBeDefined();

      applySlashCommandToEditor(ed, tableCmd, 0, 1);
      await flushPromises();
      await nextTick();

      expect(ed.isActive('table')).toBe(true);
      expect(wrapper.find('table').exists()).toBe(true);
    });
  });
});
