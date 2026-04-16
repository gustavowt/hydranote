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
  if (!result.text) return;
  try {
    const raw = result.text;
    const cleaned = await runCleanup(raw);

    reviewRawText.value = raw;
    reviewCleanedText.value = cleaned;
    reviewWasCleanedUp.value = cleaned !== raw;
    dictationState.value = { status: 'idle' };
    reviewModalOpen.value = true;
  } catch (err) {
    console.error('[Dictation] Pipeline error:', err);
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
