/**
 * Background Service Worker for GitHub Notifier
 */

import github from "../lib/github-api.js";
import * as storage from "../lib/storage.js";
import { action, alarms, runtime, tabs, notifications } from "../lib/chrome-api.js";
import {
  ALARM_NAME,
  MIN_POLL_INTERVAL_SECONDS,
  MAX_POLL_INTERVAL_SECONDS,
  MESSAGE_TYPES,
} from "../lib/constants.js";
import { classifyError } from "../lib/http.js";
import { buildNotificationUrl } from "../lib/url-builder.js";
import {
  applyRulesWithStats,
  isVisible,
  validateRulesStrict,
  sanitizeRules,
} from "../lib/filter-rules.js";
import { createSyncEngine } from "./sync-engine.js";
import { createNotificationFetcher } from "./notification-fetcher.js";
import {
  NOTIFICATION_ID_PREFIX,
  AGGREGATED_NOTIFICATION_ID,
  GITHUB_NOTIFICATIONS_URL,
  safeClearNotification,
} from "./desktop-notifications.js";

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
 * Update badge with notification count
 * @param {number|null} count - Number of notifications (null if not authenticated)
 * @param {boolean} hasMore - Whether there are more notifications beyond this count
 */
async function updateBadge(count, hasMore = false) {
  if (count === null) {
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

// Notification fetcher owns the GitHub-pull pipeline: fetch version, hasMore
// pagination flag, author cache, comment URL cache (with session-storage
// persistence), and the priority/background detail fetch logic. updateBadge
// is injected so the fetcher doesn't need to import the chrome.action API.
// onPollIntervalChanged is injected so the alarm registration owned by this
// file gets updated the moment a new server-driven X-Poll-Interval lands —
// before any storage write — so a later setNotifications failure can't
// silently lose the signal.
const fetcher = createNotificationFetcher({
  github,
  storage,
  onBadgeUpdate: updateBadge,
  async onPollIntervalChanged(minutes) {
    await alarms.clear(ALARM_NAME);
    await alarms.create(ALARM_NAME, {
      delayInMinutes: minutes,
      periodInMinutes: minutes,
    });
  },
});

// Sync engine handles filter rule push/pull state machine. The host (this
// file) injects an onFilterReplaced hook so the side effects of accepting a
// remote filter — re-annotate stored notifications, refresh the badge, and
// force the next poll to be unconditional — stay in the worker's domain.
const syncEngine = createSyncEngine({
  github,
  storage,
  async onFilterReplaced(valid) {
    const current = await storage.getNotifications();
    const { notifications: reannotated, stats } = applyRulesWithStats(current, valid);
    await storage.setNotifications(reannotated);
    await storage.setNotificationFilterStats(stats);
    await updateBadge(reannotated.filter(isVisible).length, fetcher.getHasMore());
    github.lastModified = null;
    checkNotifications().catch(() => {});
  },
});

/**
 * Guard against concurrent initialize() calls.
 * The module top-level call, onStartup, and onInstalled can all fire
 * close together when the service worker first loads.
 */
let initializePromise = null;

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

    await fetcher.initializeAuthorCache();
    // Restore comment URL cache from session storage (survives MV3 worker
    // recycling). No-op on Firefox or when session storage has no saved data.
    await fetcher.restoreCommentCache();

    await startPolling();
    await checkNotifications();
  } else {
    fetcher.resetHasMore();
    await updateBadge(null);
  }
}

/**
 * Drive a fetch through the fetcher and surface error feedback.
 * Server-driven X-Poll-Interval changes update the alarm via the
 * onPollIntervalChanged hook injected at fetcher construction.
 */
async function checkNotifications() {
  try {
    await fetcher.runFetch();
  } catch (error) {
    console.error("Failed to check notifications:", error);
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
 * Calculate clamped poll interval from GitHub API response
 * Clamps between MIN_POLL_INTERVAL_SECONDS (60s/1min) and MAX_POLL_INTERVAL_SECONDS (600s/10min)
 */
function getClampedPollInterval() {
  const pollIntervalSeconds = Math.min(
    Math.max(github.pollInterval || 0, MIN_POLL_INTERVAL_SECONDS),
    MAX_POLL_INTERVAL_SECONDS,
  );
  const pollIntervalMinutes = Math.ceil(pollIntervalSeconds / 60);
  return { seconds: pollIntervalSeconds, minutes: pollIntervalMinutes };
}

async function startPolling() {
  const { minutes: pollIntervalMinutes } = getClampedPollInterval();
  await alarms.create(ALARM_NAME, {
    delayInMinutes: pollIntervalMinutes,
    periodInMinutes: pollIntervalMinutes,
  });
}

async function stopPolling() {
  await alarms.clear(ALARM_NAME);
}

alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await checkNotifications();
  }
});

runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      console.error("Message handling error:", error);
      sendResponse({ error: error.message });
    });
  return true;
});

async function handleMessage(message) {
  if (!message || typeof message !== "object") {
    throw new Error("Invalid message");
  }

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
      github.lastModified = null;
      await checkNotifications();
      // Reset alarm timer so the countdown shows the full period.
      if (github.isAuthenticated) {
        const { minutes: pollIntervalMinutes } = getClampedPollInterval();
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
      validateRulesStrict(filter);
      await storage.setNotificationFilter(filter);
      // Clear stale stats — they are indexed parallel to the old rules array
      // and would be semantically wrong after any rule change. Fresh stats
      // are written below.
      await storage.setNotificationFilterStats([]);
      const current = await storage.getNotifications();
      const { notifications: reannotated, stats: freshStats } = applyRulesWithStats(
        current,
        filter,
      );
      await storage.setNotifications(reannotated);
      await storage.setNotificationFilterStats(freshStats);
      const visibleCount = reannotated.filter(isVisible).length;
      await updateBadge(visibleCount, fetcher.getHasMore());
      syncEngine.pushIfEnabled();
      return { success: true };
    }

    case MESSAGE_TYPES.SYNC_GET_STATE: {
      const enabled = await storage.getSyncEnabled();
      const gistId = await storage.getSyncGistId();
      let lastPush = await storage.getSyncLastPush();
      if (!lastPush && gistId) {
        const meta = await github.getFilterGistMeta(gistId);
        if (meta) {
          lastPush = meta.updated_at;
          await storage.setSyncLastPush(lastPush);
        }
      }
      return { enabled, gistId, lastPush };
    }

    case MESSAGE_TYPES.SYNC_ENABLE: {
      let gistId = await storage.getSyncGistId();
      let isNew = false;
      let pushTimestamp = null;
      if (!gistId) {
        const found = await github.findFilterGist();
        if (found) {
          gistId = found.id;
          pushTimestamp = found.updatedAt;
        }
      }
      if (!gistId) {
        const filter = await storage.getNotificationFilter();
        try {
          const created = await github.createFilterGist(filter);
          gistId = created.id;
          pushTimestamp = created.updatedAt;
          isNew = true;
        } catch (err) {
          if (err.code === "missing_scope") {
            return { success: false, error: "missing_scope" };
          }
          throw err;
        }
      }
      if (!isNew) {
        const pullResult = await syncEngine.applyRemoteRules(gistId);
        if (!pullResult.success) {
          if (pullResult.error === "conflict") {
            await storage.setSyncGistId(gistId);
            await storage.setSyncEnabled(true);
          }
          return { ...pullResult, gistId };
        }
        if (pullResult.pushNeeded) {
          await storage.setSyncGistId(gistId);
          await storage.setSyncEnabled(true);
          const pushResult = await syncEngine.push({ afterPull: true });
          if (!pushResult.success) return { ...pushResult, gistId };
          return { success: true, gistId };
        }
        pushTimestamp = pullResult.lastPush || null;
      }
      await storage.setSyncGistId(gistId);
      await storage.setSyncEnabled(true);
      const filter = await storage.getNotificationFilter();
      await storage.setSyncLastPushedFilter(filter);
      await storage.setSyncLastPush(pushTimestamp || new Date().toISOString());
      return { success: true, gistId };
    }

    case MESSAGE_TYPES.SYNC_DISABLE: {
      await storage.setSyncEnabled(false);
      return { success: true };
    }

    case MESSAGE_TYPES.SYNC_PUSH:
      return await syncEngine.push();

    case MESSAGE_TYPES.SYNC_PULL: {
      const enabled = await storage.getSyncEnabled();
      if (!enabled) return { success: false, error: "sync_disabled" };
      const gistId = await storage.getSyncGistId();
      if (!gistId) return { success: false, error: "no_gist" };
      const result = await syncEngine.applyRemoteRules(gistId);
      if (result.pushNeeded) {
        const pushResult = await syncEngine.push({ afterPull: true });
        if (!pushResult.success) return pushResult;
      }
      return result;
    }

    case MESSAGE_TYPES.SYNC_RESOLVE_CONFLICT: {
      const { choice } = message;
      const gistId = await storage.getSyncGistId();
      if (!gistId) return { success: false, error: "no_gist" };
      if (choice === "local") {
        const filter = await storage.getNotificationFilter();
        const updateResult = await github.updateFilterGist(gistId, filter);
        if (!updateResult) {
          await storage.setSyncGistId(null);
          await storage.setSyncEnabled(false);
          return { success: false, error: "gist_not_found" };
        }
        await storage.setSyncLastPush(updateResult.updatedAt || new Date().toISOString());
        await storage.setSyncLastPushedFilter(filter);
        return { success: true, filter };
      }
      if (choice === "remote") {
        const result = await github.getFilterGist(gistId);
        if (!result) return { success: false, error: "gist_not_found" };
        const valid = sanitizeRules(result.rules);
        await syncEngine.acceptRemoteFilter(valid, result.updatedAt || new Date().toISOString());
        return { success: true, filter: valid };
      }
      return { success: false, error: "invalid_choice" };
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

    await storage.setToken(github.token);
    await storage.setUsername(github.username);
    await storage.setUserInfo(github.userInfo);
    await storage.setAuthMethod(authMethod);

    await startPolling();
    await checkNotifications();

    return { success: true, username: github.username };
  } catch (error) {
    // Clear in-memory token so isAuthenticated is false on subsequent getState()
    github.token = null;
    github.username = null;
    return { success: false, error: error.message };
  }
}

async function handleLogout() {
  github.logout();
  fetcher.resetHasMore();
  await fetcher.clearCommentCache();
  await stopPolling();
  await storage.clearAuthData();
  await storage.setSyncEnabled(false);
  await storage.setSyncGistId(null);
  await storage.setSyncLastPush(null);
  await storage.setSyncLastPushedFilter(null);
  await updateBadge(null);
  return { success: true };
}

async function getState() {
  const notifs = await storage.getNotifications();

  let username = github.username;
  if (!username && github.isAuthenticated) {
    username = await storage.getUsername();
    if (username) {
      github.username = username;
    }
  }

  return {
    isAuthenticated: github.isAuthenticated,
    username,
    notifications: notifs,
  };
}

async function openNotification(notificationId) {
  const notifs = await storage.getNotifications();
  const notification = notifs.find((n) => n.id === notificationId);
  if (!notification) {
    throw new Error("Notification not found");
  }

  const url = buildNotificationUrl(notification);
  await tabs.create({ url });
  markAsRead(notificationId).catch((error) => {
    console.error("Failed to mark as read:", error);
  });
  return { success: true, url };
}

async function openLatestComment(notificationId) {
  const notifs = await storage.getNotifications();
  const notification = notifs.find((n) => n.id === notificationId);
  if (!notification) {
    throw new Error("Notification not found");
  }

  let latestCommentUrl = fetcher.getCommentUrl(notificationId, notification.updated_at);
  if (!latestCommentUrl) {
    latestCommentUrl = await github.getLatestCommentUrl(notification);
  }
  const url = latestCommentUrl ?? buildNotificationUrl(notification);

  await tabs.create({ url });
  markAsRead(notificationId).catch((error) => {
    console.error("Failed to mark as read:", error);
  });
  return { success: true, url };
}

async function markAsRead(notificationId) {
  try {
    await github.markAsRead(notificationId);
    fetcher.bumpVersion();

    const notifs = await storage.getNotifications();
    const updated = notifs.filter((n) => n.id !== notificationId);
    await storage.setNotifications(updated);
    await updateBadge(updated.filter(isVisible).length, fetcher.getHasMore());
    await recalcFilterStats(updated);
    await fetcher.evictCommentEntry(notificationId);

    return { success: true };
  } catch (error) {
    console.error("Failed to mark as read:", error);
    return { success: false, error: error.message };
  }
}

async function recalcFilterStats(notifs) {
  const rules = await storage.getNotificationFilter();
  if (rules.length === 0) {
    await storage.setNotificationFilterStats([]);
    return;
  }
  const { stats } = applyRulesWithStats(notifs, rules);
  await storage.setNotificationFilterStats(stats);
}

async function markAllAsRead() {
  try {
    await github.markAllAsRead();
    fetcher.bumpVersion();
    fetcher.resetHasMore();

    await storage.setNotifications([]);
    await storage.setNotificationFilterStats([]);
    await updateBadge(0);
    await fetcher.clearCommentCache();

    return { success: true };
  } catch (error) {
    console.error("Failed to mark all as read:", error);
    return { success: false, error: error.message };
  }
}

async function markRepoAsRead(owner, repo) {
  try {
    await github.markRepoAsRead(owner, repo);
    fetcher.bumpVersion();

    const notifs = await storage.getNotifications();
    const updated = notifs.filter((n) => n.repository.full_name !== `${owner}/${repo}`);
    await storage.setNotifications(updated);
    await updateBadge(updated.filter(isVisible).length, fetcher.getHasMore());
    await recalcFilterStats(updated);

    const removedIds = notifs
      .filter((n) => n.repository.full_name === `${owner}/${repo}`)
      .map((n) => n.id);
    await fetcher.evictCommentEntries(removedIds);

    return { success: true, notifications: updated };
  } catch (error) {
    console.error("Failed to mark repo as read:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle desktop notification click.
 * Aggregated rollup → open GitHub notifications page.
 * Individual notification → open its URL, mark as read, evict from caches.
 */
notifications.onClicked.addListener(async (notificationId) => {
  try {
    if (notificationId === AGGREGATED_NOTIFICATION_ID) {
      await safeClearNotification(notificationId);
      await tabs.create({ url: GITHUB_NOTIFICATIONS_URL });
      return;
    }

    if (!notificationId.startsWith(NOTIFICATION_ID_PREFIX)) {
      console.error("Invalid notification ID format:", notificationId);
      return;
    }
    const githubNotifId = notificationId.slice(NOTIFICATION_ID_PREFIX.length);

    // Bump fetch version before any async work so an in-flight fetch's
    // version check fires after our removal lands and discards its writes.
    fetcher.bumpVersion();
    const notificationsList = await storage.getNotifications();
    const notification = notificationsList.find((n) => n.id === githubNotifId);

    const updatedNotifications = notificationsList.filter((n) => n.id !== githubNotifId);
    await storage.setNotifications(updatedNotifications);
    await recalcFilterStats(updatedNotifications);

    await safeClearNotification(notificationId);

    if (notification) {
      const url = buildNotificationUrl(notification);
      await tabs.create({ url });
      await github.markAsRead(githubNotifId);
      await fetcher.evictCommentEntry(githubNotifId);
      await updateBadge(updatedNotifications.filter(isVisible).length, fetcher.getHasMore());
    }
  } catch (error) {
    console.error("Failed to handle notification click:", error);
  }
});

initialize();
runtime.onStartup.addListener(initialize);
runtime.onInstalled.addListener(initialize);

// ─── Test-only re-exports ─────────────────────────────────────────────
// service-worker.test.js imports these to drive tests through the worker
// surface. Production code imports them directly from notification-fetcher.
export {
  getIconForType,
  updateNotificationDetails,
  copyCachedDetails,
} from "./notification-fetcher.js";

/**
 * Test-only access to the fetcher's comment URL cache and prefetch.
 * Production code goes through fetcher.getCommentUrl / evict* helpers.
 */
export const latestCommentUrlCache = fetcher._commentCache;
export async function persistCommentCache() {
  return fetcher.persistCommentCache();
}
export async function restoreCommentCache() {
  return fetcher.restoreCommentCache();
}
export async function prefetchLatestCommentUrls(notifs) {
  return fetcher.prefetchLatestCommentUrls(notifs);
}
