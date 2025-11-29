<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>DocuSage</ion-title>
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
          <ion-title size="large">DocuSage</ion-title>
        </ion-toolbar>
      </ion-header>

      <!-- Hero Section -->
      <div class="hero-section">
        <img src="/docusage-logo.png" alt="DocuSage" class="hero-logo" />
        <p class="hero-tagline">Your intelligent document assistant</p>
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
} from '@ionic/vue';
import {
  addOutline,
  folderOutline,
  folderOpenOutline,
  trashOutline,
  settingsOutline,
} from 'ionicons/icons';
import type { Project } from '@/types';
import { initialize, getAllProjects, createProject } from '@/services';

const router = useRouter();
const loading = ref(true);
const projects = ref<Project[]>([]);
const showCreateModal = ref(false);
const newProject = ref({
  name: '',
  description: '',
});

onMounted(async () => {
  await initialize();
  await loadProjects();
});

async function loadProjects() {
  loading.value = true;
  try {
    projects.value = await getAllProjects();
  } finally {
    loading.value = false;
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
</style>

