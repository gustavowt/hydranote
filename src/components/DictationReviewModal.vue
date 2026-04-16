<template>
  <ion-modal :is-open="isOpen" @didDismiss="handleDismiss" class="dictation-review-modal">
    <ion-header>
      <ion-toolbar>
        <ion-title>Review Dictation</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" @click="handleDismiss">
            <ion-icon :icon="closeOutline" slot="icon-only" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding review-content">
      <!-- Raw transcription (read-only) -->
      <div class="section">
        <div class="section-header">
          <ion-icon :icon="micOutline" class="section-icon recording-icon" />
          <span class="section-label">Transcription</span>
        </div>
        <div class="readonly-text">{{ rawText }}</div>
      </div>

      <!-- Cleaned-up version (read-only, shown only when cleanup was applied) -->
      <div v-if="showCleanedSection" class="section">
        <div class="section-header">
          <ion-icon :icon="sparklesOutline" class="section-icon cleanup-icon" />
          <span class="section-label">After AI Cleanup</span>
        </div>
        <div class="readonly-text">{{ cleanedText }}</div>
      </div>

      <!-- Editable final text -->
      <div class="section editable-section">
        <div class="section-header">
          <ion-icon :icon="createOutline" class="section-icon edit-icon" />
          <span class="section-label">Final Text</span>
          <span class="section-hint">Edit before confirming</span>
        </div>
        <textarea
          ref="editableRef"
          v-model="editableText"
          class="editable-textarea"
          rows="6"
        ></textarea>
      </div>
    </ion-content>

    <ion-footer class="review-footer">
      <div class="action-bar">
        <ion-button fill="clear" @click="handleDismiss" class="cancel-btn">
          Discard
        </ion-button>
        <ion-button
          fill="solid"
          :disabled="!editableText.trim()"
          @click="handleConfirm"
          class="confirm-btn"
        >
          Confirm
        </ion-button>
      </div>
    </ion-footer>
  </ion-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonContent,
  IonFooter,
} from '@ionic/vue';
import {
  closeOutline,
  micOutline,
  sparklesOutline,
  createOutline,
} from 'ionicons/icons';

const props = defineProps<{
  isOpen: boolean;
  rawText: string;
  cleanedText: string;
  wasCleanedUp: boolean;
}>();

const emit = defineEmits<{
  (e: 'dismiss'): void;
  (e: 'confirm', text: string): void;
}>();

const editableText = ref('');
const editableRef = ref<HTMLTextAreaElement | null>(null);

const showCleanedSection = computed(() =>
  props.wasCleanedUp && props.cleanedText !== props.rawText,
);

watch(() => props.isOpen, (open) => {
  if (open) {
    editableText.value = props.cleanedText || props.rawText;
    nextTick(() => {
      editableRef.value?.focus();
    });
  }
});

function handleDismiss() {
  emit('dismiss');
}

function handleConfirm() {
  if (editableText.value.trim()) {
    emit('confirm', editableText.value.trim());
  }
}
</script>

<style scoped>
.dictation-review-modal {
  --width: 90%;
  --max-width: 640px;
  --height: 70%;
  --border-radius: 12px;
}

ion-content.review-content {
  --background: var(--hn-bg-deep);
}

.section {
  margin-bottom: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.section-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.recording-icon {
  color: #eb445a;
}

.cleanup-icon {
  color: #7c4dff;
}

.edit-icon {
  color: var(--hn-teal);
}

.section-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--hn-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.section-hint {
  font-size: 0.75rem;
  color: var(--hn-text-muted);
  margin-left: auto;
}

.readonly-text {
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--hn-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}

.editable-textarea {
  width: 100%;
  background: var(--hn-bg-deep);
  color: var(--hn-text-primary);
  border: 1px solid var(--hn-teal);
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 0.9rem;
  font-family: inherit;
  line-height: 1.6;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
  box-shadow: 0 0 0 2px rgba(45, 212, 191, 0.15);
}

.editable-textarea:focus {
  border-color: var(--hn-teal);
  box-shadow: 0 0 0 3px rgba(45, 212, 191, 0.25);
}

/* Footer */
.review-footer {
  border-top: 1px solid var(--hn-border-default);
  background: var(--hn-bg-surface);
}

.review-footer ion-toolbar {
  display: none;
}

.action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px 14px;
}

.cancel-btn {
  --color: var(--hn-text-secondary);
}

.cancel-btn:hover {
  --color: var(--hn-text-primary);
}

.confirm-btn {
  --background: linear-gradient(135deg, var(--hn-green) 0%, var(--hn-teal) 100%);
  --color: #ffffff;
  --border-radius: 8px;
  --padding-start: 24px;
  --padding-end: 24px;
}

.confirm-btn:disabled {
  opacity: 0.5;
}
</style>
