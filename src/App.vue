<template>
  <ion-app>
    <ion-router-outlet />
    <UpdateBanner />
    <DictationIndicator v-if="showDictationIndicator" :status="dictationState.status" :error="dictationState.error" />
    <DictationReviewModal
      :is-open="reviewModalOpen"
      :raw-text="reviewRawText"
      :cleaned-text="reviewCleanedText"
      :was-cleaned-up="reviewWasCleanedUp"
      @dismiss="handleReviewDismiss"
      @confirm="handleReviewConfirm"
    />
  </ion-app>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import UpdateBanner from '@/components/UpdateBanner.vue';
import DictationIndicator from '@/components/DictationIndicator.vue';
import DictationReviewModal from '@/components/DictationReviewModal.vue';
import { startUpdateChecker, stopUpdateChecker } from '@/services/updateService';
import {
  dictationState,
  initDictationIPC,
  startRecording,
  stopRecording,
  isRecording,
  onTranscriptionComplete,
  offTranscriptionComplete,
  refreshMicPermissionState,
  setDictationError,
} from '@/services/dictationService';
import { runCleanup, runActions } from '@/services/dictationPipelineService';
import {
  ELECTRON_TRAY_WORKSPACE_EVENT,
  loadDictationSettings,
  syncElectronDictationCompanionTray,
} from '@/services/dictationSettingsService';
import type { TranscriptionResult } from '@/types';

const router = useRouter();

const showDictationIndicator = computed(() => {
  const settings = loadDictationSettings();
  return settings.enabled && settings.showFloatingIndicator && dictationState.value.status !== 'idle';
});

// Review modal state
const reviewModalOpen = ref(false);
const reviewRawText = ref('');
const reviewCleanedText = ref('');
const reviewWasCleanedUp = ref(false);

function handleToggleDictation() {
  if (isRecording()) {
    stopRecording();
  } else {
    startRecording();
  }
}

const handleTranscription = async (result: TranscriptionResult) => {
  const raw = result.text?.trim() ?? '';
  if (!raw) {
    setDictationError('No speech detected');
    return;
  }
  try {
    const cleaned = await runCleanup(raw);

    reviewRawText.value = raw;
    reviewCleanedText.value = cleaned;
    reviewWasCleanedUp.value = cleaned !== raw;
    dictationState.value = { status: 'idle' };
    reviewModalOpen.value = true;
  } catch (err) {
    console.error('[Dictation] Pipeline error:', err);
    setDictationError(err instanceof Error ? err.message : 'Dictation pipeline failed');
  }
};

function handleReviewDismiss() {
  reviewModalOpen.value = false;
}

async function handleReviewConfirm(text: string) {
  reviewModalOpen.value = false;
  try {
    await runActions(text);
  } catch (err) {
    console.error('[Dictation] Pipeline actions error:', err);
    setDictationError(err instanceof Error ? err.message : 'Dictation actions failed');
  }
}

async function routeElectronTrayAction(action: string) {
  if (action === 'dictation-toggle') {
    handleToggleDictation();
    return;
  }
  if (router.currentRoute.value.path !== '/workspace') {
    await router.push('/workspace');
  }
  await nextTick();
  requestAnimationFrame(() => {
    window.dispatchEvent(
      new CustomEvent(ELECTRON_TRAY_WORKSPACE_EVENT, {
        detail: { action },
      }),
    );
  });
}

function initDictation() {
  initDictationIPC();

  const electronAPI = (window as unknown as {
    electronAPI?: {
      dictation?: {
        onToggle: (cb: () => void) => void;
        onTrayAction: (cb: (action: string) => void) => void;
        offTrayAction: () => void;
        registerShortcut: (accelerator: string) => Promise<{ success: boolean }>;
      };
    };
  }).electronAPI;

  if (electronAPI?.dictation) {
    electronAPI.dictation.onToggle(handleToggleDictation);
    electronAPI.dictation.onTrayAction((action) => {
      void routeElectronTrayAction(action);
    });

    const settings = loadDictationSettings();
    void syncElectronDictationCompanionTray(settings.enabled);
    if (settings.enabled && settings.shortcut) {
      electronAPI.dictation.registerShortcut(settings.shortcut);
    }
  }

  onTranscriptionComplete(handleTranscription);

  // Prime the reactive mic permission state so UI elements (e.g. the chat
  // input dictation button) can grey themselves out without prompting the OS.
  void refreshMicPermissionState();
}

onMounted(() => {
  startUpdateChecker();
  initDictation();
});

onUnmounted(() => {
  stopUpdateChecker();
  offTranscriptionComplete(handleTranscription);
  const electronAPI = (window as unknown as { electronAPI?: { dictation?: { offTrayAction?: () => void } } })
    .electronAPI;
  electronAPI?.dictation?.offTrayAction?.();
});
</script>
