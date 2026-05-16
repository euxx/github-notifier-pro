/**
 * Notification filter rules
 *
 * Shared between popup and service-worker so both sides agree on the same rule
 * shape, validation, normalization, and matching semantics.
 *
 * Rule shape: { repos: string[], keywords: string[] }
 *   - repos: [] means apply to all repos; non-empty means only those repos.
 *   - keywords: title substrings that, when matched, hide the notification (case-insensitive).
 */

/**
 * Strict validation for locally authored rules.
 * Throws on malformed input. Mutates each rule in place to trim whitespace and
 * drop empty entries from repos/keywords, matching the legacy
 * SET_NOTIFICATION_FILTER behavior.
 *
 * @param {unknown} rules
 * @throws {Error} when filter is not an array, a rule is missing fields, fields are
 *   not string arrays, or a rule has no keywords after normalization.
 */
export function validateRulesStrict(rules) {
  if (!Array.isArray(rules)) {
    throw new Error("filter must be an array");
  }
  for (const rule of rules) {
    if (!Array.isArray(rule?.repos) || !Array.isArray(rule?.keywords)) {
      throw new Error("Each rule must have repos and keywords arrays");
    }
    if (
      rule.repos.some((r) => typeof r !== "string") ||
      rule.keywords.some((kw) => typeof kw !== "string")
    ) {
      throw new Error("Rule repos and keywords must be arrays of strings");
    }
    rule.repos = rule.repos.map((r) => r.trim()).filter(Boolean);
    rule.keywords = rule.keywords.map((kw) => kw.trim()).filter(Boolean);
    if (rule.keywords.length === 0) {
      throw new Error("Each rule must have at least one keyword");
    }
  }
}

/**
 * Lenient sanitization for untrusted (e.g. remote gist) rules.
 * Silently drops malformed rules and rules with no keywords after trim.
 *
 * @param {unknown} rules
 * @returns {Array<{ repos: string[], keywords: string[] }>}
 */
export function sanitizeRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .filter(
      (r) =>
        Array.isArray(r?.repos) &&
        Array.isArray(r?.keywords) &&
        r.repos.every((x) => typeof x === "string") &&
        r.keywords.every((x) => typeof x === "string"),
    )
    .map((r) => ({
      repos: r.repos.map((x) => x.trim()).filter(Boolean),
      keywords: r.keywords.map((x) => x.trim()).filter(Boolean),
    }))
    .filter((r) => r.keywords.length > 0);
}

/**
 * Canonical JSON representation of a rule list for equality comparison.
 * Sanitizes first so equivalent inputs produce identical output regardless of
 * malformed or whitespace-only entries.
 *
 * @param {unknown} rules
 * @returns {string}
 */
export function canonicalizeRules(rules) {
  return JSON.stringify(sanitizeRules(rules));
}

/**
 * Canonicalize a JSON-encoded snapshot (e.g. from storage). Returns null when
 * the input is null so callers can use null/non-null as a "never pushed" signal.
 *
 * @param {string|null} raw
 * @returns {string|null}
 */
export function canonicalizeStoredRules(raw) {
  return raw !== null ? canonicalizeRules(JSON.parse(raw)) : null;
}

/**
 * Whether a notification matches a single rule.
 * @param {{ title?: string, repository?: { full_name?: string } }} notif
 * @param {{ repos: string[], keywords: string[] }} rule
 * @returns {boolean}
 */
export function matchesRule(notif, rule) {
  const { repos, keywords } = rule;

  if (repos.length === 0 && keywords.length === 0) return false;

  const repoName = notif.repository?.full_name?.toLowerCase();
  if (repos.length > 0 && (!repoName || !repos.some((r) => r.toLowerCase() === repoName))) {
    return false;
  }

  const title = notif.title;
  if (!title) return false;
  const titleLower = title.toLowerCase();
  return keywords.some((kw) => titleLower.includes(kw.toLowerCase()));
}

/**
 * Whether a notification matches any rule in the list.
 * Returns true if the notification should be hidden.
 */
export function matchesAnyRule(notif, rules) {
  return rules.some((rule) => matchesRule(notif, rule));
}

/**
 * Whether a notification is currently visible (not matched by any rule).
 */
export function isVisible(n) {
  return !n.matchedRules?.length;
}

/**
 * Annotate each notification with indices of matching rules, and collect
 * per-rule per-repo / per-keyword counts.
 *
 * @param {Array} notifications
 * @param {Array<{ repos: string[], keywords: string[] }>} rules
 * @returns {{ notifications: Array, stats: Array<{ repos: Object, keywords: Object }> }}
 */
export function applyRulesWithStats(notifications, rules) {
  const stats = rules.map(() => ({ repos: {}, keywords: {} }));
  const annotated = notifications.map((n) => {
    const matched = [];
    for (let i = 0; i < rules.length; i++) {
      if (matchesRule(n, rules[i])) {
        matched.push(i);
        const repo = n.repository?.full_name;
        if (repo) {
          const repoKey = repo.toLowerCase();
          stats[i].repos[repoKey] = (stats[i].repos[repoKey] || 0) + 1;
        }
        const titleLower = n.title.toLowerCase();
        for (const kw of rules[i].keywords) {
          if (titleLower.includes(kw.toLowerCase())) {
            stats[i].keywords[kw] = (stats[i].keywords[kw] || 0) + 1;
          }
        }
      }
    }
    return { ...n, matchedRules: matched };
  });
  return { notifications: annotated, stats };
}
