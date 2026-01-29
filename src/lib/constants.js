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
export const MIN_POLL_INTERVAL_SECONDS = 60;

// UI Animation Timings (milliseconds)
export const ANIMATION_DURATION = {
  FADE_OUT: 200,
  SLIDE_UP: 200,
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
  MS_TO_SECONDS: 1000,
  MS_TO_MINUTES: 60000,
};

// UI Dimensions
export const MIN_POPUP_WIDTH = 400;
export const MAX_POPUP_WIDTH = 800;
export const DEFAULT_POPUP_WIDTH = 600;
export const POPUP_WIDTH_STEP = 50;
export const POPUP_MIN_HEIGHT = 300;
export const POPUP_MAX_HEIGHT = 600;

// Token Validation
export const TOKEN_PREFIXES = ['ghp_', 'github_pat_'];

// Cache Configuration
export const CACHE_DURATION = {
  NOTIFICATIONS: 60000, // 1 minute
};

// Message Types (for runtime.sendMessage)
export const MESSAGE_TYPES = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  GET_STATE: 'getState',
  GET_RATE_LIMIT: 'getRateLimit',
  OPEN_NOTIFICATION: 'openNotification',
  MARK_AS_READ: 'markAsRead',
  MARK_ALL_AS_READ: 'markAllAsRead',
  REFRESH: 'refresh',
};
