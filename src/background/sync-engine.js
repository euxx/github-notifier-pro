/**
 * Filter rule sync engine.
 *
 * Owns the gist-backed sync workflow for notification filter rules:
 *   - applyRemoteRules: read remote, compare against local + last-pushed,
 *     decide skip / pushNeeded / accept / conflict
 *   - push: write local rules to remote, with conflict detection
 *   - pushIfEnabled: debounced auto-push on local filter changes
 *   - acceptRemoteFilter: persist newly accepted rules and run the host's
 *     post-accept hook (re-annotate notifications, update badge, etc.)
 *
 * The host (service-worker) injects github + storage + an onFilterReplaced
 * hook so domain side effects (re-annotation, badge, next-fetch trigger)
 * stay where they belong while the sync state machine lives here.
 */

import { sanitizeRules, canonicalizeRules, canonicalizeStoredRules } from "../lib/filter-rules.js";

const AUTO_PUSH_DEBOUNCE_MS = 2000;

/**
 * @param {Object} deps
 * @param {Object} deps.github - github API client
 * @param {Object} deps.storage - storage module
 * @param {(validRules: Array, updatedAt: string|null) => Promise<void>} deps.onFilterReplaced
 *   Called after a remote filter is accepted, before returning. The host runs
 *   its post-accept side effects here (re-annotate notifications, update
 *   badge, force the next fetch to be unconditional, etc.).
 * @returns {Object} sync engine API
 */
export function createSyncEngine(deps) {
  const { github, storage, onFilterReplaced } = deps;

  async function acceptRemoteFilter(valid, updatedAt) {
    await storage.setNotificationFilter(valid);
    await storage.setNotificationFilterStats([]);
    await storage.setSyncLastPushedFilter(valid);
    if (updatedAt) await storage.setSyncLastPush(updatedAt);
    await onFilterReplaced(valid, updatedAt ?? null);
  }

  async function applyRemoteRules(gistId) {
    const result = await github.getFilterGist(gistId);
    if (result === null) {
      return { success: false, error: "gist_not_found" };
    }
    const { rules, updatedAt: remoteUpdatedAt } = result;
    const valid = sanitizeRules(rules);
    const local = await storage.getNotificationFilter();
    const localRaw = canonicalizeRules(local);
    const remoteRaw = JSON.stringify(valid);
    if (localRaw === remoteRaw) {
      return { success: true, filter: valid, skipped: true, lastPush: remoteUpdatedAt };
    }
    const [lastPushedRaw, lastPush] = await Promise.all([
      storage.getSyncLastPushedFilter(),
      storage.getSyncLastPush(),
    ]);
    const normalizedLastPushedRaw = canonicalizeStoredRules(lastPushedRaw);
    const hasLocalEdits = normalizedLastPushedRaw !== null && normalizedLastPushedRaw !== localRaw;
    const remoteTimestampChanged = remoteUpdatedAt && lastPush && remoteUpdatedAt > lastPush;
    const hasRemoteEdits = remoteTimestampChanged && normalizedLastPushedRaw !== remoteRaw;

    if (hasLocalEdits && hasRemoteEdits) {
      return { success: false, error: "conflict", local, remote: valid };
    }
    if (hasLocalEdits && !hasRemoteEdits) {
      return { success: true, filter: local, skipped: true, pushNeeded: true };
    }
    await acceptRemoteFilter(valid, remoteUpdatedAt);
    return { success: true, filter: valid, lastPush: remoteUpdatedAt };
  }

  async function push({ afterPull = false } = {}) {
    const enabled = await storage.getSyncEnabled();
    if (!enabled) return { success: false, error: "sync_disabled" };
    const gistId = await storage.getSyncGistId();
    if (!gistId) return { success: false, error: "no_gist" };
    const [filter, lastPushedRaw] = await Promise.all([
      storage.getNotificationFilter(),
      storage.getSyncLastPushedFilter(),
    ]);
    const filterRaw = canonicalizeRules(filter);
    const normalizedLastPushedRaw = canonicalizeStoredRules(lastPushedRaw);
    if (afterPull && normalizedLastPushedRaw !== null && normalizedLastPushedRaw === filterRaw) {
      return { success: true, skipped: true };
    }
    if (!afterPull) {
      const result = await github.getFilterGist(gistId);
      if (result !== null) {
        const remoteRaw = canonicalizeRules(result.rules);
        if (remoteRaw === filterRaw) {
          return { success: true, skipped: true };
        }
        const lastPush = await storage.getSyncLastPush();
        if (
          result.updatedAt &&
          lastPush &&
          result.updatedAt > lastPush &&
          normalizedLastPushedRaw !== remoteRaw
        ) {
          return { success: false, error: "conflict", local: filter, remote: result.rules };
        }
      }
    }
    const updateResult = await github.updateFilterGist(gistId, filter);
    if (!updateResult) {
      // Gist was deleted externally — disable sync to avoid repeated failures
      await storage.setSyncGistId(null);
      await storage.setSyncEnabled(false);
      return { success: false, error: "gist_not_found" };
    }
    await storage.setSyncLastPush(updateResult.updatedAt || new Date().toISOString());
    await storage.setSyncLastPushedFilter(filter);
    return { success: true };
  }

  let autoPushTimer = null;
  function pushIfEnabled() {
    clearTimeout(autoPushTimer);
    autoPushTimer = setTimeout(async () => {
      try {
        const enabled = await storage.getSyncEnabled();
        if (!enabled) return;
        await push();
      } catch (err) {
        console.warn("Auto-push failed:", err.message || err);
      }
    }, AUTO_PUSH_DEBOUNCE_MS);
  }

  return {
    applyRemoteRules,
    acceptRemoteFilter,
    push,
    pushIfEnabled,
  };
}
