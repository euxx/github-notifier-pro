/**
 * Notification rendering module for popup
 */

import { ANIMATION_DURATION, NOTIFICATION_TYPES, MESSAGE_TYPES, TIME_CONVERSION } from '../lib/constants.js';
import { formatReason, getNotificationStatus, escapeHtml, escapeAttr } from '../lib/format-utils.js';
import { getIconSVG } from '../lib/icons.js';

/**
 * Build icon class with state information
 * @param {Object} notif - Notification object
 * @returns {string} Icon class string
 * @exported for testing
 */
export function buildIconClass(notif) {
  let iconClass = notif.icon;
  if (notif.icon === 'pr' || notif.icon === 'issue') {
    if (notif.merged) {
      iconClass += ' merged';
    } else if (notif.icon === 'issue' && notif.state === 'closed' && notif.state_reason === 'not_planned') {
      iconClass += ' not-planned';
    } else if (notif.state) {
      iconClass += ` ${notif.state}`;
    }
  }
  return iconClass;
}

/**
 * Format comment count with proper pluralization
 * @param {number} count - Number of comments
 * @returns {string} Formatted comment count
 * @exported for testing
 */
export function formatCommentCount(count) {
  return `${count} comment${count > 1 ? 's' : ''}`;
}

/**
 * Truncate release body to maximum length
 * @param {string|null|undefined} body - Release body text
 * @param {number} maxLength - Maximum length (default: 200)
 * @returns {string} Truncated body
 * @exported for testing
 */
export function truncateReleaseBody(body, maxLength = 200) {
  if (!body) return '';
  const trimmed = body.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.substring(0, maxLength);
}

function buildAuthorProfileUrl(login) {
  if (!login) return null;
  return `https://github.com/${encodeURIComponent(login)}`;
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
  getShowHoverCards: () => true,
  sendMessage: async () => {},
  onUserAction: () => {},
  onMarkRepoAsRead: () => {},
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
  cachedNotificationsHash = null;
}

/**
 * Create a lightweight hash of notifications for change detection
 * @param {Array} notifications - Array of notification objects
 * @returns {string} Hash string
 * @exported for testing
 */
export function createNotificationsHash(notifications) {
  if (!notifications || notifications.length === 0) return 'empty';
  return notifications
    .map(
      (n) =>
        `${n.id}:${n.updated_at}:${n.state || ''}:${n.merged || ''}:${n.conclusion || ''}:${n.comment_count ?? ''}:${n.author?.login || ''}`,
    )
    .join('|');
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

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Create hover card HTML for a notification
 * @param {Object} notif - Notification object
 * @returns {string} HTML string
 */
export function createHoverCard(notif) {
  const hasAuthor = notif.author?.login;
  const hasComments = notif.comment_count > 0;
  const hasDescription = notif.body?.trim();
  const authorProfileUrl = hasAuthor ? buildAuthorProfileUrl(notif.author.login) : null;

  const metadataParts = [];
  metadataParts.push(`<span class="hover-card-reason">${escapeHtml(formatReason(notif.reason))}</span>`);
  const fullTime = new Date(notif.updated_at).toLocaleString();
  metadataParts.push(`<span title="${fullTime}">${formatTimeAgo(notif.updated_at)}</span>`);
  if (hasComments) {
    metadataParts.push(formatCommentCount(notif.comment_count));
  }

  return `
    <div class="notification-hover-card">
      ${
        hasAuthor
          ? `
        <div class="hover-card-header">
          <a class="hover-card-profile-link" href="${escapeAttr(authorProfileUrl)}" target="_blank" rel="noopener noreferrer">
            <img src="${escapeAttr(notif.author.avatar_url)}" alt="${escapeAttr(notif.author.login)}" class="hover-card-avatar" />
            <div class="hover-card-author">
              <div class="hover-card-author-name">${escapeHtml(notif.author.login)}</div>
            </div>
          </a>
        </div>
      `
          : ''
      }
      <div class="hover-card-body">
        <div class="hover-card-meta">${metadataParts.join(' · ')}</div>
      </div>
      ${
        hasDescription
          ? `
        <div class="hover-card-description">${escapeHtml(notif.body.trim())}</div>
      `
          : ''
      }
    </div>
  `;
}

/**
 * Position hover card smartly based on available space
 * @param {HTMLElement} listItem - The notification list item element
 */
function positionHoverCard(listItem) {
  const card = listItem.querySelector('.notification-hover-card');
  if (!card) return;

  const rect = listItem.getBoundingClientRect();

  // Measure card height without showing it
  card.style.visibility = 'hidden';
  card.style.opacity = '1';
  card.classList.add('visible');
  const cardHeight = card.offsetHeight;
  card.style.visibility = '';
  card.style.opacity = '';
  card.classList.remove('visible');

  // Determine position based on available space
  const margin = 0;
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;

  const topPosition =
    spaceBelow >= cardHeight + margin
      ? rect.bottom + margin
      : spaceAbove >= cardHeight + margin
        ? rect.top - cardHeight - margin
        : rect.bottom + margin;

  card.style.top = `${topPosition}px`;
  card.style.right = '10px';
  card.style.left = 'auto';

  card.classList.add('visible');
}

/**
 * Create a single notification item element
 * @param {Object} notif - Notification object
 * @param {HTMLElement} repoHeader - Repository header element
 * @param {string} repoFullName - Repository full name
 * @param {Array} notifications - All notifications array
 * @returns {HTMLElement} Notification list item element
 */
function createNotificationItem(notif, repoHeader, repoFullName, notifications) {
  const { notificationsList, emptyState, markAllBtn, getShowHoverCards, sendMessage, onUserAction } = config;
  const showHoverCards = getShowHoverCards();

  const li = document.createElement('li');
  li.className = 'notification-item';
  li.dataset.id = notif.id;
  li.dataset.repo = repoFullName;

  // Build icon class with state information
  const iconClass = buildIconClass(notif);

  // Pre-compute release body for performance
  const releaseBody = notif.type === NOTIFICATION_TYPES.RELEASE && notif.body ? notif.body.trim() : '';
  const truncatedBody = releaseBody ? truncateReleaseBody(releaseBody) : '';
  const authorProfileUrl = notif.author?.login ? buildAuthorProfileUrl(notif.author.login) : null;

  li.innerHTML = `
    <div class="notification-icon ${iconClass}" title="${escapeAttr(getNotificationStatus(notif))}">
      ${getIconSVG(notif.icon, notif.state, notif.merged, notif.conclusion, notif.state_reason)}
    </div>
    <div class="notification-content">
      <div class="notification-main">
        <div class="notification-title" data-title="${escapeAttr(notif.title)}${releaseBody ? `\n\n${escapeAttr(releaseBody)}` : ''}"${showHoverCards ? '' : ` title="${escapeAttr(notif.title)}${releaseBody ? `\n\n${escapeAttr(releaseBody)}` : ''}"`}>
          ${notif.number !== undefined ? `<span class="notification-number">#${notif.number}</span> ` : ''}${escapeHtml(notif.title)}${releaseBody ? ` <span class="notification-preview">${escapeHtml(truncatedBody)}${releaseBody.length > 200 ? '...' : ''}</span>` : ''}
        </div>
      </div>
      <div class="notification-meta">
        ${
          notif.comment_count !== undefined && notif.comment_count > 0
            ? `
          <span class="notification-comments"${notif.comment_count >= 100 ? ` title="${notif.comment_count} comments"` : ''}>
            <svg viewBox="0 0 16 16" width="12" height="12">
              <path fill="currentColor" d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
            </svg>
            ${notif.comment_count >= 100 ? '99+' : notif.comment_count}
          </span>
        `
            : ''
        }
        ${
          notif.author
            ? `
          <a class="author-profile-link" href="${escapeAttr(authorProfileUrl)}" target="_blank" rel="noopener noreferrer">
            <img src="${escapeAttr(notif.author.avatar_url)}" class="author-avatar" alt="${escapeAttr(notif.author.login)}" title="${escapeAttr(notif.author.login)}" />
          </a>
        `
            : ''
        }
        ${
          notif.updated_at
            ? `
          <span class="notification-time">${formatTimeAgo(notif.updated_at)}</span>
        `
            : ''
        }
      </div>
    </div>
    <div class="notification-actions">
      <button class="btn-mark-read" data-id="${notif.id}" title="Mark as read">
        ✓
      </button>
    </div>
    ${createHoverCard(notif)}
  `;

  // Add hover event listeners
  li.addEventListener('mouseenter', () => {
    if (getShowHoverCards()) {
      positionHoverCard(li);
    }
  });

  li.addEventListener('mouseleave', (e) => {
    if (getShowHoverCards()) {
      const card = li.querySelector('.notification-hover-card');
      if (card) {
        const cardRect = card.getBoundingClientRect();
        const isOverCard =
          e.clientX >= cardRect.left &&
          e.clientX <= cardRect.right &&
          e.clientY >= cardRect.top &&
          e.clientY <= cardRect.bottom;
        if (!isOverCard) {
          card.classList.remove('visible');
        }
      }
    }
  });

  // Hover card mouse events
  const hoverCard = li.querySelector('.notification-hover-card');
  if (hoverCard) {
    hoverCard.addEventListener('mouseenter', () => {
      if (getShowHoverCards()) {
        hoverCard.classList.add('visible');
      }
    });
    hoverCard.addEventListener('mouseleave', () => {
      if (getShowHoverCards()) {
        hoverCard.classList.remove('visible');
      }
    });
    hoverCard.addEventListener('click', (e) => {
      const interactiveTarget = e.target.closest('a, button, [role="button"], [data-clickable]');
      if (!interactiveTarget) {
        e.stopPropagation();
        e.preventDefault();
      }
    });
  }

  // Click to open notification
  li.addEventListener('click', async (e) => {
    if (e.target.closest('.btn-mark-read') || e.target.closest('a')) {
      return;
    }
    await sendMessage(MESSAGE_TYPES.OPEN_NOTIFICATION, { notificationId: notif.id });
    window.close();
  });

  // Mark as read button with optimistic update
  const markReadBtn = li.querySelector('.btn-mark-read');
  markReadBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    if (li.classList.contains('marking-read')) {
      return;
    }

    li.classList.add('marking-read');
    markReadBtn.disabled = true;
    markReadBtn.textContent = '✓';

    // Track user action
    const animationDuration = ANIMATION_DURATION.FADE_OUT + ANIMATION_DURATION.SLIDE_UP;
    onUserAction(animationDuration);

    li.classList.add('fade-out');

    const originalParent = li.parentElement;
    const originalNextSibling = li.nextSibling;

    const slideUpTimeout = setTimeout(() => {
      li.classList.add('slide-up');

      const removeTimeout = setTimeout(() => {
        li.remove();

        // Check if any notifications from this group remain
        const groupItems = notificationsList.querySelectorAll('.notification-item[data-id]');
        let hasNotificationsInGroup = false;

        for (const item of groupItems) {
          const itemId = item.dataset.id;
          const itemNotif = notifications.find((n) => n.id === itemId);
          if (itemNotif && itemNotif.repository.full_name === repoFullName) {
            hasNotificationsInGroup = true;
            break;
          }
        }

        if (!hasNotificationsInGroup && repoHeader) {
          repoHeader.remove();
        }

        const remaining = notificationsList.querySelectorAll('.notification-item').length;
        if (remaining === 0) {
          emptyState.hidden = false;
          markAllBtn.disabled = true;
        }
      }, ANIMATION_DURATION.SLIDE_UP);

      li.dataset.removeTimeout = removeTimeout;
    }, ANIMATION_DURATION.FADE_OUT);

    li.dataset.slideUpTimeout = slideUpTimeout;

    // Restore the notification item to its original state on failure
    function restoreItem() {
      clearTimeout(slideUpTimeout);
      if (li.dataset.removeTimeout) {
        clearTimeout(parseInt(li.dataset.removeTimeout));
      }

      li.classList.remove('marking-read', 'fade-out', 'slide-up');
      markReadBtn.disabled = false;
      markReadBtn.textContent = '✓';

      if (!li.parentElement) {
        if (originalNextSibling && originalNextSibling.parentElement) {
          originalParent.insertBefore(li, originalNextSibling);
        } else {
          originalParent.appendChild(li);
        }
        emptyState.hidden = true;
        markAllBtn.disabled = false;
      }

      li.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
      setTimeout(() => {
        li.style.backgroundColor = '';
      }, ANIMATION_DURATION.ERROR_BACKGROUND_FADE);
    }

    try {
      const result = await sendMessage(MESSAGE_TYPES.MARK_AS_READ, { notificationId: notif.id });

      if (!result.success) {
        restoreItem();
      }
    } catch (error) {
      console.error('Failed to mark as read:', error);
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
export function renderNotifications(notifications, shouldResort = true) {
  const { notificationsList, emptyState, markAllBtn } = config;

  // Check if notifications have actually changed
  const notificationsHash = createNotificationsHash(notifications);
  if (cachedNotificationsHash === notificationsHash) {
    return;
  }

  cachedNotifications = notifications;
  cachedNotificationsHash = notificationsHash;

  // Clear old hover cards
  document.querySelectorAll('.notification-hover-card').forEach((card) => card.remove());

  notificationsList.innerHTML = '';

  if (!notifications || notifications.length === 0) {
    emptyState.hidden = false;
    markAllBtn.disabled = true;
    return;
  }

  emptyState.hidden = true;
  markAllBtn.disabled = false;

  // Group notifications by repository
  const groupedByRepo = {};
  for (const notif of notifications) {
    const repoFullName = notif.repository.full_name;
    const notifTime = new Date(notif.updated_at).getTime();

    if (!groupedByRepo[repoFullName]) {
      groupedByRepo[repoFullName] = {
        repo: notif.repository,
        notifications: [],
        latestNotifTime: notifTime,
      };
    }

    groupedByRepo[repoFullName].notifications.push(notif);

    if (notifTime > groupedByRepo[repoFullName].latestNotifTime) {
      groupedByRepo[repoFullName].latestNotifTime = notifTime;
    }
  }

  // Sort repos by latest notification time
  let sortedRepos;
  if (shouldResort) {
    sortedRepos = Object.keys(groupedByRepo).sort((a, b) => {
      return groupedByRepo[b].latestNotifTime - groupedByRepo[a].latestNotifTime;
    });
    cachedRepoOrder = sortedRepos;
  } else {
    const currentRepos = new Set(Object.keys(groupedByRepo));
    sortedRepos = cachedRepoOrder.filter((repo) => currentRepos.has(repo));
    const cachedSet = new Set(cachedRepoOrder);
    const newRepos = Object.keys(groupedByRepo).filter((repo) => !cachedSet.has(repo));
    if (newRepos.length > 0) {
      sortedRepos = [...sortedRepos, ...newRepos];
    }
  }

  // Render each repository group
  for (const repoFullName of sortedRepos) {
    const group = groupedByRepo[repoFullName];

    const repoHeader = document.createElement('a');
    repoHeader.className = 'repo-group-header';
    repoHeader.href = group.repo.html_url;
    repoHeader.target = '_blank';
    repoHeader.rel = 'noopener noreferrer';
    repoHeader.dataset.repo = repoFullName; // For identifying repository
    repoHeader.innerHTML = `
      <div class="repo-info">
        <svg viewBox="0 0 16 16" width="14" height="14" class="repo-icon">
          <path fill="currentColor" d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/>
        </svg>
        <span class="repo-name">${escapeHtml(repoFullName)}</span>
      </div>
      <div class="repo-actions">
        <span class="repo-count">${group.notifications.length}</span>
        <button class="repo-mark-read-btn" title="Mark all notifications in this repository as read" aria-label="Mark repository as read">
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/>
          </svg>
        </button>
      </div>
    `;

    // Add event listener for mark as read button
    const markReadBtn = repoHeader.querySelector('.repo-mark-read-btn');
    markReadBtn.addEventListener('click', (e) => {
      e.preventDefault(); // Prevent <a> default navigation
      e.stopPropagation(); // Stop event bubbling
      config.onMarkRepoAsRead(repoFullName);
    });

    notificationsList.appendChild(repoHeader);

    for (const notif of group.notifications) {
      const li = createNotificationItem(notif, repoHeader, repoFullName, notifications);
      notificationsList.appendChild(li);
    }
  }
}
