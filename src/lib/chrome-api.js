/**
 * Browser API helpers with Promise wrappers
 * Cross-browser compatible (Chrome & Firefox)
 */

// Browser compatibility layer
const api = typeof browser !== 'undefined' ? browser : chrome;

// Storage API
export const storage = {
  local: {
    get(keys) {
      return new Promise((resolve) => {
        api.storage.local.get(keys, resolve);
      });
    },
    set(items) {
      return new Promise((resolve) => {
        api.storage.local.set(items, resolve);
      });
    },
    remove(keys) {
      return new Promise((resolve) => {
        api.storage.local.remove(keys, resolve);
      });
    },
    clear() {
      return new Promise((resolve) => {
        api.storage.local.clear(resolve);
      });
    }
  },
  onChanged: api.storage.onChanged
};

// Runtime API
export const runtime = {
  sendMessage(message) {
    return new Promise((resolve) => {
      api.runtime.sendMessage(message, resolve);
    });
  },
  onMessage: api.runtime.onMessage,
  onStartup: api.runtime.onStartup,
  onInstalled: api.runtime.onInstalled,
  getURL(path) {
    return api.runtime.getURL(path);
  }
};

// Action API
export const action = {
  setBadgeText(details) {
    return new Promise((resolve) => {
      api.action.setBadgeText(details, resolve);
    });
  },
  setBadgeBackgroundColor(details) {
    return new Promise((resolve) => {
      api.action.setBadgeBackgroundColor(details, resolve);
    });
  },
  setTitle(details) {
    return new Promise((resolve) => {
      api.action.setTitle(details, resolve);
    });
  }
};

// Alarms API
export const alarms = {
  create(name, alarmInfo) {
    return new Promise((resolve) => {
      api.alarms.create(name, alarmInfo, resolve);
    });
  },
  clear(name) {
    return new Promise((resolve) => {
      api.alarms.clear(name, resolve);
    });
  },
  getAll() {
    return new Promise((resolve) => {
      api.alarms.getAll(resolve);
    });
  },
  onAlarm: api.alarms.onAlarm
};

// Tabs API
export const tabs = {
  create(createProperties) {
    return new Promise((resolve) => {
      api.tabs.create(createProperties, resolve);
    });
  }
};

// Notifications API
export const notifications = {
  create(notificationId, options) {
    return new Promise((resolve) => {
      api.notifications.create(notificationId, options, resolve);
    });
  },
  clear(notificationId) {
    return new Promise((resolve) => {
      api.notifications.clear(notificationId, resolve);
    });
  },
  onClicked: api.notifications.onClicked
};
