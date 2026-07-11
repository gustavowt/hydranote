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
            <ion-button fill="clear" @click="toggleTimeline" :class="{ 'timeline-active': showTimeline }" aria-label="Open timeline" title="Timeline">
              <ion-icon slot="start" :icon="timeOutline" />
              Timeline
            </ion-button>
            <ion-button fill="clear" @click="toggleFileMap" :class="{ 'file-map-active': showFileMap }" aria-label="Open file map" title="File Map">
              <ion-icon slot="start" :icon="gitNetworkOutline" />
              Map
            </ion-button>
            <ion-button @click="handleNewNote" class="add-note-btn">
              <ion-icon slot="start" :icon="addOutline" />
              New Note
            </ion-button>
            <ion-button fill="clear" @click="router.push('/settings')" aria-label="Open settings">
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

      <!-- Center: File Map, Timeline, or Editor -->
      <FileMapView
        v-if="showFileMap"
        :project-id="selectedProjectId"
        @close="showFileMap = false"
        @open-file="handleFileMapOpenFile"
      />
      <!-- Timeline View -->
      <TimelineView
        v-else-if="showTimeline"
        :project-id="selectedProjectId"
        @close="showTimeline = false"
        @open-file="handleTimelineOpenFile"
      />
      <!-- PDF Viewer (readonly, loads from file system) -->
      <PDFViewer
        v-else-if="currentFile && currentFile.type === 'pdf'"
        ref="pdfViewerRef"
        :current-file="currentFile"
        :current-project="currentProject"
        :system-file-path="currentFile.systemFilePath"
        :pdf-data="pdfData"
      />
      <!-- Image Viewer -->
      <ImageViewer
        v-else-if="isImageFile(currentFile)"
        :current-file="currentFile"
        :current-project="currentProject"
      />
      <!-- Rich Text Editor (DOCX) -->
      <RichTextEditor
        v-else-if="currentFile && currentFile.type === 'docx'"
        ref="richTextEditorRef"
        :current-file="currentFile"
        :current-project="currentProject"
        :html-content="currentFile.htmlContent || ''"
        :on-autosave="handleAutosaveDocxFile"
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
        :default-project-id="selectedProjectId"
        :on-autosave="handleAutosaveExistingFile"
        @save="handleSaveExistingFile"
        @content-change="handleContentChange"
        @note-saved="handleNoteSaved"
        @rename="handleRename"
        @selection-to-chat="handleSelectionToChat"
        @open-file="handleWikilinkOpenFile"
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
        @insert-image="handleInsertImage"
      />
    </div>

    <!-- Create Project Modal -->
    <ion-modal :is-open="showCreateProjectModal" @didDismiss="showCreateProjectModal = false">
      <ion-header>
        <ion-toolbar>
          <ion-title>New Project</ion-title>
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
      <ion-footer class="modal-footer">
        <ion-toolbar>
          <ion-buttons slot="start">
            <ion-button fill="clear" @click="showCreateProjectModal = false">Cancel</ion-button>
          </ion-buttons>
          <ion-buttons slot="end">
            <ion-button
              fill="solid"
              :strong="true"
              @click="handleCreateProject"
              :disabled="!newProject.name.trim()"
              class="modal-confirm-btn"
            >
              Create
            </ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-footer>
    </ion-modal>

  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonFooter,
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
  alertController,
  onIonViewWillEnter,
} from '@ionic/vue';
import {
  addOutline,
  settingsOutline,
  timeOutline,
  gitNetworkOutline,
} from 'ionicons/icons';
import type { Project, ProjectFile, GlobalAddNoteResult } from '@/types';
import {
  initialize,
  getAllProjects,
  createProject,
  getProject,
  getFile,
  get_project_files,
  updateFile,
  renameFile,
  onSyncEvent,
  base64ToArrayBuffer,
  ELECTRON_TRAY_WORKSPACE_EVENT,
  onPipelineAction,
  offPipelineAction,
} from '@/services';
import ProjectsTreeSidebar from '@/components/ProjectsTreeSidebar.vue';
import MarkdownEditor from '@/components/MarkdownEditor.vue';
import RichTextEditor from '@/components/RichTextEditor.vue';
import PDFViewer from '@/components/PDFViewer.vue';
import ImageViewer from '@/components/ImageViewer.vue';
import ChatSidebar from '@/components/ChatSidebar.vue';
import SearchAutocomplete from '@/components/SearchAutocomplete.vue';
import TimelineView from '@/components/TimelineView.vue';
import FileMapView from '@/components/FileMapView.vue';
import { savePastedImage } from '@/services/editorImagePaste';

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

// Timeline / File Map view state
const showTimeline = ref(false);
const showFileMap = ref(false);

function toggleTimeline() {
  showTimeline.value = !showTimeline.value;
  if (showTimeline.value) showFileMap.value = false;
}

function toggleFileMap() {
  showFileMap.value = !showFileMap.value;
  if (showFileMap.value) showTimeline.value = false;
}

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

function onElectronTrayWorkspaceAction(ev: Event) {
  const ce = ev as CustomEvent<{ action: string }>;
  const action = ce.detail?.action;
  if (action === 'new-note') {
    void handleNewNote();
  } else if (action === 'focus-chat') {
    chatSidebarRef.value?.focusChatInput?.();
  }
}

function handleDictationInsertAtCursor(text: string) {
  markdownEditorRef.value?.insertAtCursor(text);
}

function handleDictationSendToChat(text: string) {
  chatSidebarRef.value?.sendMessage(text);
}

onMounted(async () => {
  await initialize();

  // Auto-collapse sidebars on mobile
  const mobileQuery = window.matchMedia('(max-width: 767px)');
  const applyMobileLayout = (matches: boolean) => {
    if (matches) {
      leftCollapsed.value = true;
      rightCollapsed.value = true;
    }
  };
  applyMobileLayout(mobileQuery.matches);
  mobileQuery.addEventListener('change', (e) => applyMobileLayout(e.matches));

  // Listen for sync events to refresh file tree when sync completes
  unsubscribeSyncEvent = onSyncEvent(async (event) => {
    if (event === 'complete') {
      // Refresh projects and file trees after sync
      await handleProjectsChanged();
    }
  });

  // Add global keyboard shortcut listener
  document.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener(ELECTRON_TRAY_WORKSPACE_EVENT, onElectronTrayWorkspaceAction);

  // Dictation pipeline action listeners
  onPipelineAction('insert_at_cursor', handleDictationInsertAtCursor);
  onPipelineAction('send_to_chat', handleDictationSendToChat);
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
  window.removeEventListener(ELECTRON_TRAY_WORKSPACE_EVENT, onElectronTrayWorkspaceAction);

  // Clean up dictation pipeline listeners
  offPipelineAction('insert_at_cursor', handleDictationInsertAtCursor);
  offPipelineAction('send_to_chat', handleDictationSendToChat);

  // Clean up workspace resizer listeners
  stopWorkspaceResize();
});

async function loadProjects() {
  projects.value = await getAllProjects();
}

const IMAGE_FILE_TYPES = new Set(['png', 'jpg', 'jpeg', 'webp']);

function isImageFile(file: ProjectFile | null | undefined): boolean {
  return !!file && IMAGE_FILE_TYPES.has(file.type);
}

function editorHasUnsavedChanges(): boolean {
  if (currentFile.value?.type === 'docx') {
    return richTextEditorRef.value?.hasChanges ?? false;
  }
  return markdownEditorRef.value?.hasChanges ?? false;
}

async function confirmLeaveEditor(): Promise<boolean> {
  if (!editorHasUnsavedChanges()) return true;

  return new Promise((resolve) => {
    void alertController
      .create({
        header: 'Unsaved changes',
        message: 'You have unsaved changes. What would you like to do?',
        buttons: [
          { text: 'Cancel', role: 'cancel', handler: () => resolve(false) },
          {
            text: 'Discard',
            role: 'destructive',
            handler: () => {
              if (currentFile.value?.type === 'docx') {
                richTextEditorRef.value?.discardChanges?.();
              } else {
                markdownEditorRef.value?.discardChanges();
              }
              resolve(true);
            },
          },
          {
            text: 'Save',
            handler: () => {
              void (async () => {
                if (currentFile.value?.type === 'docx') {
                  await richTextEditorRef.value?.saveCurrent?.();
                } else {
                  await markdownEditorRef.value?.saveCurrent();
                }
                resolve(!editorHasUnsavedChanges());
              })();
            },
          },
        ],
      })
      .then((alert) => alert.present());
  });
}

// Project selection handlers
async function handleProjectSelect(projectId: string) {
  selectedProjectId.value = projectId;
  currentProject.value = await getProject(projectId) || null;
  
  // Also update chat sidebar
  chatSidebarRef.value?.selectProject(projectId);
}

async function handleFileSelect(projectId: string, file: { id: string; path: string; type: string }) {
  const canLeave = await confirmLeaveEditor();
  if (!canLeave) return;

  // Selecting a file always returns to the editor (close overlay views).
  showFileMap.value = false;
  showTimeline.value = false;

  selectedProjectId.value = projectId;
  selectedFileId.value = file.id;
  currentProject.value = await getProject(projectId) || null;
  
  const projectFile = await getFile(file.id);
  
  if (projectFile) {
    currentFile.value = projectFile;
    if (!isImageFile(projectFile)) {
      editorInitialContent.value = projectFile.content || '';
      // Editor may not be mounted yet if we just closed File Map / Timeline.
      await nextTick();
      markdownEditorRef.value?.setContent(projectFile.content || '');
    }
    
    // For PDF files: prefer systemFilePath, fallback to binaryData for legacy files
    if (projectFile.type === 'pdf') {
      if (projectFile.systemFilePath) {
        pdfData.value = null;
      } else if (projectFile.binaryData) {
        pdfData.value = base64ToArrayBuffer(projectFile.binaryData);
      } else {
        pdfData.value = null;
      }
    } else {
      pdfData.value = null;
    }
  }
  
  chatSidebarRef.value?.selectProject(projectId);
}

function handleChatProjectChange(projectId: string) {
  selectedProjectId.value = projectId;
}

async function handleFileMapOpenFile(fileId: string, projectId: string) {
  await handleFileSelect(projectId, { id: fileId, path: '', type: 'md' });
}

async function handleTimelineOpenFile(fileId: string, projectId: string) {
  await handleFileSelect(projectId, { id: fileId, path: '', type: 'md' });
}

async function handleWikilinkOpenFile(fileId: string, projectId: string) {
  await handleFileSelect(projectId, { id: fileId, path: '', type: 'md' });
}

// Handle project list changes from chat (create, delete, move operations)
async function handleProjectsChanged() {
  await loadProjects();
  await projectsTreeRef.value?.refresh();
}

// Handle file updated from chat (updateFile tool)
async function handleFileUpdated(fileId: string) {
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
async function handleFileCreatedFromChat(projectId: string, fileId: string) {
  const canLeave = await confirmLeaveEditor();
  if (!canLeave) return;

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
    if (!isImageFile(file)) {
      editorInitialContent.value = file.content || '';
      markdownEditorRef.value?.setContent(file.content || '');
    }
  }
  
  // Reveal the file in the sidebar (expand parents + scroll into view)
  await projectsTreeRef.value?.revealFile(projectId, fileId);
}

// Handle image insertion from chat — saves image as a project file, then inserts the relative path
async function handleInsertImage(payload: { fileName?: string; fileId?: string; projectId?: string; altText: string; imageData?: string; imageMimeType?: string }) {
  if (!markdownEditorRef.value) return;

  // If the image already has a project file path, use it directly
  if (payload.fileName) {
    const imageMarkdown = `![${payload.altText}](${payload.fileName})`;
    markdownEditorRef.value.insertAtCursor(imageMarkdown);
    return;
  }

  // Need base64 data to save
  if (!payload.imageData) return;

  // Determine the target project — prefer the current file's project, then the payload's
  const targetProjectId = currentFile.value?.projectId || payload.projectId;
  if (!targetProjectId) return;

  try {
    const binaryStr = atob(payload.imageData);
    const binaryData = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      binaryData[i] = binaryStr.charCodeAt(i);
    }

    const { markdown } = await savePastedImage({
      projectId: targetProjectId,
      binaryData,
      mimeType: payload.imageMimeType || 'image/png',
      altText: payload.altText,
      filenamePrefix: 'generated',
    });
    markdownEditorRef.value.insertAtCursor(markdown);
  } catch {
    // Fallback: insert data URL if saving fails
    const dataUrl = `data:${payload.imageMimeType || 'image/png'};base64,${payload.imageData}`;
    const imageMarkdown = `![${payload.altText}](${dataUrl})`;
    markdownEditorRef.value.insertAtCursor(imageMarkdown);
  }
}

// New Note handler
async function handleNewNote() {
  const canLeave = await confirmLeaveEditor();
  if (!canLeave) return;

  // Clear current file and reset editor for a new note
  currentFile.value = null;
  if (!selectedProjectId.value) {
    currentProject.value = null;
  } else {
    currentProject.value = projects.value.find(p => p.id === selectedProjectId.value) || null;
  }
  selectedFileId.value = undefined;
  editorInitialContent.value = '';
  markdownEditorRef.value?.clearContent();
  markdownEditorRef.value?.focusEditor();
}

async function handleAutosaveExistingFile(content: string, file: ProjectFile): Promise<boolean> {
  try {
    const updatedFile = await updateFile(file.id, content, { createVersion: false });
    if (updatedFile) {
      currentFile.value = updatedFile;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function handleAutosaveDocxFile(html: string, file: ProjectFile): Promise<boolean> {
  try {
    const updatedFile = await updateFile(file.id, html, { createVersion: false });
    if (updatedFile) {
      currentFile.value = updatedFile;
      return true;
    }
    return false;
  } catch {
    return false;
  }
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

    currentProject.value = projects.value.find(p => p.id === result.projectId)
      || await getProject(result.projectId)
      || null;

    const file = await getFile(result.fileId);
    if (file) {
      currentFile.value = file;
      editorInitialContent.value = file.content || '';
      markdownEditorRef.value?.setContent(file.content || '');
    }
    
    // Reveal the file in the sidebar (expand parents + scroll into view)
    await projectsTreeRef.value?.revealFile(result.projectId, result.fileId);
  }
}

function handleContentChange() {
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
async function handleProjectRenamed() {
  // Refresh the projects list to reflect the new name
  await loadProjects();
}

// Search result selection handlers
async function handleSearchSelectFile(file: { id: string; projectId: string; name: string; path: string; type: string; projectName: string }) {
  const canLeave = await confirmLeaveEditor();
  if (!canLeave) return;

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
  const canLeave = await confirmLeaveEditor();
  if (!canLeave) return;

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
  const canLeave = await confirmLeaveEditor();
  if (!canLeave) return;

  // Select the project and file
  selectedProjectId.value = projectId;
  selectedFileId.value = file.id;
  currentProject.value = await getProject(projectId) || null;
  currentFile.value = file;
  editorInitialContent.value = file.content || '';
  markdownEditorRef.value?.setContent(file.content || '');

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

.timeline-active {
  --color: var(--hn-purple-light) !important;
}

.file-map-active {
  --color: var(--hn-purple-light) !important;
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

.modal-footer ion-toolbar {
  --background: var(--hn-bg-surface);
  --border-color: var(--hn-border-default);
  padding: 4px 8px;
}

.modal-confirm-btn {
  --background: linear-gradient(135deg, var(--hn-green) 0%, var(--hn-teal) 100%);
  --color: #ffffff;
  --border-radius: 8px;
  --padding-start: 20px;
  --padding-end: 20px;
}

.modal-confirm-btn:disabled {
  opacity: 0.5;
}

@media (max-width: 767px) {
  .header-brand span {
    display: none;
  }

  .search-shortcut {
    display: none;
  }

  .add-note-btn {
    --padding-start: 10px;
    --padding-end: 10px;
  }

  .add-note-btn ion-icon[slot='start'] {
    margin: 0;
  }

  .add-note-btn::part(native) {
    font-size: 0;
  }

  .workspace-layout {
    position: relative;
  }

  .workspace-layout > :deep(.projects-tree-sidebar),
  .workspace-layout > :deep(.chat-sidebar) {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 10;
    box-shadow: 0 0 24px rgba(0, 0, 0, 0.35);
  }

  .workspace-layout > :deep(.projects-tree-sidebar) {
    left: 0;
  }

  .workspace-layout > :deep(.chat-sidebar) {
    right: 0;
  }

  .workspace-resizer {
    display: none;
  }
}
</style>

