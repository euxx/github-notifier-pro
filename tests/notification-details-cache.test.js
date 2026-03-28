/**
 * Tests for notification details caching
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { github } from "../src/lib/github-api.js";

describe("Notification Details Cache", () => {
  beforeEach(() => {
    github.token = "test_token";
    github.username = "testuser";
    github.detailsCache.clear();
    vi.clearAllMocks();
  });

  it("should cache notification details by URL", async () => {
    const notification = {
      subject: {
        type: "Issue",
        title: "Test Issue",
        url: "https://api.github.com/repos/test/repo/issues/1",
      },
      repository: {
        name: "repo",
        full_name: "test/repo",
        html_url: "https://github.com/test/repo",
      },
    };

    const mockDetails = {
      state: "open",
      user: { login: "tester", avatar_url: "https://avatar.url" },
      number: 1,
      comments: 5,
    };

    let fetchCount = 0;
    global.fetch = vi.fn(async () => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        headers: {
          get: () => null,
        },
        json: async () => mockDetails,
      };
    });

    // First call - should fetch from API
    const result1 = await github.getNotificationDetails(notification);
    expect(result1).toEqual(mockDetails);
    expect(fetchCount).toBe(1);

    // Second call - should use cache
    const result2 = await github.getNotificationDetails(notification);
    expect(result2).toEqual(mockDetails);
    expect(fetchCount).toBe(1); // Still 1, not 2

    // Cache should have the entry
    expect(github.detailsCache.has(notification.subject.url)).toBe(true);
  });

  it("should respect forceRefresh parameter", async () => {
    const notification = {
      subject: {
        type: "PullRequest",
        title: "Test PR",
        url: "https://api.github.com/repos/test/repo/pulls/1",
      },
      repository: {
        name: "repo",
        full_name: "test/repo",
        html_url: "https://github.com/test/repo",
      },
    };

    const mockDetails = {
      state: "open",
      user: { login: "tester", avatar_url: "https://avatar.url" },
      number: 1,
    };

    let fetchCount = 0;
    global.fetch = vi.fn(async () => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        headers: {
          get: () => null,
        },
        json: async () => ({ ...mockDetails, fetchCount }),
      };
    });

    // First call
    await github.getNotificationDetails(notification);
    expect(fetchCount).toBe(1);

    // Second call with forceRefresh=true - should bypass cache
    const result = await github.getNotificationDetails(notification, true);
    expect(fetchCount).toBe(2);
    expect(result.fetchCount).toBe(2);
  });

  it("should not cache notifications without subject.url", async () => {
    const notification = {
      subject: {
        type: "CheckSuite",
        title: "Test workflow run succeeded",
        url: null, // No URL
      },
      repository: {
        name: "repo",
        full_name: "test/repo",
        html_url: "https://github.com/test/repo",
        owner: { login: "test", avatar_url: "https://avatar.url" },
      },
      updated_at: new Date().toISOString(),
    };

    github.userInfo = { login: "test", avatar_url: "https://avatar.url" };

    const result = await github.getNotificationDetails(notification);

    // Should return result but not cache it (no URL to use as key)
    expect(result.conclusion).toBeDefined();
    expect(github.detailsCache.size).toBe(0);
  });

  it("should clear cache on logout", () => {
    // Add some data to cache
    github.detailsCache.set("https://api.github.com/repos/test/repo/issues/1", {
      state: "open",
    });
    github.detailsCache.set("https://api.github.com/repos/test/repo/pulls/2", {
      state: "closed",
    });

    expect(github.detailsCache.size).toBe(2);

    github.logout();

    expect(github.detailsCache.size).toBe(0);
    expect(github.token).toBeNull();
    expect(github.lastModified).toBeNull();
  });

  it("should have cache size limit of 100", () => {
    expect(github.detailsCache.maxSize).toBe(100);
  });

  it("should evict oldest entries when cache is full", async () => {
    // Fill cache to capacity
    for (let i = 0; i < 100; i++) {
      github.detailsCache.set(`url_${i}`, { id: i });
    }

    expect(github.detailsCache.size).toBe(100);
    expect(github.detailsCache.has("url_0")).toBe(true);

    // Add one more - should evict oldest
    github.detailsCache.set("url_100", { id: 100 });

    expect(github.detailsCache.size).toBe(100);
    expect(github.detailsCache.has("url_0")).toBe(false);
    expect(github.detailsCache.has("url_100")).toBe(true);
  });

  it("should cache details and return same instance on subsequent calls", async () => {
    const notification = {
      subject: {
        type: "Issue",
        title: "Test",
        url: "https://api.github.com/repos/test/repo/issues/123",
      },
      repository: {
        name: "repo",
        full_name: "test/repo",
        html_url: "https://github.com/test/repo",
      },
    };

    const mockDetails = { state: "open", number: 123 };

    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => mockDetails,
    }));

    const result1 = await github.getNotificationDetails(notification);
    const result2 = await github.getNotificationDetails(notification);

    // Should be the same cached object
    expect(result1).toBe(result2);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
