import { describe, it, expect } from "vitest";
import {
  matchesAnyRule,
  applyRulesWithStats,
  validateRulesStrict,
  sanitizeRules,
  canonicalizeRules,
  canonicalizeStoredRules,
  isVisible,
  statsHaveMatches,
} from "../src/lib/filter-rules.js";
import { makeNotif } from "./fixtures/filter.js";

describe("matchesAnyRule", () => {
  it("returns false for empty rules array", () => {
    expect(matchesAnyRule(makeNotif("v1.0.0-beta"), [])).toBe(false);
  });

  it("returns false when rule has empty repos and empty keywords", () => {
    const rules = [{ repos: [], keywords: [] }];
    expect(matchesAnyRule(makeNotif("v1.0.0-beta"), rules)).toBe(false);
  });

  it("matches keyword in title (case-insensitive)", () => {
    const rules = [{ repos: [], keywords: ["beta"] }];
    expect(matchesAnyRule(makeNotif("v1.0.0-BETA"), rules)).toBe(true);
    expect(matchesAnyRule(makeNotif("v1.0.0-Beta.1"), rules)).toBe(true);
    expect(matchesAnyRule(makeNotif("v1.0.0"), rules)).toBe(false);
  });

  it("scopes to specific repos when repos is non-empty", () => {
    const rules = [{ repos: ["owner/repo-a"], keywords: ["rc"] }];
    expect(matchesAnyRule(makeNotif("v2.0.0-rc.1", "owner/repo-a"), rules)).toBe(true);
    expect(matchesAnyRule(makeNotif("v2.0.0-rc.1", "owner/repo-b"), rules)).toBe(false);
  });

  it("matches repos case-insensitively", () => {
    const rules = [{ repos: ["Owner/Repo-A"], keywords: ["rc"] }];
    expect(matchesAnyRule(makeNotif("v2.0.0-rc.1", "owner/repo-a"), rules)).toBe(true);
    expect(matchesAnyRule(makeNotif("v2.0.0-rc.1", "OWNER/REPO-A"), rules)).toBe(true);
  });

  it("does not match when rule has repos but no keywords", () => {
    const rules = [{ repos: ["owner/repo"], keywords: [] }];
    expect(matchesAnyRule(makeNotif("anything", "owner/repo"), rules)).toBe(false);
  });

  it("matches if any rule in the array matches (OR semantics)", () => {
    const rules = [
      { repos: ["owner/repo-a"], keywords: ["alpha"] },
      { repos: [], keywords: ["nightly"] },
    ];
    expect(matchesAnyRule(makeNotif("v1-alpha", "owner/repo-a"), rules)).toBe(true);
    expect(matchesAnyRule(makeNotif("nightly-build", "owner/repo-b"), rules)).toBe(true);
    expect(matchesAnyRule(makeNotif("v1.0.0", "owner/repo-a"), rules)).toBe(false);
  });

  it("matches any keyword in the list (OR within keywords)", () => {
    const rules = [{ repos: [], keywords: ["alpha", "beta", "rc"] }];
    expect(matchesAnyRule(makeNotif("v1.0.0-alpha"), rules)).toBe(true);
    expect(matchesAnyRule(makeNotif("v1.0.0-beta"), rules)).toBe(true);
    expect(matchesAnyRule(makeNotif("v1.0.0-rc.1"), rules)).toBe(true);
    expect(matchesAnyRule(makeNotif("v1.0.0"), rules)).toBe(false);
  });

  it("returns false when notif has no title", () => {
    const rules = [{ repos: [], keywords: ["beta"] }];
    expect(matchesAnyRule({ title: null, repository: { full_name: "owner/repo" } }, rules)).toBe(
      false,
    );
    expect(matchesAnyRule({ repository: { full_name: "owner/repo" } }, rules)).toBe(false);
  });

  it("returns false when notif has no repository and rule scopes to a repo", () => {
    const rules = [{ repos: ["owner/repo"], keywords: ["beta"] }];
    expect(matchesAnyRule({ title: "v1.0.0-beta" }, rules)).toBe(false);
    expect(matchesAnyRule({ title: "v1.0.0-beta", repository: null }, rules)).toBe(false);
  });

  it("matches all repos (no repo filter) even when repository is undefined", () => {
    const rules = [{ repos: [], keywords: ["beta"] }];
    expect(matchesAnyRule({ title: "v1.0.0-beta" }, rules)).toBe(true);
  });
});

describe("applyRulesWithStats", () => {
  it("returns all notifications with empty matchedRules when rules are empty", () => {
    const notifs = [makeNotif("fix bug"), makeNotif("v1.0.0-beta")];
    const { notifications, stats } = applyRulesWithStats(notifs, []);
    expect(notifications).toHaveLength(2);
    expect(notifications[0].matchedRules).toEqual([]);
    expect(notifications[1].matchedRules).toEqual([]);
    expect(stats).toEqual([]);
  });

  it("annotates matching notifications and counts per repo and per keyword", () => {
    const rules = [{ repos: [], keywords: ["beta"] }];
    const notifs = [
      makeNotif("v1.0.0-beta", "org/repo-a"),
      makeNotif("v1.0.0-beta", "org/repo-b"),
      makeNotif("fix bug", "org/repo-a"),
    ];
    const { notifications, stats } = applyRulesWithStats(notifs, rules);
    expect(notifications).toHaveLength(3);
    expect(notifications[0].matchedRules).toEqual([0]);
    expect(notifications[1].matchedRules).toEqual([0]);
    expect(notifications[2].matchedRules).toEqual([]);
    expect(stats[0].repos).toEqual({ "org/repo-a": 1, "org/repo-b": 1 });
    expect(stats[0].keywords).toEqual({ beta: 2 });
  });

  it("normalizes repo keys to lowercase for case-insensitive lookup", () => {
    const rules = [{ repos: ["openai/openai-python"], keywords: ["alpha"] }];
    const notifs = [{ title: "v1-alpha", repository: { full_name: "OpenAI/openai-python" } }];
    const { notifications, stats } = applyRulesWithStats(notifs, rules);
    expect(notifications[0].matchedRules).toEqual([0]);
    expect(stats[0].repos).toEqual({ "openai/openai-python": 1 });
  });

  it("counts multiple filtered notifications from the same repo", () => {
    const rules = [{ repos: ["owner/repo"], keywords: ["alpha"] }];
    const notifs = [makeNotif("v1-alpha"), makeNotif("v2-alpha"), makeNotif("v3-stable")];
    const { notifications, stats } = applyRulesWithStats(notifs, rules);
    expect(notifications[0].matchedRules).toEqual([0]);
    expect(notifications[1].matchedRules).toEqual([0]);
    expect(notifications[2].matchedRules).toEqual([]);
    expect(stats[0].repos).toEqual({ "owner/repo": 2 });
    expect(stats[0].keywords).toEqual({ alpha: 2 });
  });

  it("counts each matching keyword independently when multiple keywords match", () => {
    const rules = [{ repos: [], keywords: ["alpha", "beta"] }];
    const notifs = [
      makeNotif("v1-alpha-beta"), // matches both keywords
      makeNotif("v2-alpha"), // matches only "alpha"
    ];
    const { notifications, stats } = applyRulesWithStats(notifs, rules);
    expect(notifications[0].matchedRules).toEqual([0]);
    expect(notifications[1].matchedRules).toEqual([0]);
    expect(stats[0].keywords).toEqual({ alpha: 2, beta: 1 });
  });

  it("tracks stats per rule independently (notification can match multiple rules)", () => {
    const rules = [
      { repos: ["owner/repo-a"], keywords: ["alpha"] },
      { repos: [], keywords: ["beta"] },
    ];
    const notifs = [
      makeNotif("v1-alpha", "owner/repo-a"),
      makeNotif("v1-beta", "owner/repo-b"),
      makeNotif("stable", "owner/repo-a"),
    ];
    const { notifications, stats } = applyRulesWithStats(notifs, rules);
    expect(notifications[0].matchedRules).toEqual([0]);
    expect(notifications[1].matchedRules).toEqual([1]);
    expect(notifications[2].matchedRules).toEqual([]);
    expect(stats[0].repos).toEqual({ "owner/repo-a": 1 });
    expect(stats[0].keywords).toEqual({ alpha: 1 });
    expect(stats[1].repos).toEqual({ "owner/repo-b": 1 });
    expect(stats[1].keywords).toEqual({ beta: 1 });
  });

  it("returns empty repos and keywords when no notifications were filtered", () => {
    const rules = [{ repos: ["owner/repo"], keywords: ["alpha"] }];
    const notifs = [makeNotif("stable release")];
    const { notifications, stats } = applyRulesWithStats(notifs, rules);
    expect(notifications[0].matchedRules).toEqual([]);
    expect(stats[0].repos).toEqual({});
    expect(stats[0].keywords).toEqual({});
  });
});

describe("isVisible", () => {
  it("returns true when matchedRules is missing", () => {
    expect(isVisible({})).toBe(true);
  });

  it("returns true when matchedRules is empty", () => {
    expect(isVisible({ matchedRules: [] })).toBe(true);
  });

  it("returns false when matchedRules has entries", () => {
    expect(isVisible({ matchedRules: [0] })).toBe(false);
  });
});

describe("validateRulesStrict", () => {
  it("accepts a valid rule", () => {
    const rules = [{ repos: ["owner/repo"], keywords: ["beta"] }];
    expect(() => validateRulesStrict(rules)).not.toThrow();
  });

  it("accepts a rule with empty repos (global scope)", () => {
    const rules = [{ repos: [], keywords: ["nightly"] }];
    expect(() => validateRulesStrict(rules)).not.toThrow();
  });

  it("rejects non-array filter", () => {
    expect(() => validateRulesStrict("bad")).toThrow(/filter must be an array/);
  });

  it("rejects rule missing repos array", () => {
    expect(() => validateRulesStrict([{ keywords: ["beta"] }])).toThrow(
      /repos and keywords arrays/,
    );
  });

  it("rejects rule missing keywords array", () => {
    expect(() => validateRulesStrict([{ repos: ["owner/repo"] }])).toThrow(
      /repos and keywords arrays/,
    );
  });

  it("rejects rule with empty keywords", () => {
    expect(() => validateRulesStrict([{ repos: [], keywords: [] }])).toThrow(
      /at least one keyword/,
    );
  });

  it("rejects rule with only whitespace/empty-string keywords", () => {
    expect(() => validateRulesStrict([{ repos: [], keywords: ["", " ", "  "] }])).toThrow(
      /at least one keyword/,
    );
  });

  it("rejects rule with non-string repo elements", () => {
    expect(() => validateRulesStrict([{ repos: [123], keywords: ["beta"] }])).toThrow(
      /arrays of strings/,
    );
  });

  it("rejects rule with non-string keyword elements", () => {
    expect(() => validateRulesStrict([{ repos: [], keywords: [null] }])).toThrow(
      /arrays of strings/,
    );
  });

  it("trims whitespace from repos and keywords in place", () => {
    const rules = [{ repos: [" owner/repo "], keywords: [" beta "] }];
    validateRulesStrict(rules);
    expect(rules).toEqual([{ repos: ["owner/repo"], keywords: ["beta"] }]);
  });
});

describe("sanitizeRules", () => {
  it("returns empty array for non-array input", () => {
    expect(sanitizeRules(null)).toEqual([]);
    expect(sanitizeRules(undefined)).toEqual([]);
    expect(sanitizeRules("bad")).toEqual([]);
  });

  it("drops malformed rules instead of throwing", () => {
    const input = [
      { repos: ["a/b"], keywords: ["beta"] }, // valid
      { repos: ["x"] }, // missing keywords
      { keywords: ["y"] }, // missing repos
      { repos: [123], keywords: ["z"] }, // non-string repo
      null,
    ];
    expect(sanitizeRules(input)).toEqual([{ repos: ["a/b"], keywords: ["beta"] }]);
  });

  it("trims whitespace and drops rules left without keywords", () => {
    const input = [
      { repos: [" a/b "], keywords: [" beta "] },
      { repos: [], keywords: ["", " "] },
    ];
    expect(sanitizeRules(input)).toEqual([{ repos: ["a/b"], keywords: ["beta"] }]);
  });
});

describe("canonicalizeRules", () => {
  it("produces equal output for inputs that sanitize to the same shape", () => {
    const a = canonicalizeRules([{ repos: [" owner/repo "], keywords: ["beta"] }]);
    const b = canonicalizeRules([{ repos: ["owner/repo"], keywords: ["beta"] }]);
    expect(a).toBe(b);
  });

  it("differs when rules differ", () => {
    const a = canonicalizeRules([{ repos: [], keywords: ["alpha"] }]);
    const b = canonicalizeRules([{ repos: [], keywords: ["beta"] }]);
    expect(a).not.toBe(b);
  });
});

describe("canonicalizeStoredRules", () => {
  it("returns null when raw is null", () => {
    expect(canonicalizeStoredRules(null)).toBeNull();
  });

  it("parses JSON and canonicalizes", () => {
    const raw = JSON.stringify([{ repos: [" a/b "], keywords: [" beta "] }]);
    expect(canonicalizeStoredRules(raw)).toBe(
      canonicalizeRules([{ repos: ["a/b"], keywords: ["beta"] }]),
    );
  });
});

describe("statsHaveMatches", () => {
  it("returns false for an empty array", () => {
    expect(statsHaveMatches([])).toBe(false);
  });

  it("returns false when all entries have empty repos and keywords maps", () => {
    expect(
      statsHaveMatches([
        { repos: {}, keywords: {} },
        { repos: {}, keywords: {} },
      ]),
    ).toBe(false);
  });

  it("returns true when any entry has a matched repo", () => {
    expect(
      statsHaveMatches([
        { repos: {}, keywords: {} },
        { repos: { "owner/repo": 3 }, keywords: {} },
      ]),
    ).toBe(true);
  });

  it("returns true when any entry has a matched keyword", () => {
    expect(statsHaveMatches([{ repos: {}, keywords: { bug: 1 } }])).toBe(true);
  });

  it("returns false for non-array inputs", () => {
    expect(statsHaveMatches(null)).toBe(false);
    expect(statsHaveMatches(undefined)).toBe(false);
  });

  it("tolerates missing repos / keywords fields on an entry", () => {
    expect(statsHaveMatches([{}])).toBe(false);
    expect(statsHaveMatches([{ repos: { "x/y": 1 } }])).toBe(true);
    expect(statsHaveMatches([{ keywords: { bug: 1 } }])).toBe(true);
  });
});
