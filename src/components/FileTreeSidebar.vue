<template>
  <div 
    class="file-tree-sidebar" 
    :class="{ collapsed: isCollapsed }"
    @dragover.prevent="handleRootDragOver"
    @drop.prevent="handleRootDrop"
  >
    <!-- Collapsed Vertical Tab -->
    <div v-if="isCollapsed" class="collapsed-tab" @click="toggleCollapse">
      <ion-icon :icon="folderOutline" />
      <span class="tab-label">Files</span>
      <ion-icon :icon="chevronForwardOutline" class="tab-chevron" />
    </div>

    <!-- Expanded Sidebar -->
    <template v-else>
      <!-- Sidebar Header -->
      <div class="sidebar-header">
        <div class="header-content">
          <ion-icon :icon="folderOutline" class="header-icon" />
          <span class="header-title">Files</span>
          <span class="file-count">{{ fileTree?.totalFiles || 0 }}</span>
        </div>
        <ion-button 
          fill="clear" 
          size="small" 
          class="collapse-btn"
          @click="toggleCollapse"
        >
          <ion-icon slot="icon-only" :icon="chevronBackOutline" />
        </ion-button>
      </div>

      <!-- Tree Content -->
      <div class="tree-content">
        <!-- Loading State -->
        <div v-if="loading" class="tree-loading">
          <ion-spinner name="dots" />
        </div>

        <!-- Empty State -->
        <div v-else-if="!fileTree || fileTree.totalFiles === 0" class="tree-empty">
          <ion-icon :icon="documentOutline" />
          <p>No files yet</p>
        </div>

        <!-- File Tree -->
        <div v-else class="tree-nodes">
          <FileTreeNode
            v-for="node in fileTree.nodes"
            :key="node.id"
            :node="node"
            :depth="0"
            :selected-file-id="selectedFileId"
            @select="handleNodeSelect"
            @toggle="handleNodeToggle"
            @context-menu="handleContextMenu"
            @drag-start="handleDragStart"
            @drop="handleNodeDrop"
          />
        </div>
      </div>
    </template>

    <!-- Context Menu -->
    <FileTreeContextMenu
      :is-open="contextMenu.isOpen"
      :event="contextMenu.event"
      :target-type="contextMenu.targetType"
      :target-id="contextMenu.targetId"
      :target-name="contextMenu.targetName"
      :project-id="projectId"
      @close="closeContextMenu"
      @action="handleContextMenuAction"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, reactive } from 'vue';
import { IonIcon, IonButton, IonSpinner, alertController } from '@ionic/vue';
import {
  folderOutline,
  documentOutline,
  chevronForwardOutline,
  chevronBackOutline,
} from 'ionicons/icons';
import type { ProjectFileTree, FileTreeNode as FileTreeNodeType, ProjectFile, ContextMenuEvent, DragDropEvent, ContextMenuTargetType, ContextMenuAction } from '@/types';
import { getProjectFileTree, deleteFile, moveFile, createEmptyMarkdownFile } from '@/services';
import FileTreeNode from './FileTreeNode.vue';
import FileTreeContextMenu from './FileTreeContextMenu.vue';

interface Props {
  projectId: string;
  selectedFileId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'select-file', file: { id: string; path: string; type: string }): void;
  (e: 'collapse-change', collapsed: boolean): void;
  (e: 'file-created', file: ProjectFile): void;
  (e: 'files-changed'): void;
}>();

const loading = ref(true);
const fileTree = ref<ProjectFileTree | null>(null);
const isCollapsed = ref(false);
const draggingNode = ref<FileTreeNodeType | null>(null);

// Context menu state
const contextMenu = reactive({
  isOpen: false,
  event: null as MouseEvent | null,
  targetType: 'file' as ContextMenuTargetType,
  targetId: '',
  targetName: '',
});

onMounted(async () => {
  await loadFileTree();
});

watch(() => props.projectId, async () => {
  await loadFileTree();
});

async function loadFileTree() {
  if (!props.projectId) return;
  
  loading.value = true;
  try {
    fileTree.value = await getProjectFileTree(props.projectId);
  } catch (error) {
    console.error('Failed to load file tree:', error);
  } finally {
    loading.value = false;
  }
}

function handleNodeSelect(node: FileTreeNodeType) {
  if (node.type === 'file') {
    emit('select-file', {
      id: node.id,
      path: node.path,
      type: node.fileType || 'txt',
    });
  }
}

function handleNodeToggle(node: FileTreeNodeType) {
  // Toggle directory expansion
  if (node.type === 'directory' && fileTree.value) {
    toggleNodeExpanded(fileTree.value.nodes, node.id);
    // Force reactivity update
    fileTree.value = { ...fileTree.value };
  }
}

function toggleNodeExpanded(nodes: FileTreeNodeType[], targetId: string): boolean {
  for (const node of nodes) {
    if (node.id === targetId) {
      node.expanded = !node.expanded;
      return true;
    }
    if (node.children && toggleNodeExpanded(node.children, targetId)) {
      return true;
    }
  }
  return false;
}

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value;
  emit('collapse-change', isCollapsed.value);
}

// ============================================
// Context Menu Handlers
// ============================================

function handleContextMenu(payload: ContextMenuEvent) {
  contextMenu.isOpen = true;
  contextMenu.event = payload.event;
  contextMenu.targetType = payload.node.type === 'directory' ? 'directory' : 'file';
  contextMenu.targetId = payload.node.id;
  contextMenu.targetName = payload.node.name;
}

function closeContextMenu() {
  contextMenu.isOpen = false;
  contextMenu.event = null;
}

async function handleContextMenuAction(action: ContextMenuAction, targetId: string, targetName: string) {
  switch (action) {
    case 'new-file':
      await promptCreateFile(targetId, targetName);
      break;
    case 'delete-file':
      await confirmDeleteFile(targetId, targetName);
      break;
    case 'delete-directory':
      await confirmDeleteDirectory(targetId, targetName);
      break;
  }
}

async function promptCreateFile(directoryId: string, directoryName: string) {
  const alert = await alertController.create({
    header: 'New File',
    message: `Create a new markdown file${directoryName ? ` in ${directoryName}` : ''}`,
    inputs: [
      {
        name: 'fileName',
        type: 'text',
        placeholder: 'File name (e.g., my-note)',
      },
    ],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Create',
        handler: async (data) => {
          if (data.fileName?.trim()) {
            await createFile(data.fileName.trim(), directoryId.startsWith('dir:') ? directoryId.replace('dir:', '') : undefined);
          }
        },
      },
    ],
  });
  await alert.present();
}

async function createFile(fileName: string, directory?: string) {
  try {
    const file = await createEmptyMarkdownFile(props.projectId, fileName, directory);
    await loadFileTree();
    emit('file-created', file);
  } catch (error) {
    const alert = await alertController.create({
      header: 'Error',
      message: `Failed to create file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      buttons: ['OK'],
    });
    await alert.present();
  }
}

async function confirmDeleteFile(fileId: string, fileName: string) {
  const alert = await alertController.create({
    header: 'Delete File',
    message: `Are you sure you want to delete "${fileName}"? This action cannot be undone.`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Delete',
        role: 'destructive',
        handler: async () => {
          await performDeleteFile(fileId);
        },
      },
    ],
  });
  await alert.present();
}

async function performDeleteFile(fileId: string) {
  try {
    await deleteFile(fileId);
    await loadFileTree();
    emit('files-changed');
  } catch (error) {
    const alert = await alertController.create({
      header: 'Error',
      message: `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      buttons: ['OK'],
    });
    await alert.present();
  }
}

async function confirmDeleteDirectory(directoryId: string, directoryName: string) {
  // Get all files in this directory
  const directoryPath = directoryId.replace('dir:', '');
  const filesInDirectory = findFilesInDirectory(fileTree.value?.nodes || [], directoryPath);
  
  if (filesInDirectory.length === 0) {
    const alert = await alertController.create({
      header: 'Empty Directory',
      message: `"${directoryName}" is empty. Nothing to delete.`,
      buttons: ['OK'],
    });
    await alert.present();
    return;
  }
  
  const alert = await alertController.create({
    header: 'Delete Directory',
    message: `Are you sure you want to delete "${directoryName}" and all ${filesInDirectory.length} file(s) inside? This action cannot be undone.`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Delete All',
        role: 'destructive',
        handler: async () => {
          for (const fileId of filesInDirectory) {
            await deleteFile(fileId);
          }
          await loadFileTree();
          emit('files-changed');
        },
      },
    ],
  });
  await alert.present();
}

function findFilesInDirectory(nodes: FileTreeNodeType[], directoryPath: string): string[] {
  const fileIds: string[] = [];
  
  for (const node of nodes) {
    if (node.type === 'file' && node.path.startsWith(directoryPath + '/')) {
      fileIds.push(node.id);
    }
    if (node.children) {
      fileIds.push(...findFilesInDirectory(node.children, directoryPath));
    }
  }
  
  return fileIds;
}

// ============================================
// Drag and Drop Handlers
// ============================================

function handleDragStart(node: FileTreeNodeType) {
  draggingNode.value = node;
}

async function handleNodeDrop(payload: DragDropEvent) {
  if (!payload.sourceNode || payload.sourceNode.type !== 'file') return;
  
  const targetDirectory = payload.targetNode.path;
  
  try {
    await moveFile(payload.sourceNode.id, props.projectId, targetDirectory);
    await loadFileTree();
    emit('files-changed');
  } catch (error) {
    const alert = await alertController.create({
      header: 'Error',
      message: `Failed to move file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      buttons: ['OK'],
    });
    await alert.present();
  }
  
  draggingNode.value = null;
}

function handleRootDragOver(event: DragEvent) {
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

async function handleRootDrop(event: DragEvent) {
  if (!event.dataTransfer) return;
  
  const data = event.dataTransfer.getData('application/json');
  if (!data) return;
  
  try {
    const sourceNode = JSON.parse(data) as FileTreeNodeType;
    if (sourceNode.type !== 'file') return;
    
    // Move to root (no directory)
    await moveFile(sourceNode.id, props.projectId, undefined);
    await loadFileTree();
    emit('files-changed');
  } catch {
    // Invalid data or move failed, ignore
  }
  
  draggingNode.value = null;
}

// Expose refresh method
async function refresh() {
  await loadFileTree();
}

defineExpose({ refresh });
</script>

<style scoped>
.file-tree-sidebar {
  display: flex;
  flex-direction: column;
  width: 260px;
  min-width: 260px;
  max-width: 260px;
  height: 100%;
  background: #161b22;
  border-right: 1px solid #30363d;
  transition: all 0.2s ease;
  overflow: hidden;
}

.file-tree-sidebar.collapsed {
  width: 0;
  min-width: 0;
  max-width: 0;
  background: transparent;
  border-right: none;
  position: relative;
  overflow: visible;
}

/* Collapsed Vertical Tab */
.collapsed-tab {
  position: absolute;
  left: 0;
  top: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 6px;
  background: #21262d;
  border-radius: 0 8px 8px 0;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid #30363d;
  border-left: none;
  z-index: 10;
}

.collapsed-tab:hover {
  background: #30363d;
}

.collapsed-tab ion-icon {
  font-size: 16px;
  color: #8b949e;
}

.collapsed-tab:hover ion-icon {
  color: #58a6ff;
}

.collapsed-tab .tab-label {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 0.7rem;
  font-weight: 600;
  color: #8b949e;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.collapsed-tab:hover .tab-label {
  color: #e6edf3;
}

.collapsed-tab .tab-chevron {
  font-size: 12px;
}

/* Expanded Sidebar */
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 8px 12px 16px;
  border-bottom: 1px solid #30363d;
  min-height: 48px;
}

.header-content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.header-icon {
  font-size: 18px;
  color: #8b949e;
  flex-shrink: 0;
}

.header-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: #e6edf3;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.file-count {
  font-size: 0.7rem;
  color: #8b949e;
  background: #21262d;
  padding: 2px 6px;
  border-radius: 10px;
}

.collapse-btn {
  --padding-start: 4px;
  --padding-end: 4px;
  --color: #8b949e;
  margin: 0;
  height: 28px;
  width: 28px;
}

.collapse-btn:hover {
  --color: #e6edf3;
}

.tree-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0;
}

.tree-loading {
  display: flex;
  justify-content: center;
  padding: 24px;
}

.tree-loading ion-spinner {
  --color: #8b949e;
}

.tree-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  color: #484f58;
  text-align: center;
}

.tree-empty ion-icon {
  font-size: 32px;
  margin-bottom: 8px;
  opacity: 0.6;
}

.tree-empty p {
  margin: 0;
  font-size: 0.85rem;
}

.tree-nodes {
  padding: 0 4px;
}

/* Scrollbar styling */
.tree-content::-webkit-scrollbar {
  width: 6px;
}

.tree-content::-webkit-scrollbar-track {
  background: transparent;
}

.tree-content::-webkit-scrollbar-thumb {
  background: #30363d;
  border-radius: 3px;
}

.tree-content::-webkit-scrollbar-thumb:hover {
  background: #484f58;
}
</style>

