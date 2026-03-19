<template>
  <div class="zoom-settings">
    <!-- Header -->
    <div class="zoom-header">
      <div class="header-left">
        <div class="zoom-icon-wrapper">
          <ZoomIcon />
        </div>
        <div>
          <h3 class="zoom-title">Zoom Integration</h3>
          <p class="zoom-subtitle">Auto-sync meeting transcripts from Zoom Cloud Recordings</p>
        </div>
      </div>
      <button class="btn btn-close" @click="$emit('close')">
        <ion-icon :icon="closeOutline" />
      </button>
    </div>

    <!-- Credentials Section -->
    <div class="config-section">
      <h4 class="section-label">
        <ion-icon :icon="keyOutline" />
        Zoom Credentials
      </h4>
      <p class="section-hint">
        Create a
        <a href="#" @click.prevent="openExternal('https://marketplace.zoom.us/develop/create')">
          Server-to-Server OAuth app
        </a>
        on Zoom Marketplace with the <code>recording:read:admin</code> scope.
        <button class="btn-info-toggle" @click="showSetupGuide = !showSetupGuide" type="button">
          <ion-icon :icon="informationCircleOutline" />
          <span>{{ showSetupGuide ? 'Hide guide' : 'Setup guide' }}</span>
        </button>
      </p>

      <div v-if="showSetupGuide" class="setup-guide">
        <ol class="guide-steps">
          <li>
            Go to the
            <a href="#" @click.prevent="openExternal('https://marketplace.zoom.us')">Zoom App Marketplace</a>
            and sign in with your Zoom account.
          </li>
          <li>
            Click <strong>Develop</strong> in the top menu, then select <strong>Build App</strong>.
          </li>
          <li>
            Choose <strong>Server-to-Server OAuth</strong> as the app type and give it a name (e.g. "HydraNote").
          </li>
          <li>
            On the app's <strong>Information</strong> tab, fill in the required fields (Company Name, Developer Name, Email).
          </li>
          <li>
            Go to the <strong>Scopes</strong> tab, click <strong>+ Add Scopes</strong>, search for <code>recording:read:admin</code>, select it, and click <strong>Done</strong>.
          </li>
          <li>
            Go to the <strong>App Credentials</strong> tab. Copy the <strong>Account ID</strong>, <strong>Client ID</strong>, and <strong>Client Secret</strong> into the fields below.
          </li>
          <li>
            Click <strong>Activate</strong> on the Zoom app page to make it live, then use <strong>Test Connection</strong> below to verify.
          </li>
        </ol>
      </div>

      <div class="field-group">
        <label>Account ID</label>
        <input
          type="text"
          v-model="localSettings.credentials.accountId"
          placeholder="Your Zoom Account ID"
          class="text-input"
        />
      </div>

      <div class="field-group">
        <label>Client ID</label>
        <input
          type="text"
          v-model="localSettings.credentials.clientId"
          placeholder="OAuth Client ID"
          class="text-input"
        />
      </div>

      <div class="field-group">
        <label>Client Secret</label>
        <div class="secret-input">
          <input
            :type="showSecret ? 'text' : 'password'"
            v-model="localSettings.credentials.clientSecret"
            placeholder="OAuth Client Secret"
            class="text-input"
          />
          <button class="btn-icon" @click="showSecret = !showSecret" type="button">
            <ion-icon :icon="showSecret ? eyeOffOutline : eyeOutline" />
          </button>
        </div>
      </div>

      <div class="test-connection">
        <button
          class="btn btn-secondary"
          @click="handleTestConnection"
          :disabled="testing || !hasCredentials"
        >
          <ion-spinner v-if="testing" name="crescent" />
          <ion-icon v-else :icon="flashOutline" />
          <span>Test Connection</span>
        </button>
        <div v-if="testResult" class="test-result" :class="testResult.success ? 'success' : 'error'">
          <ion-icon :icon="testResult.success ? checkmarkCircleOutline : alertCircleOutline" />
          <span>{{ testResult.message }}</span>
        </div>
      </div>
    </div>

    <!-- Sync Settings Section -->
    <div class="config-section">
      <h4 class="section-label">
        <ion-icon :icon="syncOutline" />
        Sync Settings
      </h4>

      <div class="field-group">
        <label>Target Project</label>
        <select v-model="localSettings.syncSettings.targetProjectId" class="select-input">
          <option value="">Select a project...</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <div v-if="!creatingProject" class="inline-create-trigger">
          <button class="btn-inline-create" @click="creatingProject = true" type="button">
            <ion-icon :icon="addCircleOutline" />
            <span>Create new project</span>
          </button>
        </div>
        <div v-else class="inline-create-form">
          <input
            v-model="newProjectName"
            type="text"
            class="text-input"
            placeholder="New project name"
            @keydown.enter="handleCreateProject"
            ref="newProjectInput"
          />
          <button class="btn btn-primary btn-sm" @click="handleCreateProject" :disabled="!newProjectName.trim() || creatingProjectLoading">
            <ion-spinner v-if="creatingProjectLoading" name="crescent" />
            <span v-else>Create</span>
          </button>
          <button class="btn btn-secondary btn-sm" @click="creatingProject = false; newProjectName = ''" :disabled="creatingProjectLoading">
            Cancel
          </button>
        </div>
        <span class="field-hint">Transcripts will be saved in a <code>zoom-meetings/</code> directory inside this project.</span>
      </div>

      <div class="field-group">
        <label>Sync Interval</label>
        <select v-model.number="localSettings.syncSettings.syncIntervalMinutes" class="select-input">
          <option :value="1">Every minute</option>
          <option :value="5">Every 5 minutes</option>
          <option :value="15">Every 15 minutes</option>
          <option :value="30">Every 30 minutes</option>
          <option :value="60">Every hour</option>
        </select>
      </div>
    </div>

    <!-- Sync Status Section -->
    <div class="config-section" v-if="isConnected">
      <h4 class="section-label">
        <ion-icon :icon="statsChartOutline" />
        Sync Status
      </h4>

      <div class="status-grid">
        <div class="status-item">
          <span class="status-label">Status</span>
          <span class="status-value" :class="syncRunning ? 'active' : 'inactive'">
            <span class="status-dot" />
            {{ syncRunning ? 'Active' : 'Inactive' }}
          </span>
        </div>
        <div class="status-item">
          <span class="status-label">Last Sync</span>
          <span class="status-value">
            {{ lastSyncDisplay }}
          </span>
        </div>
        <div class="status-item">
          <span class="status-label">Meetings Synced</span>
          <span class="status-value">
            {{ localSettings.syncSettings.syncedMeetingUuids.length }}
          </span>
        </div>
      </div>

      <!-- Sync Log -->
      <div v-if="syncLog.length > 0" class="sync-log">
        <div
          v-for="(entry, idx) in syncLog"
          :key="idx"
          class="log-entry"
          :class="entry.type === 'sync_error' ? 'error' : ''"
        >
          <ion-icon
            :icon="entry.type === 'sync_error' ? alertCircleOutline :
                   entry.type === 'sync_completed' ? checkmarkCircleOutline :
                   syncOutline"
          />
          <span>{{ entry.message }}</span>
        </div>
      </div>

      <button
        class="btn btn-secondary sync-now-btn"
        @click="handleSyncNow"
        :disabled="currentlySyncing"
      >
        <ion-spinner v-if="currentlySyncing" name="crescent" />
        <ion-icon v-else :icon="refreshOutline" />
        <span>Sync Now</span>
      </button>
    </div>

    <!-- Action Buttons -->
    <div class="zoom-actions">
      <button
        v-if="isConnected"
        class="btn btn-danger"
        @click="handleDeactivate"
      >
        <ion-icon :icon="unlinkOutline" />
        <span>Deactivate</span>
      </button>
      <button
        class="btn btn-primary"
        @click="handleSave"
        :disabled="!hasCredentials || !localSettings.syncSettings.targetProjectId"
      >
        <ion-icon :icon="saveOutline" />
        <span>{{ isConnected ? 'Save Settings' : 'Save & Activate' }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { IonIcon, IonSpinner, toastController } from '@ionic/vue';
import {
  closeOutline,
  keyOutline,
  eyeOutline,
  eyeOffOutline,
  flashOutline,
  checkmarkCircleOutline,
  alertCircleOutline,
  syncOutline,
  statsChartOutline,
  refreshOutline,
  unlinkOutline,
  saveOutline,
  informationCircleOutline,
  addCircleOutline,
} from 'ionicons/icons';
import type { ZoomSettings, ZoomSyncEvent, Project } from '@/types';
import { DEFAULT_ZOOM_SETTINGS } from '@/types';
import { ZoomIcon } from '@/icons';
import {
  loadZoomSettings,
  saveZoomSettings,
  testConnection,
} from '@/services/zoomService';
import {
  syncNow,
  startSync,
  stopSync,
  restartSync,
  onSyncEvent,
  isSyncing,
  isSyncRunning,
} from '@/services/zoomSyncService';
import { getAllProjects, createProject } from '@/services/projectService';

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'activated'): void;
  (e: 'deactivated'): void;
}>();

const localSettings = ref<ZoomSettings>({ ...DEFAULT_ZOOM_SETTINGS });
const projects = ref<Project[]>([]);
const showSecret = ref(false);
const showSetupGuide = ref(false);
const testing = ref(false);
const testResult = ref<{ success: boolean; message: string } | null>(null);
const syncLog = ref<ZoomSyncEvent[]>([]);
const currentlySyncing = ref(false);
const syncRunning = ref(false);
const creatingProject = ref(false);
const newProjectName = ref('');
const creatingProjectLoading = ref(false);

const hasCredentials = computed(() => {
  const c = localSettings.value.credentials;
  return c.accountId.trim() !== '' && c.clientId.trim() !== '' && c.clientSecret.trim() !== '';
});

const isConnected = computed(() => {
  return !!localSettings.value.token?.accessToken;
});

const lastSyncDisplay = computed(() => {
  const last = localSettings.value.syncSettings.lastSyncTime;
  if (!last) return 'Never';
  try {
    return new Date(last).toLocaleString();
  } catch {
    return last;
  }
});

let unsubscribeSyncEvent: (() => void) | null = null;

onMounted(async () => {
  localSettings.value = loadZoomSettings();
  syncRunning.value = isSyncRunning();
  currentlySyncing.value = isSyncing();

  try {
    projects.value = await getAllProjects();
  } catch {
    projects.value = [];
  }

  unsubscribeSyncEvent = onSyncEvent((event: ZoomSyncEvent) => {
    syncLog.value = [event, ...syncLog.value].slice(0, 20);
    currentlySyncing.value = isSyncing();
    syncRunning.value = isSyncRunning();

    if (event.type === 'sync_completed' || event.type === 'sync_error') {
      localSettings.value = loadZoomSettings();
    }
  });
});

onUnmounted(() => {
  if (unsubscribeSyncEvent) unsubscribeSyncEvent();
});

function openExternal(url: string) {
  if (window.electronAPI?.shell?.openExternal) {
    window.electronAPI.shell.openExternal(url);
  }
}

async function handleCreateProject() {
  const name = newProjectName.value.trim();
  if (!name) return;
  creatingProjectLoading.value = true;
  try {
    const project = await createProject(name);
    projects.value.push(project);
    localSettings.value.syncSettings.targetProjectId = project.id;
    newProjectName.value = '';
    creatingProject.value = false;
    const toast = await toastController.create({
      message: `Project "${project.name}" created`,
      duration: 2000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const toast = await toastController.create({
      message: `Failed to create project: ${msg}`,
      duration: 3000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  } finally {
    creatingProjectLoading.value = false;
  }
}

async function handleTestConnection() {
  testing.value = true;
  testResult.value = null;

  try {
    saveZoomSettings(localSettings.value);
    const displayName = await testConnection(localSettings.value);
    testResult.value = { success: true, message: `Connected as ${displayName}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    testResult.value = { success: false, message: msg };
  } finally {
    testing.value = false;
  }
}

async function handleSave() {
  try {
    // Test connection first if not yet connected
    if (!isConnected.value) {
      testing.value = true;
      saveZoomSettings(localSettings.value);
      await testConnection(localSettings.value);
      localSettings.value = loadZoomSettings();
      testing.value = false;
    } else {
      saveZoomSettings(localSettings.value);
    }

    restartSync();
    syncRunning.value = isSyncRunning();
    emit('activated');

    const toast = await toastController.create({
      message: 'Zoom integration activated',
      duration: 2000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
  } catch (err) {
    testing.value = false;
    const msg = err instanceof Error ? err.message : String(err);
    const toast = await toastController.create({
      message: `Failed to connect: ${msg}`,
      duration: 3000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}

async function handleDeactivate() {
  stopSync();
  localSettings.value.token = undefined;
  saveZoomSettings(localSettings.value);
  syncRunning.value = false;
  syncLog.value = [];
  emit('deactivated');

  const toast = await toastController.create({
    message: 'Zoom integration deactivated',
    duration: 2000,
    color: 'warning',
    position: 'top',
  });
  await toast.present();
}

async function handleSyncNow() {
  currentlySyncing.value = true;
  await syncNow();
  currentlySyncing.value = isSyncing();
  localSettings.value = loadZoomSettings();
}
</script>

<style scoped>
.zoom-settings {
  background: var(--hn-bg-surface);
  border: 2px solid var(--hn-border-default);
  border-radius: 16px;
  padding: 28px;
  margin-top: 24px;
}

/* Header */
.zoom-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--hn-border-default);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.zoom-icon-wrapper {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #2d8cff;
  border-radius: 12px;
}

.zoom-icon-wrapper :deep(svg) {
  width: 28px;
  height: 28px;
}

.zoom-title {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--hn-text-primary);
}

.zoom-subtitle {
  margin: 4px 0 0;
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
}

.btn-close {
  background: none;
  border: none;
  color: var(--hn-text-muted);
  font-size: 1.4rem;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}

.btn-close:hover {
  color: var(--hn-text-primary);
}

/* Config Sections */
.config-section {
  margin-bottom: 28px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--hn-border-default);
}

.config-section:last-of-type {
  border-bottom: none;
  margin-bottom: 20px;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 1rem;
  font-weight: 600;
  color: var(--hn-text-primary);
}

.section-label ion-icon {
  font-size: 1.1rem;
  color: var(--hn-purple-light);
}

.section-hint {
  margin: 0 0 16px;
  font-size: 0.82rem;
  color: var(--hn-text-muted);
  line-height: 1.5;
}

.section-hint a {
  color: var(--hn-purple-light);
  text-decoration: underline;
}

.section-hint code {
  background: var(--hn-bg-elevated);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.85em;
}

/* Setup Guide Toggle */
.btn-info-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--hn-purple-light);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  margin-left: 4px;
  transition: background 0.15s;
}

.btn-info-toggle:hover {
  background: var(--hn-purple-muted);
}

.btn-info-toggle ion-icon {
  font-size: 1rem;
}

/* Setup Guide */
.setup-guide {
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 10px;
  padding: 18px 18px 18px 8px;
  margin-bottom: 20px;
}

.guide-steps {
  margin: 0;
  padding-left: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.guide-steps li {
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
  line-height: 1.55;
}

.guide-steps li::marker {
  color: var(--hn-purple-light);
  font-weight: 600;
}

.guide-steps strong {
  color: var(--hn-text-primary);
}

.guide-steps code {
  background: var(--hn-bg-surface);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.88em;
  color: var(--hn-purple-light);
}

.guide-steps a {
  color: var(--hn-purple-light);
  text-decoration: underline;
}

/* Field Groups */
.field-group {
  margin-bottom: 16px;
}

.field-group label {
  display: block;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--hn-text-secondary);
  margin-bottom: 6px;
}

.text-input,
.select-input {
  width: 100%;
  padding: 10px 14px;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  color: var(--hn-text-primary);
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.text-input:focus,
.select-input:focus {
  border-color: var(--hn-purple);
}

.text-input::placeholder {
  color: var(--hn-text-muted);
}

.select-input {
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 16px;
  padding-right: 36px;
}

.select-input option {
  background: var(--hn-bg-surface);
  color: var(--hn-text-primary);
}

.field-hint {
  display: block;
  margin-top: 4px;
  font-size: 0.78rem;
  color: var(--hn-text-muted);
}

.field-hint code {
  background: var(--hn-bg-elevated);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.9em;
}

/* Inline Create Project */
.inline-create-trigger {
  margin-top: 8px;
}

.btn-inline-create {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: none;
  color: var(--hn-purple-light);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 2px;
  border-radius: 6px;
  transition: opacity 0.15s;
}

.btn-inline-create:hover {
  opacity: 0.8;
}

.btn-inline-create ion-icon {
  font-size: 1rem;
}

.inline-create-form {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.inline-create-form .text-input {
  flex: 1;
  padding: 8px 12px;
  font-size: 0.85rem;
}

.btn-sm {
  padding: 7px 14px !important;
  font-size: 0.82rem !important;
}

/* Secret Input */
.secret-input {
  display: flex;
  gap: 8px;
  align-items: center;
}

.secret-input .text-input {
  flex: 1;
}

.btn-icon {
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  color: var(--hn-text-secondary);
  padding: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.btn-icon:hover {
  color: var(--hn-text-primary);
  border-color: var(--hn-border-strong);
}

/* Test Connection */
.test-connection {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.test-result {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  font-weight: 500;
}

.test-result.success {
  color: var(--hn-green-light);
}

.test-result.error {
  color: var(--hn-danger);
}

.test-result ion-icon {
  font-size: 1.1rem;
}

/* Status Grid */
.status-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}

.status-item {
  background: var(--hn-bg-elevated);
  border-radius: 10px;
  padding: 14px;
}

.status-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--hn-text-muted);
  margin-bottom: 6px;
}

.status-value {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--hn-text-primary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-value.active .status-dot {
  background: var(--hn-green-light);
  box-shadow: 0 0 6px rgba(0, 200, 83, 0.4);
}

.status-value.inactive .status-dot {
  background: var(--hn-text-muted);
}

/* Sync Log */
.sync-log {
  max-height: 160px;
  overflow-y: auto;
  margin-bottom: 12px;
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
}

.log-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 0.82rem;
  color: var(--hn-text-secondary);
  border-bottom: 1px solid var(--hn-border-default);
}

.log-entry:last-child {
  border-bottom: none;
}

.log-entry.error {
  color: var(--hn-danger);
}

.log-entry ion-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.sync-now-btn {
  margin-top: 4px;
}

/* Action Buttons */
.zoom-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 4px;
}

/* Shared button styles */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: linear-gradient(135deg, var(--hn-purple), var(--hn-purple-light));
  color: #ffffff;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.btn-secondary {
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  color: var(--hn-text-secondary);
}

.btn-secondary:hover:not(:disabled) {
  border-color: var(--hn-border-strong);
  color: var(--hn-text-primary);
}

.btn-danger {
  background: var(--hn-danger-muted);
  border: 1px solid var(--hn-danger);
  color: var(--hn-danger);
}

.btn-danger:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn ion-icon {
  font-size: 1.1rem;
}

.btn ion-spinner {
  width: 18px;
  height: 18px;
}

@media (max-width: 768px) {
  .zoom-settings {
    padding: 20px;
  }

  .status-grid {
    grid-template-columns: 1fr;
  }

  .zoom-actions {
    flex-direction: column;
  }

  .zoom-actions .btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
