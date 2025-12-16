<template>
  <div class="projects-tree-sidebar" :class="{ collapsed: isCollapsed }">
    <!-- Collapsed Vertical Tab -->
    <div v-if="isCollapsed" class="collapsed-tab" @click="toggleCollapse">
      <ion-icon :icon="layersOutline" />
      <span class="tab-label">Projects</span>
      <ion-icon :icon="chevronForwardOutline" class="tab-chevron" />
    </div>

    <!-- Expanded Sidebar -->
    <template v-else>
      <!-- Sidebar Header -->
      <div class="sidebar-header">
        <div class="header-content">
          <ion-icon :icon="layersOutline" class="header-icon" />
          <span class="header-title">Projects</span>
          <span class="project-count">{{ projects.length }}</span>
        </div>
        <div class="header-actions">
          <ion-button 
            fill="clear" 
            size="small" 
            class="add-btn"
            @click="$emit('create-project')"
          >
            <ion-icon slot="icon-only" :icon="addOutline" />
          </ion-button>
          <ion-button 
            fill="clear" 
            size="small" 
            class="collapse-btn"
            @click="toggleCollapse"
          >
            <ion-icon slot="icon-only" :icon="chevronBackOutline" />
          </ion-button>
        </div>
      </div>

      <!-- Tree Content -->
      <div class="tree-content">
        <!-- Empty State -->
        <div v-if="projects.length === 0" class="tree-empty">
          <ion-icon :icon="folderOpenOutline" />
          <p>No projects yet</p>
          <ion-button fill="clear" size="small" @click="$emit('create-project')">
            Create Project
          </ion-button>
        </div>

        <!-- Projects Tree -->
        <div v-else class="tree-nodes">
          <div 
            v-for="project in projects" 
            :key="project.id" 
            class="project-node"
            @dragover.prevent="handleProjectDragOver($event, project.id)"
            @dragleave="handleProjectDragLeave(project.id)"
            @drop.prevent="handleProjectDrop($event, project.id)"
          >
            <!-- Project Header -->
            <div 
              class="project-header"
              :class="{ 
                selected: selectedProjectId === project.id,
                expanded: expandedProjects.has(project.id),
                'drag-over': dragOverProjectId === project.id
              }"
              @click="toggleProject(project)"
              @contextmenu.prevent="handleProjectContextMenu($event, project)"
            >
              <ion-icon 
                :icon="expandedProjects.has(project.id) ? chevronDownOutline : chevronForwardOutline" 
                class="expand-icon"
              />
              <ion-icon :icon="folderOutline" class="folder-icon" />
              <span class="project-name">{{ project.name }}</span>
              <span v-if="projectFileCounts[project.id]" class="file-count">
                {{ projectFileCounts[project.id] }}
              </span>
            </div>

            <!-- Project Files (expanded) -->
            <div 
              v-if="expandedProjects.has(project.id)" 
              class="project-files"
            >
              <!-- Loading files -->
              <div v-if="loadingFiles.has(project.id)" class="files-loading">
                <ion-spinner name="dots" />
              </div>

              <!-- No files -->
              <div 
                v-else-if="!projectFileTrees[project.id] || projectFileTrees[project.id].totalFiles === 0" 
                class="files-empty"
              >
                <span>No files</span>
              </div>

              <!-- File tree nodes -->
              <template v-else>
                <FileTreeNode
                  v-for="node in projectFileTrees[project.id].nodes"
                  :key="node.id"
                  :node="node"
                  :depth="1"
                  :selected-file-id="selectedFileId"
                  @select="(n) => handleFileSelect(project.id, n)"
                  @toggle="(n) => handleNodeToggle(project.id, n)"
                  @context-menu="(payload) => handleNodeContextMenu(project.id, payload)"
                  @drag-start="handleDragStart"
                  @drop="(payload) => handleNodeDrop(project.id, payload)"
                />
              </template>
            </div>
          </div>
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
      :project-id="contextMenu.projectId"
      @close="closeContextMenu"
      @action="handleContextMenuAction"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, reactive, nextTick } from 'vue';
import { IonIcon, IonButton, IonSpinner, alertController } from '@ionic/vue';
import {
  layersOutline,
  folderOutline,
  folderOpenOutline,
  chevronForwardOutline,
  chevronBackOutline,
  chevronDownOutline,
  addOutline,
} from 'ionicons/icons';
import type { Project, ProjectFileTree, FileTreeNode as FileTreeNodeType, ProjectFile, ContextMenuEvent, DragDropEvent, ContextMenuTargetType, ContextMenuAction } from '@/types';
import { getProjectFileTree, deleteProject, deleteFile, moveFile, createEmptyMarkdownFile } from '@/services';
import FileTreeNode from './FileTreeNode.vue';
import FileTreeContextMenu from './FileTreeContextMenu.vue';

interface Props {
  projects: Project[];
  selectedProjectId?: string;
  selectedFileId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'select-project', projectId: string): void;
  (e: 'select-file', projectId: string, file: { id: string; path: string; type: string }): void;
  (e: 'create-project'): void;
  (e: 'collapse-change', collapsed: boolean): void;
  (e: 'delete-project', projectId: string): void;
  (e: 'file-created', projectId: string, file: ProjectFile): void;
}>();

const isCollapsed = ref(false);
const expandedProjects = ref<Set<string>>(new Set());
const loadingFiles = ref<Set<string>>(new Set());
const projectFileTrees = ref<Record<string, ProjectFileTree>>({});
const draggingNode = ref<FileTreeNodeType | null>(null);
const dragOverProjectId = ref<string | null>(null);
const treeContentRef = ref<HTMLElement | null>(null);

// Context menu state
const contextMenu = reactive({
  isOpen: false,
  event: null as MouseEvent | null,
  targetType: 'project' as ContextMenuTargetType,
  targetId: '',
  targetName: '',
  projectId: '',
});

// Compute file counts for each project
const projectFileCounts = computed(() => {
  const counts: Record<string, number> = {};
  for (const [projectId, tree] of Object.entries(projectFileTrees.value)) {
    counts[projectId] = tree.totalFiles;
  }
  return counts;
});

// Watch for external project selection to auto-expand
watch(() => props.selectedProjectId, (newId) => {
  if (newId && !expandedProjects.value.has(newId)) {
    expandedProjects.value.add(newId);
    loadProjectFiles(newId);
  }
});

// Watch for external file selection to auto-expand parent directories and scroll into view
watch(() => props.selectedFileId, async (newFileId) => {
  if (newFileId && props.selectedProjectId) {
    await revealFile(props.selectedProjectId, newFileId);
  }
});

async function loadProjectFiles(projectId: string) {
  if (projectFileTrees.value[projectId]) return; // Already loaded
  
  loadingFiles.value.add(projectId);
  try {
    const tree = await getProjectFileTree(projectId);
    projectFileTrees.value = { ...projectFileTrees.value, [projectId]: tree };
  } finally {
    loadingFiles.value.delete(projectId);
  }
}

function toggleProject(project: Project) {
  if (expandedProjects.value.has(project.id)) {
    expandedProjects.value.delete(project.id);
  } else {
    expandedProjects.value.add(project.id);
    loadProjectFiles(project.id);
  }
  expandedProjects.value = new Set(expandedProjects.value); // Force reactivity
  emit('select-project', project.id);
}

function handleFileSelect(projectId: string, node: FileTreeNodeType) {
  if (node.type === 'file') {
    emit('select-file', projectId, {
      id: node.id,
      path: node.path,
      type: node.fileType || 'txt',
    });
  }
}

function handleNodeToggle(projectId: string, node: FileTreeNodeType) {
  if (node.type === 'directory' && projectFileTrees.value[projectId]) {
    toggleNodeExpanded(projectFileTrees.value[projectId].nodes, node.id);
    projectFileTrees.value = { ...projectFileTrees.value };
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

function handleProjectContextMenu(event: MouseEvent, project: Project) {
  contextMenu.isOpen = true;
  contextMenu.event = event;
  contextMenu.targetType = 'project';
  contextMenu.targetId = project.id;
  contextMenu.targetName = project.name;
  contextMenu.projectId = project.id;
}

function handleNodeContextMenu(projectId: string, payload: ContextMenuEvent) {
  contextMenu.isOpen = true;
  contextMenu.event = payload.event;
  contextMenu.targetType = payload.node.type === 'directory' ? 'directory' : 'file';
  contextMenu.targetId = payload.node.id;
  contextMenu.targetName = payload.node.name;
  contextMenu.projectId = projectId;
}

function closeContextMenu() {
  contextMenu.isOpen = false;
  contextMenu.event = null;
}

async function handleContextMenuAction(action: ContextMenuAction, targetId: string, targetName: string, projectId?: string) {
  switch (action) {
    case 'new-file':
      await promptCreateFile(projectId || '', targetId, targetName);
      break;
    case 'delete-project':
      await confirmDeleteProject(targetId, targetName);
      break;
    case 'delete-file':
      await confirmDeleteFile(projectId || '', targetId, targetName);
      break;
    case 'delete-directory':
      await confirmDeleteDirectory(projectId || '', targetId, targetName);
      break;
  }
}

async function promptCreateFile(projectId: string, targetId: string, targetName: string) {
  const isProject = contextMenu.targetType === 'project';
  const directoryPath = isProject ? undefined : targetId.replace('dir:', '');
  
  const alert = await alertController.create({
    header: 'New File',
    message: `Create a new markdown file${isProject ? ` in ${targetName}` : ` in ${targetName}`}`,
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
            await createFile(projectId, data.fileName.trim(), directoryPath);
          }
        },
      },
    ],
  });
  await alert.present();
}

async function createFile(projectId: string, fileName: string, directory?: string) {
  try {
    const file = await createEmptyMarkdownFile(projectId, fileName, directory);
    // Refresh the file tree for this project
    delete projectFileTrees.value[projectId];
    await loadProjectFiles(projectId);
    emit('file-created', projectId, file);
  } catch (error) {
    const alert = await alertController.create({
      header: 'Error',
      message: `Failed to create file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      buttons: ['OK'],
    });
    await alert.present();
  }
}

async function confirmDeleteProject(projectId: string, projectName: string) {
  const fileCount = projectFileCounts.value[projectId] || 0;
  
  const alert = await alertController.create({
    header: 'Delete Project',
    message: `Are you sure you want to delete "${projectName}"${fileCount > 0 ? ` and all ${fileCount} file(s)` : ''}? This action cannot be undone.`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Delete',
        role: 'destructive',
        handler: async () => {
          await performDeleteProject(projectId);
        },
      },
    ],
  });
  await alert.present();
}

async function performDeleteProject(projectId: string) {
  try {
    await deleteProject(projectId);
    // Remove from local state
    expandedProjects.value.delete(projectId);
    delete projectFileTrees.value[projectId];
    emit('delete-project', projectId);
  } catch (error) {
    const alert = await alertController.create({
      header: 'Error',
      message: `Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`,
      buttons: ['OK'],
    });
    await alert.present();
  }
}

async function confirmDeleteFile(projectId: string, fileId: string, fileName: string) {
  const alert = await alertController.create({
    header: 'Delete File',
    message: `Are you sure you want to delete "${fileName}"? This action cannot be undone.`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Delete',
        role: 'destructive',
        handler: async () => {
          await performDeleteFile(projectId, fileId);
        },
      },
    ],
  });
  await alert.present();
}

async function performDeleteFile(projectId: string, fileId: string) {
  try {
    await deleteFile(fileId);
    // Refresh the file tree for this project
    delete projectFileTrees.value[projectId];
    await loadProjectFiles(projectId);
  } catch (error) {
    const alert = await alertController.create({
      header: 'Error',
      message: `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      buttons: ['OK'],
    });
    await alert.present();
  }
}

async function confirmDeleteDirectory(projectId: string, directoryId: string, directoryName: string) {
  const directoryPath = directoryId.replace('dir:', '');
  const filesInDirectory = findFilesInDirectory(projectFileTrees.value[projectId]?.nodes || [], directoryPath);
  
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
          // Refresh the file tree for this project
          delete projectFileTrees.value[projectId];
          await loadProjectFiles(projectId);
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

function handleProjectDragOver(event: DragEvent, projectId: string) {
  dragOverProjectId.value = projectId;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function handleProjectDragLeave(projectId: string) {
  if (dragOverProjectId.value === projectId) {
    dragOverProjectId.value = null;
  }
}

async function handleProjectDrop(event: DragEvent, targetProjectId: string) {
  dragOverProjectId.value = null;
  
  if (!event.dataTransfer) return;
  
  const data = event.dataTransfer.getData('application/json');
  if (!data) return;
  
  try {
    const sourceNode = JSON.parse(data) as FileTreeNodeType;
    if (sourceNode.type !== 'file') return;
    
    // Find the source project
    const sourceProjectId = findProjectContainingFile(sourceNode.id);
    if (!sourceProjectId || sourceProjectId === targetProjectId) return;
    
    // Move to target project root
    await moveFile(sourceNode.id, targetProjectId, undefined);
    
    // Refresh both file trees
    delete projectFileTrees.value[sourceProjectId];
    delete projectFileTrees.value[targetProjectId];
    await loadProjectFiles(sourceProjectId);
    await loadProjectFiles(targetProjectId);
  } catch {
    // Invalid data or move failed, ignore
  }
  
  draggingNode.value = null;
}

async function handleNodeDrop(projectId: string, payload: DragDropEvent) {
  if (!payload.sourceNode || payload.sourceNode.type !== 'file') return;
  
  const targetDirectory = payload.targetNode.path;
  
  // Find the source project
  const sourceProjectId = findProjectContainingFile(payload.sourceNode.id);
  if (!sourceProjectId) return;
  
  try {
    await moveFile(payload.sourceNode.id, projectId, targetDirectory);
    
    // Refresh file trees
    delete projectFileTrees.value[sourceProjectId];
    if (sourceProjectId !== projectId) {
      delete projectFileTrees.value[projectId];
      await loadProjectFiles(projectId);
    }
    await loadProjectFiles(sourceProjectId);
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

function findProjectContainingFile(fileId: string): string | null {
  for (const [projectId, tree] of Object.entries(projectFileTrees.value)) {
    if (findFileInNodes(tree.nodes, fileId)) {
      return projectId;
    }
  }
  return null;
}

function findFileInNodes(nodes: FileTreeNodeType[], fileId: string): boolean {
  for (const node of nodes) {
    if (node.id === fileId) return true;
    if (node.children && findFileInNodes(node.children, fileId)) return true;
  }
  return false;
}

// ============================================
// Reveal File (expand parents + scroll into view)
// ============================================

/**
 * Reveals a file in the tree by expanding its project and parent directories,
 * then scrolling it into view.
 */
async function revealFile(projectId: string, fileId: string) {
  // Ensure project is expanded
  if (!expandedProjects.value.has(projectId)) {
    expandedProjects.value.add(projectId);
    expandedProjects.value = new Set(expandedProjects.value);
  }
  
  // Ensure file tree is loaded
  if (!projectFileTrees.value[projectId]) {
    await loadProjectFiles(projectId);
  }
  
  const tree = projectFileTrees.value[projectId];
  if (!tree) return;
  
  // Find the file and expand all parent directories
  const pathToFile = findPathToFile(tree.nodes, fileId);
  if (pathToFile.length > 0) {
    // Expand all parent directories
    let needsUpdate = false;
    for (const node of pathToFile) {
      if (node.type === 'directory' && !node.expanded) {
        node.expanded = true;
        needsUpdate = true;
      }
    }
    
    if (needsUpdate) {
      // Trigger reactivity update
      projectFileTrees.value = { ...projectFileTrees.value };
    }
  }
  
  // Scroll the file into view after DOM update
  await nextTick();
  scrollFileIntoView(fileId);
}

/**
 * Finds the path from root to the target file (including all parent directories).
 * Returns an array of nodes from root to the file (not including the file itself).
 */
function findPathToFile(nodes: FileTreeNodeType[], targetId: string, currentPath: FileTreeNodeType[] = []): FileTreeNodeType[] {
  for (const node of nodes) {
    if (node.id === targetId) {
      // Found the target, return the path to it
      return currentPath;
    }
    
    if (node.children && node.children.length > 0) {
      // Search in children, adding current node to the path
      const result = findPathToFile(node.children, targetId, [...currentPath, node]);
      if (result.length > 0) {
        return result;
      }
      // Also check if target is a direct child
      if (node.children.some(c => c.id === targetId)) {
        return [...currentPath, node];
      }
    }
  }
  return [];
}

/**
 * Scrolls the file element into view within the tree content area.
 */
function scrollFileIntoView(fileId: string) {
  const fileElement = document.querySelector(`[data-file-id="${fileId}"]`);
  if (fileElement) {
    fileElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Add a brief highlight animation
    fileElement.classList.add('reveal-highlight');
    setTimeout(() => {
      fileElement.classList.remove('reveal-highlight');
    }, 1500);
  }
}

// Expose refresh method (only refreshes file trees, projects come from parent)
async function refresh() {
  // Reload file trees for expanded projects
  for (const projectId of expandedProjects.value) {
    delete projectFileTrees.value[projectId];
    await loadProjectFiles(projectId);
  }
}

defineExpose({ refresh, revealFile });
</script>

<style scoped>
.projects-tree-sidebar {
  display: flex;
  flex-direction: column;
  width: 280px;
  min-width: 280px;
  max-width: 280px;
  height: 100%;
  background: var(--hn-bg-deep);
  border-right: 1px solid var(--hn-border-default);
  transition: all 0.2s ease;
  overflow: hidden;
}

.projects-tree-sidebar.collapsed {
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
  background: var(--hn-bg-surface);
  border-radius: 0 8px 8px 0;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid var(--hn-border-default);
  border-left: none;
  z-index: 10;
}

.collapsed-tab:hover {
  background: var(--hn-bg-elevated);
}

.collapsed-tab ion-icon {
  font-size: 16px;
  color: var(--hn-text-secondary);
}

.collapsed-tab:hover ion-icon {
  color: var(--hn-teal);
}

.collapsed-tab .tab-label {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--hn-text-secondary);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.collapsed-tab:hover .tab-label {
  color: var(--hn-text-primary);
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
  border-bottom: 1px solid var(--hn-border-default);
  background: var(--hn-bg-surface);
  min-height: 48px;
  box-sizing: border-box;
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
  color: var(--hn-teal);
  flex-shrink: 0;
}

.header-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--hn-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.project-count {
  font-size: 0.7rem;
  color: var(--hn-text-secondary);
  background: var(--hn-bg-elevated);
  padding: 2px 6px;
  border-radius: 10px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.add-btn,
.collapse-btn {
  --padding-start: 4px;
  --padding-end: 4px;
  --color: var(--hn-text-secondary);
  margin: 0;
  height: 28px;
  width: 28px;
}

.add-btn:hover,
.collapse-btn:hover {
  --color: var(--hn-text-primary);
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
  --color: var(--hn-text-secondary);
}

.tree-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  color: var(--hn-text-faint);
  text-align: center;
}

.tree-empty ion-icon {
  font-size: 32px;
  margin-bottom: 8px;
  opacity: 0.6;
}

.tree-empty p {
  margin: 0 0 12px;
  font-size: 0.85rem;
}

.tree-nodes {
  padding: 0 4px;
}

/* Project Node */
.project-node {
  margin-bottom: 2px;
}

.project-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.project-header:hover {
  background: var(--hn-bg-surface);
}

.project-header.selected {
  background: var(--hn-teal-muted);
}

.project-header.selected .project-name {
  color: var(--hn-teal);
}

.project-header.drag-over {
  background: var(--hn-teal-muted);
  outline: 2px dashed var(--hn-teal);
  outline-offset: -2px;
}

.expand-icon {
  font-size: 12px;
  color: var(--hn-text-faint);
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.project-header.expanded .expand-icon {
  transform: rotate(0deg);
}

.folder-icon {
  font-size: 16px;
  color: var(--hn-folder);
  flex-shrink: 0;
}

.project-name {
  flex: 1;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--hn-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-count {
  font-size: 0.7rem;
  color: var(--hn-text-secondary);
  background: var(--hn-bg-elevated);
  padding: 2px 6px;
  border-radius: 8px;
}

/* Project Files */
.project-files {
  padding-left: 12px;
  border-left: 1px solid var(--hn-border-subtle);
  margin-left: 20px;
}

.files-loading {
  display: flex;
  justify-content: center;
  padding: 12px;
}

.files-loading ion-spinner {
  --color: var(--hn-text-secondary);
  width: 16px;
  height: 16px;
}

.files-empty {
  padding: 8px 12px;
  font-size: 0.8rem;
  color: var(--hn-text-faint);
  font-style: italic;
}

/* Scrollbar styling */
.tree-content::-webkit-scrollbar {
  width: 6px;
}

.tree-content::-webkit-scrollbar-track {
  background: transparent;
}

.tree-content::-webkit-scrollbar-thumb {
  background: var(--hn-border-default);
  border-radius: 3px;
}

.tree-content::-webkit-scrollbar-thumb:hover {
  background: var(--hn-border-strong);
}

/* Reveal highlight animation */
:deep(.reveal-highlight) {
  animation: revealPulse 1.5s ease-out;
}

@keyframes revealPulse {
  0% {
    background: var(--hn-teal-muted);
    box-shadow: 0 0 0 2px var(--hn-teal);
  }
  100% {
    background: transparent;
    box-shadow: none;
  }
}
</style>

