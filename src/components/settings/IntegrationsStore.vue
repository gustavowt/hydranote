<template>
  <div class="integrations-store">
    <!-- Category Filter -->
    <div class="category-filter">
      <button
        class="filter-chip"
        :class="{ active: activeCategory === 'all' }"
        @click="activeCategory = 'all'"
      >
        All
      </button>
      <button
        v-for="cat in categories"
        :key="cat.id"
        class="filter-chip"
        :class="{ active: activeCategory === cat.id }"
        @click="activeCategory = cat.id"
      >
        {{ cat.label }}
      </button>
    </div>

    <!-- Integration Cards Grid -->
    <div class="integrations-grid">
      <div
        v-for="integration in filteredIntegrations"
        :key="integration.id"
        class="integration-card"
        :class="{ connected: isEnabled(integration.id) }"
      >
        <div class="card-header">
          <div class="integration-icon">
            <component :is="getIconComponent(integration.id)" />
          </div>
          <span class="category-badge" :class="integration.category">
            {{ getCategoryLabel(integration.category) }}
          </span>
        </div>

        <div class="card-body">
          <h3 class="integration-name">{{ integration.name }}</h3>
          <p class="integration-description">{{ integration.description }}</p>
        </div>

        <div class="card-footer">
          <div v-if="isEnabled(integration.id)" class="connected-info">
            <ion-icon :icon="checkmarkCircleOutline" />
            <span>Connected</span>
          </div>

          <button
            v-if="isEnabled(integration.id)"
            class="btn btn-deactivate"
            @click="handleToggle(integration.id, false)"
          >
            Deactivate
          </button>
          <button
            v-else
            class="btn btn-activate"
            @click="handleToggle(integration.id, true)"
          >
            Activate
          </button>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="filteredIntegrations.length === 0" class="empty-state">
      <ion-icon :icon="extensionPuzzleOutline" />
      <span>No integrations found in this category.</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { IonIcon, toastController } from '@ionic/vue';
import {
  checkmarkCircleOutline,
  extensionPuzzleOutline,
} from 'ionicons/icons';
import type { IntegrationSettings, IntegrationId, IntegrationCategory } from '@/types';
import { INTEGRATION_CATALOG } from '@/types';
import {
  GoogleMeetIcon,
  ZoomIcon,
  GoogleCalendarIcon,
} from '@/icons';

const props = defineProps<{
  modelValue: IntegrationSettings;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: IntegrationSettings): void;
  (e: 'toggle', id: IntegrationId, enabled: boolean): void;
}>();

const activeCategory = ref<'all' | IntegrationCategory>('all');

const categories: { id: IntegrationCategory; label: string }[] = [
  { id: 'meetings', label: 'Meetings' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'productivity', label: 'Productivity' },
];

const iconMap: Record<IntegrationId, typeof GoogleMeetIcon> = {
  google_meet: GoogleMeetIcon,
  zoom: ZoomIcon,
  google_calendar: GoogleCalendarIcon,
};

const filteredIntegrations = computed(() => {
  if (activeCategory.value === 'all') return INTEGRATION_CATALOG;
  return INTEGRATION_CATALOG.filter(i => i.category === activeCategory.value);
});

function getIconComponent(id: IntegrationId) {
  return iconMap[id];
}

function getCategoryLabel(cat: IntegrationCategory): string {
  return categories.find(c => c.id === cat)?.label ?? cat;
}

function isEnabled(id: IntegrationId): boolean {
  return props.modelValue[id]?.enabled ?? false;
}

async function handleToggle(id: IntegrationId, enabled: boolean) {
  const updated: IntegrationSettings = {
    ...props.modelValue,
    [id]: {
      ...props.modelValue[id],
      enabled,
      connectedAt: enabled ? new Date().toISOString() : undefined,
    },
  };
  emit('update:modelValue', updated);
  emit('toggle', id, enabled);

  const integration = INTEGRATION_CATALOG.find(i => i.id === id);
  const toast = await toastController.create({
    message: enabled
      ? `${integration?.name} activated`
      : `${integration?.name} deactivated`,
    duration: 2000,
    color: enabled ? 'success' : 'warning',
    position: 'top',
  });
  await toast.present();
}
</script>

<style scoped>
/* Category Filter */
.category-filter {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}

.filter-chip {
  padding: 8px 18px;
  border: 1px solid var(--hn-border-default);
  border-radius: 20px;
  background: var(--hn-bg-surface);
  color: var(--hn-text-secondary);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.filter-chip:hover {
  border-color: var(--hn-border-strong);
  color: var(--hn-text-primary);
}

.filter-chip.active {
  background: var(--hn-purple-muted);
  border-color: var(--hn-purple);
  color: var(--hn-purple-light);
}

/* Integration Cards Grid */
.integrations-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.integration-card {
  display: flex;
  flex-direction: column;
  background: var(--hn-bg-surface);
  border: 2px solid var(--hn-border-default);
  border-radius: 14px;
  padding: 24px;
  transition: all 0.2s ease;
}

.integration-card:hover {
  border-color: var(--hn-border-strong);
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.integration-card.connected {
  border-color: var(--hn-purple);
  background: var(--hn-purple-muted);
}

/* Card Header */
.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.integration-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--hn-bg-elevated);
  border-radius: 12px;
  flex-shrink: 0;
}

.integration-card.connected .integration-icon {
  background: var(--hn-purple);
}

.integration-icon :deep(svg) {
  width: 28px;
  height: 28px;
}

.category-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.category-badge.meetings {
  background: rgba(0, 172, 71, 0.15);
  color: #00AC47;
}

.category-badge.calendar {
  background: rgba(66, 133, 244, 0.15);
  color: #4285F4;
}

.category-badge.productivity {
  background: rgba(255, 152, 0, 0.15);
  color: #FF9800;
}

/* Card Body */
.card-body {
  flex: 1;
  margin-bottom: 20px;
}

.integration-name {
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--hn-text-primary);
  margin: 0 0 8px 0;
}

.integration-description {
  font-size: 0.88rem;
  color: var(--hn-text-secondary);
  margin: 0;
  line-height: 1.5;
}

/* Card Footer */
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--hn-border-default);
}

.connected-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--hn-green-light);
}

.connected-info ion-icon {
  font-size: 1.1rem;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-left: auto;
}

.btn-activate {
  background: linear-gradient(135deg, var(--hn-purple), var(--hn-purple-light));
  color: #ffffff;
}

.btn-activate:hover {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.btn-deactivate {
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  color: var(--hn-text-secondary);
}

.btn-deactivate:hover {
  border-color: var(--hn-danger);
  color: var(--hn-danger);
  background: var(--hn-danger-muted);
}

/* Empty State */
.empty-state {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px;
  background: var(--hn-bg-surface);
  border: 1px dashed var(--hn-border-default);
  border-radius: 12px;
  color: var(--hn-text-muted);
  font-size: 0.9rem;
}

.empty-state ion-icon {
  font-size: 1.5rem;
}

/* Responsive */
@media (max-width: 768px) {
  .integrations-grid {
    grid-template-columns: 1fr;
  }
}
</style>
