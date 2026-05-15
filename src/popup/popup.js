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
import { parseSVG } from "../lib/icons.js";
import {
  initRenderer,
  renderNotifications,
  renderNotificationsInto,
  groupByRepo,
  clearNotificationCache,
  formatTimeAgo,
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

// Gist sync elements
const syncToggle = document.getElementById("filter-sync-toggle");
const syncActions = document.getElementById("filter-sync-actions");
const syncConflict = document.getElementById("filter-sync-conflict");
const syncPushBtn = document.getElementById("filter-sync-push");
const syncPullBtn = document.getElementById("filter-sync-pull");
const syncUseLocalBtn = document.getElementById("filter-sync-use-local");
const syncUseRemoteBtn = document.getElementById("filter-sync-use-remote");
const syncGistLink = document.getElementById("filter-sync-gist-link");
const syncGistText = document.getElementById("filter-sync-gist-text");
const syncLastEl = document.getElementById("filter-sync-last");
const syncStatus = document.getElementById("filter-sync-status");
const filterCountBadge = document.getElementById("filter-count-badge");
const filteredNotificationsContainer = document.getElementById("filtered-notifications-container");
const filteredNotificationsList = document.getElementById("notifications-list-filtered");

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

let syncHeightScheduled = false;
function syncFilterOverlayHeight(force = false) {
  if (!force && syncHeightScheduled) return;
  syncHeightScheduled = true;
  queueMicrotask(() => {
    syncHeightScheduled = false;
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
  });
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

let showingFiltered = false;
let creatorWasOpen = false;

function renderWithFiltered(notifications, shouldResort) {
  const visible = [];
  const filtered = [];
  for (const n of notifications) {
    if (n.matchedRules?.length) filtered.push(n);
    else visible.push(n);
  }
  renderNotifications(visible, shouldResort);
  updateFilteredBadge(filtered.length);
}

function updateFilteredBadge(count) {
  if (!filterCountBadge) return;
  if (count === 0) {
    filterCountBadge.hidden = true;
    filterCountBadge.textContent = "";
    if (showingFiltered) {
      showingFiltered = false;
      if (filteredNotificationsContainer) filteredNotificationsContainer.hidden = true;
      if (filterRulesList) filterRulesList.hidden = false;
      if (filterCreator && creatorWasOpen) filterCreator.hidden = false;
      syncFilterOverlayHeight(true);
    }
  } else {
    filterCountBadge.textContent = `· ${count} filtered`;
    filterCountBadge.hidden = false;
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
  initSyncUI();
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
 * Send message to background script.
 * Maps MV3 service worker recycling failures to a clear error so callers can
 * surface a useful message instead of a silently-swallowed undefined response.
 */
async function sendMessage(action, data = {}) {
  let result;
  try {
    result = await runtime.sendMessage({ action, ...data });
  } catch (err) {
    const msg = err?.message || "";
    if (msg.includes("Extension context invalidated") || msg.includes("message channel closed")) {
      throw new Error("Background reconnecting, please retry");
    }
    throw err;
  }
  if (!result || typeof result !== "object") {
    throw new Error("No response from background");
  }
  return result;
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
  const spinner = parseSVG(
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
      updateFilteredBadge(0);
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
    renderWithFiltered(state.notifications, true); // Re-sort on refresh
  } catch (error) {
    console.error("Failed to refresh:", error);

    // Show appropriate error message based on error type
    const cachedNotifications = await storage.getNotifications();
    renderWithFiltered(cachedNotifications, true); // Re-sort even on error

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
    renderWithFiltered(state.notifications, true); // Then render notifications
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
 * Create a creator chip element that can be edited or removed.
 * @param {string} value - Display text
 * @param {string} variant - "repo" | "kw" — controls the chip color
 * @param {{ onEdit?: Function, onRemove?: Function }} [options]
 * @returns {HTMLElement}
 */
function createChip(value, variant, options = {}) {
  const { onEdit, onRemove } = options;
  const chip = document.createElement("span");
  chip.className = `filter-chip filter-chip-${variant}`;

  const label = document.createElement(onEdit ? "button" : "span");
  label.className = "filter-chip-label";
  label.textContent = value;

  if (onEdit) {
    label.type = "button";
    label.classList.add("filter-chip-edit-trigger");
    label.title = `Edit "${value}"`;
    label.setAttribute("aria-label", `Edit ${value}`);
    label.addEventListener("click", () => onEdit(value));
  }

  chip.appendChild(label);

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
  button.appendChild(parseSVG(svgMarkup));
  button.addEventListener("click", onClick);
  return button;
}

function clearDeleteConfirmationTimer() {
  if (confirmingDeleteTimer !== null) {
    clearTimeout(confirmingDeleteTimer);
    confirmingDeleteTimer = null;
  }
}

function exitDeleteConfirmation(row, actions, editBtn) {
  clearDeleteConfirmationTimer();
  confirmingDeleteIndex = -1;
  row.classList.remove("confirming-delete");
  actions.querySelectorAll(".confirm-delete, .cancel-delete").forEach((el) => el.remove());
  editBtn.hidden = false;
  actions.querySelector(".filter-rule-remove-btn").hidden = false;
}

function enterDeleteConfirmation(idx, row, actions, editBtn) {
  if (confirmingDeleteIndex >= 0 && confirmingDeleteIndex !== idx) {
    const prevRow = filterRulesList?.querySelectorAll(".filter-rule-row")[confirmingDeleteIndex];
    if (prevRow?.classList.contains("confirming-delete")) {
      const prevActions = prevRow.querySelector(".filter-rule-actions");
      const prevEditBtn = prevRow.querySelector(".filter-rule-edit-btn");
      exitDeleteConfirmation(prevRow, prevActions, prevEditBtn);
    }
  }

  confirmingDeleteIndex = idx;
  row.classList.add("confirming-delete");
  editBtn.hidden = true;
  actions.querySelector(".filter-rule-remove-btn").hidden = true;

  const confirmBtn = createFilterRuleActionButton({
    className: "confirm-delete",
    title: "Confirm delete",
    ariaLabel: "Confirm delete",
    svgMarkup:
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>',
    onClick: () => executeDeleteRule(idx),
  });

  const cancelBtn = createFilterRuleActionButton({
    className: "cancel-delete",
    title: "Cancel",
    ariaLabel: "Cancel delete",
    svgMarkup:
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>',
    onClick: () => exitDeleteConfirmation(row, actions, editBtn),
  });

  actions.append(confirmBtn, cancelBtn);
  confirmBtn.focus();

  clearDeleteConfirmationTimer();
  confirmingDeleteTimer = setTimeout(() => {
    confirmingDeleteTimer = null;
    if (confirmingDeleteIndex === idx) {
      exitDeleteConfirmation(row, actions, editBtn);
    }
  }, 5000);
}

async function executeDeleteRule(idx) {
  clearDeleteConfirmationTimer();
  confirmingDeleteIndex = -1;
  const updated = [...currentFilterRules];
  updated.splice(idx, 1);
  if (!(await saveFilterRules(updated))) {
    renderRuleRows(currentFilterRules, currentFilterStats);
    return;
  }
  currentFilterRules = updated;
  if (editingRuleIndex >= 0) {
    if (idx === editingRuleIndex) {
      hideCreator();
    } else if (idx < editingRuleIndex) {
      editingRuleIndex--;
    }
  }
  currentFilterStats = await storage.getNotificationFilterStats();
  renderRuleRows(currentFilterRules, currentFilterStats);
  updateFilterIndicator(currentFilterRules);
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
  clearDeleteConfirmationTimer();
  confirmingDeleteIndex = -1;
  filterRulesList.replaceChildren();

  if (rules.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const svgMarkup =
      '<svg viewBox="0 0 16 16" width="24" height="24"><path fill="currentColor" d="M.75 3h14.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1 0-1.5ZM3 7.75A.75.75 0 0 1 3.75 7h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 7.75Zm3 4a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/></svg>';
    empty.appendChild(parseSVG(svgMarkup));
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
      onClick: () => enterDeleteConfirmation(idx, row, actions, editBtn),
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
  const { key } = getNewRuleFieldParts(field);
  const container = field === "repo" ? filterNewRepoChips : filterNewKwChips;
  if (!container) return;
  container.replaceChildren(
    ...newRule[key].map((v) =>
      createChip(v, field, {
        onEdit: (selected) => editNewRuleChip(field, selected),
        onRemove: (removed) => {
          newRule[key] = newRule[key].filter((r) => r !== removed);
          renderNewRuleChips(field);
        },
      }),
    ),
  );
  updateFilterCreatorSaveState();
  syncFilterOverlayHeight();
}

/**
 * Update Save availability from committed keywords plus the current keyword input.
 */
function updateFilterCreatorSaveState() {
  if (!filterAddRuleBtn) return;
  const hasKeywords = newRule.keywords.length > 0 || Boolean(filterNewKwInput?.value.trim());
  filterAddRuleBtn.disabled = !hasKeywords;
}

/**
 * Resolve the key/input pair for a creator field.
 * @param {"repo"|"kw"} field
 */
function getNewRuleFieldParts(field) {
  return {
    key: field === "repo" ? "repos" : "keywords",
    input: field === "repo" ? filterNewRepoInput : filterNewKwInput,
  };
}

/**
 * Find a value in a creator field using exact text first, then case-insensitive matching.
 * @param {string[]} list
 * @param {string} value
 */
function findNewRuleValueIndex(list, value) {
  const exactIndex = list.indexOf(value);
  if (exactIndex >= 0) return exactIndex;
  const normalized = value.toLowerCase();
  return list.findIndex((entry) => entry.toLowerCase() === normalized);
}

/**
 * Reset the creator input/pending state and optionally re-insert a value at the pending
 * chip's original position. Shared by commit (uses input draft) and discard (uses pending
 * value) so the splice/dedup/render flow lives in one place.
 * @param {"repo"|"kw"} field
 * @param {string} value - Value to insert, or "" to skip insertion (intentional clear-to-delete UX).
 */
function reconcileCreatorChips(field, value) {
  const { key, input } = getNewRuleFieldParts(field);
  const pending = pendingNewRuleChipEdits[field];

  pendingNewRuleChipEdits[field] = null;
  if (input) input.value = "";

  if (value && findNewRuleValueIndex(newRule[key], value) === -1) {
    const insertIndex = pending?.index ?? newRule[key].length;
    newRule[key].splice(Math.min(insertIndex, newRule[key].length), 0, value);
  }

  renderNewRuleChips(field);
}

/**
 * Commit the current input draft (and any pending chip edit) back into the list.
 * Empty input intentionally drops a pending chip — this is the clear-to-delete UX:
 * users can clear the lifted input to remove the chip in a single action.
 * @param {"repo"|"kw"} field
 */
function commitCreatorInput(field) {
  const { input } = getNewRuleFieldParts(field);
  const draft = input?.value.trim() || "";
  reconcileCreatorChips(field, draft);
}

/**
 * Discard the current input draft and restore any pending chip back to its position.
 * @param {"repo"|"kw"} field
 */
function discardPendingEdit(field) {
  const pending = pendingNewRuleChipEdits[field];
  reconcileCreatorChips(field, pending?.value ?? "");
}

/**
 * Move a creator chip back into its input so the value can be edited in place.
 * @param {"repo"|"kw"} field
 * @param {string} value
 */
function editNewRuleChip(field, value) {
  const { key, input } = getNewRuleFieldParts(field);
  discardPendingEdit(field);

  const valueIndex = findNewRuleValueIndex(newRule[key], value);
  if (valueIndex === -1) return;

  pendingNewRuleChipEdits[field] = { value, index: valueIndex };
  newRule[key].splice(valueIndex, 1);
  renderNewRuleChips(field);

  if (input) {
    input.value = value;
    input.focus();
    const cursorOffset = input.value.length;
    input.setSelectionRange(cursorOffset, cursorOffset);
  }
  updateFilterCreatorSaveState();
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
    if (showingFiltered) renderFilteredInFilterView();
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

/** Creator chips currently lifted into the input for editing. */
const pendingNewRuleChipEdits = { repo: null, kw: null };

/** Index of the rule currently being edited, or -1 when creating a new rule. */
let editingRuleIndex = -1;

/** Index of the rule awaiting delete confirmation, or -1 when none. */
let confirmingDeleteIndex = -1;
let confirmingDeleteTimer = null;

function updateFilterCreatorLabel() {
  if (!filterCreatorLabel) return;
  filterCreatorLabel.textContent = editingRuleIndex >= 0 ? "Edit Rule" : "New Rule";
}

function showSyncStatus(text, isError = false) {
  if (!syncStatus) return;
  syncStatus.textContent = text;
  syncStatus.classList.toggle("error", isError);
  syncStatus.hidden = false;
}

function hideSyncStatus() {
  if (!syncStatus) return;
  syncStatus.hidden = true;
}

async function initSyncUI() {
  if (!syncToggle) return;
  try {
    const state = await sendMessage(MESSAGE_TYPES.SYNC_GET_STATE);
    syncToggle.checked = state.enabled;
    if (syncActions) syncActions.hidden = !state.enabled;
    updateSyncGistLink(state.gistId);
    updateSyncLastPush(state.lastPush);
  } catch {
    syncToggle.checked = false;
  }
}

function applyPulledFilter(filter) {
  currentFilterRules = filter;
  currentFilterStats = [];
  renderRuleRows(currentFilterRules, currentFilterStats);
  updateFilterIndicator(currentFilterRules);
}

async function silentPull() {
  try {
    const result = await sendMessage(MESSAGE_TYPES.SYNC_PULL);
    if (result.error === "conflict") {
      showSyncConflict();
      return;
    }
    if (result.success && !result.skipped) {
      applyPulledFilter(result.filter);
    }
  } catch {}
}

function updateSyncGistLink(gistId) {
  if (!syncGistLink || !syncGistText) return;
  if (gistId) {
    syncGistLink.href = `https://gist.github.com/${gistId}`;
    syncGistLink.hidden = false;
    syncGistText.hidden = true;
  } else {
    syncGistLink.hidden = true;
    syncGistText.hidden = false;
  }
}

function updateSyncLastPush(isoString) {
  if (!syncLastEl) return;
  if (!isoString) {
    syncLastEl.hidden = true;
    syncLastEl.removeAttribute("title");
    return;
  }
  const text = formatTimeAgo(isoString);
  syncLastEl.textContent = ` · ${text}`;
  syncLastEl.hidden = false;
  syncLastEl.title = `Last synced: ${new Date(isoString).toLocaleString()}`;
}

async function handleSyncToggle() {
  const enabled = syncToggle.checked;
  hideSyncStatus();

  if (enabled) {
    syncToggle.disabled = true;
    showSyncStatus("Enabling sync...");
    try {
      const result = await Promise.race([
        sendMessage(MESSAGE_TYPES.SYNC_ENABLE),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 30000)),
      ]);
      if (!result.success) {
        if (result.error === "conflict") {
          if (syncActions) syncActions.hidden = true;
          updateSyncGistLink(result.gistId);
          showSyncConflict();
          return;
        }
        syncToggle.checked = false;
        if (result.error === "missing_scope") {
          const authMethod = await storage.getAuthMethod();
          if (authMethod === "oauth") {
            showSyncStatus("Re-login via OAuth to grant the gist scope.", true);
          } else {
            const link = document.createElement("a");
            link.href = "https://github.com/settings/tokens";
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "gist scope";
            showSyncStatus("", true);
            syncStatus.replaceChildren(
              document.createTextNode("Add the "),
              link,
              document.createTextNode(" to your token on GitHub."),
            );
          }
        } else {
          showSyncStatus(result.error || "Failed to enable sync.", true);
        }
        return;
      }
      if (syncActions) syncActions.hidden = false;
      updateSyncGistLink(result.gistId);
      updateSyncLastPush(new Date().toISOString());
      showSyncStatus("Synced.");
      setTimeout(hideSyncStatus, 3000);
    } catch (err) {
      syncToggle.checked = false;
      showSyncStatus(err.message || "Failed to enable sync.", true);
    } finally {
      syncToggle.disabled = false;
    }
  } else {
    try {
      await sendMessage(MESSAGE_TYPES.SYNC_DISABLE);
    } catch {}
    if (syncActions) syncActions.hidden = true;
  }
}

async function handleSyncPull() {
  hideSyncStatus();
  showSyncStatus("Pulling...");
  try {
    const result = await sendMessage(MESSAGE_TYPES.SYNC_PULL);
    if (!result.success) {
      if (result.error === "conflict") {
        showSyncConflict();
        return;
      }
      showSyncStatus(result.error === "gist_not_found" ? "Gist not found." : "Pull failed.", true);
      return;
    }
    if (result.skipped) {
      showSyncStatus("Already in sync.");
    } else {
      applyPulledFilter(result.filter);
      updateSyncLastPush(new Date().toISOString());
      showSyncStatus("Pulled.");
    }
    setTimeout(hideSyncStatus, 3000);
  } catch {
    showSyncStatus("Pull failed.", true);
  }
}

async function handleSyncPush() {
  hideSyncStatus();
  showSyncStatus("Pushing...");
  try {
    const result = await sendMessage(MESSAGE_TYPES.SYNC_PUSH);
    if (!result.success) {
      if (result.error === "conflict") {
        showSyncConflict();
        return;
      }
      showSyncStatus(result.error || "Push failed.", true);
      return;
    }
    if (result.skipped) {
      showSyncStatus("Already in sync.");
    } else {
      updateSyncLastPush(new Date().toISOString());
      showSyncStatus("Pushed.");
    }
    setTimeout(hideSyncStatus, 3000);
  } catch {
    showSyncStatus("Push failed.", true);
  }
}

function showSyncConflict() {
  if (syncActions) syncActions.hidden = true;
  if (syncConflict) syncConflict.hidden = false;
  showSyncStatus("Local and remote differ.", true);
}

function hideSyncConflict() {
  if (syncConflict) syncConflict.hidden = true;
  if (syncActions) syncActions.hidden = false;
  hideSyncStatus();
}

async function handleSyncResolve(choice) {
  hideSyncStatus();
  showSyncStatus(choice === "local" ? "Pushing local..." : "Applying remote...");
  try {
    const result = await sendMessage(MESSAGE_TYPES.SYNC_RESOLVE_CONFLICT, { choice });
    if (!result.success) {
      showSyncStatus(result.error || "Failed.", true);
      return;
    }
    if (choice === "remote") {
      applyPulledFilter(result.filter);
    }
    hideSyncConflict();
    updateSyncLastPush(new Date().toISOString());
    showSyncStatus("Synced.");
    setTimeout(hideSyncStatus, 3000);
  } catch {
    showSyncStatus("Failed to resolve.", true);
  }
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

async function refreshFilteredBadge() {
  const notifications = await storage.getNotifications();
  const filtered = notifications.filter((n) => n.matchedRules?.length);
  updateFilteredBadge(filtered.length);
  return filtered;
}

async function renderFilteredInFilterView() {
  if (!filteredNotificationsList) return;
  const filtered = await refreshFilteredBadge();
  renderNotificationsInto(filteredNotificationsList, groupByRepo(filtered));
}

async function toggleFilteredInFilterView() {
  if (!filterRulesList || !filteredNotificationsContainer) return;

  showingFiltered = !showingFiltered;

  if (showingFiltered) {
    creatorWasOpen = filterCreator && !filterCreator.hidden;
    filterRulesList.hidden = true;
    if (filterCreator) filterCreator.hidden = true;
    await renderFilteredInFilterView();
    filteredNotificationsContainer.hidden = false;
  } else {
    filteredNotificationsContainer.hidden = true;
    filterRulesList.hidden = false;
    if (filterCreator && creatorWasOpen) filterCreator.hidden = false;
  }
  syncFilterOverlayHeight(true);
}

/**
 * Hide filter view and re-render notifications from storage
 * to reflect any filter changes made while the view was open.
 */
async function hideFilter() {
  showingFiltered = false;
  if (filteredNotificationsContainer) filteredNotificationsContainer.hidden = true;
  if (filterRulesList) filterRulesList.hidden = false;
  toggleOverlayView(false);
  filterView.hidden = true;
  setFilterLayoutState(false);
  // Re-render from storage so filter changes are visible immediately
  try {
    const notifications = await storage.getNotifications();
    renderWithFiltered(notifications, false);
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
  pendingNewRuleChipEdits.repo = null;
  pendingNewRuleChipEdits.kw = null;
  if (filterNewRepoInput) {
    filterNewRepoInput.value = "";
  }
  if (filterNewKwInput) filterNewKwInput.value = "";
  renderNewRuleChips("repo");
  renderNewRuleChips("kw");
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
  pendingNewRuleChipEdits.repo = null;
  pendingNewRuleChipEdits.kw = null;
  if (filterNewRepoInput) filterNewRepoInput.value = "";
  if (filterNewKwInput) filterNewKwInput.value = "";
  updateFilterCreatorLabel();
  if (filterCreator) filterCreator.hidden = true;
  if (filterCreatorToggle) filterCreatorToggle.textContent = "+ New Rule";
  if (filterAddRuleBtn) filterAddRuleBtn.hidden = true;
  updateFilterCreatorSaveState();
  renderRuleRows(currentFilterRules, currentFilterStats);
  requestAnimationFrame(() => syncFilterOverlayHeight(true));
}

/**
 * Add a value to the new-rule creator's repo or keyword list.
 * @param {"repo"|"kw"} field
 */
function addToNewRule(field) {
  const { input } = getNewRuleFieldParts(field);
  commitCreatorInput(field);
  input?.focus();
}

/**
 * Commit the new rule from the creator form to the saved list.
 */
async function submitNewRule() {
  commitCreatorInput("repo");
  commitCreatorInput("kw");
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
  currentFilterStats = await storage.getNotificationFilterStats();
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
      renderWithFiltered(nextNotifications, false);
      if (showingFiltered) renderFilteredInFilterView();
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
    onMarkAsReadSuccess: refreshFilteredBadge,
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

    renderWithFiltered(state.notifications, true); // Re-sort on init
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

    silentPull().catch(() => {});
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
filterCountBadge?.addEventListener("click", toggleFilteredInFilterView);
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
filterNewKwInput?.addEventListener("input", updateFilterCreatorSaveState);
filterNewKwInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addToNewRule("kw");
});

syncToggle?.addEventListener("change", handleSyncToggle);
syncPushBtn?.addEventListener("click", handleSyncPush);
syncPullBtn?.addEventListener("click", handleSyncPull);
syncUseLocalBtn?.addEventListener("click", () => handleSyncResolve("local"));
syncUseRemoteBtn?.addEventListener("click", () => handleSyncResolve("remote"));

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
    renderWithFiltered(newNotifications, false);
    if (showingFiltered) renderFilteredInFilterView();
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
