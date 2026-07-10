import { type Ref, ref, watch, onUnmounted } from 'vue';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseIdleAutoSaveOptions {
  content: Ref<string>;
  savedBaseline: Ref<string>;
  fileId: Ref<string | null | undefined>;
  isBlocked?: Ref<boolean>;
  enabled?: Ref<boolean>;
  idleDelayMs?: number;
  onAutosave: (content: string) => Promise<boolean>;
}

const DEFAULT_IDLE_DELAY_MS = 10_000;
const SAVED_STATUS_MS = 2_000;

export function useIdleAutoSave(options: UseIdleAutoSaveOptions) {
  const status = ref<AutoSaveStatus>('idle');
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let savedStatusTimer: ReturnType<typeof setTimeout> | null = null;

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function clearSavedStatusTimer() {
    if (savedStatusTimer) {
      clearTimeout(savedStatusTimer);
      savedStatusTimer = null;
    }
  }

  function isDirty() {
    return options.content.value !== options.savedBaseline.value;
  }

  function canSchedule() {
    return (
      (options.enabled?.value ?? true) &&
      !!options.fileId.value &&
      !(options.isBlocked?.value ?? false) &&
      isDirty()
    );
  }

  function scheduleIdleTimer() {
    clearIdleTimer();
    if (!canSchedule()) return;

    idleTimer = setTimeout(() => {
      void flushAutosave();
    }, options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS);
  }

  function cancelPending() {
    clearIdleTimer();
  }

  async function flushAutosave() {
    const activeFileId = options.fileId.value;
    if (!activeFileId || !isDirty() || (options.isBlocked?.value ?? false)) return;
    if (status.value === 'saving') return;

    const contentToSave = options.content.value;
    const savingForFileId = activeFileId;
    status.value = 'saving';
    clearSavedStatusTimer();

    try {
      const ok = await options.onAutosave(contentToSave);
      if (options.fileId.value !== savingForFileId) return;

      if (ok) {
        options.savedBaseline.value = contentToSave;
        status.value = 'saved';
        savedStatusTimer = setTimeout(() => {
          if (status.value === 'saved') {
            status.value = 'idle';
          }
        }, SAVED_STATUS_MS);

        if (options.content.value !== contentToSave) {
          scheduleIdleTimer();
        }
      } else if (options.fileId.value === savingForFileId) {
        status.value = 'error';
      }
    } catch {
      if (options.fileId.value === savingForFileId) {
        status.value = 'error';
      }
    }
  }

  watch(options.content, () => {
    if (status.value === 'saved') {
      status.value = 'idle';
    }
    scheduleIdleTimer();
  });

  watch(options.fileId, (newId, oldId) => {
    if (newId !== oldId) {
      cancelPending();
      status.value = 'idle';
      clearSavedStatusTimer();
    }
  });

  if (options.isBlocked) {
    watch(options.isBlocked, (blocked) => {
      if (blocked) {
        cancelPending();
      }
    });
  }

  scheduleIdleTimer();

  onUnmounted(() => {
    cancelPending();
    clearSavedStatusTimer();
  });

  return {
    status,
    cancelPending,
  };
}

export function autoSaveStatusLabel(status: AutoSaveStatus): string {
  switch (status) {
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'error':
      return 'Save failed';
    default:
      return '';
  }
}
