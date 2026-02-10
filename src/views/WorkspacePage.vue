<template>
  <ion-page>
    <ion-header :translucent="true" class="workspace-header">
      <ion-toolbar>
        <div class="header-container">
          <!-- Left: Logo -->
          <div class="header-brand">
            <img src="/hydranote-logo.png" alt="HydraNote" class="logo" />
            <span>HydraNote</span>
          </div>
          
          <!-- Center: Search Bar -->
          <div class="header-search">
            <SearchAutocomplete 
              ref="searchAutocompleteRef"
              @select-file="handleSearchSelectFile" 
              @select-project="handleSearchSelectProject"
            />
            <span class="search-shortcut">
              <kbd>{{ isMac ? '⌘' : 'Ctrl' }}</kbd>
              <kbd>P</kbd>
            </span>
          </div>
          
          <!-- Right: Actions -->
          <div class="header-actions">
            <ion-button @click="handleNewNote" class="add-note-btn">
              <ion-icon slot="start" :icon="addOutline" />
              New Note
            </ion-button>
            <ion-button fill="clear" @click="router.push('/settings')">
              <ion-icon slot="icon-only" :icon="settingsOutline" />
            </ion-button>
          </div>
        </div>
      </ion-toolbar>
    </ion-header>

    <!-- Main Workspace Layout -->
    <div class="workspace-layout">
      <!-- Left Sidebar: Projects Tree -->
      <ProjectsTreeSidebar
        ref="projectsTreeRef"
        :style="leftSidebarStyle"
        :projects="projects"
        :selected-project-id="selectedProjectId"
        :selected-file-id="selectedFileId"
        @select-project="handleProjectSelect"
        @select-file="handleFileSelect"
        @create-project="showCreateProjectModal = true"
        @delete-project="handleDeleteProject"
        @project-renamed="handleProjectRenamed"
        @file-created="handleFileCreatedFromSidebar"
        @file-moved="handleFileMoved"
        @collapse-change="(v: boolean) => leftCollapsed = v"
      />

      <!-- Left Resizer -->
      <div
        v-show="!leftCollapsed"
        class="workspace-resizer"
        @mousedown="startLeftResize"
      ></div>

      <!-- Center: Editor (routes based on file type) -->
      <!-- PDF Viewer (readonly, loads from file system) -->
      <PDFViewer
        v-if="currentFile && currentFile.type === 'pdf'"
        ref="pdfViewerRef"
        :current-file="currentFile"
        :current-project="currentProject"
        :system-file-path="currentFile.systemFilePath"
        :pdf-data="pdfData"
      />
      <!-- Rich Text Editor (DOCX) -->
      <RichTextEditor
        v-else-if="currentFile && currentFile.type === 'docx'"
        ref="richTextEditorRef"
        :current-file="currentFile"
        :current-project="currentProject"
        :html-content="currentFile.htmlContent || ''"
        @save="handleSaveDocxFile"
        @content-change="handleContentChange"
      />
      <!-- Markdown Editor (default for md, txt, and new notes) -->
      <MarkdownEditor
        v-else
        ref="markdownEditorRef"
        :current-file="currentFile"
        :current-project="currentProject"
        :initial-content="editorInitialContent"
        @save="handleSaveExistingFile"
        @content-change="handleContentChange"
        @note-saved="handleNoteSaved"
        @rename="handleRename"
        @selection-to-chat="handleSelectionToChat"
      />

      <!-- Right Resizer -->
      <div
        v-show="!rightCollapsed"
        class="workspace-resizer"
        @mousedown="startRightResize"
      ></div>

      <!-- Right Sidebar: Chat -->
      <ChatSidebar
        ref="chatSidebarRef"
        :style="rightSidebarStyle"
        :projects="projects"
        :initial-project-id="selectedProjectId"
        :current-file="currentFile"
        @project-change="handleChatProjectChange"
        @file-updated="handleFileUpdated"
        @file-created="handleFileCreatedFromChat"
        @projects-changed="handleProjectsChanged"
        @collapse-change="(v: boolean) => rightCollapsed = v"
      />
    </div>

    <!-- Create Project Modal -->
    <ion-modal :is-open="showCreateProjectModal" @didDismiss="showCreateProjectModal = false">
      <ion-header>
        <ion-toolbar>
          <ion-buttons slot="start">
            <ion-button @click="showCreateProjectModal = false">Cancel</ion-button>
          </ion-buttons>
          <ion-title>New Project</ion-title>
          <ion-buttons slot="end">
            <ion-button :strong="true" @click="handleCreateProject" :disabled="!newProject.name.trim()">
              Create
            </ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <ion-list>
          <ion-item>
            <ion-input
              v-model="newProject.name"
              label="Project Name"
              label-placement="stacked"
              placeholder="Enter project name"
              :clear-input="true"
            />
          </ion-item>
          <ion-item>
            <ion-textarea
              v-model="newProject.description"
              label="Description"
              label-placement="stacked"
              placeholder="Optional description"
              :rows="3"
            />
          </ion-item>
        </ion-list>
      </ion-content>
    </ion-modal>

  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonModal,
  IonList,
  IonItem,
  IonInput,
  IonTextarea,
  toastController,
  onIonViewWillEnter,
} from '@ionic/vue';
import {
  addOutline,
  settingsOutline,
} from 'ionicons/icons';
import type { Project, ProjectFile, GlobalAddNoteResult } from '@/types';
import {
  initialize,
  getAllProjects,
  createProject,
  getProject,
  get_project_files,
  updateFile,
  renameFile,
  onSyncEvent,
  base64ToArrayBuffer,
} from '@/services';
import ProjectsTreeSidebar from '@/components/ProjectsTreeSidebar.vue';
import MarkdownEditor from '@/components/MarkdownEditor.vue';
import RichTextEditor from '@/components/RichTextEditor.vue';
import PDFViewer from '@/components/PDFViewer.vue';
import ChatSidebar from '@/components/ChatSidebar.vue';
import SearchAutocomplete from '@/components/SearchAutocomplete.vue';

const router = useRouter();

// Refs for child components
const projectsTreeRef = ref<InstanceType<typeof ProjectsTreeSidebar> | null>(null);
const markdownEditorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null);
const richTextEditorRef = ref<InstanceType<typeof RichTextEditor> | null>(null);
const pdfViewerRef = ref<InstanceType<typeof PDFViewer> | null>(null);
const chatSidebarRef = ref<InstanceType<typeof ChatSidebar> | null>(null);
const searchAutocompleteRef = ref<InstanceType<typeof SearchAutocomplete> | null>(null);

// Detect Mac for keyboard shortcut display
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

// State
const projects = ref<Project[]>([]);
const selectedProjectId = ref<string | undefined>(undefined);
const selectedFileId = ref<string | undefined>(undefined);
const currentProject = ref<Project | null>(null);
const currentFile = ref<ProjectFile | null>(null);
const editorInitialContent = ref('');
const pdfData = ref<ArrayBuffer | null>(null);

// Sidebar resizer state
const leftSidebarWidth = ref(280); // px
const rightSidebarWidth = ref(360); // px
const leftCollapsed = ref(false);
const rightCollapsed = ref(false);
let activeResizer: 'left' | 'right' | null = null;

const leftSidebarStyle = computed(() => {
  if (leftCollapsed.value) return {};
  return {
    width: leftSidebarWidth.value + 'px',
    minWidth: leftSidebarWidth.value + 'px',
    maxWidth: leftSidebarWidth.value + 'px',
    transition: activeResizer ? 'none' : undefined,
  };
});

const rightSidebarStyle = computed(() => {
  if (rightCollapsed.value) return {};
  return {
    width: rightSidebarWidth.value + 'px',
    minWidth: rightSidebarWidth.value + 'px',
    maxWidth: rightSidebarWidth.value + 'px',
    transition: activeResizer ? 'none' : undefined,
  };
});

function startLeftResize(e: MouseEvent) {
  e.preventDefault();
  activeResizer = 'left';
  document.addEventListener('mousemove', onWorkspaceResize);
  document.addEventListener('mouseup', stopWorkspaceResize);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function startRightResize(e: MouseEvent) {
  e.preventDefault();
  activeResizer = 'right';
  document.addEventListener('mousemove', onWorkspaceResize);
  document.addEventListener('mouseup', stopWorkspaceResize);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function onWorkspaceResize(e: MouseEvent) {
  if (!activeResizer) return;
  const layout = document.querySelector('.workspace-layout') as HTMLElement;
  if (!layout) return;
  const rect = layout.getBoundingClientRect();

  if (activeResizer === 'left') {
    let w = e.clientX - rect.left;
    w = Math.max(180, Math.min(500, w));
    leftSidebarWidth.value = w;
  } else {
    let w = rect.right - e.clientX;
    w = Math.max(280, Math.min(600, w));
    rightSidebarWidth.value = w;
  }
}

function stopWorkspaceResize() {
  activeResizer = null;
  document.removeEventListener('mousemove', onWorkspaceResize);
  document.removeEventListener('mouseup', stopWorkspaceResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

// Modal state
const showCreateProjectModal = ref(false);

const newProject = ref({
  name: '',
  description: '',
});

// Sync event listener cleanup function
let unsubscribeSyncEvent: (() => void) | null = null;

// Keyboard shortcut handler for Cmd/Ctrl + P
function handleGlobalKeydown(event: KeyboardEvent) {
  // Check for Cmd+P (Mac) or Ctrl+P (Windows/Linux)
  if ((event.metaKey || event.ctrlKey) && event.key === 'p') {
    event.preventDefault();
    searchAutocompleteRef.value?.focus();
  }
}

onMounted(async () => {
  await initialize();
  await loadProjects();
  
  // Listen for sync events to refresh file tree when sync completes
  unsubscribeSyncEvent = onSyncEvent(async (event) => {
    if (event === 'complete') {
      // Refresh projects and file trees after sync
      await handleProjectsChanged();
    }
  });
  
  // Add global keyboard shortcut listener
  document.addEventListener('keydown', handleGlobalKeydown);
});

// Refresh projects and file trees when navigating back to this page
onIonViewWillEnter(async () => {
  await loadProjects();
  await projectsTreeRef.value?.refresh();
});

onUnmounted(() => {
  // Clean up sync event listener
  if (unsubscribeSyncEvent) {
    unsubscribeSyncEvent();
    unsubscribeSyncEvent = null;
  }
  
  // Remove global keyboard shortcut listener
  document.removeEventListener('keydown', handleGlobalKeydown);

  // Clean up workspace resizer listeners
  stopWorkspaceResize();
});

async function loadProjects() {
  projects.value = await getAllProjects();
}

// Project selection handlers
async function handleProjectSelect(projectId: string) {
  selectedProjectId.value = projectId;
  currentProject.value = await getProject(projectId) || null;
  
  // Also update chat sidebar
  chatSidebarRef.value?.selectProject(projectId);
}

async function handleFileSelect(projectId: string, file: { id: string; path: string; type: string }) {
  selectedProjectId.value = projectId;
  selectedFileId.value = file.id;
  currentProject.value = await getProject(projectId) || null;
  
  // Load file content
  const files = await get_project_files(projectId);
  const projectFile = files.find(f => f.id === file.id);
  
  if (projectFile) {
    currentFile.value = projectFile;
    editorInitialContent.value = projectFile.content || '';
    
    // For PDF files: prefer systemFilePath, fallback to binaryData for legacy files
    if (projectFile.type === 'pdf') {
      if (projectFile.systemFilePath) {
        // New approach: load from file system (handled by PDFViewer)
        pdfData.value = null;
      } else if (projectFile.binaryData) {
        // Legacy: load from stored binary data
        pdfData.value = base64ToArrayBuffer(projectFile.binaryData);
      } else {
        pdfData.value = null;
      }
    } else {
      pdfData.value = null;
    }
  }
  
  // Update chat sidebar project
  chatSidebarRef.value?.selectProject(projectId);
}

function handleChatProjectChange(projectId: string) {
  selectedProjectId.value = projectId;
}

// Handle project list changes from chat (create, delete, move operations)
async function handleProjectsChanged() {
  await loadProjects();
  await projectsTreeRef.value?.refresh();
}

// Handle file updated from chat (updateFile tool)
async function handleFileUpdated(fileId: string, _fileName: string) {
  // If the updated file is currently open in the editor, refresh it
  if (currentFile.value && currentFile.value.id === fileId && selectedProjectId.value) {
    const files = await get_project_files(selectedProjectId.value);
    const updatedFile = files.find(f => f.id === fileId);
    
    if (updatedFile) {
      currentFile.value = updatedFile;
      editorInitialContent.value = updatedFile.content || '';
      markdownEditorRef.value?.setContent(updatedFile.content || '');
      
      const toast = await toastController.create({
        message: 'File refreshed with latest changes',
        duration: 2000,
        color: 'success',
        position: 'top',
      });
      await toast.present();
    }
  }
  
  // Also refresh the file tree to update any metadata
  await projectsTreeRef.value?.refresh();
}

// Handle file created from chat (write/addNote tools)
async function handleFileCreatedFromChat(projectId: string, fileId: string, _fileName: string) {
  // Refresh projects and file trees first
  await loadProjects();
  await projectsTreeRef.value?.refresh();
  
  // Select the project and file
  selectedProjectId.value = projectId;
  selectedFileId.value = fileId;
  currentProject.value = await getProject(projectId) || null;
  
  // Load the file content
  const files = await get_project_files(projectId);
  const file = files.find(f => f.id === fileId);
  
  if (file) {
    currentFile.value = file;
    editorInitialContent.value = file.content || '';
    markdownEditorRef.value?.setContent(file.content || '');
  }
  
  // Reveal the file in the sidebar (expand parents + scroll into view)
  await projectsTreeRef.value?.revealFile(projectId, fileId);
}

// New Note handler
function handleNewNote() {
  // Clear current file and reset editor for a new note
  currentFile.value = null;
  currentProject.value = null;
  selectedFileId.value = undefined;
  editorInitialContent.value = '';
  markdownEditorRef.value?.clearContent();
  markdownEditorRef.value?.focusEditor();
}

// Save handlers
async function handleSaveExistingFile(content: string, file?: ProjectFile) {
  if (!file) return;
  
  try {
    // Save to database and sync to file system
    const updatedFile = await updateFile(file.id, content);
    
    if (updatedFile) {
      // Update local state
      currentFile.value = updatedFile;
      
      // Reveal the file in the sidebar (ensures visibility after save)
      if (selectedProjectId.value) {
        await projectsTreeRef.value?.revealFile(selectedProjectId.value, file.id);
      }
      
      const toast = await toastController.create({
        message: 'Note saved!',
        duration: 1500,
        color: 'success',
        position: 'top',
      });
      await toast.present();
    }
  } catch (error) {
    const toast = await toastController.create({
      message: 'Failed to save note',
      duration: 2000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}

// Save handler for DOCX files (from RichTextEditor)
async function handleSaveDocxFile(_text: string, html: string, file?: ProjectFile) {
  if (!file) return;
  
  try {
    // For DOCX files, we save the HTML content
    // The text content is extracted from the editor for indexing
    const updatedFile = await updateFile(file.id, html);
    
    if (updatedFile) {
      currentFile.value = updatedFile;
      
      if (selectedProjectId.value) {
        await projectsTreeRef.value?.revealFile(selectedProjectId.value, file.id);
      }
      
      const toast = await toastController.create({
        message: 'Document saved!',
        duration: 1500,
        color: 'success',
        position: 'top',
      });
      await toast.present();
    }
  } catch (error) {
    const toast = await toastController.create({
      message: 'Failed to save document',
      duration: 2000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}

async function handleNoteSaved(result: GlobalAddNoteResult) {
  // Refresh projects list (sidebars react via props)
  await loadProjects();
  // Refresh file trees in projects sidebar
  await projectsTreeRef.value?.refresh();
  
  // Select the new project/file and reveal it in the sidebar
  if (result.projectId && result.fileId) {
    selectedProjectId.value = result.projectId;
    selectedFileId.value = result.fileId;
    
    // Reveal the file in the sidebar (expand parents + scroll into view)
    await projectsTreeRef.value?.revealFile(result.projectId, result.fileId);
  }
}

function handleContentChange(_content: string) {
  // Could be used for auto-save or draft saving
}

// Handle selection to chat from editor
interface SelectionContext {
  text: string;
  filePath: string | null;
  fileId: string | null;
  startLine: number;
  endLine: number;
}

function handleSelectionToChat(selection: SelectionContext) {
  chatSidebarRef.value?.insertSelection(selection);
}

// Delete project handler
function handleDeleteProject(projectId: string) {
  // Remove from local projects list
  projects.value = projects.value.filter(p => p.id !== projectId);
  
  // Clear selection if deleted project was selected
  if (selectedProjectId.value === projectId) {
    selectedProjectId.value = undefined;
    currentProject.value = null;
    currentFile.value = null;
    selectedFileId.value = undefined;
    editorInitialContent.value = '';
    markdownEditorRef.value?.clearContent();
  }
}

// Project rename handler
async function handleProjectRenamed(_projectId: string, _newName: string) {
  // Refresh the projects list to reflect the new name
  await loadProjects();
}

// Search result selection handlers
async function handleSearchSelectFile(file: { id: string; projectId: string; name: string; path: string; type: string; projectName: string }) {
  // Select the project and file
  selectedProjectId.value = file.projectId;
  selectedFileId.value = file.id;
  currentProject.value = await getProject(file.projectId) || null;
  
  // Load file content
  const files = await get_project_files(file.projectId);
  const projectFile = files.find(f => f.id === file.id);
  
  if (projectFile) {
    currentFile.value = projectFile;
    editorInitialContent.value = projectFile.content || '';
    markdownEditorRef.value?.setContent(projectFile.content || '');
  }
  
  // Update chat sidebar project
  chatSidebarRef.value?.selectProject(file.projectId);
  
  // Reveal the file in the sidebar (expand parents + scroll into view)
  await projectsTreeRef.value?.revealFile(file.projectId, file.id);
}

async function handleSearchSelectProject(project: Project) {
  // Select the project
  selectedProjectId.value = project.id;
  currentProject.value = project;
  
  // Clear current file selection
  selectedFileId.value = undefined;
  currentFile.value = null;
  editorInitialContent.value = '';
  markdownEditorRef.value?.clearContent();
  
  // Update chat sidebar project
  chatSidebarRef.value?.selectProject(project.id);
}

// Handle file created from sidebar
async function handleFileCreatedFromSidebar(projectId: string, file: ProjectFile) {
  // Select the project and file
  selectedProjectId.value = projectId;
  selectedFileId.value = file.id;
  currentProject.value = await getProject(projectId) || null;
  currentFile.value = file;
  editorInitialContent.value = file.content || '';

  // Reveal the file in the sidebar (expand parents + scroll into view)
  await projectsTreeRef.value?.revealFile(projectId, file.id);
}

// Handle file moved between projects
async function handleFileMoved(_sourceProjectId: string, targetProjectId: string, file: ProjectFile) {
  // If the moved file was currently selected, update the selection to the new location
  if (selectedFileId.value === file.id) {
    selectedProjectId.value = targetProjectId;
    currentProject.value = await getProject(targetProjectId) || null;
    currentFile.value = file;
    
    // Update chat sidebar to the new project
    chatSidebarRef.value?.selectProject(targetProjectId);
  }
  
  // Reveal the file in its new location
  await projectsTreeRef.value?.revealFile(targetProjectId, file.id);
}

// Handle file rename from editor
async function handleRename(fileId: string, newName: string) {
  try {
    const renamedFile = await renameFile(fileId, newName);
    
    if (renamedFile) {
      // Update local state if this is the currently selected file
      if (currentFile.value && currentFile.value.id === fileId) {
        currentFile.value = renamedFile;
      }
      
      // Refresh the sidebar to show the new name
      await projectsTreeRef.value?.refresh();
      
      // Reveal the file in its new location (path may have changed)
      if (selectedProjectId.value) {
        await projectsTreeRef.value?.revealFile(selectedProjectId.value, fileId);
      }
      
      const toast = await toastController.create({
        message: 'File renamed successfully',
        duration: 2000,
        color: 'success',
        position: 'top',
      });
      await toast.present();
    }
  } catch (error) {
    const toast = await toastController.create({
      message: 'Failed to rename file',
      duration: 3000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}

// Create project handler
async function handleCreateProject() {
  if (!newProject.value.name.trim()) return;

  try {
    const project = await createProject(
      newProject.value.name.trim(),
      newProject.value.description.trim() || undefined
    );
    
    projects.value.unshift(project);
    showCreateProjectModal.value = false;
    newProject.value = { name: '', description: '' };
    
    // Check if there was a sync error
    if ('syncError' in project && project.syncError) {
      const toast = await toastController.create({
        message: `Project created but folder sync failed: ${project.syncError}`,
        duration: 5000,
        color: 'warning',
        position: 'top',
      });
      await toast.present();
    }
    
    // Select the new project
    handleProjectSelect(project.id);
  } catch (error) {
    const toast = await toastController.create({
      message: 'Failed to create project',
      duration: 3000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}
</script>

<style scoped>
.workspace-header ion-toolbar {
  --background: var(--hn-bg-deep);
  --color: var(--hn-text-primary);
  --border-color: var(--hn-border-default);
  --padding-start: 12px;
  --padding-end: 12px;
}

/* Custom header container for proper centering */
.header-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 16px;
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.header-brand .logo {
  height: 28px;
  width: auto;
}

.header-brand span {
  font-weight: 600;
  font-size: 1.1rem;
}

/* Header Search - Centered */
.header-search {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  max-width: 500px;
  margin: 0 auto;
}

.search-shortcut {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.search-shortcut kbd {
  display: inline-block;
  padding: 2px 6px;
  font-size: 11px;
  font-family: inherit;
  color: var(--hn-text-muted);
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  border-radius: 4px;
  line-height: 1.2;
}

/* Header Actions */
.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.add-note-btn {
  --background: linear-gradient(135deg, var(--hn-green) 0%, var(--hn-teal) 100%);
  --background-hover: linear-gradient(135deg, var(--hn-green-light) 0%, var(--hn-teal-light) 100%);
  --background-activated: linear-gradient(135deg, var(--hn-green-dark) 0%, var(--hn-teal-dark) 100%);
  --color: #ffffff;
  --border-radius: 8px;
  --padding-start: 14px;
  --padding-end: 16px;
  --box-shadow: 0 2px 8px rgba(63, 185, 80, 0.25);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.2px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.add-note-btn::part(native) {
  background: linear-gradient(135deg, var(--hn-green) 0%, var(--hn-teal) 100%);
  box-shadow: 0 2px 8px rgba(63, 185, 80, 0.3);
}

.add-note-btn:hover::part(native) {
  background: linear-gradient(135deg, var(--hn-green-light) 0%, var(--hn-teal-light) 100%);
  box-shadow: 0 4px 12px rgba(63, 185, 80, 0.4);
}

.add-note-btn:hover {
  transform: translateY(-1px);
}

.add-note-btn:active::part(native) {
  background: linear-gradient(135deg, var(--hn-green-dark) 0%, var(--hn-teal-dark) 100%);
  box-shadow: 0 1px 4px rgba(63, 185, 80, 0.2);
}

.add-note-btn:active {
  transform: translateY(0);
}

/* Workspace Layout */
.workspace-layout {
  display: flex;
  flex: 1;
  height: calc(100vh - 56px);
  overflow: hidden;
  background: var(--hn-bg-deepest);
}

.workspace-resizer {
  flex: none;
  width: 4px;
  cursor: col-resize;
  background: var(--hn-border-default);
  transition: background 0.15s ease;
  z-index: 2;
}

.workspace-resizer:hover,
.workspace-resizer:active {
  background: var(--hn-accent-primary, #58a6ff);
}

/* Modal Styling */
ion-modal ion-toolbar {
  --background: var(--hn-bg-surface);
  --color: var(--hn-text-primary);
  --border-color: var(--hn-border-default);
}

ion-modal ion-content {
  --background: var(--hn-bg-deep);
}

ion-modal ion-list {
  background: transparent;
}

ion-modal ion-item {
  --background: var(--hn-bg-surface);
  --color: var(--hn-text-primary);
  --border-color: var(--hn-border-subtle);
}

ion-modal ion-input,
ion-modal ion-textarea {
  --color: var(--hn-text-primary);
  --placeholder-color: var(--hn-text-muted);
}

ion-modal ion-button {
  --color: var(--hn-purple);
}

ion-modal ion-button[strong] {
  --color: var(--hn-green);
}
</style>

