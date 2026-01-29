/**
 * Popup script for GitHub Notifier
 */

import * as storage from '../lib/storage.js';
import { storage as browserStorage, alarms, runtime, tabs } from '../lib/chrome-api.js';
import {
  ANIMATION_DURATION,
  TOKEN_PREFIXES,
  MESSAGE_TYPES,
  MIN_POPUP_WIDTH,
  MAX_POPUP_WIDTH,
  POPUP_WIDTH_STEP,
  TIMING_THRESHOLDS,
  TIME_CONVERSION
} from '../lib/constants.js';
import { applyTheme } from '../lib/theme.js';
import { formatReason, formatType, getNotificationStatus } from '../lib/format-utils.js';

// Elements
const loginView = document.getElementById('login-view');
const mainView = document.getElementById('main-view');

// Cache for notifications to avoid unnecessary re-renders
let cachedNotifications = null;
let cachedNotificationsJSON = null;
let cachedRepoOrder = []; // Cache repo order to prevent resorting on mark-as-read

// Auth method selection
const authMethods = document.getElementById('auth-methods');
const oauthMethod = document.getElementById('oauth-method');
const patMethod = document.getElementById('pat-method');
const patInputForm = document.getElementById('pat-input-form');
const patInput = document.getElementById('pat-input');
const patCancelBtn = document.getElementById('pat-cancel-btn');
const patLoginBtn = document.getElementById('pat-login-btn');

// Main view elements
const settingsIconBtn = document.getElementById('settings-icon-btn');
const refreshBtn = document.getElementById('refresh-btn');
const markAllBtn = document.getElementById('mark-all-btn');
const usernameEl = document.getElementById('username');
const notificationsList = document.getElementById('notifications-list');
const emptyState = document.getElementById('empty-state');

// Settings view elements
const settingsView = document.getElementById('settings-view');
const settingsBackBtn = document.getElementById('settings-back-btn');
const themeSelect = document.getElementById('theme-select');
const settingsLogoutBtn = document.getElementById('settings-logout-btn');
const settingsUsernameEl = document.getElementById('settings-username');
const notificationsContainer = document.getElementById('notifications-container');
const refreshCountdownEl = document.getElementById('refresh-countdown');

// Popup size controls
const popupWidthInput = document.getElementById('popup-width-input');
const widthDecreaseBtn = document.getElementById('width-decrease');
const widthIncreaseBtn = document.getElementById('width-increase');

// Hover cards toggle
const hoverCardsToggle = document.getElementById('hover-cards-toggle');

// Desktop notification settings
const desktopNotificationsToggle = document.getElementById('desktop-notifications-toggle');

// Store hover cards setting
let showHoverCards = true;

/**
 * Update countdown timer
 */
let countdownInterval = null;
let lastAlarmTime = null;

async function updateCountdown() {
  try {
    const allAlarms = await alarms.getAll();
    const notificationAlarm = allAlarms.find(a => a.name === 'check-notifications');

    if (!notificationAlarm || !notificationAlarm.scheduledTime) {
      refreshCountdownEl.textContent = '';
      lastAlarmTime = null;
      return;
    }

    const now = Date.now();
    const remaining = notificationAlarm.scheduledTime - now;

    // Detect alarm reset (when scheduledTime jumps to a future time)
    if (lastAlarmTime && notificationAlarm.scheduledTime > lastAlarmTime + TIMING_THRESHOLDS.ALARM_RESET_DETECTION) {
      // Alarm was reset, don't show the jump
      // Just update to the new time smoothly
    }
    lastAlarmTime = notificationAlarm.scheduledTime;

    if (remaining <= 0) {
      refreshCountdownEl.textContent = '';
      return;
    }

    const seconds = Math.ceil(remaining / 1000);
    refreshCountdownEl.textContent = `${seconds}s`;
  } catch (error) {
    console.error('Error updating countdown:', error);
    refreshCountdownEl.textContent = '';
  }
}

function startCountdown() {
  updateCountdown();
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
  countdownInterval = setInterval(updateCountdown, ANIMATION_DURATION.COUNTDOWN_INTERVAL);
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  refreshCountdownEl.textContent = '';
}

/**
 * Show settings view
 */
async function showSettings() {
  // Load current theme
  const theme = await storage.getTheme();
  themeSelect.value = theme;

  // Load and display username
  const username = await storage.getUsername();
  if (settingsUsernameEl && username) {
    settingsUsernameEl.textContent = username;
  }

  // Load hover cards setting
  const showCards = await storage.getShowHoverCards();
  hoverCardsToggle.checked = showCards;

  // Load desktop notification settings
  const enableDesktopNotifications = await storage.getEnableDesktopNotifications();
  desktopNotificationsToggle.checked = enableDesktopNotifications;

  // Hide header and footer
  document.querySelector('.header').hidden = true;
  document.querySelector('.footer').hidden = true;

  // Show settings view
  notificationsContainer.hidden = true;
  settingsView.hidden = false;
}

/**
 * Hide settings view
 */
function hideSettings() {
  // Show header and footer
  document.querySelector('.header').hidden = false;
  document.querySelector('.footer').hidden = false;

  settingsView.hidden = true;
  notificationsContainer.hidden = false;
}

/**
 * Handle theme change
 */
async function handleThemeChange() {
  const theme = themeSelect.value;

  // Save to storage
  await storage.setTheme(theme);

  // Apply theme immediately
  applyTheme(theme);
}

/**
 * Handle popup width change
 */
async function handleWidthChange() {
  let width = parseInt(popupWidthInput.value, 10);
  if (isNaN(width)) width = MIN_POPUP_WIDTH;

  // Validate range
  if (width < MIN_POPUP_WIDTH) width = MIN_POPUP_WIDTH;
  if (width > MAX_POPUP_WIDTH) width = MAX_POPUP_WIDTH;

  popupWidthInput.value = width;
  document.body.style.width = `${width}px`;

  // Save to storage
  await storage.setPopupWidth(width);
}

/**
 * Decrease width
 */
async function decreaseWidth() {
  const currentWidth = parseInt(popupWidthInput.value, 10);
  const newWidth = Math.max(MIN_POPUP_WIDTH, currentWidth - POPUP_WIDTH_STEP);
  popupWidthInput.value = newWidth;
  await handleWidthChange();
}

/**
 * Increase width
 */
async function increaseWidth() {
  const currentWidth = parseInt(popupWidthInput.value, 10);
  const newWidth = Math.min(MAX_POPUP_WIDTH, currentWidth + POPUP_WIDTH_STEP);
  popupWidthInput.value = newWidth;
  await handleWidthChange();
}

/**
 * Apply saved popup size
 */
async function applyPopupSize() {
  const width = await storage.getPopupWidth();

  document.body.style.width = `${width}px`;

  // Update input value
  popupWidthInput.value = width;
}

/**
 * Send message to background script
 */
async function sendMessage(action, data = {}) {
  return runtime.sendMessage({ action, ...data });
}

/**
 * Show a specific view
 */
async function showView(view) {
  loginView.hidden = view !== 'login';
  mainView.hidden = view !== 'main';

  // Apply different widths for different views
  if (view === 'login') {
    // Fixed width for login view
    document.body.style.width = '400px';
  } else if (view === 'main') {
    // Use saved width for main view
    const width = await storage.getPopupWidth();
    document.body.style.width = `${width}px`;
  }
}

/**
 * Render notifications list (grouped by repository)
 * Optimized with caching to avoid unnecessary re-renders
 * @param {Array} notifications - Array of notification objects
 * @param {boolean} shouldResort - Whether to re-sort repos by time (true on refresh, false on mark-as-read)
 */
function renderNotifications(notifications, shouldResort = true) {
  // Check if notifications have actually changed
  const notificationsJSON = JSON.stringify(notifications);
  if (cachedNotificationsJSON === notificationsJSON) {
    // Data hasn't changed, skip re-render
    return;
  }

  // Update cache
  cachedNotifications = notifications;
  cachedNotificationsJSON = notificationsJSON;

  // Clear old hover cards
  document.querySelectorAll('.notification-hover-card').forEach(card => card.remove());

  notificationsList.innerHTML = '';

  if (!notifications || notifications.length === 0) {
    emptyState.hidden = false;
    markAllBtn.disabled = true;
    return;
  }

  emptyState.hidden = true;
  markAllBtn.disabled = false;

  // Group notifications by repository and track latest time
  const groupedByRepo = {};
  for (const notif of notifications) {
    const repoFullName = notif.repository.full_name;
    const notifTime = new Date(notif.updated_at).getTime();

    if (!groupedByRepo[repoFullName]) {
      groupedByRepo[repoFullName] = {
        repo: notif.repository,
        notifications: [],
        latestNotifTime: notifTime, // Initialize with first notification
      };
    }

    groupedByRepo[repoFullName].notifications.push(notif);

    // Update latest time if this notification is newer
    if (notifTime > groupedByRepo[repoFullName].latestNotifTime) {
      groupedByRepo[repoFullName].latestNotifTime = notifTime;
    }
  }

  // Sort repos by latest notification's time (most recent first)
  let sortedRepos;
  if (shouldResort) {
    // Re-sort repos by time (on refresh)
    sortedRepos = Object.keys(groupedByRepo).sort((a, b) => {
      const timeA = groupedByRepo[a].latestNotifTime;
      const timeB = groupedByRepo[b].latestNotifTime;
      return timeB - timeA; // Descending order (newest first)
    });
    // Cache the new order
    cachedRepoOrder = sortedRepos;
  } else {
    // Filter cached order to only include repos that still have notifications
    const currentRepos = new Set(Object.keys(groupedByRepo));
    sortedRepos = cachedRepoOrder.filter(repo => currentRepos.has(repo));
    // Add any new repos that weren't in the cache (shouldn't happen often)
    const cachedSet = new Set(cachedRepoOrder);
    const newRepos = Object.keys(groupedByRepo).filter(repo => !cachedSet.has(repo));
    if (newRepos.length > 0) {
      sortedRepos = [...sortedRepos, ...newRepos];
    }
  }

  // Render each repository group
  for (const repoFullName of sortedRepos) {
    const group = groupedByRepo[repoFullName];

    // Create repo header (clickable)
    const repoHeader = document.createElement('a');
    repoHeader.className = 'repo-group-header';
    repoHeader.href = group.repo.html_url;
    repoHeader.target = '_blank';
    repoHeader.rel = 'noopener noreferrer';
    repoHeader.innerHTML = `
      <div class="repo-info">
        <svg viewBox="0 0 16 16" width="14" height="14" class="repo-icon">
          <path fill="currentColor" d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/>
        </svg>
        <span class="repo-name">${escapeHtml(repoFullName)}</span>
      </div>
      <span class="repo-count">${group.notifications.length}</span>
    `;
    notificationsList.appendChild(repoHeader);

    // Render notifications in this group
    for (const notif of group.notifications) {
      const li = document.createElement('li');
      li.className = 'notification-item';
      li.dataset.id = notif.id;

      // Build icon class with state information
      let iconClass = notif.icon;
      if (notif.icon === 'pr' || notif.icon === 'issue') {
        if (notif.merged) {
          iconClass += ' merged';
        } else if (notif.state) {
          iconClass += ` ${notif.state}`;
        }
      }

      // Pre-compute release body for performance
      const releaseBody = notif.type === 'Release' && notif.body ? notif.body.trim() : '';

      li.innerHTML = `
        <div class="notification-icon ${iconClass}" title="${escapeAttr(getNotificationStatus(notif))}">
          ${getIconSVG(notif.icon, notif.state, notif.merged, notif.conclusion)}
        </div>
        <div class="notification-content">
          <div class="notification-main">
            <div class="notification-title" data-title="${escapeAttr(notif.title)}${releaseBody ? '\n\n' + escapeAttr(releaseBody) : ''}"${showHoverCards ? '' : ` title="${escapeAttr(notif.title)}${releaseBody ? '\n\n' + escapeAttr(releaseBody) : ''}"`}>
              ${notif.number !== undefined ? `<span class="notification-number">#${notif.number}</span> ` : ''}${escapeHtml(notif.title)}${releaseBody ? ` <span class="notification-preview">${escapeHtml(releaseBody.substring(0, 200))}${releaseBody.length > 200 ? '...' : ''}</span>` : ''}
            </div>
          </div>
          <div class="notification-meta">
            ${notif.comment_count !== undefined && notif.comment_count > 0 ? `
              <span class="notification-comments">
                <svg viewBox="0 0 16 16" width="12" height="12">
                  <path fill="currentColor" d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
                </svg>
                ${notif.comment_count}
              </span>
            ` : ''}
            ${notif.author ? `
              <img src="${escapeAttr(notif.author.avatar_url)}" class="author-avatar" alt="${escapeHtml(notif.author.login)}" title="${escapeHtml(notif.author.login)}" />
            ` : ''}
            ${notif.created_at || notif.updated_at ? `
              <span class="notification-time">${formatTimeAgo(notif.created_at || notif.updated_at)}</span>
            ` : ''}
          </div>
        </div>
        <div class="notification-actions">
          <button class="btn-mark-read" data-id="${notif.id}" title="Mark as read">
            ✓
          </button>
        </div>
        ${createHoverCard(notif)}
      `;

      // Add hover event listeners - they check showHoverCards flag
      li.addEventListener('mouseenter', () => {
        if (showHoverCards) {
          positionHoverCard(li);
        }
      });
      li.addEventListener('mouseleave', (e) => {
        if (showHoverCards) {
          const card = li.querySelector('.notification-hover-card');
          if (card) {
            // Only hide if not hovering over the card itself
            const cardRect = card.getBoundingClientRect();
            const mouseX = e.clientX;
            const mouseY = e.clientY;

            // Check if mouse is over the hover card
            const isOverCard = mouseX >= cardRect.left && mouseX <= cardRect.right &&
                             mouseY >= cardRect.top && mouseY <= cardRect.bottom;

            if (!isOverCard) {
              card.classList.remove('visible');
            }
          }
        }
      });

      // Add hover card mouse events to keep it visible while interacting
      const hoverCard = li.querySelector('.notification-hover-card');
      if (hoverCard) {
        hoverCard.addEventListener('mouseenter', () => {
          if (showHoverCards) {
            hoverCard.classList.add('visible');
          }
        });
        hoverCard.addEventListener('mouseleave', () => {
          if (showHoverCards) {
            hoverCard.classList.remove('visible');
          }
        });
      }

      // Click to open notification (but not on mark as read button)
      li.addEventListener('click', (e) => {
        // Don't open if clicking the mark as read button
        if (e.target.closest('.btn-mark-read')) {
          return;
        }
        openNotification(notif.id);
      });

      // Mark as read button with optimistic update
      const markReadBtn = li.querySelector('.btn-mark-read');
      markReadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        // Prevent multiple clicks
        if (li.classList.contains('marking-read')) {
          return;
        }

        // Immediate animation - optimistic update
        li.classList.add('marking-read');
        markReadBtn.disabled = true;
        markReadBtn.textContent = '✓';

        // Start fade-out animation immediately (don't wait for API)
        li.classList.add('fade-out');

        // Store original state for potential rollback
        const originalParent = li.parentElement;
        const originalNextSibling = li.nextSibling;

        // After fade-out, start slide-up animation
        const slideUpTimeout = setTimeout(() => {
          li.classList.add('slide-up');

          // Remove element after slide-up completes
          const removeTimeout = setTimeout(() => {
            li.remove();

            // Check if this was the last notification in the group
            const groupItems = notificationsList.querySelectorAll(`.notification-item[data-id]`);
            const groupHeader = repoHeader;
            let hasNotificationsInGroup = false;

            // Check if any notifications from this group remain
            for (const item of groupItems) {
              const itemId = item.dataset.id;
              const itemNotif = notifications.find(n => n.id === itemId);
              if (itemNotif && itemNotif.repository.full_name === repoFullName) {
                hasNotificationsInGroup = true;
                break;
              }
            }

            // Remove group header if no notifications remain
            if (!hasNotificationsInGroup && groupHeader) {
              groupHeader.remove();
            }

            // Check if list is now empty
            const remaining = notificationsList.querySelectorAll('.notification-item').length;
            if (remaining === 0) {
              emptyState.hidden = false;
              markAllBtn.disabled = true;
            }
          }, ANIMATION_DURATION.SLIDE_UP); // Slide-up duration

          // Store timeout ID for potential cancellation
          li.dataset.removeTimeout = removeTimeout;
        }, ANIMATION_DURATION.FADE_OUT); // Fade-out duration

        // Store timeout ID for potential cancellation
        li.dataset.slideUpTimeout = slideUpTimeout;

        // Send API request in parallel with animation
        try {
          const result = await sendMessage(MESSAGE_TYPES.MARK_AS_READ, { notificationId: notif.id });

          if (!result.success) {
            // API failed - rollback the animation
            clearTimeout(slideUpTimeout);
            if (li.dataset.removeTimeout) {
              clearTimeout(parseInt(li.dataset.removeTimeout));
            }

            // Restore the notification item
            li.classList.remove('marking-read', 'fade-out', 'slide-up');
            markReadBtn.disabled = false;
            markReadBtn.textContent = '✓';

            // Re-insert if already removed
            if (!li.parentElement) {
              if (originalNextSibling && originalNextSibling.parentElement) {
                originalParent.insertBefore(li, originalNextSibling);
              } else {
                originalParent.appendChild(li);
              }

              // Show notification list if it was hidden
              emptyState.hidden = true;
              markAllBtn.disabled = false;
            }

            // Show error feedback
            li.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
            setTimeout(() => {
              li.style.backgroundColor = '';
            }, 1000);
          }
          // If success, animation continues naturally
        } catch (error) {
          // Network error - rollback the animation
          console.error('Failed to mark as read:', error);

          clearTimeout(slideUpTimeout);
          if (li.dataset.removeTimeout) {
            clearTimeout(parseInt(li.dataset.removeTimeout));
          }

          // Restore the notification item
          li.classList.remove('marking-read', 'fade-out', 'slide-up');
          markReadBtn.disabled = false;
          markReadBtn.textContent = '✓';

          // Re-insert if already removed
          if (!li.parentElement) {
            if (originalNextSibling && originalNextSibling.parentElement) {
              originalParent.insertBefore(li, originalNextSibling);
            } else {
              originalParent.appendChild(li);
            }

            // Show notification list if it was hidden
            emptyState.hidden = true;
            markAllBtn.disabled = false;
          }

          // Show error feedback
          li.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
          setTimeout(() => {
            li.style.backgroundColor = '';
          }, ANIMATION_DURATION.ERROR_BACKGROUND_FADE);
        }
      });

      notificationsList.appendChild(li);
    }
  }
}

/**
 * SVG icons for different notification types
 */
const ICON_SVGS = {
  'issue_open': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>`,
  'issue_closed': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7 8.94 5.78 7.72a.75.75 0 0 0-1.06 1.06l1.75 1.75a.75.75 0 0 0 1.06 0l3.75-3.75Z"/><path fill="currentColor" d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z"/></svg>`,
  'pr_open': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>`,
  'pr_closed': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.716l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>`,
  'pr_merged': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0-.5.5.75.75 0 0 0 .5-.5Z"/></svg>`,
  'actions_success': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="#22863a" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>`,
  'actions_failure': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="#e85149" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>`,
  'actions_cancelled': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="#656d76" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm6.5 3.5a.751.751 0 0 1-.75-.75v-4.5a.75.75 0 0 1 1.5 0v4.5a.75.75 0 0 1-.75.75ZM8 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/></svg>`,
  'actions_skipped': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="#6a737d" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm9.78-2.22-5.5 5.5a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l5.5-5.5a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z"/></svg>`,
  'actions_pending': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="#6a737d" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>`,
  'release': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.752 1.752 0 0 1 1 7.775Zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25ZM6 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/></svg>`,
  'discussion': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M1.75 1h8.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 10.25 10H7.061l-2.574 2.573A1.458 1.458 0 0 1 2 11.543V10h-.25A1.75 1.75 0 0 1 0 8.25v-5.5C0 1.784.784 1 1.75 1ZM1.5 2.75v5.5c0 .138.112.25.25.25h1a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h3.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13 2a.25.25 0 0 0-.25-.25h-.5a.75.75 0 0 1 0-1.5h.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 14.25 12H14v1.543a1.458 1.458 0 0 1-2.487 1.03L9.22 12.28a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l2.22 2.22v-2.19a.75.75 0 0 1 .75-.75h1a.25.25 0 0 0 .25-.25Z"/></svg>`,
  'commit': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"/></svg>`,
  'alert': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>`,
  'repo': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/></svg>`,
  'notification': `<svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M8 16a2 2 0 0 0 1.985-1.75c.017-.137-.097-.25-.235-.25h-3.5c-.138 0-.252.113-.235.25A2 2 0 0 0 8 16ZM3 5a5 5 0 0 1 10 0v2.947c0 .05.015.098.042.139l1.703 2.555A1.519 1.519 0 0 1 13.482 13H2.518a1.516 1.516 0 0 1-1.263-2.36l1.703-2.554A.255.255 0 0 0 3 7.947Z"/></svg>`,
};

/**
 * Get SVG icon for notification type
 */
function getIconSVG(type, state, merged, conclusion) {
  const iconKeyMap = {
    'issue': () => state === 'closed' ? 'issue_closed' : 'issue_open',
    'pr': () => merged ? 'pr_merged' : (state === 'closed' ? 'pr_closed' : 'pr_open'),
    'actions': () => {
      const conclusionMap = {
        'success': 'actions_success',
        'failure': 'actions_failure',
        'cancelled': 'actions_cancelled',
        'skipped': 'actions_skipped',
      };
      return conclusionMap[conclusion] || 'actions_pending';
    },
  };

  const iconKey = iconKeyMap[type] ? iconKeyMap[type]() : type;
  return ICON_SVGS[iconKey] || ICON_SVGS['notification'];
}

/**
 * Position hover card smartly based on available space
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
  const margin = 0; // Small gap for easier mouse movement
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;

  const topPosition = spaceBelow >= cardHeight + margin
    ? rect.bottom + margin
    : (spaceAbove >= cardHeight + margin ? rect.top - cardHeight - margin : rect.bottom + margin);

  card.style.top = `${topPosition}px`;

  // Position card to align right edge with popup right edge (with some padding)
  const popupWidth = document.body.offsetWidth;
  card.style.right = '10px';
  card.style.left = 'auto';

  card.classList.add('visible');
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape HTML attributes to prevent XSS
 */
function escapeAttr(text) {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Format time ago (e.g., "2h ago", "3d ago")
 */
function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / TIME_CONVERSION.MS_TO_MINUTES);
  const diffHours = Math.floor(diffMs / (60 * TIME_CONVERSION.MS_TO_MINUTES));
  const diffDays = Math.floor(diffMs / (24 * 60 * TIME_CONVERSION.MS_TO_MINUTES));

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Create hover card HTML for a notification
 */
function createHoverCard(notif) {
  const hasAuthor = notif.author?.login;
  const hasComments = notif.comment_count > 0;
  const hasDescription = notif.body?.trim();

  // Build metadata line
  const metadataParts = [];
  metadataParts.push(`<span class="hover-card-reason">${formatReason(notif.reason)}</span>`);
  const fullTime = new Date(notif.updated_at).toLocaleString();
  metadataParts.push(`<span title="${fullTime}">${formatTimeAgo(notif.updated_at)}</span>`);
  if (hasComments) {
    metadataParts.push(`${notif.comment_count} comment${notif.comment_count > 1 ? 's' : ''}`);
  }

  return `
    <div class="notification-hover-card">
      ${hasAuthor ? `
        <div class="hover-card-header">
          <img src="${escapeHtml(notif.author.avatar_url)}" alt="${escapeHtml(notif.author.login)}" class="hover-card-avatar" />
          <div class="hover-card-author">
            <div class="hover-card-author-name">${escapeHtml(notif.author.login)}</div>
          </div>
        </div>
      ` : ''}
      <div class="hover-card-body">
        <div class="hover-card-meta">${metadataParts.join(' · ')}</div>
      </div>
      ${hasDescription ? `
        <div class="hover-card-description">${escapeHtml(notif.body.trim())}</div>
      ` : ''}
    </div>
  `;
}

/**
 * Open notification
 */
async function openNotification(id) {
  await sendMessage(MESSAGE_TYPES.OPEN_NOTIFICATION, { notificationId: id });
  window.close();
}

/**
 * Mark all as read
 */
async function markAllAsRead() {
  // Immediate visual feedback
  const originalText = markAllBtn.innerHTML;
  markAllBtn.disabled = true;
  markAllBtn.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" class="spinner-icon"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="30" stroke-dashoffset="0"><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1s" repeatCount="indefinite"/></circle></svg>`;

  try {
    const result = await sendMessage(MESSAGE_TYPES.MARK_ALL_AS_READ);
    if (result.success) {
      // Fade out all notifications
      const items = notificationsList.querySelectorAll('.notification-item');
      items.forEach((item, index) => {
        setTimeout(() => {
          item.style.transition = 'opacity 0.3s';
          item.style.opacity = '0';
        }, index * ANIMATION_DURATION.STAGGER_DELAY); // Stagger the animation
      });

      // Clear list after animation
      setTimeout(() => {
        notificationsList.innerHTML = '';
        emptyState.hidden = false;
        markAllBtn.disabled = true;
        markAllBtn.innerHTML = originalText;
      }, items.length * ANIMATION_DURATION.STAGGER_DELAY + 300);
    }
  } catch (error) {
    // Restore on error
    markAllBtn.disabled = false;
    markAllBtn.innerHTML = originalText;
    console.error('Failed to mark all as read:', error);
  }
}

/**
 * Refresh notifications
 */
async function refresh() {
  // Immediate visual feedback
  refreshBtn.disabled = true;
  refreshBtn.classList.add('spinning');

  // Temporarily hide countdown while refreshing
  const wasRunning = countdownInterval !== null;
  stopCountdown();

  try {
    await sendMessage(MESSAGE_TYPES.REFRESH);
    const state = await sendMessage(MESSAGE_TYPES.GET_STATE);
    renderNotifications(state.notifications, true); // Re-sort on refresh
  } catch (error) {
    console.error('Failed to refresh:', error);

    // Show appropriate error message based on error type
    const cachedNotifications = await storage.getNotifications();
    renderNotifications(cachedNotifications, true); // Re-sort even on error

    let message = '';
    let className = 'error-message';

    if (!navigator.onLine || error.message?.includes('NetworkError') || error.message?.includes('Failed to fetch')) {
      message = '⚠️ Offline - showing cached notifications';
      className = 'offline-message';
    } else if (error.message?.includes('timeout')) {
      message = '⏱ Request timeout - showing cached data';
      className = 'warning-message';
    } else if (error.message?.includes('Rate limited')) {
      message = '⏱ Rate limited - will retry automatically';
      className = 'warning-message';
    } else {
      message = `❌ Error: ${error.message || 'Failed to refresh'}`;
      className = 'error-message';
    }

    // Show error/warning message
    const msgEl = document.createElement('div');
    msgEl.className = className;
    msgEl.textContent = message;
    notificationsList.insertBefore(msgEl, notificationsList.firstChild);

    setTimeout(() => msgEl.remove(), 5000);
  } finally {
    setTimeout(() => {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('spinning');
      // Restart countdown after refresh
      if (wasRunning) {
        setTimeout(startCountdown, 100);
      }
    }, ANIMATION_DURATION.MIN_SPINNER_TIME); // Minimum spin time for visual feedback
  }
}

/**
 * Login
 */
async function login(authMethod = 'oauth', token = null) {
  const result = await sendMessage(MESSAGE_TYPES.LOGIN, { authMethod, token });

  if (result.success) {
    usernameEl.textContent = result.username;
    const state = await sendMessage(MESSAGE_TYPES.GET_STATE);
    renderNotifications(state.notifications, true); // Re-sort on login
    await showView('main');
    // Start countdown timer after successful login
    startCountdown();
  } else {
    alert('Login failed: ' + (result.error || 'Unknown error'));
  }
}

/**
 * Show PAT input form
 */
function showPATForm() {
  authMethods.hidden = true;
  patInputForm.hidden = false;
  patInput.value = '';
  patInput.focus();
}

/**
 * Hide PAT input form
 */
function hidePATForm() {
  authMethods.hidden = false;
  patInputForm.hidden = true;
  patInput.value = '';
}

/**
 * Handle PAT login
 */
async function handlePATLogin() {
  const token = patInput.value.trim();

  if (!token) {
    alert('Please enter a valid token');
    return;
  }

  if (!token.startsWith(TOKEN_PREFIXES[0]) && !token.startsWith(TOKEN_PREFIXES[1])) {
    alert(`Invalid token format. Token should start with "${TOKEN_PREFIXES[0]}" or "${TOKEN_PREFIXES[1]}"`);
    return;
  }

  patLoginBtn.disabled = true;
  patLoginBtn.textContent = 'Connecting...';

  try {
    await login('pat', token);
  } catch (error) {
    console.error('PAT login error:', error);
  } finally {
    patLoginBtn.disabled = false;
    patLoginBtn.textContent = 'Connect';
  }
}

/**
 * Handle OAuth login - Open Device Flow page
 */
async function handleOAuthLogin() {
  // Open Device Flow authorization page in a new tab
  const authUrl = runtime.getURL('src/auth/device-flow.html');
  tabs.create({ url: authUrl });

  // Close popup (optional - let user keep it open)
  // window.close();
}

/**
 * Logout
 */
async function logout() {
  stopCountdown();
  await sendMessage(MESSAGE_TYPES.LOGOUT);
  hideSettings();
  await showView('login');
}

/**
 * Pre-load theme before showing any view to prevent flash
 */
async function preloadTheme() {
  const theme = await storage.getTheme();
  applyTheme(theme);
}

/**
 * Initialize popup
 */
async function init() {
  // Apply saved popup width
  await applyPopupSize();

  // Load hover cards setting
  showHoverCards = await storage.getShowHoverCards();

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async (e) => {
    const currentTheme = await storage.getTheme();
    if (currentTheme === 'system') {
      applyTheme('system');
    }
  });

  const state = await sendMessage(MESSAGE_TYPES.GET_STATE);

  if (state.isAuthenticated) {
    // Set username with fallback
    const username = state.username || await storage.getUsername() || 'User';
    usernameEl.textContent = username;

    renderNotifications(state.notifications, true); // Re-sort on init
    await showView('main');
    // Start countdown timer for next refresh
    startCountdown();
  } else {
    await showView('login');
  }
}

// Event listeners
oauthMethod.addEventListener('click', handleOAuthLogin);
patMethod.addEventListener('click', showPATForm);
patCancelBtn.addEventListener('click', hidePATForm);
patLoginBtn.addEventListener('click', handlePATLogin);
patInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    handlePATLogin();
  }
});

// Settings
settingsIconBtn.addEventListener('click', showSettings);
settingsBackBtn.addEventListener('click', hideSettings);
themeSelect.addEventListener('change', handleThemeChange);
popupWidthInput.addEventListener('change', handleWidthChange);
popupWidthInput.addEventListener('blur', handleWidthChange);
widthDecreaseBtn.addEventListener('click', decreaseWidth);
widthIncreaseBtn.addEventListener('click', increaseWidth);
hoverCardsToggle.addEventListener('change', async () => {
  showHoverCards = hoverCardsToggle.checked;
  await storage.setShowHoverCards(showHoverCards);

  // Hide any currently visible hover cards when disabling
  if (!showHoverCards) {
    document.querySelectorAll('.notification-hover-card.visible').forEach(card => {
      card.classList.remove('visible');
    });
  }

  // Re-render to update title attributes based on new setting
  if (cachedNotifications) {
    // Force re-render by clearing cache
    const notifications = cachedNotifications;
    cachedNotificationsJSON = null;
    renderNotifications(notifications);
  }
});

// Desktop notification settings
desktopNotificationsToggle.addEventListener('change', async () => {
  const enabled = desktopNotificationsToggle.checked;
  await storage.setEnableDesktopNotifications(enabled);
});

// User menu
settingsLogoutBtn.addEventListener('click', logout);
refreshBtn.addEventListener('click', refresh);
markAllBtn.addEventListener('click', markAllAsRead);

// Listen for storage changes to auto-update the notification list
// This handles updates from background refresh or other sources
browserStorage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.notifications && !mainView.hidden) {
    const hasOngoingAnimations = document.querySelectorAll('.marking-read').length > 0;
    if (hasOngoingAnimations) {
      return; // Don't update, let the animation complete naturally
    }

    // Auto-update notification list when storage changes
    const newNotifications = changes.notifications.newValue || [];
    // Don't resort - keep existing order to prevent jumping
    renderNotifications(newNotifications, false);
  }
});

// Pre-apply theme to prevent flash on load
(async () => {
  await preloadTheme();
  // Apply popup width immediately
  await applyPopupSize();
  // Enable transitions after initial theme and size are applied
  requestAnimationFrame(() => {
    document.body.classList.add('transitions-enabled');
  });
  // Then initialize the rest
  init();
})();
