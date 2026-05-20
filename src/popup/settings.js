/**
 * Settings view module.
 *
 * Owns the settings panel: theme picker, popup width controls, desktop
 * notification toggle (with browser-permission flow), and the user-info
 * footer with the sign-out action.
 *
 * popup.js wires this up by passing in cross-view helpers it controls
 * (toggleOverlayView, applyInitialPopupWidth's helpers via getCached* /
 * setCached* deps, system-theme reactivity), the auth-method label
 * builder, profile-link updater, and an onLogout callback that tears
 * down the main-view countdown / view stack.
 *
 * Mirrors the createFilter / createSync pattern: createSettings(deps)
 * returns { show, hide, init }, owns its own DOM event wiring, and never
 * reaches into popup.js's view stack directly.
 */

import { MIN_POPUP_WIDTH, MAX_POPUP_WIDTH, POPUP_WIDTH_STEP } from "../lib/constants.js";
import { applyTheme } from "../lib/theme.js";
import { getAvatarSrc } from "../lib/avatar-cache.js";

function clampPopupWidth(width) {
  return Math.min(MAX_POPUP_WIDTH, Math.max(MIN_POPUP_WIDTH, width));
}

function hasExtensionNotifications() {
  return (
    (typeof chrome !== "undefined" && !!chrome.notifications) ||
    (typeof browser !== "undefined" && !!browser.notifications)
  );
}

function checkNotificationPermission() {
  if (hasExtensionNotifications()) return "granted";
  if (typeof Notification === "undefined") {
    console.warn("Notification API not available");
    return "unsupported";
  }
  return Notification.permission;
}

async function requestNotificationPermission() {
  if (hasExtensionNotifications()) return "granted";
  if (typeof Notification === "undefined") {
    console.warn("Notification API not available");
    return "unsupported";
  }
  try {
    return await Notification.requestPermission();
  } catch (error) {
    console.error("Failed to request notification permission:", error);
    return "denied";
  }
}

/**
 * @param {Object} deps
 * @param {Object} deps.storage - storage module (theme / popup width / desktop-notif preferences / username / userInfo / authMethod)
 * @param {Function} deps.toggleOverlayView - show/hide overlay (header/footer/main list)
 * @param {(theme: string) => void} deps.setCachedTheme - localStorage cache writer used by popup boot path
 * @param {(width: number) => void} deps.setCachedPopupWidth - localStorage cache writer used by popup boot path
 * @param {() => void} deps.updateScrollbarCompensation - re-measure scrollbar after width change
 * @param {(authMethod: string) => { shortLabel: string, fullLabel: string }} deps.getAuthMethodLabels
 * @param {(username: string|null, userInfo: Object|null) => void} deps.updateProfileLinks
 * @param {() => Promise<void>} deps.onLogout - tear down main-view state (stop countdown, clear UI, switch to login)
 * @param {Object} deps.sync - sync module exposing init() so opening Settings refreshes the gist sync state
 * @returns {{ show: Function, hide: Function, init: Function }}
 */
export function createSettings(deps) {
  const {
    storage,
    toggleOverlayView,
    setCachedTheme,
    setCachedPopupWidth,
    updateScrollbarCompensation,
    getAuthMethodLabels,
    updateProfileLinks,
    onLogout,
    sync,
  } = deps;

  // ─── DOM ──────────────────────────────────────────────────────────────
  const settingsIconBtn = document.getElementById("settings-icon-btn");
  const settingsView = document.getElementById("settings-view");
  const settingsBackBtn = document.getElementById("settings-back-btn");
  const themeRadios = document.querySelectorAll('input[name="theme"]');
  const settingsLogoutBtn = document.getElementById("settings-logout-btn");
  const settingsUsernameEl = document.getElementById("settings-username");
  const settingsAvatarEl = document.getElementById("settings-avatar");
  const settingsAuthMethodEl = document.getElementById("settings-auth-method");
  const popupWidthInput = document.getElementById("popup-width-input");
  const widthDecreaseBtn = document.getElementById("width-decrease");
  const widthIncreaseBtn = document.getElementById("width-increase");
  const desktopNotificationsToggle = document.getElementById("desktop-notifications-toggle");
  const desktopNotificationsHint = document.getElementById("desktop-notifications-hint");

  // ─── Show / hide ──────────────────────────────────────────────────────
  async function show() {
    const theme = (await storage.getTheme()) || "system";
    themeRadios.forEach((radio) => {
      radio.checked = radio.value === theme;
    });

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

    const userInfo = await storage.getUserInfo();
    updateProfileLinks(username, userInfo);
    const cachedAvatarSrc = getAvatarSrc(userInfo);
    if (settingsAvatarEl && cachedAvatarSrc) {
      settingsAvatarEl.src = cachedAvatarSrc;
      settingsAvatarEl.alt = userInfo.login || "User";
      settingsAvatarEl.hidden = false;
    } else if (settingsAvatarEl) {
      settingsAvatarEl.hidden = true;
    }

    const width = await storage.getPopupWidth();
    popupWidthInput.value = width;
    updateWidthButtons(width);

    const enableDesktopNotifications = await storage.getEnableDesktopNotifications();
    desktopNotificationsToggle.checked = enableDesktopNotifications;

    const permission = checkNotificationPermission();
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
    sync.init();
    toggleOverlayView(true);
    settingsView.hidden = false;
  }

  function hide() {
    toggleOverlayView(false);
    settingsView.hidden = true;
  }

  // ─── Theme ────────────────────────────────────────────────────────────
  async function handleThemeChange() {
    const selectedTheme = document.querySelector('input[name="theme"]:checked');
    const theme = selectedTheme ? selectedTheme.value : "system";
    try {
      await storage.setTheme(theme);
    } catch (error) {
      console.error("Failed to save theme:", error);
    }
    setCachedTheme(theme);
    applyTheme(theme);
  }

  // System-theme reactivity. Registered once at init() and stays live for
  // the popup's lifetime; the popup closes on every interaction so leaking
  // it is not a real concern.
  function bindSystemThemeListener() {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", async () => {
      const currentTheme = await storage.getTheme();
      if (currentTheme === "system") {
        applyTheme("system");
      }
    });
  }

  // ─── Width ────────────────────────────────────────────────────────────
  async function handleWidthChange() {
    const parsed = parseInt(popupWidthInput.value, 10);
    const width = clampPopupWidth(isNaN(parsed) ? MIN_POPUP_WIDTH : parsed);
    popupWidthInput.value = width;
    document.body.style.width = `${width}px`;
    updateScrollbarCompensation();
    setCachedPopupWidth(width);
    updateWidthButtons(width);
    try {
      await storage.setPopupWidth(width);
    } catch (error) {
      console.error("Failed to save popup width:", error);
    }
  }

  async function decreaseWidth() {
    const currentWidth = parseInt(popupWidthInput.value, 10);
    popupWidthInput.value = clampPopupWidth(currentWidth - POPUP_WIDTH_STEP);
    await handleWidthChange();
  }

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

  // ─── Desktop notifications toggle ─────────────────────────────────────
  async function handleDesktopNotificationsChange() {
    const enabled = desktopNotificationsToggle.checked;
    if (desktopNotificationsHint) desktopNotificationsHint.hidden = true;

    if (enabled) {
      let permission = checkNotificationPermission();
      if (permission === "default" || permission === "prompt") {
        permission = await requestNotificationPermission();
      }
      if (permission === "granted") {
        await storage.setEnableDesktopNotifications(true);
      } else {
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
      await storage.setEnableDesktopNotifications(false);
    }
  }

  // ─── Logout ───────────────────────────────────────────────────────────
  // Order: tear down auth/view state first, then hide the panel. If
  // onLogout throws (MV3 background reconnecting, sendMessage failure)
  // settings stays open so the user sees the failure instead of being
  // dropped on a stale main list with no obvious recovery path.
  async function handleLogout() {
    await onLogout();
    hide();
  }

  // ─── Event wiring ─────────────────────────────────────────────────────
  settingsIconBtn?.addEventListener("click", show);
  settingsBackBtn?.addEventListener("click", hide);
  themeRadios.forEach((radio) => {
    radio.addEventListener("change", handleThemeChange);
  });
  popupWidthInput?.addEventListener("change", handleWidthChange);
  popupWidthInput?.addEventListener("blur", handleWidthChange);
  widthDecreaseBtn?.addEventListener("click", decreaseWidth);
  widthIncreaseBtn?.addEventListener("click", increaseWidth);
  desktopNotificationsToggle?.addEventListener("change", handleDesktopNotificationsChange);
  settingsLogoutBtn?.addEventListener("click", handleLogout);

  function init() {
    bindSystemThemeListener();
  }

  return { show, hide, init };
}
