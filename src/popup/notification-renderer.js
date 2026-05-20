/**
 * Notification rendering module for popup
 */

import {
  ANIMATION_DURATION,
  NOTIFICATION_TYPES,
  MESSAGE_TYPES,
  TIME_CONVERSION,
} from "../lib/constants.js";
import { getNotificationStatus, getReasonPriority } from "../lib/format-utils.js";
import { getIconSVGElement } from "../lib/icons.js";
import { buildProfileUrl, buildRepoNotificationsUrl } from "../lib/url-builder.js";
import { getAvatarSrc } from "../lib/avatar-cache.js";

/**
 * Build icon class with state information
 * @param {Object} notif - Notification object
 * @returns {string} Icon class string
 * @exported for testing
 */
export function buildIconClass(notif) {
  const base = notif.icon;
  if (notif.icon !== "pr" && notif.icon !== "issue") return base;
  if (notif.merged) return `${base} merged`;
  if (notif.icon === "issue" && notif.state === "closed" && notif.state_reason === "not_planned")
    return `${base} not-planned`;
  if (notif.state) return `${base} ${notif.state}`;
  return base;
}

/**
 * Format comment count with proper pluralization
 * @param {number} count - Number of comments
 * @returns {string} Formatted comment count
 * @exported for testing
 */
export function formatCommentCount(count) {
  return `${count} comment${count > 1 ? "s" : ""}`;
}

/**
 * Truncate release body to maximum length
 * @param {string|null|undefined} body - Release body text
 * @param {number} maxLength - Maximum length (default: 200)
 * @returns {string} Truncated body
 * @exported for testing
 */
export function truncateReleaseBody(body, maxLength = 200) {
  if (!body) return "";
  const trimmed = body.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.substring(0, maxLength);
}

// Cache for notifications to avoid unnecessary re-renders
let cachedNotifications = null;
let cachedNotificationsHash = null;
let cachedRepoOrder = [];

// Runtime configuration (set via initRenderer)
let config = {
  notificationsList: null,
  emptyState: null,
  markAllBtn: null,
  sendMessage: async () => {},
  onUserAction: () => {},
  onMarkRepoAsRead: () => {},
  onMarkAsReadSuccess: () => {},
};

/**
 * Initialize the renderer with DOM elements and callbacks
 * @param {Object} options - Configuration options
 */
export function initRenderer(options) {
  config = { ...config, ...options };
}

/**
 * Get cached notifications
 * @returns {Array|null} Cached notifications array
 */
export function getCachedNotifications() {
  return cachedNotifications;
}

/**
 * Clear notification cache to force re-render
 */
export function clearNotificationCache() {
  cachedNotifications = null;
  cachedNotificationsHash = null;
}

/**
 * Create a lightweight hash of notifications for change detection
 * @param {Array} notifications - Array of notification objects
 * @returns {string} Hash string
 * @exported for testing
 */
export function createNotificationsHash(notifications) {
  if (!notifications || notifications.length === 0) return "empty";
  return notifications
    .map(
      (n) =>
        `${n.id}:${n.updated_at}:${n.state || ""}:${n.merged || ""}:${n.conclusion || ""}:${n.comment_count ?? ""}:${n.author?.login || ""}`,
    )
    .join("|");
}

/**
 * Format time ago (e.g., "2h ago", "3d ago")
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted time string
 */
export function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / TIME_CONVERSION.MS_PER_MINUTE);
  const diffHours = Math.floor(diffMs / (60 * TIME_CONVERSION.MS_PER_MINUTE));
  const diffDays = Math.floor(diffMs / (24 * 60 * TIME_CONVERSION.MS_PER_MINUTE));

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Create a single notification item element
 * @param {Object} notif - Notification object
 * @param {HTMLElement} repoHeader - Repository header element
 * @param {string} repoFullName - Repository full name
 * @returns {HTMLElement} Notification list item element
 */
function createNotificationItem(notif, repoHeader, repoFullName) {
  const {
    notificationsList,
    emptyState,
    markAllBtn,
    sendMessage,
    onUserAction,
    onMarkAsReadSuccess,
  } = config;

  const li = document.createElement("li");
  li.className = "notification-item";
  li.dataset.id = notif.id;
  li.dataset.repo = repoFullName;
  if (getReasonPriority(notif.reason)) {
    li.dataset.priority = "high";
  }

  function getNotificationOpenTarget(item) {
    return item?.querySelector(".notification-open-target") || null;
  }

  function getFocusTargetAfterRemoval() {
    let sibling = li.nextElementSibling;
    while (sibling) {
      if (sibling.matches(".notification-item")) {
        return getNotificationOpenTarget(sibling);
      }
      sibling = sibling.nextElementSibling;
    }

    sibling = li.previousElementSibling;
    while (sibling) {
      if (sibling.matches(".notification-item")) {
        return getNotificationOpenTarget(sibling);
      }
      sibling = sibling.previousElementSibling;
    }

    return null;
  }

  async function openNotification() {
    await sendMessage(MESSAGE_TYPES.OPEN_NOTIFICATION, { notificationId: notif.id });
    window.close();
  }

  // Build icon class with state information
  const iconClass = buildIconClass(notif);

  // Pre-compute release body for performance
  const releaseBody =
    notif.type === NOTIFICATION_TYPES.RELEASE && notif.body ? notif.body.trim() : "";
  const truncatedBody = releaseBody ? truncateReleaseBody(releaseBody) : "";
  const authorProfileUrl = notif.author?.login ? buildProfileUrl(notif.author.login) : null;

  // Create notification icon container
  const iconDiv = document.createElement("div");
  iconDiv.className = `notification-icon ${iconClass}`;
  iconDiv.title = getNotificationStatus(notif);
  iconDiv.appendChild(
    getIconSVGElement(notif.icon, notif.state, notif.merged, notif.conclusion, notif.state_reason),
  );

  // Create notification content container
  const contentDiv = document.createElement("div");
  contentDiv.className = "notification-content";

  // Create main content area
  const mainDiv = document.createElement("div");
  mainDiv.className = "notification-main";

  const openTarget = document.createElement("button");
  openTarget.type = "button";
  openTarget.className = "notification-open-target";

  const titleDiv = document.createElement("div");
  titleDiv.className = "notification-title";
  const fullTitle = releaseBody ? `${notif.title}\n\n${releaseBody}` : notif.title;
  titleDiv.dataset.title = fullTitle;
  titleDiv.title = fullTitle;

  if (notif.number !== undefined) {
    const numberSpan = document.createElement("span");
    numberSpan.className = "notification-number";
    numberSpan.textContent = `#${notif.number}`;
    titleDiv.appendChild(numberSpan);
    titleDiv.appendChild(document.createTextNode(" "));
  }

  titleDiv.appendChild(document.createTextNode(notif.title));

  if (releaseBody) {
    const previewSpan = document.createElement("span");
    previewSpan.className = "notification-preview";
    previewSpan.textContent = ` ${truncatedBody}${releaseBody.length > 200 ? "..." : ""}`;
    titleDiv.appendChild(previewSpan);
  }

  openTarget.appendChild(titleDiv);
  mainDiv.appendChild(openTarget);
  contentDiv.appendChild(mainDiv);

  // Create metadata area
  const metaDiv = document.createElement("div");
  metaDiv.className = "notification-meta";

  // Comment count — always rendered as a clickable button so users can jump to the
  // latest comment. Clicking sends OPEN_LATEST_COMMENT to the service worker, which
  // fetches the comment URL from the GitHub API at click time.
  if (notif.comment_count !== undefined && notif.comment_count > 0) {
    const countLabel = notif.comment_count >= 100 ? "99+" : String(notif.comment_count);

    const commentsEl = document.createElement("button");
    commentsEl.type = "button";
    commentsEl.className = "notification-comments notification-comments--link";
    // When the badge shows "99+", reveal the exact count in the tooltip since it is
    // otherwise hidden.  Below 100 the badge already displays the precise number.
    commentsEl.title =
      notif.comment_count >= 100
        ? `Go to latest comment (${notif.comment_count} comments)`
        : "Go to latest comment";
    commentsEl.addEventListener("click", (e) => {
      e.stopPropagation();
      // Fire-and-forget: the service worker handles the API call and opens the tab.
      // Closing the popup immediately avoids blocking the user when there is a cache
      // miss and the live API query takes up to 15 s.
      sendMessage(MESSAGE_TYPES.OPEN_LATEST_COMMENT, { notificationId: notif.id }).catch(() => {});
      window.close();
    });

    commentsEl.appendChild(getIconSVGElement("comment_bubble"));
    commentsEl.appendChild(document.createTextNode(" "));
    commentsEl.appendChild(document.createTextNode(countLabel));
    metaDiv.appendChild(commentsEl);
  }

  // Author avatar
  if (notif.author) {
    const authorLink = document.createElement("a");
    authorLink.className = "author-profile-link";
    authorLink.href = authorProfileUrl;
    authorLink.target = "_blank";
    authorLink.rel = "noopener noreferrer";

    const authorImg = document.createElement("img");
    const avatarSrc = getAvatarSrc(notif.author);
    if (avatarSrc) authorImg.src = avatarSrc;
    authorImg.className = "author-avatar";
    authorImg.alt = notif.author.login;
    authorImg.title = notif.author.login;

    authorLink.appendChild(authorImg);
    metaDiv.appendChild(authorLink);
  }

  // Update time
  if (notif.updated_at) {
    const timeSpan = document.createElement("span");
    timeSpan.className = "notification-time";
    timeSpan.title = new Date(notif.updated_at).toLocaleString();
    timeSpan.textContent = formatTimeAgo(notif.updated_at);
    metaDiv.appendChild(timeSpan);
  }

  contentDiv.appendChild(metaDiv);

  // Create actions container
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "notification-actions";

  const markReadBtn = document.createElement("button");
  markReadBtn.className = "btn-mark-read";
  markReadBtn.dataset.id = String(notif.id);
  markReadBtn.title = "Mark as read";
  markReadBtn.textContent = "✓";

  actionsDiv.appendChild(markReadBtn);

  // Assemble the notification item
  li.appendChild(iconDiv);
  li.appendChild(contentDiv);
  li.appendChild(actionsDiv);

  // Click to open notification
  li.addEventListener("click", async (e) => {
    if (e.target.closest(".btn-mark-read") || e.target.closest("a")) {
      return;
    }
    await openNotification();
  });

  // Mark as read button with immediate visual feedback
  markReadBtn.addEventListener("click", async (e) => {
    e.stopPropagation();

    if (li.classList.contains("marking-read")) {
      return;
    }

    li.classList.add("marking-read");
    markReadBtn.disabled = true;
    markReadBtn.textContent = "✓";

    // Track user action
    const animationDuration = ANIMATION_DURATION.FADE_OUT;
    onUserAction(animationDuration);

    // Force reflow so ::after pseudo-element starts at opacity 0
    void li.offsetHeight;
    li.classList.add("fade-out");

    const nextFocusTarget = getFocusTargetAfterRemoval();

    // Restore the notification item to its original state on failure
    function restoreItem() {
      li.classList.remove("marking-read", "fade-out");
      markReadBtn.disabled = false;
      markReadBtn.textContent = "✓";

      li.style.backgroundColor = "rgba(239, 68, 68, 0.1)";
      setTimeout(() => {
        li.style.backgroundColor = "";
      }, ANIMATION_DURATION.ERROR_BACKGROUND_FADE);
    }

    try {
      const result = await sendMessage(MESSAGE_TYPES.MARK_AS_READ, { notificationId: notif.id });

      if (result.success) {
        // Ensure at least one frame of the overlay animation is painted
        await new Promise(requestAnimationFrame);

        // Success: remove notification from DOM
        li.remove();

        // Check if any notifications from this group remain
        const listContainer = repoHeader?.parentElement || notificationsList;
        const escapedRepo = CSS.escape(repoFullName);
        const remainingInGroup = listContainer.querySelectorAll(
          `.notification-item[data-repo="${escapedRepo}"]`,
        );

        if (remainingInGroup.length === 0 && repoHeader) {
          repoHeader.remove();
        } else if (repoHeader) {
          const repoCountSpan = repoHeader.querySelector(".repo-count");
          if (repoCountSpan) {
            repoCountSpan.textContent = String(remainingInGroup.length);
          }
        }

        const remaining = listContainer.querySelectorAll(".notification-item").length;
        if (remaining === 0 && listContainer === notificationsList) {
          emptyState.hidden = false;
          markAllBtn.disabled = true;
        }

        nextFocusTarget?.focus({ preventScroll: true });
        onMarkAsReadSuccess();
      } else {
        // Failure: restore item
        restoreItem();
      }
    } catch (error) {
      console.error("Failed to mark as read:", error);
      restoreItem();
    }
  });

  return li;
}

/**
 * Render notifications list (grouped by repository)
 * @param {Array} notifications - Array of notification objects
 * @param {boolean} shouldResort - Whether to re-sort repos by time
 */
export function groupByRepo(notifications) {
  const grouped = {};
  for (const notif of notifications) {
    const repoFullName = notif.repository.full_name;
    const notifTime = new Date(notif.updated_at).getTime();
    if (!grouped[repoFullName]) {
      grouped[repoFullName] = {
        repo: notif.repository,
        notifications: [],
        latestNotifTime: notifTime,
      };
    }
    grouped[repoFullName].notifications.push(notif);
    if (notifTime > grouped[repoFullName].latestNotifTime) {
      grouped[repoFullName].latestNotifTime = notifTime;
    }
  }
  return grouped;
}

export function renderNotificationsInto(container, groupedByRepo, repoOrder) {
  container.replaceChildren();
  if (!groupedByRepo || Object.keys(groupedByRepo).length === 0) return;

  const sortedRepos =
    repoOrder ||
    Object.keys(groupedByRepo).sort(
      (a, b) => groupedByRepo[b].latestNotifTime - groupedByRepo[a].latestNotifTime,
    );

  for (const repoFullName of sortedRepos) {
    const group = groupedByRepo[repoFullName];
    if (!group) continue;
    const repoNotificationsUrl = buildRepoNotificationsUrl(repoFullName);
    const repoHomeUrl = group.repo.html_url || `https://github.com/${repoFullName}`;

    const repoHeader = document.createElement("div");
    repoHeader.className = "repo-group-header";
    repoHeader.dataset.repo = repoFullName;

    const repoInfoDiv = document.createElement("div");
    repoInfoDiv.className = "repo-info";

    const repoHomeLink = document.createElement("a");
    repoHomeLink.className = "repo-home-link";
    repoHomeLink.href = repoHomeUrl;
    repoHomeLink.target = "_blank";
    repoHomeLink.rel = "noopener noreferrer";
    repoHomeLink.title = `Open ${repoFullName} repository`;
    repoHomeLink.setAttribute("aria-label", `Open ${repoFullName} repository`);
    const repoIconSvg = getIconSVGElement("repo");
    repoIconSvg.setAttribute("width", "14");
    repoIconSvg.setAttribute("height", "14");
    repoIconSvg.classList.add("repo-icon");
    repoHomeLink.appendChild(repoIconSvg);
    repoInfoDiv.appendChild(repoHomeLink);

    const repoNotificationsLink = document.createElement("a");
    repoNotificationsLink.className = "repo-notifications-link";
    repoNotificationsLink.href = repoNotificationsUrl;
    repoNotificationsLink.target = "_blank";
    repoNotificationsLink.rel = "noopener noreferrer";
    repoNotificationsLink.title = `Open ${repoFullName} notifications`;
    repoNotificationsLink.setAttribute("aria-label", `Open notifications for ${repoFullName}`);
    const repoNameSpan = document.createElement("span");
    repoNameSpan.className = "repo-name";
    repoNameSpan.textContent = repoFullName;
    repoNotificationsLink.appendChild(repoNameSpan);
    repoInfoDiv.appendChild(repoNotificationsLink);

    const repoActionsDiv = document.createElement("div");
    repoActionsDiv.className = "repo-actions";
    const repoCountSpan = document.createElement("span");
    repoCountSpan.className = "repo-count";
    repoCountSpan.textContent = String(group.notifications.length);
    repoActionsDiv.appendChild(repoCountSpan);

    const markReadBtn = document.createElement("button");
    markReadBtn.className = "repo-mark-read-btn";
    markReadBtn.title = "Mark all notifications in this repository as read";
    markReadBtn.setAttribute("aria-label", "Mark repository as read");
    const checkmarkSvg = getIconSVGElement("checkmark");
    markReadBtn.appendChild(checkmarkSvg);
    repoActionsDiv.appendChild(markReadBtn);

    repoHeader.appendChild(repoInfoDiv);
    repoHeader.appendChild(repoActionsDiv);

    markReadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      config.onMarkRepoAsRead(repoFullName);
    });

    container.appendChild(repoHeader);
    for (const notif of group.notifications) {
      const li = createNotificationItem(notif, repoHeader, repoFullName);
      container.appendChild(li);
    }
  }
}

export function renderNotifications(notifications, shouldResort = true) {
  const { notificationsList, emptyState, markAllBtn } = config;

  const notificationsHash = createNotificationsHash(notifications);
  if (cachedNotificationsHash === notificationsHash) {
    return;
  }

  cachedNotifications = notifications;
  cachedNotificationsHash = notificationsHash;

  if (!notifications || notifications.length === 0) {
    notificationsList.replaceChildren();
    emptyState.hidden = false;
    markAllBtn.disabled = true;
    return;
  }

  emptyState.hidden = true;
  markAllBtn.disabled = false;

  const grouped = groupByRepo(notifications);

  let sortedRepos;
  if (shouldResort) {
    sortedRepos = Object.keys(grouped).sort(
      (a, b) => grouped[b].latestNotifTime - grouped[a].latestNotifTime,
    );
    cachedRepoOrder = sortedRepos;
  } else {
    const currentRepos = new Set(Object.keys(grouped));
    sortedRepos = cachedRepoOrder.filter((repo) => currentRepos.has(repo));
    const cachedSet = new Set(cachedRepoOrder);
    const newRepos = Object.keys(grouped).filter((repo) => !cachedSet.has(repo));
    if (newRepos.length > 0) {
      sortedRepos = [...sortedRepos, ...newRepos];
    }
  }

  renderNotificationsInto(notificationsList, grouped, sortedRepos);
}
