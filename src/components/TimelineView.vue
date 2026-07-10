<template>
  <div class="timeline-container">
    <!-- Timeline Header -->
    <div class="timeline-header">
      <div class="timeline-title-row">
        <div class="timeline-title">
          <ion-icon :icon="timeOutline" />
          <span>Timeline</span>
        </div>
        <div class="timeline-controls">
          <button class="tl-btn" @click="jumpToToday">Today</button>
          <label class="tl-toggle">
            <input type="checkbox" v-model="deadlinesOnly" />
            <span>Deadlines only</span>
          </label>
          <label class="tl-toggle">
            <input type="checkbox" v-model="showEmptyDays" />
            <span>Show empty days</span>
          </label>
          <button class="tl-btn icon-btn" @click="$emit('close')">
            <ion-icon :icon="closeOutline" />
          </button>
        </div>
      </div>

      <!-- Date Navigation -->
      <div class="date-nav">
        <button class="nav-arrow" @click="shiftRange(-7)">
          <ion-icon :icon="chevronBackOutline" />
        </button>
        <div class="date-range-display">
          <input type="date" v-model="rangeStartStr" class="date-input" @change="onRangeChange" />
          <span class="date-separator">to</span>
          <input type="date" v-model="rangeEndStr" class="date-input" @change="onRangeChange" />
        </div>
        <button class="nav-arrow" @click="shiftRange(7)">
          <ion-icon :icon="chevronForwardOutline" />
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="timeline-loading">
      <ion-spinner name="crescent" />
      <span>{{ loadingMessage }}</span>
    </div>

    <!-- Timeline Body -->
    <div v-else class="timeline-body" ref="timelineBodyRef">
      <div
        v-for="day in visibleDays"
        :key="day.dateStr"
        class="timeline-day"
        :class="{
          today: day.isToday,
          'has-content': day.events.length > 0 || day.noteRefs.length > 0,
          'has-deadlines': day.hasDeadline,
        }"
        :id="'day-' + day.dateStr"
      >
        <!-- Date Marker -->
        <div class="day-marker">
          <div class="day-dot" />
          <div class="day-date">
            <span class="day-weekday">{{ day.weekday }}</span>
            <span class="day-number">{{ day.dayNumber }}</span>
            <span class="day-month">{{ day.month }}</span>
          </div>
          <span v-if="day.isToday" class="today-badge">Today</span>
        </div>

        <!-- Day Content -->
        <div class="day-content">
          <!-- Calendar Events -->
          <div
            v-for="ev in day.events"
            :key="'ev-' + ev.id"
            class="tl-event-card"
          >
            <div class="tl-event-time">
              {{ ev.allDay ? 'All day' : formatTime(ev.startTime) }}
            </div>
            <div class="tl-event-info">
              <span class="tl-event-title">{{ ev.summary || 'Untitled' }}</span>
              <span v-if="ev.location" class="tl-event-meta">
                <ion-icon :icon="locationOutline" />
                {{ ev.location }}
              </span>
            </div>
          </div>

          <!-- Note References -->
          <div
            v-for="(noteRef, idx) in day.noteRefs"
            :key="'nr-' + idx"
            class="tl-note-card"
            :class="{ deadline: noteRef.type === 'deadline' }"
            @click="$emit('open-file', noteRef.fileId, noteRef.projectId)"
          >
            <div class="tl-note-icon">
              <ion-icon :icon="documentTextOutline" />
            </div>
            <div class="tl-note-info">
              <span class="tl-note-filename">{{ noteRef.fileName }}</span>
              <span class="tl-note-context">{{ noteRef.contextSnippet }}</span>
            </div>
            <span v-if="noteRef.mentionCount && noteRef.mentionCount > 1" class="tl-mention-badge">
              {{ noteRef.mentionCount }} mentions
            </span>
            <span v-if="noteRef.type === 'deadline'" class="tl-deadline-badge">
              Deadline
            </span>
          </div>

          <!-- Empty State -->
          <div v-if="day.events.length === 0 && day.noteRefs.length === 0" class="tl-empty">
            <span>No events or date references</span>
          </div>
        </div>
      </div>

      <div v-if="showTeachableEmpty" class="timeline-empty-state teachable">
        <ion-icon :icon="calendarClearOutline" />
        <p>No dates in this range</p>
        <span class="teachable-hint">Mention dates in notes and they'll show up here.</span>
        <div class="teachable-examples">
          <span class="example-chip">due next Friday</span>
          <span class="example-chip">meeting on July 15</span>
          <span class="example-chip">deadline tomorrow</span>
        </div>
        <span class="teachable-secondary">Try expanding the date range or switching projects</span>
      </div>
      <div v-else-if="visibleDays.length === 0" class="timeline-empty-state">
        <ion-icon :icon="calendarClearOutline" />
        <p>No dates found in this range</p>
        <span>Try expanding the date range or switching projects</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { IonIcon, IonSpinner } from '@ionic/vue';
import {
  timeOutline,
  closeOutline,
  chevronBackOutline,
  chevronForwardOutline,
  locationOutline,
  documentTextOutline,
  calendarClearOutline,
} from 'ionicons/icons';
import { getCalendarEventsByDateRange } from '@/services/database';
import {
  ensureNoteDatesBackfill,
  onNoteDatesChanged,
  queryTimelineNoteDates,
} from '@/services/dateIndexService';
import { groupNoteRefsByFile, type TimelineNoteReference } from '@/composables/groupTimelineNoteRefs';
import type { DBCalendarEvent } from '@/services/database';

type NoteReference = TimelineNoteReference;

interface TimelineDay {
  dateStr: string;
  date: Date;
  weekday: string;
  dayNumber: string;
  month: string;
  isToday: boolean;
  hasDeadline: boolean;
  events: DBCalendarEvent[];
  noteRefs: NoteReference[];
}

const props = defineProps<{
  projectId?: string | null;
}>();

defineEmits<{
  (e: 'close'): void;
  (e: 'open-file', fileId: string, projectId: string): void;
}>();

const loading = ref(true);
const loadingMessage = ref('Loading timeline...');
const showEmptyDays = ref(false);
const deadlinesOnly = ref(false);
const timelineBodyRef = ref<HTMLElement | null>(null);
let unsubscribeNoteDates: (() => void) | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

const today = new Date();
today.setHours(0, 0, 0, 0);

const rangeStart = ref(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000));
const rangeEnd = ref(new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000));

const rangeStartStr = computed({
  get: () => toDateStr(rangeStart.value),
  set: (v: string) => { rangeStart.value = new Date(v + 'T00:00:00'); },
});

const rangeEndStr = computed({
  get: () => toDateStr(rangeEnd.value),
  set: (v: string) => { rangeEnd.value = new Date(v + 'T00:00:00'); },
});

const calendarEvents = ref<DBCalendarEvent[]>([]);
const noteReferences = ref<Map<string, NoteReference[]>>(new Map());

const allDays = computed<TimelineDay[]>(() => {
  const days: TimelineDay[] = [];
  const current = new Date(rangeStart.value);
  current.setHours(0, 0, 0, 0);
  const end = new Date(rangeEnd.value);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    const dateStr = toDateStr(current);
    const dayEvents = calendarEvents.value.filter(ev => {
      const evDateStr = toDateStr(new Date(ev.startTime));
      return evDateStr === dateStr;
    });
    const dayNoteRefs = noteReferences.value.get(dateStr) || [];

    const isToday = dateStr === toDateStr(today);

    days.push({
      dateStr,
      date: new Date(current),
      weekday: current.toLocaleDateString('en-US', { weekday: 'short' }),
      dayNumber: String(current.getDate()),
      month: current.toLocaleDateString('en-US', { month: 'short' }),
      isToday,
      hasDeadline: dayNoteRefs.some(nr => nr.type === 'deadline'),
      events: dayEvents,
      noteRefs: dayNoteRefs,
    });

    current.setDate(current.getDate() + 1);
  }

  return days;
});

const visibleDays = computed(() => {
  let days = allDays.value;

  if (deadlinesOnly.value) {
    days = days.map(d => ({
      ...d,
      noteRefs: d.noteRefs.filter(nr => nr.type === 'deadline'),
      hasDeadline: d.noteRefs.some(nr => nr.type === 'deadline'),
    }));
  }

  if (showEmptyDays.value) return days;
  return days.filter(d => d.events.length > 0 || d.noteRefs.length > 0 || d.isToday);
});

const hasAnyTimelineContent = computed(() =>
  allDays.value.some(d => d.events.length > 0 || d.noteRefs.length > 0),
);

const showTeachableEmpty = computed(() =>
  !loading.value && !hasAnyTimelineContent.value,
);

function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function shiftRange(days: number) {
  rangeStart.value = new Date(rangeStart.value.getTime() + days * 24 * 60 * 60 * 1000);
  rangeEnd.value = new Date(rangeEnd.value.getTime() + days * 24 * 60 * 60 * 1000);
}

function onRangeChange() {
  loadData();
}

function jumpToToday() {
  rangeStart.value = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  rangeEnd.value = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

  nextTick(() => {
    const el = document.getElementById('day-' + toDateStr(today));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

async function loadData() {
  loading.value = true;
  loadingMessage.value = 'Loading timeline...';

  try {
    loadingMessage.value = 'Scanning notes for dates...';
    await ensureNoteDatesBackfill(props.projectId);
    loadingMessage.value = 'Loading timeline...';

    const endForQuery = new Date(rangeEnd.value);
    endForQuery.setHours(23, 59, 59, 999);
    calendarEvents.value = await getCalendarEventsByDateRange(rangeStart.value, endForQuery);

    const rows = await queryTimelineNoteDates(
      rangeStart.value,
      rangeEnd.value,
      props.projectId,
    );

    const refMap = new Map<string, NoteReference[]>();
    for (const row of rows) {
      const existing = refMap.get(row.dateStr) || [];
      existing.push({
        fileId: row.fileId,
        projectId: row.projectId,
        fileName: row.fileName,
        dateText: row.dateText,
        type: row.type,
        contextSnippet: row.contextSnippet || row.dateText,
      });
      refMap.set(row.dateStr, existing);
    }

    for (const [dateStr, refs] of refMap) {
      refMap.set(dateStr, groupNoteRefsByFile(refs));
    }

    noteReferences.value = refMap;
  } catch {
    calendarEvents.value = [];
    noteReferences.value = new Map();
  } finally {
    loading.value = false;
  }
}

function scheduleReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    loadData();
  }, 150);
}

watch([rangeStart, rangeEnd], () => {
  loadData();
});

watch(() => props.projectId, () => {
  loadData();
});

onMounted(() => {
  loadData();
  unsubscribeNoteDates = onNoteDatesChanged((event) => {
    if (props.projectId && event.projectId !== props.projectId) return;
    scheduleReload();
  });
});

onUnmounted(() => {
  unsubscribeNoteDates?.();
  if (reloadTimer) clearTimeout(reloadTimer);
});
</script>

<style scoped>
.timeline-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--hn-bg-base, #0f0f1a);
  overflow: hidden;
}

.timeline-header {
  padding: 16px 24px 12px;
  background: var(--hn-bg-surface, #1a1a2e);
  border-bottom: 1px solid var(--hn-border-default, #2a2a4a);
}

.timeline-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.timeline-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--hn-text-primary, #e0e0e0);
}

.timeline-title ion-icon {
  font-size: 1.2rem;
  color: var(--hn-purple-light, #a78bfa);
}

.timeline-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tl-btn {
  padding: 5px 12px;
  background: var(--hn-bg-elevated, #222244);
  border: 1px solid var(--hn-border-default, #2a2a4a);
  border-radius: 6px;
  color: var(--hn-text-secondary, #aaa);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.tl-btn:hover {
  border-color: var(--hn-border-strong);
  color: var(--hn-text-primary, #e0e0e0);
}

.tl-btn.icon-btn {
  display: flex;
  align-items: center;
  padding: 5px 8px;
}

.tl-btn.icon-btn ion-icon {
  font-size: 1rem;
}

.tl-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--hn-text-muted, #888);
  cursor: pointer;
}

.tl-toggle input {
  accent-color: var(--hn-purple, #7c3aed);
}

.date-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-arrow {
  background: none;
  border: none;
  color: var(--hn-text-muted, #888);
  cursor: pointer;
  padding: 4px;
  display: flex;
  font-size: 1.1rem;
  border-radius: 6px;
  transition: all 0.15s;
}

.nav-arrow:hover {
  color: var(--hn-text-primary, #e0e0e0);
  background: var(--hn-bg-elevated, #222244);
}

.date-range-display {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-input {
  padding: 5px 10px;
  background: var(--hn-bg-elevated, #222244);
  border: 1px solid var(--hn-border-default, #2a2a4a);
  border-radius: 6px;
  color: var(--hn-text-primary, #e0e0e0);
  font-size: 0.82rem;
  outline: none;
  color-scheme: dark;
}

.date-input:focus {
  border-color: var(--hn-purple, #7c3aed);
}

.date-separator {
  font-size: 0.8rem;
  color: var(--hn-text-muted, #888);
}

.timeline-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--hn-text-muted, #888);
  font-size: 0.9rem;
}

.timeline-loading ion-spinner {
  width: 28px;
  height: 28px;
}

.timeline-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

.timeline-day {
  display: flex;
  gap: 20px;
  padding: 16px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  position: relative;
}

.timeline-day.today {
  background: rgba(124, 58, 237, 0.04);
  border-radius: 10px;
  padding: 16px;
  margin: 0 -16px;
  border-bottom: none;
}

.day-marker {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 64px;
  gap: 4px;
  position: relative;
}

.day-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--hn-border-default, #2a2a4a);
  flex-shrink: 0;
}

.timeline-day.has-content .day-dot {
  background: var(--hn-purple-light, #a78bfa);
  box-shadow: 0 0 8px rgba(167, 139, 250, 0.3);
}

.timeline-day.today .day-dot {
  background: #4285F4;
  box-shadow: 0 0 8px rgba(66, 133, 244, 0.4);
}

.timeline-day.has-deadlines .day-dot {
  background: #fbbf24;
  box-shadow: 0 0 8px rgba(251, 191, 36, 0.3);
}

.day-date {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.day-weekday {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--hn-text-muted, #888);
}

.day-number {
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--hn-text-primary, #e0e0e0);
  line-height: 1.1;
}

.timeline-day.today .day-number {
  color: #4285F4;
}

.day-month {
  font-size: 0.7rem;
  color: var(--hn-text-muted, #888);
  text-transform: uppercase;
}

.today-badge {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #4285F4;
  background: rgba(66, 133, 244, 0.12);
  padding: 2px 6px;
  border-radius: 4px;
  margin-top: 2px;
}

.day-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.tl-event-card {
  display: flex;
  gap: 12px;
  padding: 10px 14px;
  background: var(--hn-bg-surface, #1a1a2e);
  border: 1px solid var(--hn-border-default, #2a2a4a);
  border-radius: 8px;
  border-left: 3px solid #4285F4;
}

.tl-event-time {
  font-size: 0.78rem;
  font-weight: 600;
  color: #7aafff;
  white-space: nowrap;
  min-width: 60px;
  padding-top: 1px;
}

.tl-event-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.tl-event-title {
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--hn-text-primary, #e0e0e0);
}

.tl-event-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--hn-text-muted, #888);
}

.tl-event-meta ion-icon {
  font-size: 0.85rem;
}

.tl-note-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--hn-bg-surface, #1a1a2e);
  border: 1px solid var(--hn-border-default, #2a2a4a);
  border-radius: 8px;
  border-left: 3px solid var(--hn-purple-light, #a78bfa);
  cursor: pointer;
  transition: all 0.15s;
}

.tl-note-card:hover {
  background: var(--hn-bg-elevated, #222244);
  border-color: var(--hn-border-strong);
}

.tl-note-card.deadline {
  border-left-color: #fbbf24;
}

.tl-note-icon {
  color: var(--hn-purple-light, #a78bfa);
  font-size: 1.1rem;
  flex-shrink: 0;
}

.tl-note-card.deadline .tl-note-icon {
  color: #fbbf24;
}

.tl-note-info {
  flex: 1;
  min-width: 0;
}

.tl-note-filename {
  display: block;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--hn-text-primary, #e0e0e0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tl-note-context {
  display: block;
  font-size: 0.75rem;
  color: var(--hn-text-muted, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tl-deadline-badge {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.12);
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}

.tl-mention-badge {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--hn-purple-light, #a78bfa);
  background: rgba(167, 139, 250, 0.12);
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}

.tl-empty {
  padding: 6px 0;
  font-size: 0.78rem;
  color: var(--hn-text-muted, #888);
  font-style: italic;
}

.timeline-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 0;
}

.timeline-empty-state ion-icon {
  font-size: 3rem;
  color: var(--hn-text-muted, #888);
  opacity: 0.5;
}

.timeline-empty-state p {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
  color: var(--hn-text-secondary, #aaa);
}

.timeline-empty-state span {
  font-size: 0.82rem;
  color: var(--hn-text-muted, #888);
}

.timeline-empty-state.teachable {
  text-align: center;
  max-width: 420px;
  margin: 0 auto;
}

.teachable-hint {
  color: var(--hn-text-secondary, #aaa) !important;
}

.teachable-examples {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin: 8px 0 4px;
}

.example-chip {
  font-size: 0.78rem;
  color: var(--hn-purple-light, #a78bfa);
  background: rgba(167, 139, 250, 0.1);
  border: 1px solid rgba(167, 139, 250, 0.25);
  padding: 4px 10px;
  border-radius: 999px;
}

.teachable-secondary {
  margin-top: 4px;
}

.timeline-body::-webkit-scrollbar {
  width: 8px;
}

.timeline-body::-webkit-scrollbar-track {
  background: transparent;
}

.timeline-body::-webkit-scrollbar-thumb {
  background: var(--hn-border-default, #2a2a4a);
  border-radius: 4px;
}
</style>
