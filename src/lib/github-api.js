/**
 * GitHub API client for Chrome extension
 * Supports OAuth and Personal Access Token authentication
 */

import { CLIENT_ID, CLIENT_SECRET } from '../config/config.js';
import { GITHUB_API_BASE, GITHUB_SITE_BASE, MIN_POLL_INTERVAL_SECONDS } from './constants.js';

/**
 * Create a fetch request with timeout
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @param {number} timeout - Timeout in milliseconds (default: 30s)
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeout = 30000) {
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
 * Retry a fetch request with exponential backoff
 * @param {Function} fetchFn - Function that returns a fetch promise
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise<Response>}
 */
async function retryFetch(fetchFn, maxRetries = 3, baseDelay = 1000) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchFn();
    } catch (error) {
      lastError = error;

      // Don't retry on last attempt
      if (attempt === maxRetries) break;

      // Don't retry on certain errors (4xx errors except 429)
      if (error.message && error.message.includes('40') && !error.message.includes('429')) {
        throw error; // Authentication, permission errors - don't retry
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

class GitHubAPI {
  constructor() {
    this.token = null;
    this.username = null;
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
      const resetDate = new Date(info.reset * 1000);
      const now = new Date();
      const diffMs = resetDate - now;
      const diffMins = Math.ceil(diffMs / 60000);

      info.resetTime = resetDate.toLocaleTimeString();
      info.resetIn = diffMins > 0 ? `${diffMins} min` : 'soon';
      info.resetDate = resetDate;
    }
    return info;
  }

  /**
   * Get OAuth redirect URL for Chrome extension
   */
  getRedirectURL() {
    return chrome.identity.getRedirectURL('oauth');
  }

  /**
   * Start OAuth flow or use PAT
   * @param {string} authMethod - 'oauth' or 'pat'
   * @param {string} token - PAT token (required if authMethod is 'pat')
   */
  async login(authMethod = 'pat', token = null) {
    // If using PAT, skip OAuth flow
    if (authMethod === 'pat') {
      if (!token) {
        throw new Error('Token required for PAT authentication');
      }
      this.token = token;
      await this.fetchUsername();
      return true;
    }

    // OAuth flow (Chrome only)
    const redirectURL = this.getRedirectURL();
    const state = crypto.randomUUID();

    const authURL = new URL(`${GITHUB_SITE_BASE}/login/oauth/authorize`);
    authURL.searchParams.set('client_id', CLIENT_ID);
    authURL.searchParams.set('redirect_uri', redirectURL);
    authURL.searchParams.set('scope', 'repo notifications');
    authURL.searchParams.set('state', state);

    try {
      const responseURL = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({
          url: authURL.toString(),
          interactive: true,
        }, (responseUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(responseUrl);
          }
        });
      });

      const url = new URL(responseURL);
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');

      if (returnedState !== state) {
        throw new Error('State mismatch');
      }

      if (!code) {
        throw new Error('No authorization code received');
      }

      // Exchange code for token
      const accessToken = await this.exchangeCodeForToken(code);
      this.token = accessToken;

      // Get username
      await this.fetchUsername();

      return true;
    } catch (error) {
      console.error('OAuth error:', error);
      throw error;
    }
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code) {
    const response = await fetch(`${GITHUB_SITE_BASE}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    return data.access_token;
  }

  /**
   * Fetch current user's username
   */
  async fetchUsername() {
    const response = await fetchWithTimeout(`${GITHUB_API_BASE}/user`, {
      headers: this.headers,
    }, 10000);

    this.updateRateLimit(response);

    if (response.ok) {
      const data = await response.json();
      this.username = data.login;
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

    const response = await retryFetch(async () => {
      const resp = await fetchWithTimeout(url.toString(), {
        headers: this.headers,
        cache: 'no-store', // Force no cache
      }, 30000);

      if (!resp.ok) {
        throw new Error(`Failed to fetch notifications: ${resp.status}`);
      }

      return resp;
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

    // Status patterns: [keywords, conclusion, status]
    const patterns = [
      { keywords: ['succeeded', 'passed', 'success'], conclusion: 'success', status: 'completed' },
      { keywords: ['failed', 'failure'], conclusion: 'failure', status: 'completed' },
      { keywords: ['cancelled'], conclusion: 'cancelled', status: 'completed' },
      { keywords: ['skipped'], conclusion: 'skipped', status: 'completed' },
      { keywords: ['in progress', 'running'], conclusion: null, status: 'in_progress' },
      { keywords: ['queued', 'pending'], conclusion: null, status: 'queued' },
    ];

    for (const pattern of patterns) {
      if (pattern.keywords.some(kw => lower.includes(kw))) {
        return { conclusion: pattern.conclusion, status: pattern.status };
      }
    }

    // Fallback if no pattern matches
    return { conclusion: null, status: 'completed' };
  }

  /**
   * Get notification details (for URL resolution)
   */
  async getNotificationDetails(notification) {
    const subjectType = notification.subject.type;
    const repo = notification.repository;

    // Handle special types without subject URL
    if (!notification.subject.url) {
      switch (subjectType) {
        case 'RepositoryInvitation':
          return { html_url: `${repo.html_url}/invitations` };
        case 'RepositoryVulnerabilityAlert':
          return { html_url: `${repo.html_url}/network/dependencies` };
        case 'RepositoryDependabotAlertsThread':
          return { html_url: `${repo.html_url}/security/dependabot` };
        case 'CheckSuite': {
          // Extract conclusion from title since GitHub doesn't provide subject.url for CheckSuite
          // Title format: "XXX workflow run {succeeded|failed|cancelled|skipped} for YYY branch"
          const result = this.parseCheckSuiteStatus(notification.subject.title);
          return {
            html_url: `${repo.html_url}/actions`,
            conclusion: result.conclusion,
            status: result.status
          };
        }
        case 'Discussion':
          return { html_url: `${repo.html_url}/discussions` };
        default:
          return { html_url: repo.html_url };
      }
    }

    // Fetch subject details with retry
    const response = await retryFetch(async () => {
      const resp = await fetchWithTimeout(notification.subject.url, {
        headers: this.headers,
      }, 15000); // Shorter timeout for details

      if (!resp.ok) {
        throw new Error(`Failed to fetch notification details: ${resp.status}`);
      }

      return resp;
    }, 2); // Only 2 retries for details (less critical)

    this.updateRateLimit(response);
    return await response.json();
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(threadId) {
    const url = `${GITHUB_API_BASE}/notifications/threads/${threadId}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.headers,
    });

    this.updateRateLimit(response);

    if (!response.ok) {
      throw new Error(`Failed to mark notification as read: ${response.status}`);
    }

    return true;
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead() {
    if (!this.lastUpdate) {
      this.lastUpdate = new Date().toISOString();
    }

    const response = await fetch(`${GITHUB_API_BASE}/notifications`, {
      method: 'PUT',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        last_read_at: this.lastUpdate,
      }),
    });

    this.updateRateLimit(response);

    if (!response.ok && response.status !== 205) {
      throw new Error(`Failed to mark all as read: ${response.status}`);
    }

    return true;
  }
}

// Singleton instance
export const github = new GitHubAPI();
export default github;
