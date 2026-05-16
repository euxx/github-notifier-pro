import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSyncEngine } from "../src/background/sync-engine.js";

/**
 * Build a fake storage backed by an in-memory map. Returns a module-shaped
 * object with the getters/setters the engine uses.
 */
function makeStorage(initial = {}) {
  const state = {
    syncEnabled: false,
    syncGistId: null,
    notificationFilter: [],
    syncLastPushedFilter: null,
    syncLastPush: null,
    notificationFilterStats: [],
    ...initial,
  };
  return {
    state,
    getSyncEnabled: vi.fn(async () => state.syncEnabled),
    setSyncEnabled: vi.fn(async (v) => {
      state.syncEnabled = v;
    }),
    getSyncGistId: vi.fn(async () => state.syncGistId),
    setSyncGistId: vi.fn(async (v) => {
      state.syncGistId = v;
    }),
    getNotificationFilter: vi.fn(async () => state.notificationFilter),
    setNotificationFilter: vi.fn(async (v) => {
      state.notificationFilter = v;
    }),
    getSyncLastPushedFilter: vi.fn(async () => state.syncLastPushedFilter),
    setSyncLastPushedFilter: vi.fn(async (v) => {
      state.syncLastPushedFilter = v === null ? null : JSON.stringify(v);
    }),
    getSyncLastPush: vi.fn(async () => state.syncLastPush),
    setSyncLastPush: vi.fn(async (v) => {
      state.syncLastPush = v;
    }),
    setNotificationFilterStats: vi.fn(async (v) => {
      state.notificationFilterStats = v;
    }),
  };
}

function makeGithub() {
  return {
    getFilterGist: vi.fn(),
    updateFilterGist: vi.fn(),
  };
}

function build({ storageInit = {}, onFilterReplaced } = {}) {
  const storage = makeStorage(storageInit);
  const github = makeGithub();
  const hook = onFilterReplaced || vi.fn(async () => {});
  const engine = createSyncEngine({ github, storage, onFilterReplaced: hook });
  return { storage, github, hook, engine };
}

describe("syncEngine.pushIfEnabled - debounced auto push", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pushes after debounce window when sync is enabled", async () => {
    const { storage, github, engine } = build({
      storageInit: {
        syncEnabled: true,
        syncGistId: "gist-id",
        notificationFilter: [{ repos: [], keywords: ["new-kw"] }],
      },
    });
    github.getFilterGist.mockResolvedValue({
      rules: [{ repos: [], keywords: ["old-kw"] }],
      updatedAt: "2026-01-01T00:00:00Z",
    });
    github.updateFilterGist.mockResolvedValue({
      id: "gist-id",
      updatedAt: "2026-05-14T10:00:00Z",
    });

    engine.pushIfEnabled();
    await vi.advanceTimersByTimeAsync(2100);

    expect(github.updateFilterGist).toHaveBeenCalledWith(
      "gist-id",
      storage.state.notificationFilter,
    );
  });

  it("does not push when sync is disabled", async () => {
    const { github, engine } = build({
      storageInit: {
        syncEnabled: false,
        notificationFilter: [{ repos: [], keywords: ["test"] }],
      },
    });

    engine.pushIfEnabled();
    await vi.advanceTimersByTimeAsync(2100);

    expect(github.updateFilterGist).not.toHaveBeenCalled();
  });
});

describe("syncEngine.push - gist_not_found auto-disable", () => {
  it("clears gist id and disables sync when remote gist is missing", async () => {
    const { storage, github, engine } = build({
      storageInit: {
        syncEnabled: true,
        syncGistId: "gist-id",
        notificationFilter: [{ repos: [], keywords: ["x"] }],
      },
    });
    github.getFilterGist.mockResolvedValue({
      rules: [{ repos: [], keywords: ["old"] }],
      updatedAt: "2026-01-01T00:00:00Z",
    });
    github.updateFilterGist.mockResolvedValue(null);

    const result = await engine.push();

    expect(storage.setSyncGistId).toHaveBeenCalledWith(null);
    expect(storage.setSyncEnabled).toHaveBeenCalledWith(false);
    expect(result).toEqual({ success: false, error: "gist_not_found" });
  });
});

describe("syncEngine.push - conflict detection", () => {
  it("returns conflict when remote updatedAt is newer than lastPush and rules differ", async () => {
    const localRules = [{ repos: [], keywords: ["local"] }];
    const remoteRules = [{ repos: [], keywords: ["remote"] }];
    const { github, engine } = build({
      storageInit: {
        syncEnabled: true,
        syncGistId: "gist-id",
        notificationFilter: localRules,
        syncLastPush: "2026-05-14T10:00:00Z",
        syncLastPushedFilter: JSON.stringify([{ repos: [], keywords: ["original"] }]),
      },
    });
    github.getFilterGist.mockResolvedValue({
      rules: remoteRules,
      updatedAt: "2026-05-14T12:00:00Z",
    });

    const result = await engine.push();

    expect(github.updateFilterGist).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: "conflict",
      local: localRules,
      remote: remoteRules,
    });
  });

  it("ignores remote gist timestamp changes without rule changes when pushing local edits", async () => {
    const originalRules = [{ repos: [], keywords: ["original"] }];
    const localRules = [{ repos: [], keywords: ["local"] }];
    const { github, engine } = build({
      storageInit: {
        syncEnabled: true,
        syncGistId: "gist-id",
        notificationFilter: localRules,
        syncLastPush: "2026-05-14T10:00:00Z",
        syncLastPushedFilter: JSON.stringify(originalRules),
      },
    });
    github.getFilterGist.mockResolvedValue({
      rules: originalRules,
      updatedAt: "2026-05-14T12:00:00Z",
    });
    github.updateFilterGist.mockResolvedValue({
      id: "gist-id",
      updatedAt: "2026-05-14T10:00:00Z",
    });

    const result = await engine.push();

    expect(github.updateFilterGist).toHaveBeenCalledWith("gist-id", localRules);
    expect(result).toEqual({ success: true });
  });
});

describe("syncEngine.applyRemoteRules + push - pushNeeded branch", () => {
  /**
   * Mirrors the SW SYNC_PULL handler: applyRemoteRules first, then push if
   * pushNeeded is set. Returning the original pull result on success keeps
   * assertions structurally identical to the handler's own behavior.
   */
  async function pull(engine) {
    const result = await engine.applyRemoteRules("gist-id");
    if (result.pushNeeded) {
      const pushResult = await engine.push({ afterPull: true });
      if (!pushResult.success) return pushResult;
    }
    return result;
  }

  it("triggers push when local has edits but remote has not changed", async () => {
    const localRules = [{ repos: [], keywords: ["local-edit"] }];
    const remoteRules = [{ repos: [], keywords: ["original"] }];
    const { github, engine } = build({
      storageInit: {
        syncEnabled: true,
        syncGistId: "gist-id",
        notificationFilter: localRules,
        syncLastPushedFilter: JSON.stringify([{ repos: [], keywords: ["original"] }]),
        syncLastPush: "2026-05-14T09:00:00Z",
      },
    });
    github.getFilterGist.mockResolvedValue({
      rules: remoteRules,
      updatedAt: "2026-05-14T08:00:00Z",
    });
    github.updateFilterGist.mockResolvedValue({
      id: "gist-id",
      updatedAt: "2026-05-14T10:00:00Z",
    });

    const result = await pull(engine);

    expect(github.updateFilterGist).toHaveBeenCalledWith("gist-id", localRules);
    expect(result).toEqual(expect.objectContaining({ success: true, pushNeeded: true }));
  });

  it("triggers push when remote gist timestamp changed without rule changes", async () => {
    const localRules = [{ repos: [], keywords: ["local-edit"] }];
    const remoteRules = [{ repos: [], keywords: ["original"] }];
    const { github, engine } = build({
      storageInit: {
        syncEnabled: true,
        syncGistId: "gist-id",
        notificationFilter: localRules,
        syncLastPushedFilter: JSON.stringify(remoteRules),
        syncLastPush: "2026-05-14T09:00:00Z",
      },
    });
    github.getFilterGist.mockResolvedValue({
      rules: remoteRules,
      updatedAt: "2026-05-14T12:00:00Z",
    });
    github.updateFilterGist.mockResolvedValue({
      id: "gist-id",
      updatedAt: "2026-05-14T10:00:00Z",
    });

    const result = await pull(engine);

    expect(github.updateFilterGist).toHaveBeenCalledWith("gist-id", localRules);
    expect(result).toEqual(expect.objectContaining({ success: true, pushNeeded: true }));
  });

  it("does not PATCH when local and remote rules differ only in field order", async () => {
    const localRules = [
      { keywords: ["beta"], repos: ["sw33tLie/macshot"] },
      { keywords: ["deps"], repos: ["TAVANV/dify"] },
    ];
    const remoteRules = [
      { repos: ["sw33tLie/macshot"], keywords: ["beta"] },
      { repos: ["TAVANV/dify"], keywords: ["deps"] },
    ];
    const { github, engine } = build({
      storageInit: {
        syncEnabled: true,
        syncGistId: "gist-id",
        notificationFilter: localRules,
        syncLastPushedFilter: JSON.stringify(localRules),
        syncLastPush: "2026-05-14T08:00:00Z",
      },
    });
    github.getFilterGist.mockResolvedValue({
      rules: remoteRules,
      updatedAt: "2026-05-14T08:00:00Z",
    });

    const result = await pull(engine);

    expect(github.updateFilterGist).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ success: true, skipped: true }));
  });

  it("PATCHes via afterPull path when local has unpushed edits", async () => {
    const localRules = [{ repos: [], keywords: ["local-edit"] }];
    const remoteRules = [{ repos: [], keywords: ["original"] }];
    const lastPushedRules = [{ repos: [], keywords: ["original"] }];
    const { github, engine } = build({
      storageInit: {
        syncEnabled: true,
        syncGistId: "gist-id",
        notificationFilter: localRules,
        syncLastPushedFilter: JSON.stringify(lastPushedRules),
        syncLastPush: "2026-05-14T08:00:00Z",
      },
    });
    github.getFilterGist.mockResolvedValue({
      rules: remoteRules,
      updatedAt: "2026-05-14T08:00:00Z",
    });
    github.updateFilterGist.mockResolvedValue({
      id: "gist-id",
      updatedAt: "2026-05-14T10:00:00Z",
    });

    await pull(engine);

    expect(github.updateFilterGist).toHaveBeenCalledWith("gist-id", localRules);
    // applyRemoteRules + afterPull push share one getFilterGist read
    expect(github.getFilterGist).toHaveBeenCalledTimes(1);
  });

  it("requires remote check on manual push even when local matches last pushed", async () => {
    const localRules = [{ repos: [], keywords: ["local-only"] }];
    const remoteRules = [{ repos: [], keywords: ["remote-changed"] }];
    const { github, engine } = build({
      storageInit: {
        syncEnabled: true,
        syncGistId: "gist-id",
        notificationFilter: localRules,
        syncLastPushedFilter: JSON.stringify(localRules),
        syncLastPush: "2026-05-14T08:00:00Z",
      },
    });
    github.getFilterGist.mockResolvedValue({
      rules: remoteRules,
      updatedAt: "2026-05-14T09:00:00Z",
    });

    const result = await engine.push();

    expect(github.getFilterGist).toHaveBeenCalledWith("gist-id");
    expect(result).toEqual(expect.objectContaining({ success: false, error: "conflict" }));
    expect(github.updateFilterGist).not.toHaveBeenCalled();
  });
});

describe("syncEngine.applyRemoteRules - gist_not_found", () => {
  it("returns gist_not_found when remote gist read returns null", async () => {
    const { github, engine } = build({
      storageInit: { syncEnabled: true, syncGistId: "gist-id" },
    });
    github.getFilterGist.mockResolvedValue(null);

    const result = await engine.applyRemoteRules("gist-id");

    expect(result).toEqual({ success: false, error: "gist_not_found" });
  });
});

describe("syncEngine.acceptRemoteFilter - onFilterReplaced hook", () => {
  it("invokes onFilterReplaced after persisting accepted remote rules", async () => {
    const remoteRules = [{ repos: [], keywords: ["remote-only"] }];
    const remoteUpdatedAt = "2026-05-14T12:00:00Z";
    const { github, hook, engine } = build({
      storageInit: {
        syncEnabled: true,
        syncGistId: "gist-id",
        notificationFilter: [{ repos: [], keywords: ["local"] }],
      },
    });
    github.getFilterGist.mockResolvedValue({
      rules: remoteRules,
      updatedAt: remoteUpdatedAt,
    });

    const result = await engine.applyRemoteRules("gist-id");

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(remoteRules, remoteUpdatedAt);
  });
});
