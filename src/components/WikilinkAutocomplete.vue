<template>
  <Teleport to="body">
    <div
      v-if="isVisible && filteredFiles.length > 0"
      class="wikilink-autocomplete"
      :style="positionStyle"
      ref="menuRef"
    >
      <div class="wikilink-header">
        <ion-icon :icon="linkOutline" />
        <span>Link to file</span>
      </div>
      <div class="wikilink-list" ref="listRef">
        <div
          v-for="(file, index) in filteredFiles"
          :key="file.id"
          class="wikilink-item"
          :class="{ selected: index === selectedIndex }"
          :data-wikilink-index="index"
          @click="selectFile(file)"
          @mouseenter="selectedIndex = index"
        >
          <ion-icon :icon="documentTextOutline" />
          <div class="wikilink-info">
            <span class="wikilink-name">{{ file.name }}</span>
            <span v-if="file.projectName" class="wikilink-project">{{ file.projectName }}</span>
            <span v-else-if="file.path !== file.name" class="wikilink-path">{{ file.path }}</span>
          </div>
        </div>
      </div>
      <div class="wikilink-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> select</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { IonIcon } from '@ionic/vue';
import { linkOutline, documentTextOutline } from 'ionicons/icons';
import type { SupportedFileType } from '@/types';
import { getProjectFilesForAutocomplete, getAllFilesForAutocomplete } from '@/services';

export interface WikilinkFileItem {
  id: string;
  name: string;
  path: string;
  type: SupportedFileType;
  projectId?: string;
  projectName?: string;
}

const props = defineProps<{
  projectId?: string;
  searchQuery: string;
  isVisible: boolean;
  anchorRect?: DOMRect | null;
}>();

const emit = defineEmits<{
  (e: 'select', file: WikilinkFileItem): void;
  (e: 'close'): void;
}>();

const files = ref<WikilinkFileItem[]>([]);
const selectedIndex = ref(0);
const menuRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

const MENU_MAX_HEIGHT = 320;
const MENU_MAX_WIDTH = 360;
const VIEWPORT_PAD = 8;

const positionStyle = ref<Record<string, string | number>>({ display: 'none' });

const filteredFiles = computed(() => {
  let list = files.value;
  if (props.searchQuery) {
    const q = props.searchQuery.toLowerCase();
    list = list.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.path.toLowerCase().includes(q) ||
        (f.projectName && f.projectName.toLowerCase().includes(q)),
    );
  }
  return list.slice(0, 10);
});

function computePosition(): void {
  if (!props.anchorRect || !props.isVisible || filteredFiles.value.length === 0) {
    positionStyle.value = { display: 'none' };
    return;
  }

  const measuredHeight = menuRef.value?.offsetHeight || MENU_MAX_HEIGHT;
  const measuredWidth = menuRef.value?.offsetWidth || MENU_MAX_WIDTH;
  const spaceBelow = window.innerHeight - props.anchorRect.bottom - VIEWPORT_PAD;
  const spaceAbove = props.anchorRect.top - VIEWPORT_PAD;
  const placeAbove =
    spaceBelow < measuredHeight && spaceAbove > spaceBelow;

  let top = placeAbove
    ? props.anchorRect.top - measuredHeight - 4
    : props.anchorRect.bottom + 4;
  top = Math.max(
    VIEWPORT_PAD,
    Math.min(top, window.innerHeight - measuredHeight - VIEWPORT_PAD),
  );

  let left = Math.max(VIEWPORT_PAD, props.anchorRect.left);
  if (left + measuredWidth > window.innerWidth - VIEWPORT_PAD) {
    left = Math.max(VIEWPORT_PAD, window.innerWidth - measuredWidth - VIEWPORT_PAD);
  }

  positionStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    maxWidth: `${MENU_MAX_WIDTH}px`,
    zIndex: 10000,
  };
}

async function updatePosition(): Promise<void> {
  computePosition();
  await nextTick();
  computePosition();
}

async function loadFiles() {
  try {
    if (props.projectId) {
      files.value = await getProjectFilesForAutocomplete(props.projectId);
    } else {
      files.value = await getAllFilesForAutocomplete();
    }
  } catch (error) {
    console.error('Failed to load files for wikilink autocomplete:', error);
    files.value = [];
  }
}

watch(
  () => props.isVisible,
  (visible) => {
    if (visible) {
      selectedIndex.value = 0;
      void loadFiles().then(() => updatePosition());
    } else {
      positionStyle.value = { display: 'none' };
    }
  },
);

watch(
  () => [props.anchorRect, filteredFiles.value.length] as const,
  () => {
    if (props.isVisible) void updatePosition();
  },
);

watch(filteredFiles, () => {
  selectedIndex.value = 0;
});

function selectFile(file: WikilinkFileItem) {
  emit('select', file);
}

function scrollSelectedIntoView() {
  void nextTick(() => {
    const list = listRef.value;
    if (!list) return;
    const item = list.querySelector(
      `[data-wikilink-index="${selectedIndex.value}"]`,
    ) as HTMLElement | null;
    item?.scrollIntoView({ block: 'nearest' });
  });
}

function handleKeydown(event: KeyboardEvent) {
  if (!props.isVisible || filteredFiles.value.length === 0) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % filteredFiles.value.length;
    scrollSelectedIntoView();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectedIndex.value =
      (selectedIndex.value - 1 + filteredFiles.value.length) % filteredFiles.value.length;
    scrollSelectedIntoView();
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    const file = filteredFiles.value[selectedIndex.value];
    if (file) emit('select', file);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown, true);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown, true);
});
</script>

<style scoped>
.wikilink-autocomplete {
  background: var(--hn-bg-elevated, #1e1e2e);
  border: 1px solid var(--hn-border-default, #333);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  font-size: 0.85rem;
}

.wikilink-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  color: var(--hn-text-secondary, #888);
  border-bottom: 1px solid var(--hn-border-default, #333);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.wikilink-list {
  max-height: 260px;
  overflow-y: auto;
}

.wikilink-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
}

.wikilink-item:hover,
.wikilink-item.selected {
  background: var(--hn-bg-hover, rgba(255, 255, 255, 0.06));
}

.wikilink-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.wikilink-name {
  font-weight: 500;
  color: var(--hn-text-primary, #eee);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wikilink-project,
.wikilink-path {
  font-size: 0.75rem;
  color: var(--hn-text-secondary, #888);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wikilink-footer {
  display: flex;
  gap: 12px;
  padding: 6px 12px;
  border-top: 1px solid var(--hn-border-default, #333);
  font-size: 0.7rem;
  color: var(--hn-text-secondary, #888);
}

.wikilink-footer kbd {
  background: var(--hn-bg-surface, #2a2a3e);
  border: 1px solid var(--hn-border-default, #444);
  border-radius: 3px;
  padding: 1px 4px;
  font-family: inherit;
  font-size: 0.65rem;
}
</style>
