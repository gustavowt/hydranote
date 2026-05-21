<template>
  <div class="tree-node" :style="{ paddingLeft: `${depth * 12}px` }">
    <!-- Node Row -->
    <div 
      class="node-row"
      :class="{ 
        selected: isSelected,
        directory: node.type === 'directory',
        expanded: node.expanded,
        'drag-over': isDragOver,
        'os-drag-over': isOsDragOver,
        'ingesting': isIngesting,
      }"
      :data-file-id="node.type === 'file' ? node.id : undefined"
      :data-dir-path="node.type === 'directory' ? node.path : undefined"
      :draggable="node.type === 'file' && !isIngesting"
      @click="handleClick"
      @contextmenu.prevent="handleContextMenu"
      @dragstart="handleDragStart"
      @dragend="handleDragEnd"
      @dragover.prevent="handleDragOver"
      @dragleave="handleDragLeave"
      @drop.prevent="handleDrop"
    >
      <!-- Chevron for directories -->
      <ion-icon 
        v-if="node.type === 'directory'"
        :icon="node.expanded ? chevronDownOutline : chevronForwardOutline"
        class="chevron-icon"
      />
      <span v-else class="chevron-spacer" />
      
      <!-- File/Folder Icon -->
      <ion-icon :icon="nodeIcon" class="node-icon" :style="{ color: iconColor }" />
      
      <!-- Name -->
      <span class="node-name" :title="node.path">{{ node.name }}</span>

      <!-- Inline progress percentage shown while a drop is being indexed -->
      <span v-if="ingestionEntry" class="ingestion-percent" :title="ingestionEntry.stage">
        {{ Math.round(ingestionEntry.percent) }}%
      </span>

      <!-- File status badge (hidden while ingesting so the percent reads cleanly) -->
      <span
        v-if="node.type === 'file' && node.status && !ingestionEntry"
        class="status-dot"
        :class="node.status"
      />

      <!-- Thin progress bar overlay -->
      <div v-if="ingestionEntry" class="ingestion-bar" aria-hidden="true">
        <div class="ingestion-bar-fill" :style="{ width: `${ingestionEntry.percent}%` }" />
      </div>
    </div>

    <!-- Children (for directories) -->
    <div v-if="node.type === 'directory' && node.expanded && node.children" class="node-children">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :selected-file-id="selectedFileId"
        @select="$emit('select', $event)"
        @toggle="$emit('toggle', $event)"
        @context-menu="$emit('context-menu', $event)"
        @drag-start="$emit('drag-start', $event)"
        @drop="$emit('drop', $event)"
        @os-files-drop="$emit('os-files-drop', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import {
  chevronForwardOutline,
  chevronDownOutline,
  folderOutline,
  folderOpenOutline,
  documentOutline,
  documentTextOutline,
  imageOutline,
  codeSlashOutline,
  logoMarkdown,
} from 'ionicons/icons';
import type { FileTreeNode as FileTreeNodeType, ContextMenuEvent, DragDropEvent } from '@/types';
import { ingestionProgress } from '@/services/fileIngestionService';

interface Props {
  node: FileTreeNodeType;
  depth: number;
  selectedFileId?: string;
}

export interface OsFilesDropPayload {
  /**
   * The drop event itself. The parent component is responsible for resolving
   * `dataTransfer.items` (recurses into folders) or `dataTransfer.files`
   * (flat) — `FileTreeNode` only forwards the raw event so it doesn't have
   * to import the ingestion service for its types.
   */
  event: DragEvent;
  /**
   * Either the directory the drop landed on, or the parent directory of a
   * file the drop landed on. `undefined` means "project root".
   */
  targetDirectory?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'select', node: FileTreeNodeType): void;
  (e: 'toggle', node: FileTreeNodeType): void;
  (e: 'context-menu', payload: ContextMenuEvent): void;
  (e: 'drag-start', node: FileTreeNodeType): void;
  (e: 'drop', payload: DragDropEvent): void;
  (e: 'os-files-drop', payload: OsFilesDropPayload): void;
}>();

const isDragOver = ref(false);
const isOsDragOver = ref(false);

const ingestionEntry = computed(() => {
  if (props.node.type !== 'file') return undefined;
  return ingestionProgress.value.get(props.node.id);
});

const isIngesting = computed(() => ingestionEntry.value !== undefined);

const isSelected = computed(() => {
  return props.node.type === 'file' && props.node.id === props.selectedFileId;
});

const nodeIcon = computed(() => {
  if (props.node.type === 'directory') {
    return props.node.expanded ? folderOpenOutline : folderOutline;
  }
  
  // File icons by type
  switch (props.node.fileType) {
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
});

const iconColor = computed(() => {
  if (props.node.type === 'directory') {
    return props.node.expanded ? 'var(--hn-teal)' : 'var(--hn-text-secondary)';
  }
  
  // File colors by type
  switch (props.node.fileType) {
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
});

function handleClick() {
  // Ignore clicks on rows that are still being ingested so the user can't
  // open a file mid-pipeline (its content might be incomplete).
  if (isIngesting.value) return;
  if (props.node.type === 'directory') {
    emit('toggle', props.node);
  } else {
    emit('select', props.node);
  }
}

function handleContextMenu(event: MouseEvent) {
  if (isIngesting.value) return;
  emit('context-menu', { event, node: props.node });
}

function handleDragStart(event: DragEvent) {
  if (isIngesting.value) {
    event.preventDefault();
    return;
  }
  if (props.node.type === 'file' && event.dataTransfer) {
    event.dataTransfer.setData('application/json', JSON.stringify({
      id: props.node.id,
      name: props.node.name,
      path: props.node.path,
      type: props.node.type,
      fileType: props.node.fileType,
    }));
    event.dataTransfer.effectAllowed = 'move';
    emit('drag-start', props.node);
  }
}

function handleDragEnd() {
  isDragOver.value = false;
  isOsDragOver.value = false;
}

/**
 * Returns true when the drag carries OS files. We accept an OS drop on either
 * a directory (lands inside it) or a file (lands in the file's parent dir).
 */
function dragCarriesOsFiles(event: DragEvent): boolean {
  const dt = event.dataTransfer;
  if (!dt) return false;
  // Some browsers expose `types` but not `files` until drop-time. We check
  // both: presence of a 'Files' type signals an OS drag.
  if (dt.types && Array.from(dt.types).includes('Files')) return true;
  return (dt.files?.length ?? 0) > 0;
}

function handleDragOver(event: DragEvent) {
  if (dragCarriesOsFiles(event)) {
    // OS drops are accepted on directories AND on file rows (we route to
    // the file's parent below in `handleDrop`).
    isOsDragOver.value = true;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    return;
  }
  // In-app moves: only directories accept drops.
  if (props.node.type === 'directory') {
    isDragOver.value = true;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }
}

function handleDragLeave() {
  isDragOver.value = false;
  isOsDragOver.value = false;
}

/**
 * Compute the directory the drop should land in.
 * - On a directory row: that directory's path (or `undefined` for project root).
 * - On a file row: the file's parent directory path (or `undefined` for project root).
 */
function targetDirectoryForDrop(): string | undefined {
  if (props.node.type === 'directory') {
    return props.node.path || undefined;
  }
  // File row → parent directory derived from the file path.
  const filePath = props.node.path || '';
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash <= 0) return undefined;
  return filePath.slice(0, lastSlash);
}

function handleDrop(event: DragEvent) {
  isDragOver.value = false;
  isOsDragOver.value = false;

  if (!event.dataTransfer) return;

  // OS file drop takes priority over in-app moves: if the user dragged from
  // outside the app, treat it as an external import even if some legacy
  // payload is also present.
  if (dragCarriesOsFiles(event)) {
    emit('os-files-drop', { event, targetDirectory: targetDirectoryForDrop() });
    return;
  }

  // In-app moves: only directories accept drops.
  if (props.node.type !== 'directory') return;

  const data = event.dataTransfer.getData('application/json');
  if (!data) return;

  try {
    const sourceNode = JSON.parse(data) as FileTreeNodeType;
    emit('drop', { sourceNode, targetNode: props.node });
  } catch {
    // Invalid data, ignore
  }
}
</script>

<style scoped>
.tree-node {
  user-select: none;
}

.node-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s ease;
  position: relative;
}

.node-row:hover {
  background: var(--hn-bg-elevated);
}

.node-row.selected {
  background: var(--hn-teal-muted);
}

.node-row.selected:hover {
  background: var(--hn-teal-glow);
}

.node-row.drag-over {
  background: var(--hn-teal-muted);
  outline: 2px dashed var(--hn-teal);
  outline-offset: -2px;
}

.node-row.os-drag-over {
  background: var(--hn-purple-muted, var(--hn-teal-muted));
  outline: 2px dashed var(--hn-purple, var(--hn-teal));
  outline-offset: -2px;
}

.node-row.ingesting {
  cursor: progress;
  opacity: 0.92;
  overflow: hidden;
}

.node-row.ingesting .node-name {
  color: var(--hn-text-secondary);
}

/*
 * Moving sheen that signals "this row is being processed". Drawn as a
 * pseudo-element so it doesn't fight with the per-row background-color
 * states (selected, hover, drag-over, os-drag-over). The 2px progress bar
 * underneath is the source of truth for "how much is done"; this overlay
 * only communicates "actively working".
 */
.node-row.ingesting::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.07) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: hn-row-shimmer 1.8s linear infinite;
  pointer-events: none;
  border-radius: inherit;
}

@keyframes hn-row-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .node-row.ingesting::after {
    animation: none;
  }
}

.ingestion-percent {
  font-size: 0.75rem;
  color: var(--hn-text-secondary);
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
  flex-shrink: 0;
}

.ingestion-bar {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 1px;
  height: 2px;
  background: var(--hn-bg-elevated);
  border-radius: 2px;
  overflow: hidden;
  pointer-events: none;
}

.ingestion-bar-fill {
  height: 100%;
  background: var(--hn-teal);
  transition: width 0.2s ease;
}

.chevron-icon {
  font-size: 12px;
  color: var(--hn-text-secondary);
  flex-shrink: 0;
  width: 16px;
}

.chevron-spacer {
  width: 16px;
  flex-shrink: 0;
}

.node-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.node-name {
  flex: 1;
  font-size: 0.85rem;
  color: var(--hn-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-row.directory .node-name {
  font-weight: 500;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-left: 4px;
}

.status-dot.indexed {
  background: var(--hn-green);
}

.status-dot.processing {
  background: var(--hn-warning);
}

.status-dot.error {
  background: var(--hn-danger);
}

.status-dot.pending {
  background: var(--hn-text-secondary);
}

.node-children {
  /* Children are rendered recursively */
}
</style>


