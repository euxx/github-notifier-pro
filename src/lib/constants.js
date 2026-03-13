/**
 * Application Constants
 * Centralized configuration values to avoid magic numbers
 */

// Alarm Configuration
export const ALARM_NAME = 'check-notifications';
export const DEFAULT_POLL_INTERVAL_MINUTES = 1; // Chrome minimum is 1 minute

// API Configuration
export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_SITE_BASE = 'https://github.com';
export const MIN_POLL_INTERVAL_SECONDS = 60; // 1 minute minimum
export const MAX_POLL_INTERVAL_SECONDS = 600; // 10 minutes maximum (prevent excessive delays)

// UI Animation Timings (milliseconds)
export const ANIMATION_DURATION = {
  FADE_OUT: 200,
  STAGGER_DELAY: 50,
  MIN_SPINNER_TIME: 500,
  STATUS_MESSAGE: 3000,
  THEME_TRANSITION: 200,
  ERROR_BACKGROUND_FADE: 1000,
  COPY_FEEDBACK: 4000,
  AUTO_CLOSE: 2000,
  GITHUB_OPEN_DELAY: 1000,
  COUNTDOWN_INTERVAL: 1000,
};

// Timing Thresholds
export const TIMING_THRESHOLDS = {
  ALARM_RESET_DETECTION: 5000,
  WORKFLOW_MATCH_WINDOW: 5 * 60 * 1000, // 5 minutes
};

// API Timeouts (milliseconds)
export const API_TIMEOUTS = {
  DEFAULT: 30000,
  USER_INFO: 10000,
  NOTIFICATION_DETAILS: 15000,
  RETRY_BASE_DELAY: 1000,
  RETRY_REQUEST_BASE_DELAY: 500,
};

// Time Conversion
export const TIME_CONVERSION = {
  MS_PER_SECOND: 1000,
  MS_PER_MINUTE: 60000,
};

// UI Dimensions
export const MIN_POPUP_WIDTH = 400;
export const MAX_POPUP_WIDTH = 800;
export const DEFAULT_POPUP_WIDTH = 600;
export const POPUP_WIDTH_STEP = 50;

// Token Validation
// Reference: https://github.blog/2021-04-05-behind-githubs-new-authentication-token-formats/
// Only tokens that can access the /notifications API endpoint
export const TOKEN_PREFIXES = [
  'ghp_', // Personal Access Token (classic) - with notifications/repo scope
  'gho_', // OAuth Access Token - with notifications/repo scope
  'ghu_', // GitHub App User Token - with notifications permission
  'github_pat_', // Fine-grained Personal Access Token - with repository access
];

// Message Types (for runtime.sendMessage)
export const MESSAGE_TYPES = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  GET_STATE: 'getState',
  GET_RATE_LIMIT: 'getRateLimit',
  OPEN_NOTIFICATION: 'openNotification',
  MARK_AS_READ: 'markAsRead',
  MARK_ALL_AS_READ: 'markAllAsRead',
  MARK_REPO_AS_READ: 'markRepoAsRead',
  REFRESH: 'refresh',
};

// GitHub Notification Types
export const NOTIFICATION_TYPES = {
  ISSUE: 'Issue',
  PULL_REQUEST: 'PullRequest',
  RELEASE: 'Release',
  DISCUSSION: 'Discussion',
  COMMIT: 'Commit',
  CHECK_SUITE: 'CheckSuite',
  VULNERABILITY_ALERT: 'RepositoryVulnerabilityAlert',
  DEPENDABOT_ALERT: 'RepositoryDependabotAlertsThread',
  REPOSITORY_INVITATION: 'RepositoryInvitation',
};

// Notification Type to Icon Name Mapping
export const NOTIFICATION_TYPE_ICONS = {
  [NOTIFICATION_TYPES.ISSUE]: 'issue',
  [NOTIFICATION_TYPES.PULL_REQUEST]: 'pr',
  [NOTIFICATION_TYPES.RELEASE]: 'release',
  [NOTIFICATION_TYPES.DISCUSSION]: 'discussion',
  [NOTIFICATION_TYPES.COMMIT]: 'commit',
  [NOTIFICATION_TYPES.CHECK_SUITE]: 'actions',
  [NOTIFICATION_TYPES.VULNERABILITY_ALERT]: 'alert',
  [NOTIFICATION_TYPES.DEPENDABOT_ALERT]: 'alert',
  [NOTIFICATION_TYPES.REPOSITORY_INVITATION]: 'repo',
};

// Notification Type to Human-Readable Name Mapping
export const NOTIFICATION_TYPE_LABELS = {
  [NOTIFICATION_TYPES.ISSUE]: 'Issue',
  [NOTIFICATION_TYPES.PULL_REQUEST]: 'Pull Request',
  [NOTIFICATION_TYPES.RELEASE]: 'Release',
  [NOTIFICATION_TYPES.DISCUSSION]: 'Discussion',
  [NOTIFICATION_TYPES.COMMIT]: 'Commit',
  [NOTIFICATION_TYPES.CHECK_SUITE]: 'CI Activity',
  [NOTIFICATION_TYPES.VULNERABILITY_ALERT]: 'Security Alert',
  [NOTIFICATION_TYPES.DEPENDABOT_ALERT]: 'Dependabot Alert',
  [NOTIFICATION_TYPES.REPOSITORY_INVITATION]: 'Repository Invitation',
};
