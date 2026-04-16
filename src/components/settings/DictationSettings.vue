<template>
  <div class="dictation-settings">
    <!-- Electron-only notice -->
    <div v-if="!isElectronApp" class="info-banner warning">
      <ion-icon :icon="alertCircleOutline" />
      <div>
        <strong>Desktop Only</strong>
        <p>Global push-to-talk dictation requires the Electron desktop app. Cloud transcription still works via the browser.</p>
      </div>
    </div>

    <div class="config-panel">
      <div class="config-fields">
        <!-- Enable Dictation Toggle -->
        <div class="field-group toggle-field">
          <div class="toggle-info">
            <label>Enable Dictation</label>
            <span class="toggle-description">Activate push-to-talk speech-to-text</span>
            <span v-if="isElectronApp" class="toggle-description tray-hint">
              Adds a system tray icon: start dictation, add a note, open chat, or quit the app.
            </span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="settings.enabled" @change="handleSave" />
            <span class="slider"></span>
          </label>
        </div>

        <template v-if="settings.enabled">
          <!-- Keyboard Shortcut -->
          <div class="field-group" v-if="isElectronApp">
            <label>Push-to-Talk Shortcut</label>
            <div class="shortcut-picker">
              <div class="shortcut-display" :class="{ recording: isCapturingShortcut }">
                <kbd v-if="!isCapturingShortcut">{{ formatShortcut(settings.shortcut) }}</kbd>
                <span v-else class="capture-hint">Press a key combination…</span>
              </div>
              <button
                class="btn btn-secondary"
                @click="toggleShortcutCapture"
                type="button"
              >
                {{ isCapturingShortcut ? 'Cancel' : 'Change' }}
              </button>
            </div>
            <span class="field-hint">
              Hold the shortcut to record, release to transcribe.
            </span>
          </div>

          <!-- Floating Indicator Toggle -->
          <div class="field-group toggle-field">
            <div class="toggle-info">
              <label>Show Recording Indicator</label>
              <span class="toggle-description">Display a floating indicator while recording</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" v-model="settings.showFloatingIndicator" @change="handleSave" />
              <span class="slider"></span>
            </label>
          </div>

          <!-- =============================== -->
          <!-- Transcription Provider Selection -->
          <!-- =============================== -->
          <div class="field-group">
            <label>Transcription Provider</label>
            <div class="provider-cards">
              <button
                v-for="p in providers"
                :key="p.id"
                class="provider-card"
                :class="{ selected: settings.provider === p.id }"
                @click="selectProvider(p.id)"
                type="button"
              >
                <div class="provider-header">
                  <ion-icon :icon="p.icon" />
                  <strong>{{ p.name }}</strong>
                </div>
                <span class="provider-desc">{{ p.description }}</span>
              </button>
            </div>
          </div>

          <!-- Provider-specific config -->
          <div class="provider-config">
            <!-- OpenAI Whisper Config -->
            <template v-if="settings.provider === 'openai_whisper'">
              <div class="field-group">
                <label>Model</label>
                <select v-model="settings.providerConfig.openaiWhisper.model" @change="handleSave">
                  <option value="whisper-1">whisper-1</option>
                </select>
                <span class="field-hint">Uses your OpenAI API key from AI Providers settings.</span>
              </div>
              <div class="field-group">
                <label>Language (optional)</label>
                <input
                  type="text"
                  v-model="settings.providerConfig.openaiWhisper.language"
                  placeholder="Auto-detect (or ISO code e.g. en, es, pt)"
                  @blur="handleSave"
                />
              </div>
            </template>

            <!-- Deepgram Config -->
            <template v-if="settings.provider === 'deepgram'">
              <div class="field-group">
                <label>Deepgram API Key</label>
                <div class="api-key-field">
                  <input
                    :type="showDeepgramKey ? 'text' : 'password'"
                    v-model="settings.providerConfig.deepgram.apiKey"
                    placeholder="Enter Deepgram API key"
                    @blur="handleSave"
                  />
                  <button class="btn-icon" @click="showDeepgramKey = !showDeepgramKey" type="button">
                    <ion-icon :icon="showDeepgramKey ? eyeOffOutline : eyeOutline" />
                  </button>
                </div>
                <span class="field-hint">Get your key at <a href="#" @click.prevent="openExternal('https://console.deepgram.com')">console.deepgram.com</a></span>
              </div>
              <div class="field-group">
                <label>Model</label>
                <select v-model="settings.providerConfig.deepgram.model" @change="handleSave">
                  <option value="nova-3">Nova 3 (latest, most accurate)</option>
                  <option value="nova-2">Nova 2</option>
                  <option value="enhanced">Enhanced</option>
                  <option value="base">Base</option>
                </select>
              </div>
              <div class="field-group">
                <label>Language (optional)</label>
                <input
                  type="text"
                  v-model="settings.providerConfig.deepgram.language"
                  placeholder="Auto-detect (or ISO code e.g. en, es, pt)"
                  @blur="handleSave"
                />
              </div>
            </template>

            <!-- =============================== -->
            <!-- Local Whisper — Speech Models    -->
            <!-- =============================== -->
            <template v-if="settings.provider === 'local_whisper'">
              <div v-if="!isElectronApp" class="info-banner warning">
                <ion-icon :icon="alertCircleOutline" />
                <div>Local Whisper requires the Electron desktop app.</div>
              </div>
              <div v-else class="field-group">
                <label>Speech Model</label>
                <span class="field-hint">Download a model before use. Larger models are slower but more accurate.</span>
                <div class="model-table">
                  <div class="model-table-header">
                    <span class="col-radio"></span>
                    <span class="col-name">Model</span>
                    <span class="col-size">Size</span>
                    <span class="col-desc">Best for</span>
                    <span class="col-action">Status</span>
                  </div>
                  <label
                    v-for="m in speechModels"
                    :key="m.id"
                    class="model-row"
                    :class="{ selected: settings.providerConfig.localWhisper.speechModelId === m.id }"
                  >
                    <span class="col-radio">
                      <input
                        type="radio"
                        name="speechModel"
                        :value="m.id"
                        v-model="settings.providerConfig.localWhisper.speechModelId"
                        @change="handleSave"
                      />
                    </span>
                    <span class="col-name">{{ m.name }}</span>
                    <span class="col-size">{{ m.size }}</span>
                    <span class="col-desc">{{ m.description }}</span>
                    <span class="col-action" @click.prevent.stop>
                      <template v-if="downloadingModelId === m.id">
                        <div v-if="downloadPhase === 'loading'" class="model-loading-status">
                          <ion-spinner name="crescent" class="loading-spinner" />
                          <span class="loading-text">Initializing…</span>
                        </div>
                        <div v-else class="model-download-progress">
                          <div class="progress-bar-track">
                            <div class="progress-bar-fill" :style="{ width: downloadProgress + '%' }"></div>
                          </div>
                          <span class="progress-text">{{ downloadProgress }}%</span>
                        </div>
                      </template>
                      <template v-else-if="modelStatuses[m.id]">
                        <span class="model-status downloaded">
                          <ion-icon :icon="checkmarkCircleOutline" />
                          Ready
                        </span>
                        <button
                          class="btn-icon btn-delete-model"
                          @click.prevent.stop="deleteWhisperModel(m.id)"
                          title="Delete model"
                          type="button"
                        >
                          <ion-icon :icon="trashOutline" />
                        </button>
                      </template>
                      <template v-else>
                        <button
                          class="btn btn-sm btn-download"
                          @click.prevent.stop="downloadWhisperModel(m.id)"
                          type="button"
                        >
                          <ion-icon :icon="downloadOutline" />
                          Download
                        </button>
                      </template>
                    </span>
                  </label>
                </div>
              </div>
            </template>
          </div>

          <!-- =============================== -->
          <!-- Cleanup (LLM Post-Processing)   -->
          <!-- =============================== -->
          <div class="section-divider"></div>

          <div class="field-group toggle-field">
            <div class="toggle-info">
              <label>Cleanup with AI</label>
              <span class="toggle-description">Fix grammar, remove filler words, and clean up transcriptions using your configured LLM</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" v-model="settings.cleanup.enabled" @change="handleSave" />
              <span class="slider"></span>
            </label>
          </div>

          <div v-if="settings.cleanup.enabled" class="field-group">
            <label>Cleanup Instructions</label>
            <textarea
              v-model="settings.cleanup.instructions"
              placeholder="Instructions for the LLM to clean up the transcription..."
              rows="3"
              @blur="handleSave"
            />
            <span class="field-hint">Uses your configured AI provider (OpenAI, Anthropic, etc.) to process the raw transcription before pipeline actions.</span>
          </div>

          <!-- =============================== -->
          <!-- Pipeline Actions                -->
          <!-- =============================== -->
          <div class="section-divider"></div>

          <div class="field-group">
            <label>Pipeline Actions</label>
            <span class="field-hint pipeline-hint">Choose what happens after transcription (and optional cleanup). Enable multiple actions to build a pipeline.</span>
            <div class="pipeline-actions">
              <div
                v-for="action in settings.pipeline"
                :key="action.type"
                class="pipeline-action"
                :class="{ enabled: action.enabled }"
              >
                <label class="toggle-switch small">
                  <input type="checkbox" v-model="action.enabled" @change="handleSave" />
                  <span class="slider"></span>
                </label>
                <div class="action-info">
                  <ion-icon :icon="getActionIcon(action.type)" />
                  <span class="action-label">{{ action.label }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Status -->
    <div v-if="statusMessage" :class="['connection-status', statusMessage.success ? 'success' : 'error']">
      <ion-icon :icon="statusMessage.success ? checkmarkCircleOutline : closeCircleOutline" />
      <span>{{ statusMessage.message }}</span>
    </div>

    <!-- Test Button -->
    <div v-if="settings.enabled" class="action-buttons">
      <button class="btn btn-secondary" @click="testDictation" :disabled="testing" type="button">
        <ion-spinner v-if="testing" name="crescent" />
        <ion-icon v-else :icon="micOutline" />
        <span>Test Microphone</span>
      </button>
      <button class="btn btn-primary" @click="handleSave" type="button">
        <ion-icon :icon="saveOutline" />
        <span>Save Settings</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { IonIcon, IonSpinner } from '@ionic/vue';
import {
  alertCircleOutline,
  eyeOutline,
  eyeOffOutline,
  micOutline,
  saveOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  cloudUploadOutline,
  desktopOutline,
  createOutline,
  chatbubbleOutline,
  clipboardOutline,
  documentTextOutline,
  downloadOutline,
  trashOutline,
} from 'ionicons/icons';
import type { DictationSettings, TranscriptionProvider, DictationPipelineActionType } from '@/types';
import {
  DEFAULT_DICTATION_SETTINGS,
  DEFAULT_DICTATION_PIPELINE,
  DEFAULT_TRANSCRIPTION_PROVIDER_CONFIG,
  DEFAULT_CLEANUP_CONFIG,
  LOCAL_SPEECH_MODELS,
} from '@/types';
import { loadDictationSettings, saveDictationSettings } from '@/services/dictationSettingsService';

const isElectronApp = !!window.electronAPI;

const settings = ref<DictationSettings>({
  ...DEFAULT_DICTATION_SETTINGS,
  pipeline: [...DEFAULT_DICTATION_PIPELINE],
  providerConfig: { ...DEFAULT_TRANSCRIPTION_PROVIDER_CONFIG },
  cleanup: { ...DEFAULT_CLEANUP_CONFIG },
});

const showDeepgramKey = ref(false);
const isCapturingShortcut = ref(false);
const testing = ref(false);
const statusMessage = ref<{ success: boolean; message: string } | null>(null);

const speechModels = LOCAL_SPEECH_MODELS;
const modelStatuses = ref<Record<string, boolean>>({});
const downloadingModelId = ref<string | null>(null);
const downloadProgress = ref(0);
const downloadPhase = ref<'downloading' | 'loading'>('downloading');

const providers = [
  {
    id: 'openai_whisper' as TranscriptionProvider,
    name: 'OpenAI Whisper',
    description: 'Cloud-based, high accuracy, many languages',
    icon: cloudUploadOutline,
  },
  {
    id: 'deepgram' as TranscriptionProvider,
    name: 'Deepgram',
    description: 'Fast cloud transcription, competitive pricing',
    icon: cloudUploadOutline,
  },
  {
    id: 'local_whisper' as TranscriptionProvider,
    name: 'Local Whisper',
    description: 'Offline, runs on your machine via Transformers.js',
    icon: desktopOutline,
  },
];

function getActionIcon(type: DictationPipelineActionType) {
  switch (type) {
    case 'insert_at_cursor': return createOutline;
    case 'create_note': return documentTextOutline;
    case 'send_to_chat': return chatbubbleOutline;
    case 'copy_to_clipboard': return clipboardOutline;
  }
}

function formatShortcut(accelerator: string): string {
  const isMac = navigator.platform.includes('Mac');
  return accelerator
    .replace('CommandOrControl', isMac ? '⌘' : 'Ctrl')
    .replace('Command', '⌘')
    .replace('Control', 'Ctrl')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .replace(/\+/g, ' + ');
}

function selectProvider(id: TranscriptionProvider) {
  settings.value.provider = id;
  handleSave();
}

async function handleSave() {
  saveDictationSettings(settings.value);

  if (isElectronApp && settings.value.enabled && window.electronAPI) {
    const result = await window.electronAPI.dictation.registerShortcut(settings.value.shortcut);
    if (!result.success) {
      statusMessage.value = { success: false, message: `Shortcut error: ${result.error}` };
      return;
    }
  }

  statusMessage.value = { success: true, message: 'Dictation settings saved.' };
  setTimeout(() => { statusMessage.value = null; }, 3000);
}

let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

function toggleShortcutCapture() {
  if (isCapturingShortcut.value) {
    stopCapture();
  } else {
    startCapture();
  }
}

function startCapture() {
  isCapturingShortcut.value = true;
  keydownHandler = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;

    const parts: string[] = [];
    if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    let key = e.key;
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    parts.push(key);

    settings.value.shortcut = parts.join('+');
    stopCapture();
    handleSave();
  };
  window.addEventListener('keydown', keydownHandler, { capture: true });
}

function stopCapture() {
  isCapturingShortcut.value = false;
  if (keydownHandler) {
    window.removeEventListener('keydown', keydownHandler, { capture: true });
    keydownHandler = null;
  }
}

async function testDictation() {
  testing.value = true;
  statusMessage.value = null;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    statusMessage.value = { success: true, message: 'Microphone access granted. Ready to dictate!' };
  } catch (err) {
    statusMessage.value = {
      success: false,
      message: `Microphone error: ${err instanceof Error ? err.message : 'Access denied'}`,
    };
  } finally {
    testing.value = false;
  }
}

function openExternal(url: string) {
  if (isElectronApp && window.electronAPI) {
    window.electronAPI.shell.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

async function loadModelStatuses() {
  if (!isElectronApp || !window.electronAPI?.dictation?.getModelStatuses) return;
  try {
    const result = await window.electronAPI.dictation.getModelStatuses();
    if (result.success && result.statuses) {
      modelStatuses.value = result.statuses;
    }
  } catch { /* ignore */ }
}

function handleWhisperStatus(status: { status: string; speechModelId: string; progress?: number }) {
  if (status.status === 'downloading') {
    downloadingModelId.value = status.speechModelId;
    downloadProgress.value = status.progress ?? 0;
    downloadPhase.value = 'downloading';
  } else if (status.status === 'loading') {
    downloadingModelId.value = status.speechModelId;
    downloadPhase.value = 'loading';
  } else if (status.status === 'ready') {
    downloadingModelId.value = null;
    downloadProgress.value = 0;
    downloadPhase.value = 'downloading';
    modelStatuses.value[status.speechModelId] = true;
  } else if (status.status === 'error') {
    downloadingModelId.value = null;
    downloadProgress.value = 0;
    downloadPhase.value = 'downloading';
  }
}

async function downloadWhisperModel(speechModelId: string) {
  if (!window.electronAPI?.dictation?.downloadModel) return;
  downloadingModelId.value = speechModelId;
  downloadProgress.value = 0;
  downloadPhase.value = 'downloading';

  try {
    const result = await window.electronAPI.dictation.downloadModel(speechModelId);
    if (!result.success) {
      statusMessage.value = { success: false, message: `Download failed: ${result.error}` };
      setTimeout(() => { statusMessage.value = null; }, 5000);
    }
  } catch (err) {
    statusMessage.value = { success: false, message: `Download failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
    setTimeout(() => { statusMessage.value = null; }, 5000);
  } finally {
    downloadingModelId.value = null;
    downloadProgress.value = 0;
    await loadModelStatuses();
  }
}

async function deleteWhisperModel(speechModelId: string) {
  if (!window.electronAPI?.dictation?.deleteModel) return;
  try {
    const result = await window.electronAPI.dictation.deleteModel(speechModelId);
    if (result.success) {
      modelStatuses.value[speechModelId] = false;
      statusMessage.value = { success: true, message: 'Model deleted.' };
    } else {
      statusMessage.value = { success: false, message: `Delete failed: ${result.error}` };
    }
    setTimeout(() => { statusMessage.value = null; }, 3000);
  } catch { /* ignore */ }
}

onMounted(() => {
  settings.value = loadDictationSettings();
  loadModelStatuses();

  if (isElectronApp && window.electronAPI?.dictation?.onWhisperStatus) {
    window.electronAPI.dictation.onWhisperStatus(handleWhisperStatus);
  }
});

onUnmounted(() => {
  stopCapture();
  if (isElectronApp && window.electronAPI?.dictation?.offWhisperStatus) {
    window.electronAPI.dictation.offWhisperStatus();
  }
});
</script>

<style scoped>
.dictation-settings {
  max-width: 640px;
}

.info-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  margin-bottom: 20px;
  font-size: 0.9rem;
}

.info-banner.warning {
  background: rgba(var(--ion-color-warning-rgb, 255, 196, 9), 0.12);
  color: var(--ion-color-warning-shade, #e0ac08);
}

.info-banner ion-icon {
  font-size: 1.3rem;
  flex-shrink: 0;
  margin-top: 2px;
}

.info-banner p {
  margin: 4px 0 0;
  opacity: 0.85;
}

.config-panel {
  background: var(--ion-card-background, #1c1c1e);
  border-radius: 12px;
  padding: 20px;
}

.config-fields {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-group > label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ion-text-color, #fff);
  opacity: 0.9;
}

.field-group input[type="text"],
.field-group input[type="password"],
.field-group select,
.field-group textarea {
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--ion-text-color, #fff);
  font-size: 0.9rem;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
}

.field-group input:focus,
.field-group select:focus,
.field-group textarea:focus {
  border-color: var(--ion-color-primary, #4d8dff);
}

.field-group textarea {
  resize: vertical;
  min-height: 48px;
}

.field-hint {
  font-size: 0.78rem;
  color: var(--ion-text-color, #fff);
  opacity: 0.5;
}

.field-hint a {
  color: var(--ion-color-primary, #4d8dff);
  text-decoration: none;
}

.toggle-field {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggle-info label {
  font-size: 0.9rem;
  font-weight: 600;
}

.toggle-description {
  font-size: 0.78rem;
  opacity: 0.5;
}

.toggle-description.tray-hint {
  margin-top: 4px;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}

.toggle-switch.small {
  width: 36px;
  height: 20px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-switch .slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: rgba(255, 255, 255, 0.15);
  transition: 0.3s;
  border-radius: 24px;
}

.toggle-switch .slider::before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background: white;
  transition: 0.3s;
  border-radius: 50%;
}

.toggle-switch.small .slider::before {
  height: 14px;
  width: 14px;
}

.toggle-switch input:checked + .slider {
  background-color: var(--ion-color-primary, #4d8dff);
}

.toggle-switch input:checked + .slider::before {
  transform: translateX(20px);
}

.toggle-switch.small input:checked + .slider::before {
  transform: translateX(16px);
}

/* Provider cards */
.provider-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px;
}

.provider-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
  color: var(--ion-text-color, #fff);
}

.provider-card:hover {
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.07);
}

.provider-card.selected {
  border-color: var(--ion-color-primary, #4d8dff);
  background: rgba(var(--ion-color-primary-rgb, 77, 141, 255), 0.12);
}

.provider-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.provider-header ion-icon {
  font-size: 1.1rem;
  color: var(--ion-color-primary, #4d8dff);
}

.provider-header strong {
  font-size: 0.88rem;
}

.provider-desc {
  font-size: 0.75rem;
  opacity: 0.55;
  line-height: 1.3;
}

.provider-config {
  padding-left: 0;
}

/* Speech model table */
.model-table {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  overflow: hidden;
  margin-top: 6px;
}

.model-table-header {
  display: grid;
  grid-template-columns: 32px 1fr 70px 1fr 120px;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.5;
}

.model-row {
  display: grid;
  grid-template-columns: 32px 1fr 70px 1fr 120px;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: background 0.15s;
  align-items: center;
  font-size: 0.85rem;
}

.model-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.model-row.selected {
  background: rgba(var(--ion-color-primary-rgb, 77, 141, 255), 0.08);
}

.model-row input[type="radio"] {
  accent-color: var(--ion-color-primary, #4d8dff);
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.col-radio {
  display: flex;
  align-items: center;
  justify-content: center;
}

.col-name {
  font-weight: 500;
}

.col-size {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.78rem;
  opacity: 0.7;
}

.col-desc {
  font-size: 0.78rem;
  opacity: 0.55;
}

.col-action {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}

.model-status.downloaded {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--ion-color-success, #2dd36f);
}

.model-status.downloaded ion-icon {
  font-size: 0.9rem;
}

.btn-sm {
  padding: 5px 10px;
  font-size: 0.75rem;
  border-radius: 6px;
}

.btn-download {
  background: var(--ion-color-primary, #4d8dff);
  color: white;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  transition: filter 0.2s;
}

.btn-download:hover {
  filter: brightness(1.15);
}

.btn-download ion-icon {
  font-size: 0.85rem;
}

.btn-delete-model {
  color: var(--ion-text-color, #fff);
  opacity: 0.35;
  padding: 4px;
  font-size: 0.85rem;
}

.btn-delete-model:hover {
  opacity: 0.8;
  color: var(--ion-color-danger, #eb445a);
}

.model-download-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.progress-bar-track {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--ion-color-primary, #4d8dff);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.72rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  opacity: 0.7;
  min-width: 30px;
  text-align: right;
}

.model-loading-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.loading-spinner {
  width: 14px;
  height: 14px;
  color: var(--ion-color-primary, #4d8dff);
}

.loading-text {
  font-size: 0.75rem;
  color: var(--ion-color-primary, #4d8dff);
  font-weight: 500;
}

/* Section divider */
.section-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 4px 0;
}

/* Shortcut picker */
.shortcut-picker {
  display: flex;
  align-items: center;
  gap: 10px;
}

.shortcut-display {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.9rem;
}

.shortcut-display.recording {
  border-color: var(--ion-color-primary, #4d8dff);
  animation: pulse-border 1.5s infinite;
}

@keyframes pulse-border {
  0%, 100% { border-color: var(--ion-color-primary, #4d8dff); }
  50% { border-color: rgba(var(--ion-color-primary-rgb, 77, 141, 255), 0.4); }
}

.shortcut-display kbd {
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.85rem;
}

.capture-hint {
  opacity: 0.6;
  font-style: italic;
  font-size: 0.85rem;
}

/* API key field */
.api-key-field {
  display: flex;
  gap: 8px;
  align-items: center;
}

.api-key-field input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--ion-text-color, #fff);
  font-size: 0.9rem;
  outline: none;
}

.api-key-field input:focus {
  border-color: var(--ion-color-primary, #4d8dff);
}

.btn-icon {
  background: none;
  border: none;
  color: var(--ion-text-color, #fff);
  opacity: 0.5;
  cursor: pointer;
  padding: 6px;
  font-size: 1.1rem;
  display: flex;
  align-items: center;
}

.btn-icon:hover {
  opacity: 0.8;
}

/* Pipeline actions */
.pipeline-hint {
  margin-bottom: 6px;
}

.pipeline-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pipeline-action {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  transition: all 0.2s;
}

.pipeline-action.enabled {
  border-color: rgba(var(--ion-color-primary-rgb, 77, 141, 255), 0.3);
  background: rgba(var(--ion-color-primary-rgb, 77, 141, 255), 0.06);
}

.action-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-info ion-icon {
  font-size: 1rem;
  opacity: 0.7;
}

.action-label {
  font-size: 0.88rem;
  font-weight: 500;
}

/* Status + buttons */
.connection-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 8px;
  margin-top: 16px;
  font-size: 0.85rem;
}

.connection-status.success {
  background: rgba(var(--ion-color-success-rgb, 45, 211, 111), 0.12);
  color: var(--ion-color-success, #2dd36f);
}

.connection-status.error {
  background: rgba(var(--ion-color-danger-rgb, 235, 68, 90), 0.12);
  color: var(--ion-color-danger, #eb445a);
}

.action-buttons {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--ion-color-primary, #4d8dff);
  color: white;
}

.btn-primary:hover {
  filter: brightness(1.1);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: var(--ion-text-color, #fff);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.12);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
