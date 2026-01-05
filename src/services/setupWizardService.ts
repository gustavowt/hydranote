/**
 * Setup Wizard Service
 * 
 * Manages the first-run configuration wizard state.
 * Tracks whether the wizard has been completed using localStorage.
 */

const WIZARD_COMPLETED_KEY = 'hydranote_wizard_completed';
const WIZARD_SKIPPED_KEY = 'hydranote_wizard_skipped';

/**
 * Check if the setup wizard has been completed
 */
export function isWizardCompleted(): boolean {
  try {
    const completed = localStorage.getItem(WIZARD_COMPLETED_KEY);
    return completed === 'true';
  } catch {
    return false;
  }
}

/**
 * Mark the setup wizard as completed
 */
export function markWizardCompleted(): void {
  localStorage.setItem(WIZARD_COMPLETED_KEY, 'true');
}

/**
 * Reset the wizard completion state (for testing/debugging)
 */
export function resetWizardState(): void {
  localStorage.removeItem(WIZARD_COMPLETED_KEY);
  localStorage.removeItem(WIZARD_SKIPPED_KEY);
}

/**
 * Check if the wizard should be shown
 * Returns true if the wizard has not been completed
 */
export function shouldShowWizard(): boolean {
  return !isWizardCompleted();
}

