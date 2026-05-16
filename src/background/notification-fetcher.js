/**
 * Notification fetcher.
 *
 * Owns the "pull notifications from GitHub" pipeline, including:
 *   - the race-condition guard (notificationFetchVersion)
 *   - the hasMore pagination flag
 *   - in-memory caches: author cache (LRU) and comment URL cache (Map)
 *   - session-storage persistence of the comment URL cache (MV3 worker recycle)
 *   - prefetching latest comment URLs so popup clicks are instant
 *
 * The host (service-worker) injects:
 *   - github + storage modules
 *   - onBadgeUpdate(count, hasMore): badge writes stay in the worker so the
 *     fetcher doesn't need to import the chrome.action API or BADGE_COLORS
 *
 * Mark-as-read / click flows in the host invalidate in-progress fetches
 * via bumpVersion(). The host also calls evictCommentEntry / clearCommentCache
 * when a notification leaves storage so the prefetched URL doesn't outlive it.
 */

import { storage as browserStorage } from "../lib/chrome-api.js";
import {
  CONCURRENCY,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_ICONS,
  MIN_POLL_INTERVAL_SECONDS,
  MAX_POLL_INTERVAL_SECONDS,
} from "../lib/constants.js";
import { LRUCache, DEFAULT_LRU_CACHE_SIZE } from "../lib/lru-cache.js";
import { applyRulesWithStats, isVisible } from "../lib/filter-rules.js";
import { showDesktopNotificationsForNew } from "./desktop-notifications.js";

const SESSION_KEY_COMMENT_CACHE = "latestCommentUrlCache";

const CACHED_DETAIL_FIELDS = [
  "state",
  "state_reason",
  "merged",
  "conclusion",
  "status",
  "detailsFailed",
  "author",
  "comment_count",
  "number",
  "created_at",
  "body",
  "html_url",
];

/**
 * Pure helper: pick the icon name for a GitHub notification subject type.
 * Exported for tests; the host re-exports this via the fetcher API.
 */
export function getIconForType(type) {
  return NOTIFICATION_TYPE_ICONS[type] || "notification";
}

/**
 * Pure helper: merge fields from a GitHub API details response into the
 * notification base data. Pulls out conclusion/status for CheckSuite,
 * state/state_reason/merged for issues/PRs, normalizes author shape, and
 * copies optional fields only when present (so a missing field doesn't
 * stomp cached data with undefined).
 *
 * Pure: no external state, no caches. The fetcher's runFetch wraps this
 * with author-cache population.
 *
 * @param {Object} baseData - notification base data, mutated
 * @param {Object} details - response from getNotificationDetails
 * @param {string} notifType - subject.type
 */
export function updateNotificationDetails(baseData, details, notifType) {
  if (notifType === NOTIFICATION_TYPES.CHECK_SUITE) {
    baseData.conclusion = details.conclusion;
    baseData.status = details.status;
  } else {
    baseData.state = details.state;
    if (notifType === NOTIFICATION_TYPES.ISSUE && details.state_reason) {
      baseData.state_reason = details.state_reason;
    }
    if (notifType === NOTIFICATION_TYPES.PULL_REQUEST && details.merged) {
      baseData.merged = true;
    }
  }

  // GitHub issues/PRs use 'user'; commits use 'author' — normalise both to a common shape
  const authorData = details.user || details.author;
  if (authorData) {
    baseData.author = {
      login: authorData.login,
      avatar_url: authorData.avatar_url,
      html_url: authorData.html_url,
    };
  }

  if (details.comments !== undefined) {
    const reviewComments =
      notifType === NOTIFICATION_TYPES.PULL_REQUEST ? (details.review_comments ?? 0) : 0;
    baseData.comment_count = details.comments + reviewComments;
  }
  if (details.number !== undefined) baseData.number = details.number;
  if (details.created_at) baseData.created_at = details.created_at;
  if (details.body !== undefined) baseData.body = details.body;
  if (details.html_url) baseData.html_url = details.html_url;
}

/**
 * Pure helper: copy previously-cached detail fields onto fresh base data.
 * Pure: no caches. The fetcher's runFetch wraps this with author-cache
 * population.
 */
export function copyCachedDetails(baseData, existing) {
  for (const key of CACHED_DETAIL_FIELDS) {
    if (existing[key] !== undefined) {
      baseData[key] = existing[key];
    }
  }
}

/**
 * Build a notification fetcher.
 *
 * @param {Object} deps
 * @param {Object} deps.github - github API client (already authenticated by host)
 * @param {Object} deps.storage - storage module
 * @param {(count: number|null, hasMore?: boolean) => Promise<void>} deps.onBadgeUpdate
 *   Host-owned badge writer. Called by runFetch on each commit and on
 *   superseded-fetch checks. Not called on errors — error-state badge
 *   handling stays in the host so it can map error type to color/title.
 * @returns {Object} fetcher API
 */
export function createNotificationFetcher(deps) {
  const { github, storage, onBadgeUpdate } = deps;

  // ─── State ─────────────────────────────────────────────────────────────
  const authorCache = new LRUCache(DEFAULT_LRU_CACHE_SIZE);
  const latestCommentUrlCache = new Map();
  let notificationFetchVersion = 0;
  let hasMoreNotifications = false;

  // ─── Comment URL cache: persistence and invalidation ──────────────────
  async function persistCommentCache() {
    if (!browserStorage.session) return;
    const serialized = Object.fromEntries(latestCommentUrlCache);
    await browserStorage.session.set({ [SESSION_KEY_COMMENT_CACHE]: serialized }).catch((err) => {
      console.warn("Failed to persist comment URL cache to session storage:", err);
    });
  }

  async function restoreCommentCache() {
    if (!browserStorage.session) return;
    try {
      const result = await browserStorage.session.get(SESSION_KEY_COMMENT_CACHE);
      const cached = result[SESSION_KEY_COMMENT_CACHE];
      if (cached && typeof cached === "object") {
        for (const [id, value] of Object.entries(cached)) {
          latestCommentUrlCache.set(id, value);
        }
        console.log(
          `Restored ${latestCommentUrlCache.size} comment URL cache entries from session storage`,
        );
      }
    } catch (err) {
      console.warn("Failed to restore comment URL cache from session storage:", err);
    }
  }

  async function evictCommentEntry(id) {
    latestCommentUrlCache.delete(id);
    await persistCommentCache();
  }

  async function evictCommentEntries(ids) {
    for (const id of ids) latestCommentUrlCache.delete(id);
    await persistCommentCache();
  }

  async function clearCommentCache() {
    latestCommentUrlCache.clear();
    await persistCommentCache();
  }

  function getCommentUrl(notificationId, expectedUpdatedAt) {
    const cached = latestCommentUrlCache.get(notificationId);
    if (!cached) return null;
    if (expectedUpdatedAt !== undefined && cached.updated_at !== expectedUpdatedAt) {
      return null;
    }
    return cached.url;
  }

  // ─── Author cache rehydration ─────────────────────────────────────────
  async function initializeAuthorCache() {
    try {
      const notifs = await storage.getNotifications();
      for (const notif of notifs) {
        if (notif.author && notif.author.login) {
          authorCache.set(notif.author.login, notif.author);
        }
      }
    } catch (error) {
      console.error("Failed to initialize author cache:", error);
    }
  }

  // ─── Detail fetch helpers ─────────────────────────────────────────────
  async function fetchWithConcurrencyLimit(tasks, limit = 5) {
    const results = [];
    for (let i = 0; i < tasks.length; i += limit) {
      const batch = tasks.slice(i, i + limit);
      const batchResults = await Promise.all(batch.map((task) => task()));
      results.push(...batchResults);
    }
    return results;
  }

  function createDetailFetchTask(notification, index, detailedNotifications, forceRefresh = false) {
    return async () => {
      try {
        const details = await github.getNotificationDetails(notification, forceRefresh);
        updateNotificationDetails(detailedNotifications[index], details, notification.subject.type);
        // Side effect kept inside the fetcher: any author seen during a
        // detail fetch should populate the in-memory LRU.
        const authorData = details.user || details.author;
        if (authorData?.login) {
          authorCache.set(authorData.login, detailedNotifications[index].author);
        }
        return { success: true, id: notification.id, index };
      } catch (error) {
        console.error(`Failed to fetch details for notification ${notification.id}:`, error);
        if (notification.subject.type !== NOTIFICATION_TYPES.CHECK_SUITE) {
          detailedNotifications[index].state = "open";
        }
        detailedNotifications[index].detailsFailed = true;
        return { success: false, id: notification.id, index, error: error.message };
      }
    };
  }

  function filterToCurrentlyStored(detailedNotifications, currentStoredNotifications) {
    const currentStoredIds = new Set(currentStoredNotifications.map((n) => n.id));
    return detailedNotifications.filter((n) => currentStoredIds.has(n.id));
  }

  async function mergeAndSaveIfCurrent(
    fetchVersion,
    notifications,
    label,
    notificationFilter = null,
  ) {
    if (fetchVersion < notificationFetchVersion) {
      console.log(`Fetch #${fetchVersion} superseded before ${label}, skipping`);
      return false;
    }
    const currentStored = await storage.getNotifications();
    if (fetchVersion < notificationFetchVersion) {
      console.log(`Fetch #${fetchVersion} superseded during ${label} storage read, skipping`);
      return false;
    }
    let safe = filterToCurrentlyStored(notifications, currentStored);
    if (notificationFilter) {
      const { notifications: annotated } = applyRulesWithStats(safe, notificationFilter);
      safe = annotated;
    }
    await storage.setNotifications(safe);
    return safe.filter(isVisible).length;
  }

  // ─── Comment URL prefetch ─────────────────────────────────────────────
  async function prefetchLatestCommentUrls(notifs) {
    // Prune stale cache entries: ones whose updated_at no longer matches
    // any current notification (the notification was updated or removed).
    for (const [id, cached] of latestCommentUrlCache) {
      const notif = notifs.find((n) => n.id === id);
      if (!notif || notif.updated_at !== cached.updated_at) {
        latestCommentUrlCache.delete(id);
      }
    }

    for (const notif of notifs) {
      if (
        (notif.type !== NOTIFICATION_TYPES.ISSUE &&
          notif.type !== NOTIFICATION_TYPES.PULL_REQUEST) ||
        !notif.comment_count
      ) {
        continue;
      }
      const cached = latestCommentUrlCache.get(notif.id);
      if (cached && cached.updated_at === notif.updated_at) continue;

      try {
        const url = await github.getLatestCommentUrl(notif);
        if (url) {
          latestCommentUrlCache.set(notif.id, { url, updated_at: notif.updated_at });
        }
      } catch (error) {
        console.error(`Failed to prefetch comment URL for notification ${notif.id}:`, error);
      }
    }

    await persistCommentCache();
  }

  // ─── Run fetch (the big one) ──────────────────────────────────────────
  async function runFetch() {
    if (!github.isAuthenticated) return;

    const currentFetchVersion = ++notificationFetchVersion;
    console.log(`Starting notification fetch #${currentFetchVersion}`);

    const notificationFilter = await storage.getNotificationFilter();
    const previousPollInterval = github.pollInterval;

    let pollIntervalChanged = false;
    let newPollIntervalMinutes = 0;

    const result = await github.getNotifications();

    // Detect server-driven poll interval changes (even on 304). The host
    // alarm stays managed by service-worker, so we just report what changed.
    if (github.pollInterval !== previousPollInterval) {
      const pollIntervalSeconds = Math.min(
        Math.max(github.pollInterval || 0, MIN_POLL_INTERVAL_SECONDS),
        MAX_POLL_INTERVAL_SECONDS,
      );
      newPollIntervalMinutes = Math.ceil(pollIntervalSeconds / 60);
      pollIntervalChanged = true;
      console.log(
        `Poll interval changed: ${previousPollInterval}s → ${pollIntervalSeconds}s (${newPollIntervalMinutes} min)`,
      );
    }

    if (result === null) {
      console.log(`Fetch #${currentFetchVersion}: 304 Not Modified - no changes`);
      return { pollIntervalChanged, newPollIntervalMinutes };
    }

    if (!result) {
      return { pollIntervalChanged, newPollIntervalMinutes };
    }

    const { items: notifications, hasMore } = result;

    if (currentFetchVersion < notificationFetchVersion) {
      console.log(
        `Fetch #${currentFetchVersion} superseded by #${notificationFetchVersion}, aborting`,
      );
      return { pollIntervalChanged, newPollIntervalMinutes };
    }

    const existingNotifications = await storage.getNotifications();
    const existingIds = new Set(existingNotifications.map((n) => n.id));
    const existingMap = new Map(existingNotifications.map((n) => [n.id, n]));

    const basicProcessed = notifications.map((n) => {
      const existing = existingMap.get(n.id);
      const baseData = {
        id: n.id,
        title: n.subject.title,
        type: n.subject.type,
        reason: n.reason,
        unread: n.unread,
        updated_at: n.updated_at,
        url: n.subject.url,
        repository: {
          name: n.repository.name,
          full_name: n.repository.full_name,
          html_url: n.repository.html_url,
        },
        icon: getIconForType(n.subject.type),
        isNew: !existingIds.has(n.id),
      };
      if (existing) {
        copyCachedDetails(baseData, existing);
        // Re-populate author LRU so later detail-misses hit the cache.
        if (existing.author?.login) {
          authorCache.set(existing.author.login, existing.author);
        }
      }
      return baseData;
    });

    if (currentFetchVersion < notificationFetchVersion) {
      console.log(`Fetch #${currentFetchVersion} superseded before saving basic data, aborting`);
      return { pollIntervalChanged, newPollIntervalMinutes };
    }

    // Re-read storage to catch user actions (markAsRead etc.) that completed
    // during the fetch. Keep new notifications unconditionally; only keep
    // pre-existing ones if they're still in storage.
    const currentStored = await storage.getNotifications();
    if (currentFetchVersion < notificationFetchVersion) {
      console.log(`Fetch #${currentFetchVersion} superseded during safeBasic re-read, aborting`);
      return { pollIntervalChanged, newPollIntervalMinutes };
    }
    const currentStoredIds = new Set(currentStored.map((n) => n.id));
    const preFilter = basicProcessed.filter(
      (n) => !existingIds.has(n.id) || currentStoredIds.has(n.id),
    );
    const { notifications: safeBasic, stats: filterStats } = applyRulesWithStats(
      preFilter,
      notificationFilter,
    );

    hasMoreNotifications = hasMore;
    await storage.setNotifications(safeBasic);
    await storage.setNotificationFilterStats(filterStats);
    const visibleCount = safeBasic.filter(isVisible).length;
    await onBadgeUpdate(visibleCount, hasMore);

    // Detail-fetch phase
    const detailedNotifications = basicProcessed.map((n) => ({ ...n }));
    const notificationsNeedingDetails = [];
    for (let index = 0; index < notifications.length; index++) {
      const n = notifications[index];
      const existing = existingMap.get(n.id);
      const needsUpdate = !existing || existing.updated_at !== n.updated_at;
      if (needsUpdate) {
        notificationsNeedingDetails.push({ notification: n, index });
      }
    }

    const priorityNotifications = notificationsNeedingDetails.slice(0, CONCURRENCY.VISIBLE_COUNT);
    const backgroundNotifications = notificationsNeedingDetails.slice(CONCURRENCY.VISIBLE_COUNT);
    console.log(
      `Loading details: ${priorityNotifications.length} priority, ${backgroundNotifications.length} background`,
    );

    let priorityResults = [];
    let prioritySaved = false;
    if (priorityNotifications.length > 0) {
      priorityResults = await fetchWithConcurrencyLimit(
        priorityNotifications.map(({ notification: n, index }) =>
          createDetailFetchTask(n, index, detailedNotifications, true),
        ),
        CONCURRENCY.PRIORITY,
      );

      const prioritySuccess = priorityResults.filter((r) => r.success === true).length;
      const priorityFailed = priorityResults.filter((r) => r.success === false).length;
      console.log(
        `Fetch #${currentFetchVersion} priority: ${prioritySuccess} loaded, ${priorityFailed} failed`,
      );

      const priorityCount = await mergeAndSaveIfCurrent(
        currentFetchVersion,
        detailedNotifications,
        "priority save",
        notificationFilter,
      );
      prioritySaved = priorityCount !== false;
      if (prioritySaved) {
        await onBadgeUpdate(priorityCount, hasMoreNotifications);
        console.log(
          `Fetch #${currentFetchVersion} saved ${priorityNotifications.length} priority notifications`,
        );
      }
    }

    if (backgroundNotifications.length > 0) {
      fetchWithConcurrencyLimit(
        backgroundNotifications.map(({ notification: n, index }) =>
          createDetailFetchTask(n, index, detailedNotifications, true),
        ),
        CONCURRENCY.BACKGROUND,
      )
        .then(async (backgroundResults) => {
          if (currentFetchVersion < notificationFetchVersion) {
            console.log(
              `Fetch #${currentFetchVersion} superseded by #${notificationFetchVersion}, discarding background updates`,
            );
            return;
          }

          const allResults = [...priorityResults, ...backgroundResults];
          const failedCount = allResults.filter((r) => r && r.success === false).length;
          const successCount = allResults.filter((r) => r && r.success === true).length;
          console.log(
            `Notification details (fetch #${currentFetchVersion}): ${successCount} fetched, ${failedCount} failed`,
          );

          const cacheStats = authorCache.getStats();
          console.log(
            `Author cache: ${cacheStats.size}/${cacheStats.maxSize} (${cacheStats.utilization})`,
          );

          const savedCount = await mergeAndSaveIfCurrent(
            currentFetchVersion,
            detailedNotifications,
            "background save",
            notificationFilter,
          );
          if (savedCount !== false) {
            await onBadgeUpdate(savedCount, hasMoreNotifications);
            console.log(
              `Fetch #${currentFetchVersion} updated storage with detailed notifications`,
            );
            prefetchLatestCommentUrls(detailedNotifications).catch((error) => {
              console.error("Error prefetching latest comment URLs:", error);
            });
          }
        })
        .catch((error) => {
          console.error(
            `Error fetching background notification details (fetch #${currentFetchVersion}):`,
            error,
          );
        });
    }

    // No background work — prefetch immediately after priority save committed.
    if (backgroundNotifications.length === 0 && prioritySaved) {
      prefetchLatestCommentUrls(detailedNotifications).catch((error) => {
        console.error("Error prefetching latest comment URLs:", error);
      });
    }

    // Desktop notifications for new items use the safe-filtered list.
    await showDesktopNotificationsForNew(safeBasic.filter(isVisible));

    return {
      pollIntervalChanged,
      newPollIntervalMinutes,
    };
  }

  return {
    runFetch,
    bumpVersion: () => {
      notificationFetchVersion++;
    },
    getHasMore: () => hasMoreNotifications,
    resetHasMore: () => {
      hasMoreNotifications = false;
    },
    getCommentUrl,
    evictCommentEntry,
    evictCommentEntries,
    clearCommentCache,
    persistCommentCache,
    initializeAuthorCache,
    restoreCommentCache,
    // Exposed for tests that drive prefetch directly.
    prefetchLatestCommentUrls,
    // Exposed for tests that want to assert cache contents directly.
    _commentCache: latestCommentUrlCache,
  };
}
