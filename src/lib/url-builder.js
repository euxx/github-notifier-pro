/**
 * GitHub notification URL builder
 * Centralized logic for constructing URLs from notification data
 */

import { GITHUB_SITE_BASE, NOTIFICATION_TYPES } from './constants.js';

/**
 * Build URL for a GitHub notification
 * Handles various notification types with appropriate fallbacks
 *
 * @param {Object} notification - Notification object from GitHub API
 * @param {Object} notification.repository - Repository information
 * @param {string} notification.repository.full_name - Full repo name (owner/repo)
 * @param {string} notification.repository.html_url - Repository URL
 * @param {string} notification.type - Notification type (Issue, PullRequest, Release, etc.)
 * @param {number} [notification.number] - Issue/PR number
 * @param {string} [notification.html_url] - Cached HTML URL (takes precedence if present)
 * @param {string} [notification.url] - API URL (for extracting commit SHA)
 * @returns {string} GitHub URL for the notification
 * @throws {Error} If notification is missing or repository data cannot produce a usable URL.
 *   Callers that open browser tabs should wrap this in try/catch and handle the failure
 *   gracefully (e.g. show an error, skip opening the tab).
 *
 * @example
 * buildNotificationUrl({
 *   type: 'PullRequest',
 *   number: 123,
 *   repository: { full_name: 'owner/repo' }
 * })
 * // Returns: 'https://github.com/owner/repo/pull/123'
 */
export function buildNotificationUrl(notification) {
  if (!notification) {
    throw new Error('Cannot build notification URL: notification is missing');
  }

  if (notification.html_url) {
    return notification.html_url;
  }

  const repo = notification.repository;
  const fullName = repo?.full_name;

  // If full_name is absent but html_url is available, fall back to the repo page
  if (!fullName) {
    if (repo?.html_url) {
      return repo.html_url;
    }
    // No usable URL — throw so the caller can skip silently instead of opening about:blank
    throw new Error('Cannot build notification URL: repository data is incomplete');
  }

  const type = notification.type;

  switch (type) {
    case NOTIFICATION_TYPES.ISSUE:
      return buildIssueUrl(fullName, notification.number);

    case NOTIFICATION_TYPES.PULL_REQUEST:
      return buildPullRequestUrl(fullName, notification.number);

    case NOTIFICATION_TYPES.RELEASE:
      return buildReleaseUrl(fullName);

    case NOTIFICATION_TYPES.COMMIT:
      return buildCommitUrl(fullName, notification.url);

    case NOTIFICATION_TYPES.DISCUSSION:
      return buildDiscussionUrl(fullName);

    case NOTIFICATION_TYPES.CHECK_SUITE:
      return buildCheckSuiteUrl(fullName);

    case NOTIFICATION_TYPES.REPOSITORY_INVITATION:
      return buildInvitationUrl(fullName);

    case NOTIFICATION_TYPES.VULNERABILITY_ALERT:
      return buildVulnerabilityUrl(fullName);

    case NOTIFICATION_TYPES.DEPENDABOT_ALERT:
      return buildDependabotUrl(fullName);

    default:
      // Fall back to the repo root; if html_url is absent construct it from full_name
      return repo.html_url ?? `${GITHUB_SITE_BASE}/${fullName}`;
  }
}

function buildIssueUrl(fullName, number) {
  if (!number) {
    return `${GITHUB_SITE_BASE}/${fullName}/issues`;
  }
  return `${GITHUB_SITE_BASE}/${fullName}/issues/${number}`;
}

function buildPullRequestUrl(fullName, number) {
  if (!number) {
    return `${GITHUB_SITE_BASE}/${fullName}/pulls`;
  }
  return `${GITHUB_SITE_BASE}/${fullName}/pull/${number}`;
}

function buildReleaseUrl(fullName) {
  return `${GITHUB_SITE_BASE}/${fullName}/releases`;
}

function buildCommitUrl(fullName, apiUrl) {
  if (!apiUrl) {
    return `${GITHUB_SITE_BASE}/${fullName}/commits`;
  }

  const match = apiUrl.match(/commits\/([a-f0-9]+)/);
  if (match && match[1]) {
    return `${GITHUB_SITE_BASE}/${fullName}/commit/${match[1]}`;
  }

  return `${GITHUB_SITE_BASE}/${fullName}/commits`;
}

function buildDiscussionUrl(fullName) {
  return `${GITHUB_SITE_BASE}/${fullName}/discussions`;
}

function buildCheckSuiteUrl(fullName) {
  return `${GITHUB_SITE_BASE}/${fullName}/actions`;
}

function buildInvitationUrl(fullName) {
  return `${GITHUB_SITE_BASE}/${fullName}/invitations`;
}

function buildVulnerabilityUrl(fullName) {
  return `${GITHUB_SITE_BASE}/${fullName}/network/dependencies`;
}

function buildDependabotUrl(fullName) {
  return `${GITHUB_SITE_BASE}/${fullName}/security/dependabot`;
}
