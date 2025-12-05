<template>
  <ion-page>
    <ion-header :translucent="true" class="workspace-header">
      <ion-toolbar>
        <ion-title>
          <div class="header-brand">
            <img src="/hydranote-logo.png" alt="HydraNote" class="logo" />
            <span>HydraNote</span>
          </div>
        </ion-title>
        <ion-buttons slot="end">
          <ion-button @click="handleNewNote" class="add-note-btn">
            <ion-icon slot="start" :icon="addOutline" />
            New Note
          </ion-button>
          <ion-button @click="router.push('/settings')">
            <ion-icon slot="icon-only" :icon="settingsOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <!-- Main Workspace Layout -->
    <div class="workspace-layout">
      <!-- Left Sidebar: Projects Tree -->
      <ProjectsTreeSidebar
        ref="projectsTreeRef"
        :projects="projects"
        :selected-project-id="selectedProjectId"
        :selected-file-id="selectedFileId"
        @select-project="handleProjectSelect"
        @select-file="handleFileSelect"
        @create-project="showCreateProjectModal = true"
        @delete-project="handleDeleteProject"
        @file-created="handleFileCreatedFromSidebar"
      />

      <!-- Center: Markdown Editor -->
      <MarkdownEditor
        ref="markdownEditorRef"
        :current-file="currentFile"
        :current-project="currentProject"
        :initial-content="editorInitialContent"
        @save="handleSaveExistingFile"
        @content-change="handleContentChange"
        @note-saved="handleNoteSaved"
      />

      <!-- Right Sidebar: Chat -->
      <ChatSidebar
        ref="chatSidebarRef"
        :projects="projects"
        :initial-project-id="selectedProjectId"
        @project-change="handleChatProjectChange"
        @file-updated="handleFileUpdated"
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
import { ref, onMounted } from 'vue';
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
} from '@/services';
import ProjectsTreeSidebar from '@/components/ProjectsTreeSidebar.vue';
import MarkdownEditor from '@/components/MarkdownEditor.vue';
import ChatSidebar from '@/components/ChatSidebar.vue';

const router = useRouter();

// Refs for child components
const projectsTreeRef = ref<InstanceType<typeof ProjectsTreeSidebar> | null>(null);
const markdownEditorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null);
const chatSidebarRef = ref<InstanceType<typeof ChatSidebar> | null>(null);

// State
const projects = ref<Project[]>([]);
const selectedProjectId = ref<string | undefined>(undefined);
const selectedFileId = ref<string | undefined>(undefined);
const currentProject = ref<Project | null>(null);
const currentFile = ref<ProjectFile | null>(null);
const editorInitialContent = ref('');

// Modal state
const showCreateProjectModal = ref(false);

const newProject = ref({
  name: '',
  description: '',
});

onMounted(async () => {
  await initialize();
  await loadProjects();
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
  }
  
  // Update chat sidebar project
  chatSidebarRef.value?.selectProject(projectId);
}

function handleChatProjectChange(projectId: string) {
  selectedProjectId.value = projectId;
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
  if (file) {
    // Save existing file
    // TODO: Implement file update service
    const toast = await toastController.create({
      message: 'Note saved!',
      duration: 2000,
      color: 'success',
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
  
  // Optionally select the new project/file
  if (result.projectId) {
    selectedProjectId.value = result.projectId;
    selectedFileId.value = result.fileId;
  }
}

function handleContentChange(_content: string) {
  // Could be used for auto-save or draft saving
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

// Handle file created from sidebar
async function handleFileCreatedFromSidebar(projectId: string, file: ProjectFile) {
  // Select the project and file
  selectedProjectId.value = projectId;
  selectedFileId.value = file.id;
  currentProject.value = await getProject(projectId) || null;
  currentFile.value = file;
  editorInitialContent.value = file.content || '';
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
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-brand .logo {
  height: 28px;
  width: auto;
}

.header-brand span {
  font-weight: 600;
  font-size: 1.1rem;
}

.add-note-btn {
  --background: var(--hn-green);
  --color: #ffffff;
  --border-radius: 6px;
  margin-right: 8px;
  font-weight: 500;
}

.add-note-btn:hover {
  --background: var(--hn-green-light);
}

/* Workspace Layout */
.workspace-layout {
  display: flex;
  flex: 1;
  height: calc(100vh - 56px);
  overflow: hidden;
  background: var(--hn-bg-deepest);
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

