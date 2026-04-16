<template>
  <div class="dictation-indicator" :class="status">
    <div class="indicator-dot" />
    <span class="indicator-label">{{ label }}</span>
    <span v-if="errorMessage" class="indicator-error">{{ errorMessage }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DictationStatus } from '@/types';

const props = defineProps<{
  status: DictationStatus;
  error?: string;
}>();

const label = computed(() => {
  switch (props.status) {
    case 'recording': return 'Recording…';
    case 'transcribing': return 'Transcribing…';
    case 'cleaning_up': return 'Cleaning up…';
    case 'processing': return 'Processing…';
    case 'error': return 'Error';
    default: return '';
  }
});

const errorMessage = computed(() => {
  if (props.status === 'error' && props.error) {
    const msg = props.error;
    return msg.length > 80 ? msg.substring(0, 80) + '…' : msg;
  }
  return '';
});
</script>

<style scoped>
.dictation-indicator {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  border-radius: 24px;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  z-index: 10000;
  pointer-events: none;
  animation: slide-up 0.25s ease-out;
}

@keyframes slide-up {
  from { opacity: 0; transform: translateX(-50%) translateY(12px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.indicator-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.recording .indicator-dot {
  background: #eb445a;
  animation: pulse 1s ease-in-out infinite;
}

.transcribing .indicator-dot {
  background: #ffc409;
  animation: pulse 0.8s ease-in-out infinite;
}

.cleaning_up .indicator-dot {
  background: #7c4dff;
  animation: pulse 0.8s ease-in-out infinite;
}

.processing .indicator-dot {
  background: #4d8dff;
  animation: pulse 0.8s ease-in-out infinite;
}

.error .indicator-dot {
  background: #eb445a;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}

.indicator-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
}

.indicator-error {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.7);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
