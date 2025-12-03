/**
 * Telemetry Service
 * Tracks events and metrics for Phase 12 guardrails monitoring
 */

import type {
  TelemetryEvent,
  TelemetryEventType,
  TelemetryMetrics,
  NoteCreatedEventData,
  ProjectCreatedEventData,
  DirectoryCreatedEventData,
  NoteCreationSource,
} from '../types';

// ============================================
// In-Memory Event Storage
// ============================================

const events: TelemetryEvent[] = [];
const MAX_EVENTS = 1000; // Limit to prevent memory issues

// ============================================
// Event Tracking Functions
// ============================================

/**
 * Track a generic telemetry event
 */
export function trackEvent(type: TelemetryEventType, data: Record<string, unknown>): void {
  const event: TelemetryEvent = {
    type,
    timestamp: new Date(),
    data,
  };

  events.push(event);

  // Trim old events if we exceed the limit
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }

  // Log for audit (Phase 12 requirement)
  logEvent(event);
}

/**
 * Track note creation event
 */
export function trackNoteCreated(data: NoteCreatedEventData): void {
  trackEvent('note_created', data as unknown as Record<string, unknown>);
}

/**
 * Track project creation event
 */
export function trackProjectCreated(data: ProjectCreatedEventData): void {
  trackEvent('project_created', data as unknown as Record<string, unknown>);
}

/**
 * Track directory creation event (audit log for AI-created directories)
 */
export function trackDirectoryCreated(data: DirectoryCreatedEventData): void {
  trackEvent('directory_created', data as unknown as Record<string, unknown>);
  
  // Additional audit logging for directory creation (Phase 12 requirement)
  console.info('[AUDIT] New directory created by AI:', {
    project: data.projectId,
    directory: data.directoryPath,
    note: data.triggeringNoteTitle,
    reasoning: data.reasoning || 'No reasoning provided',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Track failed note creation
 */
export function trackNoteCreationFailed(
  source: NoteCreationSource,
  error: string,
  projectId?: string
): void {
  trackEvent('note_creation_failed', {
    source,
    error,
    projectId,
  });
}

// ============================================
// Metrics Aggregation
// ============================================

/**
 * Get aggregated metrics from tracked events
 */
export function getMetrics(): TelemetryMetrics {
  const noteCreatedEvents = events.filter(e => e.type === 'note_created');
  const projectCreatedEvents = events.filter(e => e.type === 'project_created');
  const directoryCreatedEvents = events.filter(e => e.type === 'directory_created');

  return {
    notesCreated: noteCreatedEvents.length,
    notesFromDashboard: noteCreatedEvents.filter(
      e => (e.data as unknown as NoteCreatedEventData).source === 'dashboard'
    ).length,
    notesFromProjectChat: noteCreatedEvents.filter(
      e => (e.data as unknown as NoteCreatedEventData).source === 'project_chat'
    ).length,
    projectsAutoCreated: projectCreatedEvents.filter(
      e => (e.data as unknown as ProjectCreatedEventData).automatic
    ).length,
    projectsUserCreated: projectCreatedEvents.filter(
      e => !(e.data as unknown as ProjectCreatedEventData).automatic
    ).length,
    directoriesCreated: directoryCreatedEvents.length,
  };
}

/**
 * Get all events (for debugging/analysis)
 */
export function getAllEvents(): TelemetryEvent[] {
  return [...events];
}

/**
 * Get events by type
 */
export function getEventsByType(type: TelemetryEventType): TelemetryEvent[] {
  return events.filter(e => e.type === type);
}

/**
 * Get recent events (last N)
 */
export function getRecentEvents(count: number = 50): TelemetryEvent[] {
  return events.slice(-count);
}

/**
 * Clear all events (for testing)
 */
export function clearEvents(): void {
  events.length = 0;
}

// ============================================
// Audit Logging
// ============================================

/**
 * Log event to console for audit purposes
 */
function logEvent(event: TelemetryEvent): void {
  const logData = {
    type: event.type,
    timestamp: event.timestamp.toISOString(),
    ...event.data,
  };

  switch (event.type) {
    case 'directory_created':
      // Already logged with more detail in trackDirectoryCreated
      break;
    case 'project_created':
      if ((event.data as unknown as ProjectCreatedEventData).automatic) {
        console.info('[AUDIT] Project auto-created by AI:', logData);
      }
      break;
    case 'note_creation_failed':
      console.warn('[TELEMETRY] Note creation failed:', logData);
      break;
    default:
      // Standard events logged at debug level only
      break;
  }
}

// ============================================
// Export summary for display
// ============================================

/**
 * Get a human-readable metrics summary
 */
export function getMetricsSummary(): string {
  const metrics = getMetrics();
  
  return `
Telemetry Summary
─────────────────
Notes Created: ${metrics.notesCreated}
  • From Dashboard: ${metrics.notesFromDashboard}
  • From Project Chat: ${metrics.notesFromProjectChat}

Projects Created: ${metrics.projectsAutoCreated + metrics.projectsUserCreated}
  • Auto-created (AI): ${metrics.projectsAutoCreated}
  • User-initiated: ${metrics.projectsUserCreated}

Directories Created (AI): ${metrics.directoriesCreated}
`.trim();
}

