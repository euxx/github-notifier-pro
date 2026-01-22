/**
 * Storage utility for Chrome extension
 * Uses Chrome Storage API directly
 */

import { DEFAULT_POPUP_WIDTH } from './constants.js';

const STORAGE_KEYS = {
  TOKEN: 'token',
  USERNAME: 'username',
  AUTH_METHOD: 'authMethod', // 'oauth' or 'pat'
  NOTIFICATIONS: 'notifications',
  LAST_CHECK: 'lastCheck',
  THEME: 'theme', // 'light', 'dark', or 'system'
  POPUP_WIDTH: 'popupWidth', // 400-800
  SHOW_HOVER_CARDS: 'showHoverCards', // boolean
  // Desktop notification settings
  ENABLE_DESKTOP_NOTIFICATIONS: 'enableDesktopNotifications', // boolean
  SILENT_MODE: 'silentMode', // boolean
};

/**
 * Get value from storage
 */
export async function get(key, defaultValue = null) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result[key] ?? defaultValue);
    });
  });
}

/**
 * Set value in storage
 */
export async function set(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

/**
 * Remove value from storage
 */
export async function remove(key) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(key, resolve);
  });
}

/**
 * Get multiple values
 */
export async function getMultiple(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

/**
 * Set multiple values
 */
export async function setMultiple(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

/**
 * Clear all storage
 */
export async function clear() {
  return new Promise((resolve) => {
    chrome.storage.local.clear(resolve);
  });
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
  return get(STORAGE_KEYS.SHOW_HOVER_CARDS, true); // default true
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

export async function getSilentMode() {
  return get(STORAGE_KEYS.SILENT_MODE, false); // default false
}

export async function setSilentMode(silent) {
  return set(STORAGE_KEYS.SILENT_MODE, silent);
}

export { STORAGE_KEYS };
