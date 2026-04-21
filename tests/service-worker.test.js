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
  clear: vi.fn(),
  clearAuthData: vi.fn(),
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
};

vi.mock("../src/lib/github-api.js", () => ({
  default: mockGithub,
  github: mockGithub,
}));

// Mock constants
vi.mock("../src/lib/constants.js", () => ({
  ALARM_NAME: "check-notifications",
  DEFAULT_POLL_INTERVAL_MINUTES: 1,
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

mockAlarms.onAlarm.addListener.mockImplementation(() => {
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
  prefetchLatestCommentUrls,
  latestCommentUrlCache,
  persistCommentCache,
  restoreCommentCache,
  showDesktopNotificationsForNew,
  matchesNotificationFilter,
  applyNotificationFilterWithStats,
  NOTIFICATION_ID_PREFIX,
  AGGREGATED_NOTIFICATION_ID,
  NOTIFICATION_DELAY_MS,
  GITHUB_NOTIFICATIONS_URL,
} = await import("../src/background/service-worker.js");

// Mutable reference that always points to the latestCommentUrlCache of the most recently
// imported service-worker module. Updated in beforeEach after vi.resetModules().
let currentCommentUrlCache = latestCommentUrlCache;
let currentPrefetchFn = prefetchLatestCommentUrls;

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
    mockStorageFunctions.clear.mockResolvedValue(undefined);

    // Setup default session storage responses (used by persistCommentCache / restoreCommentCache)
    mockStorage.session.get.mockResolvedValue({});
    mockStorage.session.set.mockResolvedValue(undefined);

    // Import service-worker to trigger initialization
    // Use dynamic import with cache busting
    vi.resetModules();
    const freshModule = await import("../src/background/service-worker.js");

    // Update the mutable reference so cache-related tests always use the fresh Map
    currentCommentUrlCache = freshModule.latestCommentUrlCache;
    currentPrefetchFn = freshModule.prefetchLatestCommentUrls;
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

      const sendResponse = vi.fn();

      messageHandler({ action: "login", authMethod: "pat", token: "ghp_test" }, {}, sendResponse);

      // Wait for async handling
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGithub.fetchUsername).toHaveBeenCalled();
      expect(mockStorageFunctions.setToken).toHaveBeenCalledWith("ghp_test");
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          username: "testuser",
        }),
      );
    });

    it("should return error on login failure", async () => {
      mockGithub.fetchUsername.mockRejectedValue(new Error("Invalid token"));

      const sendResponse = vi.fn();

      messageHandler({ action: "login", authMethod: "pat", token: "invalid" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "Invalid token",
        }),
      );
    });
  });

  describe("handleMessage - LOGOUT", () => {
    it("should logout and clear state", async () => {
      const sendResponse = vi.fn();

      messageHandler({ action: "logout" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGithub.logout).toHaveBeenCalled();
      expect(mockAlarms.clear).toHaveBeenCalledWith("check-notifications");
      expect(mockStorageFunctions.clearAuthData).toHaveBeenCalled();
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "?" });
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe("handleMessage - GET_STATE", () => {
    it("should return current state", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.username = "testuser";
      mockStorageFunctions.getNotifications.mockResolvedValue([{ id: "1", title: "Test" }]);

      const sendResponse = vi.fn();

      messageHandler({ action: "getState" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith(
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

      const sendResponse = vi.fn();

      messageHandler({ action: "getState" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockStorageFunctions.getUsername).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          username: "storeduser",
        }),
      );
    });
  });

  describe("handleMessage - GET_RATE_LIMIT", () => {
    it("should return rate limit info", async () => {
      const sendResponse = vi.fn();

      messageHandler({ action: "getRateLimit" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGithub.getRateLimitInfo).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
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

      const sendResponse = vi.fn();

      messageHandler({ action: "openNotification", notificationId: "123" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockTabs.create).toHaveBeenCalledWith({
        url: "https://github.com/owner/repo/issues/1",
      });
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        }),
      );
    });

    it("should throw error for non-existent notification", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([]);

      const sendResponse = vi.fn();

      messageHandler(
        { action: "openNotification", notificationId: "nonexistent" },
        {},
        sendResponse,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
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

      const sendResponse = vi.fn();

      messageHandler({ action: "openNotification", notificationId: "999" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockTabs.create).not.toHaveBeenCalled();
      // Verify an error response was sent without pinning the message wording.
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
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

      const sendResponse = vi.fn();

      messageHandler({ action: "openLatestComment", notificationId: "200" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockTabs.create).toHaveBeenCalledWith({
        url: "https://github.com/owner/repo/issues/5#issuecomment-67890",
      });
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
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

      const sendResponse = vi.fn();

      messageHandler({ action: "openLatestComment", notificationId: "202" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

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

      const sendResponse = vi.fn();

      messageHandler({ action: "openLatestComment", notificationId: "203" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

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

      const sendResponse = vi.fn();

      messageHandler({ action: "openLatestComment", notificationId: "201" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockTabs.create).toHaveBeenCalledWith({
        url: "https://github.com/owner/repo/pull/10",
      });
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it("should throw error for non-existent notification", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([]);

      const sendResponse = vi.fn();

      messageHandler(
        { action: "openLatestComment", notificationId: "nonexistent" },
        {},
        sendResponse,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({ error: "Notification not found" });
    });
  });

  describe("prefetchLatestCommentUrls", () => {
    beforeEach(() => {
      currentCommentUrlCache.clear();
    });

    it("populates cache for Issue notifications with comments", async () => {
      const notifications = [
        {
          id: "n1",
          type: "Issue",
          comment_count: 3,
          updated_at: "2024-01-01T00:00:00Z",
          repository: { full_name: "owner/repo" },
          number: 1,
        },
      ];
      mockGithub.getLatestCommentUrl.mockResolvedValue(
        "https://github.com/owner/repo/issues/1#issuecomment-1",
      );

      await currentPrefetchFn(notifications);

      expect(currentCommentUrlCache.get("n1")).toEqual({
        url: "https://github.com/owner/repo/issues/1#issuecomment-1",
        updated_at: "2024-01-01T00:00:00Z",
      });
    });

    it("does not prefetch for notifications without comments", async () => {
      const notifications = [
        {
          id: "n2",
          type: "Issue",
          comment_count: 0,
          updated_at: "2024-01-01T00:00:00Z",
          repository: { full_name: "owner/repo" },
          number: 2,
        },
      ];

      await currentPrefetchFn(notifications);

      expect(mockGithub.getLatestCommentUrl).not.toHaveBeenCalled();
      expect(currentCommentUrlCache.has("n2")).toBe(false);
    });

    it("does not prefetch for unsupported notification types", async () => {
      const notifications = [
        {
          id: "n3",
          type: "Release",
          comment_count: 5,
          updated_at: "2024-01-01T00:00:00Z",
          repository: { full_name: "owner/repo" },
          number: 3,
        },
      ];

      await currentPrefetchFn(notifications);

      expect(mockGithub.getLatestCommentUrl).not.toHaveBeenCalled();
    });

    it("skips already-cached entries with matching updated_at", async () => {
      currentCommentUrlCache.set("n4", {
        url: "https://github.com/owner/repo/issues/4#issuecomment-cached",
        updated_at: "2024-01-01T00:00:00Z",
      });
      const notifications = [
        {
          id: "n4",
          type: "Issue",
          comment_count: 2,
          updated_at: "2024-01-01T00:00:00Z",
          repository: { full_name: "owner/repo" },
          number: 4,
        },
      ];

      await currentPrefetchFn(notifications);

      // Should not make an API call since cache is fresh
      expect(mockGithub.getLatestCommentUrl).not.toHaveBeenCalled();
    });

    it("re-fetches and updates cache when updated_at changed", async () => {
      currentCommentUrlCache.set("n5", {
        url: "https://github.com/owner/repo/issues/5#issuecomment-old",
        updated_at: "2024-01-01T00:00:00Z",
      });
      const notifications = [
        {
          id: "n5",
          type: "Issue",
          comment_count: 3,
          updated_at: "2024-06-01T00:00:00Z", // newer
          repository: { full_name: "owner/repo" },
          number: 5,
        },
      ];
      mockGithub.getLatestCommentUrl.mockResolvedValue(
        "https://github.com/owner/repo/issues/5#issuecomment-new",
      );

      await currentPrefetchFn(notifications);

      expect(currentCommentUrlCache.get("n5")).toEqual({
        url: "https://github.com/owner/repo/issues/5#issuecomment-new",
        updated_at: "2024-06-01T00:00:00Z",
      });
    });

    it("prunes cache entries for notifications no longer in the list", async () => {
      currentCommentUrlCache.set("removed-notif", {
        url: "https://github.com/owner/repo/issues/99#issuecomment-1",
        updated_at: "2024-01-01T00:00:00Z",
      });
      // Pass empty list (notification was removed)
      await currentPrefetchFn([]);

      expect(currentCommentUrlCache.has("removed-notif")).toBe(false);
    });
  });

  describe("handleMessage - MARK_AS_READ", () => {
    it("should mark notification as read and update storage", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: "123", title: "Test" },
        { id: "456", title: "Another" },
      ]);
      mockGithub.markAsRead.mockResolvedValue(true);

      const sendResponse = vi.fn();

      messageHandler({ action: "markAsRead", notificationId: "123" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGithub.markAsRead).toHaveBeenCalledWith("123");
      expect(mockStorageFunctions.setNotifications).toHaveBeenCalledWith([
        { id: "456", title: "Another" },
      ]);
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "1" });
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it("should return error on API failure", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([{ id: "123", title: "Test" }]);
      mockGithub.markAsRead.mockRejectedValue(new Error("API Error"));

      const sendResponse = vi.fn();

      messageHandler({ action: "markAsRead", notificationId: "123" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
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

      const refreshResponse = vi.fn();
      messageHandler({ action: "refresh" }, {}, refreshResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const sendResponse = vi.fn();
      messageHandler({ action: "markAsRead", notificationId: "123" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "1+" });
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe("handleMessage - MARK_ALL_AS_READ", () => {
    it("should mark all notifications as read", async () => {
      mockGithub.markAllAsRead.mockResolvedValue(true);

      const sendResponse = vi.fn();

      messageHandler({ action: "markAllAsRead" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGithub.markAllAsRead).toHaveBeenCalled();
      expect(mockStorageFunctions.setNotifications).toHaveBeenCalledWith([]);
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "" });
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe("handleMessage - MARK_REPO_AS_READ", () => {
    it("should mark repository notifications as read", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: "123", repository: { full_name: "owner/repo" }, title: "Test 1" },
        { id: "456", repository: { full_name: "other/repo" }, title: "Test 2" },
      ]);
      mockGithub.markRepoAsRead.mockResolvedValue(true);

      const sendResponse = vi.fn();

      messageHandler({ action: "markRepoAsRead", owner: "owner", repo: "repo" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGithub.markRepoAsRead).toHaveBeenCalledWith("owner", "repo");
      expect(mockStorageFunctions.setNotifications).toHaveBeenCalledWith([
        { id: "456", repository: { full_name: "other/repo" }, title: "Test 2" },
      ]);
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "1" });
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        notifications: [{ id: "456", repository: { full_name: "other/repo" }, title: "Test 2" }],
      });
    });

    it("should return error on API failure", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: "123", repository: { full_name: "owner/repo" }, title: "Test" },
      ]);
      mockGithub.markRepoAsRead.mockRejectedValue(new Error("API Error"));

      const sendResponse = vi.fn();

      messageHandler({ action: "markRepoAsRead", owner: "owner", repo: "repo" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
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

      const refreshResponse = vi.fn();
      messageHandler({ action: "refresh" }, {}, refreshResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const sendResponse = vi.fn();
      messageHandler({ action: "markRepoAsRead", owner: "owner", repo: "repo" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "1+" });
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        notifications: [{ id: "456", repository: { full_name: "other/repo" }, title: "Test 2" }],
      });
    });
  });

  describe("handleMessage - REFRESH", () => {
    it("should refresh notifications and reset alarm", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      const sendResponse = vi.fn();

      messageHandler({ action: "refresh" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockAlarms.clear).toHaveBeenCalledWith("check-notifications");
      expect(mockAlarms.create).toHaveBeenCalledWith("check-notifications", {
        delayInMinutes: 1,
        periodInMinutes: 1,
      });
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it("should reset lastModified to force non-conditional request", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.lastModified = "Thu, 01 Jan 2025 00:00:00 GMT";
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      const sendResponse = vi.fn();
      messageHandler({ action: "refresh" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGithub.lastModified).toBeNull();
    });
  });

  describe("dynamic polling interval", () => {
    it("should update alarm when poll interval changes on 200 response", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.pollInterval = 60; // Start with 60 seconds
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      const sendResponse = vi.fn();
      messageHandler({ action: "login", authMethod: "pat", token: "ghp_test" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Clear previous calls
      mockAlarms.clear.mockClear();
      mockAlarms.create.mockClear();

      // Change poll interval and trigger check
      mockGithub.pollInterval = 120; // Change to 120 seconds
      mockGithub.fetchUsername.mockResolvedValue("testuser");

      messageHandler({ action: "refresh" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

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

      const sendResponse = vi.fn();
      messageHandler({ action: "login", authMethod: "pat", token: "ghp_test" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Clear previous calls
      mockAlarms.clear.mockClear();
      mockAlarms.create.mockClear();

      // Change poll interval (simulating GitHub sending new X-Poll-Interval on 304)
      mockGithub.pollInterval = 180; // Change to 180 seconds
      mockGithub.fetchUsername.mockResolvedValue("testuser");

      messageHandler({ action: "refresh" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

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

      const sendResponse = vi.fn();
      messageHandler({ action: "refresh" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

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

      const sendResponse = vi.fn();
      messageHandler({ action: "refresh" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

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

      const sendResponse = vi.fn();
      messageHandler({ action: "refresh" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Trigger another refresh with same interval
      mockAlarms.clear.mockClear();
      mockAlarms.create.mockClear();

      messageHandler({ action: "refresh" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should still create alarm (as part of REFRESH logic) but with same interval
      expect(mockAlarms.create).toHaveBeenCalledWith("check-notifications", {
        delayInMinutes: 2,
        periodInMinutes: 2,
      });
    });
  });

  describe("handleMessage - unknown action", () => {
    it("should return error for unknown action", async () => {
      const sendResponse = vi.fn();

      messageHandler({ action: "unknownAction" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        error: "Unknown action: unknownAction",
      });
    });
  });

  describe("badge updates", () => {
    it("should show empty badge when count is 0", async () => {
      mockGithub.isAuthenticated = true;
      mockGithub.getNotifications.mockResolvedValue({ items: [], hasMore: false, count: 0 });

      const sendResponse = vi.fn();
      messageHandler({ action: "markAllAsRead" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "" });
    });

    it("should show count on badge when notifications exist", async () => {
      mockStorageFunctions.getNotifications.mockResolvedValue([
        { id: "1" },
        { id: "2" },
        { id: "3" },
      ]);
      mockGithub.markAsRead.mockResolvedValue(true);

      const sendResponse = vi.fn();
      messageHandler({ action: "markAsRead", notificationId: "1" }, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // After removing one, should show 2
      expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "2" });
    });
  });

  describe("race condition prevention", () => {
    // Minimal raw GitHub API notification shape
    const makeRawNotif = (id) => ({
      id,
      subject: { title: `Issue ${id}`, type: "Issue", url: null },
      reason: "mention",
      unread: true,
      updated_at: "2024-01-01T00:00:00Z",
      repository: {
        name: "repo",
        full_name: "owner/repo",
        html_url: "https://github.com/owner/repo",
      },
    });

    // Minimal stored notification shape (as returned by storage)
    const makeStoredNotif = (id) => ({
      id,
      updated_at: "2024-01-01T00:00:00Z",
      type: "Issue",
    });

    beforeEach(() => {
      mockGithub.isAuthenticated = true;
      mockGithub.pollInterval = 60;
    });

    it("safeBasic should exclude pre-existing notifications removed during the fetch", async () => {
      // GitHub returns A and B; A was already in storage before the fetch
      mockGithub.getNotifications.mockResolvedValue({
        items: [makeRawNotif("A"), makeRawNotif("B")],
        hasMore: false,
      });

      // First getNotifications call: existingIds snapshot (both A and B present)
      // Second getNotifications call: safeBasic re-read (A was removed by markAsRead during the fetch)
      mockStorageFunctions.getNotifications
        .mockResolvedValueOnce([makeStoredNotif("A"), makeStoredNotif("B")])
        .mockResolvedValueOnce([makeStoredNotif("B")]);

      messageHandler({ action: "refresh" }, {}, vi.fn());
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Find the basic-save setNotifications call (an array write, not the badge)
      const writeCalls = mockStorageFunctions.setNotifications.mock.calls;
      expect(writeCalls.length).toBeGreaterThan(0);

      // The safeBasic write should exclude A (removed during fetch)
      const basicWrite = writeCalls[0][0];
      expect(basicWrite.map((n) => n.id)).not.toContain("A");
      expect(basicWrite.map((n) => n.id)).toContain("B");
    });

    it("safeBasic should always keep new notifications not in existingIds", async () => {
      // GitHub returns A (existing) and C (brand new, not yet in storage)
      mockGithub.getNotifications.mockResolvedValue({
        items: [makeRawNotif("A"), makeRawNotif("C")],
        hasMore: false,
      });

      // First getNotifications: only A existed before the fetch
      // Second getNotifications (safeBasic re-read): still only A in storage
      mockStorageFunctions.getNotifications
        .mockResolvedValueOnce([makeStoredNotif("A")])
        .mockResolvedValueOnce([makeStoredNotif("A")]);

      messageHandler({ action: "refresh" }, {}, vi.fn());
      await new Promise((resolve) => setTimeout(resolve, 100));

      const writeCalls = mockStorageFunctions.setNotifications.mock.calls;
      expect(writeCalls.length).toBeGreaterThan(0);

      const basicWrite = writeCalls[0][0];
      const writtenIds = basicWrite.map((n) => n.id);

      // C is new (not in existingIds) → always kept unconditionally
      expect(writtenIds).toContain("C");
      // A is existing and still in storage → also kept
      expect(writtenIds).toContain("A");
    });

    it("safeBasic should abort when notificationFetchVersion is bumped during re-read", async () => {
      // Hold the second getNotifications call (safeBasic re-read) until we manually release it
      let releaseSafeBasicRead;
      mockStorageFunctions.getNotifications
        .mockResolvedValueOnce([makeStoredNotif("A"), makeStoredNotif("B")]) // existingIds
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseSafeBasicRead = resolve;
            }),
        ); // safeBasic re-read held

      mockGithub.getNotifications.mockResolvedValue({
        items: [makeRawNotif("A"), makeRawNotif("B")],
        hasMore: false,
      });

      // Start checkNotifications (will pause at safeBasic re-read)
      messageHandler({ action: "refresh" }, {}, vi.fn());
      await new Promise((resolve) => setTimeout(resolve, 30));

      // markAsRead bumps notificationFetchVersion before safeBasic resumes
      // slot for markAsRead's own getNotifications call
      mockStorageFunctions.getNotifications.mockResolvedValueOnce([makeStoredNotif("B")]);
      mockGithub.markAsRead.mockResolvedValue(true);
      const markResponse = vi.fn();
      messageHandler({ action: "markAsRead", notificationId: "A" }, {}, markResponse);

      // Wait for markAsRead to complete (bumps version and writes [B])
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Release safeBasic's getNotifications (version is already bumped)
      releaseSafeBasicRead([makeStoredNotif("B")]);
      await new Promise((resolve) => setTimeout(resolve, 30));

      // setNotifications should only have been called by markAsRead (writing [B])
      // safeBasic should have aborted after detecting the version bump
      const writeCalls = mockStorageFunctions.setNotifications.mock.calls;
      // Every write should contain only B (not A)
      writeCalls.forEach((call) => {
        expect(call[0].map((n) => n.id)).not.toContain("A");
      });
    });

    it("should pass forceRefresh=true when fetching details for updated notifications", async () => {
      const oldNotif = makeRawNotif("X");
      oldNotif.subject.url = "https://api.github.com/repos/owner/repo/issues/1";
      const updatedNotif = {
        ...oldNotif,
        updated_at: "2024-06-01T00:00:00Z", // newer than stored
      };

      mockGithub.getNotifications.mockResolvedValue({
        items: [updatedNotif],
        hasMore: false,
      });

      // Stored version has old updated_at → needsUpdate = true
      mockStorageFunctions.getNotifications
        .mockResolvedValueOnce([makeStoredNotif("X")]) // existingIds
        .mockResolvedValueOnce([makeStoredNotif("X")]) // safeBasic re-read
        .mockResolvedValueOnce([makeStoredNotif("X")]); // mergeAndSaveIfCurrent

      mockGithub.getNotificationDetails.mockResolvedValue({
        state: "closed",
        user: { login: "alice", avatar_url: "https://example.com/a.png", html_url: "" },
      });

      messageHandler({ action: "refresh" }, {}, vi.fn());
      await new Promise((resolve) => setTimeout(resolve, 150));

      // getNotificationDetails must be called with forceRefresh=true
      expect(mockGithub.getNotificationDetails).toHaveBeenCalled();
      const [, forceRefresh] = mockGithub.getNotificationDetails.mock.calls[0];
      expect(forceRefresh).toBe(true);
    });
  });
});

describe("service-worker helper functions", () => {
  // Using exported helper functions from service-worker.js

  describe("getIconForType", () => {
    it("should return correct icon for Issue", () => {
      expect(getIconForType("Issue")).toBe("issue");
    });

    it("should return correct icon for PullRequest", () => {
      expect(getIconForType("PullRequest")).toBe("pr");
    });

    it("should return correct icon for Release", () => {
      expect(getIconForType("Release")).toBe("release");
    });

    it("should return correct icon for CheckSuite", () => {
      expect(getIconForType("CheckSuite")).toBe("actions");
    });

    it("should return notification for unknown type", () => {
      expect(getIconForType("Unknown")).toBe("notification");
    });
  });

  describe("updateNotificationDetails", () => {
    it("should update Issue state", () => {
      const baseData = {};
      const details = { state: "open" };

      updateNotificationDetails(baseData, details, "Issue");

      expect(baseData.state).toBe("open");
    });

    it("should extract state_reason for closed Issues", () => {
      const baseData = {};
      const details = { state: "closed", state_reason: "not_planned" };

      updateNotificationDetails(baseData, details, "Issue");

      expect(baseData.state).toBe("closed");
      expect(baseData.state_reason).toBe("not_planned");
    });

    it("should not set state_reason for PRs", () => {
      const baseData = {};
      const details = { state: "closed", state_reason: "not_planned", merged: false };

      updateNotificationDetails(baseData, details, "PullRequest");

      expect(baseData.state_reason).toBeUndefined();
    });

    it("should update PR state and merged flag", () => {
      const baseData = {};
      const details = { state: "closed", merged: true };

      updateNotificationDetails(baseData, details, "PullRequest");

      expect(baseData.state).toBe("closed");
      expect(baseData.merged).toBe(true);
    });

    it("should update CheckSuite conclusion and status", () => {
      const baseData = {};
      const details = { conclusion: "success", status: "completed" };

      updateNotificationDetails(baseData, details, "CheckSuite");

      expect(baseData.conclusion).toBe("success");
      expect(baseData.status).toBe("completed");
      expect(baseData.state).toBeUndefined();
    });

    it("should extract author from user field", () => {
      const baseData = {};
      const details = {
        state: "open",
        user: {
          login: "testuser",
          avatar_url: "https://avatar.url",
          html_url: "https://github.com/testuser",
        },
      };

      updateNotificationDetails(baseData, details, "Issue");

      expect(baseData.author).toEqual({
        login: "testuser",
        avatar_url: "https://avatar.url",
        html_url: "https://github.com/testuser",
      });
    });

    it("should extract author from author field as fallback", () => {
      const baseData = {};
      const details = {
        state: "open",
        author: {
          login: "authoruser",
          avatar_url: "https://author.avatar",
          html_url: "https://github.com/authoruser",
        },
      };

      updateNotificationDetails(baseData, details, "Issue");

      expect(baseData.author.login).toBe("authoruser");
    });

    it("should copy all additional fields", () => {
      const baseData = {};
      const details = {
        state: "open",
        comments: 5,
        number: 42,
        created_at: "2024-01-01T00:00:00Z",
        body: "Description",
        html_url: "https://github.com/issue/42",
      };

      updateNotificationDetails(baseData, details, "Issue");

      expect(baseData.comment_count).toBe(5);
      expect(baseData.number).toBe(42);
      expect(baseData.created_at).toBe("2024-01-01T00:00:00Z");
      expect(baseData.body).toBe("Description");
      expect(baseData.html_url).toBe("https://github.com/issue/42");
    });

    it("should sum comments and review_comments for PullRequest notifications", () => {
      const baseData = {};
      const details = {
        state: "open",
        comments: 3,
        review_comments: 7,
        number: 10,
      };

      updateNotificationDetails(baseData, details, "PullRequest");

      // comment_count must include both issue-style and review comments
      expect(baseData.comment_count).toBe(10);
    });

    it("should not add review_comments for Issue notifications", () => {
      const baseData = {};
      const details = { state: "open", comments: 4, review_comments: 2, number: 5 };

      updateNotificationDetails(baseData, details, "Issue");

      // Issues don't have review comments; only comments field counts
      expect(baseData.comment_count).toBe(4);
    });

    it("should treat missing review_comments as 0 for PullRequest", () => {
      const baseData = {};
      const details = { state: "open", comments: 2, number: 8 }; // no review_comments field

      updateNotificationDetails(baseData, details, "PullRequest");

      expect(baseData.comment_count).toBe(2);
    });

    it("should copy empty-string body (not skip it as falsy)", () => {
      const baseData = { body: "old body" };
      const details = { body: "" };

      updateNotificationDetails(baseData, details, "Issue");

      // An empty string body is a valid API response and must overwrite the cached value
      expect(baseData.body).toBe("");
    });

    it("should copy null body (explicit null means no content, overwrites stale cache)", () => {
      const baseData = { body: "old body" };
      const details = { body: null };

      updateNotificationDetails(baseData, details, "Issue");

      expect(baseData.body).toBeNull();
    });

    it("should not copy body when field is absent (undefined means API did not return it)", () => {
      const baseData = { body: "keep me" };
      const details = {}; // body is undefined / not in response

      updateNotificationDetails(baseData, details, "Issue");

      expect(baseData.body).toBe("keep me");
    });
  });

  describe("copyCachedDetails", () => {
    it("should copy all defined cached fields", () => {
      const baseData = {};
      const existing = {
        state: "closed",
        merged: true,
        author: { login: "user" },
        comment_count: 10,
        number: 99,
        created_at: "2024-01-01",
        body: "Body text",
        html_url: "https://url",
      };

      copyCachedDetails(baseData, existing);

      expect(baseData.state).toBe("closed");
      expect(baseData.merged).toBe(true);
      expect(baseData.author).toEqual({ login: "user" });
      expect(baseData.comment_count).toBe(10);
      expect(baseData.number).toBe(99);
    });

    it("should not copy undefined fields", () => {
      const baseData = { existingField: "keep" };
      const existing = {
        state: "open",
        // merged is not defined
      };

      copyCachedDetails(baseData, existing);

      expect(baseData.state).toBe("open");
      expect(baseData.merged).toBeUndefined();
      expect(baseData.existingField).toBe("keep");
    });

    it("should copy detailsFailed flag", () => {
      const baseData = {};
      const existing = { detailsFailed: true };

      copyCachedDetails(baseData, existing);

      expect(baseData.detailsFailed).toBe(true);
    });
  });

  describe("showDesktopNotificationsForNew", () => {
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

    it("should do nothing when desktop notifications are disabled", async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(false);

      const notifications = [{ id: "1", isNew: true }];
      await showDesktopNotificationsForNew(notifications);

      // Should still clear aggregated notification even when disabled
      expect(mockNotifications.clear).toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID);
      // But should not create any new notifications
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    it("should clear previous aggregated notification", async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(5);

      const notifications = [{ id: "1", isNew: true }];
      await showDesktopNotificationsForNew(notifications);

      expect(mockNotifications.clear).toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID);
    });

    it("should do nothing when there are no new notifications", async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(5);

      const notifications = [
        { id: "1", isNew: false },
        { id: "2", isNew: false },
      ];
      await showDesktopNotificationsForNew(notifications);

      // Should clear old aggregated notification even with no new ones
      expect(mockNotifications.clear).toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID);
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    it("should clear aggregated notification even when notification list is empty", async () => {
      await showDesktopNotificationsForNew([]);

      // Should clear old aggregated notification to prevent stale notifications
      expect(mockNotifications.clear).toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID);
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    it("should clear aggregated notification even with null/undefined input", async () => {
      await showDesktopNotificationsForNew(null);
      expect(mockNotifications.clear).toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID);
      expect(mockNotifications.create).not.toHaveBeenCalled();

      vi.clearAllMocks();

      await showDesktopNotificationsForNew(undefined);
      expect(mockNotifications.clear).toHaveBeenCalledWith(AGGREGATED_NOTIFICATION_ID);
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    it("should show all notifications when count is below limit", async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(5);

      const notifications = [
        {
          id: "1",
          isNew: true,
          title: "Notif 1",
          repository: { full_name: "repo1" },
          reason: "mention",
        },
        {
          id: "2",
          isNew: true,
          title: "Notif 2",
          repository: { full_name: "repo2" },
          reason: "assign",
        },
        {
          id: "3",
          isNew: true,
          title: "Notif 3",
          repository: { full_name: "repo3" },
          reason: "review",
        },
      ];
      await runWithTimers(notifications);

      expect(mockNotifications.create).toHaveBeenCalledTimes(3);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        `${NOTIFICATION_ID_PREFIX}1`,
        expect.objectContaining({
          type: "basic",
          title: "Notif 1",
        }),
      );
    });

    it("should limit notifications to max and show aggregated notification", async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(3);

      const notifications = [
        { id: "1", isNew: true, title: "N1", repository: { full_name: "r1" }, reason: "m" },
        { id: "2", isNew: true, title: "N2", repository: { full_name: "r2" }, reason: "a" },
        { id: "3", isNew: true, title: "N3", repository: { full_name: "r3" }, reason: "r" },
        { id: "4", isNew: true, title: "N4", repository: { full_name: "r4" }, reason: "s" },
        { id: "5", isNew: true, title: "N5", repository: { full_name: "r5" }, reason: "c" },
        { id: "6", isNew: true, title: "N6", repository: { full_name: "r6" }, reason: "t" },
      ];
      await runWithTimers(notifications);

      // Should create 3 individual notifications + 1 aggregated
      expect(mockNotifications.create).toHaveBeenCalledTimes(4);

      // Check individual notifications
      expect(mockNotifications.create).toHaveBeenCalledWith(
        `${NOTIFICATION_ID_PREFIX}1`,
        expect.any(Object),
      );
      expect(mockNotifications.create).toHaveBeenCalledWith(
        `${NOTIFICATION_ID_PREFIX}2`,
        expect.any(Object),
      );
      expect(mockNotifications.create).toHaveBeenCalledWith(
        `${NOTIFICATION_ID_PREFIX}3`,
        expect.any(Object),
      );

      // Check aggregated notification
      expect(mockNotifications.create).toHaveBeenCalledWith(
        AGGREGATED_NOTIFICATION_ID,
        expect.objectContaining({
          type: "basic",
          title: "GitHub Notifications",
          message: "... and 3 more new notifications",
        }),
      );
    });

    it("should handle edge case with exactly max notifications", async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(5);

      const notifications = Array.from({ length: 5 }, (_, i) => ({
        id: `${i + 1}`,
        isNew: true,
        title: `N${i + 1}`,
        repository: { full_name: "repo" },
        reason: "test",
      }));
      await runWithTimers(notifications);

      // Should create exactly 5 notifications, no aggregated
      expect(mockNotifications.create).toHaveBeenCalledTimes(5);

      // Should not create aggregated notification
      expect(mockNotifications.create).not.toHaveBeenCalledWith(
        AGGREGATED_NOTIFICATION_ID,
        expect.any(Object),
      );
    });

    it("should handle edge case with max = 1", async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(1);

      const notifications = [
        { id: "1", isNew: true, title: "N1", repository: { full_name: "r1" }, reason: "m" },
        { id: "2", isNew: true, title: "N2", repository: { full_name: "r2" }, reason: "a" },
        { id: "3", isNew: true, title: "N3", repository: { full_name: "r3" }, reason: "r" },
      ];
      await runWithTimers(notifications);

      // Should create 1 individual + 1 aggregated
      expect(mockNotifications.create).toHaveBeenCalledTimes(2);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        `${NOTIFICATION_ID_PREFIX}1`,
        expect.any(Object),
      );
      expect(mockNotifications.create).toHaveBeenCalledWith(
        AGGREGATED_NOTIFICATION_ID,
        expect.objectContaining({
          message: "... and 2 more new notifications",
        }),
      );
    });

    it("should use singular form for 1 remaining notification", async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(1);

      const notifications = [
        { id: "1", isNew: true, title: "N1", repository: { full_name: "r1" }, reason: "m" },
        { id: "2", isNew: true, title: "N2", repository: { full_name: "r2" }, reason: "a" },
      ];
      await runWithTimers(notifications);

      expect(mockNotifications.create).toHaveBeenCalledWith(
        AGGREGATED_NOTIFICATION_ID,
        expect.objectContaining({
          message: "... and 1 more new notification",
        }),
      );
    });

    it("should continue showing notifications even if clear fails", async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(5);
      mockNotifications.clear.mockRejectedValueOnce(new Error("Clear failed"));

      const notifications = [
        { id: "1", isNew: true, title: "N1", repository: { full_name: "r1" }, reason: "m" },
      ];
      await runWithTimers(notifications);

      // Should still create the notification even though clear failed
      expect(mockNotifications.create).toHaveBeenCalledWith(
        `${NOTIFICATION_ID_PREFIX}1`,
        expect.any(Object),
      );
    });

    it("should add 1-second delays between notifications", async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(5);

      // Spy on setTimeout to verify delays
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");

      const notifications = [
        { id: "1", isNew: true, title: "N1", repository: { full_name: "r1" }, reason: "m" },
        { id: "2", isNew: true, title: "N2", repository: { full_name: "r2" }, reason: "a" },
        { id: "3", isNew: true, title: "N3", repository: { full_name: "r3" }, reason: "r" },
      ];

      const promise = showDesktopNotificationsForNew(notifications);
      await vi.runAllTimersAsync();
      await promise;

      // Should have 2 delays between 3 notifications (before 2nd and 3rd)
      const delayCalls = setTimeoutSpy.mock.calls.filter(
        (call) => call[1] === NOTIFICATION_DELAY_MS,
      );
      expect(delayCalls.length).toBe(2);

      setTimeoutSpy.mockRestore();
    });

    it("should add delay before aggregated notification", async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(2);

      // Spy on setTimeout to verify delays
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");

      const notifications = [
        { id: "1", isNew: true, title: "N1", repository: { full_name: "r1" }, reason: "m" },
        { id: "2", isNew: true, title: "N2", repository: { full_name: "r2" }, reason: "a" },
        { id: "3", isNew: true, title: "N3", repository: { full_name: "r3" }, reason: "r" },
      ];

      const promise = showDesktopNotificationsForNew(notifications);
      await vi.runAllTimersAsync();
      await promise;

      // Should have 2 delays: 1 between notifications + 1 before aggregated
      const delayCalls = setTimeoutSpy.mock.calls.filter(
        (call) => call[1] === NOTIFICATION_DELAY_MS,
      );
      expect(delayCalls.length).toBe(2);

      setTimeoutSpy.mockRestore();
    });
  });

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

      const sendResponse = vi.fn();
      messageHandler({ action: "refresh" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 100));

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
      // Desktop notification preference fetch fails
      mockStorageFunctions.getEnableDesktopNotifications.mockRejectedValue(
        new Error("Storage read error"),
      );

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const sendResponse = vi.fn();
      messageHandler({ action: "refresh" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // showDesktopNotificationsForNew catches its own errors internally,
      // so the refresh should still succeed
      expect(sendResponse).toHaveBeenCalledWith({ success: true });

      consoleSpy.mockRestore();
    });
  });

  describe("desktop notification partial failure in batch", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should continue creating remaining notifications when one create call fails", async () => {
      mockStorageFunctions.getEnableDesktopNotifications.mockResolvedValue(true);
      mockStorageFunctions.getMaxDesktopNotifications.mockResolvedValue(5);

      // First notification.create succeeds, second fails, third succeeds
      mockNotifications.create
        .mockResolvedValueOnce("notif-1")
        .mockRejectedValueOnce(new Error("Notification create failed"))
        .mockResolvedValueOnce("notif-3");

      const notifications = [
        { id: "1", isNew: true, title: "N1", repository: { full_name: "r1" }, reason: "mention" },
        { id: "2", isNew: true, title: "N2", repository: { full_name: "r2" }, reason: "assign" },
        { id: "3", isNew: true, title: "N3", repository: { full_name: "r3" }, reason: "review" },
      ];

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const promise = showDesktopNotificationsForNew(notifications);
      await vi.runAllTimersAsync();
      await promise;

      // All three should be attempted (showDesktopNotification catches its own errors)
      expect(mockNotifications.create).toHaveBeenCalledTimes(3);
      // First and third should have been called with correct IDs
      expect(mockNotifications.create).toHaveBeenCalledWith(
        `${NOTIFICATION_ID_PREFIX}1`,
        expect.any(Object),
      );
      expect(mockNotifications.create).toHaveBeenCalledWith(
        `${NOTIFICATION_ID_PREFIX}3`,
        expect.any(Object),
      );

      consoleSpy.mockRestore();
    });
  });
});

describe("comment URL cache session storage persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestCommentUrlCache.clear();
  });

  describe("persistCommentCache()", () => {
    it("writes the current cache contents to session storage", () => {
      latestCommentUrlCache.set("1", { url: "https://github.com/a/b#1", updated_at: "2024-01-01" });
      latestCommentUrlCache.set("2", { url: "https://github.com/a/b#2", updated_at: "2024-01-02" });
      mockStorage.session.set.mockResolvedValue(undefined);

      persistCommentCache();

      expect(mockStorage.session.set).toHaveBeenCalledWith({
        latestCommentUrlCache: {
          1: { url: "https://github.com/a/b#1", updated_at: "2024-01-01" },
          2: { url: "https://github.com/a/b#2", updated_at: "2024-01-02" },
        },
      });
    });

    it("writes an empty object when cache is empty", () => {
      mockStorage.session.set.mockResolvedValue(undefined);

      persistCommentCache();

      expect(mockStorage.session.set).toHaveBeenCalledWith({ latestCommentUrlCache: {} });
    });

    it("silently swallows session storage write errors", async () => {
      mockStorage.session.set.mockRejectedValue(new Error("quota exceeded"));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Should not throw even when session.set rejects
      await expect(persistCommentCache()).resolves.toBeUndefined();

      warnSpy.mockRestore();
    });

    it("is a no-op when session storage is unavailable", async () => {
      // Simulate Firefox: session is null
      const origSession = mockStorage.session;
      mockStorage.session = null;

      await expect(persistCommentCache()).resolves.toBeUndefined();
      expect(origSession.set).not.toHaveBeenCalled();

      mockStorage.session = origSession;
    });
  });

  describe("restoreCommentCache()", () => {
    it("populates cache from session storage on startup", async () => {
      mockStorage.session.get.mockResolvedValue({
        latestCommentUrlCache: {
          42: { url: "https://github.com/x/y#42", updated_at: "2024-03-01" },
        },
      });

      await restoreCommentCache();

      expect(latestCommentUrlCache.get("42")).toEqual({
        url: "https://github.com/x/y#42",
        updated_at: "2024-03-01",
      });
    });

    it("does nothing when session storage has no cached data", async () => {
      mockStorage.session.get.mockResolvedValue({});

      await restoreCommentCache();

      expect(latestCommentUrlCache.size).toBe(0);
    });

    it("does nothing when cached value is not an object", async () => {
      mockStorage.session.get.mockResolvedValue({ latestCommentUrlCache: "corrupt" });

      await restoreCommentCache();

      expect(latestCommentUrlCache.size).toBe(0);
    });

    it("silently swallows session storage read errors", async () => {
      mockStorage.session.get.mockRejectedValue(new Error("storage error"));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(restoreCommentCache()).resolves.toBeUndefined();

      warnSpy.mockRestore();
    });

    it("is a no-op when session storage is unavailable", async () => {
      const origSession = mockStorage.session;
      mockStorage.session = null;

      await expect(restoreCommentCache()).resolves.toBeUndefined();
      expect(latestCommentUrlCache.size).toBe(0);

      mockStorage.session = origSession;
    });
  });

  describe("handleMessage - GET_NOTIFICATION_FILTER", () => {
    it("should return stored filter rules", async () => {
      const rules = [{ repos: ["owner/repo"], keywords: ["beta"] }];
      mockStorageFunctions.getNotificationFilter.mockResolvedValue(rules);

      const sendResponse = vi.fn();
      messageHandler({ action: "getNotificationFilter" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({ filter: rules });
    });

    it("should return empty array when no filter is configured", async () => {
      mockStorageFunctions.getNotificationFilter.mockResolvedValue([]);

      const sendResponse = vi.fn();
      messageHandler({ action: "getNotificationFilter" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({ filter: [] });
    });
  });

  describe("handleMessage - SET_NOTIFICATION_FILTER", () => {
    it("should save valid filter rules", async () => {
      const rules = [{ repos: ["owner/repo"], keywords: ["beta"] }];
      const sendResponse = vi.fn();
      messageHandler({ action: "setNotificationFilter", filter: rules }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockStorageFunctions.setNotificationFilter).toHaveBeenCalledWith(rules);
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it("should accept rule with empty repos (global scope)", async () => {
      const rules = [{ repos: [], keywords: ["nightly"] }];
      const sendResponse = vi.fn();
      messageHandler({ action: "setNotificationFilter", filter: rules }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockStorageFunctions.setNotificationFilter).toHaveBeenCalledWith(rules);
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it("should reject non-array filter", async () => {
      const sendResponse = vi.fn();
      messageHandler({ action: "setNotificationFilter", filter: "bad" }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining("filter must be an array") }),
      );
      expect(mockStorageFunctions.setNotificationFilter).not.toHaveBeenCalled();
    });

    it("should reject rule missing repos array", async () => {
      const sendResponse = vi.fn();
      messageHandler(
        { action: "setNotificationFilter", filter: [{ keywords: ["beta"] }] },
        {},
        sendResponse,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("repos and keywords arrays"),
        }),
      );
    });

    it("should reject rule missing keywords array", async () => {
      const sendResponse = vi.fn();
      messageHandler(
        { action: "setNotificationFilter", filter: [{ repos: ["owner/repo"] }] },
        {},
        sendResponse,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("repos and keywords arrays"),
        }),
      );
    });

    it("should reject rule with empty keywords", async () => {
      const sendResponse = vi.fn();
      messageHandler(
        { action: "setNotificationFilter", filter: [{ repos: [], keywords: [] }] },
        {},
        sendResponse,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("at least one keyword"),
        }),
      );
    });

    it("should reject rule with only whitespace/empty-string keywords", async () => {
      const sendResponse = vi.fn();
      messageHandler(
        { action: "setNotificationFilter", filter: [{ repos: [], keywords: ["", " ", "  "] }] },
        {},
        sendResponse,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("at least one keyword"),
        }),
      );
    });

    it("should trim whitespace from repos and keywords", async () => {
      const rules = [{ repos: [" owner/repo "], keywords: [" beta "] }];
      const sendResponse = vi.fn();
      messageHandler({ action: "setNotificationFilter", filter: rules }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockStorageFunctions.setNotificationFilter).toHaveBeenCalledWith([
        { repos: ["owner/repo"], keywords: ["beta"] },
      ]);
    });

    it("should reject rule with non-string repo elements", async () => {
      const sendResponse = vi.fn();
      messageHandler(
        { action: "setNotificationFilter", filter: [{ repos: [123], keywords: ["beta"] }] },
        {},
        sendResponse,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("arrays of strings"),
        }),
      );
      expect(mockStorageFunctions.setNotificationFilter).not.toHaveBeenCalled();
    });

    it("should reject rule with non-string keyword elements", async () => {
      const sendResponse = vi.fn();
      messageHandler(
        { action: "setNotificationFilter", filter: [{ repos: [], keywords: [null] }] },
        {},
        sendResponse,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("arrays of strings"),
        }),
      );
      expect(mockStorageFunctions.setNotificationFilter).not.toHaveBeenCalled();
    });

    it("should apply filter to stored notifications when rules match", async () => {
      const storedNotifs = [
        { id: "1", title: "v1.0.0-beta", repository: { full_name: "owner/repo" } },
        { id: "2", title: "Fix bug", repository: { full_name: "owner/repo" } },
        { id: "3", title: "v2.0.0-beta.1", repository: { full_name: "owner/repo" } },
      ];
      mockStorageFunctions.getNotifications.mockResolvedValue(storedNotifs);

      const rules = [{ repos: [], keywords: ["beta"] }];
      const sendResponse = vi.fn();
      messageHandler({ action: "setNotificationFilter", filter: rules }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockStorageFunctions.setNotifications).toHaveBeenCalledWith([
        { id: "2", title: "Fix bug", repository: { full_name: "owner/repo" } },
      ]);
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it("should not call setNotifications with a filtered subset when no stored notifications match", async () => {
      const storedNotifs = [{ id: "1", title: "Fix bug", repository: { full_name: "owner/repo" } }];
      mockStorageFunctions.getNotifications.mockResolvedValue(storedNotifs);

      const rules = [{ repos: [], keywords: ["beta"] }];
      const sendResponse = vi.fn();
      messageHandler({ action: "setNotificationFilter", filter: rules }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The immediate re-filter path must NOT write a filtered subset: "Fix bug" doesn't
      // match "beta", so the if (filtered.length !== current.length) guard prevents the
      // write. (Background checkNotifications may call setNotifications independently.)
      const calledWithSubset = mockStorageFunctions.setNotifications.mock.calls.some(
        (call) => Array.isArray(call[0]) && call[0].length < storedNotifs.length,
      );
      expect(calledWithSubset).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it("should skip immediate re-filter and not write empty storage when filter is empty", async () => {
      const sendResponse = vi.fn();
      messageHandler({ action: "setNotificationFilter", filter: [] }, {}, sendResponse);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockStorageFunctions.setNotificationFilter).toHaveBeenCalledWith([]);
      // filter.length === 0: the immediate re-filter block is skipped so storage is
      // never overwritten with an empty array by this path.
      const calledWithEmpty = mockStorageFunctions.setNotifications.mock.calls.some(
        (call) => Array.isArray(call[0]) && call[0].length === 0,
      );
      expect(calledWithEmpty).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe("matchesNotificationFilter", () => {
    const makeNotif = (title, repoFullName = "owner/repo") => ({
      title,
      repository: { full_name: repoFullName },
    });

    it("returns false for empty rules array", () => {
      expect(matchesNotificationFilter(makeNotif("v1.0.0-beta"), [])).toBe(false);
    });

    it("returns false when rule has empty repos and empty keywords", () => {
      const rules = [{ repos: [], keywords: [] }];
      expect(matchesNotificationFilter(makeNotif("v1.0.0-beta"), rules)).toBe(false);
    });

    it("matches keyword in title (case-insensitive)", () => {
      const rules = [{ repos: [], keywords: ["beta"] }];
      expect(matchesNotificationFilter(makeNotif("v1.0.0-BETA"), rules)).toBe(true);
      expect(matchesNotificationFilter(makeNotif("v1.0.0-Beta.1"), rules)).toBe(true);
      expect(matchesNotificationFilter(makeNotif("v1.0.0"), rules)).toBe(false);
    });

    it("scopes to specific repos when repos is non-empty", () => {
      const rules = [{ repos: ["owner/repo-a"], keywords: ["rc"] }];
      expect(matchesNotificationFilter(makeNotif("v2.0.0-rc.1", "owner/repo-a"), rules)).toBe(true);
      expect(matchesNotificationFilter(makeNotif("v2.0.0-rc.1", "owner/repo-b"), rules)).toBe(
        false,
      );
    });

    it("matches repos case-insensitively", () => {
      const rules = [{ repos: ["Owner/Repo-A"], keywords: ["rc"] }];
      expect(matchesNotificationFilter(makeNotif("v2.0.0-rc.1", "owner/repo-a"), rules)).toBe(true);
      expect(matchesNotificationFilter(makeNotif("v2.0.0-rc.1", "OWNER/REPO-A"), rules)).toBe(true);
    });

    it("does not match when rule has repos but no keywords", () => {
      const rules = [{ repos: ["owner/repo"], keywords: [] }];
      expect(matchesNotificationFilter(makeNotif("anything", "owner/repo"), rules)).toBe(false);
    });

    it("matches if any rule in the array matches (OR semantics)", () => {
      const rules = [
        { repos: ["owner/repo-a"], keywords: ["alpha"] },
        { repos: [], keywords: ["nightly"] },
      ];
      expect(matchesNotificationFilter(makeNotif("v1-alpha", "owner/repo-a"), rules)).toBe(true);
      expect(matchesNotificationFilter(makeNotif("nightly-build", "owner/repo-b"), rules)).toBe(
        true,
      );
      expect(matchesNotificationFilter(makeNotif("v1.0.0", "owner/repo-a"), rules)).toBe(false);
    });

    it("matches any keyword in the list (OR within keywords)", () => {
      const rules = [{ repos: [], keywords: ["alpha", "beta", "rc"] }];
      expect(matchesNotificationFilter(makeNotif("v1.0.0-alpha"), rules)).toBe(true);
      expect(matchesNotificationFilter(makeNotif("v1.0.0-beta"), rules)).toBe(true);
      expect(matchesNotificationFilter(makeNotif("v1.0.0-rc.1"), rules)).toBe(true);
      expect(matchesNotificationFilter(makeNotif("v1.0.0"), rules)).toBe(false);
    });

    it("returns false when notif has no title", () => {
      const rules = [{ repos: [], keywords: ["beta"] }];
      expect(
        matchesNotificationFilter({ title: null, repository: { full_name: "owner/repo" } }, rules),
      ).toBe(false);
      expect(matchesNotificationFilter({ repository: { full_name: "owner/repo" } }, rules)).toBe(
        false,
      );
    });

    it("returns false when notif has no repository", () => {
      const rules = [{ repos: ["owner/repo"], keywords: ["beta"] }];
      expect(matchesNotificationFilter({ title: "v1.0.0-beta" }, rules)).toBe(false);
      expect(matchesNotificationFilter({ title: "v1.0.0-beta", repository: null }, rules)).toBe(
        false,
      );
    });

    it("matches all repos (no repo filter) even when repository is undefined", () => {
      // repos: [] means global scope — but if title is present and no repo filter, should still match keyword
      const rules = [{ repos: [], keywords: ["beta"] }];
      // No repository field at all — keyword check should still proceed since repos is empty
      // But matchesRule only checks repoName when repos.length > 0, so this should match
      expect(matchesNotificationFilter({ title: "v1.0.0-beta" }, rules)).toBe(true);
    });
  });

  describe("applyNotificationFilterWithStats", () => {
    const makeNotif = (title, repoFullName = "owner/repo") => ({
      title,
      repository: { full_name: repoFullName },
    });

    it("returns all notifications and empty stats when rules are empty", () => {
      const notifs = [makeNotif("fix bug"), makeNotif("v1.0.0-beta")];
      const { notifications, stats } = applyNotificationFilterWithStats(notifs, []);
      expect(notifications).toEqual(notifs);
      expect(stats).toEqual([]);
    });

    it("filters matching notifications and counts per repo and per keyword", () => {
      const rules = [{ repos: [], keywords: ["beta"] }];
      const notifs = [
        makeNotif("v1.0.0-beta", "org/repo-a"),
        makeNotif("v1.0.0-beta", "org/repo-b"),
        makeNotif("fix bug", "org/repo-a"),
      ];
      const { notifications, stats } = applyNotificationFilterWithStats(notifs, rules);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe("fix bug");
      expect(stats[0].repos).toEqual({ "org/repo-a": 1, "org/repo-b": 1 });
      expect(stats[0].keywords).toEqual({ beta: 2 });
    });

    it("normalizes repo keys to lowercase for case-insensitive lookup", () => {
      const rules = [{ repos: ["openai/openai-python"], keywords: ["alpha"] }];
      // API returns full_name with different casing than the user-saved rule
      const notifs = [{ title: "v1-alpha", repository: { full_name: "OpenAI/openai-python" } }];
      const { notifications, stats } = applyNotificationFilterWithStats(notifs, rules);
      expect(notifications).toHaveLength(0);
      // Key stored in lowercase; lookup with lowercase user-saved repo should work
      expect(stats[0].repos).toEqual({ "openai/openai-python": 1 });
    });

    it("counts multiple filtered notifications from the same repo", () => {
      const rules = [{ repos: ["owner/repo"], keywords: ["alpha"] }];
      const notifs = [makeNotif("v1-alpha"), makeNotif("v2-alpha"), makeNotif("v3-stable")];
      const { notifications, stats } = applyNotificationFilterWithStats(notifs, rules);
      expect(notifications).toHaveLength(1);
      expect(stats[0].repos).toEqual({ "owner/repo": 2 });
      expect(stats[0].keywords).toEqual({ alpha: 2 });
    });

    it("counts each matching keyword independently when multiple keywords match", () => {
      const rules = [{ repos: [], keywords: ["alpha", "beta"] }];
      const notifs = [
        makeNotif("v1-alpha-beta"), // matches both keywords
        makeNotif("v2-alpha"), // matches only "alpha"
      ];
      const { notifications, stats } = applyNotificationFilterWithStats(notifs, rules);
      expect(notifications).toHaveLength(0);
      expect(stats[0].keywords).toEqual({ alpha: 2, beta: 1 });
    });

    it("tracks stats per rule independently (first matching rule wins)", () => {
      const rules = [
        { repos: ["owner/repo-a"], keywords: ["alpha"] },
        { repos: [], keywords: ["beta"] },
      ];
      const notifs = [
        makeNotif("v1-alpha", "owner/repo-a"),
        makeNotif("v1-beta", "owner/repo-b"),
        makeNotif("stable", "owner/repo-a"),
      ];
      const { notifications, stats } = applyNotificationFilterWithStats(notifs, rules);
      expect(notifications).toHaveLength(1);
      expect(stats[0].repos).toEqual({ "owner/repo-a": 1 });
      expect(stats[0].keywords).toEqual({ alpha: 1 });
      expect(stats[1].repos).toEqual({ "owner/repo-b": 1 });
      expect(stats[1].keywords).toEqual({ beta: 1 });
    });

    it("returns empty repos and keywords when no notifications were filtered", () => {
      const rules = [{ repos: ["owner/repo"], keywords: ["alpha"] }];
      const notifs = [makeNotif("stable release")];
      const { notifications, stats } = applyNotificationFilterWithStats(notifs, rules);
      expect(notifications).toHaveLength(1);
      expect(stats[0].repos).toEqual({});
      expect(stats[0].keywords).toEqual({});
    });
  });
});
