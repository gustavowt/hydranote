import { describe, expect, test } from 'vitest';
import {
  formatPlanMessageContent,
  EXPIRED_PLAN_NOTICE,
} from '../../src/utils/planMessageUtils';

describe('planMessageUtils', () => {
  const planMessage =
    "I've created an execution plan:\n\n**Delete 3 files**\n\nPlease review the steps below and click \"Execute Plan\" to proceed.";

  test('preserves instruction when an active plan card is present', () => {
    const formatted = formatPlanMessageContent(planMessage, true);
    expect(formatted).toBe(planMessage);
  });

  test('replaces dead-end instruction with expiration notice when no active plan card is present', () => {
    const formatted = formatPlanMessageContent(planMessage, false);
    expect(formatted).not.toContain('click "Execute Plan" to proceed');
    expect(formatted).toContain(EXPIRED_PLAN_NOTICE);
    expect(formatted).toBe(
      "I've created an execution plan:\n\n**Delete 3 files**\n\nThis execution plan has expired and can be re-requested."
    );
  });

  test('handles escaped quotes or single quotes in instruction', () => {
    const escaped =
      'Please review the steps below and click \\"Execute Plan\\" to proceed.';
    expect(formatPlanMessageContent(escaped, false)).toBe(EXPIRED_PLAN_NOTICE);

    const singleQuote =
      "Please review the steps below and click 'Execute Plan' to proceed.";
    expect(formatPlanMessageContent(singleQuote, false)).toBe(EXPIRED_PLAN_NOTICE);
  });

  test('handles shorthand click Execute Plan to proceed', () => {
    const shorthand = 'Please click "Execute Plan" to proceed.';
    expect(formatPlanMessageContent(shorthand, false)).toBe(
      'Please ' + EXPIRED_PLAN_NOTICE
    );
  });

  test('leaves unrelated assistant messages unchanged', () => {
    const normal = 'Here is the summary of your project notes.';
    expect(formatPlanMessageContent(normal, false)).toBe(normal);
    expect(formatPlanMessageContent(normal, true)).toBe(normal);
  });
});
