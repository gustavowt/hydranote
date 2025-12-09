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
        <span>{{ isGlobalMode ? 'Reference a project or file' : 'Reference a file' }}</span>
      </div>
      <div class="autocomplete-list">
        <!-- Projects Section -->
        <template v-if="filteredProjects.length > 0">
          <div class="section-header">
            <span class="section-title">Projects</span>
            <span class="section-count">{{ filteredProjects.length }}</span>
          </div>
          <div
            v-for="(item, index) in filteredProjects"
            :key="item.id"
            class="autocomplete-item is-project"
            :class="{ selected: index === selectedIndex }"
            @click="selectItem(item)"
            @mouseenter="selectedIndex = index"
          >
            <ion-icon :icon="getItemIcon(item)" :style="{ color: getItemIconColor(item) }" />
            <div class="file-info">
              <span class="file-name">{{ item.name }}</span>
            </div>
          </div>
        </template>

        <!-- Files Section -->
        <template v-if="filteredFileItems.length > 0">
          <div class="section-header" :class="{ 'has-top-border': filteredProjects.length > 0 }">
            <span class="section-title">Files</span>
            <span class="section-count">{{ filteredFileItems.length }}</span>
          </div>
          <div
            v-for="(item, index) in filteredFileItems"
            :key="item.id"
            class="autocomplete-item"
            :class="{ selected: (index + filteredProjects.length) === selectedIndex }"
            @click="selectItem(item)"
            @mouseenter="selectedIndex = index + filteredProjects.length"
          >
            <ion-icon :icon="getItemIcon(item)" :style="{ color: getItemIconColor(item) }" />
            <div class="file-info">
              <span class="file-name">{{ item.name }}</span>
              <span v-if="item.projectName" class="file-project">{{ item.projectName }}</span>
              <span v-else-if="item.path !== item.name" class="file-path">{{ item.path }}</span>
            </div>
          </div>
        </template>
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
  folderOutline,
} from 'ionicons/icons';
import type { SupportedFileType } from '@/types';
import { getProjectFilesForAutocomplete, getAllFilesForAutocomplete, getAllProjects } from '@/services';

// Type for autocomplete items (can be file or project)
type AutocompleteItemType = 'file' | 'project';

interface AutocompleteItem {
  id: string;
  name: string;
  path: string;
  type: SupportedFileType | 'project';
  itemType: AutocompleteItemType;
  projectId?: string;
  projectName?: string;
  description?: string;
}

// Legacy interface for emitted events (backward compatible)
interface FileItem {
  id: string;
  name: string;
  path: string;
  type: SupportedFileType;
  projectId?: string;
  projectName?: string;
}

interface Props {
  projectId?: string; // Optional - undefined means global mode
  searchQuery: string;
  isVisible: boolean;
  anchorRect?: DOMRect | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'select', item: AutocompleteItem): void;
  (e: 'close'): void;
}>();

const items = ref<AutocompleteItem[]>([]);
const selectedIndex = ref(0);
const autocompleteRef = ref<HTMLElement | null>(null);

// Check if we're in global mode (no projectId)
const isGlobalMode = computed(() => !props.projectId);

// Filter and separate items by type
const filteredItems = computed(() => {
  let filtered = items.value;
  
  if (props.searchQuery) {
    const query = props.searchQuery.toLowerCase();
    filtered = items.value.filter(item => 
      item.name.toLowerCase().includes(query) || 
      item.path.toLowerCase().includes(query) ||
      (item.projectName && item.projectName.toLowerCase().includes(query)) ||
      (item.description && item.description.toLowerCase().includes(query))
    );
  }
  
  return filtered;
});

// Filtered projects (max 5)
const filteredProjects = computed(() => 
  filteredItems.value
    .filter(item => item.itemType === 'project')
    .slice(0, 5)
);

// Filtered files (max 8)
const filteredFileItems = computed(() => 
  filteredItems.value
    .filter(item => item.itemType === 'file')
    .slice(0, 8)
);

// Combined list for keyboard navigation
const filteredFiles = computed(() => [
  ...filteredProjects.value,
  ...filteredFileItems.value,
]);

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
  try {
    if (props.projectId) {
      // Project mode - load files from specific project
      const projectFiles = await getProjectFilesForAutocomplete(props.projectId);
      items.value = projectFiles.map(f => ({
        ...f,
        itemType: 'file' as AutocompleteItemType,
      }));
    } else {
      // Global mode - load projects AND files from all projects
      const loadedItems: AutocompleteItem[] = [];
      
      // First, add all projects
      const projects = await getAllProjects();
      for (const project of projects) {
        loadedItems.push({
          id: project.id,
          name: project.name,
          path: project.name,
          type: 'project',
          itemType: 'project',
          description: project.description,
        });
      }
      
      // Then add all files
      const allFiles = await getAllFilesForAutocomplete();
      for (const file of allFiles) {
        loadedItems.push({
          ...file,
          itemType: 'file',
        });
      }
      
      items.value = loadedItems;
    }
  } catch (error) {
    console.error('Failed to load items for autocomplete:', error);
  }
}

function selectItem(item: AutocompleteItem) {
  emit('select', item);
}

function getItemIcon(item: AutocompleteItem): string {
  if (item.itemType === 'project') {
    return folderOutline;
  }
  
  switch (item.type) {
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

function getItemIconColor(item: AutocompleteItem): string {
  if (item.itemType === 'project') {
    return 'var(--hn-green)';
  }
  
  switch (item.type) {
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
        selectItem(filteredFiles.value[selectedIndex.value]);
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
        selectItem(filteredFiles.value[selectedIndex.value]);
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
  width: 340px;
  max-height: 420px;
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
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 6px;
  margin-top: 4px;
}

.section-header:first-child {
  margin-top: 0;
}

.section-header.has-top-border {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--hn-border-default);
}

.section-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--hn-text-muted);
}

.section-count {
  font-size: 0.65rem;
  color: var(--hn-text-muted);
  background: var(--hn-bg-surface);
  padding: 2px 6px;
  border-radius: 10px;
}

.autocomplete-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.autocomplete-item:hover,
.autocomplete-item.selected {
  background: var(--hn-purple-muted);
}

.autocomplete-item ion-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.file-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.file-name {
  font-size: 0.9rem;
  color: var(--hn-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.file-path {
  font-size: 0.75rem;
  color: var(--hn-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.file-project {
  font-size: 0.7rem;
  color: var(--hn-purple);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  line-height: 1.2;
}

.item-type-badge {
  display: inline-block;
  width: fit-content;
  font-size: 0.6rem;
  color: var(--hn-green);
  background: rgba(0, 200, 83, 0.12);
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  line-height: 1.2;
}

.autocomplete-item.is-project {
  border-left: 3px solid var(--hn-green);
  padding-left: 10px;
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



