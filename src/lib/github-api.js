/**
 * GitHub API client for Chrome extension
 * Supports Device Flow OAuth and Personal Access Token authentication
 */

import { CLIENT_ID } from "../config/config.js";
import {
  GITHUB_API_BASE,
  GITHUB_SITE_BASE,
  MIN_POLL_INTERVAL_SECONDS,
  API_TIMEOUTS,
  TIMING_THRESHOLDS,
  TIME_CONVERSION,
  NOTIFICATION_TYPES,
} from "./constants.js";
import { buildNotificationUrl } from "./url-builder.js";
import { LRUCache, DEFAULT_LRU_CACHE_SIZE } from "./lru-cache.js";
import { fetchWithTimeout, retryWithStrategy } from "./http.js";

const FILTER_GIST_FILENAME = "github-notifier-pro-filters.json";

/**
 * Retry configuration for mutation requests (mark as read, etc.)
 */
const RETRY_MUTATION_OPTIONS = {
  maxRetries: 2,
  baseDelay: API_TIMEOUTS.RETRY_REQUEST_BASE_DELAY,
  backoff: "linear",
  retryOn: [500],
  checkResponse: true,
};

class GitHubAPI {
  constructor() {
    this.token = null;
    this.username = null;
    this.userInfo = null; // Store complete user info for fallback avatar
    this.pollInterval = 60;
    this.lastUpdate = null;
    this.lastModified = null; // Last-Modified header for optimized polling
    this.lastModifiedAt = null; // Timestamp when lastModified was set
    // Rate limiting state
    this.rateLimit = {
      limit: null,
      remaining: null,
      reset: null, // Unix timestamp
      isLimited: false,
    };
    // Cache for notification details (issue/PR/etc.)
    // Reduces redundant API calls for frequently accessed notifications
    this.detailsCache = new LRUCache(DEFAULT_LRU_CACHE_SIZE);
  }

  get isAuthenticated() {
    return !!this.token;
  }

  get headers() {
    const h = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.token) {
      h["Authorization"] = `Bearer ${this.token}`;
    }
    return h;
  }

  /**
   * Update rate limit from response headers
   */
  updateRateLimit(response) {
    const limit = response.headers.get("X-RateLimit-Limit");
    const remaining = response.headers.get("X-RateLimit-Remaining");
    const reset = response.headers.get("X-RateLimit-Reset");

    if (limit && remaining && reset) {
      const remainingNum = parseInt(remaining, 10);
      this.rateLimit = {
        limit: parseInt(limit, 10),
        remaining: remainingNum,
        reset: parseInt(reset, 10),
        isLimited: remainingNum === 0,
      };
    }
  }

  /**
   * Check if rate limited
   */
  isRateLimited() {
    if (!this.rateLimit.isLimited) return false;

    // Check if reset time has passed
    const now = Math.floor(Date.now() / 1000);
    if (now >= this.rateLimit.reset) {
      this.rateLimit.isLimited = false;
      return false;
    }

    return true;
  }

  /**
   * Get rate limit info with human-readable reset time
   */
  getRateLimitInfo() {
    const info = { ...this.rateLimit };
    if (info.reset) {
      const resetDate = new Date(info.reset * TIME_CONVERSION.MS_PER_SECOND);
      const now = new Date();
      const diffMs = resetDate - now;
      const diffMins = Math.ceil(diffMs / TIME_CONVERSION.MS_PER_MINUTE);

      info.resetTime = resetDate.toLocaleTimeString();
      info.resetIn = diffMins > 0 ? `${diffMins} min` : "soon";
      info.resetDate = resetDate;
    }
    return info;
  }

  /**
   * Request device code for Device Flow OAuth
   */
  async requestDeviceCode() {
    const response = await fetchWithTimeout(
      `${GITHUB_SITE_BASE}/login/device/code`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          scope: "repo notifications gist",
        }),
      },
      API_TIMEOUTS.DEFAULT,
    );

    if (!response.ok) {
      throw new Error("Failed to request device code");
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error_description || data.error || "Failed to request device code");
    }

    return data;
  }

  /**
   * Poll for access token using device code
   */
  async pollForToken(
    deviceCode,
    interval = 5,
    expiresIn = null,
    onProgress = null,
    onCancel = null,
  ) {
    // Use expires_in if provided, otherwise default to 15 minutes
    const DEFAULT_EXPIRES_IN = 900; // 15 minutes
    const effectiveExpiresIn = expiresIn || DEFAULT_EXPIRES_IN;
    // Track wall-clock deadline so slow_down interval growth can't extend beyond expiresIn
    const deadline = Date.now() + effectiveExpiresIn * 1000;
    let currentInterval = interval;

    for (let attempt = 0; Date.now() < deadline; attempt++) {
      // Check if cancelled
      if (onCancel && onCancel()) {
        throw new Error("Device Flow cancelled by user");
      }

      // Wait before polling
      await new Promise((resolve) => setTimeout(resolve, currentInterval * 1000));

      // Check if cancelled during wait
      if (onCancel && onCancel()) {
        throw new Error("Device Flow cancelled by user");
      }

      // Notify progress if callback provided
      if (onProgress) {
        const remainingTime = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        onProgress({
          attempt,
          remainingTime,
        });
      }

      try {
        const response = await fetchWithTimeout(
          `${GITHUB_SITE_BASE}/login/oauth/access_token`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              client_id: CLIENT_ID,
              device_code: deviceCode,
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            }),
          },
          API_TIMEOUTS.DEFAULT,
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Success - got the token!
        if (data.access_token) {
          return data.access_token;
        }

        // Still waiting for user authorization
        if (data.error === "authorization_pending") {
          continue;
        }

        // Slow down polling
        if (data.error === "slow_down") {
          currentInterval += 5;
          continue;
        }

        // Other errors (expired_token, access_denied, etc.)
        throw new Error(data.error_description || data.error || "Authorization failed");
      } catch (error) {
        // Only retry on transient network/timeout errors:
        // - TypeError: network failure (fetch rejected before getting a response)
        // - 'Request timeout': AbortController fired inside fetchWithTimeout
        // Business errors (access_denied, expired_token, etc.) are thrown
        // explicitly above and must NOT be retried.
        const isTransient = error instanceof TypeError || error.message === "Request timeout";
        if (isTransient && Date.now() < deadline) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Authorization timeout - please try again");
  }

  /**
   * Start Device Flow OAuth
   * @param {Object} callbacks - { onDeviceCode, onProgress, onCancel }
   */
  async loginWithDeviceFlow(callbacks = {}) {
    const { onDeviceCode = null, onProgress = null, onCancel = null } = callbacks;

    // Step 1: Request device code
    const deviceData = await this.requestDeviceCode();

    // Notify caller with device code info
    if (onDeviceCode) {
      onDeviceCode({
        verification_uri: deviceData.verification_uri,
        user_code: deviceData.user_code,
        expires_in: deviceData.expires_in,
      });
    }

    // Step 2: Poll for token (with cancel support)
    const accessToken = await this.pollForToken(
      deviceData.device_code,
      deviceData.interval,
      deviceData.expires_in,
      onProgress,
      onCancel,
    );

    // Step 3: Save token and get username
    this.token = accessToken;
    await this.fetchUsername();

    return true;
  }

  /**
   * Start OAuth flow (Device Flow) or use PAT
   * @param {string} authMethod - 'oauth' or 'pat'
   * @param {string} token - PAT token (required if authMethod is 'pat')
   * @param {Object} callbacks - { onDeviceCode, onProgress, onCancel } for Device Flow
   */
  async login(authMethod = "pat", token = null, callbacks = {}) {
    // If using PAT, skip OAuth flow
    if (authMethod === "pat") {
      if (!token) {
        throw new Error("Token required for PAT authentication");
      }
      this.token = token;
      await this.fetchUsername();
      return true;
    }

    // Device Flow OAuth
    return await this.loginWithDeviceFlow(callbacks);
  }

  /**
   * Fetch current user's username
   */
  async fetchUsername() {
    const response = await fetchWithTimeout(
      `${GITHUB_API_BASE}/user`,
      {
        headers: this.headers,
      },
      API_TIMEOUTS.USER_INFO,
    );

    this.updateRateLimit(response);

    if (response.ok) {
      const data = await response.json();
      this.username = data.login;
      this.userInfo = {
        login: data.login,
        avatar_url: data.avatar_url,
        html_url: data.html_url,
      };
      return this.username;
    }

    let apiMessage = "";
    try {
      const errorData = await response.json();
      apiMessage = errorData?.message || "";
    } catch {
      // Ignore parse errors for non-JSON responses
    }

    if (response.status === 401) {
      throw new Error("Invalid token or missing required scopes (repo, notifications)");
    }

    if (apiMessage) {
      throw new Error(`Failed to fetch username: ${apiMessage}`);
    }

    throw new Error(`Failed to fetch username (HTTP ${response.status})`);
  }

  /**
   * Logout - clear token
   */
  logout() {
    this.token = null;
    this.username = null;
    this.userInfo = null;
    this.lastModified = null;
    this.lastModifiedAt = null;
    this.detailsCache.clear();
  }

  /**
   * Fetch notifications from GitHub
   */
  async getNotifications() {
    if (!this.isAuthenticated) {
      throw new Error("Not authenticated");
    }

    // Check rate limit before making request
    if (this.isRateLimited()) {
      const resetTime = new Date(this.rateLimit.reset * 1000).toLocaleTimeString();
      throw new Error(`Rate limited. Resets at ${resetTime}`);
    }

    const url = new URL(`${GITHUB_API_BASE}/notifications`);

    // Add query parameters
    // participating=false means get all notifications (not just ones you're involved in)
    // all=false means only unread notifications
    // per_page=50 is the maximum allowed
    url.searchParams.set("participating", "false");
    url.searchParams.set("all", "false");
    url.searchParams.set("per_page", "50");

    // Build headers with If-Modified-Since for optimized polling
    // Auto-expire after 1 hour to pick up external changes (e.g., GitHub web UI)
    const MAX_CONDITIONAL_AGE_MS = 60 * 60 * 1000;
    if (
      this.lastModified &&
      this.lastModifiedAt &&
      Date.now() - this.lastModifiedAt > MAX_CONDITIONAL_AGE_MS
    ) {
      this.lastModified = null;
      this.lastModifiedAt = null;
    }

    const headers = { ...this.headers };
    if (this.lastModified) {
      headers["If-Modified-Since"] = this.lastModified;
    }

    const response = await retryWithStrategy(
      async () => {
        const resp = await fetchWithTimeout(
          url.toString(),
          {
            headers,
            cache: "no-store", // Force no cache
          },
          API_TIMEOUTS.DEFAULT,
        );

        // Allow 304 Not Modified as a valid response
        if (!resp.ok && resp.status !== 304) {
          const error = new Error(`Failed to fetch notifications: ${resp.status}`);
          error.response = resp;
          throw error;
        }

        return resp;
      },
      {
        maxRetries: 3,
        baseDelay: API_TIMEOUTS.RETRY_BASE_DELAY,
        backoff: "exponential",
        retryOn: [429, 500],
        checkResponse: false, // Already checking resp.ok above
      },
    );

    this.updateRateLimit(response);

    // Update poll interval from response headers
    const pollHeader = response.headers.get("X-Poll-Interval");
    if (pollHeader) {
      this.pollInterval = Math.max(parseInt(pollHeader, 10), MIN_POLL_INTERVAL_SECONDS);
    }

    // Save Last-Modified header for next request
    const lastModified = response.headers.get("Last-Modified");
    if (lastModified) {
      this.lastModified = lastModified;
      this.lastModifiedAt = Date.now();
    }

    // 304 Not Modified - no new notifications
    if (response.status === 304) {
      return null;
    }

    this.lastUpdate = new Date().toISOString();

    if (response.status === 200) {
      const notifications = await response.json();

      // Check if there are more pages
      const linkHeader = response.headers.get("Link");
      const hasMore = linkHeader ? linkHeader.includes('rel="next"') : false;

      return {
        items: notifications,
        hasMore,
        count: notifications.length,
      };
    }

    return null;
  }

  /**
   * Parse CheckSuite status from title
   * @private
   */
  parseCheckSuiteStatus(title) {
    const lower = title.toLowerCase();

    const patterns = [
      { keywords: ["succeeded", "passed", "success"], conclusion: "success", status: "completed" },
      { keywords: ["failed", "failure"], conclusion: "failure", status: "completed" },
      { keywords: ["cancelled"], conclusion: "cancelled", status: "completed" },
      { keywords: ["skipped"], conclusion: "skipped", status: "completed" },
      { keywords: ["in progress", "running"], conclusion: null, status: "in_progress" },
      { keywords: ["queued", "pending"], conclusion: null, status: "queued" },
    ];

    const match = patterns.find((p) => p.keywords.some((kw) => lower.includes(kw)));
    return match
      ? { conclusion: match.conclusion, status: match.status }
      : { conclusion: null, status: "completed" };
  }

  /**
   * Get notification details (including URL and metadata)
   * @param {Object} notification - Notification object
   * @param {boolean} forceRefresh - Skip cache and force API fetch (default: false)
   */
  async getNotificationDetails(notification, forceRefresh = false) {
    const subjectType = notification.subject.type;
    const repo = notification.repository;

    // Check cache first (unless forcing refresh)
    // CheckSuite has no subject.url; use notification id as fallback key
    const cacheKey =
      notification.subject.url || (notification.id ? `no-url:${notification.id}` : null);
    if (cacheKey && !forceRefresh) {
      const cached = this.detailsCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    if (!notification.subject.url) {
      const html_url = buildNotificationUrl(notification);

      switch (subjectType) {
        case NOTIFICATION_TYPES.CHECK_SUITE: {
          // GitHub doesn't provide subject.url for CheckSuite, parse from title
          const result = this.parseCheckSuiteStatus(notification.subject.title);

          const titleMatch = notification.subject.title.match(/^(.+?) workflow run/);
          const workflowName = titleMatch ? titleMatch[1].trim() : null;

          if (workflowName) {
            try {
              const runsUrl = `${GITHUB_API_BASE}/repos/${repo.full_name}/actions/runs?per_page=20`;
              const runsResp = await fetchWithTimeout(
                runsUrl,
                {
                  headers: this.headers,
                },
                API_TIMEOUTS.USER_INFO,
              );

              if (runsResp.ok) {
                const runsData = await runsResp.json();
                // Match by name and time (5 min window)
                const notifTime = new Date(notification.updated_at).getTime();
                const matchingRun = runsData.workflow_runs?.find(
                  (run) =>
                    run.name === workflowName &&
                    Math.abs(notifTime - new Date(run.updated_at).getTime()) <
                      TIMING_THRESHOLDS.WORKFLOW_MATCH_WINDOW,
                );

                if (matchingRun?.actor) {
                  const details = {
                    html_url: matchingRun.html_url || html_url,
                    conclusion: result.conclusion,
                    status: result.status,
                    user: matchingRun.actor,
                    number: matchingRun.run_number,
                  };
                  if (cacheKey) this.detailsCache.set(cacheKey, details);
                  return details;
                }
              }
            } catch (e) {
              console.warn("Failed to fetch workflow runs for CheckSuite:", e);
            }
          }

          const fallbackDetails = {
            html_url,
            conclusion: result.conclusion,
            status: result.status,
            user: this.userInfo || repo.owner,
          };
          if (cacheKey) this.detailsCache.set(cacheKey, fallbackDetails);
          return fallbackDetails;
        }

        default: {
          const defaultDetails = { html_url: repo.html_url };
          if (cacheKey) this.detailsCache.set(cacheKey, defaultDetails);
          return defaultDetails;
        }
      }
    }

    const response = await retryWithStrategy(
      async () => {
        const resp = await fetchWithTimeout(
          notification.subject.url,
          {
            headers: this.headers,
          },
          API_TIMEOUTS.NOTIFICATION_DETAILS,
        );

        if (!resp.ok) {
          const error = new Error(`Failed to fetch notification details: ${resp.status}`);
          error.response = resp;
          throw error;
        }

        return resp;
      },
      {
        maxRetries: 2,
        baseDelay: API_TIMEOUTS.RETRY_BASE_DELAY,
        backoff: "exponential",
        retryOn: [429, 500],
        checkResponse: false, // Already checking resp.ok above
      },
    );

    this.updateRateLimit(response);
    const details = await response.json();

    // For releases with empty body, fetch commit message from target_commitish
    if (
      subjectType === NOTIFICATION_TYPES.RELEASE &&
      !details.body?.trim() &&
      details.target_commitish
    ) {
      try {
        const commitUrl = `${GITHUB_API_BASE}/repos/${repo.full_name}/commits/${details.target_commitish}`;
        const commitResp = await fetchWithTimeout(
          commitUrl,
          {
            headers: this.headers,
          },
          API_TIMEOUTS.NOTIFICATION_DETAILS,
        );

        if (commitResp.ok) {
          const commitData = await commitResp.json();
          // Use commit message as body (first line is the commit title, full message includes description)
          if (commitData.commit?.message) {
            details.body = commitData.commit.message;
          }
        }
      } catch (error) {
        console.warn(
          `Failed to fetch commit message for release ${notification.subject.title}:`,
          error,
        );
        // Don't fail the whole operation, just skip commit message
      }
    }

    // Cache the result for future use
    if (cacheKey) {
      this.detailsCache.set(cacheKey, details);
    }

    return details;
  }

  /**
   * Fetch the latest comment URL for a notification by querying the GitHub comments API.
   *
   * Supports Issue and PullRequest notifications:
   * - Issue comments (shared by both Issues and PRs): ordered by ascending ID only, no
   *   direction parameter. We use the Link header to jump directly to the last page.
   * - PR review comments: supports sort+direction, fetched with direction=desc.
   * For PRs we query both endpoints in parallel and return whichever has the more recent
   * updated_at timestamp. Returns null for unsupported types or when no comments are found.
   *
   * @param {Object} notification - Notification object with type, number, and repository fields
   * @returns {Promise<string|null>} The HTML URL of the latest comment, or null
   */
  async getLatestCommentUrl(notification) {
    const { type, number, repository } = notification;
    const fullName = repository?.full_name;

    if (!fullName || !number) {
      return null;
    }

    if (type !== NOTIFICATION_TYPES.ISSUE && type !== NOTIFICATION_TYPES.PULL_REQUEST) {
      return null;
    }

    try {
      if (type === NOTIFICATION_TYPES.ISSUE) {
        const comment = await this._fetchLastIssueComment(fullName, number);
        return comment?.html_url ?? null;
      }

      // PullRequest: issue-style comments and PR review inline comments may both exist;
      // fetch them in parallel. Use allSettled so a failure in one endpoint does not
      // discard a valid result from the other.
      const [issueResult, reviewResult] = await Promise.allSettled([
        this._fetchLastIssueComment(fullName, number),
        this._fetchLastReviewComment(fullName, number),
      ]);

      const issueComment = issueResult.status === "fulfilled" ? issueResult.value : null;
      const reviewComment = reviewResult.status === "fulfilled" ? reviewResult.value : null;

      if (!issueComment && !reviewComment) return null;
      if (!issueComment) return reviewComment.html_url;
      if (!reviewComment) return issueComment.html_url;

      // Both exist — pick the one with the later updated_at timestamp
      return issueComment.updated_at >= reviewComment.updated_at
        ? issueComment.html_url
        : reviewComment.html_url;
    } catch {
      return null;
    }
  }

  /**
   * Fetch the last issue-style comment on an issue or PR.
   * Issue comments are always in ascending ID order so we use the Link header
   * to jump to the last page rather than relying on an unsupported direction param.
   *
   * @param {string} fullName - Repository full name (owner/repo)
   * @param {number} number - Issue or PR number
   * @returns {Promise<{html_url: string, updated_at: string}|null>}
   */
  async _fetchLastIssueComment(fullName, number) {
    // Request the first page to discover total page count via Link header
    const firstPageUrl = `${GITHUB_API_BASE}/repos/${fullName}/issues/${number}/comments?per_page=1`;

    const firstResp = await fetchWithTimeout(
      firstPageUrl,
      { headers: this.headers },
      API_TIMEOUTS.NOTIFICATION_DETAILS,
    );

    if (!firstResp.ok) return null;
    this.updateRateLimit(firstResp);

    const linkHeader = firstResp.headers.get("Link");
    if (!linkHeader) {
      // Only one page — read the body directly
      const comments = await firstResp.json();
      if (!Array.isArray(comments) || comments.length === 0) return null;
      return { html_url: comments[0].html_url, updated_at: comments[0].updated_at };
    }

    // Parse the last page number from Link: <url>; rel="last"
    const lastMatch = linkHeader.match(/<[^>]+[?&]page=(\d+)[^>]*>;\s*rel="last"/);
    if (!lastMatch) {
      // No last page link means we're already on the last page
      const comments = await firstResp.json();
      if (!Array.isArray(comments) || comments.length === 0) return null;
      return { html_url: comments[0].html_url, updated_at: comments[0].updated_at };
    }

    const lastPage = parseInt(lastMatch[1], 10);
    const lastPageUrl = `${GITHUB_API_BASE}/repos/${fullName}/issues/${number}/comments?per_page=1&page=${lastPage}`;

    const lastResp = await fetchWithTimeout(
      lastPageUrl,
      { headers: this.headers },
      API_TIMEOUTS.NOTIFICATION_DETAILS,
    );

    if (!lastResp.ok) return null;
    this.updateRateLimit(lastResp);

    const comments = await lastResp.json();
    if (!Array.isArray(comments) || comments.length === 0) return null;
    return { html_url: comments[0].html_url, updated_at: comments[0].updated_at };
  }

  /**
   * Fetch the most recently created PR review comment.
   * The review comments endpoint supports sort+direction so we use direction=desc.
   *
   * @param {string} fullName - Repository full name (owner/repo)
   * @param {number} number - PR number
   * @returns {Promise<{html_url: string, updated_at: string}|null>}
   */
  async _fetchLastReviewComment(fullName, number) {
    const url = `${GITHUB_API_BASE}/repos/${fullName}/pulls/${number}/comments?sort=created&direction=desc&per_page=1`;

    const response = await fetchWithTimeout(
      url,
      { headers: this.headers },
      API_TIMEOUTS.NOTIFICATION_DETAILS,
    );

    if (!response.ok) return null;
    this.updateRateLimit(response);

    const comments = await response.json();
    if (!Array.isArray(comments) || comments.length === 0) return null;
    return { html_url: comments[0].html_url, updated_at: comments[0].updated_at };
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(threadId) {
    const url = `${GITHUB_API_BASE}/notifications/threads/${threadId}`;

    const response = await retryWithStrategy(async () => {
      return await fetchWithTimeout(
        url,
        {
          method: "PATCH",
          headers: this.headers,
        },
        API_TIMEOUTS.DEFAULT,
      );
    }, RETRY_MUTATION_OPTIONS);

    this.updateRateLimit(response);
    return true;
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead() {
    if (!this.lastUpdate) {
      this.lastUpdate = new Date().toISOString();
    }

    const response = await retryWithStrategy(async () => {
      return await fetchWithTimeout(
        `${GITHUB_API_BASE}/notifications`,
        {
          method: "PUT",
          headers: {
            ...this.headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            last_read_at: this.lastUpdate,
          }),
        },
        API_TIMEOUTS.DEFAULT,
      );
    }, RETRY_MUTATION_OPTIONS);

    this.updateRateLimit(response);
    return true;
  }

  /**
   * Mark all notifications in a repository as read
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   */
  async markRepoAsRead(owner, repo) {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/notifications`;

    const response = await retryWithStrategy(async () => {
      return await fetchWithTimeout(
        url,
        {
          method: "PUT",
          headers: {
            ...this.headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            last_read_at: new Date().toISOString(),
          }),
        },
        API_TIMEOUTS.DEFAULT,
      );
    }, RETRY_MUTATION_OPTIONS);

    this.updateRateLimit(response);
    return true;
  }

  _buildFilterEnvelope(rules) {
    return { version: 1, rules };
  }

  async createFilterGist(filterRules) {
    const envelope = this._buildFilterEnvelope(filterRules);
    const response = await fetchWithTimeout(
      `${GITHUB_API_BASE}/gists`,
      {
        method: "POST",
        headers: { ...this.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "GitHub Notifier Pro — Filter Rules (auto-synced)",
          public: false,
          files: {
            [FILTER_GIST_FILENAME]: {
              content: JSON.stringify(envelope, null, 2),
            },
          },
        }),
      },
      API_TIMEOUTS.DEFAULT,
    );
    if (response.status === 404 || response.status === 403) {
      const err = new Error("missing_gist_scope");
      err.code = "missing_scope";
      throw err;
    }
    if (!response.ok) {
      throw new Error(`Failed to create gist: ${response.status}`);
    }
    const data = await response.json();
    return { id: data.id, updatedAt: data.updated_at || null };
  }

  async updateFilterGist(gistId, filterRules) {
    const envelope = this._buildFilterEnvelope(filterRules);
    const response = await fetchWithTimeout(
      `${GITHUB_API_BASE}/gists/${gistId}`,
      {
        method: "PATCH",
        headers: { ...this.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          files: {
            [FILTER_GIST_FILENAME]: {
              content: JSON.stringify(envelope, null, 2),
            },
          },
        }),
      },
      API_TIMEOUTS.DEFAULT,
    );
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Failed to update gist: ${response.status}`);
    }
    const data = await response.json();
    return { id: data.id || gistId, updatedAt: data.updated_at || null };
  }

  async _fetchGistData(gistId) {
    const response = await fetchWithTimeout(
      `${GITHUB_API_BASE}/gists/${gistId}`,
      { headers: this.headers },
      API_TIMEOUTS.DEFAULT,
    );
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Failed to fetch gist: ${response.status}`);
    }
    return response.json();
  }

  async getFilterGist(gistId) {
    const data = await this._fetchGistData(gistId);
    if (!data) return null;
    const file = data.files[FILTER_GIST_FILENAME];
    if (!file) return null;
    try {
      const parsed = JSON.parse(file.content);
      if (!Array.isArray(parsed.rules)) return null;
      return { rules: parsed.rules, updatedAt: data.updated_at || null };
    } catch {
      return null;
    }
  }

  async getFilterGistMeta(gistId) {
    const data = await this._fetchGistData(gistId);
    if (!data) return null;
    return { updated_at: data.updated_at, created_at: data.created_at };
  }

  async findFilterGist() {
    let page = 1;
    while (page <= 5) {
      const response = await fetchWithTimeout(
        `${GITHUB_API_BASE}/gists?per_page=30&page=${page}`,
        { headers: this.headers },
        API_TIMEOUTS.DEFAULT,
      );
      if (!response.ok) break;
      const gists = await response.json();
      if (gists.length === 0) break;
      for (const g of gists) {
        if (g.files[FILTER_GIST_FILENAME]) {
          return { id: g.id, updatedAt: g.updated_at || null };
        }
      }
      page++;
    }
    return null;
  }
}

// Singleton instance
export const github = new GitHubAPI();
export default github;
