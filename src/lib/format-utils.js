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

/**
 * Format notification type to human-readable text
 */
export function formatType(type) {
  const types = {
    'Issue': 'Issue',
    'PullRequest': 'Pull Request',
    'Release': 'Release',
    'Discussion': 'Discussion',
    'Commit': 'Commit',
    'CheckSuite': 'CI Activity',
    'RepositoryVulnerabilityAlert': 'Security Alert',
    'RepositoryDependabotAlertsThread': 'Dependabot Alert',
  };
  return types[type] || type || 'Notification';
}

/**
 * Format notification state to human-readable text
 */
export function formatState(state) {
  if (!state) return '';
  const states = {
    'open': 'Open',
    'closed': 'Closed',
    'merged': 'Merged',
    'success': 'Success',
    'failure': 'Failure',
    'cancelled': 'Cancelled',
    'skipped': 'Skipped',
    'pending': 'Pending',
  };
  return states[state] || state;
}

/**
 * Get notification status text (type + state)
 */
export function getNotificationStatus(notif) {
  const type = formatType(notif.type);

  // For CI/Actions
  if (notif.conclusion) {
    return `${type} (${formatState(notif.conclusion)})`;
  }

  // For PRs - check merged first
  if (notif.merged) {
    return `${type} (Merged)`;
  }

  // For Issues and PRs
  if (notif.state) {
    return `${type} (${formatState(notif.state)})`;
  }

  return type;
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape HTML attributes to prevent XSS
 */
export function escapeAttr(text) {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
