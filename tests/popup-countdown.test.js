/**
 * @vitest-environment jsdom
 *
 * Tests for updateCountdown() alarm-reset detection in popup.js.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// -- Mocks (hoisted before popup.js import) ----------------------------------

vi.mock('../src/lib/chrome-api.js', () => ({
  alarms: { getAll: vi.fn().mockResolvedValue([]) },
  storage: {
    local: { get: vi.fn().mockResolvedValue({}), set: vi.fn(), remove: vi.fn() },
    onChanged: { addListener: vi.fn() },
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
    onMessage: { addListener: vi.fn() },
  },
  tabs: { create: vi.fn() },
}));

vi.mock('../src/lib/storage.js', () => ({
  getToken: vi.fn().mockResolvedValue(null),
  getTheme: vi.fn().mockResolvedValue('system'),
  setTheme: vi.fn().mockResolvedValue(undefined),
  getUsername: vi.fn().mockResolvedValue(null),
  getUserInfo: vi.fn().mockResolvedValue(null),
  getNotifications: vi.fn().mockResolvedValue([]),
  getAuthMethod: vi.fn().mockResolvedValue(null),
  getPopupWidth: vi.fn().mockResolvedValue(600),
  setPopupWidth: vi.fn().mockResolvedValue(undefined),
  getShowHoverCards: vi.fn().mockResolvedValue(true),
  setShowHoverCards: vi.fn().mockResolvedValue(undefined),
  getEnableDesktopNotifications: vi.fn().mockResolvedValue(false),
  setEnableDesktopNotifications: vi.fn().mockResolvedValue(undefined),
  getMaxDesktopNotifications: vi.fn().mockResolvedValue(5),
}));

vi.mock('../src/lib/theme.js', () => ({
  applyTheme: vi.fn(),
}));

vi.mock('../src/popup/notification-renderer.js', () => ({
  initRenderer: vi.fn(),
  renderNotifications: vi.fn(),
  getCachedNotifications: vi.fn().mockReturnValue(null),
  clearNotificationCache: vi.fn(),
}));

vi.mock('../src/lib/constants.js', () => ({
  ANIMATION_DURATION: {
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
  },
  TOKEN_PREFIXES: ['ghp_', 'github_pat_'],
  MESSAGE_TYPES: {
    LOGIN: 'login',
    LOGOUT: 'logout',
    GET_STATE: 'getState',
    GET_RATE_LIMIT: 'getRateLimit',
    OPEN_NOTIFICATION: 'openNotification',
    MARK_AS_READ: 'markAsRead',
    MARK_ALL_AS_READ: 'markAllAsRead',
    MARK_REPO_AS_READ: 'markRepoAsRead',
    REFRESH: 'refresh',
  },
  NOTIFICATION_TYPES: {
    ISSUE: 'Issue',
    PULL_REQUEST: 'PullRequest',
    RELEASE: 'Release',
  },
  MIN_POPUP_WIDTH: 400,
  MAX_POPUP_WIDTH: 800,
  DEFAULT_POPUP_WIDTH: 600,
  POPUP_WIDTH_STEP: 50,
  TIMING_THRESHOLDS: {
    ALARM_RESET_DETECTION: 5000,
    WORKFLOW_MATCH_WINDOW: 300000,
  },
  TIME_CONVERSION: { MS_PER_MINUTE: 60000 },
}));

// -- Minimal DOM (must exist before popup.js import so getElementById succeeds)

document.body.innerHTML = `
  <button id="oauth-method"></button>
  <button id="pat-method"></button>
  <button id="pat-cancel-btn"></button>
  <button id="pat-login-btn"></button>
  <input id="pat-input" />
  <div id="login-error" hidden></div>
  <button id="settings-icon-btn"></button>
  <button id="settings-back-btn"></button>
  <input id="popup-width-input" type="number" value="600" />
  <button id="width-decrease"></button>
  <button id="width-increase"></button>
  <input id="hover-cards-toggle" type="checkbox" />
  <input id="desktop-notifications-toggle" type="checkbox" />
  <button id="settings-logout-btn"></button>
  <button id="refresh-btn"></button>
  <button id="mark-all-btn"></button>
  <span id="refresh-countdown"></span>
  <div id="login-view" hidden></div>
  <div id="main-view" hidden></div>
  <div id="auth-methods"></div>
  <div id="pat-input-form" hidden></div>
  <ul id="notifications-list"></ul>
  <div id="empty-state" hidden></div>
  <div id="settings-view" hidden></div>
  <div id="username"></div>
  <img id="user-avatar" hidden />
  <a id="user-profile-link"></a>
  <div id="notifications-container"></div>
  <span id="settings-username"></span>
  <img id="settings-avatar" />
  <a id="settings-avatar-link"></a>
  <a id="settings-username-link"></a>
  <span id="settings-auth-method"></span>
`;

// matchMedia is not available in jsdom
window.matchMedia = vi.fn().mockReturnValue({ addEventListener: vi.fn() });

// -- Load modules ------------------------------------------------------------

const { alarms } = await import('../src/lib/chrome-api.js');
const { updateCountdown } = await import('../src/popup/popup.js');

// -- Tests -------------------------------------------------------------------

const BASE_TIME = 1_700_000_000_000;

describe('updateCountdown — alarm reset detection', () => {
  let refreshCountdownEl;
  let dateSpy;

  beforeEach(async () => {
    refreshCountdownEl = document.getElementById('refresh-countdown');
    // Reset lastAlarmTime to null by calling updateCountdown with no alarm
    alarms.getAll.mockResolvedValueOnce([]);
    await updateCountdown();
  });

  afterEach(() => {
    dateSpy?.mockRestore();
  });

  it('skips display update when alarm reset is detected', async () => {
    dateSpy = vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME - 30_000);

    // Tick 1: normal update — establishes lastAlarmTime and displays countdown
    alarms.getAll.mockResolvedValueOnce([{ name: 'check-notifications', scheduledTime: BASE_TIME }]);
    await updateCountdown();
    expect(refreshCountdownEl.textContent).toBe('30s');

    // Tick 2: scheduledTime jumps > 5000ms — alarm reset
    alarms.getAll.mockResolvedValueOnce([{ name: 'check-notifications', scheduledTime: BASE_TIME + 10_000 }]);
    await updateCountdown();

    // Display must not change during the reset tick
    expect(refreshCountdownEl.textContent).toBe('30s');
  });

  it('shows correct countdown on the tick after alarm reset', async () => {
    dateSpy = vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME - 30_000);

    // Tick 1: normal update
    alarms.getAll.mockResolvedValueOnce([{ name: 'check-notifications', scheduledTime: BASE_TIME }]);
    await updateCountdown();

    // Tick 2: alarm reset — early return, display frozen at '30s'
    alarms.getAll.mockResolvedValueOnce([{ name: 'check-notifications', scheduledTime: BASE_TIME + 10_000 }]);
    await updateCountdown();

    // Tick 3: same scheduled time, no reset — display refreshes
    alarms.getAll.mockResolvedValueOnce([{ name: 'check-notifications', scheduledTime: BASE_TIME + 10_000 }]);
    await updateCountdown();

    // remaining = (BASE_TIME + 10_000) - (BASE_TIME - 30_000) = 40_000ms → 40s
    expect(refreshCountdownEl.textContent).toBe('40s');
  });
});
