<template>
  <div class="tree-node" :style="{ paddingLeft: `${depth * 12}px` }">
    <!-- Node Row -->
    <div 
      class="node-row"
      :class="{ 
        selected: isSelected,
        directory: node.type === 'directory',
        expanded: node.expanded 
      }"
      @click="handleClick"
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
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
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
import type { FileTreeNode as FileTreeNodeType } from '@/types';

interface Props {
  node: FileTreeNodeType;
  depth: number;
  selectedFileId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'select', node: FileTreeNodeType): void;
  (e: 'toggle', node: FileTreeNodeType): void;
}>();

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
    return props.node.expanded ? '#58a6ff' : '#8b949e';
  }
  
  // File colors by type
  switch (props.node.fileType) {
    case 'md':
      return '#58a6ff';
    case 'pdf':
      return '#f85149';
    case 'docx':
      return '#3fb950';
    case 'txt':
      return '#8b949e';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
      return '#a371f7';
    default:
      return '#8b949e';
  }
});

function handleClick() {
  if (props.node.type === 'directory') {
    emit('toggle', props.node);
  } else {
    emit('select', props.node);
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
  background: rgba(177, 186, 196, 0.12);
}

.node-row.selected {
  background: rgba(56, 139, 253, 0.15);
}

.node-row.selected:hover {
  background: rgba(56, 139, 253, 0.2);
}

.chevron-icon {
  font-size: 12px;
  color: #8b949e;
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
  color: #e6edf3;
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
  background: #3fb950;
}

.status-dot.processing {
  background: #d29922;
}

.status-dot.error {
  background: #f85149;
}

.status-dot.pending {
  background: #8b949e;
}

.node-children {
  /* Children are rendered recursively */
}
</style>


