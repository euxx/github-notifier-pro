/**
 * Background Service Worker for GitHub Notifier
 */

import github from '../lib/github-api.js';
import * as storage from '../lib/storage.js';
import { action, alarms, runtime, tabs, notifications } from '../lib/chrome-api.js';
import {
  ALARM_NAME,
  MIN_POLL_INTERVAL_SECONDS,
  MAX_POLL_INTERVAL_SECONDS,
  MESSAGE_TYPES,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_ICONS,
} from '../lib/constants.js';
import { formatReason } from '../lib/format-utils.js';
import { buildNotificationUrl } from '../lib/url-builder.js';
import { LRUCache, DEFAULT_LRU_CACHE_SIZE } from '../lib/lru-cache.js';

/**
 * Desktop notification constants
 * @exported for testing
 */
export const NOTIFICATION_ID_PREFIX = 'github-notif-';
export const AGGREGATED_NOTIFICATION_ID = 'github-notif-more';
export const NOTIFICATION_DELAY_MS = 1000;
export const GITHUB_NOTIFICATIONS_URL = 'https://github.com/notifications';
const NOTIFICATION_ICON_PATH = 'images/icon.png';
const CHROME_PRIORITY_NORMAL = 2; // Individual notifications
const CHROME_PRIORITY_LOW = 1; // Aggregated notifications

/**
 * Badge background colors for different states
 */
const BADGE_COLORS = {
  UNAUTHENTICATED: '#6B7280', // Gray - not logged in
  NORMAL: '#2563EB', // Blue - has notifications
  RATE_LIMITED: '#f59e0b', // Orange - rate limit error
  TIMEOUT: '#ef4444', // Red - timeout error
};

/**
 * Detect Chrome/Chromium browser
 * Firefox doesn't support priority and requireInteraction notification options
 */
const isChrome = typeof chrome !== 'undefined' && typeof browser === 'undefined';

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
  'state',
  'merged',
  'conclusion',
  'status',
  'detailsFailed',
  'author',
  'comment_count',
  'number',
  'created_at',
  'body',
  'html_url',
];

// Tracks whether the last successful notifications fetch had additional pages.
let hasMoreNotifications = false;

/**
 * Initialize extension state from storage
 */
async function initialize() {
  const token = await storage.getToken();
  if (token) {
    github.token = token;
    const username = await storage.getUsername();
    if (username) {
      github.username = username;
    }

    // Populate author cache from existing notifications
    await initializeAuthorCache();

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
    console.error('Failed to initialize author cache:', error);
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
    await action.setBadgeText({ text: '?' });
    await action.setBadgeBackgroundColor({ color: BADGE_COLORS.UNAUTHENTICATED });
  } else if (count === 0) {
    await action.setBadgeText({ text: '' });
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
  // Set state/conclusion based on type
  if (notifType === NOTIFICATION_TYPES.CHECK_SUITE) {
    baseData.conclusion = details.conclusion;
    baseData.status = details.status;
  } else {
    baseData.state = details.state;
    if (notifType === NOTIFICATION_TYPES.PULL_REQUEST && details.merged) {
      baseData.merged = true;
    }
  }

  // Extract author from user or author field
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

  // Copy additional fields if present
  if (details.comments !== undefined) baseData.comment_count = details.comments;
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
function createDetailFetchTask(notification, index, detailedNotifications) {
  return async () => {
    try {
      const details = await github.getNotificationDetails(notification);
      updateNotificationDetails(detailedNotifications[index], details, notification.subject.type);
      return { success: true, id: notification.id, index };
    } catch (error) {
      console.error(`Failed to fetch details for notification ${notification.id}:`, error);
      if (notification.subject.type !== NOTIFICATION_TYPES.CHECK_SUITE) {
        detailedNotifications[index].state = 'open';
      }
      detailedNotifications[index].detailsFailed = true;
      return { success: false, id: notification.id, index, error: error.message };
    }
  };
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
 * Check for new notifications
 *
 * Race condition prevention:
 * - Each fetch gets a unique version number
 * - Only the most recent fetch can overwrite storage
 * - Older detail fetches are discarded if a newer fetch has completed
 */
async function checkNotifications() {
  if (!github.isAuthenticated) {
    return;
  }

  // Increment version for this fetch to prevent race conditions
  const currentFetchVersion = ++notificationFetchVersion;
  console.log(`Starting notification fetch #${currentFetchVersion}`);

  // Track previous poll interval to detect changes
  const previousPollInterval = github.pollInterval;

  try {
    const result = await github.getNotifications();

    // Check if poll interval changed (even on 304) and update alarm accordingly
    // GitHub may send new X-Poll-Interval in 304 responses
    if (github.pollInterval !== previousPollInterval) {
      const { seconds: pollIntervalSeconds, minutes: newPollIntervalMinutes } = getClampedPollInterval();
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
      hasMoreNotifications = hasMore;

      // Check if a newer fetch has already started
      if (currentFetchVersion < notificationFetchVersion) {
        console.log(`Fetch #${currentFetchVersion} superseded by #${notificationFetchVersion}, aborting`);
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
          _fetchVersion: currentFetchVersion, // Track which fetch this came from
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

      // Save basic data immediately - popup can display now
      await storage.setNotifications(basicProcessed);
      await updateBadge(basicProcessed.length, hasMore);

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

      // Split into priority (first 10 visible) and background loading
      const VISIBLE_COUNT = 10; // Approximately one screen of notifications
      const priorityNotifications = notificationsNeedingDetails.slice(0, VISIBLE_COUNT);
      const backgroundNotifications = notificationsNeedingDetails.slice(VISIBLE_COUNT);

      console.log(
        `Loading details: ${priorityNotifications.length} priority, ${backgroundNotifications.length} background`,
      );

      // Priority loading: First 10 notifications (visible on screen)
      let priorityResults = []; // Define in outer scope for background logging
      if (priorityNotifications.length > 0) {
        priorityResults = await fetchWithConcurrencyLimit(
          priorityNotifications.map(({ notification: n, index }) =>
            createDetailFetchTask(n, index, detailedNotifications),
          ),
          5, // Concurrency limit: 5 requests at a time
        );

        // Log priority loading results
        const prioritySuccess = priorityResults.filter((r) => r.success === true).length;
        const priorityFailed = priorityResults.filter((r) => r.success === false).length;
        console.log(`Fetch #${currentFetchVersion} priority: ${prioritySuccess} loaded, ${priorityFailed} failed`);

        // Check if superseded before updating
        if (currentFetchVersion >= notificationFetchVersion) {
          // Merge with current storage to avoid overwriting user deletions
          const currentStored = await storage.getNotifications();
          const safeDetailed = filterToCurrentlyStored(detailedNotifications, currentStored);

          // Save priority notifications immediately
          await storage.setNotifications(safeDetailed);
          console.log(`Fetch #${currentFetchVersion} saved ${priorityNotifications.length} priority notifications`);
        }
      }

      // Background loading: Remaining notifications
      // This happens asynchronously and doesn't block the priority loading
      if (backgroundNotifications.length > 0) {
        fetchWithConcurrencyLimit(
          backgroundNotifications.map(({ notification: n, index }) =>
            createDetailFetchTask(n, index, detailedNotifications),
          ),
          3, // Lower concurrency for background: 3 requests at a time
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
            console.log(`Author cache: ${cacheStats.size}/${cacheStats.maxSize} (${cacheStats.utilization})`);

            // Double-check before final save
            const currentStoredNotifications = await storage.getNotifications();
            const storedVersion = currentStoredNotifications[0]?._fetchVersion || 0;

            if (currentFetchVersion >= storedVersion) {
              // Merge with current storage to avoid overwriting user deletions
              const safeDetailed = filterToCurrentlyStored(detailedNotifications, currentStoredNotifications);

              // Update storage with all completed details
              await storage.setNotifications(safeDetailed);
              console.log(`Fetch #${currentFetchVersion} updated storage with detailed notifications`);
            } else {
              console.log(
                `Fetch #${currentFetchVersion} skipped storage update (stored version: ${storedVersion} is newer)`,
              );
            }
          })
          .catch((error) => {
            console.error(`Error fetching background notification details (fetch #${currentFetchVersion}):`, error);
          });
      }

      // Show desktop notifications for new items (using basic data)
      await showDesktopNotificationsForNew(basicProcessed);
    }
  } catch (error) {
    console.error(`Failed to check notifications (fetch #${currentFetchVersion}):`, error);

    // Handle different error types with appropriate UI feedback
    if (error.message && error.message.includes('Rate limited')) {
      // Rate limited - show timer badge with reset info
      const rateLimitInfo = github.getRateLimitInfo();
      await action.setBadgeText({ text: '⏱' });
      await action.setBadgeBackgroundColor({ color: BADGE_COLORS.RATE_LIMITED });
      await action.setTitle({
        title: `Rate limited. Resets ${rateLimitInfo.resetIn || 'soon'}`,
      });
    } else if (error.message && error.message.includes('timeout')) {
      // Network timeout
      await action.setBadgeText({ text: '⏱' });
      await action.setBadgeBackgroundColor({ color: BADGE_COLORS.TIMEOUT });
      await action.setTitle({ title: 'Request timeout - will retry' });
    } else if (error.message && (error.message.includes('NetworkError') || error.message.includes('Failed to fetch'))) {
      // Network error - keep last known state, update title only
      await action.setTitle({ title: 'Offline - showing cached data' });
    } else {
      // Other errors
      console.error('Unexpected error:', error);
      await action.setTitle({ title: `Error: ${error.message}` });
    }
  }
}

/**
 * Get icon name for notification type
 * @exported for testing
 */
export function getIconForType(type) {
  return NOTIFICATION_TYPE_ICONS[type] || 'notification';
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
      console.error('Message handling error:', error);
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

    case MESSAGE_TYPES.MARK_AS_READ:
      return await markAsRead(message.notificationId);

    case MESSAGE_TYPES.MARK_ALL_AS_READ:
      return await markAllAsRead();

    case MESSAGE_TYPES.MARK_REPO_AS_READ:
      return await markRepoAsRead(message.owner, message.repo);

    case MESSAGE_TYPES.REFRESH:
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

    default:
      throw new Error(`Unknown action: ${message.action}`);
  }
}

async function handleLogin(authMethod = 'oauth', token = null) {
  try {
    // If token is provided (from Device Flow in popup), just use it directly
    if (token) {
      github.token = token;
      await github.fetchUsername();
    } else {
      // Otherwise, trigger login flow
      await github.login(authMethod, token);
    }

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
  await stopPolling();
  await storage.clear();
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
    // Include cache statistics for debugging/monitoring
    cacheStats: authorCache.getStats(),
  };
}

async function openNotification(notificationId) {
  const notifications = await storage.getNotifications();
  const notification = notifications.find((n) => n.id === notificationId);

  if (!notification) {
    throw new Error('Notification not found');
  }

  // Build URL using centralized builder
  const url = buildNotificationUrl(notification);

  // Open tab immediately
  await tabs.create({ url });

  // Mark as read in background (don't block the opening)
  markAsRead(notificationId).catch((error) => {
    console.error('Failed to mark as read:', error);
  });

  return { success: true, url };
}

async function markAsRead(notificationId) {
  try {
    await github.markAsRead(notificationId);

    // Update local storage
    const notifications = await storage.getNotifications();
    const updated = notifications.filter((n) => n.id !== notificationId);

    await storage.setNotifications(updated);
    await updateBadge(updated.length, hasMoreNotifications);

    return { success: true };
  } catch (error) {
    console.error('Failed to mark as read:', error);
    return { success: false, error: error.message };
  }
}

async function markAllAsRead() {
  try {
    await github.markAllAsRead();

    // Clear local storage
    hasMoreNotifications = false;
    await storage.setNotifications([]);
    await updateBadge(0);

    return { success: true };
  } catch (error) {
    console.error('Failed to mark all as read:', error);
    return { success: false, error: error.message };
  }
}

async function markRepoAsRead(owner, repo) {
  try {
    await github.markRepoAsRead(owner, repo);

    // Filter out notifications from this repository
    const notifications = await storage.getNotifications();
    const updated = notifications.filter((n) => n.repository.full_name !== `${owner}/${repo}`);

    await storage.setNotifications(updated);
    await updateBadge(updated.length, hasMoreNotifications);

    return { success: true };
  } catch (error) {
    console.error('Failed to mark repo as read:', error);
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
    console.error('Failed to show desktop notifications:', error);
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
      type: 'basic',
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
    console.error('Failed to create desktop notification:', error);
  }
}

/**
 * Show an aggregated notification for remaining new notifications
 * @exported for testing
 */
export async function showAggregatedNotification(remainingCount) {
  try {
    const notificationOptions = {
      type: 'basic',
      iconUrl: runtime.getURL(NOTIFICATION_ICON_PATH),
      title: 'GitHub Notifications',
      message: `... and ${remainingCount} more new notification${remainingCount > 1 ? 's' : ''}`,
    };

    // Add Chrome-specific options (Firefox doesn't support these)
    applyChromeNotificationOptions(notificationOptions, CHROME_PRIORITY_LOW); // Lower priority for aggregated notifications

    // Create aggregated notification
    await notifications.create(AGGREGATED_NOTIFICATION_ID, notificationOptions);
  } catch (error) {
    console.error('Failed to create aggregated notification:', error);
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
      console.error('Invalid notification ID format:', notificationId);
      return;
    }
    const githubNotifId = notificationId.slice(NOTIFICATION_ID_PREFIX.length);

    // Get all notifications to find the one that was clicked
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

      // Update badge
      await updateBadge(updatedNotifications.length, hasMoreNotifications);
    }
  } catch (error) {
    console.error('Failed to handle notification click:', error);
  }
});

// URL construction is now handled by centralized url-builder.js module

// Initialize on startup
initialize();

// Also initialize when service worker wakes up
runtime.onStartup.addListener(initialize);
runtime.onInstalled.addListener(initialize);
