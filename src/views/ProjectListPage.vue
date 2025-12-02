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
        @close="showAddNoteModal = false"
        @save="handleSaveNote"
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

    if (result.success) {
      // Store result first
      noteResult.value = result;
      
      // Fetch the project (either new or existing) with updated status
      if (result.projectId) {
        const updatedProject = await getProject(result.projectId);
        if (updatedProject) {
          // Update or add the project in the list
          const existingIndex = projects.value.findIndex(p => p.id === updatedProject.id);
          if (existingIndex >= 0) {
            // Update existing project
            projects.value = [
              ...projects.value.slice(0, existingIndex),
              updatedProject,
              ...projects.value.slice(existingIndex + 1)
            ];
          } else {
            // Add new project at the beginning
            projects.value = [updatedProject, ...projects.value];
          }
        }
      }
      
      // Now close the add note modal and show result
      showAddNoteModal.value = false;
      showNoteResultModal.value = true;
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

function goToProjectChat() {
  if (noteResult.value?.projectId) {
    showNoteResultModal.value = false;
    router.push(`/project/${noteResult.value.projectId}/chat`);
  }
}
</script>

<style scoped>
ion-content {
  --background: #1a1a2e;
}

ion-header ion-toolbar {
  --background: #16162a;
  --color: #e2e2e8;
  --border-color: #2d2d44;
}

ion-title {
  color: #e2e2e8;
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
  color: #8b8b9e;
  font-weight: 400;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  color: #8b8b9e;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.6;
  color: #6366f1;
}

.empty-state h2 {
  margin: 0 0 8px;
  font-size: 1.5rem;
  color: #e2e2e8;
}

.empty-state p {
  margin: 0 0 24px;
  font-size: 1rem;
}

.empty-state ion-button {
  --background: linear-gradient(135deg, #6366f1, #8b5cf6);
  --color: #ffffff;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  gap: 16px;
  color: #8b8b9e;
}

.project-list {
  background: transparent;
}

.project-list ion-item {
  --background: #2d2d44;
  --color: #e2e2e8;
  --border-color: #3d3d5c;
  margin-bottom: 8px;
  border-radius: 12px;
  --padding-start: 16px;
  --padding-end: 16px;
}

.project-list ion-item h2 {
  color: #e2e2e8;
  font-weight: 600;
}

.project-list ion-item p {
  color: #8b8b9e;
}

.project-icon {
  font-size: 28px;
  color: #6366f1;
}

.project-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.date {
  font-size: 0.75rem;
  color: #6b6b80;
}

ion-modal ion-toolbar {
  --background: #16162a;
  --color: #e2e2e8;
}

ion-modal ion-content {
  --background: #1a1a2e;
}

ion-modal ion-list {
  background: transparent;
}

ion-modal ion-item {
  --background: #2d2d44;
  --color: #e2e2e8;
  --border-color: #3d3d5c;
}

ion-modal ion-input,
ion-modal ion-textarea {
  --color: #e2e2e8;
  --placeholder-color: #6b6b80;
}

ion-modal ion-button {
  --color: #6366f1;
}

ion-modal ion-button[strong] {
  --color: #8b5cf6;
}

/* Quick Add Note Button */
.quick-add-note-btn {
  margin-top: 20px;
  --background: linear-gradient(135deg, #3fb950, #238636);
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
  --background: #16162a;
  --border-color: #2d2d44;
}

.note-result-modal ion-content {
  --background: #1a1a2e;
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
  background: rgba(63, 185, 80, 0.15);
  color: #3fb950;
}

.result-icon ion-icon {
  font-size: 36px;
}

.result-content h2 {
  margin: 0 0 8px;
  font-size: 1.25rem;
  font-weight: 600;
  color: #e2e2e8;
}

.result-info {
  margin: 0 0 24px;
  color: #8b8b9e;
  font-size: 0.95rem;
}

.result-info strong {
  color: #6366f1;
}

.new-badge {
  display: inline-block;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
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
  --background: linear-gradient(135deg, #6366f1, #8b5cf6);
  --color: #ffffff;
}

.result-actions ion-button[fill="outline"] {
  --border-color: #3d3d5c;
  --color: #8b8b9e;
}
</style>

