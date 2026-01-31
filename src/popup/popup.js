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
} from '../lib/constants.js';
import { applyTheme } from '../lib/theme.js';
import {
  initRenderer,
  renderNotifications,
  getCachedNotifications,
  clearNotificationCache,
} from './notification-renderer.js';

// Elements
const loginView = document.getElementById('login-view');
const mainView = document.getElementById('main-view');

// Track last user action to prevent race conditions with storage updates
let lastUserActionTime = 0;
let lastAnimationDuration = 400; // Default to single notification animation duration

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
    const notificationAlarm = allAlarms.find((a) => a.name === 'check-notifications');

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

  // Load popup width setting
  const width = await storage.getPopupWidth();
  popupWidthInput.value = width;

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
 * Mark all as read
 */
async function markAllAsRead() {
  // Immediate visual feedback
  const originalText = markAllBtn.innerHTML;
  markAllBtn.disabled = true;
  markAllBtn.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" class="spinner-icon"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="30" stroke-dashoffset="0"><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1s" repeatCount="indefinite"/></circle></svg>';

  try {
    const result = await sendMessage(MESSAGE_TYPES.MARK_ALL_AS_READ);
    if (result.success) {
      // Fade out all notifications
      const items = notificationsList.querySelectorAll('.notification-item');

      // Calculate total animation duration for this operation
      const animationDuration = items.length * ANIMATION_DURATION.STAGGER_DELAY + 300;
      lastAnimationDuration = animationDuration;

      // Track user action to prevent storage listener race condition
      lastUserActionTime = Date.now();

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
      }, animationDuration);
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
    await showView('main'); // Show main view first
    const state = await sendMessage(MESSAGE_TYPES.GET_STATE);
    renderNotifications(state.notifications, true); // Then render notifications
    // Start countdown timer after successful login
    startCountdown();
  } else {
    alert(`Login failed: ${result.error || 'Unknown error'}`);
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
  // Load hover cards setting
  showHoverCards = await storage.getShowHoverCards();

  // Initialize the notification renderer
  initRenderer({
    notificationsList,
    emptyState,
    markAllBtn,
    getShowHoverCards: () => showHoverCards,
    sendMessage,
    onUserAction: (duration) => {
      lastAnimationDuration = duration;
      lastUserActionTime = Date.now();
    },
  });

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async (_e) => {
    const currentTheme = await storage.getTheme();
    if (currentTheme === 'system') {
      applyTheme('system');
    }
  });

  const state = await sendMessage(MESSAGE_TYPES.GET_STATE);

  if (state.isAuthenticated) {
    // Set username with fallback
    const username = state.username || (await storage.getUsername()) || 'User';
    usernameEl.textContent = username;

    renderNotifications(state.notifications, true); // Re-sort on init
    await showView('main'); // This will apply saved width
    // Start countdown timer for next refresh
    startCountdown();
  } else {
    await showView('login'); // This will set 400px width
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
    document.querySelectorAll('.notification-hover-card.visible').forEach((card) => {
      card.classList.remove('visible');
    });
  }

  // Re-render to update title attributes based on new setting
  const notifications = getCachedNotifications();
  if (notifications) {
    clearNotificationCache();
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
    // Prevent race condition: ignore updates during and shortly after user actions
    const timeSinceUserAction = Date.now() - lastUserActionTime;
    const hasOngoingAnimations = document.querySelectorAll('.marking-read').length > 0;

    // Use dynamic animation duration to cover both single and bulk operations
    if (hasOngoingAnimations || timeSinceUserAction < lastAnimationDuration) {
      return;
    }

    // Auto-update notification list when storage changes
    const newNotifications = changes.notifications.newValue || [];
    // Don't resort - keep existing order to prevent jumping
    renderNotifications(newNotifications, false);
  }
});

// Cleanup countdown timer when popup closes
window.addEventListener('beforeunload', () => {
  stopCountdown();
});

// Pre-apply theme to prevent flash on load
(async () => {
  await preloadTheme();
  // Enable transitions after initial theme is applied
  requestAnimationFrame(() => {
    document.body.classList.add('transitions-enabled');
  });
  // Then initialize (showView will set the correct width)
  init();
})();
