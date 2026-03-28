/**
 * Browser API helpers with Promise wrappers
 * Cross-browser compatible (Chrome 99+ & Firefox 110+)
 *
 * Requires Chrome 99+ because runtime.sendMessage() only returns a Promise
 * from Chrome 99 onward. All other storage/alarms/action APIs return Promises
 * from Chrome 88+. Firefox 110+ supports Promise-based APIs throughout.
 *
 * We call the native APIs directly rather than wrapping them in callback-based
 * Promises, which avoids callbacks being silently ignored by the browser.
 */

// Firefox uses the `browser` namespace; Chrome uses `chrome`.
// Both return Promises from their extension APIs at the declared minimum versions.
const api = typeof browser !== "undefined" ? browser : chrome;

// Storage API
export const storage = {
  local: {
    get(keys) {
      return api.storage.local.get(keys);
    },
    set(items) {
      return api.storage.local.set(items);
    },
    remove(keys) {
      return api.storage.local.remove(keys);
    },
    clear() {
      return api.storage.local.clear();
    },
  },
  onChanged: api.storage.onChanged,
};

// Runtime API
export const runtime = {
  sendMessage(message) {
    // In Firefox, passing a callback to browser.runtime.sendMessage is unsupported;
    // both Chrome MV3 (99+) and Firefox return a Promise directly.
    return api.runtime.sendMessage(message);
  },
  onMessage: api.runtime.onMessage,
  onStartup: api.runtime.onStartup,
  onInstalled: api.runtime.onInstalled,
  getURL(path) {
    return api.runtime.getURL(path);
  },
};

// Action API
export const action = {
  setBadgeText(details) {
    return api.action.setBadgeText(details);
  },
  setBadgeBackgroundColor(details) {
    return api.action.setBadgeBackgroundColor(details);
  },
  setTitle(details) {
    return api.action.setTitle(details);
  },
};

// Alarms API
export const alarms = {
  create(name, alarmInfo) {
    // alarms.create is fire-and-forget; passing a callback is not supported
    // across all versions, so we call it directly and resolve immediately.
    api.alarms.create(name, alarmInfo);
    return Promise.resolve();
  },
  clear(name) {
    return api.alarms.clear(name);
  },
  getAll() {
    return api.alarms.getAll();
  },
  onAlarm: api.alarms.onAlarm,
};

// Tabs API
export const tabs = {
  create(createProperties) {
    return api.tabs.create(createProperties);
  },
};

// Notifications API
export const notifications = {
  create(notificationId, options) {
    return api.notifications.create(notificationId, options);
  },
  clear(notificationId) {
    return api.notifications.clear(notificationId);
  },
  onClicked: api.notifications.onClicked,
};
