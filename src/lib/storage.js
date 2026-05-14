/**
 * Storage utility for browser extensions
 * Cross-browser compatible (Chrome 99+ & Firefox 110+)
 *
 * Both Chrome 88+ and Firefox return Promises from storage APIs.
 * We use them directly instead of callback-based wrappers.
 */

import { DEFAULT_POPUP_WIDTH } from "./constants.js";
import { storage as browserStorage } from "./chrome-api.js";

const STORAGE_KEYS = {
  TOKEN: "token",
  USERNAME: "username",
  USER_INFO: "userInfo", // {login, avatar_url, html_url}
  AUTH_METHOD: "authMethod", // 'oauth' or 'pat'
  NOTIFICATIONS: "notifications",
  LAST_CHECK: "lastCheck",
  THEME: "theme", // 'light', 'dark', or 'system'
  POPUP_WIDTH: "popupWidth", // 400-800
  // Desktop notification settings
  ENABLE_DESKTOP_NOTIFICATIONS: "enableDesktopNotifications", // boolean
  MAX_DESKTOP_NOTIFICATIONS: "maxDesktopNotifications", // number (default 5)
  // Notification filter: array of { repos: string[], keywords: string[] } rules
  NOTIFICATION_FILTER: "notificationFilter",
  // Per-rule filter stats from the last full refresh.
  // Array parallel to NOTIFICATION_FILTER:
  //   [{ repos: { "owner/repo" (lowercase): count }, keywords: { keyword: count } }, ...]
  NOTIFICATION_FILTER_STATS: "notificationFilterStats",
  // Gist sync
  SYNC_ENABLED: "syncEnabled", // boolean
  SYNC_GIST_ID: "syncGistId", // string — gist ID for filter sync
  SYNC_LAST_PUSH: "syncLastPush", // ISO timestamp of last successful push
  SYNC_LAST_PUSHED_FILTER: "syncLastPushedFilter", // JSON snapshot of filter at last push
};

/**
 * Get value from storage
 */
export async function get(key, defaultValue = null) {
  const result = await browserStorage.local.get(key);
  return result[key] ?? defaultValue;
}

/**
 * Set value in storage
 */
export async function set(key, value) {
  return browserStorage.local.set({ [key]: value });
}

/**
 * Remove value from storage
 */
export async function remove(key) {
  return browserStorage.local.remove(key);
}

/**
 * Get multiple values
 */
export async function getMultiple(keys) {
  return browserStorage.local.get(keys);
}

/**
 * Set multiple values
 */
export async function setMultiple(data) {
  return browserStorage.local.set(data);
}

/**
 * Clear all storage
 */
export async function clear() {
  return browserStorage.local.clear();
}

/**
 * Clear only auth and notification data, preserving user preferences
 */
export async function clearAuthData() {
  return browserStorage.local.remove([
    STORAGE_KEYS.TOKEN,
    STORAGE_KEYS.USERNAME,
    STORAGE_KEYS.USER_INFO,
    STORAGE_KEYS.AUTH_METHOD,
    STORAGE_KEYS.NOTIFICATIONS,
    STORAGE_KEYS.LAST_CHECK,
    STORAGE_KEYS.NOTIFICATION_FILTER_STATS,
  ]);
}

// Convenience methods for specific data
export async function getToken() {
  return get(STORAGE_KEYS.TOKEN);
}

export async function setToken(token) {
  return set(STORAGE_KEYS.TOKEN, token);
}

export async function getUsername() {
  return get(STORAGE_KEYS.USERNAME);
}

export async function setUsername(username) {
  return set(STORAGE_KEYS.USERNAME, username);
}

export async function getUserInfo() {
  return get(STORAGE_KEYS.USER_INFO);
}

export async function setUserInfo(userInfo) {
  return set(STORAGE_KEYS.USER_INFO, userInfo);
}

export async function getNotifications() {
  return get(STORAGE_KEYS.NOTIFICATIONS, []);
}

export async function setNotifications(notifications) {
  await set(STORAGE_KEYS.NOTIFICATIONS, notifications);
}

export async function getAuthMethod() {
  return get(STORAGE_KEYS.AUTH_METHOD, "pat"); // Default to PAT
}

export async function setAuthMethod(authMethod) {
  return set(STORAGE_KEYS.AUTH_METHOD, authMethod);
}

export async function getTheme() {
  return get(STORAGE_KEYS.THEME, "system"); // default to system (follow system)
}

export async function setTheme(theme) {
  return set(STORAGE_KEYS.THEME, theme);
}

export async function getPopupWidth() {
  return get(STORAGE_KEYS.POPUP_WIDTH, DEFAULT_POPUP_WIDTH);
}

export async function setPopupWidth(width) {
  return set(STORAGE_KEYS.POPUP_WIDTH, width);
}

// Desktop notification settings
export async function getEnableDesktopNotifications() {
  return get(STORAGE_KEYS.ENABLE_DESKTOP_NOTIFICATIONS, false); // default false
}

export async function setEnableDesktopNotifications(enable) {
  return set(STORAGE_KEYS.ENABLE_DESKTOP_NOTIFICATIONS, enable);
}

export async function getMaxDesktopNotifications() {
  const value = await get(STORAGE_KEYS.MAX_DESKTOP_NOTIFICATIONS, 5); // default 5

  // Clamp to [1, 5] integer range, falling back to the minimum on invalid input.
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(5, n);
}

export async function setMaxDesktopNotifications(max) {
  return set(STORAGE_KEYS.MAX_DESKTOP_NOTIFICATIONS, max);
}

// Notification filter: array of rules, each with repos and keywords.
// A notification is hidden if it matches ANY rule.
// repos: [] means apply to all repos; non-empty means only those repos.
// keywords: title substrings that, when matched, hide the notification (case-insensitive).
export async function getNotificationFilter() {
  return get(STORAGE_KEYS.NOTIFICATION_FILTER, []);
}

export async function setNotificationFilter(filter) {
  return set(STORAGE_KEYS.NOTIFICATION_FILTER, filter);
}

// Filter stats: array parallel to filter rules. Each element contains:
//   - repos: { [repoFullNameLowercase]: count } — notifications filtered per repo
//   - keywords: { [keyword]: count }  — notifications matched per keyword
// Both counts reflect the most recent full checkNotifications() pass.
export async function getNotificationFilterStats() {
  return get(STORAGE_KEYS.NOTIFICATION_FILTER_STATS, []);
}

export async function setNotificationFilterStats(stats) {
  return set(STORAGE_KEYS.NOTIFICATION_FILTER_STATS, stats);
}

// Gist sync settings
export async function getSyncEnabled() {
  return get(STORAGE_KEYS.SYNC_ENABLED, false);
}

export async function setSyncEnabled(enabled) {
  return set(STORAGE_KEYS.SYNC_ENABLED, enabled);
}

export async function getSyncGistId() {
  return get(STORAGE_KEYS.SYNC_GIST_ID, null);
}

export async function setSyncGistId(id) {
  return set(STORAGE_KEYS.SYNC_GIST_ID, id);
}

export async function getSyncLastPush() {
  return get(STORAGE_KEYS.SYNC_LAST_PUSH, null);
}

export async function setSyncLastPush(isoString) {
  return set(STORAGE_KEYS.SYNC_LAST_PUSH, isoString);
}

export async function getSyncLastPushedFilter() {
  return get(STORAGE_KEYS.SYNC_LAST_PUSHED_FILTER, null);
}

export async function setSyncLastPushedFilter(filter) {
  return set(STORAGE_KEYS.SYNC_LAST_PUSHED_FILTER, filter === null ? null : JSON.stringify(filter));
}

export { STORAGE_KEYS };
