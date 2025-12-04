<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>HydraNote</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="router.push('/settings')">
            <ion-icon slot="icon-only" :icon="settingsOutline" />
          </ion-button>
          <ion-button @click="showCreateModal = true">
            <ion-icon slot="icon-only" :icon="addOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true" class="ion-padding">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">HydraNote</ion-title>
        </ion-toolbar>
      </ion-header>

      <!-- Hero Section -->
      <div class="hero-section">
        <img src="/hydranote-logo.png" alt="HydraNote" class="hero-logo" />
        <p class="hero-tagline">Your intelligent document assistant</p>
        
        <!-- Quick Add Note Button -->
        <ion-button class="quick-add-note-btn" @click="showAddNoteModal = true">
          <ion-icon slot="start" :icon="documentTextOutline" />
          Add Note
        </ion-button>
      </div>

      <!-- Empty State -->
      <div v-if="projects.length === 0 && !loading" class="empty-state">
        <ion-icon :icon="folderOpenOutline" class="empty-icon" />
        <h2>No Projects Yet</h2>
        <p>Create your first project to start analyzing documents</p>
        <ion-button @click="showCreateModal = true">
          <ion-icon slot="start" :icon="addOutline" />
          Create Project
        </ion-button>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="loading-state">
        <ion-spinner name="crescent" />
        <p>Loading projects...</p>
      </div>

      <!-- Project List -->
      <ion-list v-if="projects.length > 0" class="project-list">
        <ion-item-sliding v-for="project in projects" :key="project.id">
          <ion-item button @click="openProject(project)" detail>
            <ion-icon :icon="folderOutline" slot="start" class="project-icon" />
            <ion-label>
              <h2>{{ project.name }}</h2>
              <p v-if="project.description">{{ project.description }}</p>
              <p class="project-meta">
                <ion-badge :color="getStatusColor(project.status)">
                  {{ project.status }}
                </ion-badge>
                <span class="date">{{ formatDate(project.createdAt) }}</span>
              </p>
            </ion-label>
          </ion-item>
          <ion-item-options side="end">
            <ion-item-option color="danger" @click="deleteProject(project)">
              <ion-icon slot="icon-only" :icon="trashOutline" />
            </ion-item-option>
          </ion-item-options>
        </ion-item-sliding>
      </ion-list>

      <!-- Create Project Modal -->
      <ion-modal :is-open="showCreateModal" @didDismiss="showCreateModal = false">
        <ion-header>
          <ion-toolbar>
            <ion-buttons slot="start">
              <ion-button @click="showCreateModal = false">Cancel</ion-button>
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

      <!-- Add Note Modal -->
      <AddNoteModal
        :is-open="showAddNoteModal"
        :available-projects="projects"
        @close="showAddNoteModal = false"
        @save="handleSaveNote"
        @confirm-new-project="handleConfirmNewProject"
        @select-existing-project="handleSelectExistingProject"
        ref="addNoteModalRef"
      />

      <!-- Note Created Toast/Result Modal -->
      <ion-modal :is-open="showNoteResultModal" @didDismiss="showNoteResultModal = false" class="note-result-modal">
        <ion-header>
          <ion-toolbar>
            <ion-title>Note Created</ion-title>
            <ion-buttons slot="end">
              <ion-button @click="showNoteResultModal = false">
                <ion-icon slot="icon-only" :icon="closeOutline" />
              </ion-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content class="ion-padding">
          <div class="result-content">
            <div class="result-icon success">
              <ion-icon :icon="checkmarkCircleOutline" />
            </div>
            <h2>{{ noteResult?.title }}</h2>
            <p class="result-info">
              <span v-if="noteResult?.newProjectCreated" class="new-badge">New Project</span>
              Saved to <strong>{{ noteResult?.projectName }}</strong>
            </p>
            <div class="result-actions">
              <ion-button expand="block" @click="goToProjectChat">
                <ion-icon slot="start" :icon="chatbubbleOutline" />
                Open Project Chat
              </ion-button>
              <ion-button expand="block" fill="outline" @click="showNoteResultModal = false">
                Done
              </ion-button>
            </div>
          </div>
        </ion-content>
      </ion-modal>

    </ion-content>
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
  IonList,
  IonItem,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonLabel,
  IonIcon,
  IonButton,
  IonButtons,
  IonBadge,
  IonModal,
  IonInput,
  IonTextarea,
  IonSpinner,
  alertController,
  toastController,
} from '@ionic/vue';
import {
  addOutline,
  folderOutline,
  folderOpenOutline,
  trashOutline,
  settingsOutline,
  documentTextOutline,
  closeOutline,
  checkmarkCircleOutline,
  chatbubbleOutline,
} from 'ionicons/icons';
import type { Project, GlobalAddNoteResult } from '@/types';
import { initialize, getAllProjects, createProject, globalAddNote, getProject } from '@/services';
import type { NoteExecutionStep } from '@/services';
import AddNoteModal from '@/components/AddNoteModal.vue';

const router = useRouter();
const loading = ref(true);
const projects = ref<Project[]>([]);
const showCreateModal = ref(false);
const newProject = ref({
  name: '',
  description: '',
});

// Add Note state
const showAddNoteModal = ref(false);
const showNoteResultModal = ref(false);
const noteResult = ref<GlobalAddNoteResult | null>(null);
const addNoteModalRef = ref<InstanceType<typeof AddNoteModal> | null>(null);

// Track load version to prevent race conditions
let loadVersion = 0;

onMounted(async () => {
  await initialize();
  await loadProjects();
});

async function loadProjects() {
  const currentVersion = ++loadVersion;
  loading.value = true;
  try {
    const loadedProjects = await getAllProjects();
    // Only update if this is still the latest load request
    if (currentVersion === loadVersion) {
      projects.value = loadedProjects;
    }
  } finally {
    if (currentVersion === loadVersion) {
      loading.value = false;
    }
  }
}

function openProject(project: Project) {
  router.push(`/project/${project.id}/chat`);
}

async function handleCreateProject() {
  if (!newProject.value.name.trim()) return;

  try {
    const project = await createProject(
      newProject.value.name.trim(),
      newProject.value.description.trim() || undefined
    );
    projects.value.unshift(project);
    showCreateModal.value = false;
    newProject.value = { name: '', description: '' };
    
    // Navigate to the new project
    router.push(`/project/${project.id}/chat`);
  } catch (error) {
    const alert = await alertController.create({
      header: 'Error',
      message: 'Failed to create project. Please try again.',
      buttons: ['OK'],
    });
    await alert.present();
  }
}

async function deleteProject(project: Project) {
  const alert = await alertController.create({
    header: 'Delete Project',
    message: `Are you sure you want to delete "${project.name}"?`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Delete',
        role: 'destructive',
        handler: () => {
          projects.value = projects.value.filter(p => p.id !== project.id);
        },
      },
    ],
  });
  await alert.present();
}

function getStatusColor(status: Project['status']): string {
  const colors: Record<Project['status'], string> = {
    created: 'medium',
    indexing: 'warning',
    indexed: 'success',
    error: 'danger',
  };
  return colors[status];
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

// Add Note handlers
async function handleSaveNote(content: string, tags: string[], onProgress: (steps: NoteExecutionStep[]) => void) {
  try {
    const result = await globalAddNote(
      {
        rawNoteText: content,
        tags: tags.length > 0 ? tags : undefined,
      },
      onProgress
    );

    // Check if confirmation is needed for new project - show inline
    if (result.pendingConfirmation) {
      // Update the router step to show waiting state
      const steps = addNoteModalRef.value?.executionSteps || [];
      const updatedSteps = steps.map(s => 
        s.id === 'router' 
          ? { ...s, status: 'waiting' as const, detail: 'Waiting for confirmation' }
          : s
      );
      addNoteModalRef.value?.showConfirmation(result.pendingConfirmation, updatedSteps);
      return;
    }

    if (result.success) {
      await handleSuccessfulSave(result);
    } else {
      addNoteModalRef.value?.resetSaving();
      const toast = await toastController.create({
        message: result.error || 'Failed to save note',
        duration: 3000,
        color: 'danger',
        position: 'top',
      });
      await toast.present();
    }
  } catch (error) {
    addNoteModalRef.value?.resetSaving();
    const toast = await toastController.create({
      message: 'An error occurred while saving the note',
      duration: 3000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}

// Handle confirmed new project creation
async function handleConfirmNewProject(content: string, tags: string[], projectName: string, projectDescription?: string) {
  const onProgress = (steps: NoteExecutionStep[]) => {
    if (addNoteModalRef.value) {
      // @ts-ignore - accessing exposed ref
      addNoteModalRef.value.executionSteps = [...steps];
    }
  };

  try {
    const result = await globalAddNote(
      {
        rawNoteText: content,
        tags: tags.length > 0 ? tags : undefined,
        confirmedNewProject: { name: projectName, description: projectDescription },
      },
      onProgress
    );

    if (result.success) {
      await handleSuccessfulSave(result);
    } else {
      addNoteModalRef.value?.resetSaving();
      const toast = await toastController.create({
        message: result.error || 'Failed to save note',
        duration: 3000,
        color: 'danger',
        position: 'top',
      });
      await toast.present();
    }
  } catch (error) {
    addNoteModalRef.value?.resetSaving();
    const toast = await toastController.create({
      message: 'An error occurred while saving the note',
      duration: 3000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}

// Handle selecting existing project
async function handleSelectExistingProject(content: string, tags: string[], projectId: string) {
  const onProgress = (steps: NoteExecutionStep[]) => {
    if (addNoteModalRef.value) {
      // @ts-ignore - accessing exposed ref
      addNoteModalRef.value.executionSteps = [...steps];
    }
  };

  try {
    const result = await globalAddNote(
      {
        rawNoteText: content,
        tags: tags.length > 0 ? tags : undefined,
        confirmedProjectId: projectId,
      },
      onProgress
    );

    if (result.success) {
      await handleSuccessfulSave(result);
    } else {
      addNoteModalRef.value?.resetSaving();
      const toast = await toastController.create({
        message: result.error || 'Failed to save note',
        duration: 3000,
        color: 'danger',
        position: 'top',
      });
      await toast.present();
    }
  } catch (error) {
    addNoteModalRef.value?.resetSaving();
    const toast = await toastController.create({
      message: 'An error occurred while saving the note',
      duration: 3000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}

// Common success handler
async function handleSuccessfulSave(result: GlobalAddNoteResult) {
  noteResult.value = result;
  
  if (result.projectId) {
    const updatedProject = await getProject(result.projectId);
    if (updatedProject) {
      const existingIndex = projects.value.findIndex(p => p.id === updatedProject.id);
      if (existingIndex >= 0) {
        projects.value = [
          ...projects.value.slice(0, existingIndex),
          updatedProject,
          ...projects.value.slice(existingIndex + 1)
        ];
      } else {
        projects.value = [updatedProject, ...projects.value];
      }
    }
  }
  
  showAddNoteModal.value = false;
  showNoteResultModal.value = true;
}

function goToProjectChat() {
  if (noteResult.value?.projectId) {
    showNoteResultModal.value = false;
    router.push(`/project/${noteResult.value.projectId}/chat`);
  }
}
</script>

<style scoped>
ion-content {
  --background: var(--hn-bg-deepest);
}

ion-header ion-toolbar {
  --background: var(--hn-bg-deep);
  --color: var(--hn-text-primary);
  --border-color: var(--hn-border-default);
}

ion-title {
  color: var(--hn-text-primary);
}

.hero-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 24px 24px;
  text-align: center;
}

.hero-logo {
  width: 140px;
  height: auto;
  margin-bottom: 12px;
}

.hero-tagline {
  margin: 0;
  font-size: 1rem;
  color: var(--hn-text-secondary);
  font-weight: 400;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  color: var(--hn-text-secondary);
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.6;
  color: var(--hn-purple);
}

.empty-state h2 {
  margin: 0 0 8px;
  font-size: 1.5rem;
  color: var(--hn-text-primary);
}

.empty-state p {
  margin: 0 0 24px;
  font-size: 1rem;
}

.empty-state ion-button {
  --background: linear-gradient(135deg, var(--hn-purple), var(--hn-purple-light));
  --color: #ffffff;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  gap: 16px;
  color: var(--hn-text-secondary);
}

.project-list {
  background: transparent;
}

.project-list ion-item {
  --background: var(--hn-bg-surface);
  --color: var(--hn-text-primary);
  --border-color: var(--hn-border-subtle);
  margin-bottom: 8px;
  border-radius: 12px;
  --padding-start: 16px;
  --padding-end: 16px;
}

.project-list ion-item h2 {
  color: var(--hn-text-primary);
  font-weight: 600;
}

.project-list ion-item p {
  color: var(--hn-text-secondary);
}

.project-icon {
  font-size: 28px;
  color: var(--hn-purple);
}

.project-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.date {
  font-size: 0.75rem;
  color: var(--hn-text-muted);
}

ion-modal ion-toolbar {
  --background: var(--hn-bg-deep);
  --color: var(--hn-text-primary);
}

ion-modal ion-content {
  --background: var(--hn-bg-deepest);
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
  --color: var(--hn-purple-light);
}

/* Quick Add Note Button */
.quick-add-note-btn {
  margin-top: 20px;
  --background: linear-gradient(135deg, var(--hn-green), var(--hn-green-dark));
  --color: #ffffff;
  --border-radius: 12px;
  --padding-start: 24px;
  --padding-end: 24px;
  font-weight: 600;
  font-size: 1rem;
}

.quick-add-note-btn ion-icon {
  margin-right: 8px;
}

/* Note Result Modal */
.note-result-modal {
  --width: 90%;
  --max-width: 400px;
  --height: auto;
  --border-radius: 16px;
}

.note-result-modal ion-toolbar {
  --background: var(--hn-bg-deep);
  --border-color: var(--hn-border-default);
}

.note-result-modal ion-content {
  --background: var(--hn-bg-deepest);
}

.result-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 16px;
}

.result-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}

.result-icon.success {
  background: var(--hn-green-muted);
  color: var(--hn-green);
}

.result-icon ion-icon {
  font-size: 36px;
}

.result-content h2 {
  margin: 0 0 8px;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--hn-text-primary);
}

.result-info {
  margin: 0 0 24px;
  color: var(--hn-text-secondary);
  font-size: 0.95rem;
}

.result-info strong {
  color: var(--hn-purple);
}

.new-badge {
  display: inline-block;
  background: linear-gradient(135deg, var(--hn-purple), var(--hn-purple-light));
  color: #ffffff;
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 10px;
  margin-right: 8px;
  font-weight: 600;
  text-transform: uppercase;
}

.result-actions {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.result-actions ion-button {
  --border-radius: 12px;
}

.result-actions ion-button:first-child {
  --background: linear-gradient(135deg, var(--hn-purple), var(--hn-purple-light));
  --color: #ffffff;
}

.result-actions ion-button[fill="outline"] {
  --border-color: var(--hn-border-strong);
  --color: var(--hn-text-secondary);
}
</style>

