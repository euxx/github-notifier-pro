import { describe, it, expect, vi, beforeEach } from "vitest";

// chrome-api.session backs persistCommentCache / restoreCommentCache.
const mockSession = {
  get: vi.fn(),
  set: vi.fn(),
};
vi.mock("../src/lib/chrome-api.js", () => ({
  storage: { session: mockSession },
}));

// Desktop notifications are a side effect at the tail of runFetch; stub it
// so we don't need the chrome.notifications API or the real timing logic.
const mockShowDesktopNotificationsForNew = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/background/desktop-notifications.js", () => ({
  showDesktopNotificationsForNew: mockShowDesktopNotificationsForNew,
}));

const { createNotificationFetcher, getIconForType, updateNotificationDetails, copyCachedDetails } =
  await import("../src/background/notification-fetcher.js");

// ─── Pure helpers (no fetcher state) ─────────────────────────────────────

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
    updateNotificationDetails(baseData, { state: "open" }, "Issue");
    expect(baseData.state).toBe("open");
  });

  it("should extract state_reason for closed Issues", () => {
    const baseData = {};
    updateNotificationDetails(baseData, { state: "closed", state_reason: "not_planned" }, "Issue");
    expect(baseData.state).toBe("closed");
    expect(baseData.state_reason).toBe("not_planned");
  });

  it("should not set state_reason for PRs", () => {
    const baseData = {};
    updateNotificationDetails(
      baseData,
      { state: "closed", state_reason: "not_planned", merged: false },
      "PullRequest",
    );
    expect(baseData.state_reason).toBeUndefined();
  });

  it("should update PR state and merged flag", () => {
    const baseData = {};
    updateNotificationDetails(baseData, { state: "closed", merged: true }, "PullRequest");
    expect(baseData.state).toBe("closed");
    expect(baseData.merged).toBe(true);
  });

  it("should update CheckSuite conclusion and status", () => {
    const baseData = {};
    updateNotificationDetails(
      baseData,
      { conclusion: "success", status: "completed" },
      "CheckSuite",
    );
    expect(baseData.conclusion).toBe("success");
    expect(baseData.status).toBe("completed");
    expect(baseData.state).toBeUndefined();
  });

  it("should extract author from user field", () => {
    const baseData = {};
    updateNotificationDetails(
      baseData,
      {
        state: "open",
        user: {
          login: "testuser",
          avatar_url: "https://avatar.url",
          html_url: "https://github.com/testuser",
        },
      },
      "Issue",
    );
    expect(baseData.author).toEqual({
      login: "testuser",
      avatar_url: "https://avatar.url",
      html_url: "https://github.com/testuser",
    });
  });

  it("should extract author from author field as fallback", () => {
    const baseData = {};
    updateNotificationDetails(
      baseData,
      {
        state: "open",
        author: {
          login: "authoruser",
          avatar_url: "https://author.avatar",
          html_url: "https://github.com/authoruser",
        },
      },
      "Issue",
    );
    expect(baseData.author.login).toBe("authoruser");
  });

  it("should copy all additional fields", () => {
    const baseData = {};
    updateNotificationDetails(
      baseData,
      {
        state: "open",
        comments: 5,
        number: 42,
        created_at: "2024-01-01T00:00:00Z",
        body: "Description",
        html_url: "https://github.com/issue/42",
      },
      "Issue",
    );
    expect(baseData.comment_count).toBe(5);
    expect(baseData.number).toBe(42);
    expect(baseData.created_at).toBe("2024-01-01T00:00:00Z");
    expect(baseData.body).toBe("Description");
    expect(baseData.html_url).toBe("https://github.com/issue/42");
  });

  it("should sum comments and review_comments for PullRequest notifications", () => {
    const baseData = {};
    updateNotificationDetails(
      baseData,
      { state: "open", comments: 3, review_comments: 7, number: 10 },
      "PullRequest",
    );
    expect(baseData.comment_count).toBe(10);
  });

  it("should not add review_comments for Issue notifications", () => {
    const baseData = {};
    updateNotificationDetails(
      baseData,
      { state: "open", comments: 4, review_comments: 2, number: 5 },
      "Issue",
    );
    expect(baseData.comment_count).toBe(4);
  });

  it("should treat missing review_comments as 0 for PullRequest", () => {
    const baseData = {};
    updateNotificationDetails(baseData, { state: "open", comments: 2, number: 8 }, "PullRequest");
    expect(baseData.comment_count).toBe(2);
  });

  it("should copy empty-string body (not skip it as falsy)", () => {
    const baseData = { body: "old body" };
    updateNotificationDetails(baseData, { body: "" }, "Issue");
    expect(baseData.body).toBe("");
  });

  it("should copy null body (explicit null means no content, overwrites stale cache)", () => {
    const baseData = { body: "old body" };
    updateNotificationDetails(baseData, { body: null }, "Issue");
    expect(baseData.body).toBeNull();
  });

  it("should not copy body when field is absent (undefined means API did not return it)", () => {
    const baseData = { body: "keep me" };
    updateNotificationDetails(baseData, {}, "Issue");
    expect(baseData.body).toBe("keep me");
  });
});

describe("copyCachedDetails", () => {
  it("should copy all defined cached fields", () => {
    const baseData = {};
    copyCachedDetails(baseData, {
      state: "closed",
      merged: true,
      author: { login: "user" },
      comment_count: 10,
      number: 99,
      created_at: "2024-01-01",
      body: "Body text",
      html_url: "https://url",
    });
    expect(baseData.state).toBe("closed");
    expect(baseData.merged).toBe(true);
    expect(baseData.author).toEqual({ login: "user" });
    expect(baseData.comment_count).toBe(10);
    expect(baseData.number).toBe(99);
  });

  it("should not copy undefined fields", () => {
    const baseData = { existingField: "keep" };
    copyCachedDetails(baseData, { state: "open" });
    expect(baseData.state).toBe("open");
    expect(baseData.merged).toBeUndefined();
    expect(baseData.existingField).toBe("keep");
  });

  it("should copy detailsFailed flag", () => {
    const baseData = {};
    copyCachedDetails(baseData, { detailsFailed: true });
    expect(baseData.detailsFailed).toBe(true);
  });
});

// ─── Fetcher fakes ───────────────────────────────────────────────────────

/**
 * Build a fake storage backed by an in-memory state object. Mirrors the
 * shape sync-engine.test.js uses so the tests read consistently.
 */
function makeStorage(initial = {}) {
  const state = {
    notifications: [],
    notificationFilter: [],
    notificationFilterStats: [],
    ...initial,
  };
  return {
    state,
    getNotifications: vi.fn(async () => state.notifications),
    setNotifications: vi.fn(async (v) => {
      state.notifications = v;
    }),
    getNotificationFilter: vi.fn(async () => state.notificationFilter),
    setNotificationFilterStats: vi.fn(async (v) => {
      state.notificationFilterStats = v;
    }),
  };
}

function makeGithub(overrides = {}) {
  return {
    isAuthenticated: true,
    pollInterval: 60,
    getNotifications: vi.fn().mockResolvedValue({ items: [], hasMore: false, count: 0 }),
    getNotificationDetails: vi.fn().mockResolvedValue({}),
    getLatestCommentUrl: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeRawNotif(id, overrides = {}) {
  return {
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
    ...overrides,
  };
}

function makeStoredNotif(id, overrides = {}) {
  return { id, updated_at: "2024-01-01T00:00:00Z", type: "Issue", ...overrides };
}

function build({ storageInit = {}, github: githubOverrides = {} } = {}) {
  const storage = makeStorage(storageInit);
  const github = makeGithub(githubOverrides);
  const onBadgeUpdate = vi.fn().mockResolvedValue(undefined);
  const onPollIntervalChanged = vi.fn().mockResolvedValue(undefined);
  const fetcher = createNotificationFetcher({
    github,
    storage,
    onBadgeUpdate,
    onPollIntervalChanged,
  });
  return { storage, github, onBadgeUpdate, onPollIntervalChanged, fetcher };
}

// ─── persistCommentCache ─────────────────────────────────────────────────

describe("fetcher.persistCommentCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the current cache contents to session storage", async () => {
    const { fetcher } = build();
    fetcher._commentCache.set("1", { url: "https://github.com/a/b#1", updated_at: "2024-01-01" });
    fetcher._commentCache.set("2", { url: "https://github.com/a/b#2", updated_at: "2024-01-02" });
    mockSession.set.mockResolvedValue(undefined);

    await fetcher.persistCommentCache();

    expect(mockSession.set).toHaveBeenCalledWith({
      latestCommentUrlCache: {
        1: { url: "https://github.com/a/b#1", updated_at: "2024-01-01" },
        2: { url: "https://github.com/a/b#2", updated_at: "2024-01-02" },
      },
    });
  });

  it("writes an empty object when cache is empty", async () => {
    const { fetcher } = build();
    mockSession.set.mockResolvedValue(undefined);

    await fetcher.persistCommentCache();

    expect(mockSession.set).toHaveBeenCalledWith({ latestCommentUrlCache: {} });
  });

  it("silently swallows session storage write errors", async () => {
    const { fetcher } = build();
    mockSession.set.mockRejectedValue(new Error("quota exceeded"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(fetcher.persistCommentCache()).resolves.toBeUndefined();

    warnSpy.mockRestore();
    mockSession.set.mockResolvedValue(undefined);
  });

  it("is a no-op when session storage is unavailable (Firefox)", async () => {
    // Re-mock chrome-api so storage.session is null for this test only.
    vi.doMock("../src/lib/chrome-api.js", () => ({
      storage: { session: null },
    }));
    vi.resetModules();
    const { createNotificationFetcher: createWithoutSession } =
      await import("../src/background/notification-fetcher.js");
    const fetcherNoSession = createWithoutSession({
      github: makeGithub(),
      storage: makeStorage(),
      onBadgeUpdate: vi.fn(),
    });

    await expect(fetcherNoSession.persistCommentCache()).resolves.toBeUndefined();
    expect(mockSession.set).not.toHaveBeenCalled();

    // Restore the default module mock for subsequent tests.
    vi.doUnmock("../src/lib/chrome-api.js");
    vi.resetModules();
  });
});

// ─── restoreCommentCache ─────────────────────────────────────────────────

describe("fetcher.restoreCommentCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("populates cache from session storage on startup", async () => {
    const { fetcher } = build();
    mockSession.get.mockResolvedValue({
      latestCommentUrlCache: {
        42: { url: "https://github.com/x/y#42", updated_at: "2024-03-01" },
      },
    });

    await fetcher.restoreCommentCache();

    expect(fetcher._commentCache.get("42")).toEqual({
      url: "https://github.com/x/y#42",
      updated_at: "2024-03-01",
    });
  });

  it("does nothing when session storage has no cached data", async () => {
    const { fetcher } = build();
    mockSession.get.mockResolvedValue({});

    await fetcher.restoreCommentCache();

    expect(fetcher._commentCache.size).toBe(0);
  });

  it("does nothing when cached value is not an object", async () => {
    const { fetcher } = build();
    mockSession.get.mockResolvedValue({ latestCommentUrlCache: "corrupt" });

    await fetcher.restoreCommentCache();

    expect(fetcher._commentCache.size).toBe(0);
  });

  it("silently swallows session storage read errors", async () => {
    const { fetcher } = build();
    mockSession.get.mockRejectedValue(new Error("storage error"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(fetcher.restoreCommentCache()).resolves.toBeUndefined();

    warnSpy.mockRestore();
  });
});

// ─── prefetchLatestCommentUrls ───────────────────────────────────────────

describe("fetcher.prefetchLatestCommentUrls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.set.mockResolvedValue(undefined);
  });

  it("populates cache for Issue notifications with comments", async () => {
    const { github, fetcher } = build();
    github.getLatestCommentUrl.mockResolvedValue(
      "https://github.com/owner/repo/issues/1#issuecomment-1",
    );

    await fetcher.prefetchLatestCommentUrls([
      {
        id: "n1",
        type: "Issue",
        comment_count: 3,
        updated_at: "2024-01-01T00:00:00Z",
        repository: { full_name: "owner/repo" },
        number: 1,
      },
    ]);

    expect(fetcher._commentCache.get("n1")).toEqual({
      url: "https://github.com/owner/repo/issues/1#issuecomment-1",
      updated_at: "2024-01-01T00:00:00Z",
    });
  });

  it("does not prefetch for notifications without comments", async () => {
    const { github, fetcher } = build();

    await fetcher.prefetchLatestCommentUrls([
      {
        id: "n2",
        type: "Issue",
        comment_count: 0,
        updated_at: "2024-01-01T00:00:00Z",
        repository: { full_name: "owner/repo" },
        number: 2,
      },
    ]);

    expect(github.getLatestCommentUrl).not.toHaveBeenCalled();
    expect(fetcher._commentCache.has("n2")).toBe(false);
  });

  it("does not prefetch for unsupported notification types", async () => {
    const { github, fetcher } = build();

    await fetcher.prefetchLatestCommentUrls([
      {
        id: "n3",
        type: "Release",
        comment_count: 5,
        updated_at: "2024-01-01T00:00:00Z",
        repository: { full_name: "owner/repo" },
        number: 3,
      },
    ]);

    expect(github.getLatestCommentUrl).not.toHaveBeenCalled();
  });

  it("skips already-cached entries with matching updated_at", async () => {
    const { github, fetcher } = build();
    fetcher._commentCache.set("n4", {
      url: "https://github.com/owner/repo/issues/4#issuecomment-cached",
      updated_at: "2024-01-01T00:00:00Z",
    });

    await fetcher.prefetchLatestCommentUrls([
      {
        id: "n4",
        type: "Issue",
        comment_count: 2,
        updated_at: "2024-01-01T00:00:00Z",
        repository: { full_name: "owner/repo" },
        number: 4,
      },
    ]);

    expect(github.getLatestCommentUrl).not.toHaveBeenCalled();
  });

  it("re-fetches and updates cache when updated_at changed", async () => {
    const { github, fetcher } = build();
    fetcher._commentCache.set("n5", {
      url: "https://github.com/owner/repo/issues/5#issuecomment-old",
      updated_at: "2024-01-01T00:00:00Z",
    });
    github.getLatestCommentUrl.mockResolvedValue(
      "https://github.com/owner/repo/issues/5#issuecomment-new",
    );

    await fetcher.prefetchLatestCommentUrls([
      {
        id: "n5",
        type: "Issue",
        comment_count: 3,
        updated_at: "2024-06-01T00:00:00Z",
        repository: { full_name: "owner/repo" },
        number: 5,
      },
    ]);

    expect(fetcher._commentCache.get("n5")).toEqual({
      url: "https://github.com/owner/repo/issues/5#issuecomment-new",
      updated_at: "2024-06-01T00:00:00Z",
    });
  });

  it("prunes cache entries for notifications no longer in the list", async () => {
    const { fetcher } = build();
    fetcher._commentCache.set("removed-notif", {
      url: "https://github.com/owner/repo/issues/99#issuecomment-1",
      updated_at: "2024-01-01T00:00:00Z",
    });

    await fetcher.prefetchLatestCommentUrls([]);

    expect(fetcher._commentCache.has("removed-notif")).toBe(false);
  });
});

// ─── runFetch race-condition guards ──────────────────────────────────────

describe("fetcher.runFetch race-condition guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.set.mockResolvedValue(undefined);
    mockSession.get.mockResolvedValue({});
  });

  it("excludes pre-existing notifications removed during the fetch", async () => {
    // GitHub returns A and B; A was already in storage before the fetch
    // and was removed (e.g. by markAsRead) while the fetch was in-flight.
    const { storage, github, fetcher } = build({
      storageInit: { notifications: [makeStoredNotif("A"), makeStoredNotif("B")] },
    });
    github.getNotifications.mockResolvedValue({
      items: [makeRawNotif("A"), makeRawNotif("B")],
      hasMore: false,
    });
    storage.getNotifications
      .mockResolvedValueOnce([makeStoredNotif("A"), makeStoredNotif("B")]) // existingIds snapshot
      .mockResolvedValueOnce([makeStoredNotif("B")]); // safeBasic re-read (A removed)

    await fetcher.runFetch();

    const writeCalls = storage.setNotifications.mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    const basicWrite = writeCalls[0][0];
    expect(basicWrite.map((n) => n.id)).not.toContain("A");
    expect(basicWrite.map((n) => n.id)).toContain("B");
  });

  it("always keeps new notifications not in existingIds", async () => {
    const { storage, github, fetcher } = build({
      storageInit: { notifications: [makeStoredNotif("A")] },
    });
    github.getNotifications.mockResolvedValue({
      items: [makeRawNotif("A"), makeRawNotif("C")],
      hasMore: false,
    });
    storage.getNotifications
      .mockResolvedValueOnce([makeStoredNotif("A")])
      .mockResolvedValueOnce([makeStoredNotif("A")]);

    await fetcher.runFetch();

    const basicWrite = storage.setNotifications.mock.calls[0][0];
    const writtenIds = basicWrite.map((n) => n.id);
    expect(writtenIds).toContain("C"); // never seen before → kept unconditionally
    expect(writtenIds).toContain("A"); // existing and still in storage → kept
  });

  it("aborts when version is bumped during safeBasic re-read", async () => {
    const { storage, github, fetcher } = build();
    github.getNotifications.mockResolvedValue({
      items: [makeRawNotif("A"), makeRawNotif("B")],
      hasMore: false,
    });

    let releaseSafeBasicRead;
    storage.getNotifications
      .mockResolvedValueOnce([makeStoredNotif("A"), makeStoredNotif("B")]) // existingIds
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseSafeBasicRead = resolve;
          }),
      ); // safeBasic re-read held

    const fetchPromise = fetcher.runFetch();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // External mark-as-read bumps the fetch version while the re-read is held.
    fetcher.bumpVersion();

    releaseSafeBasicRead([makeStoredNotif("B")]);
    await fetchPromise;

    // The fetch should have aborted before any write committed, since the
    // version check sees a bumped version and returns early.
    expect(storage.setNotifications).not.toHaveBeenCalled();
  });

  it("passes forceRefresh=true when fetching details for updated notifications", async () => {
    const oldNotif = makeRawNotif("X", {
      subject: {
        title: "Issue X",
        type: "Issue",
        url: "https://api.github.com/repos/o/r/issues/1",
      },
    });
    const updatedNotif = { ...oldNotif, updated_at: "2024-06-01T00:00:00Z" };

    const { storage, github, fetcher } = build({
      storageInit: { notifications: [makeStoredNotif("X")] },
    });
    github.getNotifications.mockResolvedValue({ items: [updatedNotif], hasMore: false });
    storage.getNotifications.mockResolvedValue([makeStoredNotif("X")]);
    github.getNotificationDetails.mockResolvedValue({
      state: "closed",
      user: { login: "alice", avatar_url: "https://example.com/a.png", html_url: "" },
    });

    await fetcher.runFetch();

    expect(github.getNotificationDetails).toHaveBeenCalled();
    const [, forceRefresh] = github.getNotificationDetails.mock.calls[0];
    expect(forceRefresh).toBe(true);
  });
});

// ─── runFetch poll-interval signaling ────────────────────────────────────

describe("fetcher.runFetch poll-interval hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.set.mockResolvedValue(undefined);
    mockSession.get.mockResolvedValue({});
  });

  it("fires onPollIntervalChanged before any storage write so a later failure cannot lose it", async () => {
    // Regression guard for the fix in 05b9815: the alarm-update signal must
    // NOT depend on a successful runFetch return, since storage failures
    // partway through would otherwise drop the new poll cadence.
    const { storage, github, onPollIntervalChanged, fetcher } = build();
    github.getNotifications.mockImplementationOnce(async () => {
      github.pollInterval = 180; // mimic real client updating from response header
      return { items: [makeRawNotif("X")], hasMore: false };
    });
    storage.getNotifications.mockResolvedValue([]);
    storage.setNotifications.mockRejectedValueOnce(new Error("Storage quota exceeded"));

    // runFetch will throw, but onPollIntervalChanged must already have fired.
    await expect(fetcher.runFetch()).rejects.toThrow("Storage quota exceeded");

    expect(onPollIntervalChanged).toHaveBeenCalledWith(3); // 180s → 3 minutes
  });

  it("does not fire onPollIntervalChanged when the interval is unchanged", async () => {
    const { github, onPollIntervalChanged, fetcher } = build();
    github.pollInterval = 60;
    github.getNotifications.mockResolvedValue({ items: [], hasMore: false });

    await fetcher.runFetch();

    expect(onPollIntervalChanged).not.toHaveBeenCalled();
  });

  it("fires onPollIntervalChanged on a 304 response when the interval changed", async () => {
    const { github, onPollIntervalChanged, fetcher } = build();
    github.getNotifications.mockImplementationOnce(async () => {
      github.pollInterval = 120;
      return null; // 304 Not Modified
    });

    await fetcher.runFetch();

    expect(onPollIntervalChanged).toHaveBeenCalledWith(2);
  });
});
