import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockNotifications = {
  create: vi.fn().mockResolvedValue("notification-id"),
  clear: vi.fn().mockResolvedValue(true),
};

const mockRuntime = {
  getURL: vi.fn((path) => `chrome-extension://test-id/${path}`),
};

vi.mock("../src/lib/chrome-api.js", () => ({
  notifications: mockNotifications,
  runtime: mockRuntime,
}));

const mockStorageFunctions = {
  getEnableDesktopNotifications: vi.fn(),
  getMaxDesktopNotifications: vi.fn(),
};

vi.mock("../src/lib/storage.js", () => mockStorageFunctions);

vi.mock("../src/lib/format-utils.js", () => ({
  formatReason: vi.fn((reason) => reason || "Unknown"),
}));

const {
  showDesktopNotificationsForNew,
  NOTIFICATION_ID_PREFIX,
  AGGREGATED_NOTIFICATION_ID,
  NOTIFICATION_DELAY_MS,
} = await import("../src/background/desktop-notifications.js");

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
    const delayCalls = setTimeoutSpy.mock.calls.filter((call) => call[1] === NOTIFICATION_DELAY_MS);
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
    const delayCalls = setTimeoutSpy.mock.calls.filter((call) => call[1] === NOTIFICATION_DELAY_MS);
    expect(delayCalls.length).toBe(2);

    setTimeoutSpy.mockRestore();
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
