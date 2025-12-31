<template>
  <ion-popover
    :is-open="isOpen"
    :event="event"
    @didDismiss="$emit('close')"
  >
    <ion-content>
      <ion-list lines="none">
        <!-- Project Actions -->
        <template v-if="targetType === 'project'">
          <ion-item button @click="handleAction('new-file')">
            <ion-icon :icon="addOutline" slot="start" />
            <ion-label>New File</ion-label>
          </ion-item>
          <ion-item button @click="handleAction('delete-project')" class="danger-item">
            <ion-icon :icon="trashOutline" slot="start" />
            <ion-label>Delete Project</ion-label>
          </ion-item>
        </template>

        <!-- Directory Actions -->
        <template v-else-if="targetType === 'directory'">
          <ion-item button @click="handleAction('new-file')">
            <ion-icon :icon="addOutline" slot="start" />
            <ion-label>New File</ion-label>
          </ion-item>
          <ion-item button @click="handleAction('delete-directory')" class="danger-item">
            <ion-icon :icon="trashOutline" slot="start" />
            <ion-label>Delete Directory</ion-label>
          </ion-item>
        </template>

        <!-- File Actions -->
        <template v-else-if="targetType === 'file'">
          <ion-item button @click="handleAction('delete-file')" class="danger-item">
            <ion-icon :icon="trashOutline" slot="start" />
            <ion-label>Delete File</ion-label>
          </ion-item>
        </template>
      </ion-list>
    </ion-content>
  </ion-popover>
</template>

<script setup lang="ts">
import { IonPopover, IonContent, IonList, IonItem, IonIcon, IonLabel } from '@ionic/vue';
import { addOutline, trashOutline } from 'ionicons/icons';
import type { ContextMenuTargetType, ContextMenuAction } from '@/types';

interface Props {
  isOpen: boolean;
  event: MouseEvent | null;
  targetType: ContextMenuTargetType;
  targetId: string;
  targetName: string;
  projectId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'action', action: ContextMenuAction, targetId: string, targetName: string, projectId?: string): void;
}>();

function handleAction(action: ContextMenuAction) {
  emit('action', action, props.targetId, props.targetName, props.projectId);
  emit('close');
}
</script>

<style scoped>
ion-content {
  --background: var(--hn-bg-surface);
}

ion-list {
  background: transparent;
  padding: 4px 0;
}

ion-item {
  --background: transparent;
  --color: var(--hn-text-primary);
  --padding-start: 12px;
  --padding-end: 12px;
  --min-height: 40px;
  font-size: 0.9rem;
  cursor: pointer;
}

ion-item:hover {
  --background: var(--hn-bg-elevated);
}

ion-item ion-icon {
  font-size: 18px;
  color: var(--hn-text-secondary);
  margin-right: 8px;
}

ion-item.danger-item {
  --color: var(--hn-danger);
}

ion-item.danger-item ion-icon {
  color: var(--hn-danger);
}
</style>







