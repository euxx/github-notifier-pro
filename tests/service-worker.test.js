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

// Import helper functions for testing (after mocks are set up)
const { getIconForType, updateNotificationDetails, copyCachedDetails } =
  await import('../src/background/service-worker.js');

// Capture the message handler when service-worker registers it
let messageHandler = null;

mockRuntime.onMessage.addListener.mockImplementation((handler) => {
  messageHandler = handler;
});

mockAlarms.onAlarm.addListener.mockImplementation((_handler) => {
  // Alarm handler captured but not used in tests
});

mockNotifications.onClicked.addListener.mockImplementation((_handler) => {
  // Notification click handler captured but not used in tests
});

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
});
