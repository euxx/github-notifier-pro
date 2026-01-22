/**
 * Formatting utilities for notifications
 */

/**
 * Format notification reason to human-readable text
 */
export function formatReason(reason) {
  const reasons = {
    'subscribed': 'Subscribed',
    'participating': 'Participating',
    'mentioned': 'Mentioned',
    'team_mention': 'Team Mentioned',
    'comment': 'Commented',
    'review_requested': 'Review Requested',
    'security_alert': 'Security Alert',
    'state_change': 'State Changed',
    'assign': 'Assigned',
    'author': 'You Authored',
    'manual': 'Manual',
    'ci_activity': 'CI Activity',
  };
  return reasons[reason] || reason || 'Unknown';
}
