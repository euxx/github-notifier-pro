/**
 * Popup script for GitHub Notifier
 */

import * as storage from "../lib/storage.js";
import { storage as browserStorage, alarms, runtime, tabs } from "../lib/chrome-api.js";
import {
  ANIMATION_DURATION,
  TOKEN_PREFIXES,
  MESSAGE_TYPES,
  MIN_POPUP_WIDTH,
  MAX_POPUP_WIDTH,
  DEFAULT_POPUP_WIDTH,
  POPUP_WIDTH_STEP,
  TIMING_THRESHOLDS,
} from "../lib/constants.js";
import { applyTheme } from "../lib/theme.js";
import {
  buildProfileUrl,
  buildRepoNotificationsUrl,
  buildKeywordNotificationsUrl,
} from "../lib/url-builder.js";
import { classifyError } from "../lib/format-utils.js";
import {
  initRenderer,
  renderNotifications,
  clearNotificationCache,
} from "./notification-renderer.js";

/**
 * Get auth method labels
 * @param {string} authMethod - 'oauth' or 'pat'
 * @returns {{shortLabel: string, fullLabel: string}}
 */
function getAuthMethodLabels(authMethod) {
  if (authMethod === "oauth") return { shortLabel: "OAuth", fullLabel: "OAuth" };
  return { shortLabel: "PAT", fullLabel: "Personal Access Token" };
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
  if (!login || login === "User") return null;
  return buildProfileUrl(login);
}

/**
 * Update all profile links with user information
 * @param {string} username - GitHub username
 * @param {Object} userInfo - User info object
 */
function updateProfileLinks(username, userInfo) {
  const url = buildUserProfileUrl(username, userInfo);
  const displayName = username || userInfo?.login || "User";
  const ariaLabel = displayName !== "User" ? `Open ${displayName} profile` : "Open GitHub profile";

  [userProfileLink, settingsProfileLink].forEach((link) => {
    if (!link) return;
    if (url) {
      link.href = url;
      link.setAttribute("aria-label", ariaLabel);
    } else {
      link.removeAttribute("href");
      link.removeAttribute("aria-label");
    }
  });
}

// Elements
const loginView = document.getElementById("login-view");
const mainView = document.getElementById("main-view");

const POPUP_LAST_VIEW_KEY = "popupLastView";
const POPUP_WIDTH_KEY = "popupWidth";
const POPUP_THEME_KEY = "popupTheme";

// Generic localStorage wrapper with error handling
function getStorageValue(key, defaultValue) {
  try {
    return localStorage.getItem(key) ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

function setStorageValue(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
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
  return value === "login" || value === "main" ? value : null;
}

function setCachedPopupView(view) {
  setStorageValue(POPUP_LAST_VIEW_KEY, view);
}

function getCachedTheme() {
  return getStorageValue(POPUP_THEME_KEY, "system");
}

function setCachedTheme(theme) {
  setStorageValue(POPUP_THEME_KEY, theme);
}

function applyInitialPopupWidth() {
  const cachedView = getCachedPopupView();
  const cachedWidth = getCachedPopupWidth();

  if (cachedView === "login" || cachedView === null) {
    document.body.style.width = "400px";
  } else {
    document.body.style.width = `${cachedWidth}px`;
  }

  // Apply cached theme synchronously before making popup visible
  applyTheme(getCachedTheme());
  document.body.classList.add("popup-ready");
}

applyInitialPopupWidth();

// Track last user action to prevent race conditions with storage updates
let lastUserActionTime = 0;
let lastAnimationDuration = 400; // Default to single notification animation duration

// Auth method selection
const authMethods = document.getElementById("auth-methods");
const oauthMethod = document.getElementById("oauth-method");
const patMethod = document.getElementById("pat-method");
const patInputForm = document.getElementById("pat-input-form");
const patInput = document.getElementById("pat-input");
const patCancelBtn = document.getElementById("pat-cancel-btn");
const patLoginBtn = document.getElementById("pat-login-btn");
const loginErrorEl = document.getElementById("login-error");

// Main view elements
const settingsIconBtn = document.getElementById("settings-icon-btn");
const refreshBtn = document.getElementById("refresh-btn");
const markAllBtn = document.getElementById("mark-all-btn");
const usernameEl = document.getElementById("username");
const avatarEl = document.getElementById("user-avatar");
const userProfileLink = document.getElementById("user-profile-link");
const notificationsList = document.getElementById("notifications-list");
const emptyState = document.getElementById("empty-state");

// Settings view elements
const settingsView = document.getElementById("settings-view");
const settingsBackBtn = document.getElementById("settings-back-btn");
const themeRadios = document.querySelectorAll('input[name="theme"]');
const settingsLogoutBtn = document.getElementById("settings-logout-btn");
const settingsUsernameEl = document.getElementById("settings-username");
const settingsAvatarEl = document.getElementById("settings-avatar");
const settingsProfileLink = document.getElementById("settings-profile-link");
const settingsAuthMethodEl = document.getElementById("settings-auth-method");
const notificationsContainer = document.getElementById("notifications-container");
const refreshCountdownEl = document.getElementById("refresh-countdown");

// Filter view elements
const filterIconBtn = document.getElementById("filter-icon-btn");
const filterView = document.getElementById("filter-view");
const filterBackBtn = document.getElementById("filter-back-btn");
const filterRulesList = document.getElementById("filter-rules-list");
const filterAddRuleBtn = document.getElementById("filter-add-rule-btn");
const filterCreator = document.getElementById("filter-creator");
const filterCreatorToggle = document.getElementById("filter-creator-toggle");
const filterCreatorLabel = document.getElementById("filter-creator-label");
const filterHeader = filterView?.querySelector(".settings-header");
const filterContent = filterView?.querySelector(".filter-content");
const filterNewRepoChips = document.getElementById("filter-new-repo-chips");
const filterNewRepoInput = document.getElementById("filter-new-repo-input");
const filterNewRepoAdd = document.getElementById("filter-new-repo-add");
const filterNewKwChips = document.getElementById("filter-new-kw-chips");
const filterNewKwInput = document.getElementById("filter-new-kw-input");
const filterNewKwAdd = document.getElementById("filter-new-kw-add");
const filterErrorEl = document.getElementById("filter-error");

// Popup size controls
const popupWidthInput = document.getElementById("popup-width-input");
const widthDecreaseBtn = document.getElementById("width-decrease");
const widthIncreaseBtn = document.getElementById("width-increase");

// Desktop notification settings
const desktopNotificationsToggle = document.getElementById("desktop-notifications-toggle");
const desktopNotificationsHint = document.getElementById("desktop-notifications-hint");

let scrollbarCompensationRaf = null;

function showLoginError(message) {
  if (!loginErrorEl) return;
  loginErrorEl.textContent = message;
  loginErrorEl.hidden = false;
  patInput.classList.add("input-error");
  patInput.setAttribute("aria-invalid", "true");
}

function clearLoginError() {
  if (!loginErrorEl) return;
  loginErrorEl.hidden = true;
  loginErrorEl.textContent = "";
  patInput.classList.remove("input-error");
  patInput.setAttribute("aria-invalid", "false");
}

function updateScrollbarCompensation() {
  if (!mainView || !notificationsContainer) return;

  if (mainView.hidden || notificationsContainer.hidden) {
    mainView.style.setProperty("--scrollbar-compensation", "0px");
    return;
  }

  const scrollbarWidth = Math.max(
    0,
    notificationsContainer.offsetWidth - notificationsContainer.clientWidth,
  );
  const hasScrollbar =
    notificationsContainer.scrollHeight > notificationsContainer.clientHeight + 1;
  const compensation = hasScrollbar ? scrollbarWidth : 0;
  mainView.style.setProperty("--scrollbar-compensation", `${compensation}px`);
}

function scheduleScrollbarCompensation() {
  if (scrollbarCompensationRaf !== null) return;
  scrollbarCompensationRaf = requestAnimationFrame(() => {
    scrollbarCompensationRaf = null;
    updateScrollbarCompensation();
  });
}

function setSettingsLayoutState(isOpen) {
  document.body.classList.toggle("settings-open", isOpen);
  mainView?.classList.toggle("settings-active", isOpen);
}

function parsePixelValue(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function syncFilterOverlayHeight() {
  if (
    !mainView ||
    !filterView ||
    filterView.hidden ||
    !mainView.classList.contains("filter-active")
  ) {
    return;
  }

  const bodyStyles = getComputedStyle(document.body);
  const minHeight = parsePixelValue(bodyStyles.minHeight) ?? 300;
  const maxHeight =
    parsePixelValue(bodyStyles.maxHeight) ??
    Math.max(minHeight, Math.round(mainView.getBoundingClientRect().height));
  const headerHeight = filterHeader?.offsetHeight ?? 0;
  const contentHeight = filterContent?.scrollHeight ?? 0;
  const overlayHeight = Math.min(maxHeight, Math.max(minHeight, headerHeight + contentHeight));

  mainView.style.setProperty("--filter-overlay-height", `${overlayHeight}px`);
}

function setFilterLayoutState(isOpen) {
  if (!mainView) return;

  if (!isOpen) {
    mainView.style.removeProperty("--filter-overlay-height");
  }

  mainView.classList.toggle("filter-active", isOpen);
}

function scrollFilterCreatorIntoView() {
  if (!filterContent || !filterCreator || filterCreator.hidden) return;

  requestAnimationFrame(() => {
    if (filterCreator.hidden) return;

    const contentRect = filterContent.getBoundingClientRect();
    const creatorRect = filterCreator.getBoundingClientRect();
    const top = Math.max(creatorRect.top - contentRect.top + filterContent.scrollTop - 8, 0);
    if (typeof filterContent.scrollTo === "function") {
      filterContent.scrollTo({ top, behavior: "smooth" });
    } else {
      filterContent.scrollTop = top;
    }
  });
}

if (notificationsContainer && typeof ResizeObserver !== "undefined") {
  const resizeObserver = new ResizeObserver(() => {
    scheduleScrollbarCompensation();
  });
  resizeObserver.observe(notificationsContainer);
}

if (notificationsList && typeof MutationObserver !== "undefined") {
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
    (typeof chrome !== "undefined" && !!chrome.notifications) ||
    (typeof browser !== "undefined" && !!browser.notifications)
  );
}

function checkNotificationPermission() {
  if (hasExtensionNotifications()) {
    return "granted";
  }
  if (typeof Notification === "undefined") {
    console.warn("Notification API not available");
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Request browser notification permission
 */
async function requestNotificationPermission() {
  if (hasExtensionNotifications()) {
    return "granted";
  }
  if (typeof Notification === "undefined") {
    console.warn("Notification API not available");
    return "unsupported";
  }

  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (error) {
    console.error("Failed to request notification permission:", error);
    return "denied";
  }
}

/**
 * Update countdown timer
 */
let countdownInterval = null;
let lastAlarmTime = null;

export async function updateCountdown() {
  try {
    const allAlarms = await alarms.getAll();
    const notificationAlarm = allAlarms.find((a) => a.name === "check-notifications");

    if (!notificationAlarm || !notificationAlarm.scheduledTime) {
      refreshCountdownEl.textContent = "";
      refreshCountdownEl.title = "";
      lastAlarmTime = null;
      return;
    }

    const now = Date.now();
    const remaining = notificationAlarm.scheduledTime - now;

    // Detect alarm reset (when scheduledTime jumps to a future time)
    if (
      lastAlarmTime &&
      notificationAlarm.scheduledTime > lastAlarmTime + TIMING_THRESHOLDS.ALARM_RESET_DETECTION
    ) {
      // Alarm was reset — accept the new time and skip this tick so the display
      // updates smoothly on the next interval rather than showing a big jump.
      lastAlarmTime = notificationAlarm.scheduledTime;
      return;
    }
    lastAlarmTime = notificationAlarm.scheduledTime;

    if (remaining <= 0) {
      refreshCountdownEl.textContent = "";
      refreshCountdownEl.title = "";
      return;
    }

    const seconds = Math.ceil(remaining / 1000);
    refreshCountdownEl.textContent = `${seconds}s`;

    // Update tooltip with poll interval information
    if (notificationAlarm.periodInMinutes) {
      const intervalMinutes = notificationAlarm.periodInMinutes;
      const intervalText = intervalMinutes === 1 ? "1 minute" : `${intervalMinutes} minutes`;

      // Show reason when interval is longer than default
      const reasonSuffix = intervalMinutes > 1 ? " (requested by GitHub)" : "";
      refreshCountdownEl.title = `Refreshes every ${intervalText}${reasonSuffix}`;
    } else {
      refreshCountdownEl.title = "";
    }
  } catch (error) {
    console.error("Error updating countdown:", error);
    refreshCountdownEl.textContent = "";
    refreshCountdownEl.title = "";
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
  refreshCountdownEl.textContent = "";
}

/**
 * Toggle between the main notification list and an overlay view (settings, filter, etc.).
 * @param {boolean} show - true to show overlay, false to restore main view
 */
function toggleOverlayView(show) {
  document.querySelector(".header").hidden = show;
  document.querySelector(".footer").hidden = show;
  setSettingsLayoutState(show);
  notificationsContainer.hidden = show;
}

/**
 * Show settings view
 */
async function showSettings() {
  // Load current theme
  const theme = (await storage.getTheme()) || "system";
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
    settingsAuthMethodEl.textContent = shortLabel || "";
    if (fullLabel) {
      settingsAuthMethodEl.title = fullLabel;
    } else {
      settingsAuthMethodEl.removeAttribute("title");
    }
  }

  // Load and display user avatar
  const userInfo = await storage.getUserInfo();
  updateProfileLinks(username, userInfo);
  if (settingsAvatarEl && userInfo?.avatar_url) {
    settingsAvatarEl.src = userInfo.avatar_url;
    settingsAvatarEl.alt = userInfo.login || "User";
    settingsAvatarEl.hidden = false;
  } else if (settingsAvatarEl) {
    settingsAvatarEl.hidden = true;
  }

  // Load popup width setting
  const width = await storage.getPopupWidth();
  popupWidthInput.value = width;
  updateWidthButtons(width);

  // Load desktop notification settings
  const enableDesktopNotifications = await storage.getEnableDesktopNotifications();
  desktopNotificationsToggle.checked = enableDesktopNotifications;
  // Check browser notification permission status
  const permission = checkNotificationPermission();

  // Update toggle state based on permission
  if (permission === "denied") {
    desktopNotificationsToggle.disabled = true;
    desktopNotificationsToggle.parentElement.title =
      "Browser notification permission denied. Please enable it in browser settings.";
    if (desktopNotificationsHint) {
      desktopNotificationsHint.textContent =
        "Permission denied. Please enable notifications in browser settings.";
      desktopNotificationsHint.hidden = false;
    }
  } else if (permission === "unsupported") {
    desktopNotificationsToggle.disabled = true;
    desktopNotificationsToggle.parentElement.title = "Browser notifications not supported.";
    if (desktopNotificationsHint) {
      desktopNotificationsHint.textContent = "Browser notifications are not supported.";
      desktopNotificationsHint.hidden = false;
    }
  }
  toggleOverlayView(true);
  settingsView.hidden = false;
}

/**
 * Hide settings view
 */
function hideSettings() {
  toggleOverlayView(false);
  settingsView.hidden = true;
}

/**
 * Handle theme change
 */
async function handleThemeChange() {
  const selectedTheme = document.querySelector('input[name="theme"]:checked');
  const theme = selectedTheme ? selectedTheme.value : "system";

  // Save to storage and cache for instant apply on next open
  try {
    await storage.setTheme(theme);
  } catch (error) {
    console.error("Failed to save theme:", error);
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
    console.error("Failed to save popup width:", error);
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
  if (view !== "main") {
    setSettingsLayoutState(false);
  }

  loginView.hidden = view !== "login";
  mainView.hidden = view !== "main";

  // Apply different widths for different views
  if (view === "login") {
    // Fixed width for login view
    document.body.style.width = "400px";
    setCachedPopupView("login");
  } else if (view === "main") {
    // Use saved width for main view
    const width = await storage.getPopupWidth();
    document.body.style.width = `${width}px`;
    setCachedPopupWidth(width);
    setCachedPopupView("main");
  }

  document.body.classList.add("popup-ready");
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
  const items = [...notificationsList.querySelectorAll(".repo-group-header, .notification-item")];
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
      console.error("Failed to mark all as read:", result.error);
    }
  } catch (error) {
    rollback();
    console.error("Failed to mark all as read:", error);
  }
}

/**
 * Refresh notifications
 */
async function refresh() {
  // Immediate visual feedback
  refreshBtn.disabled = true;
  refreshBtn.classList.add("spinning");

  // Temporarily hide countdown while refreshing
  const wasRunning = countdownInterval !== null;
  stopCountdown();

  try {
    await sendMessage(MESSAGE_TYPES.REFRESH);
    const state = await sendMessage(MESSAGE_TYPES.GET_STATE);
    renderNotifications(state.notifications, true); // Re-sort on refresh
  } catch (error) {
    console.error("Failed to refresh:", error);

    // Show appropriate error message based on error type
    const cachedNotifications = await storage.getNotifications();
    renderNotifications(cachedNotifications, true); // Re-sort even on error

    let message;
    let className = "error-message";

    // Use shared error classification (also used by service-worker)
    const errorType = classifyError(error);

    if (!navigator.onLine || errorType === "offline") {
      message = "⚠️ Offline - showing cached notifications";
      className = "offline-message";
    } else if (errorType === "timeout") {
      message = "⏱ Request timeout - showing cached data";
      className = "warning-message";
    } else if (errorType === "rate-limited") {
      message = "⏱ Rate limited - will retry automatically";
      className = "warning-message";
    } else {
      message = `❌ Error: ${error.message || "Failed to refresh"}`;
    }

    // Show error/warning message
    const msgEl = document.createElement("div");
    msgEl.className = className;
    msgEl.textContent = message;
    notificationsList.insertBefore(msgEl, notificationsList.firstChild);

    setTimeout(() => msgEl.remove(), 5000);
  } finally {
    setTimeout(() => {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove("spinning");
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
async function login(authMethod = "oauth", token = null) {
  const result = await sendMessage(MESSAGE_TYPES.LOGIN, { authMethod, token });

  if (result.success) {
    usernameEl.textContent = result.username;

    // Set user avatar
    const userInfo = await storage.getUserInfo();
    setUserAvatar(userInfo);
    updateProfileLinks(result.username, userInfo);

    await showView("main"); // Show main view first
    const state = await sendMessage(MESSAGE_TYPES.GET_STATE);
    renderNotifications(state.notifications, true); // Then render notifications
    // Start countdown timer after successful login
    startCountdown();
  } else {
    showLoginError(result.error || "Login failed");
  }
}

/**
 * Show PAT input form
 */
function showPATForm() {
  authMethods.hidden = true;
  patInputForm.hidden = false;
  patInput.value = "";
  clearLoginError();
  patInput.focus();
}

/**
 * Hide PAT input form
 */
function hidePATForm() {
  authMethods.hidden = false;
  patInputForm.hidden = true;
  patInput.value = "";
  clearLoginError();
}

/**
 * Handle PAT login
 */
async function handlePATLogin() {
  const token = patInput.value.trim();

  if (!token) {
    showLoginError("Please enter your token");
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
  patLoginBtn.textContent = "Connecting...";
  clearLoginError();

  try {
    await login("pat", token);
  } catch (error) {
    console.error("PAT login error:", error);
  } finally {
    patLoginBtn.disabled = false;
    patLoginBtn.textContent = "Connect";
  }
}

/**
 * Handle OAuth login - Open Device Flow page
 */
async function handleOAuthLogin() {
  // Open Device Flow authorization page in a new tab
  const authUrl = runtime.getURL("src/auth/device-flow.html");
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
  await showView("login");
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
    el.classList.add("marking-read");
  }
  void document.body.offsetHeight; // Force reflow

  const timeoutIds = [];
  elements.forEach((el, index) => {
    const delay = Math.min(index, MAX_STAGGER_COUNT - 1) * staggerDelay;
    const id = setTimeout(() => {
      el.classList.add("fade-out");
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
    el.classList.remove("marking-read", "fade-out");
  }
}

/**
 * Create a removable chip element.
 * @param {string} value - Display text
 * @param {string} variant - "repo" | "kw" — controls the chip color
 * @param {Function} [onRemove] - Called with `value` when × is clicked. Omit for read-only.
 * @returns {HTMLElement}
 */
function createChip(value, variant, onRemove) {
  const chip = document.createElement("span");
  chip.className = `filter-chip filter-chip-${variant}`;
  chip.textContent = value;

  if (onRemove) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "filter-chip-remove";
    removeBtn.title = `Remove "${value}"`;
    removeBtn.setAttribute("aria-label", `Remove ${value}`);
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => onRemove(value));
    chip.appendChild(removeBtn);
  }

  return chip;
}

function createFilterRuleActionButton({
  className,
  title,
  ariaLabel,
  svgMarkup,
  disabled = false,
  onClick,
}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn-icon filter-rule-action-btn ${className}`;
  button.title = title;
  button.setAttribute("aria-label", ariaLabel);
  button.disabled = disabled;
  button.appendChild(document.createRange().createContextualFragment(svgMarkup));
  button.addEventListener("click", onClick);
  return button;
}

/**
 * Render the list of existing filter rules as compact read-only rows.
 * Each row shows repo + keyword chips and hover-revealed edit/remove actions.
 * Repo chips are rendered as links to the repo's GitHub notifications page,
 * with the filtered count shown to the right when stats are available.
 * @param {Array<{ repos: string[], keywords: string[] }>} rules
 * @param {Array<Object>} [stats=[]] - Per-rule per-repo filtered counts from last refresh
 */
function renderRuleRows(rules, stats = []) {
  if (!filterRulesList) return;
  filterRulesList.replaceChildren();

  if (rules.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    // Reuse the filter funnel icon from the header (createContextualFragment avoids innerHTML)
    const svgMarkup =
      '<svg viewBox="0 0 16 16" width="24" height="24"><path fill="currentColor" d="M.75 3h14.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1 0-1.5ZM3 7.75A.75.75 0 0 1 3.75 7h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 7.75Zm3 4a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/></svg>';
    empty.appendChild(document.createRange().createContextualFragment(svgMarkup));
    const text = document.createElement("p");
    text.textContent = "No rules yet";
    empty.appendChild(text);
    filterRulesList.appendChild(empty);
    syncFilterOverlayHeight();
    return;
  }

  rules.forEach((rule, idx) => {
    const row = document.createElement("div");
    row.className = "filter-rule-row";
    const isEditing = idx === editingRuleIndex;
    if (isEditing) {
      row.classList.add("is-editing");
      row.setAttribute("aria-current", "true");
    }

    // Chips area: repos + separator + keywords
    const chips = document.createElement("div");
    chips.className = "filter-rule-chips";

    const ruleStats = stats[idx] || {};
    const repoStats = ruleStats.repos || {};
    const kwStats = ruleStats.keywords || {};

    rule.repos.forEach((repo) => {
      // Wrap chip + count in a group so they never wrap separately
      const group = document.createElement("span");
      group.className = "filter-chip-group";

      const link = document.createElement("a");
      link.className = "filter-chip filter-chip-repo filter-chip-link";
      link.href = buildRepoNotificationsUrl(repo);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = `Open ${repo} notifications`;
      link.textContent = repo;
      group.appendChild(link);

      // Filtered count badge (only shown when count > 0)
      const count = repoStats[repo.toLowerCase()] || 0;
      if (count > 0) {
        const countEl = document.createElement("span");
        countEl.className = "filter-chip-count";
        countEl.textContent = count;
        countEl.title = `${count} notification${count === 1 ? "" : "s"} filtered from last refresh`;
        group.appendChild(countEl);
      }
      chips.appendChild(group);
    });

    if (rule.repos.length > 0 && rule.keywords.length > 0) {
      const sep = document.createElement("span");
      sep.className = "filter-rule-sep";
      sep.textContent = "+";
      chips.appendChild(sep);
    }

    rule.keywords.forEach((kw) => {
      // Wrap chip + count in a group so they never wrap separately
      const group = document.createElement("span");
      group.className = "filter-chip-group";

      const link = document.createElement("a");
      link.className = "filter-chip filter-chip-kw filter-chip-link";
      link.href = buildKeywordNotificationsUrl(kw);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = `Search notifications for "${kw}"`;
      link.textContent = kw;
      group.appendChild(link);

      // Filtered count badge per keyword (only shown when count > 0)
      const kwCount = kwStats[kw] || 0;
      if (kwCount > 0) {
        const countEl = document.createElement("span");
        countEl.className = "filter-chip-count";
        countEl.textContent = kwCount;
        countEl.title = `${kwCount} notification${kwCount === 1 ? "" : "s"} matched "${kw}" from last refresh`;
        group.appendChild(countEl);
      }
      chips.appendChild(group);
    });

    const actions = document.createElement("div");
    actions.className = "filter-rule-actions";

    const editBtn = createFilterRuleActionButton({
      className: "filter-rule-edit-btn",
      title: isEditing ? "Editing current rule" : "Edit rule",
      ariaLabel: isEditing ? "Editing current rule" : "Edit rule",
      disabled: isEditing,
      svgMarkup:
        '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11.013 1.427a1.75 1.75 0 0 1 2.474 2.474l-7.25 7.25a1.75 1.75 0 0 1-.77.444l-2.16.54a.75.75 0 0 1-.91-.91l.54-2.16a1.75 1.75 0 0 1 .444-.77l7.25-7.25Zm1.414 1.06a.25.25 0 0 0-.353 0l-1.344 1.344 1.414 1.414 1.344-1.344a.25.25 0 0 0 0-.353l-1.06-1.06Zm-1.767 3.112L9.246 4.185 3.442 9.99a.25.25 0 0 0-.064.112l-.295 1.179 1.179-.295a.25.25 0 0 0 .112-.064l6.35-6.423Z"/></svg>',
      onClick: () => editRule(idx),
    });

    const removeBtn = createFilterRuleActionButton({
      className: "filter-rule-remove-btn",
      title: "Remove rule",
      ariaLabel: "Remove rule",
      svgMarkup:
        '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6.5 1.75A1.75 1.75 0 0 1 8.25 0h1.5A1.75 1.75 0 0 1 11.5 1.75V2h2.25a.75.75 0 0 1 0 1.5h-.638l-.622 9.066A1.75 1.75 0 0 1 10.744 14H5.256a1.75 1.75 0 0 1-1.746-1.434L2.888 3.5H2.25a.75.75 0 0 1 0-1.5H5v-.25Zm1.5-.25a.25.25 0 0 0-.25.25V2h2v-.25a.25.25 0 0 0-.25-.25H8Zm-2.108 11h4.216a.25.25 0 0 0 .249-.228L10.964 3.5H5.036l.607 8.772a.25.25 0 0 0 .249.228ZM6.75 5.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V6.5a.75.75 0 0 1 .75-.75Zm2.5 0a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V6.5a.75.75 0 0 1 .75-.75Z"/></svg>',
      onClick: async () => {
        const updated = [...currentFilterRules];
        updated.splice(idx, 1);
        if (!(await saveFilterRules(updated))) return;
        currentFilterRules = updated;
        // Adjust editingRuleIndex if the creator form is open
        if (editingRuleIndex >= 0) {
          if (idx === editingRuleIndex) {
            hideCreator();
          } else if (idx < editingRuleIndex) {
            editingRuleIndex--;
          }
        }
        currentFilterStats = [];
        renderRuleRows(currentFilterRules, currentFilterStats);
        updateFilterIndicator(currentFilterRules);
      },
    });

    actions.append(editBtn, removeBtn);
    row.append(chips, actions);
    filterRulesList.appendChild(row);
  });

  syncFilterOverlayHeight();
}

/**
 * Re-render the chip list inside the new-rule creator for repos or keywords.
 * @param {"repo"|"kw"} field
 */
function renderNewRuleChips(field) {
  const key = field === "repo" ? "repos" : "keywords";
  const container = field === "repo" ? filterNewRepoChips : filterNewKwChips;
  if (!container) return;
  container.replaceChildren(
    ...newRule[key].map((v) =>
      createChip(v, field, (removed) => {
        newRule[key] = newRule[key].filter((r) => r !== removed);
        renderNewRuleChips(field);
      }),
    ),
  );
  // Disable Save when no keywords are present
  if (filterAddRuleBtn) filterAddRuleBtn.disabled = newRule.keywords.length === 0;
  syncFilterOverlayHeight();
}

/**
 * Persist the filter rules array via the service worker.
 * @param {Array<{ repos: string[], keywords: string[] }>} rules
 */
async function saveFilterRules(rules) {
  try {
    const result = await sendMessage(MESSAGE_TYPES.SET_NOTIFICATION_FILTER, { filter: rules });
    if (result?.error) {
      throw new Error(result.error);
    }
    if (filterErrorEl) {
      filterErrorEl.hidden = true;
    }
    syncFilterOverlayHeight();
    return true;
  } catch (err) {
    console.error("Failed to save notification filter:", err);
    if (filterErrorEl) {
      filterErrorEl.textContent = "Failed to save filter. Please try again.";
      filterErrorEl.hidden = false;
    }
    syncFilterOverlayHeight();
    return false;
  }
}

/**
 * Show a dot indicator on the filter button when any rule has content.
 * @param {Array<{ repos: string[], keywords: string[] }>} rules
 */
function updateFilterIndicator(rules) {
  if (!filterIconBtn) return;
  const isActive = rules.some((r) => r.repos.length > 0 || r.keywords.length > 0);
  filterIconBtn.classList.toggle("filter-active", isActive);
}

/** In-memory copy of the current saved rules. */
let currentFilterRules = [];
let currentFilterStats = [];

/** In-memory state for the new-rule creator form. */
const newRule = { repos: [], keywords: [] };

/** Index of the rule currently being edited, or -1 when creating a new rule. */
let editingRuleIndex = -1;

function updateFilterCreatorLabel() {
  if (!filterCreatorLabel) return;
  filterCreatorLabel.textContent = editingRuleIndex >= 0 ? "Edit Rule" : "New Rule";
}

/**
 * Show filter view.
 */
async function showFilter() {
  let loadError = false;
  try {
    const result = await sendMessage(MESSAGE_TYPES.GET_NOTIFICATION_FILTER);
    currentFilterRules = Array.isArray(result?.filter) ? result.filter : [];
  } catch (err) {
    console.error("Failed to load notification filter:", err);
    currentFilterRules = [];
    loadError = true;
  }

  try {
    currentFilterStats = await storage.getNotificationFilterStats();
  } catch {
    currentFilterStats = [];
  }

  setFilterLayoutState(true);
  toggleOverlayView(true);
  filterView.hidden = false;

  if (filterErrorEl) {
    if (loadError) {
      filterErrorEl.textContent = "Failed to load filter rules.";
      filterErrorEl.hidden = false;
    } else {
      filterErrorEl.hidden = true;
    }
  }

  // Start with creator collapsed
  hideCreator();
}

/**
 * Hide filter view and re-render notifications from storage
 * to reflect any filter changes made while the view was open.
 */
async function hideFilter() {
  toggleOverlayView(false);
  filterView.hidden = true;
  setFilterLayoutState(false);
  // Re-render from storage so filter changes are visible immediately
  try {
    const notifications = await storage.getNotifications();
    renderNotifications(notifications, false);
  } catch (err) {
    console.error("Failed to reload notifications after closing filter:", err);
    renderNotifications([], false);
  }
}

/**
 * Expand the new-rule creator form for a new rule.
 */
function showCreator() {
  editingRuleIndex = -1;
  newRule.repos = [];
  newRule.keywords = [];
  openCreatorForm();
  renderRuleRows(currentFilterRules, currentFilterStats);
  scrollFilterCreatorIntoView();
}

/**
 * Expand the creator form pre-filled with an existing rule for editing.
 * @param {number} index - Index of the rule in currentFilterRules
 */
function editRule(index) {
  const rule = currentFilterRules[index];
  if (!rule) return;
  editingRuleIndex = index;
  newRule.repos = [...rule.repos];
  newRule.keywords = [...rule.keywords];
  openCreatorForm();
  renderRuleRows(currentFilterRules, currentFilterStats);
  scrollFilterCreatorIntoView();
}

/**
 * Open the creator form, resetting inputs.
 */
function openCreatorForm() {
  renderNewRuleChips("repo");
  renderNewRuleChips("kw"); // also sets filterAddRuleBtn.disabled
  if (filterNewRepoInput) {
    filterNewRepoInput.value = "";
  }
  if (filterNewKwInput) filterNewKwInput.value = "";
  updateFilterCreatorLabel();
  if (filterCreator) filterCreator.hidden = false;
  if (filterCreatorToggle) filterCreatorToggle.textContent = "Cancel";
  if (filterAddRuleBtn) filterAddRuleBtn.hidden = false;
  filterNewRepoInput?.focus();
}

/**
 * Collapse and reset the creator form.
 */
function hideCreator() {
  editingRuleIndex = -1;
  newRule.repos = [];
  newRule.keywords = [];
  updateFilterCreatorLabel();
  if (filterCreator) filterCreator.hidden = true;
  if (filterCreatorToggle) filterCreatorToggle.textContent = "+ New Rule";
  if (filterAddRuleBtn) filterAddRuleBtn.hidden = true;
  renderRuleRows(currentFilterRules, currentFilterStats);
}

/**
 * Add a value to the new-rule creator's repo or keyword list.
 * @param {"repo"|"kw"} field
 */
function addToNewRule(field) {
  const input = field === "repo" ? filterNewRepoInput : filterNewKwInput;
  const value = input?.value.trim();
  if (!value) return;
  const list = field === "repo" ? newRule.repos : newRule.keywords;
  if (!list.some((v) => v.toLowerCase() === value.toLowerCase())) {
    list.push(value);
    renderNewRuleChips(field);
  }
  if (input) {
    input.value = "";
    input.focus();
  }
}

/**
 * Commit the new rule from the creator form to the saved list.
 */
async function submitNewRule() {
  // At least one keyword is required — repos-only rules would never match anything
  if (newRule.keywords.length === 0) return;
  const updatedRule = { repos: [...newRule.repos], keywords: [...newRule.keywords] };
  let updated;
  if (editingRuleIndex >= 0) {
    // Replace existing rule in place
    updated = currentFilterRules.map((r, i) => (i === editingRuleIndex ? updatedRule : r));
  } else {
    updated = [...currentFilterRules, updatedRule];
  }
  if (!(await saveFilterRules(updated))) return;
  currentFilterRules = updated;
  currentFilterStats = [];
  hideCreator();
  updateFilterIndicator(currentFilterRules);
}

/**
 * Mark all notifications in a repository as read
 * @param {string} repoFullName - Repository full name (owner/repo)
 */
async function handleMarkRepoAsRead(repoFullName) {
  const [owner, repo] = repoFullName.split("/");

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
        console.warn("MARK_REPO_AS_READ returned invalid notifications payload, reloading state");
        const state = await sendMessage(MESSAGE_TYPES.GET_STATE);
        nextNotifications = Array.isArray(state.notifications) ? state.notifications : [];
      }

      clearNotificationCache();
      renderNotifications(nextNotifications, false);
    } else {
      anim.rollback();
      console.error("Failed to mark repo as read:", response.error);
    }
  } catch (error) {
    anim.rollback();
    console.error("Error marking repo as read:", error);
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
  // Initialize the notification renderer
  initRenderer({
    notificationsList,
    emptyState,
    markAllBtn,
    sendMessage,
    onUserAction: (duration) => {
      lastAnimationDuration = duration;
      lastUserActionTime = Date.now();
    },
    onMarkRepoAsRead: handleMarkRepoAsRead,
  });

  // Listen for system theme changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", async () => {
    const currentTheme = await storage.getTheme();
    if (currentTheme === "system") {
      applyTheme("system");
    }
  });

  const state = await sendMessage(MESSAGE_TYPES.GET_STATE);

  if (state.isAuthenticated) {
    // Set username with fallback
    const username = state.username || (await storage.getUsername()) || "User";
    usernameEl.textContent = username;

    // Set user avatar
    const userInfo = await storage.getUserInfo();
    setUserAvatar(userInfo);

    renderNotifications(state.notifications, true); // Re-sort on init
    await showView("main"); // This will apply saved width
    updateProfileLinks(username, userInfo);
    // Start countdown timer for next refresh
    startCountdown();

    // Show filter indicator if rules are already configured (non-critical, ignore errors)
    try {
      const filterResult = await sendMessage(MESSAGE_TYPES.GET_NOTIFICATION_FILTER);
      updateFilterIndicator(Array.isArray(filterResult?.filter) ? filterResult.filter : []);
    } catch {
      // Non-critical: indicator defaults to inactive
    }
  } else {
    await showView("login"); // This will set 400px width
  }
}

// Event listeners
oauthMethod.addEventListener("click", handleOAuthLogin);
patMethod.addEventListener("click", showPATForm);
patCancelBtn.addEventListener("click", hidePATForm);
patLoginBtn.addEventListener("click", handlePATLogin);
patInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    handlePATLogin();
  }
});
patInput.addEventListener("input", () => {
  if (!loginErrorEl.hidden) {
    clearLoginError();
  }
});

// Settings
settingsIconBtn.addEventListener("click", showSettings);
settingsBackBtn.addEventListener("click", hideSettings);
themeRadios.forEach((radio) => {
  radio.addEventListener("change", handleThemeChange);
});
popupWidthInput.addEventListener("change", handleWidthChange);
popupWidthInput.addEventListener("blur", handleWidthChange);
widthDecreaseBtn.addEventListener("click", decreaseWidth);
widthIncreaseBtn.addEventListener("click", increaseWidth);

// Filter page
filterIconBtn?.addEventListener("click", showFilter);
filterBackBtn?.addEventListener("click", hideFilter);
// Toggle button: "+ New Rule" when collapsed, "Cancel" when expanded
filterCreatorToggle?.addEventListener("click", () => {
  if (filterCreator?.hidden !== false) {
    showCreator();
  } else {
    hideCreator();
  }
});
filterAddRuleBtn?.addEventListener("click", submitNewRule);
filterNewRepoAdd?.addEventListener("click", () => addToNewRule("repo"));
filterNewKwAdd?.addEventListener("click", () => addToNewRule("kw"));
filterNewRepoInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addToNewRule("repo");
});
filterNewKwInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addToNewRule("kw");
});

// Desktop notification settings
desktopNotificationsToggle.addEventListener("change", async () => {
  const enabled = desktopNotificationsToggle.checked;

  if (desktopNotificationsHint) desktopNotificationsHint.hidden = true;

  if (enabled) {
    // Check current permission
    let permission = checkNotificationPermission();

    // Request permission if not granted
    if (permission === "default" || permission === "prompt") {
      permission = await requestNotificationPermission();
    }

    // Only enable if permission granted
    if (permission === "granted") {
      await storage.setEnableDesktopNotifications(true);
    } else {
      // Permission denied or unavailable
      desktopNotificationsToggle.checked = false;
      await storage.setEnableDesktopNotifications(false);

      if (desktopNotificationsHint) {
        if (permission === "denied") {
          desktopNotificationsHint.textContent =
            "Permission denied. Please enable notifications in browser settings.";
        } else if (permission === "unsupported") {
          desktopNotificationsHint.textContent = "Browser notifications are not supported.";
        }
        desktopNotificationsHint.hidden = false;
      }
    }
  } else {
    // User disabled the toggle
    await storage.setEnableDesktopNotifications(false);
  }
});

// User menu
settingsLogoutBtn.addEventListener("click", logout);
refreshBtn.addEventListener("click", refresh);
markAllBtn.addEventListener("click", markAllAsRead);

// Open GitHub Notifications via tabs.create for consistent tab placement
// Intercept all external links to open at the end of the tab strip
document.addEventListener("click", (e) => {
  const link = e.target.closest('a[target="_blank"]');
  if (!link) return;
  e.preventDefault();
  tabs.create({ url: link.href });
});

// Listen for storage changes to auto-update the notification list
// This handles updates from background refresh or other sources
browserStorage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.notifications && !mainView.hidden) {
    // Prevent race condition: ignore updates during and shortly after user actions
    const timeSinceUserAction = Date.now() - lastUserActionTime;
    const hasOngoingAnimations = document.querySelectorAll(".marking-read").length > 0;

    // Use dynamic animation duration to cover both single and bulk operations
    if (hasOngoingAnimations || timeSinceUserAction < lastAnimationDuration) {
      return;
    }

    // Auto-update notification list when storage changes
    const newNotifications = changes.notifications.newValue || [];
    // Don't resort - keep existing order to prevent jumping
    renderNotifications(newNotifications, false);
  }

  // Update filter stats display when background refresh writes new stats
  if (areaName === "local" && changes.notificationFilterStats && filterView && !filterView.hidden) {
    currentFilterStats = changes.notificationFilterStats.newValue || [];
    renderRuleRows(currentFilterRules, currentFilterStats);
  }
});

// Cleanup countdown timer when popup closes
window.addEventListener("beforeunload", () => {
  stopCountdown();
});

// Pre-apply theme to prevent flash on load
(async () => {
  await preloadTheme();
  // Enable transitions after initial theme is applied
  requestAnimationFrame(() => {
    document.body.classList.add("transitions-enabled");
  });
  // Then initialize (showView will set the correct width)
  await init();
})();
