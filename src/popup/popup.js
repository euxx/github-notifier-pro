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
  DEFAULT_POPUP_WIDTH,
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

/**
 * Get auth method labels
 * @param {string} authMethod - 'oauth' or 'pat'
 * @returns {{shortLabel: string, fullLabel: string}}
 */
function getAuthMethodLabels(authMethod) {
  const shortLabel = authMethod === 'oauth' ? 'OAuth' : 'PAT';
  const fullLabel = authMethod === 'oauth' ? 'OAuth' : 'Personal Access Token';
  return { shortLabel, fullLabel };
}

/**
 * Build user profile URL
 * @param {string} username - GitHub username
 * @param {Object} userInfo - User info object with login and html_url
 * @returns {string|null} Profile URL or null
 */
function buildUserProfileUrl(username, userInfo) {
  // Prefer html_url for GitHub Enterprise support
  if (userInfo?.html_url) {
    return userInfo.html_url;
  }

  // Fallback to building URL from username (GitHub.com only)
  const login = username || userInfo?.login;
  if (!login || login === 'User') return null;
  return `https://github.com/${encodeURIComponent(login)}`;
}

/**
 * Update all profile links with user information
 * @param {string} username - GitHub username
 * @param {Object} userInfo - User info object
 */
function updateProfileLinks(username, userInfo) {
  const url = buildUserProfileUrl(username, userInfo);
  const displayName = username || userInfo?.login || 'User';
  const ariaLabel = displayName !== 'User' ? `Open ${displayName} profile` : 'Open GitHub profile';

  [userProfileLink, settingsAvatarLink, settingsUsernameLink].forEach((link) => {
    if (!link) return;
    if (url) {
      link.href = url;
      link.setAttribute('aria-label', ariaLabel);
    } else {
      link.removeAttribute('href');
      link.removeAttribute('aria-label');
    }
  });
}

// Elements
const loginView = document.getElementById('login-view');
const mainView = document.getElementById('main-view');

const POPUP_LAST_VIEW_KEY = 'popupLastView';
const POPUP_WIDTH_KEY = 'popupWidth';
const POPUP_THEME_KEY = 'popupTheme';

// Generic localStorage wrapper with error handling
function getStorageValue(key, defaultValue) {
  try {
    return localStorage.getItem(key) ?? defaultValue;
  } catch (_error) {
    return defaultValue;
  }
}

function setStorageValue(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (_error) {
    // Ignore storage errors to avoid blocking popup rendering
  }
}

function clampPopupWidth(width) {
  return Math.min(MAX_POPUP_WIDTH, Math.max(MIN_POPUP_WIDTH, width));
}

function getCachedPopupWidth() {
  const raw = getStorageValue(POPUP_WIDTH_KEY, DEFAULT_POPUP_WIDTH);
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_POPUP_WIDTH;
  }
  return clampPopupWidth(parsed);
}

function setCachedPopupWidth(width) {
  setStorageValue(POPUP_WIDTH_KEY, width);
}

function getCachedPopupView() {
  const value = getStorageValue(POPUP_LAST_VIEW_KEY, null);
  return value === 'login' || value === 'main' ? value : null;
}

function setCachedPopupView(view) {
  setStorageValue(POPUP_LAST_VIEW_KEY, view);
}

function getCachedTheme() {
  return getStorageValue(POPUP_THEME_KEY, 'system');
}

function setCachedTheme(theme) {
  setStorageValue(POPUP_THEME_KEY, theme);
}

function applyInitialPopupWidth() {
  const cachedView = getCachedPopupView();
  const cachedWidth = getCachedPopupWidth();

  if (cachedView === 'login' || cachedView === null) {
    document.body.style.width = '400px';
  } else {
    document.body.style.width = `${cachedWidth}px`;
  }

  // Apply cached theme synchronously before making popup visible
  applyTheme(getCachedTheme());
  document.body.classList.add('popup-ready');
}

applyInitialPopupWidth();

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
const loginErrorEl = document.getElementById('login-error');

// Main view elements
const settingsIconBtn = document.getElementById('settings-icon-btn');
const refreshBtn = document.getElementById('refresh-btn');
const markAllBtn = document.getElementById('mark-all-btn');
const usernameEl = document.getElementById('username');
const avatarEl = document.getElementById('user-avatar');
const userProfileLink = document.getElementById('user-profile-link');
const notificationsList = document.getElementById('notifications-list');
const emptyState = document.getElementById('empty-state');

// Settings view elements
const settingsView = document.getElementById('settings-view');
const settingsBackBtn = document.getElementById('settings-back-btn');
const themeRadios = document.querySelectorAll('input[name="theme"]');
const settingsLogoutBtn = document.getElementById('settings-logout-btn');
const settingsUsernameEl = document.getElementById('settings-username');
const settingsAvatarEl = document.getElementById('settings-avatar');
const settingsAvatarLink = document.getElementById('settings-avatar-link');
const settingsUsernameLink = document.getElementById('settings-username-link');
const settingsAuthMethodEl = document.getElementById('settings-auth-method');
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

let scrollbarCompensationRaf = null;

function showLoginError(message) {
  if (!loginErrorEl) return;
  loginErrorEl.textContent = message;
  loginErrorEl.hidden = false;
  patInput.classList.add('input-error');
  patInput.setAttribute('aria-invalid', 'true');
}

function clearLoginError() {
  if (!loginErrorEl) return;
  loginErrorEl.hidden = true;
  loginErrorEl.textContent = '';
  patInput.classList.remove('input-error');
  patInput.setAttribute('aria-invalid', 'false');
}

function updateScrollbarCompensation() {
  if (!mainView || !notificationsContainer) return;

  if (mainView.hidden || notificationsContainer.hidden) {
    mainView.style.setProperty('--scrollbar-compensation', '0px');
    return;
  }

  const scrollbarWidth = Math.max(0, notificationsContainer.offsetWidth - notificationsContainer.clientWidth);
  const hasScrollbar = notificationsContainer.scrollHeight > notificationsContainer.clientHeight + 1;
  const compensation = hasScrollbar ? scrollbarWidth : 0;
  mainView.style.setProperty('--scrollbar-compensation', `${compensation}px`);
}

function scheduleScrollbarCompensation() {
  if (scrollbarCompensationRaf !== null) return;
  scrollbarCompensationRaf = requestAnimationFrame(() => {
    scrollbarCompensationRaf = null;
    updateScrollbarCompensation();
  });
}

if (notificationsContainer && typeof ResizeObserver !== 'undefined') {
  const resizeObserver = new ResizeObserver(() => {
    scheduleScrollbarCompensation();
  });
  resizeObserver.observe(notificationsContainer);
}

if (notificationsList && typeof MutationObserver !== 'undefined') {
  const mutationObserver = new MutationObserver(() => {
    scheduleScrollbarCompensation();
  });
  mutationObserver.observe(notificationsList, { childList: true });
}

/**
 * Check if browser notification permission is granted
 */
function hasExtensionNotifications() {
  return (
    (typeof chrome !== 'undefined' && !!chrome.notifications) ||
    (typeof browser !== 'undefined' && !!browser.notifications)
  );
}

function checkNotificationPermission() {
  if (hasExtensionNotifications()) {
    return 'granted';
  }
  if (typeof Notification === 'undefined') {
    console.warn('Notification API not available');
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Request browser notification permission
 */
async function requestNotificationPermission() {
  if (hasExtensionNotifications()) {
    return 'granted';
  }
  if (typeof Notification === 'undefined') {
    console.warn('Notification API not available');
    return 'unsupported';
  }

  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (error) {
    console.error('Failed to request notification permission:', error);
    return 'denied';
  }
}

// Store hover cards setting
let showHoverCards = true;

/**
 * Update countdown timer
 */
let countdownInterval = null;
let lastAlarmTime = null;

export async function updateCountdown() {
  try {
    const allAlarms = await alarms.getAll();
    const notificationAlarm = allAlarms.find((a) => a.name === 'check-notifications');

    if (!notificationAlarm || !notificationAlarm.scheduledTime) {
      refreshCountdownEl.textContent = '';
      refreshCountdownEl.title = '';
      lastAlarmTime = null;
      return;
    }

    const now = Date.now();
    const remaining = notificationAlarm.scheduledTime - now;

    // Detect alarm reset (when scheduledTime jumps to a future time)
    if (lastAlarmTime && notificationAlarm.scheduledTime > lastAlarmTime + TIMING_THRESHOLDS.ALARM_RESET_DETECTION) {
      // Alarm was reset — accept the new time and skip this tick so the display
      // updates smoothly on the next interval rather than showing a big jump.
      lastAlarmTime = notificationAlarm.scheduledTime;
      return;
    }
    lastAlarmTime = notificationAlarm.scheduledTime;

    if (remaining <= 0) {
      refreshCountdownEl.textContent = '';
      refreshCountdownEl.title = '';
      return;
    }

    const seconds = Math.ceil(remaining / 1000);
    refreshCountdownEl.textContent = `${seconds}s`;

    // Update tooltip with poll interval information
    if (notificationAlarm.periodInMinutes) {
      const intervalMinutes = notificationAlarm.periodInMinutes;
      const intervalText = intervalMinutes === 1 ? '1 minute' : `${intervalMinutes} minutes`;

      // Show reason when interval is longer than default
      const reasonSuffix = intervalMinutes > 1 ? ' (requested by GitHub)' : '';
      refreshCountdownEl.title = `Refreshes every ${intervalText}${reasonSuffix}`;
    } else {
      refreshCountdownEl.title = '';
    }
  } catch (error) {
    console.error('Error updating countdown:', error);
    refreshCountdownEl.textContent = '';
    refreshCountdownEl.title = '';
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
  const theme = (await storage.getTheme()) || 'system';
  themeRadios.forEach((radio) => {
    radio.checked = radio.value === theme;
  });

  // Load and display username
  const username = await storage.getUsername();
  const authMethod = await storage.getAuthMethod();
  const { shortLabel, fullLabel } = getAuthMethodLabels(authMethod);
  if (settingsUsernameEl && username) {
    settingsUsernameEl.textContent = username;
  }
  if (settingsAuthMethodEl) {
    settingsAuthMethodEl.textContent = shortLabel || '';
    if (fullLabel) {
      settingsAuthMethodEl.title = fullLabel;
    } else {
      settingsAuthMethodEl.removeAttribute('title');
    }
  }

  // Load and display user avatar
  const userInfo = await storage.getUserInfo();
  updateProfileLinks(username, userInfo);
  if (settingsAvatarEl && userInfo?.avatar_url) {
    settingsAvatarEl.src = userInfo.avatar_url;
    settingsAvatarEl.alt = userInfo.login || 'User';
    settingsAvatarEl.hidden = false;
    if (settingsAvatarLink) {
      settingsAvatarLink.hidden = false;
    }
  } else if (settingsAvatarEl) {
    settingsAvatarEl.hidden = true;
    if (settingsAvatarLink) {
      settingsAvatarLink.hidden = true;
    }
  }

  // Load popup width setting
  const width = await storage.getPopupWidth();
  popupWidthInput.value = width;
  updateWidthButtons(width);

  // Load hover cards setting
  const showCards = await storage.getShowHoverCards();
  hoverCardsToggle.checked = showCards;

  // Load desktop notification settings
  const enableDesktopNotifications = await storage.getEnableDesktopNotifications();
  desktopNotificationsToggle.checked = enableDesktopNotifications;
  // Check browser notification permission status
  const permission = checkNotificationPermission();

  // Update toggle state based on permission
  if (permission === 'denied') {
    desktopNotificationsToggle.disabled = true;
    desktopNotificationsToggle.parentElement.title =
      'Browser notification permission denied. Please enable it in browser settings.';
  } else if (permission === 'unsupported') {
    desktopNotificationsToggle.disabled = true;
    desktopNotificationsToggle.parentElement.title = 'Browser notifications not supported.';
  }
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
  const selectedTheme = document.querySelector('input[name="theme"]:checked');
  const theme = selectedTheme ? selectedTheme.value : 'system';

  // Save to storage and cache for instant apply on next open
  try {
    await storage.setTheme(theme);
  } catch (error) {
    console.error('Failed to save theme:', error);
  }
  setCachedTheme(theme);

  // Apply theme immediately
  applyTheme(theme);
}

/**
 * Handle popup width change
 */
async function handleWidthChange() {
  const parsed = parseInt(popupWidthInput.value, 10);
  const width = clampPopupWidth(isNaN(parsed) ? MIN_POPUP_WIDTH : parsed);

  popupWidthInput.value = width;
  document.body.style.width = `${width}px`;
  updateScrollbarCompensation();
  setCachedPopupWidth(width);
  updateWidthButtons(width);

  // Save to storage
  try {
    await storage.setPopupWidth(width);
  } catch (error) {
    console.error('Failed to save popup width:', error);
  }
}

/**
 * Decrease width
 */
async function decreaseWidth() {
  const currentWidth = parseInt(popupWidthInput.value, 10);
  popupWidthInput.value = clampPopupWidth(currentWidth - POPUP_WIDTH_STEP);
  await handleWidthChange();
}

/**
 * Increase width
 */
async function increaseWidth() {
  const currentWidth = parseInt(popupWidthInput.value, 10);
  popupWidthInput.value = clampPopupWidth(currentWidth + POPUP_WIDTH_STEP);
  await handleWidthChange();
}

function updateWidthButtons(width) {
  if (!widthDecreaseBtn || !widthIncreaseBtn) return;
  widthDecreaseBtn.disabled = width <= MIN_POPUP_WIDTH;
  widthIncreaseBtn.disabled = width >= MAX_POPUP_WIDTH;
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
    setCachedPopupView('login');
  } else if (view === 'main') {
    // Use saved width for main view
    const width = await storage.getPopupWidth();
    document.body.style.width = `${width}px`;
    setCachedPopupWidth(width);
    setCachedPopupView('main');
  }

  document.body.classList.add('popup-ready');
}

/**
 * Mark all as read
 */
async function markAllAsRead() {
  // Immediate visual feedback
  const originalNodes = Array.from(markAllBtn.childNodes).map((n) => n.cloneNode(true));
  markAllBtn.disabled = true;
  const spinner = document
    .createRange()
    .createContextualFragment(
      '<svg viewBox="0 0 16 16" width="16" height="16" class="spinner-icon"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="30" stroke-dashoffset="0"><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1s" repeatCount="indefinite"/></circle></svg>',
    );
  markAllBtn.replaceChildren(spinner);

  // Immediate visual feedback: start overlay animation with stagger
  const items = [...notificationsList.querySelectorAll('.repo-group-header, .notification-item')];
  const anim = beginStaggerAnimation(items);

  function rollback() {
    anim.rollback();
    markAllBtn.disabled = false;
    markAllBtn.replaceChildren(...originalNodes.map((n) => n.cloneNode(true)));
  }

  try {
    const result = await sendMessage(MESSAGE_TYPES.MARK_ALL_AS_READ);
    if (result.success) {
      // Wait for stagger animation to finish before clearing DOM
      await anim.waitForCompletion();
      clearNotificationCache();
      notificationsList.replaceChildren();
      emptyState.hidden = false;
      markAllBtn.disabled = true;
      markAllBtn.replaceChildren(...originalNodes.map((n) => n.cloneNode(true)));
    } else {
      rollback();
      console.error('Failed to mark all as read:', result.error);
    }
  } catch (error) {
    rollback();
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
 * Set user avatar
 * @param {Object} userInfo - User info object with avatar_url
 */
function setUserAvatar(userInfo) {
  if (userInfo?.avatar_url) {
    avatarEl.src = userInfo.avatar_url;
    avatarEl.hidden = false;
  } else {
    avatarEl.hidden = true;
  }
}

/**
 * Login
 */
async function login(authMethod = 'oauth', token = null) {
  const result = await sendMessage(MESSAGE_TYPES.LOGIN, { authMethod, token });

  if (result.success) {
    usernameEl.textContent = result.username;

    // Set user avatar
    const userInfo = await storage.getUserInfo();
    setUserAvatar(userInfo);
    updateProfileLinks(result.username, userInfo);

    await showView('main'); // Show main view first
    const state = await sendMessage(MESSAGE_TYPES.GET_STATE);
    renderNotifications(state.notifications, true); // Then render notifications
    // Start countdown timer after successful login
    startCountdown();
  } else {
    showLoginError(result.error || 'Login failed');
  }
}

/**
 * Show PAT input form
 */
function showPATForm() {
  authMethods.hidden = true;
  patInputForm.hidden = false;
  patInput.value = '';
  clearLoginError();
  patInput.focus();
}

/**
 * Hide PAT input form
 */
function hidePATForm() {
  authMethods.hidden = false;
  patInputForm.hidden = true;
  patInput.value = '';
  clearLoginError();
}

/**
 * Handle PAT login
 */
async function handlePATLogin() {
  const token = patInput.value.trim();

  if (!token) {
    showLoginError('Please enter your token');
    return;
  }

  // Check if token starts with any valid GitHub token prefix
  const hasValidPrefix = TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix));

  if (!hasValidPrefix) {
    const prefixList = TOKEN_PREFIXES.join('", "');
    showLoginError(`Token should start with one of: "${prefixList}"`);
    return;
  }

  patLoginBtn.disabled = true;
  patLoginBtn.textContent = 'Connecting...';
  clearLoginError();

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

// Cap stagger to avoid long animation when many items are off-screen
const MAX_STAGGER_COUNT = 20;

/**
 * Calculate total stagger animation duration for a given number of elements.
 */
function calcStaggerDuration(count) {
  const capped = Math.min(count, MAX_STAGGER_COUNT);
  return Math.max(capped - 1, 0) * ANIMATION_DURATION.STAGGER_DELAY + ANIMATION_DURATION.FADE_OUT;
}

/**
 * Wait until a stagger animation that started at `startTime` has finished.
 * Resolves immediately if the animation has already completed.
 */
async function waitForAnimation(startTime, duration) {
  const remaining = Math.max(0, duration - (Date.now() - startTime));
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

/**
 * Start stagger animation on elements and return control handles.
 * Sets global timing state and returns rollback/wait helpers.
 * @param {HTMLElement[]} elements - Elements to animate
 * @returns {{ rollback: () => void, waitForCompletion: () => Promise<void> }}
 */
function beginStaggerAnimation(elements) {
  lastAnimationDuration = calcStaggerDuration(elements.length);
  lastUserActionTime = Date.now();
  const animationStart = lastUserActionTime;
  const animationDuration = lastAnimationDuration;

  const timeoutIds = startStaggerFadeOut(elements, ANIMATION_DURATION.STAGGER_DELAY);

  return {
    rollback() {
      timeoutIds.forEach((id) => clearTimeout(id));
      removeOverlayFadeOut(elements);
    },
    waitForCompletion() {
      return waitForAnimation(animationStart, animationDuration);
    },
  };
}

/**
 * Start staggered overlay fade-out animation.
 * @param {HTMLElement[]} elements - Elements to animate
 * @param {number} staggerDelay - Delay in ms between each element's fade
 * @returns {number[]} Timeout IDs for cancellation
 */
function startStaggerFadeOut(elements, staggerDelay) {
  for (const el of elements) {
    el.classList.add('marking-read');
  }
  // eslint-disable-next-line no-unused-expressions
  document.body.offsetHeight; // Force reflow

  const timeoutIds = [];
  elements.forEach((el, index) => {
    const delay = Math.min(index, MAX_STAGGER_COUNT - 1) * staggerDelay;
    const id = setTimeout(() => {
      el.classList.add('fade-out');
    }, delay);
    timeoutIds.push(id);
  });
  return timeoutIds;
}

/**
 * Remove overlay fade-out animation classes
 * @param {HTMLElement[]} elements - Elements to restore
 */
function removeOverlayFadeOut(elements) {
  for (const el of elements) {
    el.classList.remove('marking-read', 'fade-out');
  }
}

/**
 * Mark all notifications in a repository as read
 * @param {string} repoFullName - Repository full name (owner/repo)
 */
async function handleMarkRepoAsRead(repoFullName) {
  const [owner, repo] = repoFullName.split('/');

  // Immediate visual feedback: start animation before API response
  const escapedRepo = CSS.escape(repoFullName);
  const repoHeader = document.querySelector(`.repo-group-header[data-repo="${escapedRepo}"]`);
  const items = [...document.querySelectorAll(`.notification-item[data-repo="${escapedRepo}"]`)];

  const allElements = repoHeader ? [repoHeader, ...items] : items;

  const anim = beginStaggerAnimation(allElements);

  try {
    const response = await sendMessage(MESSAGE_TYPES.MARK_REPO_AS_READ, { owner, repo });

    if (response.success) {
      // Wait for stagger animation to finish before removing DOM
      await anim.waitForCompletion();

      // Re-render with updated notifications returned by the background.
      // Defensive fallback: if payload shape is unexpected, reload full state.
      let nextNotifications = response.notifications;
      if (!Array.isArray(nextNotifications)) {
        console.warn('MARK_REPO_AS_READ returned invalid notifications payload, reloading state');
        const state = await sendMessage(MESSAGE_TYPES.GET_STATE);
        nextNotifications = Array.isArray(state.notifications) ? state.notifications : [];
      }

      clearNotificationCache();
      renderNotifications(nextNotifications, false);
    } else {
      anim.rollback();
      console.error('Failed to mark repo as read:', response.error);
    }
  } catch (error) {
    anim.rollback();
    console.error('Error marking repo as read:', error);
  }
}

/**
 * Pre-load theme before showing any view to prevent flash
 */
async function preloadTheme() {
  const theme = await storage.getTheme();
  setCachedTheme(theme);
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
    onMarkRepoAsRead: handleMarkRepoAsRead,
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

    // Set user avatar
    const userInfo = await storage.getUserInfo();
    setUserAvatar(userInfo);

    renderNotifications(state.notifications, true); // Re-sort on init
    await showView('main'); // This will apply saved width
    updateProfileLinks(username, userInfo);
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
patInput.addEventListener('input', () => {
  if (!loginErrorEl.hidden) {
    clearLoginError();
  }
});

// Settings
settingsIconBtn.addEventListener('click', showSettings);
settingsBackBtn.addEventListener('click', hideSettings);
themeRadios.forEach((radio) => {
  radio.addEventListener('change', handleThemeChange);
});
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

  if (enabled) {
    // Check current permission
    let permission = checkNotificationPermission();

    // Request permission if not granted
    if (permission === 'default' || permission === 'prompt') {
      permission = await requestNotificationPermission();
    }

    // Only enable if permission granted
    if (permission === 'granted') {
      await storage.setEnableDesktopNotifications(true);
    } else {
      // Permission denied or unavailable
      desktopNotificationsToggle.checked = false;
      await storage.setEnableDesktopNotifications(false);

      if (permission === 'denied') {
        alert(
          'Browser notification permission was denied. Please enable it in your browser settings to use desktop notifications.',
        );
      } else if (permission === 'unsupported') {
        alert('Browser notifications are not supported in this browser.');
      }
    }
  } else {
    // User disabled the toggle
    await storage.setEnableDesktopNotifications(false);
  }
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
