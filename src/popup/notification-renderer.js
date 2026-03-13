/**
 * Notification rendering module for popup
 */

import { ANIMATION_DURATION, NOTIFICATION_TYPES, MESSAGE_TYPES, TIME_CONVERSION } from '../lib/constants.js';
import { formatReason, getNotificationStatus } from '../lib/format-utils.js';
import { getIconSVGElement } from '../lib/icons.js';

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
 * Create hover card element for a notification
 * @param {Object} notif - Notification object
 * @returns {HTMLElement} Hover card element
 */
export function createHoverCard(notif) {
  const hasAuthor = notif.author?.login;
  const hasComments = notif.comment_count > 0;
  const hasDescription = notif.body?.trim();
  const authorProfileUrl = hasAuthor ? buildAuthorProfileUrl(notif.author.login) : null;

  const card = document.createElement('div');
  card.className = 'notification-hover-card';

  // Header with author info
  if (hasAuthor) {
    const header = document.createElement('div');
    header.className = 'hover-card-header';

    const profileLink = document.createElement('a');
    profileLink.className = 'hover-card-profile-link';
    profileLink.href = authorProfileUrl;
    profileLink.target = '_blank';
    profileLink.rel = 'noopener noreferrer';

    const avatar = document.createElement('img');
    avatar.src = notif.author.avatar_url;
    avatar.alt = notif.author.login;
    avatar.className = 'hover-card-avatar';

    const authorDiv = document.createElement('div');
    authorDiv.className = 'hover-card-author';

    const authorName = document.createElement('div');
    authorName.className = 'hover-card-author-name';
    authorName.textContent = notif.author.login;

    authorDiv.appendChild(authorName);
    profileLink.appendChild(avatar);
    profileLink.appendChild(authorDiv);
    header.appendChild(profileLink);
    card.appendChild(header);
  }

  // Body with metadata
  const body = document.createElement('div');
  body.className = 'hover-card-body';

  const meta = document.createElement('div');
  meta.className = 'hover-card-meta';

  const reasonSpan = document.createElement('span');
  reasonSpan.className = 'hover-card-reason';
  reasonSpan.textContent = formatReason(notif.reason);
  meta.appendChild(reasonSpan);

  meta.appendChild(document.createTextNode(' · '));

  const fullTime = new Date(notif.updated_at).toLocaleString();
  const timeSpan = document.createElement('span');
  timeSpan.title = fullTime;
  timeSpan.textContent = formatTimeAgo(notif.updated_at);
  meta.appendChild(timeSpan);

  if (hasComments) {
    meta.appendChild(document.createTextNode(' · '));
    const commentsText = document.createTextNode(formatCommentCount(notif.comment_count));
    meta.appendChild(commentsText);
  }

  body.appendChild(meta);
  card.appendChild(body);

  // Description
  if (hasDescription) {
    const description = document.createElement('div');
    description.className = 'hover-card-description';
    description.textContent = notif.body.trim();
    card.appendChild(description);
  }

  return card;
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
 * @returns {HTMLElement} Notification list item element
 */
function createNotificationItem(notif, repoHeader, repoFullName) {
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

  // Create notification icon container
  const iconDiv = document.createElement('div');
  iconDiv.className = `notification-icon ${iconClass}`;
  iconDiv.title = getNotificationStatus(notif);
  iconDiv.appendChild(getIconSVGElement(notif.icon, notif.state, notif.merged, notif.conclusion, notif.state_reason));

  // Create notification content container
  const contentDiv = document.createElement('div');
  contentDiv.className = 'notification-content';

  // Create main content area
  const mainDiv = document.createElement('div');
  mainDiv.className = 'notification-main';

  const titleDiv = document.createElement('div');
  titleDiv.className = 'notification-title';
  const fullTitle = releaseBody ? `${notif.title}\n\n${releaseBody}` : notif.title;
  titleDiv.dataset.title = fullTitle;
  if (!showHoverCards) {
    titleDiv.title = fullTitle;
  }

  if (notif.number !== undefined) {
    const numberSpan = document.createElement('span');
    numberSpan.className = 'notification-number';
    numberSpan.textContent = `#${notif.number}`;
    titleDiv.appendChild(numberSpan);
    titleDiv.appendChild(document.createTextNode(' '));
  }

  titleDiv.appendChild(document.createTextNode(notif.title));

  if (releaseBody) {
    const previewSpan = document.createElement('span');
    previewSpan.className = 'notification-preview';
    previewSpan.textContent = ` ${truncatedBody}${releaseBody.length > 200 ? '...' : ''}`;
    titleDiv.appendChild(previewSpan);
  }

  mainDiv.appendChild(titleDiv);
  contentDiv.appendChild(mainDiv);

  // Create metadata area
  const metaDiv = document.createElement('div');
  metaDiv.className = 'notification-meta';

  // Comment count
  if (notif.comment_count !== undefined && notif.comment_count > 0) {
    const commentsSpan = document.createElement('span');
    commentsSpan.className = 'notification-comments';
    if (notif.comment_count >= 100) {
      commentsSpan.title = `${notif.comment_count} comments`;
    }
    commentsSpan.appendChild(getIconSVGElement('comment_bubble'));
    commentsSpan.appendChild(document.createTextNode(' '));
    commentsSpan.appendChild(document.createTextNode(notif.comment_count >= 100 ? '99+' : String(notif.comment_count)));
    metaDiv.appendChild(commentsSpan);
  }

  // Author avatar
  if (notif.author) {
    const authorLink = document.createElement('a');
    authorLink.className = 'author-profile-link';
    authorLink.href = authorProfileUrl;
    authorLink.target = '_blank';
    authorLink.rel = 'noopener noreferrer';

    const authorImg = document.createElement('img');
    authorImg.src = notif.author.avatar_url;
    authorImg.className = 'author-avatar';
    authorImg.alt = notif.author.login;
    authorImg.title = notif.author.login;

    authorLink.appendChild(authorImg);
    metaDiv.appendChild(authorLink);
  }

  // Update time
  if (notif.updated_at) {
    const timeSpan = document.createElement('span');
    timeSpan.className = 'notification-time';
    timeSpan.title = new Date(notif.updated_at).toLocaleString();
    timeSpan.textContent = formatTimeAgo(notif.updated_at);
    metaDiv.appendChild(timeSpan);
  }

  contentDiv.appendChild(metaDiv);

  // Create actions container
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'notification-actions';

  const markReadBtn = document.createElement('button');
  markReadBtn.className = 'btn-mark-read';
  markReadBtn.dataset.id = String(notif.id);
  markReadBtn.title = 'Mark as read';
  markReadBtn.textContent = '✓';

  actionsDiv.appendChild(markReadBtn);

  // Create hover card
  const hoverCard = createHoverCard(notif);

  // Assemble the notification item
  li.appendChild(iconDiv);
  li.appendChild(contentDiv);
  li.appendChild(actionsDiv);
  li.appendChild(hoverCard);

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

  // Click to open notification
  li.addEventListener('click', async (e) => {
    if (e.target.closest('.btn-mark-read') || e.target.closest('a')) {
      return;
    }
    await sendMessage(MESSAGE_TYPES.OPEN_NOTIFICATION, { notificationId: notif.id });
    window.close();
  });

  // Mark as read button with immediate visual feedback
  markReadBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    if (li.classList.contains('marking-read')) {
      return;
    }

    li.classList.add('marking-read');
    markReadBtn.disabled = true;
    markReadBtn.textContent = '✓';

    // Track user action
    const animationDuration = ANIMATION_DURATION.FADE_OUT;
    onUserAction(animationDuration);

    // Force reflow so ::after pseudo-element starts at opacity 0
    // eslint-disable-next-line no-unused-expressions
    li.offsetHeight;
    li.classList.add('fade-out');

    // Restore the notification item to its original state on failure
    function restoreItem() {
      li.classList.remove('marking-read', 'fade-out');
      markReadBtn.disabled = false;
      markReadBtn.textContent = '✓';

      li.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
      setTimeout(() => {
        li.style.backgroundColor = '';
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
        const escapedRepo = CSS.escape(repoFullName);
        const remainingInGroup = notificationsList.querySelectorAll(`.notification-item[data-repo="${escapedRepo}"]`);

        if (remainingInGroup.length === 0 && repoHeader) {
          repoHeader.remove();
        } else if (repoHeader) {
          const repoCountSpan = repoHeader.querySelector('.repo-count');
          if (repoCountSpan) {
            repoCountSpan.textContent = String(remainingInGroup.length);
          }
        }

        const remaining = notificationsList.querySelectorAll('.notification-item').length;
        if (remaining === 0) {
          emptyState.hidden = false;
          markAllBtn.disabled = true;
        }
      } else {
        // Failure: restore item
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

  notificationsList.replaceChildren();

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

    // Create repo info section
    const repoInfoDiv = document.createElement('div');
    repoInfoDiv.className = 'repo-info';

    const repoIconSvg = getIconSVGElement('repo');
    repoIconSvg.setAttribute('width', '14');
    repoIconSvg.setAttribute('height', '14');
    repoIconSvg.classList.add('repo-icon');
    repoInfoDiv.appendChild(repoIconSvg);

    const repoNameSpan = document.createElement('span');
    repoNameSpan.className = 'repo-name';
    repoNameSpan.textContent = repoFullName;
    repoInfoDiv.appendChild(repoNameSpan);

    // Create repo actions section
    const repoActionsDiv = document.createElement('div');
    repoActionsDiv.className = 'repo-actions';

    const repoCountSpan = document.createElement('span');
    repoCountSpan.className = 'repo-count';
    repoCountSpan.textContent = String(group.notifications.length);
    repoActionsDiv.appendChild(repoCountSpan);

    const markReadBtn = document.createElement('button');
    markReadBtn.className = 'repo-mark-read-btn';
    markReadBtn.title = 'Mark all notifications in this repository as read';
    markReadBtn.setAttribute('aria-label', 'Mark repository as read');

    const checkmarkSvg = getIconSVGElement('checkmark');
    markReadBtn.appendChild(checkmarkSvg);
    repoActionsDiv.appendChild(markReadBtn);

    repoHeader.appendChild(repoInfoDiv);
    repoHeader.appendChild(repoActionsDiv);

    // Add event listener for mark as read button
    markReadBtn.addEventListener('click', (e) => {
      e.preventDefault(); // Prevent <a> default navigation
      e.stopPropagation(); // Stop event bubbling
      config.onMarkRepoAsRead(repoFullName);
    });

    notificationsList.appendChild(repoHeader);

    for (const notif of group.notifications) {
      const li = createNotificationItem(notif, repoHeader, repoFullName);
      notificationsList.appendChild(li);
    }
  }
}
