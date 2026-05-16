import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  create: vi.fn().mockResolvedValue("notification-id"),
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
  session: {
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
vi.mock("../src/lib/chrome-api.js", () => ({
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
  getNotificationFilter: vi.fn(),
  setNotificationFilter: vi.fn(),
  getNotificationFilterStats: vi.fn(),
  setNotificationFilterStats: vi.fn(),
  getSyncEnabled: vi.fn(),
  setSyncEnabled: vi.fn(),
  getSyncGistId: vi.fn(),
  setSyncGistId: vi.fn(),
  getSyncLastPush: vi.fn(),
  setSyncLastPush: vi.fn(),
  getSyncLastPushedFilter: vi.fn(),
  setSyncLastPushedFilter: vi.fn(),
  clear: vi.fn(),
  clearAuthData: vi.fn(),
  setMultiple: vi.fn(),
};

vi.mock("../src/lib/storage.js", () => mockStorageFunctions);

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
  getLatestCommentUrl: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
  markRepoAsRead: vi.fn(),
  getRateLimitInfo: vi.fn(() => ({ resetIn: "5 min" })),
  createFilterGist: vi.fn(),
  updateFilterGist: vi.fn(),
  getFilterGist: vi.fn(),
  getFilterGistMeta: vi.fn(),
  findFilterGist: vi.fn(),
};

vi.mock("../src/lib/github-api.js", () => ({
  default: mockGithub,
  github: mockGithub,
}));

// Mock constants
vi.mock("../src/lib/constants.js", () => ({
  ALARM_NAME: "check-notifications",
  MIN_POLL_INTERVAL_SECONDS: 60,
  MAX_POLL_INTERVAL_SECONDS: 600,
  MESSAGE_TYPES: {
    LOGIN: "login",
    LOGOUT: "logout",
    GET_STATE: "getState",
    GET_RATE_LIMIT: "getRateLimit",
    OPEN_NOTIFICATION: "openNotification",
    OPEN_LATEST_COMMENT: "openLatestComment",
    MARK_AS_READ: "markAsRead",
    MARK_ALL_AS_READ: "markAllAsRead",
    MARK_REPO_AS_READ: "markRepoAsRead",
    REFRESH: "refresh",
    GET_NOTIFICATION_FILTER: "getNotificationFilter",
    SET_NOTIFICATION_FILTER: "setNotificationFilter",
    SYNC_GET_STATE: "syncGetState",
    SYNC_ENABLE: "syncEnable",
    SYNC_DISABLE: "syncDisable",
    SYNC_PUSH: "syncPush",
    SYNC_PULL: "syncPull",
    SYNC_RESOLVE_CONFLICT: "syncResolveConflict",
  },
  NOTIFICATION_TYPES: {
    ISSUE: "Issue",
    PULL_REQUEST: "PullRequest",
    RELEASE: "Release",
    CHECK_SUITE: "CheckSuite",
  },
  NOTIFICATION_TYPE_ICONS: {
    Issue: "issue",
    PullRequest: "pr",
    Release: "release",
    CheckSuite: "actions",
  },
  CONCURRENCY: {
    PRIORITY: 5,
    BACKGROUND: 3,
    VISIBLE_COUNT: 10,
  },
}));

// Mock format-utils
vi.mock("../src/lib/format-utils.js", () => ({
  formatReason: vi.fn((reason) => reason || "Unknown"),
  getReasonPriority: vi.fn(() => null),
}));

// Mock http (classifyError is the only piece service-worker imports from here)
vi.mock("../src/lib/http.js", () => ({
  classifyError: vi.fn((error) => {
    const msg = error?.message || "";
    if (msg.includes("Rate limited")) return "rate-limited";
    if (msg.includes("timeout")) return "timeout";
    if (msg.includes("NetworkError") || msg.includes("Failed to fetch")) return "offline";
    return "unknown";
  }),
}));

// Mock url-builder
vi.mock("../src/lib/url-builder.js", () => ({
  buildNotificationUrl: vi.fn(
    (notif) => notif.html_url || `https://github.com/${notif.repository?.full_name || "test/repo"}`,
  ),
}));

// Capture the message handler when service-worker registers it
let messageHandler = null;
let notificationClickHandler = null;

mockRuntime.onMessage.addListener.mockImplementation((handler) => {
  messageHandler = handler;
});

// Resolves when sendResponse fires; fire-and-forget work is not awaited here.
function callHandler(message) {
  return new Promise((resolve) => {
    messageHandler(message, {}, resolve);
  });
}

let alarmHandler = null;
mockAlarms.onAlarm.addListener.mockImplementation((handler) => {
  alarmHandler = handler;
});

mockNotifications.onClicked.addListener.mockImplementation((handler) => {
  notificationClickHandler = handler;
});

// Import helper functions for testing (after mocks are set up)
const { latestCommentUrlCache } = await import("../src/background/service-worker.js");
const { NOTIFICATION_ID_PREFIX, AGGREGATED_NOTIFICATION_ID, GITHUB_NOTIFICATIONS_URL } =
  await import("../src/background/desktop-notifications.js");

// Mutable reference that always points to the latestCommentUrlCache of the most recently
// imported service-worker module. Updated in beforeEach after vi.resetModules().
let currentCommentUrlCache = latestCommentUrlCache;

// Get a handle on the url-builder mock to allow per-test overrides
const { buildNotificationUrl: mockBuildNotificationUrl } =
  await import("../src/lib/url-builder.js");

describe("service-worker", () => {
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
    mockStorageFunctions.getNotificationFilter.mockResolvedValue([]);
    mockStorageFunctions.setToken.mockResolvedValue(undefined);
    mockStorageFunctions.setUsername.mockResolvedValue(undefined);
    mockStorageFunctions.setNotifications.mockResolvedValue(undefined);
    mockStorageFunctions.setAuthMethod.mockResolvedValue(undefined);
    mockStorageFunctions.setNotificationFilter.mockResolvedValue(undefined);
    mockStorageFunctions.getNotificationFilterStats.mockResolvedValue([]);
    mockStorageFunctions.setNotificationFilterStats.mockResolvedValue(undefined);
    mockStorageFunctions.getSyncEnabled.mockResolvedValue(false);
    mockStorageFunctions.setSyncEnabled.mockResolvedValue(undefined);
    mockStorageFunctions.getSyncGistId.mockResolvedValue(null);
    mockStorageFunctions.setSyncGistId.mockResolvedValue(undefined);
    mockStorageFunctions.getSyncLastPush.mockResolvedValue(null);
    mockStorageFunctions.setSyncLastPush.mockResolvedValue(undefined);
    mockStorageFunctions.getSyncLastPushedFilter.mockResolvedValue(null);
    mockStorageFunctions.setSyncLastPushedFilter.mockResolvedValue(undefined);
    mockStorageFunctions.clear.mockResolvedValue(undefined);

    // Default session storage responses (the fetcher's persist/restore call
    // these on every commit; without defaults vi would emit unhandled promise
    // rejections in fire-and-forget paths).
    mockStorage.session.get.mockResolvedValue({});
    mockStorage.session.set.mockResolvedValue(undefined);

    // Import service-worker to trigger initialization
    // Use dynamic import with cache busting
    vi.resetModules();
    const freshModule = await import("../src/background/service-worker.js");

    // Update the mutable reference so cache-related tests always use the fresh Map
    currentCommentUrlCache = freshModule.latestCommentUrlCache;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initialization", () => {
    it("should register message listener on import", () => {
      expect(mockRuntime.onMessage.addListener).toHaveBeenCalled();
      expect(messageHandler).toBeDefined();
    });

    it("should register alarm listener on import", () => {
      expect(mockAlarms.onAlarm.addListener).toHaveBeenCalled();
    });

    it("should register notification click listener on import", () => {
      expect(mockNotifications.onClicked.addListener).toHaveBeenCalled();
    });

    it("should register startup and install listeners", () => {
      expect(mockRuntime.onStartup.addListener).toHaveBeenCalled();
      expect(mockRuntime.onInstalled.addListener).toHaveBeenCalled();
    });

    it("should show ? badge when not authenticated", async () => {
      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "?" });
      expect(mockAction.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: "#6B7280" });
    });
  });

  describe("handleMessage - LOGIN", () => {
    it("should login with PAT token", async () => {
      mockGithub.fetchUsername.mockResolvedValue("testuser");
      mockGithub.token = "ghp_test";
      mockGithub.username = "testuser";
      mockGithub.isAuthenticated = true;
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      const result = await callHandler({ action: "login", authMethod: "pat", token: "ghp_test" });

      expect(mockGithub.fetchUsername).toHaveBeenCalled();
      expect(mockStorageFunctions.setToken).toHaveBeenCalledWith("ghp_test");
      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          username: "testuser",
        }),
      );
    });

    it("should return error on login failure", async () => {
      mockGithub.fetchUsername.mockRejectedValue(new Error("Invalid token"));

      const result = await callHandler({ action: "login", authMethod: "pat", token: "invalid" });

      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          error: "Invalid token",
        }),
      );
    });
  });

  describe("handleMessage - LOGOUT", () => {
    it("should logout and clear state", async () => {
      const result = await callHandler({ action: "logout" });

      expect(mockGithub.logout).toHaveBeenCalled();
      expect(mockAlarms.clear).toHaveBeenCalledWith("check-notifications");
      expect(mockStorageFunctions.clearAuthData).toHaveBeenCalled();
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "?" });
      expect(result).toEqual({ success: true });
    });
  });

  describe("handleMessage - GET_STATE", () => {
    it("should return current state", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.username = "testuser";
      mockStorageFunctions.getNotifications.mockResolvedValue([{ id: "1", title: "Test" }]);

      const result = await callHandler({ action: "getState" });

      expect(result).toEqual(
        expect.objectContaining({
          isAuthenticated: true,
          username: "testuser",
          notifications: [{ id: "1", title: "Test" }],
        }),
      );
    });

    it("should fetch username from storage if not in memory", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.username = null;
      mockStorageFunctions.getUsername.mockResolvedValue("storeduser");
      mockStorageFunctions.getNotifications.mockResolvedValue([]);

      const result = await callHandler({ action: "getState" });

      expect(mockStorageFunctions.getUsername).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          username: "storeduser",
        }),
      );
    });
  });

  describe("handleMessage - GET_RATE_LIMIT", () => {
    it("should return rate limit info", async () => {
      const result = await callHandler({ action: "getRateLimit" });

      expect(mockGithub.getRateLimitInfo).toHaveBeenCalled();
      expect(result).toEqual({
        rateLimit: { resetIn: "5 min" },
      });
    });
  });

  describe("handleMessage - OPEN_NOTIFICATION", () => {
    it("should open notification URL in new tab", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([
        {
          id: "123",
          title: "Test Issue",
          html_url: "https://github.com/owner/repo/issues/1",
          repository: { full_name: "owner/repo" },
        },
      ]);
      mockGithub.markAsRead.mockResolvedValue(true);
      mockGithub.isAuthenticated = true;

      const result = await callHandler({ action: "openNotification", notificationId: "123" });

      expect(mockTabs.create).toHaveBeenCalledWith({
        url: "https://github.com/owner/repo/issues/1",
      });
      expect(result).toEqual(
        expect.objectContaining({
          success: true,
        }),
      );
    });

    it("should throw error for non-existent notification", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([]);

      const result = await callHandler({
        action: "openNotification",
        notificationId: "nonexistent",
      });

      expect(result).toEqual({
        error: "Notification not found",
      });
    });

    it("should return error response when notification has no usable URL", async () => {
      // Simulate buildNotificationUrl throwing on corrupted repository data
      vi.mocked(mockBuildNotificationUrl).mockImplementationOnce(() => {
        throw new Error("Cannot build notification URL: repository data is incomplete");
      });

      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: "999", type: "Issue", repository: {} },
      ]);

      const result = await callHandler({ action: "openNotification", notificationId: "999" });

      expect(mockTabs.create).not.toHaveBeenCalled();
      // Verify an error response was sent without pinning the message wording.
      expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }));
    });
  });

  describe("handleMessage - OPEN_LATEST_COMMENT", () => {
    beforeEach(() => {
      // Clear the cache before each test
      currentCommentUrlCache.clear();
    });

    it("should open tab with comment URL from getLatestCommentUrl (no cache)", async () => {
      const notification = {
        id: "200",
        title: "Test Issue",
        type: "Issue",
        number: 5,
        updated_at: "2024-01-01T00:00:00Z",
        html_url: "https://github.com/owner/repo/issues/5",
        repository: { full_name: "owner/repo" },
      };
      mockStorageFunctions.getNotifications.mockResolvedValue([notification]);
      mockGithub.getLatestCommentUrl.mockResolvedValue(
        "https://github.com/owner/repo/issues/5#issuecomment-67890",
      );
      mockGithub.markAsRead.mockResolvedValue(true);
      mockGithub.isAuthenticated = true;

      const result = await callHandler({ action: "openLatestComment", notificationId: "200" });

      expect(mockTabs.create).toHaveBeenCalledWith({
        url: "https://github.com/owner/repo/issues/5#issuecomment-67890",
      });
      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("should use prefetched cache when cache entry matches updated_at", async () => {
      const notification = {
        id: "202",
        title: "Test Issue",
        type: "Issue",
        number: 7,
        updated_at: "2024-06-01T00:00:00Z",
        html_url: "https://github.com/owner/repo/issues/7",
        repository: { full_name: "owner/repo" },
      };
      // Pre-populate cache with a valid entry
      currentCommentUrlCache.set("202", {
        url: "https://github.com/owner/repo/issues/7#issuecomment-cached",
        updated_at: "2024-06-01T00:00:00Z",
      });
      mockStorageFunctions.getNotifications.mockResolvedValue([notification]);
      mockGithub.markAsRead.mockResolvedValue(true);
      mockGithub.isAuthenticated = true;

      await callHandler({ action: "openLatestComment", notificationId: "202" });

      expect(mockTabs.create).toHaveBeenCalledWith({
        url: "https://github.com/owner/repo/issues/7#issuecomment-cached",
      });
      // getLatestCommentUrl should NOT have been called when cache hits
      expect(mockGithub.getLatestCommentUrl).not.toHaveBeenCalled();
    });

    it("should ignore stale cache entry and call API when updated_at mismatch", async () => {
      const notification = {
        id: "203",
        title: "Test Issue",
        type: "Issue",
        number: 8,
        updated_at: "2024-07-01T00:00:00Z", // newer than cached
        html_url: "https://github.com/owner/repo/issues/8",
        repository: { full_name: "owner/repo" },
      };
      // Pre-populate cache with a stale entry (different updated_at)
      currentCommentUrlCache.set("203", {
        url: "https://github.com/owner/repo/issues/8#issuecomment-old",
        updated_at: "2024-01-01T00:00:00Z",
      });
      mockStorageFunctions.getNotifications.mockResolvedValue([notification]);
      mockGithub.getLatestCommentUrl.mockResolvedValue(
        "https://github.com/owner/repo/issues/8#issuecomment-new",
      );
      mockGithub.markAsRead.mockResolvedValue(true);
      mockGithub.isAuthenticated = true;

      await callHandler({ action: "openLatestComment", notificationId: "203" });

      // Must use fresh URL, not the stale cached one
      expect(mockTabs.create).toHaveBeenCalledWith({
        url: "https://github.com/owner/repo/issues/8#issuecomment-new",
      });
      expect(mockGithub.getLatestCommentUrl).toHaveBeenCalledTimes(1);
    });

    it("should fall back to notification URL when getLatestCommentUrl returns null", async () => {
      const notification = {
        id: "201",
        title: "Test PR",
        type: "PullRequest",
        number: 10,
        updated_at: "2024-01-01T00:00:00Z",
        html_url: "https://github.com/owner/repo/pull/10",
        repository: { full_name: "owner/repo" },
      };
      mockStorageFunctions.getNotifications.mockResolvedValue([notification]);
      mockGithub.getLatestCommentUrl.mockResolvedValue(null);
      mockGithub.markAsRead.mockResolvedValue(true);
      mockGithub.isAuthenticated = true;

      const result = await callHandler({ action: "openLatestComment", notificationId: "201" });

      expect(mockTabs.create).toHaveBeenCalledWith({
        url: "https://github.com/owner/repo/pull/10",
      });
      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it("should throw error for non-existent notification", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([]);

      const result = await callHandler({
        action: "openLatestComment",
        notificationId: "nonexistent",
      });

      expect(result).toEqual({ error: "Notification not found" });
    });
  });

  describe("handleMessage - MARK_AS_READ", () => {
    it("should mark notification as read and update storage", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: "123", title: "Test" },
        { id: "456", title: "Another" },
      ]);
      mockGithub.markAsRead.mockResolvedValue(true);

      const result = await callHandler({ action: "markAsRead", notificationId: "123" });

      expect(mockGithub.markAsRead).toHaveBeenCalledWith("123");
      expect(mockStorageFunctions.setNotifications).toHaveBeenCalledWith([
        { id: "456", title: "Another" },
      ]);
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "1" });
      expect(result).toEqual({ success: true });
    });

    it("should return error on API failure", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([{ id: "123", title: "Test" }]);
      mockGithub.markAsRead.mockRejectedValue(new Error("API Error"));

      const result = await callHandler({ action: "markAsRead", notificationId: "123" });

      expect(result).toEqual({
        success: false,
        error: "API Error",
      });
    });

    it("should preserve + badge suffix when hasMore is true", async () => {
      // Seed hasMore state from a successful refresh result
      mockGithub.isAuthenticated = true;
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: true, count: 0 });
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: "123", title: "Test" },
        { id: "456", title: "Another" },
      ]);
      mockGithub.markAsRead.mockResolvedValue(true);

      await callHandler({ action: "refresh" });

      const result = await callHandler({ action: "markAsRead", notificationId: "123" });

      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "1+" });
      expect(result).toEqual({ success: true });
    });
  });

  describe("handleMessage - MARK_ALL_AS_READ", () => {
    it("should mark all notifications as read", async () => {
      mockGithub.markAllAsRead.mockResolvedValue(true);

      const result = await callHandler({ action: "markAllAsRead" });

      expect(mockGithub.markAllAsRead).toHaveBeenCalled();
      expect(mockStorageFunctions.setNotifications).toHaveBeenCalledWith([]);
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "" });
      expect(result).toEqual({ success: true });
    });
  });

  describe("handleMessage - MARK_REPO_AS_READ", () => {
    it("should mark repository notifications as read", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: "123", repository: { full_name: "owner/repo" }, title: "Test 1" },
        { id: "456", repository: { full_name: "other/repo" }, title: "Test 2" },
      ]);
      mockGithub.markRepoAsRead.mockResolvedValue(true);

      const result = await callHandler({ action: "markRepoAsRead", owner: "owner", repo: "repo" });

      expect(mockGithub.markRepoAsRead).toHaveBeenCalledWith("owner", "repo");
      expect(mockStorageFunctions.setNotifications).toHaveBeenCalledWith([
        { id: "456", repository: { full_name: "other/repo" }, title: "Test 2" },
      ]);
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "1" });
      expect(result).toEqual({
        success: true,
        notifications: [{ id: "456", repository: { full_name: "other/repo" }, title: "Test 2" }],
      });
    });

    it("should return error on API failure", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: "123", repository: { full_name: "owner/repo" }, title: "Test" },
      ]);
      mockGithub.markRepoAsRead.mockRejectedValue(new Error("API Error"));

      const result = await callHandler({ action: "markRepoAsRead", owner: "owner", repo: "repo" });

      expect(result).toEqual({
        success: false,
        error: "API Error",
      });
    });

    it("should preserve + badge suffix when hasMore is true", async () => {
      // Seed hasMore state from a successful refresh result
      mockGithub.isAuthenticated = true;
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: true, count: 0 });
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: "123", repository: { full_name: "owner/repo" }, title: "Test 1" },
        { id: "456", repository: { full_name: "other/repo" }, title: "Test 2" },
      ]);
      mockGithub.markRepoAsRead.mockResolvedValue(true);

      await callHandler({ action: "refresh" });

      const result = await callHandler({ action: "markRepoAsRead", owner: "owner", repo: "repo" });

      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "1+" });
      expect(result).toEqual({
        success: true,
        notifications: [{ id: "456", repository: { full_name: "other/repo" }, title: "Test 2" }],
      });
    });
  });

  describe("handleMessage - REFRESH", () => {
    it("should refresh notifications and reset alarm", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      const result = await callHandler({ action: "refresh" });

      expect(mockAlarms.clear).toHaveBeenCalledWith("check-notifications");
      expect(mockAlarms.create).toHaveBeenCalledWith("check-notifications", {
        delayInMinutes: 1,
        periodInMinutes: 1,
      });
      expect(result).toEqual({ success: true });
    });

    it("should reset lastModified to force non-conditional request", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.lastModified = "Thu, 01 Jan 2025 00:00:00 GMT";
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      await callHandler({ action: "refresh" });

      expect(mockGithub.lastModified).toBeNull();
    });
  });

  describe("dynamic polling interval", () => {
    it("should update alarm when poll interval changes on 200 response", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.pollInterval = 60; // Start with 60 seconds
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      await callHandler({ action: "login", authMethod: "pat", token: "ghp_test" });

      // Clear previous calls
      mockAlarms.clear.mockClear();
      mockAlarms.create.mockClear();

      // Change poll interval and trigger check
      mockGithub.pollInterval = 120; // Change to 120 seconds
      mockGithub.fetchUsername.mockResolvedValue("testuser");

      await callHandler({ action: "refresh" });

      // Should update alarm with new interval (2 minutes)
      expect(mockAlarms.clear).toHaveBeenCalledWith("check-notifications");
      expect(mockAlarms.create).toHaveBeenCalledWith("check-notifications", {
        delayInMinutes: 2,
        periodInMinutes: 2,
      });
    });

    it("should update alarm when poll interval changes on 304 response", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.pollInterval = 60; // Start with 60 seconds
      mockGithub.getNotifications.mockResolvedValue(null); // 304 Not Modified

      await callHandler({ action: "login", authMethod: "pat", token: "ghp_test" });

      // Clear previous calls
      mockAlarms.clear.mockClear();
      mockAlarms.create.mockClear();

      // Change poll interval (simulating GitHub sending new X-Poll-Interval on 304)
      mockGithub.pollInterval = 180; // Change to 180 seconds
      mockGithub.fetchUsername.mockResolvedValue("testuser");

      await callHandler({ action: "refresh" });

      // Should update alarm even on 304 (3 minutes)
      expect(mockAlarms.clear).toHaveBeenCalledWith("check-notifications");
      expect(mockAlarms.create).toHaveBeenCalledWith("check-notifications", {
        delayInMinutes: 3,
        periodInMinutes: 3,
      });
    });

    it("should clamp poll interval to minimum (60s / 1min)", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.pollInterval = 30; // Below minimum
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      await callHandler({ action: "refresh" });

      // Should clamp to 1 minute minimum
      expect(mockAlarms.create).toHaveBeenCalledWith("check-notifications", {
        delayInMinutes: 1,
        periodInMinutes: 1,
      });
    });

    it("should clamp poll interval to maximum (600s / 10min)", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.pollInterval = 1200; // Above maximum (20 minutes)
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      await callHandler({ action: "refresh" });

      // Should clamp to 10 minutes maximum
      expect(mockAlarms.create).toHaveBeenCalledWith("check-notifications", {
        delayInMinutes: 10,
        periodInMinutes: 10,
      });
    });

    it("should not update alarm if interval unchanged", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.pollInterval = 120; // 2 minutes
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      await callHandler({ action: "refresh" });

      // Trigger another refresh with same interval
      mockAlarms.clear.mockClear();
      mockAlarms.create.mockClear();

      await callHandler({ action: "refresh" });

      // Should still create alarm (as part of REFRESH logic) but with same interval
      expect(mockAlarms.create).toHaveBeenCalledWith("check-notifications", {
        delayInMinutes: 2,
        periodInMinutes: 2,
      });
    });
  });

  describe("handleMessage - unknown action", () => {
    it("should return error for unknown action", async () => {
      const result = await callHandler({ action: "unknownAction" });

      expect(result).toEqual({
        error: "Unknown action: unknownAction",
      });
    });
  });

  describe("badge updates", () => {
    it("should show empty badge when count is 0", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      await callHandler({ action: "markAllAsRead" });

      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "" });
    });

    it("should show count on badge when notifications exist", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: "1" },
        { id: "2" },
        { id: "3" },
      ]);
      mockGithub.markAsRead.mockResolvedValue(true);

      await callHandler({ action: "markAsRead", notificationId: "1" });

      // After removing one, should show 2
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "2" });
    });
  });
});

describe("service-worker helper functions", () => {
  // Using exported helper functions from service-worker.js

  describe("notification click handler", () => {
    /**
     * Helper to click a notification (with null-guard)
     */
    const clickNotification = async (id) => {
      if (!notificationClickHandler) {
        throw new Error(
          "Notification click handler not registered. Make sure service-worker module is imported.",
        );
      }
      return notificationClickHandler(id);
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should handle aggregated notification click", async () => {
      // Click the aggregated notification
      await clickNotification(AGGREGATED_NOTIFICATION_ID);

      // Should clear the aggregated notification
      expect(mockNotifications.clear).toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID);

      // Should open GitHub notifications page
      expect(mockTabs.create).toHaveBeenCalledWith({ url: GITHUB_NOTIFICATIONS_URL });
    });

    it("should handle individual notification click", async () => {
      const testNotification = {
        id: "123",
        subject: {
          title: "Test PR",
          url: "https://api.github.com/repos/owner/repo/pulls/456",
          type: "PullRequest",
        },
        repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
      };

      mockStorageFunctions.getNotifications.mockResolvedValue([testNotification]);
      mockGithub.markAsRead.mockResolvedValue(undefined);

      // Click the individual notification
      await clickNotification(`${NOTIFICATION_ID_PREFIX}123`);

      // Should clear the notification
      expect(mockNotifications.clear).toHaveBeenCalledWith(`${NOTIFICATION_ID_PREFIX}123`);

      // Should open the repository URL (since subject.url is an API URL, it falls back to repo URL)
      expect(mockTabs.create).toHaveBeenCalledWith({ url: "https://github.com/owner/repo" });

      // Should mark as read
      expect(mockGithub.markAsRead).toHaveBeenCalledWith("123");

      // Should remove from storage
      expect(mockStorageFunctions.setNotifications).toHaveBeenCalledWith([]);
    });

    it("should continue opening tab even if clear fails on aggregated notification", async () => {
      // Make clear fail
      mockNotifications.clear.mockRejectedValueOnce(new Error("Clear failed"));

      // Click the aggregated notification
      await clickNotification(AGGREGATED_NOTIFICATION_ID);

      // Should still open GitHub notifications page even though clear failed
      expect(mockTabs.create).toHaveBeenCalledWith({ url: GITHUB_NOTIFICATIONS_URL });
    });

    it("should continue mark as read even if clear fails on individual notification", async () => {
      const testNotification = {
        id: "123",
        subject: {
          title: "Test PR",
          url: "https://api.github.com/repos/owner/repo/pulls/456",
          type: "PullRequest",
        },
        repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
      };

      mockStorageFunctions.getNotifications.mockResolvedValue([testNotification]);
      mockGithub.markAsRead.mockResolvedValue(undefined);

      // Make clear fail
      mockNotifications.clear.mockRejectedValueOnce(new Error("Clear failed"));

      // Click the individual notification
      await clickNotification(`${NOTIFICATION_ID_PREFIX}123`);

      // Should still open tab, mark as read, and update badge even though clear failed
      expect(mockTabs.create).toHaveBeenCalledWith({ url: "https://github.com/owner/repo" });
      expect(mockGithub.markAsRead).toHaveBeenCalledWith("123");
      expect(mockStorageFunctions.setNotifications).toHaveBeenCalledWith([]);
    });

    it("should not open tab and log error when buildNotificationUrl throws on click", async () => {
      const testNotification = {
        id: "456",
        subject: { type: "Issue", title: "Test" },
        repository: { name: "repo" }, // no full_name/html_url — corrupt
      };

      mockStorageFunctions.getNotifications.mockResolvedValue([testNotification]);

      // Force buildNotificationUrl to throw for this test
      vi.mocked(mockBuildNotificationUrl).mockImplementationOnce(() => {
        throw new Error("repository data is incomplete");
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await clickNotification(`${NOTIFICATION_ID_PREFIX}456`);

      // Behavioral assertions: error is logged, no tab opened
      expect(mockTabs.create).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("storage write failures during checkNotifications", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockGithub.isAuthenticated = true;
      mockGithub.pollInterval = 60;
    });

    it("should set error badge when setNotifications rejects during refresh", async () => {
      mockGithub.getNotifications.mockResolvedValue({
        items: [
          {
            id: "1",
            subject: { title: "Issue 1", type: "Issue", url: null },
            reason: "mention",
            unread: true,
            updated_at: "2024-01-01T00:00:00Z",
            repository: {
              name: "repo",
              full_name: "owner/repo",
              html_url: "https://github.com/owner/repo",
            },
          },
        ],
        hasMore: false,
      });

      mockStorageFunctions.getNotifications.mockResolvedValue([]);
      mockStorageFunctions.setNotifications.mockRejectedValue(new Error("Storage quota exceeded"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await callHandler({ action: "refresh" });

      // The error should propagate to checkNotifications' catch block
      // which sets an error title on the badge
      expect(mockAction.setTitle).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("Storage quota exceeded"),
        }),
      );

      consoleSpy.mockRestore();
    });

    it("should handle getEnableDesktopNotifications rejection gracefully", async () => {
      mockGithub.getNotifications.mockResolvedValue({
        items: [
          {
            id: "1",
            subject: { title: "Issue 1", type: "Issue", url: null },
            reason: "mention",
            unread: true,
            updated_at: "2024-01-01T00:00:00Z",
            repository: {
              name: "repo",
              full_name: "owner/repo",
              html_url: "https://github.com/owner/repo",
            },
          },
        ],
        hasMore: false,
      });

      mockStorageFunctions.getNotifications.mockResolvedValue([]);
      mockStorageFunctions.setNotifications.mockResolvedValue(undefined);
      // Desktop notification preference fetch fails. Use mockRejectedValueOnce
      // so the rejection only applies to this assertion's call; otherwise the
      // fire-and-forget checkNotifications() chain in later tests would keep
      // hitting the same reject and spam stderr.
      mockStorageFunctions.getEnableDesktopNotifications.mockRejectedValueOnce(
        new Error("Storage read error"),
      );

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await callHandler({ action: "refresh" });

      // showDesktopNotificationsForNew catches its own errors internally,
      // so the refresh should still succeed
      expect(result).toEqual({ success: true });

      consoleSpy.mockRestore();
    });

    it("still updates the alarm when X-Poll-Interval changes even if setNotifications throws", async () => {
      // Regression for the fetcher extraction: previously checkNotifications
      // updated the alarm only after fetcher.runFetch() returned, so a later
      // setNotifications failure swallowed the new poll-interval signal.
      // The fix routes the alarm update through onPollIntervalChanged, which
      // fires immediately after github.getNotifications() resolves.
      //
      // Drive the alarm handler directly (not REFRESH) so the assertion isn't
      // masked by REFRESH's own post-checkNotifications alarm reset.
      mockGithub.isAuthenticated = true;
      mockGithub.pollInterval = 60;
      // Establish baseline: a successful fetch at 60s.
      mockGithub.getNotifications.mockResolvedValueOnce({ items: [], hasMore: false, count: 0 });
      mockStorageFunctions.getNotifications.mockResolvedValue([]);
      await alarmHandler({ name: "check-notifications" });

      mockAlarms.clear.mockClear();
      mockAlarms.create.mockClear();

      // Simulate the next response carrying a fresh X-Poll-Interval: the
      // real github client updates `pollInterval` from response headers
      // during the call, so mutate it inside the mock to mirror that.
      mockGithub.getNotifications.mockImplementationOnce(async () => {
        mockGithub.pollInterval = 180;
        return {
          items: [
            {
              id: "1",
              subject: { title: "Issue 1", type: "Issue", url: null },
              reason: "mention",
              unread: true,
              updated_at: "2024-01-01T00:00:00Z",
              repository: {
                name: "repo",
                full_name: "owner/repo",
                html_url: "https://github.com/owner/repo",
              },
            },
          ],
          hasMore: false,
        };
      });
      mockStorageFunctions.setNotifications.mockRejectedValueOnce(
        new Error("Storage quota exceeded"),
      );

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await alarmHandler({ name: "check-notifications" });

      // The alarm must be re-armed with the new 3-minute period even though
      // setNotifications threw later in runFetch.
      expect(mockAlarms.create).toHaveBeenCalledWith("check-notifications", {
        delayInMinutes: 3,
        periodInMinutes: 3,
      });

      consoleSpy.mockRestore();
    });
  });
});

describe("handleMessage - filter and sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleMessage - GET_NOTIFICATION_FILTER", () => {
    it("should return stored filter rules", async () => {
      const rules = [{ repos: ["owner/repo"], keywords: ["beta"] }];
      mockStorageFunctions.getNotificationFilter.mockResolvedValue(rules);

      const result = await callHandler({ action: "getNotificationFilter" });

      expect(result).toEqual({ filter: rules });
    });

    it("should return empty array when no filter is configured", async () => {
      mockStorageFunctions.getNotificationFilter.mockResolvedValue([]);

      const result = await callHandler({ action: "getNotificationFilter" });

      expect(result).toEqual({ filter: [] });
    });
  });

  describe("handleMessage - SET_NOTIFICATION_FILTER", () => {
    it("should save valid filter rules", async () => {
      const rules = [{ repos: ["owner/repo"], keywords: ["beta"] }];
      const result = await callHandler({ action: "setNotificationFilter", filter: rules });

      expect(mockStorageFunctions.setNotificationFilter).toHaveBeenCalledWith(rules);
      expect(result).toEqual({ success: true });
    });

    it("should accept rule with empty repos (global scope)", async () => {
      const rules = [{ repos: [], keywords: ["nightly"] }];
      const result = await callHandler({ action: "setNotificationFilter", filter: rules });

      expect(mockStorageFunctions.setNotificationFilter).toHaveBeenCalledWith(rules);
      expect(result).toEqual({ success: true });
    });

    it("should reject non-array filter", async () => {
      const result = await callHandler({ action: "setNotificationFilter", filter: "bad" });

      expect(result).toEqual(
        expect.objectContaining({ error: expect.stringContaining("filter must be an array") }),
      );
      expect(mockStorageFunctions.setNotificationFilter).not.toHaveBeenCalled();
    });

    it("should reject rule missing repos array", async () => {
      const result = await callHandler({
        action: "setNotificationFilter",
        filter: [{ keywords: ["beta"] }],
      });

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("repos and keywords arrays"),
        }),
      );
    });

    it("should reject rule missing keywords array", async () => {
      const result = await callHandler({
        action: "setNotificationFilter",
        filter: [{ repos: ["owner/repo"] }],
      });

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("repos and keywords arrays"),
        }),
      );
    });

    it("should reject rule with empty keywords", async () => {
      const result = await callHandler({
        action: "setNotificationFilter",
        filter: [{ repos: [], keywords: [] }],
      });

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("at least one keyword"),
        }),
      );
    });

    it("should reject rule with only whitespace/empty-string keywords", async () => {
      const result = await callHandler({
        action: "setNotificationFilter",
        filter: [{ repos: [], keywords: ["", " ", "  "] }],
      });

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("at least one keyword"),
        }),
      );
    });

    it("should trim whitespace from repos and keywords", async () => {
      const rules = [{ repos: [" owner/repo "], keywords: [" beta "] }];
      await callHandler({ action: "setNotificationFilter", filter: rules });

      expect(mockStorageFunctions.setNotificationFilter).toHaveBeenCalledWith([
        { repos: ["owner/repo"], keywords: ["beta"] },
      ]);
    });

    it("should reject rule with non-string repo elements", async () => {
      const result = await callHandler({
        action: "setNotificationFilter",
        filter: [{ repos: [123], keywords: ["beta"] }],
      });

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("arrays of strings"),
        }),
      );
      expect(mockStorageFunctions.setNotificationFilter).not.toHaveBeenCalled();
    });

    it("should reject rule with non-string keyword elements", async () => {
      const result = await callHandler({
        action: "setNotificationFilter",
        filter: [{ repos: [], keywords: [null] }],
      });

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("arrays of strings"),
        }),
      );
      expect(mockStorageFunctions.setNotificationFilter).not.toHaveBeenCalled();
    });

    it("should re-annotate stored notifications with matchedRules when rules match", async () => {
      const storedNotifs = [
        { id: "1", title: "v1.0.0-beta", repository: { full_name: "owner/repo" } },
        { id: "2", title: "Fix bug", repository: { full_name: "owner/repo" } },
        { id: "3", title: "v2.0.0-beta.1", repository: { full_name: "owner/repo" } },
      ];
      mockStorageFunctions.getNotifications.mockResolvedValue(storedNotifs);

      const rules = [{ repos: [], keywords: ["beta"] }];
      const result = await callHandler({ action: "setNotificationFilter", filter: rules });

      const saved = mockStorageFunctions.setNotifications.mock.calls[0][0];
      expect(saved).toHaveLength(3);
      expect(saved[0].matchedRules).toEqual([0]);
      expect(saved[1].matchedRules).toEqual([]);
      expect(saved[2].matchedRules).toEqual([0]);
      expect(result).toEqual({ success: true });
    });

    it("should re-annotate with empty matchedRules when no stored notifications match", async () => {
      const storedNotifs = [{ id: "1", title: "Fix bug", repository: { full_name: "owner/repo" } }];
      mockStorageFunctions.getNotifications.mockResolvedValue(storedNotifs);

      const rules = [{ repos: [], keywords: ["beta"] }];
      const result = await callHandler({ action: "setNotificationFilter", filter: rules });

      const saved = mockStorageFunctions.setNotifications.mock.calls[0][0];
      expect(saved).toHaveLength(1);
      expect(saved[0].matchedRules).toEqual([]);
      expect(result).toEqual({ success: true });
    });

    it("should re-annotate with empty matchedRules when filter is empty", async () => {
      const storedNotifs = [
        { id: "1", title: "v1-beta", repository: { full_name: "owner/repo" }, matchedRules: [0] },
      ];
      mockStorageFunctions.getNotifications.mockResolvedValue(storedNotifs);

      const result = await callHandler({ action: "setNotificationFilter", filter: [] });

      const saved = mockStorageFunctions.setNotifications.mock.calls[0][0];
      expect(saved[0].matchedRules).toEqual([]);
      expect(result).toEqual({ success: true });
    });

    it("triggers sync engine auto-push after debounce when sync is enabled", async () => {
      // Wiring check: this asserts the handler hands off to syncEngine.pushIfEnabled
      // after persisting. The engine's debounce / push behavior is covered by
      // sync-engine.test.js; here we only need to see the eventual updateFilterGist
      // call to know the wire is intact.
      mockStorageFunctions.getSyncEnabled.mockResolvedValue(true);
      mockStorageFunctions.getSyncGistId.mockResolvedValue("gist-id");
      const rules = [{ repos: [], keywords: ["new-kw"] }];
      mockStorageFunctions.getNotificationFilter.mockResolvedValue(rules);
      mockGithub.getFilterGist.mockResolvedValue({
        rules: [{ repos: [], keywords: ["old-kw"] }],
        updatedAt: "2026-01-01T00:00:00Z",
      });
      mockGithub.updateFilterGist.mockResolvedValue({
        id: "gist-id",
        updatedAt: "2026-05-14T10:00:00Z",
      });

      vi.useFakeTimers();
      try {
        await callHandler({ action: "setNotificationFilter", filter: rules });
        // Without advancing timers, the debounced auto-push must not have fired yet.
        // Catches accidental conversion of pushIfEnabled() to a synchronous push().
        expect(mockGithub.updateFilterGist).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2100);
      } finally {
        vi.useRealTimers();
      }

      expect(mockGithub.updateFilterGist).toHaveBeenCalledWith("gist-id", rules);
    });
  });

  describe("handleMessage - SYNC_GET_STATE", () => {
    it("should return sync state", async () => {
      mockStorageFunctions.getSyncEnabled.mockResolvedValue(true);
      mockStorageFunctions.getSyncGistId.mockResolvedValue("abc123");
      mockStorageFunctions.getSyncLastPush.mockResolvedValue("2026-01-01T00:00:00Z");
      const result = await callHandler({ action: "syncGetState" });
      expect(result).toEqual({
        enabled: true,
        gistId: "abc123",
        lastPush: "2026-01-01T00:00:00Z",
      });
    });

    it("should fetch gist meta when lastPush is null but gistId exists", async () => {
      mockStorageFunctions.getSyncEnabled.mockResolvedValue(true);
      mockStorageFunctions.getSyncGistId.mockResolvedValue("abc123");
      mockStorageFunctions.getSyncLastPush.mockResolvedValue(null);
      mockGithub.getFilterGistMeta.mockResolvedValue({
        updated_at: "2026-01-02T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      });
      const result = await callHandler({ action: "syncGetState" });
      expect(mockGithub.getFilterGistMeta).toHaveBeenCalledWith("abc123");
      expect(mockStorageFunctions.setSyncLastPush).toHaveBeenCalledWith("2026-01-02T00:00:00Z");
      expect(result).toEqual({
        enabled: true,
        gistId: "abc123",
        lastPush: "2026-01-02T00:00:00Z",
      });
    });
  });

  describe("handleMessage - SYNC_ENABLE", () => {
    it("should create gist when none exists", async () => {
      mockStorageFunctions.getSyncGistId.mockResolvedValue(null);
      mockGithub.findFilterGist.mockResolvedValue(null);
      mockStorageFunctions.getNotificationFilter.mockResolvedValue([
        { repos: [], keywords: ["test"] },
      ]);
      mockGithub.createFilterGist.mockResolvedValue({
        id: "new-gist-id",
        updatedAt: "2026-05-14T10:00:00Z",
      });
      mockGithub.updateFilterGist.mockResolvedValue({
        id: "new-gist-id",
        updatedAt: "2026-05-14T10:00:00Z",
      });
      const result = await callHandler({ action: "syncEnable" });
      expect(mockGithub.createFilterGist).toHaveBeenCalled();
      expect(mockStorageFunctions.setSyncGistId).toHaveBeenCalledWith("new-gist-id");
      expect(mockStorageFunctions.setSyncEnabled).toHaveBeenCalledWith(true);
      expect(result).toEqual({ success: true, gistId: "new-gist-id" });
    });

    it("should reuse existing gist found by findFilterGist and pull remote rules", async () => {
      mockStorageFunctions.getSyncGistId.mockResolvedValue(null);
      mockGithub.findFilterGist.mockResolvedValue({ id: "found-gist-id", updatedAt: null });
      const remoteRules = [{ repos: ["owner/repo"], keywords: ["nightly"] }];
      mockGithub.getFilterGist.mockResolvedValue({ rules: remoteRules, updatedAt: null });
      mockStorageFunctions.getNotificationFilter.mockResolvedValue([]);
      const result = await callHandler({ action: "syncEnable" });
      expect(mockGithub.createFilterGist).not.toHaveBeenCalled();
      expect(mockStorageFunctions.setSyncGistId).toHaveBeenCalledWith("found-gist-id");
      expect(mockStorageFunctions.setNotificationFilter).toHaveBeenCalledWith(remoteRules);
      expect(result).toEqual({ success: true, gistId: "found-gist-id" });
    });

    it("should return missing_scope when createFilterGist throws with that code", async () => {
      mockStorageFunctions.getSyncGistId.mockResolvedValue(null);
      mockGithub.findFilterGist.mockResolvedValue(null);
      mockStorageFunctions.getNotificationFilter.mockResolvedValue([]);
      const err = new Error("missing_gist_scope");
      err.code = "missing_scope";
      mockGithub.createFilterGist.mockRejectedValue(err);
      const result = await callHandler({ action: "syncEnable" });
      expect(result).toEqual({ success: false, error: "missing_scope" });
    });

    it("should save remote updatedAt to syncLastPush when reusing existing gist", async () => {
      mockStorageFunctions.getSyncGistId.mockResolvedValue(null);
      mockGithub.findFilterGist.mockResolvedValue({
        id: "found-gist-id",
        updatedAt: "2026-05-14T10:00:00Z",
      });
      const remoteRules = [{ repos: ["owner/repo"], keywords: ["nightly"] }];
      mockGithub.getFilterGist.mockResolvedValue({
        rules: remoteRules,
        updatedAt: "2026-05-14T10:00:00Z",
      });
      mockStorageFunctions.getNotificationFilter.mockResolvedValue([]);
      await callHandler({ action: "syncEnable" });
      expect(mockStorageFunctions.setSyncLastPush).toHaveBeenLastCalledWith("2026-05-14T10:00:00Z");
    });

    it("should save createdAt to syncLastPush when creating new gist", async () => {
      mockStorageFunctions.getSyncGistId.mockResolvedValue(null);
      mockGithub.findFilterGist.mockResolvedValue(null);
      mockStorageFunctions.getNotificationFilter.mockResolvedValue([
        { repos: [], keywords: ["x"] },
      ]);
      mockGithub.createFilterGist.mockResolvedValue({
        id: "new-gist-id",
        updatedAt: "2026-05-14T11:00:00Z",
      });
      await callHandler({ action: "syncEnable" });
      expect(mockStorageFunctions.setSyncLastPush).toHaveBeenLastCalledWith("2026-05-14T11:00:00Z");
    });
  });

  describe("handleMessage - SYNC_DISABLE", () => {
    it("should disable sync", async () => {
      const result = await callHandler({ action: "syncDisable" });
      expect(mockStorageFunctions.setSyncEnabled).toHaveBeenCalledWith(false);
      expect(result).toEqual({ success: true });
    });
  });

  describe("handleMessage - SYNC_PUSH", () => {
    it("should push filter to gist", async () => {
      mockStorageFunctions.getSyncEnabled.mockResolvedValue(true);
      mockStorageFunctions.getSyncGistId.mockResolvedValue("gist-id");
      const rules = [{ repos: [], keywords: ["beta"] }];
      mockStorageFunctions.getNotificationFilter.mockResolvedValue(rules);
      mockGithub.getFilterGist.mockResolvedValue({
        rules: [{ repos: [], keywords: ["alpha"] }],
        updatedAt: "2026-01-01T00:00:00Z",
      });
      mockGithub.updateFilterGist.mockResolvedValue({
        id: "gist-id",
        updatedAt: "2026-05-14T10:00:00Z",
      });
      const result = await callHandler({ action: "syncPush" });
      expect(mockGithub.updateFilterGist).toHaveBeenCalledWith("gist-id", rules);
      expect(mockStorageFunctions.setSyncLastPush).toHaveBeenCalledWith("2026-05-14T10:00:00Z");
      expect(mockStorageFunctions.setSyncLastPushedFilter).toHaveBeenCalledWith(rules);
      expect(result).toEqual({ success: true });
    });

    it("should skip push when content is identical", async () => {
      mockStorageFunctions.getSyncEnabled.mockResolvedValue(true);
      mockStorageFunctions.getSyncGistId.mockResolvedValue("gist-id");
      const rules = [{ repos: [], keywords: ["beta"] }];
      mockStorageFunctions.getNotificationFilter.mockResolvedValue(rules);
      mockGithub.getFilterGist.mockResolvedValue({ rules, updatedAt: "2026-01-01T00:00:00Z" });
      const result = await callHandler({ action: "syncPush" });
      expect(mockGithub.updateFilterGist).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, skipped: true });
    });

    it("should fail when sync is disabled", async () => {
      mockStorageFunctions.getSyncEnabled.mockResolvedValue(false);
      const result = await callHandler({ action: "syncPush" });
      expect(result).toEqual({ success: false, error: "sync_disabled" });
    });
  });

  describe("handleMessage - SYNC_PULL", () => {
    it("should pull filter from gist", async () => {
      mockStorageFunctions.getSyncEnabled.mockResolvedValue(true);
      mockStorageFunctions.getSyncGistId.mockResolvedValue("gist-id");
      const remoteRules = [{ repos: ["owner/repo"], keywords: ["nightly"] }];
      mockGithub.getFilterGist.mockResolvedValue({ rules: remoteRules, updatedAt: null });
      mockStorageFunctions.getNotificationFilter.mockResolvedValue([]);
      const result = await callHandler({ action: "syncPull" });
      expect(mockStorageFunctions.setNotificationFilter).toHaveBeenCalledWith(remoteRules);
      expect(result).toEqual({
        success: true,
        filter: remoteRules,
        lastPush: null,
      });
    });

    it("should save remote updatedAt to syncLastPush after successful pull", async () => {
      mockStorageFunctions.getSyncEnabled.mockResolvedValue(true);
      mockStorageFunctions.getSyncGistId.mockResolvedValue("gist-id");
      const remoteRules = [{ repos: ["owner/repo"], keywords: ["nightly"] }];
      mockGithub.getFilterGist.mockResolvedValue({
        rules: remoteRules,
        updatedAt: "2026-05-14T08:00:00Z",
      });
      mockStorageFunctions.getNotificationFilter.mockResolvedValue([]);
      await callHandler({ action: "syncPull" });
      expect(mockStorageFunctions.setSyncLastPush).toHaveBeenCalledWith("2026-05-14T08:00:00Z");
    });

    it("should skip pull when content is identical", async () => {
      mockStorageFunctions.getSyncEnabled.mockResolvedValue(true);
      mockStorageFunctions.getSyncGistId.mockResolvedValue("gist-id");
      const rules = [{ repos: [], keywords: ["beta"] }];
      mockGithub.getFilterGist.mockResolvedValue({ rules, updatedAt: null });
      mockStorageFunctions.getNotificationFilter.mockResolvedValue(rules);
      const result = await callHandler({ action: "syncPull" });
      expect(mockStorageFunctions.setNotificationFilter).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        filter: rules,
        skipped: true,
        lastPush: null,
      });
    });

    it("should detect conflict when local and remote both changed", async () => {
      mockStorageFunctions.getSyncEnabled.mockResolvedValue(true);
      mockStorageFunctions.getSyncGistId.mockResolvedValue("gist-id");
      const localRules = [{ repos: [], keywords: ["local-edit"] }];
      const remoteRules = [{ repos: [], keywords: ["remote-edit"] }];
      mockGithub.getFilterGist.mockResolvedValue({
        rules: remoteRules,
        updatedAt: "2026-05-14T12:00:00Z",
      });
      mockStorageFunctions.getNotificationFilter.mockResolvedValue(localRules);
      mockStorageFunctions.getSyncLastPushedFilter.mockResolvedValue(
        JSON.stringify([{ repos: [], keywords: ["original"] }]),
      );
      mockStorageFunctions.getSyncLastPush.mockResolvedValue("2026-05-14T10:00:00Z");
      const result = await callHandler({ action: "syncPull" });
      expect(result).toEqual(expect.objectContaining({ success: false, error: "conflict" }));
    });

    it("should fail when gist not found", async () => {
      mockStorageFunctions.getSyncEnabled.mockResolvedValue(true);
      mockStorageFunctions.getSyncGistId.mockResolvedValue("gist-id");
      mockGithub.getFilterGist.mockResolvedValue(null);
      const result = await callHandler({ action: "syncPull" });
      expect(result).toEqual({ success: false, error: "gist_not_found" });
    });

    it("should fail when no gist ID stored", async () => {
      mockStorageFunctions.getSyncEnabled.mockResolvedValue(true);
      mockStorageFunctions.getSyncGistId.mockResolvedValue(null);
      const result = await callHandler({ action: "syncPull" });
      expect(result).toEqual({ success: false, error: "no_gist" });
    });

    it("should fail when sync is disabled", async () => {
      mockStorageFunctions.getSyncEnabled.mockResolvedValue(false);
      mockStorageFunctions.getSyncGistId.mockResolvedValue("gist-id");
      const result = await callHandler({ action: "syncPull" });
      expect(result).toEqual({ success: false, error: "sync_disabled" });
    });
  });

  describe("handleMessage - SYNC_RESOLVE_CONFLICT", () => {
    it("should push local filter when choice is local", async () => {
      mockStorageFunctions.getSyncGistId.mockResolvedValue("gist-id");
      const rules = [{ repos: [], keywords: ["local-rule"] }];
      mockStorageFunctions.getNotificationFilter.mockResolvedValue(rules);
      mockGithub.updateFilterGist.mockResolvedValue({
        id: "gist-id",
        updatedAt: "2026-05-14T10:00:00Z",
      });
      const result = await callHandler({ action: "syncResolveConflict", choice: "local" });
      expect(mockGithub.updateFilterGist).toHaveBeenCalledWith("gist-id", rules);
      expect(mockStorageFunctions.setSyncLastPush).toHaveBeenCalledWith("2026-05-14T10:00:00Z");
      expect(mockStorageFunctions.setSyncLastPushedFilter).toHaveBeenCalledWith(rules);
      expect(result).toEqual({ success: true, filter: rules });
    });

    it("should apply remote filter when choice is remote", async () => {
      mockStorageFunctions.getSyncGistId.mockResolvedValue("gist-id");
      const remoteRules = [{ repos: ["owner/repo"], keywords: ["remote-rule"] }];
      mockGithub.getFilterGist.mockResolvedValue({
        rules: remoteRules,
        updatedAt: "2026-05-14T10:00:00Z",
      });
      const result = await callHandler({ action: "syncResolveConflict", choice: "remote" });
      expect(mockStorageFunctions.setNotificationFilter).toHaveBeenCalledWith(remoteRules);
      expect(mockStorageFunctions.setSyncLastPush).toHaveBeenCalledWith("2026-05-14T10:00:00Z");
      expect(result).toEqual({ success: true, filter: remoteRules });
    });

    it("should clear sync state when local push finds gist deleted", async () => {
      mockStorageFunctions.getSyncGistId.mockResolvedValue("gist-id");
      mockStorageFunctions.getNotificationFilter.mockResolvedValue([]);
      mockGithub.updateFilterGist.mockResolvedValue(null);
      const result = await callHandler({ action: "syncResolveConflict", choice: "local" });
      expect(mockStorageFunctions.setSyncGistId).toHaveBeenCalledWith(null);
      expect(mockStorageFunctions.setSyncEnabled).toHaveBeenCalledWith(false);
      expect(result).toEqual({ success: false, error: "gist_not_found" });
    });

    it("should return error for invalid choice", async () => {
      mockStorageFunctions.getSyncGistId.mockResolvedValue("gist-id");
      const result = await callHandler({ action: "syncResolveConflict", choice: "invalid" });
      expect(result).toEqual({ success: false, error: "invalid_choice" });
    });

    it("should return error when no gist ID stored", async () => {
      mockStorageFunctions.getSyncGistId.mockResolvedValue(null);
      const result = await callHandler({ action: "syncResolveConflict", choice: "local" });
      expect(result).toEqual({ success: false, error: "no_gist" });
    });
  });
});
