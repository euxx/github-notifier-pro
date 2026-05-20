/**
 * Avatar bytes cache, shared across the signed-in user and notification
 * authors. Stored at chrome.storage.local[AVATAR_DATA_CACHE] as a map
 * keyed by GitHub login.
 *
 * Brave's Shields bypasses HTTP caching for cross-origin requests issued
 * from extension pages, so an <img> assigned avatars.githubusercontent.com
 * re-downloads on every popup open. Caching the decoded bytes as a base64
 * data URL avoids any network on render — popups open with no flicker.
 *
 * Design notes:
 *   - Single writer: background only. Popup calls loadSnapshot() at init
 *     and reads from the module-owned snapshot via getAvatarSrc(person).
 *   - Freshness: URL match (handles Gravatar URL changes) + 7d TTL +
 *     If-Modified-Since revalidation (handles same-URL avatar uploads).
 *     Last-Modified is a CORS-safelisted response header, so it stays
 *     readable cross-browser; ETag is intentionally avoided.
 *   - Concurrency: at most FETCH_CONCURRENCY in-flight fetches; each
 *     ensureAvatarsCached call writes storage at most once (back-to-back
 *     calls are serialized but not coalesced).
 *   - Capacity: LRU on lastSeenAt; eviction triggered on every write.
 */

import * as storage from "./storage.js";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 100;
const MAX_BYTES_PER_AVATAR = 64 * 1024;
// Cap total cached dataUrl string length (data URLs are ASCII-only, so length
// ≈ byte count) so a worst case (many large avatars) cannot blow the 10 MB
// chrome.storage.local quota and silently brick the cache.
// 5 MB easily fits typical 80 px PNGs (~10 KB each) for 100 authors while
// leaving ~5 MB for the notifications list, filter, sync state, etc.
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const AVATAR_FETCH_SIZE = 80;
const FETCH_CONCURRENCY = 5;

let writeQueue = Promise.resolve();

// Module-owned read snapshot for popup-side renders. Loaded once via
// loadSnapshot() during popup init; the background never reads it.
let snapshot = {};

// Gate any cache work across auth transitions. clearAuthData wipes storage
// outside the writeQueue, so an in-flight ensureAvatarsCached call (or one
// queued by a runFetch that started before logout) would otherwise repopulate
// the cache after the wipe — possibly with a previous account's avatars if
// the user re-logs as someone else before the queued mutator runs. We use a
// generation counter rather than a boolean so cross-account races are caught
// even when setActive(true) has flipped the flag back on by the time the
// stale mutator reaches its final-write guard.
let generation = 0;
let active = true;

export function setActive(value) {
  generation++;
  active = value;
}

/**
 * Load the storage snapshot into module state. Call once during popup init.
 * Subsequent getAvatarSrc() calls render from this snapshot.
 */
export async function loadSnapshot() {
  snapshot = await storage.getAvatarDataCache();
}

/**
 * Synchronous lookup against the loaded snapshot. Returns the cached
 * bytes when the entry's URL matches `person.avatar_url`; staleness
 * (TTL/Last-Modified) is reconciled by the next background warmup
 * rather than here — popup-side renders prefer no-flicker over strict
 * freshness. Falls back to `person.avatar_url` when no entry exists.
 *
 * @param {{login?: string, avatar_url?: string}|null|undefined} person
 * @returns {string|null}
 */
export function getAvatarSrc(person) {
  if (!person) return null;
  const entry = snapshot[person.login];
  if (entry && entry.url === person.avatar_url && entry.dataUrl) {
    return entry.dataUrl;
  }
  return person.avatar_url || null;
}

/**
 * Warm the avatar cache for the given people. Skips fetch when the
 * entry is TTL-fresh; uses If-Modified-Since to revalidate otherwise.
 * Fire-and-forget safe — errors are swallowed.
 *
 * @param {Array<{login?: string, avatar_url?: string}>} people
 */
export async function ensureAvatarsCached(people) {
  if (!active) return;
  const capturedGen = generation;
  if (!Array.isArray(people) || people.length === 0) return;

  // Deduplicate by login; drop entries missing required fields.
  const unique = new Map();
  for (const p of people) {
    if (p?.login && p?.avatar_url && !unique.has(p.login)) {
      unique.set(p.login, p);
    }
  }
  if (unique.size === 0) return;

  await queueWrite(async () => {
    if (!active || generation !== capturedGen) return;
    const existing = await storage.getAvatarDataCache();
    const now = new Date().toISOString();

    // Partition into work batches based on freshness.
    const toFetch = [];
    let touched = false;
    for (const person of unique.values()) {
      const entry = existing[person.login];
      if (isFresh(entry, person.avatar_url)) {
        // Bump LRU recency only.
        existing[person.login] = { ...entry, lastSeenAt: now };
        touched = true;
      } else {
        toFetch.push(person);
      }
    }

    if (toFetch.length > 0) {
      const results = await runWithLimit(toFetch, FETCH_CONCURRENCY, (person) =>
        refreshOne(person, existing[person.login]),
      );
      for (let i = 0; i < toFetch.length; i++) {
        const next = results[i];
        if (next) {
          existing[toFetch[i].login] = next;
          touched = true;
        }
      }
    }

    if (!touched) return;

    evictLRU(existing, MAX_ENTRIES, MAX_TOTAL_BYTES);
    if (!active || generation !== capturedGen) return;
    await storage.setAvatarDataCache(existing);
  });
}

/** Test helper — wipe everything. */
export async function clearAvatarCache() {
  snapshot = {};
  await queueWrite(() => storage.setAvatarDataCache({}));
}

// ─── internals ───────────────────────────────────────────────────────────

function isFresh(entry, currentUrl) {
  if (!entry || !entry.dataUrl) return false;
  if (entry.url !== currentUrl) return false;
  if (!entry.cachedAt) return false;
  const age = Date.now() - new Date(entry.cachedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < TTL_MS;
}

async function refreshOne(person, existing) {
  try {
    const headers = {};
    const urlChanged = existing?.url !== person.avatar_url;
    if (!urlChanged && existing?.lastModified && existing?.dataUrl) {
      headers["If-Modified-Since"] = existing.lastModified;
    }

    const response = await fetch(withSize(person.avatar_url, AVATAR_FETCH_SIZE), { headers });
    const now = new Date().toISOString();

    if (response.status === 304 && existing?.dataUrl) {
      return { ...existing, url: person.avatar_url, cachedAt: now, lastSeenAt: now };
    }

    if (!response.ok) return null;

    const blob = await response.blob();
    if (blob.size > MAX_BYTES_PER_AVATAR) return null;
    const dataUrl = await blobToDataUrl(blob);

    return {
      url: person.avatar_url,
      dataUrl,
      lastModified: response.headers.get("Last-Modified") || undefined,
      cachedAt: now,
      lastSeenAt: now,
    };
  } catch (err) {
    console.warn("Avatar refresh failed for", person.login, err);
    return null;
  }
}

function withSize(url, size) {
  try {
    const u = new URL(url);
    u.searchParams.set("s", String(size));
    return u.toString();
  } catch {
    return url;
  }
}

function blobToDataUrl(blob) {
  // arrayBuffer + btoa works in both popup pages and MV3 service workers
  // (FileReader isn't part of ServiceWorkerGlobalScope).
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const mime = blob.type || "image/png";
    return `data:${mime};base64,${btoa(binary)}`;
  });
}

function evictLRU(map, maxEntries, maxTotalBytes) {
  const keys = Object.keys(map);
  if (keys.length === 0) return;

  // Sort by lastSeenAt ascending (oldest first); missing timestamp = oldest.
  keys.sort((a, b) => {
    const ta = Date.parse(map[a]?.lastSeenAt || "") || 0;
    const tb = Date.parse(map[b]?.lastSeenAt || "") || 0;
    return ta - tb;
  });

  let totalBytes = 0;
  for (const k of keys) totalBytes += map[k]?.dataUrl?.length || 0;

  let i = 0;
  while (i < keys.length && (keys.length - i > maxEntries || totalBytes > maxTotalBytes)) {
    totalBytes -= map[keys[i]]?.dataUrl?.length || 0;
    delete map[keys[i]];
    i++;
  }
}

async function runWithLimit(items, limit, worker) {
  const results = Array.from({ length: items.length });
  let cursor = 0;
  const runnerCount = Math.min(limit, items.length);
  const runners = Array.from({ length: runnerCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function queueWrite(mutator) {
  writeQueue = writeQueue.then(mutator).catch((err) => {
    console.warn("Avatar cache write failed", err);
  });
  return writeQueue;
}
