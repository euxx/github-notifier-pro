/**
 * Formatting utilities for notifications
 */

import { NOTIFICATION_TYPE_LABELS } from './constants.js';

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
  return NOTIFICATION_TYPE_LABELS[type] || type || 'Notification';
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
 * Uses string replacement instead of DOM manipulation for better performance
 */
export function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape HTML attributes to prevent XSS
 */
export function escapeAttr(text) {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
