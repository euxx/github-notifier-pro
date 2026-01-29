/**
 * GitHub notification URL builder
 * Centralized logic for constructing URLs from notification data
 */

import { GITHUB_SITE_BASE } from './constants.js';

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
  if (notification.html_url) {
    return notification.html_url;
  }

  const repo = notification.repository;
  const fullName = repo.full_name;
  const type = notification.type;

  switch (type) {
    case 'Issue':
      return buildIssueUrl(fullName, notification.number);

    case 'PullRequest':
      return buildPullRequestUrl(fullName, notification.number);

    case 'Release':
      return buildReleaseUrl(fullName);

    case 'Commit':
      return buildCommitUrl(fullName, notification.url);

    case 'Discussion':
      return buildDiscussionUrl(fullName);

    case 'CheckSuite':
      return buildCheckSuiteUrl(fullName);

    case 'RepositoryInvitation':
      return buildInvitationUrl(fullName);

    case 'RepositoryVulnerabilityAlert':
      return buildVulnerabilityUrl(fullName);

    case 'RepositoryDependabotAlertsThread':
      return buildDependabotUrl(fullName);

    default:
      return repo.html_url;
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
