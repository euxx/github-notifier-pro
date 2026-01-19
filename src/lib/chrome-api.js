/**
 * Chrome API helpers with Promise wrappers
 * Simplified version for Chrome-only extension
 */

// Storage API
export const storage = {
  local: {
    get(keys) {
      return new Promise((resolve) => {
        chrome.storage.local.get(keys, resolve);
      });
    },
    set(items) {
      return new Promise((resolve) => {
        chrome.storage.local.set(items, resolve);
      });
    },
    remove(keys) {
      return new Promise((resolve) => {
        chrome.storage.local.remove(keys, resolve);
      });
    },
    clear() {
      return new Promise((resolve) => {
        chrome.storage.local.clear(resolve);
      });
    }
  },
  onChanged: chrome.storage.onChanged
};

// Runtime API
export const runtime = {
  sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    });
  },
  onMessage: chrome.runtime.onMessage,
  onStartup: chrome.runtime.onStartup,
  onInstalled: chrome.runtime.onInstalled,
  getURL(path) {
    return chrome.runtime.getURL(path);
  }
};

// Action API
export const action = {
  setBadgeText(details) {
    return new Promise((resolve) => {
      chrome.action.setBadgeText(details, resolve);
    });
  },
  setBadgeBackgroundColor(details) {
    return new Promise((resolve) => {
      chrome.action.setBadgeBackgroundColor(details, resolve);
    });
  },
  setTitle(details) {
    return new Promise((resolve) => {
      chrome.action.setTitle(details, resolve);
    });
  }
};

// Alarms API
export const alarms = {
  create(name, alarmInfo) {
    return new Promise((resolve) => {
      chrome.alarms.create(name, alarmInfo, resolve);
    });
  },
  clear(name) {
    return new Promise((resolve) => {
      chrome.alarms.clear(name, resolve);
    });
  },
  getAll() {
    return new Promise((resolve) => {
      chrome.alarms.getAll(resolve);
    });
  },
  onAlarm: chrome.alarms.onAlarm
};

// Tabs API
export const tabs = {
  create(createProperties) {
    return new Promise((resolve) => {
      chrome.tabs.create(createProperties, resolve);
    });
  }
};
