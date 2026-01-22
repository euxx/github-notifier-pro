/**
 * Background Service Worker for GitHub Notifier
 */

import github from '../lib/github-api.js';
import * as storage from '../lib/storage.js';
import { action, alarms, runtime, storage as browserStorage, tabs } from '../lib/chrome-api.js';
import { ALARM_NAME, DEFAULT_POLL_INTERVAL_MINUTES, MESSAGE_TYPES } from '../lib/constants.js';
import { formatReason } from '../lib/format-utils.js';

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
    await startPolling();
    await checkNotifications();
  } else {
    await updateBadge(null);
  }
}

/**
 * Update badge with notification count
 */
async function updateBadge(count) {
  if (count === null) {
    // Not authenticated
    await action.setBadgeText({ text: '?' });
    await action.setBadgeBackgroundColor({ color: '#6B7280' });
  } else if (count === 0) {
    await action.setBadgeText({ text: '' });
  } else {
    await action.setBadgeText({ text: count.toString() });
    await action.setBadgeBackgroundColor({ color: '#2563EB' });
  }
}

/**
 * Helper: Update notification details from API response
 */
function updateNotificationDetails(baseData, details, notifType) {
  // Set state/conclusion based on type
  if (notifType === 'CheckSuite') {
    baseData.conclusion = details.conclusion;
    baseData.status = details.status;
  } else {
    baseData.state = details.state;
    if (notifType === 'PullRequest' && details.merged) {
      baseData.merged = true;
    }
  }

  // Extract author from user or author field
  const authorData = details.user || details.author;
  if (authorData) {
    baseData.author = {
      login: authorData.login,
      avatar_url: authorData.avatar_url,
      html_url: authorData.html_url
    };
  }

  // Copy additional fields if present
  if (details.comments !== undefined) baseData.comment_count = details.comments;
  if (details.number !== undefined) baseData.number = details.number;
  if (details.created_at) baseData.created_at = details.created_at;
  if (details.body) baseData.body = details.body;
  if (details.html_url) baseData.html_url = details.html_url; // Cache the HTML URL for quick access
}

/**
 * Helper: Copy cached details to new notification data
 */
function copyCachedDetails(baseData, existing) {
  ['state', 'merged', 'conclusion', 'status', 'detailsFailed', 'author', 'comment_count', 'number', 'created_at', 'body', 'html_url'].forEach(key => {
    if (existing[key] !== undefined) {
      baseData[key] = existing[key];
    }
  });
}

/**
 * Check for new notifications
 */
async function checkNotifications() {
  if (!github.isAuthenticated) {
    return;
  }

  try {
    const notifications = await github.getNotifications();

    if (notifications) {
      // Get existing notifications to check for new ones
      const existingNotifications = await storage.getNotifications();
      const existingIds = new Set(existingNotifications.map(n => n.id));
      const existingMap = new Map(existingNotifications.map(n => [n.id, n]));

      // Process notifications - add normalized type and icon
      const processed = await Promise.all(notifications.map(async (n) => {
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

        // Fetch details for all notifications to get author information
        // Only fetch if it's a new notification or updated_at changed
        const existing = existingMap.get(n.id);
        const needsUpdate = !existing || existing.updated_at !== n.updated_at;
        const shouldFetchDetails = true;

        if (shouldFetchDetails) {
          if (needsUpdate) {
            try {
              const details = await github.getNotificationDetails(n);
              updateNotificationDetails(baseData, details, n.subject.type);
            } catch (error) {
              console.error(`Failed to fetch details for notification ${n.id}:`, error);
              // Fallback to default state if fetch fails
              if (n.subject.type !== 'CheckSuite') {
                baseData.state = 'open';
              }
              baseData.detailsFailed = true; // Mark that details fetch failed
            }
          } else if (existing) {
            // Reuse existing state if we didn't fetch new details
            copyCachedDetails(baseData, existing);
          }
        }

        return baseData;
      }));

      await storage.setNotifications(processed);
      await updateBadge(processed.length);

      // Show desktop notifications for new items
      await showDesktopNotificationsForNew(processed);
    }
  } catch (error) {
    console.error('Failed to check notifications:', error);

    // Handle different error types with appropriate UI feedback
    if (error.message && error.message.includes('Rate limited')) {
      // Rate limited - show timer badge with reset info
      const rateLimitInfo = github.getRateLimitInfo();
      await action.setBadgeText({ text: '⏱' });
      await action.setBadgeBackgroundColor({ color: '#f59e0b' }); // Orange
      await action.setTitle({
        title: `Rate limited. Resets ${rateLimitInfo.resetIn || 'soon'}`
      });
    } else if (error.message && error.message.includes('timeout')) {
      // Network timeout
      await action.setBadgeText({ text: '⏱' });
      await action.setBadgeBackgroundColor({ color: '#ef4444' }); // Red
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
 */
function getIconForType(type) {
  const icons = {
    Issue: 'issue',
    PullRequest: 'pr',
    Release: 'release',
    Discussion: 'discussion',
    Commit: 'commit',
    CheckSuite: 'actions',
    RepositoryVulnerabilityAlert: 'alert',
    RepositoryInvitation: 'repo',
  };
  return icons[type] || 'notification';
}

/**
 * Start polling for notifications
 */
async function startPolling() {
  await alarms.create(ALARM_NAME, {
    delayInMinutes: DEFAULT_POLL_INTERVAL_MINUTES,
    periodInMinutes: DEFAULT_POLL_INTERVAL_MINUTES,
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
  handleMessage(message).then(sendResponse).catch((error) => {
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

    case MESSAGE_TYPES.REFRESH:
      await checkNotifications();
      // Reset the alarm timer without recreating it
      // This ensures the countdown shows the full period
      if (github.isAuthenticated) {
        // Clear and recreate to reset the timer
        await alarms.clear(ALARM_NAME);
        await alarms.create(ALARM_NAME, {
          delayInMinutes: DEFAULT_POLL_INTERVAL_MINUTES,
          periodInMinutes: DEFAULT_POLL_INTERVAL_MINUTES,
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
    await storage.setAuthMethod(authMethod);

    // Start polling
    await startPolling();
    await checkNotifications();

    return {
      success: true,
      username: github.username,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

async function handleLogout() {
  github.logout();
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
    username: username,
    notifications: notifications,
  };
}

async function openNotification(notificationId) {
  const notifications = await storage.getNotifications();
  const notification = notifications.find((n) => n.id === notificationId);

  if (!notification) {
    throw new Error('Notification not found');
  }

  // Get URL (with fallback logic)
  const url = getNotificationUrl(notification);

  // Open tab immediately
  await tabs.create({ url });

  // Mark as read in background (don't block the opening)
  markAsRead(notificationId).catch(error => {
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
    await updateBadge(updated.length);

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
    await storage.setNotifications([]);
    await updateBadge(0);

    return { success: true };
  } catch (error) {
    console.error('Failed to mark all as read:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Show desktop notifications for new items
 */
async function showDesktopNotificationsForNew(notifications) {
  try {
    // Check if desktop notifications are enabled
    const enableDesktopNotifications = await storage.getEnableDesktopNotifications();

    if (!enableDesktopNotifications) {
      return;
    }

    // Get silent mode setting
    const silentMode = await storage.getSilentMode();

    // Filter and show only new notifications
    const newNotifications = notifications.filter(n => n.isNew);

    // Show desktop notification for each new item
    for (const notif of newNotifications) {
      await showDesktopNotification(notif, silentMode);
    }
  } catch (error) {
    console.error('Failed to show desktop notifications:', error);
  }
}

/**
 * Show a single desktop notification
 */
async function showDesktopNotification(notif, silentMode = false) {
  try {
    // Format title to match popup display: "#123 Title"
    let displayTitle = notif.title;
    if (notif.number !== undefined) {
      displayTitle = `#${notif.number} ${notif.title}`;
    }

    const notificationOptions = {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('images/icon.png'),
      title: displayTitle, // #123 Title
      message: `${notif.repository.full_name} · ${formatReason(notif.reason)}`, // 次要信息
      priority: 2,
      requireInteraction: false,
      silent: silentMode,
    };

    // Create notification
    const notificationId = `github-notif-${notif.id}`;
    await chrome.notifications.create(notificationId, notificationOptions);
  } catch (error) {
    console.error('Failed to create desktop notification:', error);
  }
}

/**
 * Handle notification click - open the notification URL
 */
chrome.notifications.onClicked.addListener(async (notificationId) => {
  try {
    // Extract notification ID from the chrome notification ID
    const githubNotifId = notificationId.replace('github-notif-', '');

    // Get all notifications to find the one that was clicked
    const notifications = await storage.getNotifications();
    const notification = notifications.find(n => n.id === githubNotifId);

    if (notification) {
      // Open the notification URL
      await openNotificationUrl(notification);

      // Mark as read
      await github.markAsRead(githubNotifId);

      // Update stored notifications
      const updatedNotifications = notifications.filter(n => n.id !== githubNotifId);
      await storage.setNotifications(updatedNotifications);
      await updateBadge(updatedNotifications.length);
    }

    // Clear the notification
    await chrome.notifications.clear(notificationId);
  } catch (error) {
    console.error('Failed to handle notification click:', error);
  }
});

/**
 * Get notification URL with fallback logic
 */
function getNotificationUrl(notification) {
  // Return cached URL if available
  if (notification.html_url) {
    return notification.html_url;
  }

  // Otherwise, construct URL based on notification type
  const fullName = notification.repository.full_name;
  const type = notification.type;

  // For PRs and Issues, construct URL from number
  if ((type === 'PullRequest' || type === 'Issue') && notification.number) {
    const issueOrPr = type === 'PullRequest' ? 'pull' : 'issues';
    return `https://github.com/${fullName}/${issueOrPr}/${notification.number}`;
  }
  // For releases
  else if (type === 'Release') {
    return `https://github.com/${fullName}/releases`;
  }
  // For commits
  else if (type === 'Commit') {
    // Extract SHA from URL (usually in subject.url)
    const match = notification.url?.match(/commits\/([a-f0-9]+)/);
    if (match) {
      return `https://github.com/${fullName}/commit/${match[1]}`;
    }
  }

  // Fallback to repository URL
  return notification.repository.html_url;
}

/**
 * Open notification URL in browser
 */
async function openNotificationUrl(notification) {
  const url = getNotificationUrl(notification);
  if (url) {
    await tabs.create({ url });
  }
}

// Initialize on startup
initialize();

// Also initialize when service worker wakes up
runtime.onStartup.addListener(initialize);
runtime.onInstalled.addListener(initialize);
