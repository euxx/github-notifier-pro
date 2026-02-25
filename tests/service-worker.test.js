import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mock Chrome APIs
const mockAction = {
  setBadgeText: vi.fn().mockResolvedValue(undefined),
  setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
  setTitle: vi.fn().mockResolvedValue(undefined),
};

const mockAlarms = {
  create: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
  getAll: vi.fn().mockResolvedValue([]),
  onAlarm: {
    addListener: vi.fn(),
  },
};

const mockRuntime = {
  sendMessage: vi.fn().mockResolvedValue(undefined),
  onMessage: {
    addListener: vi.fn(),
  },
  onStartup: {
    addListener: vi.fn(),
  },
  onInstalled: {
    addListener: vi.fn(),
  },
  getURL: vi.fn((path) => `chrome-extension://test-id/${path}`),
};

const mockTabs = {
  create: vi.fn().mockResolvedValue({ id: 1 }),
};

const mockNotifications = {
  create: vi.fn().mockResolvedValue('notification-id'),
  clear: vi.fn().mockResolvedValue(true),
  onClicked: {
    addListener: vi.fn(),
  },
};

const mockStorage = {
  local: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  },
  onChanged: {
    addListener: vi.fn(),
  },
};

// Mock chrome-api module
vi.mock('../src/lib/chrome-api.js', () => ({
  action: mockAction,
  alarms: mockAlarms,
  runtime: mockRuntime,
  tabs: mockTabs,
  notifications: mockNotifications,
  storage: mockStorage,
}));

// Mock storage module
const mockStorageFunctions = {
  getToken: vi.fn(),
  setToken: vi.fn(),
  getUsername: vi.fn(),
  setUsername: vi.fn(),
  getUserInfo: vi.fn(),
  setUserInfo: vi.fn(),
  getNotifications: vi.fn(),
  setNotifications: vi.fn(),
  getAuthMethod: vi.fn(),
  setAuthMethod: vi.fn(),
  getEnableDesktopNotifications: vi.fn(),
  getMaxDesktopNotifications: vi.fn(),
  clear: vi.fn(),
};

vi.mock('../src/lib/storage.js', () => mockStorageFunctions);

// Mock github-api module
const mockGithub = {
  token: null,
  username: null,
  isAuthenticated: false,
  login: vi.fn(),
  logout: vi.fn(),
  fetchUsername: vi.fn(),
  getNotifications: vi.fn(),
  getNotificationDetails: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
  markRepoAsRead: vi.fn(),
  getRateLimitInfo: vi.fn(() => ({ resetIn: '5 min' })),
};

vi.mock('../src/lib/github-api.js', () => ({
  default: mockGithub,
  github: mockGithub,
}));

// Mock constants
vi.mock('../src/lib/constants.js', () => ({
  ALARM_NAME: 'check-notifications',
  DEFAULT_POLL_INTERVAL_MINUTES: 1,
  MIN_POLL_INTERVAL_SECONDS: 60,
  MAX_POLL_INTERVAL_SECONDS: 600,
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
    CHECK_SUITE: 'CheckSuite',
  },
  NOTIFICATION_TYPE_ICONS: {
    Issue: 'issue',
    PullRequest: 'pr',
    Release: 'release',
    CheckSuite: 'actions',
  },
}));

// Mock format-utils
vi.mock('../src/lib/format-utils.js', () => ({
  formatReason: vi.fn((reason) => reason || 'Unknown'),
}));

// Mock url-builder
vi.mock('../src/lib/url-builder.js', () => ({
  buildNotificationUrl: vi.fn(
    (notif) => notif.html_url || `https://github.com/${notif.repository?.full_name || 'test/repo'}`,
  ),
}));

// Capture the message handler when service-worker registers it
let messageHandler = null;
let notificationClickHandler = null;

mockRuntime.onMessage.addListener.mockImplementation((handler) => {
  messageHandler = handler;
});

mockAlarms.onAlarm.addListener.mockImplementation((_handler) => {
  // Alarm handler captured but not used in tests
});

mockNotifications.onClicked.addListener.mockImplementation((handler) => {
  notificationClickHandler = handler;
});

// Import helper functions for testing (after mocks are set up)
const {
  getIconForType,
  updateNotificationDetails,
  copyCachedDetails,
  showDesktopNotificationsForNew,
  NOTIFICATION_ID_PREFIX,
  AGGREGATED_NOTIFICATION_ID,
  NOTIFICATION_DELAY_MS,
  GITHUB_NOTIFICATIONS_URL,
} = await import('../src/background/service-worker.js');

describe('service-worker', () => {
  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Reset github state
    mockGithub.token = null;
    mockGithub.username = null;
    mockGithub.isAuthenticated = false;

    // Setup default storage responses
    mockStorageFunctions.getToken.mockResolvedValue(null);
    mockStorageFunctions.getUsername.mockResolvedValue(null);
    mockStorageFunctions.getNotifications.mockResolvedValue([]);
    mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(false);
    mockStorageFunctions.setToken.mockResolvedValue(undefined);
    mockStorageFunctions.setUsername.mockResolvedValue(undefined);
    mockStorageFunctions.setNotifications.mockResolvedValue(undefined);
    mockStorageFunctions.setAuthMethod.mockResolvedValue(undefined);
    mockStorageFunctions.clear.mockResolvedValue(undefined);

    // Import service-worker to trigger initialization
    // Use dynamic import with cache busting
    vi.resetModules();
    await import('../src/background/service-worker.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should register message listener on import', () => {
      expect(mockRuntime.onMessage.addListener).toHaveBeenCalled();
      expect(messageHandler).toBeDefined();
    });

    it('should register alarm listener on import', () => {
      expect(mockAlarms.onAlarm.addListener).toHaveBeenCalled();
    });

    it('should register notification click listener on import', () => {
      expect(mockNotifications.onClicked.addListener).toHaveBeenCalled();
    });

    it('should register startup and install listeners', () => {
      expect(mockRuntime.onStartup.addListener).toHaveBeenCalled();
      expect(mockRuntime.onInstalled.addListener).toHaveBeenCalled();
    });

    it('should show ? badge when not authenticated', async () => {
      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: '?' });
      expect(mockAction.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#6B7280' });
    });
  });

  describe('handleMessage - LOGIN', () => {
    it('should login with PAT token', async () => {
      mockGithub.fetchUsername.mockResolvedValue('testuser');
      mockGithub.token = 'ghp_test';
      mockGithub.username = 'testuser';
      mockGithub.isAuthenticated = true;
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      const sendResponse = vi.fn();

      messageHandler({ action: 'login', authMethod: 'pat', token: 'ghp_test' }, {}, sendResponse);

      // Wait for async handling
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGithub.fetchUsername).toHaveBeenCalled();
      expect(mockStorageFunctions.setToken).toHaveBeenCalledWith('ghp_test');
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          username: 'testuser',
        }),
      );
    });

    it('should return error on login failure', async () => {
      mockGithub.fetchUsername.mockRejectedValue(new Error('Invalid token'));

      const sendResponse = vi.fn();

      messageHandler({ action: 'login', authMethod: 'pat', token: 'invalid' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Invalid token',
        }),
      );
    });
  });

  describe('handleMessage - LOGOUT', () => {
    it('should logout and clear state', async () => {
      const sendResponse = vi.fn();

      messageHandler({ action: 'logout' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGithub.logout).toHaveBeenCalled();
      expect(mockAlarms.clear).toHaveBeenCalledWith('check-notifications');
      expect(mockStorageFunctions.clear).toHaveBeenCalled();
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: '?' });
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('handleMessage - GET_STATE', () => {
    it('should return current state', async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.username = 'testuser';
      mockStorageFunctions.getNotifications.mockResolvedValue([{ id: '1', title: 'Test' }]);

      const sendResponse = vi.fn();

      messageHandler({ action: 'getState' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          isAuthenticated: true,
          username: 'testuser',
          notifications: [{ id: '1', title: 'Test' }],
        }),
      );
    });

    it('should fetch username from storage if not in memory', async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.username = null;
      mockStorageFunctions.getUsername.mockResolvedValue('storeduser');
      mockStorageFunctions.getNotifications.mockResolvedValue([]);

      const sendResponse = vi.fn();

      messageHandler({ action: 'getState' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockStorageFunctions.getUsername).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'storeduser',
        }),
      );
    });
  });

  describe('handleMessage - GET_RATE_LIMIT', () => {
    it('should return rate limit info', async () => {
      const sendResponse = vi.fn();

      messageHandler({ action: 'getRateLimit' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGithub.getRateLimitInfo).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        rateLimit: { resetIn: '5 min' },
      });
    });
  });

  describe('handleMessage - OPEN_NOTIFICATION', () => {
    it('should open notification URL in new tab', async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([
        {
          id: '123',
          title: 'Test Issue',
          html_url: 'https://github.com/owner/repo/issues/1',
          repository: { full_name: 'owner/repo' },
        },
      ]);
      mockGithub.markAsRead.mockResolvedValue(true);
      mockGithub.isAuthenticated = true;

      const sendResponse = vi.fn();

      messageHandler({ action: 'openNotification', notificationId: '123' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockTabs.create).toHaveBeenCalledWith({
        url: 'https://github.com/owner/repo/issues/1',
      });
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        }),
      );
    });

    it('should throw error for non-existent notification', async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([]);

      const sendResponse = vi.fn();

      messageHandler({ action: 'openNotification', notificationId: 'nonexistent' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Notification not found',
      });
    });
  });

  describe('handleMessage - MARK_AS_READ', () => {
    it('should mark notification as read and update storage', async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: '123', title: 'Test' },
        { id: '456', title: 'Another' },
      ]);
      mockGithub.markAsRead.mockResolvedValue(true);

      const sendResponse = vi.fn();

      messageHandler({ action: 'markAsRead', notificationId: '123' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGithub.markAsRead).toHaveBeenCalledWith('123');
      expect(mockStorageFunctions.setNotifications).toHaveBeenCalledWith([{ id: '456', title: 'Another' }]);
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: '1' });
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('should return error on API failure', async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([{ id: '123', title: 'Test' }]);
      mockGithub.markAsRead.mockRejectedValue(new Error('API Error'));

      const sendResponse = vi.fn();

      messageHandler({ action: 'markAsRead', notificationId: '123' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'API Error',
      });
    });

    it('should preserve + badge suffix when hasMore is true', async () => {
      // Seed hasMore state from a successful refresh result
      mockGithub.isAuthenticated = true;
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: true, count: 0 });
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: '123', title: 'Test' },
        { id: '456', title: 'Another' },
      ]);
      mockGithub.markAsRead.mockResolvedValue(true);

      const refreshResponse = vi.fn();
      messageHandler({ action: 'refresh' }, {}, refreshResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const sendResponse = vi.fn();
      messageHandler({ action: 'markAsRead', notificationId: '123' }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: '1+' });
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('handleMessage - MARK_ALL_AS_READ', () => {
    it('should mark all notifications as read', async () => {
      mockGithub.markAllAsRead.mockResolvedValue(true);

      const sendResponse = vi.fn();

      messageHandler({ action: 'markAllAsRead' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGithub.markAllAsRead).toHaveBeenCalled();
      expect(mockStorageFunctions.setNotifications).toHaveBeenCalledWith([]);
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: '' });
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('handleMessage - MARK_REPO_AS_READ', () => {
    it('should mark repository notifications as read', async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: '123', repository: { full_name: 'owner/repo' }, title: 'Test 1' },
        { id: '456', repository: { full_name: 'other/repo' }, title: 'Test 2' },
      ]);
      mockGithub.markRepoAsRead.mockResolvedValue(true);

      const sendResponse = vi.fn();

      messageHandler({ action: 'markRepoAsRead', owner: 'owner', repo: 'repo' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGithub.markRepoAsRead).toHaveBeenCalledWith('owner', 'repo');
      expect(mockStorageFunctions.setNotifications).toHaveBeenCalledWith([
        { id: '456', repository: { full_name: 'other/repo' }, title: 'Test 2' },
      ]);
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: '1' });
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('should return error on API failure', async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: '123', repository: { full_name: 'owner/repo' }, title: 'Test' },
      ]);
      mockGithub.markRepoAsRead.mockRejectedValue(new Error('API Error'));

      const sendResponse = vi.fn();

      messageHandler({ action: 'markRepoAsRead', owner: 'owner', repo: 'repo' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'API Error',
      });
    });

    it('should preserve + badge suffix when hasMore is true', async () => {
      // Seed hasMore state from a successful refresh result
      mockGithub.isAuthenticated = true;
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: true, count: 0 });
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: '123', repository: { full_name: 'owner/repo' }, title: 'Test 1' },
        { id: '456', repository: { full_name: 'other/repo' }, title: 'Test 2' },
      ]);
      mockGithub.markRepoAsRead.mockResolvedValue(true);

      const refreshResponse = vi.fn();
      messageHandler({ action: 'refresh' }, {}, refreshResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const sendResponse = vi.fn();
      messageHandler({ action: 'markRepoAsRead', owner: 'owner', repo: 'repo' }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: '1+' });
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('handleMessage - REFRESH', () => {
    it('should refresh notifications and reset alarm', async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      const sendResponse = vi.fn();

      messageHandler({ action: 'refresh' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockAlarms.clear).toHaveBeenCalledWith('check-notifications');
      expect(mockAlarms.create).toHaveBeenCalledWith('check-notifications', {
        delayInMinutes: 1,
        periodInMinutes: 1,
      });
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('dynamic polling interval', () => {
    it('should update alarm when poll interval changes on 200 response', async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.pollInterval = 60; // Start with 60 seconds
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      const sendResponse = vi.fn();
      messageHandler({ action: 'login', authMethod: 'pat', token: 'ghp_test' }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Clear previous calls
      mockAlarms.clear.mockClear();
      mockAlarms.create.mockClear();

      // Change poll interval and trigger check
      mockGithub.pollInterval = 120; // Change to 120 seconds
      mockGithub.fetchUsername.mockResolvedValue('testuser');

      messageHandler({ action: 'refresh' }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should update alarm with new interval (2 minutes)
      expect(mockAlarms.clear).toHaveBeenCalledWith('check-notifications');
      expect(mockAlarms.create).toHaveBeenCalledWith('check-notifications', {
        delayInMinutes: 2,
        periodInMinutes: 2,
      });
    });

    it('should update alarm when poll interval changes on 304 response', async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.pollInterval = 60; // Start with 60 seconds
      mockGithub.getNotifications.mockResolvedValue(null); // 304 Not Modified

      const sendResponse = vi.fn();
      messageHandler({ action: 'login', authMethod: 'pat', token: 'ghp_test' }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Clear previous calls
      mockAlarms.clear.mockClear();
      mockAlarms.create.mockClear();

      // Change poll interval (simulating GitHub sending new X-Poll-Interval on 304)
      mockGithub.pollInterval = 180; // Change to 180 seconds
      mockGithub.fetchUsername.mockResolvedValue('testuser');

      messageHandler({ action: 'refresh' }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should update alarm even on 304 (3 minutes)
      expect(mockAlarms.clear).toHaveBeenCalledWith('check-notifications');
      expect(mockAlarms.create).toHaveBeenCalledWith('check-notifications', {
        delayInMinutes: 3,
        periodInMinutes: 3,
      });
    });

    it('should clamp poll interval to minimum (60s / 1min)', async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.pollInterval = 30; // Below minimum
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      const sendResponse = vi.fn();
      messageHandler({ action: 'refresh' }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should clamp to 1 minute minimum
      expect(mockAlarms.create).toHaveBeenCalledWith('check-notifications', {
        delayInMinutes: 1,
        periodInMinutes: 1,
      });
    });

    it('should clamp poll interval to maximum (600s / 10min)', async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.pollInterval = 1200; // Above maximum (20 minutes)
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      const sendResponse = vi.fn();
      messageHandler({ action: 'refresh' }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should clamp to 10 minutes maximum
      expect(mockAlarms.create).toHaveBeenCalledWith('check-notifications', {
        delayInMinutes: 10,
        periodInMinutes: 10,
      });
    });

    it('should not update alarm if interval unchanged', async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.pollInterval = 120; // 2 minutes
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      const sendResponse = vi.fn();
      messageHandler({ action: 'refresh' }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Trigger another refresh with same interval
      mockAlarms.clear.mockClear();
      mockAlarms.create.mockClear();

      messageHandler({ action: 'refresh' }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should still create alarm (as part of REFRESH logic) but with same interval
      expect(mockAlarms.create).toHaveBeenCalledWith('check-notifications', {
        delayInMinutes: 2,
        periodInMinutes: 2,
      });
    });
  });

  describe('handleMessage - unknown action', () => {
    it('should return error for unknown action', async () => {
      const sendResponse = vi.fn();

      messageHandler({ action: 'unknownAction' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Unknown action: unknownAction',
      });
    });
  });

  describe('badge updates', () => {
    it('should show empty badge when count is 0', async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      const sendResponse = vi.fn();
      messageHandler({ action: 'markAllAsRead' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: '' });
    });

    it('should show count on badge when notifications exist', async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }]);
      mockGithub.markAsRead.mockResolvedValue(true);

      const sendResponse = vi.fn();
      messageHandler({ action: 'markAsRead', notificationId: '1' }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // After removing one, should show 2
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: '2' });
    });
  });
});

describe('service-worker helper functions', () => {
  // Using exported helper functions from service-worker.js

  describe('getIconForType', () => {
    it('should return correct icon for Issue', () => {
      expect(getIconForType('Issue')).toBe('issue');
    });

    it('should return correct icon for PullRequest', () => {
      expect(getIconForType('PullRequest')).toBe('pr');
    });

    it('should return correct icon for Release', () => {
      expect(getIconForType('Release')).toBe('release');
    });

    it('should return correct icon for CheckSuite', () => {
      expect(getIconForType('CheckSuite')).toBe('actions');
    });

    it('should return notification for unknown type', () => {
      expect(getIconForType('Unknown')).toBe('notification');
    });
  });

  describe('updateNotificationDetails', () => {
    it('should update Issue state', () => {
      const baseData = {};
      const details = { state: 'open' };

      updateNotificationDetails(baseData, details, 'Issue');

      expect(baseData.state).toBe('open');
    });

    it('should update PR state and merged flag', () => {
      const baseData = {};
      const details = { state: 'closed', merged: true };

      updateNotificationDetails(baseData, details, 'PullRequest');

      expect(baseData.state).toBe('closed');
      expect(baseData.merged).toBe(true);
    });

    it('should update CheckSuite conclusion and status', () => {
      const baseData = {};
      const details = { conclusion: 'success', status: 'completed' };

      updateNotificationDetails(baseData, details, 'CheckSuite');

      expect(baseData.conclusion).toBe('success');
      expect(baseData.status).toBe('completed');
      expect(baseData.state).toBeUndefined();
    });

    it('should extract author from user field', () => {
      const baseData = {};
      const details = {
        state: 'open',
        user: {
          login: 'testuser',
          avatar_url: 'https://avatar.url',
          html_url: 'https://github.com/testuser',
        },
      };

      updateNotificationDetails(baseData, details, 'Issue');

      expect(baseData.author).toEqual({
        login: 'testuser',
        avatar_url: 'https://avatar.url',
        html_url: 'https://github.com/testuser',
      });
    });

    it('should extract author from author field as fallback', () => {
      const baseData = {};
      const details = {
        state: 'open',
        author: {
          login: 'authoruser',
          avatar_url: 'https://author.avatar',
          html_url: 'https://github.com/authoruser',
        },
      };

      updateNotificationDetails(baseData, details, 'Issue');

      expect(baseData.author.login).toBe('authoruser');
    });

    it('should copy all additional fields', () => {
      const baseData = {};
      const details = {
        state: 'open',
        comments: 5,
        number: 42,
        created_at: '2024-01-01T00:00:00Z',
        body: 'Description',
        html_url: 'https://github.com/issue/42',
      };

      updateNotificationDetails(baseData, details, 'Issue');

      expect(baseData.comment_count).toBe(5);
      expect(baseData.number).toBe(42);
      expect(baseData.created_at).toBe('2024-01-01T00:00:00Z');
      expect(baseData.body).toBe('Description');
      expect(baseData.html_url).toBe('https://github.com/issue/42');
    });

    it('should copy empty-string body (not skip it as falsy)', () => {
      const baseData = { body: 'old body' };
      const details = { body: '' };

      updateNotificationDetails(baseData, details, 'Issue');

      // An empty string body is a valid API response and must overwrite the cached value
      expect(baseData.body).toBe('');
    });

    it('should copy null body (explicit null means no content, overwrites stale cache)', () => {
      const baseData = { body: 'old body' };
      const details = { body: null };

      updateNotificationDetails(baseData, details, 'Issue');

      expect(baseData.body).toBeNull();
    });

    it('should not copy body when field is absent (undefined means API did not return it)', () => {
      const baseData = { body: 'keep me' };
      const details = {}; // body is undefined / not in response

      updateNotificationDetails(baseData, details, 'Issue');

      expect(baseData.body).toBe('keep me');
    });
  });

  describe('copyCachedDetails', () => {
    it('should copy all defined cached fields', () => {
      const baseData = {};
      const existing = {
        state: 'closed',
        merged: true,
        author: { login: 'user' },
        comment_count: 10,
        number: 99,
        created_at: '2024-01-01',
        body: 'Body text',
        html_url: 'https://url',
      };

      copyCachedDetails(baseData, existing);

      expect(baseData.state).toBe('closed');
      expect(baseData.merged).toBe(true);
      expect(baseData.author).toEqual({ login: 'user' });
      expect(baseData.comment_count).toBe(10);
      expect(baseData.number).toBe(99);
    });

    it('should not copy undefined fields', () => {
      const baseData = { existingField: 'keep' };
      const existing = {
        state: 'open',
        // merged is not defined
      };

      copyCachedDetails(baseData, existing);

      expect(baseData.state).toBe('open');
      expect(baseData.merged).toBeUndefined();
      expect(baseData.existingField).toBe('keep');
    });

    it('should copy detailsFailed flag', () => {
      const baseData = {};
      const existing = { detailsFailed: true };

      copyCachedDetails(baseData, existing);

      expect(baseData.detailsFailed).toBe(true);
    });
  });

  describe('showDesktopNotificationsForNew', () => {
    /**
     * Helper to run showDesktopNotificationsForNew and flush timers
     */
    const runWithTimers = async (notifications) => {
      const promise = showDesktopNotificationsForNew(notifications);
      await vi.runAllTimersAsync();
      await promise;
    };

    beforeEach(() => {
      vi.clearAllMocks();
      // Use fake timers to speed up tests and avoid real delays
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it('should do nothing when desktop notifications are disabled', async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(false);

      const notifications = [{ id: '1', isNew: true }];
      await showDesktopNotificationsForNew(notifications);

      // Should still clear aggregated notification even when disabled
      expect(mockNotifications.clear).toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID);
      // But should not create any new notifications
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    it('should clear previous aggregated notification', async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(5);

      const notifications = [{ id: '1', isNew: true }];
      await showDesktopNotificationsForNew(notifications);

      expect(mockNotifications.clear).toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID);
    });

    it('should do nothing when there are no new notifications', async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(5);

      const notifications = [
        { id: '1', isNew: false },
        { id: '2', isNew: false },
      ];
      await showDesktopNotificationsForNew(notifications);

      // Should clear old aggregated notification even with no new ones
      expect(mockNotifications.clear).toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID);
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    it('should clear aggregated notification even when notification list is empty', async () => {
      await showDesktopNotificationsForNew([]);

      // Should clear old aggregated notification to prevent stale notifications
      expect(mockNotifications.clear).toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID);
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    it('should clear aggregated notification even with null/undefined input', async () => {
      await showDesktopNotificationsForNew(null);
      expect(mockNotifications.clear).toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID);
      expect(mockNotifications.create).not.toHaveBeenCalled();

      vi.clearAllMocks();

      await showDesktopNotificationsForNew(undefined);
      expect(mockNotifications.clear).toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID);
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    it('should show all notifications when count is below limit', async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(5);

      const notifications = [
        { id: '1', isNew: true, title: 'Notif 1', repository: { full_name: 'repo1' }, reason: 'mention' },
        { id: '2', isNew: true, title: 'Notif 2', repository: { full_name: 'repo2' }, reason: 'assign' },
        { id: '3', isNew: true, title: 'Notif 3', repository: { full_name: 'repo3' }, reason: 'review' },
      ];
      await runWithTimers(notifications);

      expect(mockNotifications.create).toHaveBeenCalledTimes(3);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        `${NOTIFICATION_ID_PREFIX}1`,
        expect.objectContaining({
          type: 'basic',
          title: 'Notif 1',
        }),
      );
    });

    it('should limit notifications to max and show aggregated notification', async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(3);

      const notifications = [
        { id: '1', isNew: true, title: 'N1', repository: { full_name: 'r1' }, reason: 'm' },
        { id: '2', isNew: true, title: 'N2', repository: { full_name: 'r2' }, reason: 'a' },
        { id: '3', isNew: true, title: 'N3', repository: { full_name: 'r3' }, reason: 'r' },
        { id: '4', isNew: true, title: 'N4', repository: { full_name: 'r4' }, reason: 's' },
        { id: '5', isNew: true, title: 'N5', repository: { full_name: 'r5' }, reason: 'c' },
        { id: '6', isNew: true, title: 'N6', repository: { full_name: 'r6' }, reason: 't' },
      ];
      await runWithTimers(notifications);

      // Should create 3 individual notifications + 1 aggregated
      expect(mockNotifications.create).toHaveBeenCalledTimes(4);

      // Check individual notifications
      expect(mockNotifications.create).toHaveBeenCalledWith(`${NOTIFICATION_ID_PREFIX}1`, expect.any(Object));
      expect(mockNotifications.create).toHaveBeenCalledWith(`${NOTIFICATION_ID_PREFIX}2`, expect.any(Object));
      expect(mockNotifications.create).toHaveBeenCalledWith(`${NOTIFICATION_ID_PREFIX}3`, expect.any(Object));

      // Check aggregated notification
      expect(mockNotifications.create).toHaveBeenCalledWith(
        AGGREGATED_NOTIFICATION_ID,
        expect.objectContaining({
          type: 'basic',
          title: 'GitHub Notifications',
          message: '... and 3 more new notifications',
        }),
      );
    });

    it('should handle edge case with exactly max notifications', async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(5);

      const notifications = Array.from({ length: 5 }, (_, i) => ({
        id: `${i + 1}`,
        isNew: true,
        title: `N${i + 1}`,
        repository: { full_name: 'repo' },
        reason: 'test',
      }));
      await runWithTimers(notifications);

      // Should create exactly 5 notifications, no aggregated
      expect(mockNotifications.create).toHaveBeenCalledTimes(5);

      // Should not create aggregated notification
      expect(mockNotifications.create).not.toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID, expect.any(Object));
    });

    it('should handle edge case with max = 1', async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(1);

      const notifications = [
        { id: '1', isNew: true, title: 'N1', repository: { full_name: 'r1' }, reason: 'm' },
        { id: '2', isNew: true, title: 'N2', repository: { full_name: 'r2' }, reason: 'a' },
        { id: '3', isNew: true, title: 'N3', repository: { full_name: 'r3' }, reason: 'r' },
      ];
      await runWithTimers(notifications);

      // Should create 1 individual + 1 aggregated
      expect(mockNotifications.create).toHaveBeenCalledTimes(2);
      expect(mockNotifications.create).toHaveBeenCalledWith(`${NOTIFICATION_ID_PREFIX}1`, expect.any(Object));
      expect(mockNotifications.create).toHaveBeenCalledWith(
        AGGREGATED_NOTIFICATION_ID,
        expect.objectContaining({
          message: '... and 2 more new notifications',
        }),
      );
    });

    it('should use singular form for 1 remaining notification', async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(1);

      const notifications = [
        { id: '1', isNew: true, title: 'N1', repository: { full_name: 'r1' }, reason: 'm' },
        { id: '2', isNew: true, title: 'N2', repository: { full_name: 'r2' }, reason: 'a' },
      ];
      await runWithTimers(notifications);

      expect(mockNotifications.create).toHaveBeenCalledWith(
        AGGREGATED_NOTIFICATION_ID,
        expect.objectContaining({
          message: '... and 1 more new notification',
        }),
      );
    });

    it('should continue showing notifications even if clear fails', async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(5);
      mockNotifications.clear.mockRejectedValueOnce(new Error('Clear failed'));

      const notifications = [{ id: '1', isNew: true, title: 'N1', repository: { full_name: 'r1' }, reason: 'm' }];
      await runWithTimers(notifications);

      // Should still create the notification even though clear failed
      expect(mockNotifications.create).toHaveBeenCalledWith(`${NOTIFICATION_ID_PREFIX}1`, expect.any(Object));
    });

    it('should add 1-second delays between notifications', async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(5);

      // Spy on setTimeout to verify delays
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      const notifications = [
        { id: '1', isNew: true, title: 'N1', repository: { full_name: 'r1' }, reason: 'm' },
        { id: '2', isNew: true, title: 'N2', repository: { full_name: 'r2' }, reason: 'a' },
        { id: '3', isNew: true, title: 'N3', repository: { full_name: 'r3' }, reason: 'r' },
      ];

      const promise = showDesktopNotificationsForNew(notifications);
      await vi.runAllTimersAsync();
      await promise;

      // Should have 2 delays between 3 notifications (before 2nd and 3rd)
      const delayCalls = setTimeoutSpy.mock.calls.filter((call) => call[1] === NOTIFICATION_DELAY_MS);
      expect(delayCalls.length).toBe(2);

      setTimeoutSpy.mockRestore();
    });

    it('should add delay before aggregated notification', async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(2);

      // Spy on setTimeout to verify delays
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      const notifications = [
        { id: '1', isNew: true, title: 'N1', repository: { full_name: 'r1' }, reason: 'm' },
        { id: '2', isNew: true, title: 'N2', repository: { full_name: 'r2' }, reason: 'a' },
        { id: '3', isNew: true, title: 'N3', repository: { full_name: 'r3' }, reason: 'r' },
      ];

      const promise = showDesktopNotificationsForNew(notifications);
      await vi.runAllTimersAsync();
      await promise;

      // Should have 2 delays: 1 between notifications + 1 before aggregated
      const delayCalls = setTimeoutSpy.mock.calls.filter((call) => call[1] === NOTIFICATION_DELAY_MS);
      expect(delayCalls.length).toBe(2);

      setTimeoutSpy.mockRestore();
    });
  });

  describe('notification click handler', () => {
    /**
     * Helper to click a notification (with null-guard)
     */
    const clickNotification = async (id) => {
      if (!notificationClickHandler) {
        throw new Error('Notification click handler not registered. Make sure service-worker module is imported.');
      }
      return notificationClickHandler(id);
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should handle aggregated notification click', async () => {
      // Click the aggregated notification
      await clickNotification(AGGREGATED_NOTIFICATION_ID);

      // Should clear the aggregated notification
      expect(mockNotifications.clear).toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID);

      // Should open GitHub notifications page
      expect(mockTabs.create).toHaveBeenCalledWith({ url: GITHUB_NOTIFICATIONS_URL });
    });

    it('should handle individual notification click', async () => {
      const testNotification = {
        id: '123',
        subject: { title: 'Test PR', url: 'https://api.github.com/repos/owner/repo/pulls/456', type: 'PullRequest' },
        repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
      };

      mockStorageFunctions.getNotifications.mockResolvedValue([testNotification]);
      mockGithub.markAsRead.mockResolvedValue(undefined);

      // Click the individual notification
      await clickNotification(`${NOTIFICATION_ID_PREFIX}123`);

      // Should clear the notification
      expect(mockNotifications.clear).toHaveBeenCalledWith(`${NOTIFICATION_ID_PREFIX}123`);

      // Should open the repository URL (since subject.url is an API URL, it falls back to repo URL)
      expect(mockTabs.create).toHaveBeenCalledWith({ url: 'https://github.com/owner/repo' });

      // Should mark as read
      expect(mockGithub.markAsRead).toHaveBeenCalledWith('123');

      // Should remove from storage
      expect(mockStorageFunctions.setNotifications).toHaveBeenCalledWith([]);
    });

    it('should continue opening tab even if clear fails on aggregated notification', async () => {
      // Make clear fail
      mockNotifications.clear.mockRejectedValueOnce(new Error('Clear failed'));

      // Click the aggregated notification
      await clickNotification(AGGREGATED_NOTIFICATION_ID);

      // Should still open GitHub notifications page even though clear failed
      expect(mockTabs.create).toHaveBeenCalledWith({ url: GITHUB_NOTIFICATIONS_URL });
    });

    it('should continue mark as read even if clear fails on individual notification', async () => {
      const testNotification = {
        id: '123',
        subject: { title: 'Test PR', url: 'https://api.github.com/repos/owner/repo/pulls/456', type: 'PullRequest' },
        repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
      };

      mockStorageFunctions.getNotifications.mockResolvedValue([testNotification]);
      mockGithub.markAsRead.mockResolvedValue(undefined);

      // Make clear fail
      mockNotifications.clear.mockRejectedValueOnce(new Error('Clear failed'));

      // Click the individual notification
      await clickNotification(`${NOTIFICATION_ID_PREFIX}123`);

      // Should still open tab, mark as read, and update badge even though clear failed
      expect(mockTabs.create).toHaveBeenCalledWith({ url: 'https://github.com/owner/repo' });
      expect(mockGithub.markAsRead).toHaveBeenCalledWith('123');
      expect(mockStorageFunctions.setNotifications).toHaveBeenCalledWith([]);
    });
  });
});
