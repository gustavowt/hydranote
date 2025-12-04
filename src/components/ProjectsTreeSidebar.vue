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
          >
            <!-- Project Header -->
            <div 
              class="project-header"
              :class="{ 
                selected: selectedProjectId === project.id,
                expanded: expandedProjects.has(project.id)
              }"
              @click="toggleProject(project)"
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
                />
              </template>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { IonIcon, IonButton, IonSpinner } from '@ionic/vue';
import {
  layersOutline,
  folderOutline,
  folderOpenOutline,
  chevronForwardOutline,
  chevronBackOutline,
  chevronDownOutline,
  addOutline,
} from 'ionicons/icons';
import type { Project, ProjectFileTree, FileTreeNode as FileTreeNodeType } from '@/types';
import { getProjectFileTree } from '@/services';
import FileTreeNode from './FileTreeNode.vue';

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
}>();

const isCollapsed = ref(false);
const expandedProjects = ref<Set<string>>(new Set());
const loadingFiles = ref<Set<string>>(new Set());
const projectFileTrees = ref<Record<string, ProjectFileTree>>({});

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

// Expose refresh method (only refreshes file trees, projects come from parent)
async function refresh() {
  // Reload file trees for expanded projects
  for (const projectId of expandedProjects.value) {
    delete projectFileTrees.value[projectId];
    await loadProjectFiles(projectId);
  }
}

defineExpose({ refresh });
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
</style>

