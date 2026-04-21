/**
 * Background Service Worker for GitHub Notifier
 */

import github from "../lib/github-api.js";
import * as storage from "../lib/storage.js";
import {
  action,
  alarms,
  runtime,
  tabs,
  notifications,
  storage as browserStorage,
} from "../lib/chrome-api.js";
import {
  ALARM_NAME,
  MIN_POLL_INTERVAL_SECONDS,
  MAX_POLL_INTERVAL_SECONDS,
  MESSAGE_TYPES,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_ICONS,
  CONCURRENCY,
} from "../lib/constants.js";
import { formatReason, classifyError } from "../lib/format-utils.js";
import { buildNotificationUrl } from "../lib/url-builder.js";
import { LRUCache, DEFAULT_LRU_CACHE_SIZE } from "../lib/lru-cache.js";

/**
 * Desktop notification constants
 * @exported for testing
 */
export const NOTIFICATION_ID_PREFIX = "github-notif-";
export const AGGREGATED_NOTIFICATION_ID = "github-notif-more";
export const NOTIFICATION_DELAY_MS = 1000;
export const GITHUB_NOTIFICATIONS_URL = "https://github.com/notifications";
const NOTIFICATION_ICON_PATH = "images/icon.png";
const CHROME_PRIORITY_NORMAL = 2; // Individual notifications
const CHROME_PRIORITY_LOW = 1; // Aggregated notifications

/**
 * Badge background colors for different states
 */
const BADGE_COLORS = {
  UNAUTHENTICATED: "#6B7280", // Gray - not logged in
  NORMAL: "#2563EB", // Blue - has notifications
  RATE_LIMITED: "#f59e0b", // Orange - rate limit error
  TIMEOUT: "#ef4444", // Red - timeout error
};

/**
 * Detect Chrome/Chromium browser
 * Firefox doesn't support priority and requireInteraction notification options
 */
const isChrome = typeof chrome !== "undefined" && typeof browser === "undefined";

/**
 * Apply Chrome-specific notification options
 * @param {object} options - Notification options object
 * @param {number} priority - Chrome notification priority (1-2)
 */
function applyChromeNotificationOptions(options, priority) {
  if (isChrome) {
    options.priority = priority;
    options.requireInteraction = false; // Allow auto-dismiss
  }
}

/**
 * In-memory LRU cache for author information
 * Stores up to 100 author objects to prevent unbounded memory growth
 * Key: author login, Value: { login, avatar_url, html_url }
 */
const authorCache = new LRUCache(DEFAULT_LRU_CACHE_SIZE);

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

// Tracks whether the last successful notifications fetch had additional pages.
let hasMoreNotifications = false;

/**
 * In-memory cache for prefetched latest comment URLs.
 * Key: notification ID, Value: { url: string, updated_at: string }
 * Entries are invalidated when a notification's updated_at changes on the next fetch.
 * @exported for testing
 */
export const latestCommentUrlCache = new Map();

/**
 * Session storage key for persisting latestCommentUrlCache across MV3 worker restarts.
 * chrome.storage.session survives service worker recycling but is cleared on browser close.
 * Not available in Firefox (where service workers are not recycled anyway).
 */
const SESSION_KEY_COMMENT_CACHE = "latestCommentUrlCache";

/**
 * Persist the current latestCommentUrlCache to session storage (best-effort).
 * Silently ignores environments where session storage is unavailable (Firefox).
 * @exported for testing
 */
export async function persistCommentCache() {
  if (!browserStorage.session) return;
  const serialized = Object.fromEntries(latestCommentUrlCache);
  await browserStorage.session.set({ [SESSION_KEY_COMMENT_CACHE]: serialized }).catch((err) => {
    console.warn("Failed to persist comment URL cache to session storage:", err);
  });
}

/**
 * Restore latestCommentUrlCache from session storage on worker startup.
 * A no-op when session storage is unavailable or empty.
 * @exported for testing
 */
export async function restoreCommentCache() {
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

/**
 * Guard against concurrent initialize() calls.
 * The module top-level call, onStartup, and onInstalled can all fire
 * close together when the service worker first loads.
 */
let initializePromise = null;

/**
 * Initialize extension state from storage
 */
async function initialize() {
  if (initializePromise) {
    console.log("initialize() already running, skipping duplicate call");
    return initializePromise;
  }

  initializePromise = doInitialize();
  try {
    return await initializePromise;
  } finally {
    initializePromise = null;
  }
}

async function doInitialize() {
  console.log("initialize() starting");
  const token = await storage.getToken();
  if (token) {
    github.token = token;
    const username = await storage.getUsername();
    if (username) {
      github.username = username;
    }

    // Populate author cache from existing notifications
    await initializeAuthorCache();

    // Restore comment URL cache from session storage (survives MV3 worker recycling).
    // This is a no-op on Firefox or when session storage has no saved data.
    await restoreCommentCache();

    await startPolling();
    await checkNotifications();
  } else {
    hasMoreNotifications = false;
    await updateBadge(null);
  }
}

/**
 * Initialize author cache from stored notifications
 * This provides instant avatar display for known authors
 */
async function initializeAuthorCache() {
  try {
    const notifications = await storage.getNotifications();
    for (const notif of notifications) {
      if (notif.author && notif.author.login) {
        authorCache.set(notif.author.login, notif.author);
      }
    }
  } catch (error) {
    console.error("Failed to initialize author cache:", error);
  }
}

/**
 * Update badge with notification count
 * @param {number|null} count - Number of notifications (null if not authenticated)
 * @param {boolean} hasMore - Whether there are more notifications beyond this count
 */
async function updateBadge(count, hasMore = false) {
  if (count === null) {
    // Not authenticated
    await action.setBadgeText({ text: "?" });
    await action.setBadgeBackgroundColor({ color: BADGE_COLORS.UNAUTHENTICATED });
  } else if (count === 0) {
    await action.setBadgeText({ text: "" });
  } else {
    const badgeText = hasMore ? `${count}+` : count.toString();
    await action.setBadgeText({ text: badgeText });
    await action.setBadgeBackgroundColor({ color: BADGE_COLORS.NORMAL });
  }
}

/**
 * Helper: Update notification details from API response
 * @exported for testing
 */
export function updateNotificationDetails(baseData, details, notifType) {
  // Check suites expose conclusion/status; issues and PRs expose state (with state_reason/merged)
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
    const author = {
      login: authorData.login,
      avatar_url: authorData.avatar_url,
      html_url: authorData.html_url,
    };
    baseData.author = author;

    // Cache author data for future use
    authorCache.set(authorData.login, author);
  }

  // Only copy fields when present — avoids overwriting cached data with undefined if the API response omits them
  // For PRs, sum issue-style comments and review comments so the button appears for code reviews too
  if (details.comments !== undefined) {
    const reviewComments =
      notifType === NOTIFICATION_TYPES.PULL_REQUEST ? (details.review_comments ?? 0) : 0;
    baseData.comment_count = details.comments + reviewComments;
  }
  if (details.number !== undefined) baseData.number = details.number;
  if (details.created_at) baseData.created_at = details.created_at;
  if (details.body !== undefined) baseData.body = details.body;
  if (details.html_url) baseData.html_url = details.html_url; // Cache the HTML URL for quick access
}

/**
 * Helper: Copy cached details to new notification data
 * @exported for testing
 */
export function copyCachedDetails(baseData, existing) {
  CACHED_DETAIL_FIELDS.forEach((key) => {
    if (existing[key] !== undefined) {
      baseData[key] = existing[key];
    }
  });

  // Also populate author cache if we have author data
  if (existing.author && existing.author.login) {
    authorCache.set(existing.author.login, existing.author);
  }
}

/**
 * Track the version of the current notification fetch to prevent race conditions
 * Incremented each time checkNotifications is called
 */
let notificationFetchVersion = 0;

/**
 * Fetch tasks with concurrency limit to prevent API request storms
 * @param {Array<Function>} tasks - Array of async functions to execute
 * @param {number} limit - Maximum concurrent tasks
 * @returns {Promise<Array>} Results from all tasks
 */
async function fetchWithConcurrencyLimit(tasks, limit = 5) {
  const results = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const batch = tasks.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map((task) => task()));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Create a task to fetch notification details
 * @param {Object} notification - Notification object
 * @param {number} index - Index in notifications array
 * @param {Array} detailedNotifications - Array to update with details
 * @returns {Function} Async function to fetch details
 */
function createDetailFetchTask(notification, index, detailedNotifications, forceRefresh = false) {
  return async () => {
    try {
      const details = await github.getNotificationDetails(notification, forceRefresh);
      updateNotificationDetails(detailedNotifications[index], details, notification.subject.type);
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

/**
 * Check whether a single notification matches one notification filter rule.
 * @param {Object} notif - Notification object
 * @param {{ repos: string[], keywords: string[] }} rule - One filter rule
 * @returns {boolean}
 */
function matchesRule(notif, rule) {
  const { repos, keywords } = rule;

  // Rule is effectively empty — skip it
  if (repos.length === 0 && keywords.length === 0) return false;

  // Repo scope check: empty = all repos; non-empty = only listed repos (case-insensitive)
  const repoName = notif.repository?.full_name?.toLowerCase();
  if (repos.length > 0 && (!repoName || !repos.some((r) => r.toLowerCase() === repoName)))
    return false;

  // Keyword check: hide notifications whose title contains any keyword
  const title = notif.title;
  if (!title) return false;
  const titleLower = title.toLowerCase();
  return keywords.some((kw) => titleLower.includes(kw.toLowerCase()));
}

/**
 * Check whether a notification matches any rule in the notification filter list.
 * Returns true if the notification should be hidden.
 * @param {Object} notif - Notification object
 * @param {Array<{ repos: string[], keywords: string[] }>} rules - Filter rules array
 * @returns {boolean}
 * @exported for testing
 */
export function matchesNotificationFilter(notif, rules) {
  return rules.some((rule) => matchesRule(notif, rule));
}

/**
 * Remove notifications that match any notification filter rule.
 * @param {Array} notifications
 * @param {Array<{ repos: string[], keywords: string[] }>} rules
 * @returns {Array}
 */
function applyNotificationFilter(notifications, rules) {
  return notifications.filter((n) => !matchesNotificationFilter(n, rules));
}

/**
 * Remove notifications that match any filter rule and collect per-rule per-repo
 * and per-keyword counts.
 * @param {Array} notifications
 * @param {Array<{ repos: string[], keywords: string[] }>} rules
 * @returns {{ notifications: Array, stats: Array<Object> }}
 *   stats[i].repos maps lowercase(repoFullName) → number of notifications filtered by rules[i]
 *   stats[i].keywords maps keyword → number of notifications that matched it in rules[i]
 * @exported for testing
 */
export function applyNotificationFilterWithStats(notifications, rules) {
  const stats = rules.map(() => ({ repos: {}, keywords: {} }));
  const kept = notifications.filter((n) => {
    for (let i = 0; i < rules.length; i++) {
      if (matchesRule(n, rules[i])) {
        const repo = n.repository?.full_name;
        if (repo) {
          // Normalize to lowercase to match the case-insensitive repo matching in matchesRule
          const repoKey = repo.toLowerCase();
          stats[i].repos[repoKey] = (stats[i].repos[repoKey] || 0) + 1;
        }
        // Count each keyword that contributed to filtering this notification.
        // n.title is guaranteed non-null here: matchesRule() returns false when title is falsy.
        const titleLower = n.title.toLowerCase();
        for (const kw of rules[i].keywords) {
          if (titleLower.includes(kw.toLowerCase())) {
            stats[i].keywords[kw] = (stats[i].keywords[kw] || 0) + 1;
          }
        }
        return false;
      }
    }
    return true;
  });
  return { notifications: kept, stats };
}

/**
 * Filter notifications to only those that still exist in storage
 * Prevents overwriting user deletions during concurrent operations
 * @param {Array} detailedNotifications - Notifications to filter
 * @param {Array} currentStoredNotifications - Currently stored notifications
 * @returns {Array} Filtered notifications
 */
function filterToCurrentlyStored(detailedNotifications, currentStoredNotifications) {
  const currentStoredIds = new Set(currentStoredNotifications.map((n) => n.id));
  return detailedNotifications.filter((n) => currentStoredIds.has(n.id));
}

/**
 * Merge notifications with current storage and save, guarded by fetch version.
 * Aborts if a newer fetch has started (before or during the async storage read).
 * Callers are responsible for updating the badge after a successful save.
 * @param {number} fetchVersion - Version of the fetch that produced these notifications
 * @param {Array} notifications - Notifications to save
 * @param {string} label - Log label for debugging
 * @param {Array|null} [notificationFilter=null] - Optional filter rules to apply before saving
 * @returns {Promise<number|false>} Number of saved notifications, or false if superseded
 */
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
  // Re-check after async read: user mark-as-read may have bumped the version
  if (fetchVersion < notificationFetchVersion) {
    console.log(`Fetch #${fetchVersion} superseded during ${label} storage read, skipping`);
    return false;
  }
  let safe = filterToCurrentlyStored(notifications, currentStored);
  if (notificationFilter) {
    safe = applyNotificationFilter(safe, notificationFilter);
  }
  await storage.setNotifications(safe);
  return safe.length;
}

/**
 * Check for new notifications
 *
 * Race condition prevention:
 * - Each fetch gets a unique version number
 * - Only the most recent fetch can overwrite storage
 * - Older detail fetches are discarded if a newer fetch has completed
 */
/**
 * Prefetch the latest comment URL for each notification that has comments.
 * Results are stored in latestCommentUrlCache keyed by notification ID.
 * Stale entries (where updated_at no longer matches) are pruned first.
 *
 * @param {Array} notifications - Processed notification objects
 * @exported for testing
 */
export async function prefetchLatestCommentUrls(notifications) {
  // Prune cache entries whose updated_at no longer matches the current notification
  for (const [id, cached] of latestCommentUrlCache) {
    const notif = notifications.find((n) => n.id === id);
    if (!notif || notif.updated_at !== cached.updated_at) {
      latestCommentUrlCache.delete(id);
    }
  }

  for (const notif of notifications) {
    // Only prefetch Issue and PullRequest notifications with comments
    if (
      (notif.type !== NOTIFICATION_TYPES.ISSUE && notif.type !== NOTIFICATION_TYPES.PULL_REQUEST) ||
      !notif.comment_count
    ) {
      continue;
    }

    // Skip if already cached for this updated_at
    const cached = latestCommentUrlCache.get(notif.id);
    if (cached && cached.updated_at === notif.updated_at) {
      continue;
    }

    try {
      const url = await github.getLatestCommentUrl(notif);
      if (url) {
        latestCommentUrlCache.set(notif.id, { url, updated_at: notif.updated_at });
      }
    } catch (error) {
      console.error(`Failed to prefetch comment URL for notification ${notif.id}:`, error);
    }
  }

  // Persist updated cache to session storage so it survives MV3 worker recycling
  await persistCommentCache();
}

async function checkNotifications() {
  if (!github.isAuthenticated) {
    return;
  }

  // Increment version for this fetch to prevent race conditions
  const currentFetchVersion = ++notificationFetchVersion;
  console.log(`Starting notification fetch #${currentFetchVersion}`);

  // Load notification filter config once per fetch cycle
  const notificationFilter = await storage.getNotificationFilter();

  // Track previous poll interval to detect changes
  const previousPollInterval = github.pollInterval;

  try {
    const result = await github.getNotifications();

    // Check if poll interval changed (even on 304) and update alarm accordingly
    // GitHub may send new X-Poll-Interval in 304 responses
    if (github.pollInterval !== previousPollInterval) {
      const { seconds: pollIntervalSeconds, minutes: newPollIntervalMinutes } =
        getClampedPollInterval();
      console.log(
        `Poll interval changed: ${previousPollInterval}s → ${pollIntervalSeconds}s (${newPollIntervalMinutes} min)`,
      );

      // Update the alarm with new interval
      await alarms.clear(ALARM_NAME);
      await alarms.create(ALARM_NAME, {
        delayInMinutes: newPollIntervalMinutes,
        periodInMinutes: newPollIntervalMinutes,
      });
    }

    // null means 304 Not Modified - no new notifications
    if (result === null) {
      console.log(`Fetch #${currentFetchVersion}: 304 Not Modified - no changes`);
      return;
    }

    if (result) {
      const { items: notifications, hasMore } = result;

      // Check if a newer fetch has already started
      if (currentFetchVersion < notificationFetchVersion) {
        console.log(
          `Fetch #${currentFetchVersion} superseded by #${notificationFetchVersion}, aborting`,
        );
        return;
      }

      // Get existing notifications to check for new ones
      const existingNotifications = await storage.getNotifications();
      const existingIds = new Set(existingNotifications.map((n) => n.id));
      const existingMap = new Map(existingNotifications.map((n) => [n.id, n]));

      // First pass: Create basic notification data immediately
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
          isNew: !existingIds.has(n.id), // Mark as new if not in existing set
        };

        // Pre-populate from existing cached data if available
        // This provides instant display for cached data
        if (existing) {
          copyCachedDetails(baseData, existing);
        }

        return baseData;
      });

      // Check again before saving (another fetch might have started)
      if (currentFetchVersion < notificationFetchVersion) {
        console.log(`Fetch #${currentFetchVersion} superseded before saving basic data, aborting`);
        return;
      }

      // Re-read current storage to catch any user actions (markAsRead etc.) that
      // completed while the fetch was in-flight. Keep new notifications unconditionally,
      // but only keep pre-existing ones if they're still in storage (not user-deleted).
      const currentStored = await storage.getNotifications();
      // Re-check version after async read: a user mark-as-read may have bumped
      // notificationFetchVersion while we were reading, making our snapshot stale.
      if (currentFetchVersion < notificationFetchVersion) {
        console.log(`Fetch #${currentFetchVersion} superseded during safeBasic re-read, aborting`);
        return;
      }
      const currentStoredIds = new Set(currentStored.map((n) => n.id));
      // Apply race-condition guard, then notification filter (keyword-based).
      const preFilter = basicProcessed.filter(
        (n) => !existingIds.has(n.id) || currentStoredIds.has(n.id),
      );
      const { notifications: safeBasic, stats: filterStats } = applyNotificationFilterWithStats(
        preFilter,
        notificationFilter,
      );

      // Save basic data immediately - popup can display now.
      // Update hasMoreNotifications here (inside all version checks) so it only
      // reflects fetches that actually commit to storage.
      hasMoreNotifications = hasMore;
      await storage.setNotifications(safeBasic);
      await storage.setNotificationFilterStats(filterStats);
      await updateBadge(safeBasic.length, hasMore);

      // Second pass: Fetch details asynchronously for new/updated notifications
      // Create a deep copy to avoid race conditions with concurrent updates
      const detailedNotifications = basicProcessed.map((n) => ({ ...n }));

      // Identify which notifications need details fetched
      const notificationsNeedingDetails = [];
      for (let index = 0; index < notifications.length; index++) {
        const n = notifications[index];
        const existing = existingMap.get(n.id);
        const needsUpdate = !existing || existing.updated_at !== n.updated_at;

        if (needsUpdate) {
          notificationsNeedingDetails.push({ notification: n, index });
        }
      }

      // Split into priority (visible) and background loading
      const priorityNotifications = notificationsNeedingDetails.slice(0, CONCURRENCY.VISIBLE_COUNT);
      const backgroundNotifications = notificationsNeedingDetails.slice(CONCURRENCY.VISIBLE_COUNT);

      console.log(
        `Loading details: ${priorityNotifications.length} priority, ${backgroundNotifications.length} background`,
      );

      // Priority loading: First visible notifications
      let priorityResults = []; // Define in outer scope for background logging
      let prioritySaved = false; // Track whether the priority save actually committed
      if (priorityNotifications.length > 0) {
        priorityResults = await fetchWithConcurrencyLimit(
          priorityNotifications.map(({ notification: n, index }) =>
            createDetailFetchTask(n, index, detailedNotifications, true),
          ),
          CONCURRENCY.PRIORITY,
        );

        // Log priority loading results
        const prioritySuccess = priorityResults.filter((r) => r.success === true).length;
        const priorityFailed = priorityResults.filter((r) => r.success === false).length;
        console.log(
          `Fetch #${currentFetchVersion} priority: ${prioritySuccess} loaded, ${priorityFailed} failed`,
        );

        // Merge with current storage and save (guarded by version check)
        const priorityCount = await mergeAndSaveIfCurrent(
          currentFetchVersion,
          detailedNotifications,
          "priority save",
          notificationFilter,
        );
        prioritySaved = priorityCount !== false;
        if (prioritySaved) {
          await updateBadge(priorityCount, hasMoreNotifications);
          console.log(
            `Fetch #${currentFetchVersion} saved ${priorityNotifications.length} priority notifications`,
          );
        }
      }

      // Background loading: Remaining notifications
      // This happens asynchronously and doesn't block the priority loading
      if (backgroundNotifications.length > 0) {
        fetchWithConcurrencyLimit(
          backgroundNotifications.map(({ notification: n, index }) =>
            createDetailFetchTask(n, index, detailedNotifications, true),
          ),
          CONCURRENCY.BACKGROUND,
        )
          .then(async (backgroundResults) => {
            // Check if a newer fetch has completed while we were fetching details
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

            // Log cache statistics for monitoring
            const cacheStats = authorCache.getStats();
            console.log(
              `Author cache: ${cacheStats.size}/${cacheStats.maxSize} (${cacheStats.utilization})`,
            );

            // Merge with current storage and save (guarded by version check)
            const savedCount = await mergeAndSaveIfCurrent(
              currentFetchVersion,
              detailedNotifications,
              "background save",
              notificationFilter,
            );
            if (savedCount !== false) {
              await updateBadge(savedCount, hasMoreNotifications);
              console.log(
                `Fetch #${currentFetchVersion} updated storage with detailed notifications`,
              );

              // Prefetch latest comment URLs so popup clicks are instant.
              // Only run when save committed — a superseded fetch must not re-populate
              // the cache with stale data or issue unnecessary API requests.
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

      // When there are no background notifications, prefetch after priority save.
      // Skipped when notificationsNeedingDetails is empty (nothing changed) to avoid
      // unnecessary API calls on repeated 304-equivalent fetches.
      // Only runs when the save actually committed — do not prefetch for superseded fetches.
      if (backgroundNotifications.length === 0 && prioritySaved) {
        prefetchLatestCommentUrls(detailedNotifications).catch((error) => {
          console.error("Error prefetching latest comment URLs:", error);
        });
      }

      // Show desktop notifications for new items (using safe-filtered list)
      await showDesktopNotificationsForNew(safeBasic);
    }
  } catch (error) {
    console.error(`Failed to check notifications (fetch #${currentFetchVersion}):`, error);

    // Handle different error types with appropriate UI feedback
    const errorType = classifyError(error);
    if (errorType === "rate-limited") {
      const rateLimitInfo = github.getRateLimitInfo();
      await action.setBadgeText({ text: "⏱" });
      await action.setBadgeBackgroundColor({ color: BADGE_COLORS.RATE_LIMITED });
      await action.setTitle({
        title: `Rate limited. Resets ${rateLimitInfo.resetIn || "soon"}`,
      });
    } else if (errorType === "timeout") {
      await action.setBadgeText({ text: "⏱" });
      await action.setBadgeBackgroundColor({ color: BADGE_COLORS.TIMEOUT });
      await action.setTitle({ title: "Request timeout - will retry" });
    } else if (errorType === "offline") {
      await action.setTitle({ title: "Offline - showing cached data" });
    } else {
      console.error("Unexpected error:", error);
      await action.setTitle({ title: `Error: ${error.message}` });
    }
  }
}

/**
 * Get icon name for notification type
 * @exported for testing
 */
export function getIconForType(type) {
  return NOTIFICATION_TYPE_ICONS[type] || "notification";
}

/**
 * Calculate clamped poll interval from GitHub API response
 * Clamps between MIN_POLL_INTERVAL_SECONDS (60s/1min) and MAX_POLL_INTERVAL_SECONDS (600s/10min)
 * @returns {{seconds: number, minutes: number}} Poll interval in seconds and minutes
 */
function getClampedPollInterval() {
  const pollIntervalSeconds = Math.min(
    Math.max(github.pollInterval || 0, MIN_POLL_INTERVAL_SECONDS),
    MAX_POLL_INTERVAL_SECONDS,
  );
  const pollIntervalMinutes = Math.ceil(pollIntervalSeconds / 60);
  return { seconds: pollIntervalSeconds, minutes: pollIntervalMinutes };
}

/**
 * Start polling for notifications
 */
async function startPolling() {
  const { minutes: pollIntervalMinutes } = getClampedPollInterval();

  await alarms.create(ALARM_NAME, {
    delayInMinutes: pollIntervalMinutes,
    periodInMinutes: pollIntervalMinutes,
  });
}

/**
 * Stop polling
 */
async function stopPolling() {
  await alarms.clear(ALARM_NAME);
}

/**
 * Handle alarm events
 */
alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await checkNotifications();
  }
});

/**
 * Handle messages from popup
 */
runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      console.error("Message handling error:", error);
      sendResponse({ error: error.message });
    });
  return true; // Keep channel open for async response
});

async function handleMessage(message) {
  switch (message.action) {
    case MESSAGE_TYPES.LOGIN:
      return await handleLogin(message.authMethod, message.token);

    case MESSAGE_TYPES.LOGOUT:
      return await handleLogout();

    case MESSAGE_TYPES.GET_STATE:
      return await getState();

    case MESSAGE_TYPES.GET_RATE_LIMIT:
      return { rateLimit: github.getRateLimitInfo() };

    case MESSAGE_TYPES.OPEN_NOTIFICATION:
      return await openNotification(message.notificationId);

    case MESSAGE_TYPES.OPEN_LATEST_COMMENT:
      return await openLatestComment(message.notificationId);
    case MESSAGE_TYPES.MARK_AS_READ:
      return await markAsRead(message.notificationId);

    case MESSAGE_TYPES.MARK_ALL_AS_READ:
      return await markAllAsRead();

    case MESSAGE_TYPES.MARK_REPO_AS_READ:
      return await markRepoAsRead(message.owner, message.repo);

    case MESSAGE_TYPES.REFRESH:
      github.lastModified = null; // Force non-conditional request
      await checkNotifications();
      // Reset the alarm timer without recreating it
      // This ensures the countdown shows the full period
      if (github.isAuthenticated) {
        const { minutes: pollIntervalMinutes } = getClampedPollInterval();

        // Clear and recreate to reset the timer
        await alarms.clear(ALARM_NAME);
        await alarms.create(ALARM_NAME, {
          delayInMinutes: pollIntervalMinutes,
          periodInMinutes: pollIntervalMinutes,
        });
      }
      return { success: true };

    case MESSAGE_TYPES.GET_NOTIFICATION_FILTER:
      return { filter: await storage.getNotificationFilter() };

    case MESSAGE_TYPES.SET_NOTIFICATION_FILTER: {
      const filter = message.filter;
      if (!Array.isArray(filter)) {
        throw new Error("filter must be an array");
      }
      for (const rule of filter) {
        if (!Array.isArray(rule?.repos) || !Array.isArray(rule?.keywords)) {
          throw new Error("Each rule must have repos and keywords arrays");
        }
        if (
          rule.repos.some((r) => typeof r !== "string") ||
          rule.keywords.some((kw) => typeof kw !== "string")
        ) {
          throw new Error("Rule repos and keywords must be arrays of strings");
        }
        // Normalize: trim whitespace and drop empty strings
        rule.repos = rule.repos.map((r) => r.trim()).filter(Boolean);
        rule.keywords = rule.keywords.map((kw) => kw.trim()).filter(Boolean);
        if (rule.keywords.length === 0) {
          throw new Error("Each rule must have at least one keyword");
        }
      }
      await storage.setNotificationFilter(filter);
      // Clear stale stats — they are indexed parallel to the old rules array and
      // would be semantically wrong after any rule change. Fresh stats will be
      // written on the next full checkNotifications() pass.
      await storage.setNotificationFilterStats([]);
      // When filter is empty (all rules removed), skip: nothing to hide, and the
      // re-fetch below will restore previously-hidden notifications.
      if (filter.length > 0) {
        const current = await storage.getNotifications();
        const filtered = applyNotificationFilter(current, filter);
        if (filtered.length !== current.length) {
          await storage.setNotifications(filtered);
          await updateBadge(filtered.length, hasMoreNotifications);
        }
      }
      // Re-fetch to restore notifications that may have been hidden by old rules
      github.lastModified = null;
      checkNotifications().catch((err) => {
        console.error("Background re-fetch after filter change failed:", err);
      });
      return { success: true };
    }

    default:
      throw new Error(`Unknown action: ${message.action}`);
  }
}

async function handleLogin(authMethod = "oauth", token = null) {
  try {
    if (!token) {
      throw new Error("Token is required");
    }

    github.token = token;
    await github.fetchUsername();

    // Save credentials
    await storage.setToken(github.token);
    await storage.setUsername(github.username);
    await storage.setUserInfo(github.userInfo); // Save full user info including avatar
    await storage.setAuthMethod(authMethod);

    // Start polling
    await startPolling();
    await checkNotifications();

    return {
      success: true,
      username: github.username,
    };
  } catch (error) {
    // Clear the in-memory token so isAuthenticated returns false on subsequent getState() calls
    github.token = null;
    github.username = null;
    return {
      success: false,
      error: error.message,
    };
  }
}

async function handleLogout() {
  github.logout();
  hasMoreNotifications = false;
  latestCommentUrlCache.clear();
  await persistCommentCache();
  await stopPolling();
  await storage.clearAuthData();
  await updateBadge(null);

  return { success: true };
}

async function getState() {
  const notifications = await storage.getNotifications();

  // Ensure username is available
  let username = github.username;
  if (!username && github.isAuthenticated) {
    username = await storage.getUsername();
    if (username) {
      github.username = username; // Update github object
    }
  }

  return {
    isAuthenticated: github.isAuthenticated,
    username,
    notifications,
  };
}

async function openNotification(notificationId) {
  const notifications = await storage.getNotifications();
  const notification = notifications.find((n) => n.id === notificationId);

  if (!notification) {
    throw new Error("Notification not found");
  }

  // Build URL using centralized builder
  const url = buildNotificationUrl(notification);

  // Open tab immediately
  await tabs.create({ url });

  // Mark as read in background (don't block the opening)
  markAsRead(notificationId).catch((error) => {
    console.error("Failed to mark as read:", error);
  });

  return { success: true, url };
}

async function openLatestComment(notificationId) {
  const notifications = await storage.getNotifications();
  const notification = notifications.find((n) => n.id === notificationId);

  if (!notification) {
    throw new Error("Notification not found");
  }

  // Use prefetched URL if available and still valid for this notification's updated_at
  const cached = latestCommentUrlCache.get(notificationId);
  let latestCommentUrl =
    cached && cached.updated_at === notification.updated_at ? cached.url : null;

  // Fall back to a live API query when the cache has no valid entry
  if (!latestCommentUrl) {
    latestCommentUrl = await github.getLatestCommentUrl(notification);
  }

  const url = latestCommentUrl ?? buildNotificationUrl(notification);

  // Open tab immediately
  await tabs.create({ url });

  // Mark as read in background (don't block the opening)
  markAsRead(notificationId).catch((error) => {
    console.error("Failed to mark as read:", error);
  });

  return { success: true, url };
}

async function markAsRead(notificationId) {
  try {
    await github.markAsRead(notificationId);

    // Invalidate in-progress detail fetches so they don't restore this notification.
    notificationFetchVersion++;

    // Update local storage
    const notifications = await storage.getNotifications();
    const updated = notifications.filter((n) => n.id !== notificationId);

    await storage.setNotifications(updated);
    await updateBadge(updated.length, hasMoreNotifications);

    // Remove the stale cache entry for this notification
    latestCommentUrlCache.delete(notificationId);
    await persistCommentCache();

    return { success: true };
  } catch (error) {
    console.error("Failed to mark as read:", error);
    return { success: false, error: error.message };
  }
}

async function markAllAsRead() {
  try {
    await github.markAllAsRead();

    // Invalidate in-progress detail fetches so they don't restore notifications after the clear.
    notificationFetchVersion++;

    // Clear local storage and the comment URL cache
    hasMoreNotifications = false;
    await storage.setNotifications([]);
    await updateBadge(0);
    latestCommentUrlCache.clear();
    await persistCommentCache();

    return { success: true };
  } catch (error) {
    console.error("Failed to mark all as read:", error);
    return { success: false, error: error.message };
  }
}

async function markRepoAsRead(owner, repo) {
  try {
    await github.markRepoAsRead(owner, repo);

    // Invalidate in-progress detail fetches so they don't restore repo notifications.
    notificationFetchVersion++;

    // Filter out notifications from this repository
    const notifications = await storage.getNotifications();
    const updated = notifications.filter((n) => n.repository.full_name !== `${owner}/${repo}`);

    await storage.setNotifications(updated);
    await updateBadge(updated.length, hasMoreNotifications);

    // Remove cache entries for the cleared repo's notifications
    const removedIds = notifications
      .filter((n) => n.repository.full_name === `${owner}/${repo}`)
      .map((n) => n.id);
    for (const id of removedIds) latestCommentUrlCache.delete(id);
    await persistCommentCache();

    return { success: true, notifications: updated };
  } catch (error) {
    console.error("Failed to mark repo as read:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Helper function to safely clear a notification
 * Isolates clear failures to prevent them from blocking other operations
 */
async function safeClearNotification(notificationId) {
  try {
    await notifications.clear(notificationId);
  } catch (error) {
    console.error(`Failed to clear notification ${notificationId}:`, error);
  }
}

/**
 * Helper function to delay execution
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Show desktop notifications for new items
 * @exported for testing
 */
export async function showDesktopNotificationsForNew(notificationsList) {
  try {
    // Always clear previous aggregated notification first to prevent stale messages
    // Do this unconditionally (even for invalid input) to ensure cleanup
    await safeClearNotification(AGGREGATED_NOTIFICATION_ID);

    // Validate parameter type
    if (!Array.isArray(notificationsList)) {
      return;
    }

    // Early return if empty - after cleanup
    if (notificationsList.length === 0) {
      return;
    }

    // Check if desktop notifications are enabled
    const enableDesktopNotifications = await storage.getEnableDesktopNotifications();

    if (!enableDesktopNotifications) {
      return;
    }

    // Filter new notifications
    const newNotifications = notificationsList.filter((n) => n.isNew);

    if (newNotifications.length === 0) {
      return;
    }

    // Get max notification limit from settings (validated in storage.js)
    const maxNotifications = await storage.getMaxDesktopNotifications();

    // Note: Assumes notifications are already sorted by updated_at descending (GitHub API default)
    // Show individual notifications up to the limit with delay between each
    const notificationsToShow = newNotifications.slice(0, maxNotifications);
    for (let i = 0; i < notificationsToShow.length; i++) {
      if (i > 0) {
        // Add delay between notifications to prevent overwhelming the notification center
        await delay(NOTIFICATION_DELAY_MS);
      }
      await showDesktopNotification(notificationsToShow[i]);
    }

    // If there are more notifications beyond the limit, show an aggregated notification
    const remainingCount = newNotifications.length - maxNotifications;
    if (remainingCount > 0) {
      // Add delay before showing aggregated notification
      if (notificationsToShow.length > 0) {
        await delay(NOTIFICATION_DELAY_MS);
      }
      await showAggregatedNotification(remainingCount);
    }
  } catch (error) {
    console.error("Failed to show desktop notifications:", error);
  }
}

/**
 * Show a single desktop notification
 * @exported for testing
 */
export async function showDesktopNotification(notif) {
  try {
    // Format title to match popup display: "#123 Title"
    let displayTitle = notif.title;
    if (notif.number !== undefined) {
      displayTitle = `#${notif.number} ${notif.title}`;
    }

    const notificationOptions = {
      type: "basic",
      iconUrl: runtime.getURL(NOTIFICATION_ICON_PATH),
      title: displayTitle, // Primary: #123 Title
      message: `${notif.repository.full_name} · ${formatReason(notif.reason)}`, // Secondary info
      // Note: 'priority' and 'requireInteraction' are not supported in Firefox
      // Only include them for Chrome/Chromium browsers
    };

    // Add Chrome-specific options (Firefox doesn't support these)
    applyChromeNotificationOptions(notificationOptions, CHROME_PRIORITY_NORMAL);

    // Create notification
    const notificationId = `${NOTIFICATION_ID_PREFIX}${notif.id}`;
    await notifications.create(notificationId, notificationOptions);
  } catch (error) {
    console.error("Failed to create desktop notification:", error);
  }
}

/**
 * Show an aggregated notification for remaining new notifications
 * @exported for testing
 */
export async function showAggregatedNotification(remainingCount) {
  try {
    const notificationOptions = {
      type: "basic",
      iconUrl: runtime.getURL(NOTIFICATION_ICON_PATH),
      title: "GitHub Notifications",
      message: `... and ${remainingCount} more new notification${remainingCount > 1 ? "s" : ""}`,
    };

    // Add Chrome-specific options (Firefox doesn't support these)
    applyChromeNotificationOptions(notificationOptions, CHROME_PRIORITY_LOW); // Lower priority for aggregated notifications

    // Create aggregated notification
    await notifications.create(AGGREGATED_NOTIFICATION_ID, notificationOptions);
  } catch (error) {
    console.error("Failed to create aggregated notification:", error);
  }
}

/**
 * Handle notification click - open the notification URL
 */
notifications.onClicked.addListener(async (notificationId) => {
  try {
    // Handle aggregated notification click - open GitHub notifications page
    if (notificationId === AGGREGATED_NOTIFICATION_ID) {
      // Clear notification (isolate failures to prevent blocking)
      await safeClearNotification(notificationId);
      // Note: We can't programmatically open the popup, so we open GitHub notifications page instead
      await tabs.create({ url: GITHUB_NOTIFICATIONS_URL });
      return;
    }

    // Validate and extract notification ID from the chrome notification ID
    if (!notificationId.startsWith(NOTIFICATION_ID_PREFIX)) {
      console.error("Invalid notification ID format:", notificationId);
      return;
    }
    const githubNotifId = notificationId.slice(NOTIFICATION_ID_PREFIX.length);

    // Get all notifications to find the one that was clicked
    // Invalidate in-progress fetches before the async chain so any fetch that
    // passes its version check during our read won't restore the removed notification.
    notificationFetchVersion++;
    const notificationsList = await storage.getNotifications();
    const notification = notificationsList.find((n) => n.id === githubNotifId);

    // Remove from storage FIRST to prevent re-creation from race conditions
    const updatedNotifications = notificationsList.filter((n) => n.id !== githubNotifId);
    await storage.setNotifications(updatedNotifications);

    // Clear the notification (isolate failures to prevent blocking tab open + mark as read)
    await safeClearNotification(notificationId);

    if (notification) {
      // Build and open URL using centralized builder
      const url = buildNotificationUrl(notification);
      await tabs.create({ url });

      // Mark as read
      await github.markAsRead(githubNotifId);

      // Remove stale comment URL cache entry for this notification
      latestCommentUrlCache.delete(githubNotifId);
      await persistCommentCache();

      // Update badge
      await updateBadge(updatedNotifications.length, hasMoreNotifications);
    }
  } catch (error) {
    console.error("Failed to handle notification click:", error);
  }
});

// URL construction is now handled by centralized url-builder.js module

// Initialize on startup
initialize();

// Also initialize when service worker wakes up
runtime.onStartup.addListener(initialize);
runtime.onInstalled.addListener(initialize);
