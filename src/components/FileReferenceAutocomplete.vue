<template>
  <Teleport to="body">
    <div 
      v-if="isVisible && filteredFiles.length > 0" 
      class="file-autocomplete"
      :style="positionStyle"
      ref="autocompleteRef"
    >
      <div class="autocomplete-header">
        <ion-icon :icon="atOutline" />
        <span>Reference a file</span>
      </div>
      <div class="autocomplete-list">
        <div
          v-for="(file, index) in filteredFiles"
          :key="file.id"
          class="autocomplete-item"
          :class="{ selected: index === selectedIndex }"
          @click="selectFile(file)"
          @mouseenter="selectedIndex = index"
        >
          <ion-icon :icon="getFileIcon(file.type)" :style="{ color: getIconColor(file.type) }" />
          <div class="file-info">
            <span class="file-name">{{ file.name }}</span>
            <span v-if="file.path !== file.name" class="file-path">{{ file.path }}</span>
          </div>
        </div>
      </div>
      <div class="autocomplete-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> select</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { IonIcon } from '@ionic/vue';
import {
  atOutline,
  documentOutline,
  documentTextOutline,
  imageOutline,
  codeSlashOutline,
  logoMarkdown,
} from 'ionicons/icons';
import type { SupportedFileType } from '@/types';
import { getProjectFilesForAutocomplete } from '@/services';

interface FileItem {
  id: string;
  name: string;
  path: string;
  type: SupportedFileType;
}

interface Props {
  projectId: string;
  searchQuery: string;
  isVisible: boolean;
  anchorRect?: DOMRect | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'select', file: FileItem): void;
  (e: 'close'): void;
}>();

const files = ref<FileItem[]>([]);
const selectedIndex = ref(0);
const autocompleteRef = ref<HTMLElement | null>(null);

const filteredFiles = computed(() => {
  if (!props.searchQuery) {
    return files.value.slice(0, 8);
  }
  
  const query = props.searchQuery.toLowerCase();
  return files.value
    .filter(f => 
      f.name.toLowerCase().includes(query) || 
      f.path.toLowerCase().includes(query)
    )
    .slice(0, 8);
});

const positionStyle = computed(() => {
  if (!props.anchorRect) {
    return { display: 'none' };
  }
  
  // Position above the anchor element
  const bottom = window.innerHeight - props.anchorRect.top + 8;
  const left = Math.max(16, props.anchorRect.left);
  
  return {
    position: 'fixed' as const,
    bottom: `${bottom}px`,
    left: `${left}px`,
    maxWidth: '360px',
  };
});

watch(() => props.projectId, async () => {
  await loadFiles();
}, { immediate: true });

watch(() => props.searchQuery, () => {
  selectedIndex.value = 0;
});

watch(() => props.isVisible, async (visible) => {
  if (visible) {
    selectedIndex.value = 0;
    // Reload files every time the autocomplete opens to ensure fresh data
    await loadFiles();
  }
});

async function loadFiles() {
  if (!props.projectId) return;
  try {
    files.value = await getProjectFilesForAutocomplete(props.projectId);
  } catch (error) {
    console.error('Failed to load files for autocomplete:', error);
  }
}

function selectFile(file: FileItem) {
  emit('select', file);
}

function getFileIcon(type: SupportedFileType): string {
  switch (type) {
    case 'md':
      return logoMarkdown;
    case 'pdf':
      return documentTextOutline;
    case 'docx':
      return documentOutline;
    case 'txt':
      return codeSlashOutline;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
      return imageOutline;
    default:
      return documentOutline;
  }
}

function getIconColor(type: SupportedFileType): string {
  switch (type) {
    case 'md':
      return 'var(--hn-purple)';
    case 'pdf':
      return 'var(--hn-danger)';
    case 'docx':
      return 'var(--hn-green)';
    case 'txt':
      return 'var(--hn-text-secondary)';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
      return 'var(--hn-purple-light)';
    default:
      return 'var(--hn-text-secondary)';
  }
}

// Keyboard navigation
function handleKeydown(event: KeyboardEvent) {
  if (!props.isVisible) return;
  
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      event.stopPropagation();
      selectedIndex.value = Math.min(selectedIndex.value + 1, filteredFiles.value.length - 1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      event.stopPropagation();
      selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
      break;
    case 'Enter':
      event.preventDefault();
      event.stopPropagation();
      if (filteredFiles.value[selectedIndex.value]) {
        selectFile(filteredFiles.value[selectedIndex.value]);
      }
      break;
    case 'Escape':
      event.preventDefault();
      event.stopPropagation();
      emit('close');
      break;
    case 'Tab':
      event.preventDefault();
      event.stopPropagation();
      if (filteredFiles.value[selectedIndex.value]) {
        selectFile(filteredFiles.value[selectedIndex.value]);
      }
      break;
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown, true);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown, true);
});

// Expose refresh method
async function refresh() {
  await loadFiles();
}

defineExpose({ refresh });
</script>

<style scoped>
.file-autocomplete {
  z-index: 99999;
  width: 320px;
  max-height: 360px;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.autocomplete-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--hn-bg-surface);
  border-bottom: 1px solid var(--hn-border-default);
  font-size: 0.8rem;
  color: var(--hn-text-secondary);
}

.autocomplete-header ion-icon {
  font-size: 14px;
  color: var(--hn-purple);
}

.autocomplete-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.autocomplete-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.autocomplete-item:hover,
.autocomplete-item.selected {
  background: var(--hn-purple-muted);
}

.autocomplete-item ion-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.file-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.file-name {
  font-size: 0.9rem;
  color: var(--hn-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-path {
  font-size: 0.75rem;
  color: var(--hn-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.autocomplete-footer {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding: 8px 14px;
  background: var(--hn-bg-surface);
  border-top: 1px solid var(--hn-border-default);
  font-size: 0.7rem;
  color: var(--hn-text-muted);
}

.autocomplete-footer span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.autocomplete-footer kbd {
  display: inline-block;
  padding: 2px 5px;
  font-size: 0.65rem;
  font-family: inherit;
  color: var(--hn-text-secondary);
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 4px;
}

/* Scrollbar styling */
.autocomplete-list::-webkit-scrollbar {
  width: 6px;
}

.autocomplete-list::-webkit-scrollbar-track {
  background: transparent;
}

.autocomplete-list::-webkit-scrollbar-thumb {
  background: var(--hn-border-default);
  border-radius: 3px;
}

.autocomplete-list::-webkit-scrollbar-thumb:hover {
  background: var(--hn-border-strong);
}
</style>


