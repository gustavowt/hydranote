/**
 * Date Detection Service
 * Parses natural language dates from note content using chrono-node.
 * Detects deadlines by scanning surrounding context for urgency keywords.
 */

import * as chrono from 'chrono-node';
import type { DetectedDate } from '../types';

const DEADLINE_KEYWORDS = [
  'deadline',
  'due',
  'due by',
  'due date',
  'submit',
  'deliver',
  'finish by',
  'must complete',
  'expires',
  'expiration',
  'complete by',
  'no later than',
  'before',
  'until',
];

const DEADLINE_PATTERN = new RegExp(
  `(?:${DEADLINE_KEYWORDS.map(k => k.replace(/\s+/g, '\\s+')).join('|')})`,
  'i',
);

const CONTEXT_WINDOW = 80;
const DEADLINE_SCAN_WINDOW = 60;

const cache = new Map<string, { result: DetectedDate[]; timestamp: number }>();
const CACHE_TTL_MS = 30_000;

function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return String(hash);
}

function extractContext(text: string, index: number, length: number): string {
  const start = Math.max(0, index - CONTEXT_WINDOW);
  const end = Math.min(text.length, index + length + CONTEXT_WINDOW);
  return text.slice(start, end).trim();
}

function isDeadline(text: string, matchIndex: number): boolean {
  const scanStart = Math.max(0, matchIndex - DEADLINE_SCAN_WINDOW);
  const precedingText = text.slice(scanStart, matchIndex);
  return DEADLINE_PATTERN.test(precedingText);
}

/**
 * Detect dates in text content using chrono-node.
 * Returns an array of detected dates with positions and types.
 */
export function detectDates(text: string, referenceDate?: Date): DetectedDate[] {
  if (!text || text.length < 3) return [];

  const key = simpleHash(text);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  const ref = referenceDate ?? new Date();
  const parsed = chrono.parse(text, ref, { forwardDate: true });

  const results: DetectedDate[] = [];

  for (const result of parsed) {
    const startDate = result.start.date();
    const endDate = result.end?.date();

    const detected: DetectedDate = {
      text: result.text,
      date: startDate,
      endDate: endDate ?? undefined,
      index: result.index,
      length: result.text.length,
      type: isDeadline(text, result.index) ? 'deadline' : 'regular',
      context: extractContext(text, result.index, result.text.length),
    };

    results.push(detected);
  }

  cache.set(key, { result: results, timestamp: Date.now() });

  if (cache.size > 200) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }

  return results;
}

/**
 * Clear the detection cache (useful when switching documents).
 */
export function clearDateCache(): void {
  cache.clear();
}

/**
 * Format a detected date for display in a chip.
 */
export function formatDetectedDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Get relative time description for a date (e.g. "in 3 days", "2 days ago").
 */
export function getRelativeTime(date: Date, referenceDate?: Date): string {
  const ref = referenceDate ?? new Date();
  const refDay = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffMs = targetDay.getTime() - refDay.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays === -1) return 'yesterday';
  if (diffDays > 1) return `in ${diffDays} days`;
  return `${Math.abs(diffDays)} days ago`;
}
