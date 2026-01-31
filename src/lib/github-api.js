/**
 * GitHub API client for Chrome extension
 * Supports Device Flow OAuth and Personal Access Token authentication
 */

import { CLIENT_ID } from '../config/config.js';
import { GITHUB_API_BASE, GITHUB_SITE_BASE, MIN_POLL_INTERVAL_SECONDS, API_TIMEOUTS, TIMING_THRESHOLDS, TIME_CONVERSION, NOTIFICATION_TYPES } from './constants.js';
import { buildNotificationUrl } from './url-builder.js';

/**
 * Create a fetch request with timeout
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @param {number} timeout - Timeout in milliseconds (default: 30s)
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeout = API_TIMEOUTS.DEFAULT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

/**
 * Unified retry function with configurable strategy
 * @param {Function} fetchFn - Function that returns a fetch promise
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.baseDelay - Base delay in milliseconds (default: 1000)
 * @param {string} options.backoff - Backoff strategy: 'exponential' or 'linear' (default: 'exponential')
 * @param {Array<number>} options.retryOn - HTTP status codes to retry on (default: [401, 429, 500+])
 * @param {boolean} options.checkResponse - Whether to check response.ok (default: true)
 * @returns {Promise<Response>}
 */
async function retryWithStrategy(fetchFn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = API_TIMEOUTS.RETRY_BASE_DELAY,
    backoff = 'exponential',
    retryOn = [401, 429],
    checkResponse = true
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchFn();

      // If checking response and got a response object
      if (checkResponse && response && typeof response.status === 'number') {
        // Success cases
        if (response.ok || response.status === 205) {
          return response;
        }

        // Check if we should retry this status code
        const shouldRetry = retryOn.includes(response.status) ||
                          (response.status >= 500 && retryOn.includes(500));

        if (!shouldRetry || attempt === maxRetries) {
          // Don't retry or last attempt - throw error
          const error = new Error(`Request failed: ${response.status}`);
          error.response = response;
          throw error;
        }

        // Will retry - continue to delay logic below
        lastError = new Error(`Request failed: ${response.status}`);
        lastError.response = response;
      } else {
        // No response checking needed or successful
        return response;
      }
    } catch (error) {
      lastError = error;

      // Last attempt - throw immediately
      if (attempt === maxRetries) {
        throw lastError;
      }

      // Don't retry on 40x errors (except those in retryOn list)
      if (error.response) {
        const status = error.response.status;
        const shouldRetry = retryOn.includes(status) ||
                          (status >= 500 && retryOn.includes(500));

        if (!shouldRetry && status >= 400 && status < 500) {
          throw error;
        }
      }

      // Network errors or retryable errors - continue to retry
    }

    // Calculate delay based on backoff strategy
    const delay = backoff === 'exponential'
      ? baseDelay * Math.pow(2, attempt)
      : baseDelay * (attempt + 1);

    await new Promise(resolve => setTimeout(resolve, delay));
  }

  throw lastError;
}

class GitHubAPI {
  constructor() {
    this.token = null;
    this.username = null;
    this.userInfo = null; // Store complete user info for fallback avatar
    this.pollInterval = 60;
    this.lastUpdate = null;
    // Rate limiting state
    this.rateLimit = {
      limit: null,
      remaining: null,
      reset: null, // Unix timestamp
      isLimited: false,
    };
  }

  get isAuthenticated() {
    return !!this.token;
  }

  get headers() {
    const h = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    return h;
  }

  /**
   * Update rate limit from response headers
   */
  updateRateLimit(response) {
    const limit = response.headers.get('X-RateLimit-Limit');
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const reset = response.headers.get('X-RateLimit-Reset');

    if (limit && remaining && reset) {
      this.rateLimit = {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        reset: parseInt(reset, 10),
        isLimited: parseInt(remaining, 10) === 0,
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
      const resetDate = new Date(info.reset * TIME_CONVERSION.MS_TO_SECONDS);
      const now = new Date();
      const diffMs = resetDate - now;
      const diffMins = Math.ceil(diffMs / TIME_CONVERSION.MS_TO_MINUTES);

      info.resetTime = resetDate.toLocaleTimeString();
      info.resetIn = diffMins > 0 ? `${diffMins} min` : 'soon';
      info.resetDate = resetDate;
    }
    return info;
  }

  /**
   * Request device code for Device Flow OAuth
   */
  async requestDeviceCode() {
    const response = await fetch(`${GITHUB_SITE_BASE}/login/device/code`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        scope: 'repo notifications',
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to request device code');
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    return data;
  }

  /**
   * Poll for access token using device code
   */
  async pollForToken(deviceCode, interval = 5, onProgress = null, onCancel = null) {
    const maxAttempts = 180; // 15 minutes (900s / 5s)
    let currentInterval = interval;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Check if cancelled
      if (onCancel && onCancel()) {
        throw new Error('Device Flow cancelled by user');
      }

      // Wait before polling
      await new Promise(resolve => setTimeout(resolve, currentInterval * 1000));

      // Check if cancelled during wait
      if (onCancel && onCancel()) {
        throw new Error('Device Flow cancelled by user');
      }

      // Notify progress if callback provided
      if (onProgress) {
        const remainingTime = (maxAttempts - attempt) * currentInterval;
        onProgress({
          attempt,
          maxAttempts,
          remainingTime,
        });
      }

      try {
        const response = await fetch(`${GITHUB_SITE_BASE}/login/oauth/access_token`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Success - got the token!
        if (data.access_token) {
          return data.access_token;
        }

        // Still waiting for user authorization
        if (data.error === 'authorization_pending') {
          continue;
        }

        // Slow down polling
        if (data.error === 'slow_down') {
          currentInterval += 5;
          continue;
        }

        // Other errors (expired_token, access_denied, etc.)
        throw new Error(data.error_description || data.error);
      } catch (error) {
        // Network errors - retry
        if (attempt < maxAttempts - 1) {
          continue;
        }
        throw error;
      }
    }

    throw new Error('Authorization timeout - please try again');
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
      onProgress,
      onCancel
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
  async login(authMethod = 'pat', token = null, callbacks = {}) {
    // If using PAT, skip OAuth flow
    if (authMethod === 'pat') {
      if (!token) {
        throw new Error('Token required for PAT authentication');
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
    const response = await fetchWithTimeout(`${GITHUB_API_BASE}/user`, {
      headers: this.headers,
    }, API_TIMEOUTS.USER_INFO);

    this.updateRateLimit(response);

    if (response.ok) {
      const data = await response.json();
      this.username = data.login;
      this.userInfo = {
        login: data.login,
        avatar_url: data.avatar_url,
        html_url: data.html_url
      };
      return this.username;
    }

    throw new Error('Failed to fetch username');
  }

  /**
   * Logout - clear token
   */
  logout() {
    this.token = null;
    this.username = null;
    this.userInfo = null;
  }

  /**
   * Fetch notifications from GitHub
   */
  async getNotifications() {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    // Check rate limit before making request
    if (this.isRateLimited()) {
      const resetTime = new Date(this.rateLimit.reset * 1000).toLocaleTimeString();
      throw new Error(`Rate limited. Resets at ${resetTime}`);
    }

    const url = new URL(`${GITHUB_API_BASE}/notifications`);

    // Add query parameters
    // participating=false means get all notifications (not just ones you're involved in)
    // all=false means only unread (default behavior)
    url.searchParams.set('participating', 'false');

    // Add timestamp to prevent caching
    url.searchParams.set('_t', Date.now().toString());

    const response = await retryWithStrategy(async () => {
      const resp = await fetchWithTimeout(url.toString(), {
        headers: this.headers,
        cache: 'no-store', // Force no cache
      }, API_TIMEOUTS.DEFAULT);

      if (!resp.ok) {
        throw new Error(`Failed to fetch notifications: ${resp.status}`);
      }

      return resp;
    }, {
      maxRetries: 3,
      baseDelay: API_TIMEOUTS.RETRY_BASE_DELAY,
      backoff: 'exponential',
      retryOn: [429, 500],
      checkResponse: false // Already checking resp.ok above
    });

    this.updateRateLimit(response);

    // Update poll interval from response headers
    const pollHeader = response.headers.get('X-Poll-Interval');
    if (pollHeader) {
      this.pollInterval = Math.max(parseInt(pollHeader, 10), MIN_POLL_INTERVAL_SECONDS);
    }

    this.lastUpdate = new Date().toISOString();

    if (response.status === 200) {
      const notifications = await response.json();

      // Handle pagination
      const linkHeader = response.headers.get('Link');
      if (linkHeader && linkHeader.includes('rel="next"')) {
        // For simplicity, just get first page for now
        // Can extend to handle pagination if needed
      }

      return notifications;
    }

    // 304 Not Modified
    return null;
  }

  /**
   * Parse CheckSuite status from title
   * @private
   */
  parseCheckSuiteStatus(title) {
    const lower = title.toLowerCase();

    const patterns = [
      { keywords: ['succeeded', 'passed', 'success'], conclusion: 'success', status: 'completed' },
      { keywords: ['failed', 'failure'], conclusion: 'failure', status: 'completed' },
      { keywords: ['cancelled'], conclusion: 'cancelled', status: 'completed' },
      { keywords: ['skipped'], conclusion: 'skipped', status: 'completed' },
      { keywords: ['in progress', 'running'], conclusion: null, status: 'in_progress' },
      { keywords: ['queued', 'pending'], conclusion: null, status: 'queued' },
    ];

    const match = patterns.find(p => p.keywords.some(kw => lower.includes(kw)));
    return match ? { conclusion: match.conclusion, status: match.status }
                 : { conclusion: null, status: 'completed' };
  }

  /**
   * Get notification details (including URL and metadata)
   */
  async getNotificationDetails(notification) {
    const subjectType = notification.subject.type;
    const repo = notification.repository;

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
              const runsResp = await fetchWithTimeout(runsUrl, {
                headers: this.headers,
              }, API_TIMEOUTS.USER_INFO);

              if (runsResp.ok) {
                const runsData = await runsResp.json();
                // Match by name and time (5 min window)
                const notifTime = new Date(notification.updated_at).getTime();
                const matchingRun = runsData.workflow_runs?.find(run =>
                  run.name === workflowName &&
                  Math.abs(notifTime - new Date(run.updated_at).getTime()) < TIMING_THRESHOLDS.WORKFLOW_MATCH_WINDOW
                );

                if (matchingRun?.actor) {
                  return {
                    html_url: matchingRun.html_url || html_url,
                    conclusion: result.conclusion,
                    status: result.status,
                    user: matchingRun.actor,
                    number: matchingRun.run_number
                  };
                }
              }
            } catch (e) {
              console.warn('Failed to fetch workflow runs for CheckSuite:', e);
            }
          }

          return {
            html_url,
            conclusion: result.conclusion,
            status: result.status,
            user: this.userInfo || repo.owner
          };
        }

        default:
          return { html_url: repo.html_url };
      }
    }

    const response = await retryWithStrategy(async () => {
      const resp = await fetchWithTimeout(notification.subject.url, {
        headers: this.headers,
      }, API_TIMEOUTS.NOTIFICATION_DETAILS);

      if (!resp.ok) {
        throw new Error(`Failed to fetch notification details: ${resp.status}`);
      }

      return resp;
    }, {
      maxRetries: 2,
      baseDelay: API_TIMEOUTS.RETRY_BASE_DELAY,
      backoff: 'exponential',
      retryOn: [429, 500],
      checkResponse: false // Already checking resp.ok above
    });

    this.updateRateLimit(response);
    return await response.json();
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(threadId) {
    const url = `${GITHUB_API_BASE}/notifications/threads/${threadId}`;

    const response = await retryWithStrategy(async () => {
      return await fetch(url, {
        method: 'PATCH',
        headers: this.headers,
      });
    }, {
      maxRetries: 2,
      baseDelay: API_TIMEOUTS.RETRY_REQUEST_BASE_DELAY,
      backoff: 'linear',
      retryOn: [401, 500],
      checkResponse: true
    });

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
      return await fetch(`${GITHUB_API_BASE}/notifications`, {
        method: 'PUT',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          last_read_at: this.lastUpdate,
        }),
      });
    }, {
      maxRetries: 2,
      baseDelay: API_TIMEOUTS.RETRY_REQUEST_BASE_DELAY,
      backoff: 'linear',
      retryOn: [401, 500],
      checkResponse: true
    });

    this.updateRateLimit(response);
    return true;
  }
}

// Singleton instance
export const github = new GitHubAPI();
export default github;
