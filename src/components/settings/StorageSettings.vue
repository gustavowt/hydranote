<template>
  <div class="storage-settings">
    <!-- Browser Support Warning -->
    <div v-if="!isFileSystemSupported" class="info-banner warning">
      <ion-icon :icon="alertCircleOutline" />
      <div>
        <strong>Limited Browser Support</strong>
        <p>File System sync is not available in this browser. Use Chrome, Edge, or Opera for full sync capabilities.</p>
      </div>
    </div>

    <div v-else class="config-section">
      <div class="toggle-option">
        <div class="toggle-info">
          <label>Enable File System Sync</label>
          <span class="toggle-hint">Mirror projects and notes to a local folder</span>
        </div>
        <label class="toggle-switch">
          <input 
            type="checkbox" 
            :checked="modelValue.enabled" 
            @change="handleToggle" 
          />
          <span class="slider"></span>
        </label>
      </div>

      <div v-if="modelValue.enabled" class="directory-config">
        <label>{{ compact ? 'Select Sync Directory' : 'Sync Directory' }}</label>
        <div class="directory-picker">
          <div class="directory-display" :class="{ connected: modelValue.rootPath }">
            <ion-icon :icon="modelValue.rootPath ? folderOpenOutline : folderOutline" />
            <span v-if="modelValue.rootPath">{{ modelValue.rootPath }}</span>
            <span v-else class="placeholder">No directory selected</span>
          </div>
          <button 
            class="btn btn-secondary" 
            @click="$emit('select-directory')" 
            :disabled="selectingDirectory"
            type="button"
          >
            <ion-spinner v-if="selectingDirectory" name="crescent" />
            <ion-icon v-else :icon="folderOutline" />
            <span>{{ modelValue.rootPath ? 'Change' : 'Select' }}</span>
          </button>
        </div>

        <div class="sub-options" v-if="modelValue.rootPath">
          <div class="toggle-option small">
            <div class="toggle-info">
              <label>Sync on Save</label>
              <span class="toggle-hint">Auto-sync when you save changes</span>
            </div>
            <label class="toggle-switch small">
              <input 
                type="checkbox" 
                :checked="modelValue.syncOnSave" 
                @change="updateField('syncOnSave', ($event.target as HTMLInputElement).checked)"
              />
              <span class="slider"></span>
            </label>
          </div>
          <div class="toggle-option small">
            <div class="toggle-info">
              <label>Watch for External Changes</label>
              <span class="toggle-hint">Detect files modified outside HydraNote</span>
            </div>
            <label class="toggle-switch small">
              <input 
                type="checkbox" 
                :checked="modelValue.watchForChanges"
                @change="updateField('watchForChanges', ($event.target as HTMLInputElement).checked)"
              />
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div v-if="!modelValue.enabled" class="info-banner">
        <ion-icon :icon="informationCircleOutline" />
        <p>You can enable file sync later in Settings. Your data is always stored safely in the browser.</p>
      </div>

      <!-- Full mode: Additional controls -->
      <template v-if="!compact && modelValue.enabled && modelValue.rootPath">
        <!-- Last Sync Time -->
        <div v-if="modelValue.lastSyncTime" class="last-sync">
          <ion-icon :icon="timeOutline" />
          <span>Last synced: {{ formatLastSyncTime(modelValue.lastSyncTime) }}</span>
        </div>

        <!-- Action Buttons -->
        <div class="action-buttons">
          <button class="btn btn-secondary" @click="$emit('sync-now')" :disabled="syncing" type="button">
            <ion-spinner v-if="syncing" name="crescent" />
            <ion-icon v-else :icon="syncOutline" />
            <span>Sync Now</span>
          </button>
          <button class="btn btn-secondary danger" @click="$emit('disconnect')" type="button">
            <ion-icon :icon="unlinkOutline" />
            <span>Disconnect</span>
          </button>
          <button class="btn btn-primary" @click="$emit('save')" type="button">
            <ion-icon :icon="saveOutline" />
            <span>Save Settings</span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IonIcon, IonSpinner } from '@ionic/vue';
import {
  alertCircleOutline,
  informationCircleOutline,
  folderOutline,
  folderOpenOutline,
  timeOutline,
  syncOutline,
  saveOutline,
} from 'ionicons/icons';
import type { FileSystemSettings } from '@/types';

// Custom unlink icon (not in ionicons)
const unlinkOutline = 'M16.949,14.121L14.12,16.95l-1.414,-1.414l2.829,-2.829l-1.061,-1.061l-2.829,2.829l-1.414,-1.414l2.829,-2.829l-1.061,-1.061l-2.829,2.829l-1.414,-1.414l2.829,-2.829l-2.121,-2.121l-2.829,2.828l-1.414,-1.414l4.243,-4.243c1.562,-1.562 4.095,-1.562 5.657,0c1.562,1.562 1.562,4.095 0,5.657l-1.414,1.414l2.121,2.121l1.414,-1.414c1.562,-1.562 4.095,-1.562 5.657,0c1.562,1.562 1.562,4.095 0,5.657l-4.243,4.243l-1.414,-1.414l2.829,-2.829l-2.122,-2.121Z';

// Props
interface Props {
  modelValue: FileSystemSettings;
  isFileSystemSupported?: boolean;
  compact?: boolean;
  selectingDirectory?: boolean;
  syncing?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isFileSystemSupported: true,
  compact: false,
  selectingDirectory: false,
  syncing: false,
});

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: FileSystemSettings];
  'select-directory': [];
  'sync-now': [];
  'disconnect': [];
  'save': [];
}>();

// Methods
function handleToggle(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  emit('update:modelValue', { ...props.modelValue, enabled });
  
  // If enabling and no path set, trigger directory selection
  if (enabled && !props.modelValue.rootPath) {
    emit('select-directory');
  }
}

function updateField(field: keyof FileSystemSettings, value: boolean | string | number) {
  emit('update:modelValue', { ...props.modelValue, [field]: value });
}

function formatLastSyncTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  
  return date.toLocaleDateString();
}
</script>

<style scoped>
.config-section {
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  border-radius: 12px;
  padding: 24px;
}

/* Toggle Options */
.toggle-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--hn-bg-deep);
  border-radius: 8px;
  margin-bottom: 16px;
}

.toggle-option.small {
  padding: 12px;
  margin-bottom: 12px;
}

.toggle-option:last-child {
  margin-bottom: 0;
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toggle-info label {
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--hn-text-primary);
}

.toggle-hint {
  font-size: 0.8rem;
  color: var(--hn-text-secondary);
}

/* Toggle Switch */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 52px;
  height: 28px;
  flex-shrink: 0;
}

.toggle-switch.small {
  width: 44px;
  height: 24px;
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
  background-color: var(--hn-border-strong);
  transition: 0.3s;
  border-radius: 28px;
}

.toggle-switch .slider:before {
  position: absolute;
  content: "";
  height: 22px;
  width: 22px;
  left: 3px;
  bottom: 3px;
  background-color: var(--hn-text-secondary);
  transition: 0.3s;
  border-radius: 50%;
}

.toggle-switch.small .slider:before {
  height: 18px;
  width: 18px;
}

.toggle-switch input:checked + .slider {
  background-color: var(--hn-purple);
}

.toggle-switch input:checked + .slider:before {
  background-color: #fff;
  transform: translateX(24px);
}

.toggle-switch.small input:checked + .slider:before {
  transform: translateX(20px);
}

/* Directory Picker */
.directory-config {
  margin-top: 16px;
}

.directory-config > label {
  display: block;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--hn-text-primary);
  margin-bottom: 8px;
}

.directory-picker {
  display: flex;
  gap: 12px;
  align-items: stretch;
}

.directory-display {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--hn-bg-deep);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  color: var(--hn-text-secondary);
  font-size: 0.95rem;
  overflow: hidden;
}

.directory-display.connected {
  border-color: var(--hn-green-light);
  background: var(--hn-green-muted);
  color: var(--hn-green-light);
}

.directory-display span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.directory-display .placeholder {
  color: var(--hn-text-muted);
  font-style: italic;
}

.sub-options {
  margin-top: 16px;
  padding-left: 12px;
  border-left: 2px solid var(--hn-border-default);
}

/* Info Banners */
.info-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  background: var(--hn-info-muted);
  border: 1px solid rgba(88, 166, 255, 0.3);
  border-radius: 10px;
  color: var(--hn-info);
  font-size: 0.9rem;
}

.info-banner.warning {
  background: var(--hn-warning-muted);
  border-color: rgba(210, 153, 34, 0.3);
  color: var(--hn-warning);
}

.info-banner ion-icon {
  font-size: 1.3rem;
  flex-shrink: 0;
  margin-top: 2px;
}

.info-banner p {
  margin: 0;
  line-height: 1.5;
}

.info-banner div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-banner strong {
  font-weight: 600;
}

/* Last Sync */
.last-sync {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 12px 16px;
  background: var(--hn-bg-deep);
  border-radius: 8px;
  font-size: 0.9rem;
  color: var(--hn-text-secondary);
}

.last-sync ion-icon {
  color: var(--hn-text-muted);
}

/* Action Buttons */
.action-buttons {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  flex-wrap: wrap;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 24px;
  border: none;
  border-radius: 10px;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn ion-icon {
  font-size: 1.2rem;
}

.btn ion-spinner {
  width: 20px;
  height: 20px;
}

.btn-primary {
  background: linear-gradient(135deg, var(--hn-purple), var(--hn-purple-light));
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.btn-secondary {
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  color: var(--hn-text-primary);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--hn-bg-elevated);
  border-color: var(--hn-border-strong);
}

.btn-secondary.danger {
  border-color: var(--hn-danger);
  color: var(--hn-danger);
}

.btn-secondary.danger:hover:not(:disabled) {
  background: var(--hn-danger-muted);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Responsive */
@media (max-width: 640px) {
  .directory-picker {
    flex-direction: column;
  }
  
  .action-buttons {
    flex-direction: column;
  }
}
</style>
