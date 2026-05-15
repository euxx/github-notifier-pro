/**
 * Desktop (OS-level) notifications.
 *
 * Renders new GitHub notifications as browser notifications via the
 * `chrome.notifications` API. Reads the user's "enable desktop notifications"
 * preference and per-batch limit from storage; everything else is presentation.
 *
 * The matching click handler lives in service-worker because it touches the
 * worker's storage / cache / fetch-version state. This module only displays.
 */

import { notifications, runtime } from "../lib/chrome-api.js";
import { formatReason } from "../lib/format-utils.js";
import * as storage from "../lib/storage.js";

export const NOTIFICATION_ID_PREFIX = "github-notif-";
export const AGGREGATED_NOTIFICATION_ID = "github-notif-more";
export const NOTIFICATION_DELAY_MS = 1000;
export const GITHUB_NOTIFICATIONS_URL = "https://github.com/notifications";

const NOTIFICATION_ICON_PATH = "images/icon.png";
const CHROME_PRIORITY_NORMAL = 2; // Individual notifications
const CHROME_PRIORITY_LOW = 1; // Aggregated notifications

// Firefox doesn't support priority/requireInteraction notification options
const isChrome = typeof chrome !== "undefined" && typeof browser === "undefined";

function applyChromeNotificationOptions(options, priority) {
  if (isChrome) {
    options.priority = priority;
    options.requireInteraction = false; // Allow auto-dismiss
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Clear a desktop notification, swallowing failures so they don't block
 * the surrounding flow.
 */
export async function safeClearNotification(notificationId) {
  try {
    await notifications.clear(notificationId);
  } catch (error) {
    console.error(`Failed to clear notification ${notificationId}:`, error);
  }
}

/**
 * Render desktop notifications for any new items in the visible list.
 *
 * Always clears the prior aggregated notification first so a stale "+N more"
 * never lingers from a previous batch. Honors the user's enable/disable
 * preference and the per-batch max.
 *
 * @param {Array} notificationsList - already-visible notifications (filter applied)
 */
export async function showDesktopNotificationsForNew(notificationsList) {
  try {
    // Always clear previous aggregated notification first to prevent stale messages
    // Do this unconditionally (even for invalid input) to ensure cleanup
    await safeClearNotification(AGGREGATED_NOTIFICATION_ID);

    if (!Array.isArray(notificationsList)) return;
    if (notificationsList.length === 0) return;

    const enableDesktopNotifications = await storage.getEnableDesktopNotifications();
    if (!enableDesktopNotifications) return;

    const newNotifications = notificationsList.filter((n) => n.isNew);
    if (newNotifications.length === 0) return;

    const maxNotifications = await storage.getMaxDesktopNotifications();

    // Notifications arrive sorted by updated_at desc (GitHub API default).
    // Show the first `maxNotifications` individually, with a delay between
    // each so the OS notification center doesn't drop them in a single burst.
    const notificationsToShow = newNotifications.slice(0, maxNotifications);
    for (let i = 0; i < notificationsToShow.length; i++) {
      if (i > 0) {
        await delay(NOTIFICATION_DELAY_MS);
      }
      await showDesktopNotification(notificationsToShow[i]);
    }

    const remainingCount = newNotifications.length - maxNotifications;
    if (remainingCount > 0) {
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
 * Render one individual desktop notification.
 */
export async function showDesktopNotification(notif) {
  try {
    let displayTitle = notif.title;
    if (notif.number !== undefined) {
      displayTitle = `#${notif.number} ${notif.title}`;
    }

    const notificationOptions = {
      type: "basic",
      iconUrl: runtime.getURL(NOTIFICATION_ICON_PATH),
      title: displayTitle,
      message: `${notif.repository.full_name} · ${formatReason(notif.reason)}`,
    };
    applyChromeNotificationOptions(notificationOptions, CHROME_PRIORITY_NORMAL);

    const notificationId = `${NOTIFICATION_ID_PREFIX}${notif.id}`;
    await notifications.create(notificationId, notificationOptions);
  } catch (error) {
    console.error("Failed to create desktop notification:", error);
  }
}

/**
 * Render the "+N more" rollup that follows when more new items exist than
 * the per-batch limit allows.
 */
export async function showAggregatedNotification(remainingCount) {
  try {
    const notificationOptions = {
      type: "basic",
      iconUrl: runtime.getURL(NOTIFICATION_ICON_PATH),
      title: "GitHub Notifications",
      message: `... and ${remainingCount} more new notification${remainingCount > 1 ? "s" : ""}`,
    };
    applyChromeNotificationOptions(notificationOptions, CHROME_PRIORITY_LOW);

    await notifications.create(AGGREGATED_NOTIFICATION_ID, notificationOptions);
  } catch (error) {
    console.error("Failed to create aggregated notification:", error);
  }
}
