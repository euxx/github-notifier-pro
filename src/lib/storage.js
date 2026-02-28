/**
 * Storage utility for browser extensions
 * Cross-browser compatible (Chrome 99+ & Firefox 110+)
 *
 * Both Chrome 88+ and Firefox return Promises from storage APIs.
 * We use them directly instead of callback-based wrappers.
 */

import { DEFAULT_POPUP_WIDTH } from './constants.js';
import { storage as browserStorage } from './chrome-api.js';

const STORAGE_KEYS = {
  TOKEN: 'token',
  USERNAME: 'username',
  USER_INFO: 'userInfo', // {login, avatar_url, html_url}
  AUTH_METHOD: 'authMethod', // 'oauth' or 'pat'
  NOTIFICATIONS: 'notifications',
  LAST_CHECK: 'lastCheck',
  THEME: 'theme', // 'light', 'dark', or 'system'
  POPUP_WIDTH: 'popupWidth', // 400-800
  SHOW_HOVER_CARDS: 'showHoverCards', // boolean
  // Desktop notification settings
  ENABLE_DESKTOP_NOTIFICATIONS: 'enableDesktopNotifications', // boolean
  MAX_DESKTOP_NOTIFICATIONS: 'maxDesktopNotifications', // number (default 5)
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
  return get(STORAGE_KEYS.AUTH_METHOD, 'pat'); // Default to PAT
}

export async function setAuthMethod(authMethod) {
  return set(STORAGE_KEYS.AUTH_METHOD, authMethod);
}

export async function getTheme() {
  return get(STORAGE_KEYS.THEME, 'system'); // default to system (follow system)
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

export async function getShowHoverCards() {
  return get(STORAGE_KEYS.SHOW_HOVER_CARDS, false); // default false
}

export async function setShowHoverCards(show) {
  return set(STORAGE_KEYS.SHOW_HOVER_CARDS, show);
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

  // Validate: minimum 1, maximum 5
  const numValue = Number(value);
  if (isNaN(numValue) || numValue < 1) {
    return 1; // minimum 1
  }
  if (numValue > 5) {
    return 5; // maximum 5
  }
  return Math.floor(numValue); // ensure integer
}

export async function setMaxDesktopNotifications(max) {
  return set(STORAGE_KEYS.MAX_DESKTOP_NOTIFICATIONS, max);
}

export { STORAGE_KEYS };
