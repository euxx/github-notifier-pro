/**
 * Formatting utilities for notifications
 */

import { NOTIFICATION_TYPE_LABELS } from './constants.js';

/**
 * Format notification reason to human-readable text
 * Based on: https://docs.github.com/en/rest/activity/notifications
 */
export function formatReason(reason) {
  const reasons = {
    approval_requested: 'Approval Requested',
    assign: 'Assigned',
    author: 'You Authored',
    ci_activity: 'CI Activity',
    comment: 'Commented',
    invitation: 'Invited',
    manual: 'Manual',
    member_feature_requested: 'Feature Requested',
    mention: 'Mention',
    mentioned: 'Mention', // Legacy - API may still return this in some cases
    review_requested: 'Review Requested',
    security_advisory_credit: 'Security Credit',
    security_alert: 'Security Alert',
    state_change: 'State Changed',
    subscribed: 'Subscribed',
    team_mention: 'Team Mentioned',
    // Not in official docs but appears in API responses
    participating: 'Participating',
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
    open: 'Open',
    closed: 'Closed',
    merged: 'Merged',
    success: 'Success',
    failure: 'Failure',
    cancelled: 'Cancelled',
    skipped: 'Skipped',
    pending: 'Pending',
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
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
