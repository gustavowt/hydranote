<template>
  <div class="tree-node" :style="{ paddingLeft: `${depth * 12}px` }">
    <!-- Node Row -->
    <div 
      class="node-row"
      :class="{ 
        selected: isSelected,
        directory: node.type === 'directory',
        expanded: node.expanded,
        'drag-over': isDragOver
      }"
      :data-file-id="node.type === 'file' ? node.id : undefined"
      :data-dir-path="node.type === 'directory' ? node.path : undefined"
      :draggable="node.type === 'file'"
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
      
      <!-- File status badge -->
      <span v-if="node.type === 'file' && node.status" class="status-dot" :class="node.status" />
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

interface Props {
  node: FileTreeNodeType;
  depth: number;
  selectedFileId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'select', node: FileTreeNodeType): void;
  (e: 'toggle', node: FileTreeNodeType): void;
  (e: 'context-menu', payload: ContextMenuEvent): void;
  (e: 'drag-start', node: FileTreeNodeType): void;
  (e: 'drop', payload: DragDropEvent): void;
}>();

const isDragOver = ref(false);

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
  if (props.node.type === 'directory') {
    emit('toggle', props.node);
  } else {
    emit('select', props.node);
  }
}

function handleContextMenu(event: MouseEvent) {
  emit('context-menu', { event, node: props.node });
}

function handleDragStart(event: DragEvent) {
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
}

function handleDragOver(event: DragEvent) {
  // Only allow drop on directories
  if (props.node.type === 'directory') {
    isDragOver.value = true;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }
}

function handleDragLeave() {
  isDragOver.value = false;
}

function handleDrop(event: DragEvent) {
  isDragOver.value = false;
  
  if (props.node.type !== 'directory' || !event.dataTransfer) return;
  
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


