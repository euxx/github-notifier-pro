import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockStorage = {
  local: { get: vi.fn(), set: vi.fn(), remove: vi.fn(), clear: vi.fn() },
  onChanged: { addListener: vi.fn() },
};
const mockListener = { addListener: vi.fn() };

vi.stubGlobal("chrome", {
  storage: mockStorage,
  runtime: {
    sendMessage: vi.fn(),
    onMessage: mockListener,
    onStartup: mockListener,
    onInstalled: mockListener,
    getURL: vi.fn(),
  },
  action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setTitle: vi.fn() },
  alarms: { create: vi.fn(), clear: vi.fn(), getAll: vi.fn(), onAlarm: mockListener },
  tabs: { create: vi.fn() },
  notifications: { create: vi.fn(), clear: vi.fn(), onClicked: mockListener },
});

const { getAvatarSrc, ensureAvatarsCached, clearAvatarCache, setActive, loadSnapshot } =
  await import("../src/lib/avatar-cache.js");

const STORAGE_KEY = "avatarDataCache";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function makeBlob(bytes, type = "image/png") {
  const buffer = new Uint8Array(bytes).buffer;
  return { size: bytes.length, type, arrayBuffer: async () => buffer };
}

function makeResponse({
  status = 200,
  headers = {},
  bytes = [1, 2, 3, 4],
  type = "image/png",
} = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    blob: async () => makeBlob(bytes, type),
    headers: { get: (name) => headers[name.toLowerCase()] ?? headers[name] ?? null },
  };
}

function readStoredCache() {
  const lastCall = mockStorage.local.set.mock.calls.at(-1);
  return lastCall?.[0]?.[STORAGE_KEY];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  setActive(true);
  globalThis.fetch = vi.fn();
  mockStorage.local.get.mockResolvedValue({ [STORAGE_KEY]: {} });
  mockStorage.local.set.mockResolvedValue(undefined);
});

afterEach(async () => {
  // Drain the internal write queue so prior tests don't leak into the next.
  await clearAvatarCache();
});

describe("getAvatarSrc", () => {
  async function primeSnapshot(map) {
    mockStorage.local.get.mockResolvedValue({ [STORAGE_KEY]: map });
    await loadSnapshot();
  }

  it("returns null for nullish person", async () => {
    await primeSnapshot({});
    expect(getAvatarSrc(null)).toBeNull();
    expect(getAvatarSrc(undefined)).toBeNull();
  });

  it("returns dataUrl when the cache entry matches person.avatar_url", async () => {
    await primeSnapshot({
      alice: { url: "https://example.com/a.png", dataUrl: "data:image/png;base64,AAAA" },
    });
    expect(getAvatarSrc({ login: "alice", avatar_url: "https://example.com/a.png" })).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  it("falls back to avatar_url when cached URL no longer matches (Gravatar swap)", async () => {
    await primeSnapshot({
      alice: { url: "https://example.com/old.png", dataUrl: "data:image/png;base64,AAAA" },
    });
    expect(getAvatarSrc({ login: "alice", avatar_url: "https://example.com/new.png" })).toBe(
      "https://example.com/new.png",
    );
  });

  it("falls back to avatar_url when person is unseen", async () => {
    await primeSnapshot({});
    expect(getAvatarSrc({ login: "bob", avatar_url: "https://example.com/b.png" })).toBe(
      "https://example.com/b.png",
    );
  });
});

describe("ensureAvatarsCached", () => {
  it("is a no-op for empty / invalid input", async () => {
    await ensureAvatarsCached([]);
    await ensureAvatarsCached(null);
    await ensureAvatarsCached([{ login: "a" }, { avatar_url: "x" }]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockStorage.local.set).not.toHaveBeenCalled();
  });

  it("deduplicates by login", async () => {
    globalThis.fetch.mockResolvedValue(makeResponse({ headers: { "Last-Modified": "X" } }));
    await ensureAvatarsCached([
      { login: "alice", avatar_url: "https://example.com/a.png" },
      { login: "alice", avatar_url: "https://example.com/a.png" },
      { login: "alice", avatar_url: "https://example.com/a.png" },
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("requests the small avatar variant (s=80)", async () => {
    globalThis.fetch.mockResolvedValue(makeResponse());
    await ensureAvatarsCached([
      { login: "alice", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" },
    ]);
    const calledUrl = globalThis.fetch.mock.calls[0][0];
    expect(calledUrl).toContain("s=80");
  });

  it("stores a data URL + Last-Modified after a 200", async () => {
    globalThis.fetch.mockResolvedValue(
      makeResponse({ headers: { "Last-Modified": "Mon, 01 Jan 2024 00:00:00 GMT" } }),
    );
    await ensureAvatarsCached([{ login: "alice", avatar_url: "https://example.com/a.png" }]);

    const cache = readStoredCache();
    expect(cache.alice.url).toBe("https://example.com/a.png");
    expect(cache.alice.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(cache.alice.lastModified).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
    expect(cache.alice.cachedAt).toBeTypeOf("string");
    expect(cache.alice.lastSeenAt).toBeTypeOf("string");
  });

  it("skips fetch when the entry is still TTL-fresh", async () => {
    const now = new Date().toISOString();
    mockStorage.local.get.mockResolvedValue({
      [STORAGE_KEY]: {
        alice: {
          url: "https://example.com/a.png",
          dataUrl: "data:image/png;base64,AAAA",
          cachedAt: now,
          lastSeenAt: now,
        },
      },
    });

    await ensureAvatarsCached([{ login: "alice", avatar_url: "https://example.com/a.png" }]);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    // Still writes back to bump lastSeenAt.
    const cache = readStoredCache();
    expect(cache.alice.dataUrl).toBe("data:image/png;base64,AAAA");
  });

  it("sends If-Modified-Since when cache has Last-Modified and URL unchanged", async () => {
    const stale = new Date(Date.now() - TTL_MS - 1).toISOString();
    mockStorage.local.get.mockResolvedValue({
      [STORAGE_KEY]: {
        alice: {
          url: "https://example.com/a.png",
          dataUrl: "data:image/png;base64,AAAA",
          lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
          cachedAt: stale,
          lastSeenAt: stale,
        },
      },
    });
    globalThis.fetch.mockResolvedValue(makeResponse({ status: 304 }));

    await ensureAvatarsCached([{ login: "alice", avatar_url: "https://example.com/a.png" }]);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.headers["If-Modified-Since"]).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
  });

  it("keeps existing dataUrl on 304 and bumps cachedAt", async () => {
    const stale = new Date(Date.now() - TTL_MS - 1).toISOString();
    mockStorage.local.get.mockResolvedValue({
      [STORAGE_KEY]: {
        alice: {
          url: "https://example.com/a.png",
          dataUrl: "data:image/png;base64,OLD",
          lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
          cachedAt: stale,
          lastSeenAt: stale,
        },
      },
    });
    globalThis.fetch.mockResolvedValue(makeResponse({ status: 304 }));

    await ensureAvatarsCached([{ login: "alice", avatar_url: "https://example.com/a.png" }]);

    const cache = readStoredCache();
    expect(cache.alice.dataUrl).toBe("data:image/png;base64,OLD");
    expect(cache.alice.cachedAt).not.toBe(stale);
  });

  it("replaces dataUrl + Last-Modified on 200 (content changed at same URL)", async () => {
    const stale = new Date(Date.now() - TTL_MS - 1).toISOString();
    mockStorage.local.get.mockResolvedValue({
      [STORAGE_KEY]: {
        alice: {
          url: "https://example.com/a.png",
          dataUrl: "data:image/png;base64,OLD",
          lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
          cachedAt: stale,
          lastSeenAt: stale,
        },
      },
    });
    globalThis.fetch.mockResolvedValue(
      makeResponse({
        status: 200,
        headers: { "Last-Modified": "Tue, 02 Jan 2024 00:00:00 GMT" },
        bytes: [9, 9, 9, 9],
      }),
    );

    await ensureAvatarsCached([{ login: "alice", avatar_url: "https://example.com/a.png" }]);

    const cache = readStoredCache();
    expect(cache.alice.dataUrl).not.toBe("data:image/png;base64,OLD");
    expect(cache.alice.lastModified).toBe("Tue, 02 Jan 2024 00:00:00 GMT");
  });

  it("does NOT send If-Modified-Since when avatar_url changed", async () => {
    const stale = new Date(Date.now() - TTL_MS - 1).toISOString();
    mockStorage.local.get.mockResolvedValue({
      [STORAGE_KEY]: {
        alice: {
          url: "https://example.com/old.png",
          dataUrl: "data:image/png;base64,AAAA",
          lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
          cachedAt: stale,
          lastSeenAt: stale,
        },
      },
    });
    globalThis.fetch.mockResolvedValue(makeResponse());

    await ensureAvatarsCached([{ login: "alice", avatar_url: "https://example.com/new.png" }]);

    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.headers["If-Modified-Since"]).toBeUndefined();
  });

  it("does not write when blob is over size limit", async () => {
    globalThis.fetch.mockResolvedValue(
      makeResponse({ bytes: Array.from({ length: 100 * 1024 }, () => 0) }),
    );

    await ensureAvatarsCached([{ login: "alice", avatar_url: "https://example.com/a.png" }]);

    const cache = readStoredCache();
    expect(cache?.alice).toBeUndefined();
  });

  it("swallows fetch errors and leaves cache untouched", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch.mockRejectedValue(new Error("network down"));

    await ensureAvatarsCached([{ login: "alice", avatar_url: "https://example.com/a.png" }]);

    expect(mockStorage.local.set).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("Avatar refresh failed for", "alice", expect.any(Error));
    warnSpy.mockRestore();
  });

  it("evicts oldest entries by lastSeenAt when over MAX_ENTRIES", async () => {
    const start = {};
    // Pre-populate cache at the entry-count cap so adding one more forces an eviction.
    const past = Date.now() - 60_000;
    for (let i = 0; i < 100; i++) {
      start[`user${i}`] = {
        url: `https://example.com/${i}.png`,
        dataUrl: "data:image/png;base64,X",
        cachedAt: new Date(past).toISOString(),
        // Strictly increasing lastSeenAt (all in the past) — user0 is oldest,
        // newcomer's real-time lastSeenAt will be the newest.
        lastSeenAt: new Date(past + i).toISOString(),
      };
    }
    mockStorage.local.get.mockResolvedValue({ [STORAGE_KEY]: start });
    globalThis.fetch.mockResolvedValue(makeResponse());

    await ensureAvatarsCached([{ login: "newcomer", avatar_url: "https://example.com/new.png" }]);

    const cache = readStoredCache();
    expect(Object.keys(cache).length).toBe(100);
    expect(cache.newcomer).toBeDefined();
    expect(cache.user0).toBeUndefined(); // oldest evicted
    expect(cache.user99).toBeDefined();
  });

  it("evicts oldest entries by lastSeenAt when total dataUrl bytes exceed budget", async () => {
    // Pre-populate well under MAX_ENTRIES but well over the 5 MB total budget,
    // so the count-based path can't be the cause of eviction.
    const start = {};
    const past = Date.now() - 60_000;
    const bigDataUrl = "data:image/png;base64," + "A".repeat(100 * 1024); // ~100 KB per entry
    for (let i = 0; i < 80; i++) {
      start[`user${i}`] = {
        url: `https://example.com/${i}.png`,
        dataUrl: bigDataUrl,
        cachedAt: new Date(past).toISOString(),
        // Strictly increasing — user0 is oldest — but all still in the past
        // so newcomer's real-time lastSeenAt is unambiguously the newest.
        lastSeenAt: new Date(past + i).toISOString(),
      };
    }
    mockStorage.local.get.mockResolvedValue({ [STORAGE_KEY]: start });
    globalThis.fetch.mockResolvedValue(makeResponse());

    await ensureAvatarsCached([{ login: "newcomer", avatar_url: "https://example.com/new.png" }]);

    const cache = readStoredCache();
    const total = Object.values(cache).reduce((sum, e) => sum + (e?.dataUrl?.length || 0), 0);
    expect(total).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(cache.newcomer).toBeDefined();
    // Oldest entries must be the ones dropped.
    expect(cache.user0).toBeUndefined();
    expect(cache.user79).toBeDefined();
  });

  it("limits concurrent fetches", async () => {
    let inFlight = 0;
    let peak = 0;
    globalThis.fetch.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return makeResponse();
    });

    const people = [];
    for (let i = 0; i < 20; i++) {
      people.push({ login: `u${i}`, avatar_url: `https://example.com/${i}.png` });
    }
    await ensureAvatarsCached(people);

    expect(peak).toBeLessThanOrEqual(5);
    expect(globalThis.fetch).toHaveBeenCalledTimes(20);
  });
});

describe("setActive — logout gating", () => {
  it("setActive(false) prevents any fetch or write", async () => {
    setActive(false);
    globalThis.fetch.mockResolvedValue(makeResponse());

    await ensureAvatarsCached([{ login: "alice", avatar_url: "https://example.com/a.png" }]);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockStorage.local.set).not.toHaveBeenCalled();
  });

  it("logout between enqueue and mutator-start skips the write", async () => {
    // Models the runFetch race: ensureAvatarsCached is invoked while still
    // active (so it gets past the entry guard and queues a mutator), then
    // logout flips the flag before the mutator's microtask runs.
    globalThis.fetch.mockResolvedValue(makeResponse());

    const pending = ensureAvatarsCached([
      { login: "alice", avatar_url: "https://example.com/a.png" },
    ]);
    // Synchronously flip active — the queued mutator hasn't run yet.
    setActive(false);
    await pending;

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockStorage.local.set).not.toHaveBeenCalled();
  });

  it("setActive(true) re-enables the cache after logout", async () => {
    setActive(false);
    await ensureAvatarsCached([{ login: "alice", avatar_url: "https://example.com/a.png" }]);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    setActive(true);
    globalThis.fetch.mockResolvedValue(makeResponse());
    await ensureAvatarsCached([{ login: "alice", avatar_url: "https://example.com/a.png" }]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("logout + re-login across an in-flight warmup discards the stale write", async () => {
    // Cross-account race: account A's warmup gets past the entry guard while
    // active=true, but logout (account A) and re-login (account B) both flip
    // the flag before the queued mutator runs. A boolean guard would see
    // active=true at the final-write check and resurrect account A's data;
    // the generation check catches it.
    globalThis.fetch.mockResolvedValue(makeResponse());

    const pending = ensureAvatarsCached([
      { login: "accountA", avatar_url: "https://example.com/a.png" },
    ]);
    setActive(false); // logout A
    setActive(true); // login as B
    await pending;

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockStorage.local.set).not.toHaveBeenCalled();
  });
});
