<template>
  <Teleport to="body">
    <div class="date-popover-overlay" @click.self="$emit('close')">
      <div
        class="date-popover"
        ref="popoverRef"
        :style="popoverStyle"
      >
        <!-- Header -->
        <div class="popover-header">
          <div class="popover-date-info">
            <span class="popover-date-label" :class="type">
              {{ type === 'deadline' ? 'Deadline' : 'Date' }}
            </span>
            <span class="popover-date-value">{{ formattedDate }}</span>
            <span class="popover-relative" :class="relativeClass">{{ relativeTime }}</span>
          </div>
          <button class="popover-close" @click="$emit('close')">
            <ion-icon :icon="closeOutline" />
          </button>
        </div>

        <!-- Calendar Events -->
        <div class="popover-section" v-if="loadingEvents || events.length > 0">
          <div class="section-title">
            <ion-icon :icon="calendarOutline" />
            <span>Calendar Events</span>
          </div>
          <div v-if="loadingEvents" class="loading-indicator">
            <ion-spinner name="crescent" />
          </div>
          <div v-else class="events-list">
            <div v-for="ev in events" :key="ev.id" class="event-card">
              <div class="event-time">
                {{ ev.allDay ? 'All day' : formatEventTime(ev.startTime) }}
              </div>
              <div class="event-details">
                <span class="event-title">{{ ev.summary || 'Untitled' }}</span>
                <span v-if="ev.location" class="event-location">
                  <ion-icon :icon="locationOutline" />
                  {{ ev.location }}
                </span>
                <a v-if="ev.hangoutLink" :href="ev.hangoutLink" target="_blank" class="event-meet-link" @click.stop>
                  <ion-icon :icon="videocamOutline" />
                  Join Meet
                </a>
              </div>
            </div>
          </div>
        </div>

        <div v-if="!loadingEvents && events.length === 0" class="popover-section empty-events">
          <ion-icon :icon="calendarClearOutline" />
          <span>No calendar events on this date</span>
        </div>

        <!-- Create Event -->
        <div class="popover-section" v-if="calendarEnabled">
          <div v-if="!showCreateForm">
            <button class="btn-create-event" @click="initCreateEvent">
              <ion-icon :icon="addCircleOutline" />
              <span>Create Event</span>
            </button>
          </div>

          <div v-else class="create-event-form">
            <div class="form-field">
              <label>Title</label>
              <input
                v-model="newEvent.title"
                type="text"
                class="form-input"
                placeholder="Event title..."
                :disabled="creatingEvent"
              />
            </div>
            <div class="form-row">
              <div class="form-field">
                <label>Start</label>
                <input
                  v-model="newEvent.startTime"
                  type="datetime-local"
                  class="form-input"
                  :disabled="creatingEvent"
                />
              </div>
              <div class="form-field">
                <label>End</label>
                <input
                  v-model="newEvent.endTime"
                  type="datetime-local"
                  class="form-input"
                  :disabled="creatingEvent"
                />
              </div>
            </div>
            <div class="form-field">
              <label>Description</label>
              <textarea
                v-model="newEvent.description"
                class="form-input form-textarea"
                placeholder="Optional description..."
                rows="2"
                :disabled="creatingEvent"
              ></textarea>
            </div>
            <div class="form-actions">
              <button class="btn-cancel" @click="showCreateForm = false" :disabled="creatingEvent">
                Cancel
              </button>
              <button
                class="btn-confirm"
                @click="handleCreateEvent"
                :disabled="!newEvent.title.trim() || creatingEvent"
              >
                <ion-spinner v-if="creatingEvent" name="crescent" />
                <ion-icon v-else :icon="checkmarkOutline" />
                <span>Create</span>
              </button>
            </div>
            <div v-if="createError" class="form-error">{{ createError }}</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { IonIcon, IonSpinner, toastController } from '@ionic/vue';
import {
  closeOutline,
  calendarOutline,
  calendarClearOutline,
  locationOutline,
  videocamOutline,
  addCircleOutline,
  checkmarkOutline,
} from 'ionicons/icons';
import { getCalendarEventsForDate, upsertCalendarEvent } from '@/services/database';
import { createEvent as createCalendarEvent } from '@/services/googleCalendarService';
import { isGoogleAppEnabled } from '@/services/integrationService';
import { formatDetectedDate, getRelativeTime } from '@/services/dateDetectionService';
import { chatCompletion, isConfigured } from '@/services/llmService';
import type { DBCalendarEvent } from '@/services/database';

const props = defineProps<{
  date: string;
  type: string;
  originalText: string;
  context: string;
  anchorRect: DOMRect | null;
}>();

defineEmits<{
  (e: 'close'): void;
}>();

const popoverRef = ref<HTMLElement | null>(null);
const events = ref<DBCalendarEvent[]>([]);
const loadingEvents = ref(true);
const showCreateForm = ref(false);
const creatingEvent = ref(false);
const createError = ref('');

const newEvent = ref({
  title: '',
  startTime: '',
  endTime: '',
  description: '',
});

const parsedDate = computed(() => new Date(props.date + 'T00:00:00'));
const formattedDate = computed(() => formatDetectedDate(parsedDate.value));
const relativeTime = computed(() => getRelativeTime(parsedDate.value));

const relativeClass = computed(() => {
  if (props.type === 'deadline') {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(parsedDate.value);
    target.setHours(0, 0, 0, 0);
    if (target < now) return 'overdue';
    const diff = (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (diff <= 2) return 'urgent';
  }
  return '';
});

const calendarEnabled = computed(() => isGoogleAppEnabled('calendar'));

const popoverStyle = computed(() => {
  if (!props.anchorRect) return {};

  const top = props.anchorRect.bottom + 8;
  let left = props.anchorRect.left;

  const popoverWidth = 380;
  if (left + popoverWidth > window.innerWidth - 16) {
    left = window.innerWidth - popoverWidth - 16;
  }
  if (left < 16) left = 16;

  const maxTop = window.innerHeight - 480;
  const finalTop = Math.min(top, maxTop);

  return {
    position: 'fixed' as const,
    top: `${finalTop}px`,
    left: `${left}px`,
    width: `${popoverWidth}px`,
  };
});

onMounted(async () => {
  try {
    events.value = await getCalendarEventsForDate(parsedDate.value);
  } catch {
    events.value = [];
  } finally {
    loadingEvents.value = false;
  }
});

function formatEventTime(date: Date): string {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function toLocalDateTimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function initCreateEvent() {
  showCreateForm.value = true;
  createError.value = '';

  const d = parsedDate.value;
  const start = new Date(d);
  start.setHours(9, 0, 0, 0);
  const end = new Date(d);
  end.setHours(10, 0, 0, 0);

  newEvent.value = {
    title: '',
    startTime: toLocalDateTimeString(start),
    endTime: toLocalDateTimeString(end),
    description: '',
  };

  if (props.context && isConfigured()) {
    try {
      const resp = await chatCompletion({
        messages: [
          {
            role: 'system' as const,
            content: 'Extract a short event title (max 8 words) from the context. Reply with ONLY the title, nothing else.',
          },
          {
            role: 'user' as const,
            content: `Context from a note mentioning "${props.originalText}":\n\n${props.context}`,
          },
        ],
        temperature: 0.3,
        maxTokens: 50,
      });
      const suggested = resp?.content?.trim();
      if (suggested && suggested.length < 100) {
        newEvent.value.title = suggested;
      }
    } catch {
      // AI suggestion is optional
    }
  }
}

async function handleCreateEvent() {
  if (!newEvent.value.title.trim()) return;
  creatingEvent.value = true;
  createError.value = '';

  try {
    const startDt = new Date(newEvent.value.startTime);
    const endDt = new Date(newEvent.value.endTime);

    const created = await createCalendarEvent('primary', {
      summary: newEvent.value.title,
      start: { dateTime: startDt.toISOString() },
      end: { dateTime: endDt.toISOString() },
      description: newEvent.value.description || undefined,
    });

    if (created.id) {
      await upsertCalendarEvent({
        id: crypto.randomUUID(),
        googleEventId: created.id,
        calendarId: 'primary',
        summary: created.summary,
        description: created.description,
        location: created.location,
        startTime: startDt,
        endTime: endDt,
        allDay: false,
        attendees: created.attendees ? JSON.stringify(created.attendees) : undefined,
        hangoutLink: created.hangoutLink,
        htmlLink: created.htmlLink,
        status: created.status,
        syncedAt: new Date(),
      });

      events.value = await getCalendarEventsForDate(parsedDate.value);
    }

    showCreateForm.value = false;

    const toast = await toastController.create({
      message: `Event "${newEvent.value.title}" created`,
      duration: 2000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
  } catch (err) {
    createError.value = err instanceof Error ? err.message : String(err);
  } finally {
    creatingEvent.value = false;
  }
}
</script>

<style scoped>
.date-popover-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.2);
}

.date-popover {
  background: var(--hn-bg-surface, #1a1a2e);
  border: 1px solid var(--hn-border-default, #2a2a4a);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04);
  overflow: hidden;
  max-height: 460px;
  overflow-y: auto;
}

.popover-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--hn-border-default, #2a2a4a);
}

.popover-date-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.popover-date-label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #7aafff;
}

.popover-date-label.deadline {
  color: #fbbf24;
}

.popover-date-value {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--hn-text-primary, #e0e0e0);
}

.popover-relative {
  font-size: 0.78rem;
  color: var(--hn-text-muted, #888);
}

.popover-relative.overdue {
  color: #f87171;
  font-weight: 600;
}

.popover-relative.urgent {
  color: #fbbf24;
  font-weight: 600;
}

.popover-close {
  background: none;
  border: none;
  color: var(--hn-text-muted, #888);
  cursor: pointer;
  padding: 4px;
  display: flex;
  font-size: 1.2rem;
  border-radius: 6px;
  transition: all 0.15s;
}

.popover-close:hover {
  color: var(--hn-text-primary, #e0e0e0);
  background: var(--hn-bg-elevated, #222244);
}

.popover-section {
  padding: 12px 18px;
  border-bottom: 1px solid var(--hn-border-default, #2a2a4a);
}

.popover-section:last-child {
  border-bottom: none;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--hn-text-muted, #888);
  margin-bottom: 10px;
}

.section-title ion-icon {
  font-size: 0.9rem;
}

.loading-indicator {
  display: flex;
  justify-content: center;
  padding: 12px 0;
}

.loading-indicator ion-spinner {
  width: 22px;
  height: 22px;
  color: var(--hn-text-muted, #888);
}

.empty-events {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--hn-text-muted, #888);
  font-size: 0.82rem;
}

.empty-events ion-icon {
  font-size: 1rem;
}

.events-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.event-card {
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  background: var(--hn-bg-elevated, #222244);
  border-radius: 8px;
  border: 1px solid var(--hn-border-default, #2a2a4a);
}

.event-time {
  font-size: 0.78rem;
  font-weight: 600;
  color: #7aafff;
  white-space: nowrap;
  min-width: 60px;
  padding-top: 1px;
}

.event-details {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.event-title {
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--hn-text-primary, #e0e0e0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-location {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--hn-text-muted, #888);
}

.event-location ion-icon {
  font-size: 0.85rem;
}

.event-meet-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--hn-teal, #14b8a6);
  text-decoration: none;
}

.event-meet-link:hover {
  text-decoration: underline;
}

.event-meet-link ion-icon {
  font-size: 0.85rem;
}

.btn-create-event {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 10px 14px;
  background: var(--hn-bg-elevated, #222244);
  border: 1px dashed var(--hn-border-default, #2a2a4a);
  border-radius: 8px;
  color: var(--hn-purple-light, #a78bfa);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-create-event:hover {
  border-color: var(--hn-purple-light, #a78bfa);
  background: rgba(167, 139, 250, 0.08);
}

.btn-create-event ion-icon {
  font-size: 1.1rem;
}

.create-event-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-field label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--hn-text-muted, #888);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.form-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  background: var(--hn-bg-elevated, #222244);
  border: 1px solid var(--hn-border-default, #2a2a4a);
  border-radius: 6px;
  color: var(--hn-text-primary, #e0e0e0);
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
}

.form-input:focus {
  border-color: var(--hn-purple, #7c3aed);
}

.form-textarea {
  resize: vertical;
  min-height: 48px;
}

.form-row {
  display: flex;
  gap: 10px;
}

.form-row .form-field {
  flex: 1;
  min-width: 0;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.btn-cancel {
  padding: 7px 14px;
  background: none;
  border: 1px solid var(--hn-border-default, #2a2a4a);
  border-radius: 6px;
  color: var(--hn-text-secondary, #aaa);
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-cancel:hover:not(:disabled) {
  border-color: var(--hn-border-strong);
  color: var(--hn-text-primary, #e0e0e0);
}

.btn-confirm {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  background: linear-gradient(135deg, var(--hn-purple, #7c3aed), var(--hn-purple-light, #a78bfa));
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-confirm:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-confirm ion-icon {
  font-size: 0.95rem;
}

.btn-confirm ion-spinner {
  width: 14px;
  height: 14px;
}

.form-error {
  font-size: 0.78rem;
  color: var(--hn-danger, #ef4444);
  padding: 4px 0;
}

.btn-cancel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.date-popover::-webkit-scrollbar {
  width: 6px;
}

.date-popover::-webkit-scrollbar-track {
  background: transparent;
}

.date-popover::-webkit-scrollbar-thumb {
  background: var(--hn-border-default, #2a2a4a);
  border-radius: 3px;
}
</style>
