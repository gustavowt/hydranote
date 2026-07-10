import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick, effectScope, type EffectScope } from 'vue';
import { useIdleAutoSave } from '../../src/composables/useIdleAutoSave';

describe('useIdleAutoSave', () => {
  let scope: EffectScope;

  beforeEach(() => {
    vi.useFakeTimers();
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
    vi.useRealTimers();
  });

  function runAutosave(options: Parameters<typeof useIdleAutoSave>[0]) {
    return scope.run(() => useIdleAutoSave(options));
  }

  test('does not save when content is not dirty', async () => {
    const onAutosave = vi.fn().mockResolvedValue(true);
    const content = ref('same');
    const savedBaseline = ref('same');
    const fileId = ref('file-1');

    runAutosave({
      content,
      savedBaseline,
      fileId,
      onAutosave,
      idleDelayMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1500);
    expect(onAutosave).not.toHaveBeenCalled();
  });

  test('does not save without a file id', async () => {
    const onAutosave = vi.fn().mockResolvedValue(true);
    const content = ref('draft');
    const savedBaseline = ref('saved');
    const fileId = ref<string | null>(null);

    runAutosave({
      content,
      savedBaseline,
      fileId,
      onAutosave,
      idleDelayMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1500);
    expect(onAutosave).not.toHaveBeenCalled();
  });

  test('saves after idle delay when dirty', async () => {
    const onAutosave = vi.fn().mockResolvedValue(true);
    const content = ref('draft');
    const savedBaseline = ref('saved');
    const fileId = ref('file-1');

    const { status } = runAutosave({
      content,
      savedBaseline,
      fileId,
      onAutosave,
      idleDelayMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);
    await nextTick();

    expect(onAutosave).toHaveBeenCalledWith('draft');
    expect(savedBaseline.value).toBe('draft');
    expect(status.value).toBe('saved');
  });

  test('resets timer on each content change', async () => {
    const onAutosave = vi.fn().mockResolvedValue(true);
    const content = ref('a');
    const savedBaseline = ref('');
    const fileId = ref('file-1');

    runAutosave({
      content,
      savedBaseline,
      fileId,
      onAutosave,
      idleDelayMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(500);
    content.value = 'ab';
    await nextTick();
    await vi.advanceTimersByTimeAsync(500);
    expect(onAutosave).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(onAutosave).toHaveBeenCalledWith('ab');
  });

  test('cancels pending save when file changes', async () => {
    const onAutosave = vi.fn().mockResolvedValue(true);
    const content = ref('draft');
    const savedBaseline = ref('saved');
    const fileId = ref('file-1');

    runAutosave({
      content,
      savedBaseline,
      fileId,
      onAutosave,
      idleDelayMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(500);
    fileId.value = 'file-2';
    await nextTick();
    await vi.advanceTimersByTimeAsync(1500);

    expect(onAutosave).not.toHaveBeenCalled();
  });

  test('restarts timer when content changes during save', async () => {
    const onAutosave = vi.fn().mockImplementation(async () => {
      content.value = 'draft-final';
      await Promise.resolve();
      return true;
    });
    const content = ref('draft');
    const savedBaseline = ref('saved');
    const fileId = ref('file-1');

    runAutosave({
      content,
      savedBaseline,
      fileId,
      onAutosave,
      idleDelayMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);
    await nextTick();

    expect(savedBaseline.value).toBe('draft');
    expect(content.value).toBe('draft-final');

    onAutosave.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    await nextTick();

    expect(onAutosave).toHaveBeenCalledWith('draft-final');
  });

  test('does not save when blocked', async () => {
    const onAutosave = vi.fn().mockResolvedValue(true);
    const content = ref('draft');
    const savedBaseline = ref('saved');
    const fileId = ref('file-1');
    const isBlocked = ref(true);

    runAutosave({
      content,
      savedBaseline,
      fileId,
      isBlocked,
      onAutosave,
      idleDelayMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1500);
    expect(onAutosave).not.toHaveBeenCalled();
  });

  test('sets error status when save fails', async () => {
    const onAutosave = vi.fn().mockResolvedValue(false);
    const content = ref('draft');
    const savedBaseline = ref('saved');
    const fileId = ref('file-1');

    const { status } = runAutosave({
      content,
      savedBaseline,
      fileId,
      onAutosave,
      idleDelayMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);
    await nextTick();

    expect(status.value).toBe('error');
    expect(savedBaseline.value).toBe('saved');
  });
});
