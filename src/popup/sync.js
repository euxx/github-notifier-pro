/**
 * Gist sync UI module.
 *
 * Owns the sync toggle, push/pull buttons, conflict resolution UI, and the
 * status/last-push readouts that live inside the filter view's settings.
 *
 * popup.js wires this up by passing in onPulledFilter so a successful pull
 * (or remote conflict resolution) can hand the new rules back to the filter
 * module for re-render.
 */

import { MESSAGE_TYPES } from "../lib/constants.js";
import { formatTimeAgo } from "./notification-renderer.js";

const STATUS_AUTO_HIDE_MS = 3000;
const ENABLE_TIMEOUT_MS = 30000;

/**
 * @param {Object} deps
 * @param {Function} deps.sendMessage - send message to background worker
 * @param {Object} deps.storage - storage module (getAuthMethod)
 * @param {(rules: Array) => void | Promise<void>} deps.onPulledFilter - apply pulled rules to filter view
 * @returns {{ init: Function, silentPull: Function }}
 */
export function createSync(deps) {
  const { sendMessage, storage, onPulledFilter } = deps;

  // ─── DOM ──────────────────────────────────────────────────────────────
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

  // ─── Status helpers ───────────────────────────────────────────────────
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

  // ─── Init ─────────────────────────────────────────────────────────────
  async function init() {
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

  async function silentPull() {
    try {
      const result = await sendMessage(MESSAGE_TYPES.SYNC_PULL);
      if (result.error === "conflict") {
        showSyncConflict();
        return;
      }
      if (result.success && !result.skipped) {
        await onPulledFilter(result.filter);
      }
    } catch {}
  }

  // ─── Event handlers ───────────────────────────────────────────────────
  async function handleSyncToggle() {
    const enabled = syncToggle.checked;
    hideSyncStatus();

    if (enabled) {
      syncToggle.disabled = true;
      showSyncStatus("Enabling sync...");
      try {
        const result = await Promise.race([
          sendMessage(MESSAGE_TYPES.SYNC_ENABLE),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), ENABLE_TIMEOUT_MS),
          ),
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
        setTimeout(hideSyncStatus, STATUS_AUTO_HIDE_MS);
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
        showSyncStatus(
          result.error === "gist_not_found" ? "Gist not found." : "Pull failed.",
          true,
        );
        return;
      }
      if (result.skipped) {
        showSyncStatus("Already in sync.");
      } else {
        await onPulledFilter(result.filter);
        updateSyncLastPush(new Date().toISOString());
        showSyncStatus("Pulled.");
      }
      setTimeout(hideSyncStatus, STATUS_AUTO_HIDE_MS);
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
      setTimeout(hideSyncStatus, STATUS_AUTO_HIDE_MS);
    } catch {
      showSyncStatus("Push failed.", true);
    }
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
        await onPulledFilter(result.filter);
      }
      hideSyncConflict();
      updateSyncLastPush(new Date().toISOString());
      showSyncStatus("Synced.");
      setTimeout(hideSyncStatus, STATUS_AUTO_HIDE_MS);
    } catch {
      showSyncStatus("Failed to resolve.", true);
    }
  }

  // ─── Event wiring ─────────────────────────────────────────────────────
  syncToggle?.addEventListener("change", handleSyncToggle);
  syncPushBtn?.addEventListener("click", handleSyncPush);
  syncPullBtn?.addEventListener("click", handleSyncPull);
  syncUseLocalBtn?.addEventListener("click", () => handleSyncResolve("local"));
  syncUseRemoteBtn?.addEventListener("click", () => handleSyncResolve("remote"));

  return { init, silentPull };
}
