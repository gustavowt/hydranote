/**
 * Utility for formatting chat execution plan messages and handling expired plan states
 * after app reboot or when no interactive plan card is present.
 */

export const DEAD_END_PLAN_REGEX =
  /(?:Please review the steps below and )?click ["\\']*Execute Plan["\\']* to proceed\.?/gi;

export const EXPIRED_PLAN_NOTICE =
  'This execution plan has expired and can be re-requested.';

/**
 * Normalizes assistant message content when displaying execution plans.
 * If an active execution plan card is present for the message, the interactive instruction is preserved.
 * If the message was restored after an app restart (or the plan is no longer pending),
 * the dead-end "click Execute Plan" instruction is replaced with a clear notice that the plan expired.
 */
export function formatPlanMessageContent(
  content: string,
  hasActivePlan: boolean
): string {
  if (hasActivePlan) {
    return content;
  }

  return content.replace(DEAD_END_PLAN_REGEX, EXPIRED_PLAN_NOTICE);
}
