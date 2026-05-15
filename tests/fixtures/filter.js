/**
 * Test fixtures for filter-rules and related modules.
 */

/**
 * Build a minimal notification object for filter matching tests.
 * @param {string} title
 * @param {string} [repoFullName]
 * @returns {{ title: string, repository: { full_name: string } }}
 */
export function makeNotif(title, repoFullName = "owner/repo") {
  return {
    title,
    repository: { full_name: repoFullName },
  };
}

/**
 * Build a single filter rule.
 * @param {string[]} keywords
 * @param {string[]} [repos]
 */
export function makeRule(keywords, repos = []) {
  return { repos, keywords };
}
