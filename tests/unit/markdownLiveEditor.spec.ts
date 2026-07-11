import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/services/documentProcessor', () => ({
  chunkText: vi.fn(),
  chunkMarkdownText: vi.fn(),
  processDocument: vi.fn(),
  isFileTypeSupported: vi.fn(),
  detectFileType: vi.fn(),
  getFileBinaryData: vi.fn(),
  convertDOCXToHTML: vi.fn(),
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

import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import MarkdownLiveEditor from '@/components/MarkdownLiveEditor.vue';
import { clearDateCache } from '@/services/dateDetectionService';

/**
 * jsdom does not implement layout, so the scrolling bug (CSS conflict between
 * `.editor-pane` and `.live-editor-host`) is verified manually in the app.
 * These tests cover the date-chip rendering + click event surface that the
 * hybrid (Live) editor needs to match the marked-based preview path.
 */

beforeEach(() => {
  clearDateCache();
});

afterEach(() => {
  clearDateCache();
  vi.useRealTimers();
});

async function mountAndSettle(modelValue: string) {
  const wrapper = mount(MarkdownLiveEditor, {
    props: { modelValue },
  });
  // Tiptap mounts on onMounted + asynchronously applies decorations.
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

describe('MarkdownLiveEditor date chips', () => {
  test('wraps a recognized date in a .date-chip span with metadata', async () => {
    // Pin "now" so the deadline-vs-regular classification and ISO date are stable.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));

    const wrapper = await mountAndSettle('Meeting next Monday with the team');

    const chip = wrapper.find('.date-chip');
    expect(chip.exists()).toBe(true);
    expect(chip.attributes('data-original')).toBe('next Monday');
    expect(chip.attributes('data-type')).toBe('regular');
    expect(chip.attributes('data-date')).toBeTruthy();
  });

  test('marks deadlines with the deadline class', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));

    const wrapper = await mountAndSettle('Submit by 2030-01-01');

    const chip = wrapper.find('.date-chip');
    expect(chip.exists()).toBe(true);
    expect(chip.classes()).toContain('deadline');
    expect(chip.attributes('data-type')).toBe('deadline');
  });

  test('emits date-chip-click with chip metadata when a chip is clicked', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));

    const wrapper = await mountAndSettle('Meeting next Monday');

    const chip = wrapper.find('.date-chip');
    expect(chip.exists()).toBe(true);

    await chip.trigger('click');

    const events = wrapper.emitted('date-chip-click');
    expect(events).toBeTruthy();
    expect(events!.length).toBe(1);

    const payload = events![0][0] as {
      date: string;
      type: string;
      original: string;
      context: string;
      anchorRect: DOMRect | null;
    };
    expect(payload.original).toBe('next Monday');
    expect(payload.type).toBe('regular');
    expect(payload.date).toBeTruthy();
  });
});
