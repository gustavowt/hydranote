<template>
  <div class="gws-settings">
    <!-- Header -->
    <div class="gws-header">
      <div class="header-left">
        <div class="gws-icon-wrapper">
          <GoogleWorkspaceIcon />
        </div>
        <div>
          <h3 class="gws-title">Google Workspace Integration</h3>
          <p class="gws-subtitle">Connect Google Meet and Google Calendar with your Google account</p>
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
        OAuth Credentials
      </h4>
      <p class="section-hint">
        Create an
        <a href="#" @click.prevent="openExternal('https://console.cloud.google.com/apis/credentials')">
          OAuth 2.0 Client ID
        </a>
        in Google Cloud Console (Desktop app type).
        <button class="btn-info-toggle" @click="showSetupGuide = !showSetupGuide" type="button">
          <ion-icon :icon="informationCircleOutline" />
          <span>{{ showSetupGuide ? 'Hide guide' : 'Setup guide' }}</span>
        </button>
      </p>

      <div v-if="showSetupGuide" class="setup-guide">
        <ol class="guide-steps">
          <li>
            Go to the
            <a href="#" @click.prevent="openExternal('https://console.cloud.google.com')">Google Cloud Console</a>
            and create a new project (or select an existing one).
          </li>
          <li>
            Navigate to <strong>APIs & Services &gt; Library</strong>. Enable the APIs for each app you want to use:
            <ul class="scope-list">
              <li v-if="localSettings.enabledApps.meet || !hasAnyAppEnabled">
                <strong>Google Meet</strong>: Enable <strong>Google Meet REST API</strong> and <strong>Google Drive API</strong>
              </li>
              <li v-if="localSettings.enabledApps.calendar || !hasAnyAppEnabled">
                <strong>Google Calendar</strong>: Enable <strong>Google Calendar API</strong>
              </li>
            </ul>
          </li>
          <li>
            Go to <strong>APIs & Services &gt; OAuth consent screen</strong>.
            Select <strong>External</strong> user type, fill in app name (e.g. "HydraNote"), your email, and click through.
            Under <strong>Test users</strong>, add your own Google email address.
          </li>
          <li>
            Go to <strong>APIs & Services &gt; Credentials</strong>.
            Click <strong>Create Credentials &gt; OAuth client ID</strong>.
            Choose <strong>Desktop app</strong> as the application type and click <strong>Create</strong>.
          </li>
          <li>
            Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> from the dialog and paste them below.
          </li>
          <li>
            Click <strong>Sign in with Google</strong> below. A browser window will open for you to grant permissions.
            You may see a "This app isn't verified" warning — click <strong>Advanced &gt; Go to [app name]</strong> to proceed (this is safe, it's your own project).
          </li>
        </ol>
      </div>

      <div class="field-group">
        <label>Client ID</label>
        <input
          type="text"
          v-model="localSettings.credentials.clientId"
          placeholder="123456789.apps.googleusercontent.com"
          class="text-input"
          spellcheck="false"
        />
      </div>

      <div class="field-group">
        <label>Client Secret</label>
        <input
          type="password"
          v-model="localSettings.credentials.clientSecret"
          placeholder="GOCSPX-..."
          class="text-input"
          spellcheck="false"
        />
      </div>

      <!-- Sign In / Connection Status -->
      <div class="sign-in-section">
        <div v-if="isConnected" class="connected-status">
          <ion-icon :icon="checkmarkCircleOutline" class="connected-icon" />
          <div class="connected-info">
            <span class="connected-label">Signed in</span>
            <span v-if="localSettings.credentials.userEmail" class="connected-email">{{ localSettings.credentials.userEmail }}</span>
          </div>
        </div>
        <button
          class="btn btn-google"
          @click="handleSignIn"
          :disabled="signingIn || !hasClientCredentials"
        >
          <ion-spinner v-if="signingIn" name="crescent" />
          <ion-icon v-else :icon="logInOutline" />
          <span>{{ isConnected ? 'Re-sign in with Google' : 'Sign in with Google' }}</span>
        </button>
        <span v-if="scopeChanged && isConnected" class="scope-change-hint">
          <ion-icon :icon="warningOutline" />
          Apps changed — re-sign in to update permissions
        </span>
      </div>

      <div v-if="signInError" class="test-result error">
        <ion-icon :icon="alertCircleOutline" />
        <span>{{ signInError }}</span>
      </div>

      <div class="test-connection" v-if="isConnected">
        <button
          class="btn btn-secondary"
          @click="handleTestConnection"
          :disabled="testing"
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

    <!-- Apps Section -->
    <div class="config-section">
      <h4 class="section-label">
        <ion-icon :icon="appsOutline" />
        Applications
      </h4>
      <p class="section-hint">Select which Google Workspace applications to enable. Each requires specific API permissions (see setup guide above).</p>

      <div class="apps-grid">
        <label class="app-card" :class="{ active: localSettings.enabledApps.meet }">
          <input type="checkbox" v-model="localSettings.enabledApps.meet" class="app-checkbox" />
          <div class="app-icon meet-icon">
            <GoogleMeetIcon />
          </div>
          <div class="app-info">
            <span class="app-name">Google Meet</span>
            <span class="app-desc">Auto-sync meeting transcripts</span>
          </div>
        </label>

        <label class="app-card" :class="{ active: localSettings.enabledApps.calendar }">
          <input type="checkbox" v-model="localSettings.enabledApps.calendar" class="app-checkbox" />
          <div class="app-icon calendar-icon">
            <GoogleCalendarIcon />
          </div>
          <div class="app-info">
            <span class="app-name">Google Calendar</span>
            <span class="app-desc">Sync events &amp; detect dates in notes</span>
          </div>
        </label>
      </div>
    </div>

    <!-- Meet Sync Settings -->
    <div v-if="localSettings.enabledApps.meet" class="config-section">
      <h4 class="section-label">
        <ion-icon :icon="syncOutline" />
        Meet Sync Settings
      </h4>

      <div class="field-group">
        <label>Target Project</label>
        <select v-model="localSettings.meetSyncSettings.targetProjectId" class="select-input">
          <option value="">Select a project...</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <div v-if="!creatingMeetProject" class="inline-create-trigger">
          <button class="btn-inline-create" @click="creatingMeetProject = true" type="button">
            <ion-icon :icon="addCircleOutline" />
            <span>Create new project</span>
          </button>
        </div>
        <div v-else class="inline-create-form">
          <input
            v-model="newMeetProjectName"
            type="text"
            class="text-input"
            placeholder="New project name"
            @keydown.enter="handleCreateMeetProject"
          />
          <button class="btn btn-primary btn-sm" @click="handleCreateMeetProject" :disabled="!newMeetProjectName.trim() || creatingMeetProjectLoading">
            <ion-spinner v-if="creatingMeetProjectLoading" name="crescent" />
            <span v-else>Create</span>
          </button>
          <button class="btn btn-secondary btn-sm" @click="creatingMeetProject = false; newMeetProjectName = ''" :disabled="creatingMeetProjectLoading">
            Cancel
          </button>
        </div>
        <span class="field-hint">Transcripts will be saved in a <code>google-meet/</code> directory inside this project.</span>
      </div>

      <div class="field-group">
        <label>Sync Interval</label>
        <select v-model.number="localSettings.meetSyncSettings.syncIntervalMinutes" class="select-input">
          <option :value="1">Every minute</option>
          <option :value="5">Every 5 minutes</option>
          <option :value="15">Every 15 minutes</option>
          <option :value="30">Every 30 minutes</option>
          <option :value="60">Every hour</option>
        </select>
      </div>

      <!-- Meet Sync Status -->
      <div v-if="isConnected" class="sync-status-block">
        <div class="status-grid">
          <div class="status-item">
            <span class="status-label">Status</span>
            <span class="status-value" :class="meetSyncRunning ? 'active' : 'inactive'">
              <span class="status-dot" />
              {{ meetSyncRunning ? 'Active' : 'Inactive' }}
            </span>
          </div>
          <div class="status-item">
            <span class="status-label">Meetings Synced</span>
            <span class="status-value">
              {{ localSettings.meetSyncSettings.syncedConferenceNames.length }}
            </span>
          </div>
        </div>

        <div v-if="meetSyncLog.length > 0" class="sync-log">
          <div
            v-for="(entry, idx) in meetSyncLog"
            :key="'meet-' + idx"
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
          @click="handleMeetSyncNow"
          :disabled="meetCurrentlySyncing"
        >
          <ion-spinner v-if="meetCurrentlySyncing" name="crescent" />
          <ion-icon v-else :icon="refreshOutline" />
          <span>Sync Meet Now</span>
        </button>
      </div>
    </div>

    <!-- Calendar Sync Settings -->
    <div v-if="localSettings.enabledApps.calendar" class="config-section">
      <h4 class="section-label">
        <ion-icon :icon="syncOutline" />
        Calendar Sync Settings
      </h4>

      <!-- Calendar Selection -->
      <div v-if="availableCalendars.length > 0" class="field-group">
        <label>
          <ion-icon :icon="calendarOutline" />
          Calendars
        </label>
        <p class="field-hint" style="margin-bottom: 8px;">Select which calendars to sync. If none are selected, only the primary calendar is synced.</p>

        <div class="calendar-list">
          <label
            v-for="cal in availableCalendars"
            :key="cal.id"
            class="calendar-item"
          >
            <input
              type="checkbox"
              :value="cal.id"
              v-model="localSettings.calendarSyncSettings.selectedCalendarIds"
              class="calendar-checkbox"
            />
            <span
              class="calendar-color-dot"
              :style="{ background: cal.backgroundColor || '#4285F4' }"
            />
            <span class="calendar-name">
              {{ cal.summary }}
              <span v-if="cal.primary" class="primary-badge">Primary</span>
            </span>
          </label>
        </div>
      </div>

      <div class="field-row">
        <div class="field-group">
          <label>Past Days</label>
          <select v-model.number="localSettings.calendarSyncSettings.pastDays" class="select-input">
            <option :value="0">Today only</option>
            <option :value="1">1 day</option>
            <option :value="3">3 days</option>
            <option :value="7">7 days</option>
            <option :value="14">14 days</option>
            <option :value="30">30 days</option>
          </select>
        </div>
        <div class="field-group">
          <label>Future Days</label>
          <select v-model.number="localSettings.calendarSyncSettings.futureDays" class="select-input">
            <option :value="0">Today only</option>
            <option :value="1">1 day</option>
            <option :value="3">3 days</option>
            <option :value="7">7 days</option>
            <option :value="14">14 days</option>
            <option :value="30">30 days</option>
          </select>
        </div>
      </div>

      <div class="field-group">
        <label>Sync Interval</label>
        <select v-model.number="localSettings.calendarSyncSettings.syncIntervalMinutes" class="select-input">
          <option :value="1">Every minute</option>
          <option :value="5">Every 5 minutes</option>
          <option :value="15">Every 15 minutes</option>
          <option :value="30">Every 30 minutes</option>
          <option :value="60">Every hour</option>
        </select>
      </div>

      <!-- Calendar Sync Status -->
      <div v-if="isConnected" class="sync-status-block">
        <div class="status-grid">
          <div class="status-item">
            <span class="status-label">Status</span>
            <span class="status-value" :class="calSyncRunning ? 'active' : 'inactive'">
              <span class="status-dot" />
              {{ calSyncRunning ? 'Active' : 'Inactive' }}
            </span>
          </div>
          <div class="status-item">
            <span class="status-label">Events Synced</span>
            <span class="status-value">
              {{ localSettings.calendarSyncSettings.syncedEventIds.length }}
            </span>
          </div>
        </div>

        <div v-if="calSyncLog.length > 0" class="sync-log">
          <div
            v-for="(entry, idx) in calSyncLog"
            :key="'cal-' + idx"
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
          @click="handleCalSyncNow"
          :disabled="calCurrentlySyncing"
        >
          <ion-spinner v-if="calCurrentlySyncing" name="crescent" />
          <ion-icon v-else :icon="refreshOutline" />
          <span>Sync Calendar Now</span>
        </button>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="gws-actions">
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
        :disabled="!isConnected || !hasAnyAppEnabled || !hasRequiredTargetProjects"
      >
        <ion-icon :icon="saveOutline" />
        <span>Save Settings</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { IonIcon, IonSpinner, toastController } from '@ionic/vue';
import {
  closeOutline,
  keyOutline,
  flashOutline,
  checkmarkCircleOutline,
  alertCircleOutline,
  syncOutline,
  refreshOutline,
  unlinkOutline,
  saveOutline,
  informationCircleOutline,
  addCircleOutline,
  appsOutline,
  calendarOutline,
  logInOutline,
  warningOutline,
} from 'ionicons/icons';
import type { GoogleWorkspaceSettings, GoogleMeetSyncEvent, GoogleCalendarSyncEvent, GoogleCalendarListEntry, Project } from '@/types';
import { DEFAULT_GOOGLE_WORKSPACE_SETTINGS } from '@/types';
import { GoogleWorkspaceIcon, GoogleMeetIcon, GoogleCalendarIcon } from '@/icons';
import {
  loadGoogleWorkspaceSettings,
  saveGoogleWorkspaceSettings,
  startGoogleOAuth,
  buildScopesForEnabledApps,
  MEET_SCOPES,
  CALENDAR_SCOPES,
} from '@/services/googleWorkspaceAuthService';
import { testMeetConnection } from '@/services/googleMeetService';
import { testCalendarConnection, listCalendars } from '@/services/googleCalendarService';
import {
  syncNow as meetSyncNow,
  restartSync as restartMeetSync,
  stopSync as stopMeetSync,
  onSyncEvent as onMeetSyncEvent,
  isSyncing as isMeetSyncing,
  isSyncRunning as isMeetSyncRunning,
} from '@/services/googleMeetSyncService';
import {
  syncNow as calSyncNow,
  restartSync as restartCalSync,
  stopSync as stopCalSync,
  onSyncEvent as onCalSyncEvent,
  isSyncing as isCalSyncing,
  isSyncRunning as isCalSyncRunning,
} from '@/services/googleCalendarSyncService';
import { getAllProjects, createProject } from '@/services/projectService';

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'activated'): void;
  (e: 'deactivated'): void;
}>();

const localSettings = ref<GoogleWorkspaceSettings>({ ...DEFAULT_GOOGLE_WORKSPACE_SETTINGS });
const projects = ref<Project[]>([]);
const availableCalendars = ref<GoogleCalendarListEntry[]>([]);
const showSetupGuide = ref(false);
const testing = ref(false);
const testResult = ref<{ success: boolean; message: string } | null>(null);
const signingIn = ref(false);
const signInError = ref('');
const scopeChanged = ref(false);

// Track which scopes were granted at sign-in time
const signedInScopes = ref('');

// Meet sync state
const meetSyncLog = ref<GoogleMeetSyncEvent[]>([]);
const meetCurrentlySyncing = ref(false);
const meetSyncRunning = ref(false);

// Calendar sync state
const calSyncLog = ref<GoogleCalendarSyncEvent[]>([]);
const calCurrentlySyncing = ref(false);
const calSyncRunning = ref(false);

// Project creation for Meet
const creatingMeetProject = ref(false);
const newMeetProjectName = ref('');
const creatingMeetProjectLoading = ref(false);


const hasClientCredentials = computed(() => {
  const c = localSettings.value.credentials;
  return c.clientId.trim() !== '' && c.clientSecret.trim() !== '';
});

const hasAnyAppEnabled = computed(() => {
  return localSettings.value.enabledApps.meet || localSettings.value.enabledApps.calendar;
});

const hasRequiredTargetProjects = computed(() => {
  const { enabledApps, meetSyncSettings } = localSettings.value;
  if (enabledApps.meet && !meetSyncSettings.targetProjectId) return false;
  return true;
});

const isConnected = computed(() => {
  return !!localSettings.value.credentials.refreshToken;
});

const requiredScopes = computed(() => {
  const scopes: string[] = [];
  if (localSettings.value.enabledApps.meet) scopes.push(...MEET_SCOPES);
  if (localSettings.value.enabledApps.calendar) scopes.push(...CALENDAR_SCOPES);
  if (scopes.length === 0) scopes.push(...MEET_SCOPES, ...CALENDAR_SCOPES);
  return scopes.join(', ');
});

// Watch for app toggle changes to detect scope mismatches
watch(
  () => [localSettings.value.enabledApps.meet, localSettings.value.enabledApps.calendar],
  () => {
    if (isConnected.value && signedInScopes.value) {
      const currentScopes = buildScopesForEnabledApps(localSettings.value);
      scopeChanged.value = currentScopes !== signedInScopes.value;
    }
  },
);

let unsubscribeMeetSync: (() => void) | null = null;
let unsubscribeCalSync: (() => void) | null = null;

onMounted(async () => {
  localSettings.value = loadGoogleWorkspaceSettings();
  meetSyncRunning.value = isMeetSyncRunning();
  meetCurrentlySyncing.value = isMeetSyncing();
  calSyncRunning.value = isCalSyncRunning();
  calCurrentlySyncing.value = isCalSyncing();

  if (isConnected.value) {
    signedInScopes.value = buildScopesForEnabledApps(localSettings.value);
  }

  try {
    projects.value = await getAllProjects();
  } catch {
    projects.value = [];
  }

  if (isConnected.value && localSettings.value.enabledApps.calendar) {
    try {
      availableCalendars.value = await listCalendars(localSettings.value);
    } catch {
      availableCalendars.value = [];
    }
  }

  unsubscribeMeetSync = onMeetSyncEvent((event: GoogleMeetSyncEvent) => {
    meetSyncLog.value = [event, ...meetSyncLog.value].slice(0, 20);
    meetCurrentlySyncing.value = isMeetSyncing();
    meetSyncRunning.value = isMeetSyncRunning();
    if (event.type === 'sync_completed' || event.type === 'sync_error') {
      localSettings.value = loadGoogleWorkspaceSettings();
    }
  });

  unsubscribeCalSync = onCalSyncEvent((event: GoogleCalendarSyncEvent) => {
    calSyncLog.value = [event, ...calSyncLog.value].slice(0, 20);
    calCurrentlySyncing.value = isCalSyncing();
    calSyncRunning.value = isCalSyncRunning();
    if (event.type === 'sync_completed' || event.type === 'sync_error') {
      localSettings.value = loadGoogleWorkspaceSettings();
    }
  });
});

onUnmounted(() => {
  if (unsubscribeMeetSync) unsubscribeMeetSync();
  if (unsubscribeCalSync) unsubscribeCalSync();
});

function openExternal(url: string) {
  if (window.electronAPI?.shell?.openExternal) {
    window.electronAPI.shell.openExternal(url);
  }
}

async function handleSignIn() {
  signingIn.value = true;
  signInError.value = '';

  try {
    saveGoogleWorkspaceSettings(localSettings.value);
    const result = await startGoogleOAuth(localSettings.value);

    if (!result.success) {
      signInError.value = result.error || 'Sign-in failed';
      return;
    }

    localSettings.value = loadGoogleWorkspaceSettings();
    signedInScopes.value = buildScopesForEnabledApps(localSettings.value);
    scopeChanged.value = false;

    if (localSettings.value.enabledApps.calendar) {
      try {
        availableCalendars.value = await listCalendars(localSettings.value);
      } catch {
        availableCalendars.value = [];
      }
    }

    const toast = await toastController.create({
      message: `Signed in as ${result.email || 'Google user'}`,
      duration: 2000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
  } catch (err) {
    signInError.value = err instanceof Error ? err.message : String(err);
  } finally {
    signingIn.value = false;
  }
}

async function handleCreateMeetProject() {
  const name = newMeetProjectName.value.trim();
  if (!name) return;
  creatingMeetProjectLoading.value = true;
  try {
    const project = await createProject(name);
    projects.value.push(project);
    localSettings.value.meetSyncSettings.targetProjectId = project.id;
    newMeetProjectName.value = '';
    creatingMeetProject.value = false;
    const toast = await toastController.create({ message: `Project "${project.name}" created`, duration: 2000, color: 'success', position: 'top' });
    await toast.present();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const toast = await toastController.create({ message: `Failed to create project: ${msg}`, duration: 3000, color: 'danger', position: 'top' });
    await toast.present();
  } finally {
    creatingMeetProjectLoading.value = false;
  }
}


async function handleTestConnection() {
  testing.value = true;
  testResult.value = null;

  try {
    const results: string[] = [];
    if (localSettings.value.enabledApps.meet) {
      const meetEmail = await testMeetConnection(localSettings.value);
      results.push(`Meet: ${meetEmail}`);
    }
    if (localSettings.value.enabledApps.calendar) {
      const calEmail = await testCalendarConnection(localSettings.value);
      results.push(`Calendar: ${calEmail}`);
      try {
        availableCalendars.value = await listCalendars(localSettings.value);
      } catch {
        availableCalendars.value = [];
      }
    }

    if (results.length === 0) {
      testResult.value = { success: true, message: 'Authenticated (no apps selected to test)' };
    } else {
      testResult.value = { success: true, message: `Connected — ${results.join(', ')}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    testResult.value = { success: false, message: msg };
  } finally {
    testing.value = false;
  }
}

async function handleSave() {
  try {
    saveGoogleWorkspaceSettings(localSettings.value);

    if (localSettings.value.enabledApps.meet) {
      restartMeetSync();
      meetSyncRunning.value = isMeetSyncRunning();
    } else {
      stopMeetSync();
      meetSyncRunning.value = false;
    }

    if (localSettings.value.enabledApps.calendar) {
      restartCalSync();
      calSyncRunning.value = isCalSyncRunning();
    } else {
      stopCalSync();
      calSyncRunning.value = false;
    }

    emit('activated');

    const toast = await toastController.create({
      message: 'Google Workspace settings saved',
      duration: 2000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const toast = await toastController.create({
      message: `Failed to save: ${msg}`,
      duration: 3000,
      color: 'danger',
      position: 'top',
    });
    await toast.present();
  }
}

async function handleDeactivate() {
  stopMeetSync();
  stopCalSync();
  localSettings.value.token = undefined;
  localSettings.value.credentials.refreshToken = undefined;
  localSettings.value.credentials.userEmail = undefined;
  saveGoogleWorkspaceSettings(localSettings.value);
  meetSyncRunning.value = false;
  calSyncRunning.value = false;
  meetSyncLog.value = [];
  calSyncLog.value = [];
  availableCalendars.value = [];
  signedInScopes.value = '';
  scopeChanged.value = false;
  emit('deactivated');

  const toast = await toastController.create({
    message: 'Google Workspace integration deactivated',
    duration: 2000,
    color: 'warning',
    position: 'top',
  });
  await toast.present();
}

async function handleMeetSyncNow() {
  meetCurrentlySyncing.value = true;
  await meetSyncNow();
  meetCurrentlySyncing.value = isMeetSyncing();
  localSettings.value = loadGoogleWorkspaceSettings();
}

async function handleCalSyncNow() {
  calCurrentlySyncing.value = true;
  await calSyncNow();
  calCurrentlySyncing.value = isCalSyncing();
  localSettings.value = loadGoogleWorkspaceSettings();
}
</script>

<style scoped>
.gws-settings {
  background: var(--hn-bg-surface);
  border: 2px solid var(--hn-border-default);
  border-radius: 16px;
  padding: 28px;
  margin-top: 24px;
}

/* Header */
.gws-header {
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

.gws-icon-wrapper {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #4285F4;
  border-radius: 12px;
}

.gws-icon-wrapper :deep(svg) {
  width: 28px;
  height: 28px;
}

.gws-title {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--hn-text-primary);
}

.gws-subtitle {
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

/* Setup Guide */
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
  font-size: 0.85em;
  color: var(--hn-purple-light);
  word-break: break-all;
}

.guide-steps a {
  color: var(--hn-purple-light);
  text-decoration: underline;
}

.scope-list {
  margin: 8px 0 0 0;
  padding-left: 20px;
  list-style-type: disc;
}

.scope-list li {
  margin-bottom: 4px;
}

/* Sign-in Section */
.sign-in-section {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.connected-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: rgba(0, 200, 83, 0.08);
  border: 1px solid rgba(0, 200, 83, 0.25);
  border-radius: 8px;
}

.connected-icon {
  color: var(--hn-green-light);
  font-size: 1.2rem;
}

.connected-info {
  display: flex;
  flex-direction: column;
}

.connected-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--hn-green-light);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.connected-email {
  font-size: 0.85rem;
  color: var(--hn-text-primary);
}

.btn-google {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: #4285F4;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-google:hover:not(:disabled) {
  background: #3367D6;
  transform: translateY(-1px);
}

.btn-google:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-google ion-icon {
  font-size: 1.1rem;
}

.btn-google ion-spinner {
  width: 18px;
  height: 18px;
}

.scope-change-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--hn-warning, #f5a623);
  font-weight: 500;
}

.scope-change-hint ion-icon {
  font-size: 1rem;
}

/* Apps Grid */
.apps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.app-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--hn-bg-elevated);
  border: 2px solid var(--hn-border-default);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.app-card:hover {
  border-color: var(--hn-border-strong);
}

.app-card.active {
  border-color: var(--hn-purple);
  background: var(--hn-purple-muted);
}

.app-checkbox {
  accent-color: var(--hn-purple);
  width: 16px;
  height: 16px;
  cursor: pointer;
  flex-shrink: 0;
}

.app-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  flex-shrink: 0;
}

.app-icon :deep(svg) {
  width: 22px;
  height: 22px;
}

.meet-icon {
  background: rgba(0, 137, 123, 0.15);
}

.calendar-icon {
  background: rgba(66, 133, 244, 0.15);
}

.app-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.app-name {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--hn-text-primary);
}

.app-desc {
  font-size: 0.78rem;
  color: var(--hn-text-muted);
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

.field-row {
  display: flex;
  gap: 16px;
}

.field-row .field-group {
  flex: 1;
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

/* Calendar Selection */
.calendar-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.calendar-list .calendar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.calendar-item:hover {
  border-color: var(--hn-border-strong);
}

.calendar-checkbox {
  accent-color: var(--hn-purple);
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.calendar-color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.calendar-name {
  font-size: 0.9rem;
  color: var(--hn-text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.primary-badge {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--hn-purple-muted);
  color: var(--hn-purple-light);
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

/* Sync Status */
.sync-status-block {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed var(--hn-border-default);
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
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
.gws-actions {
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
  .gws-settings {
    padding: 20px;
  }

  .status-grid {
    grid-template-columns: 1fr;
  }

  .field-row {
    flex-direction: column;
    gap: 0;
  }

  .apps-grid {
    grid-template-columns: 1fr;
  }

  .gws-actions {
    flex-direction: column;
  }

  .gws-actions .btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
