<template>
  <div class="image-viewer-container">
    <div class="viewer-header">
      <div class="header-left">
        <ion-icon :icon="imageOutline" class="header-icon" />
        <span class="header-title" :title="fileName">
          {{ fileName }}
        </span>
      </div>
    </div>

    <div class="viewer-body">
      <div v-if="loading" class="loading-state">
        <ion-spinner name="crescent" />
        <p>Loading image...</p>
      </div>

      <div v-else-if="error" class="error-state">
        <ion-icon :icon="alertCircleOutline" class="error-icon" />
        <p>{{ error }}</p>
      </div>

      <div v-else-if="imageSrc" class="image-stage">
        <img
          :src="imageSrc"
          :alt="fileName"
          class="preview-image"
          @load="loading = false"
          @error="handleImageError"
        />
      </div>
    </div>

    <div v-if="currentProject" class="status-bar">
      <span class="status-item file-type">{{ fileTypeLabel }}</span>
      <span v-if="fileSizeLabel" class="status-item">{{ fileSizeLabel }}</span>
      <span class="status-item project-tag">{{ currentProject.name }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { IonIcon, IonSpinner } from '@ionic/vue';
import { alertCircleOutline, imageOutline } from 'ionicons/icons';
import type { Project, ProjectFile } from '@/types';
import { getCachedImageBinary } from '@/services/projectService';
import { readBinaryFile, loadFileSystemSettings } from '@/services/fileSystemService';

interface Props {
  currentFile?: ProjectFile | null;
  currentProject?: Project | null;
}

const props = withDefaults(defineProps<Props>(), {
  currentFile: null,
  currentProject: null,
});

const loading = ref(false);
const error = ref<string | null>(null);
const imageSrc = ref<string | null>(null);

const fileName = computed(() => {
  if (!props.currentFile) return 'Image';
  const parts = props.currentFile.name.split('/');
  return parts[parts.length - 1] || 'Untitled';
});

const fileTypeLabel = computed(() => {
  const type = props.currentFile?.type?.toUpperCase();
  return type || 'IMAGE';
});

const fileSizeLabel = computed(() => {
  const size = props.currentFile?.size;
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
});

function mimeTypeForFile(file: ProjectFile): string {
  switch (file.type) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'png':
    default:
      return 'image/png';
  }
}

function base64ToDataUrl(base64: string, mimeType: string): string {
  return base64.startsWith('data:') ? base64 : `data:${mimeType};base64,${base64}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x1000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

function handleImageError() {
  error.value = 'Failed to display image.';
  loading.value = false;
}

async function loadImage() {
  imageSrc.value = null;
  error.value = null;

  const file = props.currentFile;
  if (!file) {
    error.value = 'No image selected.';
    return;
  }

  loading.value = true;
  const mimeType = mimeTypeForFile(file);

  try {
    if (file.binaryData) {
      imageSrc.value = base64ToDataUrl(file.binaryData, mimeType);
      return;
    }

    const cached = getCachedImageBinary(file.id);
    if (cached) {
      imageSrc.value = base64ToDataUrl(cached, mimeType);
      return;
    }

    if (props.currentProject) {
      const result = await readBinaryFile(props.currentProject.name, file.name);
      if (result.success && result.data) {
        const base64 = arrayBufferToBase64(result.data);
        imageSrc.value = base64ToDataUrl(base64, mimeType);
        return;
      }
      if (result.error?.includes('not enabled')) {
        error.value =
          'Image binary is not stored locally. Re-import the image or enable file system sync in Settings.';
        return;
      }
    }

    const fsEnabled = loadFileSystemSettings().enabled;
    error.value = fsEnabled
      ? 'No image data available. The file may have been moved or deleted.'
      : 'Image binary is not stored locally. Re-import the image or enable file system sync in Settings.';
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load image.';
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.currentFile?.id, props.currentProject?.id] as const,
  () => {
    void loadImage();
  },
  { immediate: true },
);
</script>

<style scoped>
.image-viewer-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--hn-bg-base);
  overflow: hidden;
}

.viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--hn-bg-surface);
  border-bottom: 1px solid var(--hn-border-default);
  min-height: 48px;
  box-sizing: border-box;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.header-icon {
  font-size: 18px;
  color: var(--hn-teal);
  flex-shrink: 0;
}

.header-title {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--hn-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.viewer-body {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--hn-bg-base);
}

.image-stage {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
}

.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  color: var(--hn-text-secondary);
  text-align: center;
}

.loading-state ion-spinner {
  --color: var(--hn-teal);
  width: 36px;
  height: 36px;
  margin-bottom: 12px;
}

.error-state .error-icon {
  font-size: 48px;
  color: var(--hn-error);
  margin-bottom: 12px;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 16px;
  background: var(--hn-bg-surface);
  border-top: 1px solid var(--hn-border-default);
  font-size: 0.75rem;
  color: var(--hn-text-secondary);
}

.status-item.file-type {
  color: var(--hn-teal);
}

.status-item.project-tag {
  margin-left: auto;
  color: var(--hn-teal);
}
</style>
