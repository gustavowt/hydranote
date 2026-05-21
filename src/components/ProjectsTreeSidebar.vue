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

              <!-- File tree nodes (ghosts merged in for in-flight drops) -->
              <template v-else>
                <FileTreeNode
                  v-for="node in renderedNodesFor(project.id)"
                  :key="node.id"
                  :node="node"
                  :depth="1"
                  :selected-file-id="selectedFileId"
                  @select="(n) => handleFileSelect(project.id, n)"
                  @toggle="(n) => handleNodeToggle(project.id, n)"
                  @context-menu="(payload) => handleNodeContextMenu(project.id, payload)"
                  @drag-start="(node) => handleDragStart(project.id, node)"
                  @drop="(payload) => handleNodeDrop(project.id, payload)"
                  @os-files-drop="(payload) => handleOsFilesDrop(project.id, payload)"
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
import { getProjectFileTree, deleteProject, deleteFile, moveFile, createEmptyMarkdownFile, renameFile, renameDirectory, renameProject } from '@/services';
import {
  ingestExternalFiles,
  collectDroppedEntries,
  flatFilesToEntries,
  pendingDrops,
  type PendingDropEntry,
} from '@/services/fileIngestionService';
import FileTreeNode, { type OsFilesDropPayload } from './FileTreeNode.vue';
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
  (e: 'file-moved', sourceProjectId: string, targetProjectId: string, file: ProjectFile): void;
  (e: 'project-renamed', projectId: string, newName: string): void;
}>();

const isCollapsed = ref(false);
const expandedProjects = ref<Set<string>>(new Set());
const loadingFiles = ref<Set<string>>(new Set());
const projectFileTrees = ref<Record<string, ProjectFileTree>>({});
const draggingNode = ref<FileTreeNodeType | null>(null);
const draggingSourceProjectId = ref<string | null>(null);
const dragOverProjectId = ref<string | null>(null);

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

/**
 * Convert a pending drop entry into a tree node so it can be rendered as a
 * placeholder row alongside real files. The id is the transient drop id, so
 * the existing `FileTreeNode` lookup into `ingestionProgress` works without
 * any special-casing.
 */
function ghostToNode(entry: PendingDropEntry): FileTreeNodeType {
  return {
    id: entry.transientId,
    name: entry.fileName,
    path: entry.displayPath,
    type: 'file',
    fileType: entry.fileType,
  } as FileTreeNodeType;
}

/**
 * Recursively inject ghost nodes into the tree at the directory whose path
 * matches `targetDir`. Returns the original `nodes` reference when no
 * insertion happens, so downstream `key` reactivity stays stable.
 */
function injectGhostsAtDir(
  nodes: FileTreeNodeType[],
  ghostNodes: FileTreeNodeType[],
  targetDir: string,
): { nodes: FileTreeNodeType[]; inserted: boolean } {
  let inserted = false;
  const next = nodes.map((node) => {
    if (inserted) return node;
    if (node.type !== 'directory') return node;
    if (node.path === targetDir) {
      inserted = true;
      return {
        ...node,
        expanded: true,
        children: [...ghostNodes, ...(node.children ?? [])],
      } as FileTreeNodeType;
    }
    if (node.children && node.children.length > 0) {
      const recurse = injectGhostsAtDir(node.children, ghostNodes, targetDir);
      if (recurse.inserted) {
        inserted = true;
        return { ...node, children: recurse.nodes } as FileTreeNodeType;
      }
    }
    return node;
  });
  return { nodes: inserted ? next : nodes, inserted };
}

/**
 * Merge pending drop ghosts into the rendered tree for `projectId`. Ghosts
 * are grouped by their `targetDirectory` — those whose target directory
 * already exists in the tree nest inside it (and the directory is forced
 * `expanded` so the user can see them appear). Ghosts whose target either is
 * the project root or has no matching node yet (e.g. a freshly dropped
 * folder whose intermediate dirs `createFile` hasn't materialized) surface
 * at the project root so the user still sees activity.
 */
function renderedNodesFor(projectId: string): FileTreeNodeType[] {
  const realNodes = projectFileTrees.value[projectId]?.nodes ?? [];
  const ghosts = Array.from(pendingDrops.value.values()).filter(
    (g) => g.projectId === projectId,
  );
  if (ghosts.length === 0) return realNodes;

  const byDir = new Map<string | undefined, PendingDropEntry[]>();
  for (const ghost of ghosts) {
    const key = ghost.targetDirectory || undefined;
    if (!byDir.has(key)) byDir.set(key, []);
    byDir.get(key)!.push(ghost);
  }

  let current = realNodes;
  const rootGhostNodes: FileTreeNodeType[] = [];
  for (const [dir, group] of byDir.entries()) {
    const groupNodes = group.map(ghostToNode);
    if (!dir) {
      rootGhostNodes.push(...groupNodes);
      continue;
    }
    const result = injectGhostsAtDir(current, groupNodes, dir);
    if (result.inserted) {
      current = result.nodes;
    } else {
      // Target directory doesn't exist in the tree yet — fall back to root
      // so the activity is still visible.
      rootGhostNodes.push(...groupNodes);
    }
  }

  return rootGhostNodes.length > 0 ? [...rootGhostNodes, ...current] : current;
}

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
    case 'rename-project':
      await promptRenameProject(targetId, targetName);
      break;
    case 'rename-file':
      await promptRenameFile(projectId || '', targetId, targetName);
      break;
    case 'rename-directory':
      await promptRenameDirectory(projectId || '', targetId, targetName);
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

async function promptRenameProject(projectId: string, projectName: string) {
  const alert = await alertController.create({
    header: 'Rename Project',
    inputs: [
      {
        name: 'newName',
        type: 'text',
        value: projectName,
        placeholder: 'New project name',
      },
    ],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Rename',
        handler: async (data) => {
          if (data.newName?.trim() && data.newName.trim() !== projectName) {
            try {
              await renameProject(projectId, data.newName.trim());
              // Refresh the file tree for this project
              delete projectFileTrees.value[projectId];
              await loadProjectFiles(projectId);
              emit('project-renamed', projectId, data.newName.trim());
            } catch (error) {
              const errAlert = await alertController.create({
                header: 'Error',
                message: `Failed to rename project: ${error instanceof Error ? error.message : 'Unknown error'}`,
                buttons: ['OK'],
              });
              await errAlert.present();
            }
          }
        },
      },
    ],
  });
  await alert.present();
}

async function promptRenameFile(projectId: string, fileId: string, fileName: string) {
  // Extract just the file name without extension for the input default
  const lastDot = fileName.lastIndexOf('.');
  const nameWithoutExt = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
  const ext = lastDot > 0 ? fileName.substring(lastDot) : '';
  
  const alert = await alertController.create({
    header: 'Rename File',
    inputs: [
      {
        name: 'newName',
        type: 'text',
        value: nameWithoutExt,
        placeholder: 'New file name',
      },
    ],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Rename',
        handler: async (data) => {
          if (data.newName?.trim() && data.newName.trim() !== nameWithoutExt) {
            try {
              const newFullName = data.newName.trim() + ext;
              await renameFile(fileId, newFullName);
              // Refresh the file tree for this project
              delete projectFileTrees.value[projectId];
              await loadProjectFiles(projectId);
            } catch (error) {
              const errAlert = await alertController.create({
                header: 'Error',
                message: `Failed to rename file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                buttons: ['OK'],
              });
              await errAlert.present();
            }
          }
        },
      },
    ],
  });
  await alert.present();
}

async function promptRenameDirectory(projectId: string, directoryId: string, directoryName: string) {
  const alert = await alertController.create({
    header: 'Rename Directory',
    inputs: [
      {
        name: 'newName',
        type: 'text',
        value: directoryName,
        placeholder: 'New directory name',
      },
    ],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Rename',
        handler: async (data) => {
          if (data.newName?.trim() && data.newName.trim() !== directoryName) {
            try {
              const dirPath = directoryId.replace('dir:', '');
              await renameDirectory(projectId, dirPath, data.newName.trim());
              // Refresh the file tree for this project
              delete projectFileTrees.value[projectId];
              await loadProjectFiles(projectId);
            } catch (error) {
              const errAlert = await alertController.create({
                header: 'Error',
                message: `Failed to rename directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
                buttons: ['OK'],
              });
              await errAlert.present();
            }
          }
        },
      },
    ],
  });
  await alert.present();
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

function handleDragStart(projectId: string, node: FileTreeNodeType) {
  draggingNode.value = node;
  draggingSourceProjectId.value = projectId;
}

/**
 * Returns true when the drag carries OS files (external import) rather than
 * an in-app move payload.
 */
function dragCarriesOsFiles(event: DragEvent): boolean {
  const dt = event.dataTransfer;
  if (!dt) return false;
  if (dt.types && Array.from(dt.types).includes('Files')) return true;
  return (dt.files?.length ?? 0) > 0;
}

function handleProjectDragOver(event: DragEvent, projectId: string) {
  // External OS files: always highlight the project as a drop target.
  if (dragCarriesOsFiles(event)) {
    dragOverProjectId.value = projectId;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    return;
  }
  // In-app moves: only highlight when dragging across projects.
  if (draggingNode.value && draggingSourceProjectId.value !== projectId) {
    dragOverProjectId.value = projectId;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }
}

function handleProjectDragLeave(projectId: string) {
  if (dragOverProjectId.value === projectId) {
    dragOverProjectId.value = null;
  }
}

async function handleProjectDrop(event: DragEvent, targetProjectId: string) {
  dragOverProjectId.value = null;

  // OS file drop — route to the new external-ingestion path. Any in-app drag
  // state still hanging around is cleared too.
  if (dragCarriesOsFiles(event)) {
    draggingNode.value = null;
    draggingSourceProjectId.value = null;
    await handleOsFilesDrop(targetProjectId, { event, targetDirectory: undefined });
    return;
  }

  // Use stored dragging state (more reliable than dataTransfer)
  const sourceNode = draggingNode.value;
  const sourceProjectId = draggingSourceProjectId.value;

  // Clear dragging state
  draggingNode.value = null;
  draggingSourceProjectId.value = null;

  // Validate we have what we need
  if (!sourceNode || sourceNode.type !== 'file') {
    return;
  }

  if (!sourceProjectId || sourceProjectId === targetProjectId) {
    return;
  }
  
  try {
    // Move to target project root
    const movedFile = await moveFile(sourceNode.id, targetProjectId, undefined);
    
    // Refresh both file trees
    delete projectFileTrees.value[sourceProjectId];
    delete projectFileTrees.value[targetProjectId];
    await loadProjectFiles(sourceProjectId);
    
    // Ensure target project is expanded and loaded
    if (!expandedProjects.value.has(targetProjectId)) {
      expandedProjects.value.add(targetProjectId);
      expandedProjects.value = new Set(expandedProjects.value);
    }
    await loadProjectFiles(targetProjectId);
    
    // Notify parent about the move
    emit('file-moved', sourceProjectId, targetProjectId, movedFile);
  } catch (error) {
    const alert = await alertController.create({
      header: 'Error',
      message: `Failed to move file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      buttons: ['OK'],
    });
    await alert.present();
  }
}

async function handleNodeDrop(targetProjectId: string, payload: DragDropEvent) {
  if (!payload.sourceNode || payload.sourceNode.type !== 'file') return;
  
  const targetDirectory = payload.targetNode.path;
  
  // Use stored source project ID (more reliable) or fallback to lookup
  const sourceProjectId = draggingSourceProjectId.value || findProjectContainingFile(payload.sourceNode.id);
  
  // Clear dragging state
  draggingNode.value = null;
  draggingSourceProjectId.value = null;
  
  if (!sourceProjectId) {
    const alert = await alertController.create({
      header: 'Error',
      message: 'Could not determine source project for the file.',
      buttons: ['OK'],
    });
    await alert.present();
    return;
  }
  
  try {
    const movedFile = await moveFile(payload.sourceNode.id, targetProjectId, targetDirectory);
    
    // Refresh file trees
    delete projectFileTrees.value[sourceProjectId];
    if (sourceProjectId !== targetProjectId) {
      delete projectFileTrees.value[targetProjectId];
      await loadProjectFiles(targetProjectId);
    }
    await loadProjectFiles(sourceProjectId);
    
    // Notify parent about the move
    emit('file-moved', sourceProjectId, targetProjectId, movedFile);
  } catch (error) {
    const alert = await alertController.create({
      header: 'Error',
      message: `Failed to move file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      buttons: ['OK'],
    });
    await alert.present();
  }
}

/**
 * External OS file/folder drop. Resolves the dropped DataTransferItemList
 * (recurses into folders, preserving subdirectory structure under
 * `targetDirectory`), then runs ingestion sequentially via
 * `fileIngestionService`. Per-file progress is published to the reactive
 * `ingestionProgress` map and consumed by `FileTreeNode`.
 */
async function handleOsFilesDrop(targetProjectId: string, payload: OsFilesDropPayload) {
  const { event, targetDirectory } = payload;
  const dt = event.dataTransfer;
  if (!dt) return;

  // Prefer the items API (folder support); fall back to the flat files list.
  const entries = dt.items && dt.items.length > 0
    ? await collectDroppedEntries(dt.items)
    : flatFilesToEntries(dt.files ?? []);

  if (entries.length === 0) return;

  // Make sure the target project is expanded so the user sees rows light up.
  if (!expandedProjects.value.has(targetProjectId)) {
    expandedProjects.value.add(targetProjectId);
    expandedProjects.value = new Set(expandedProjects.value);
  }
  if (!projectFileTrees.value[targetProjectId]) {
    await loadProjectFiles(targetProjectId);
  }

  let result;
  try {
    result = await ingestExternalFiles(
      entries,
      targetProjectId,
      targetDirectory,
      // Per-file refresh: as soon as `createFile` lands a row in the DB, drop
      // the cached tree and reload it. The ghost row for this file disappears
      // automatically (cleared by the service before this callback fires) and
      // the real row takes its place, with the progress bar continuing via
      // the persisted `files.id` key in `ingestionProgress`.
      async () => {
        delete projectFileTrees.value[targetProjectId];
        await loadProjectFiles(targetProjectId);
      },
    );
  } catch (error) {
    const alert = await alertController.create({
      header: 'Import failed',
      message: error instanceof Error ? error.message : 'Failed to import files',
      buttons: ['OK'],
    });
    await alert.present();
    return;
  }

  // Final refresh as a safety net — covers files whose per-file refresh was
  // raced past by a later one. Cheap because `loadProjectFiles` is just a DB
  // query plus a tree build.
  delete projectFileTrees.value[targetProjectId];
  await loadProjectFiles(targetProjectId);

  for (const file of result.created) {
    emit('file-created', targetProjectId, file);
  }

  if (result.failed.length > 0) {
    const lines = result.failed.map((f) => `\u2022 ${f.name}: ${f.error}`).join('\n');
    const alert = await alertController.create({
      header: result.created.length > 0 ? 'Some files were skipped' : 'Import failed',
      message: lines,
      buttons: ['OK'],
    });
    await alert.present();
  }
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
  const expandedIds = Array.from(expandedProjects.value);
  for (const projectId of expandedIds) {
    delete projectFileTrees.value[projectId];
  }
  await Promise.all(expandedIds.map(projectId => loadProjectFiles(projectId)));
}

defineExpose({ refresh, revealFile });
</script>

<style scoped>
.projects-tree-sidebar {
  display: flex;
  flex-direction: column;
  flex: none;
  width: 280px;
  height: 100%;
  background: var(--hn-bg-deep);
  border-right: 1px solid var(--hn-border-default);
  transition: width 0.2s ease;
  overflow: hidden;
}

.projects-tree-sidebar.collapsed {
  width: 0 !important;
  min-width: 0 !important;
  max-width: 0 !important;
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

