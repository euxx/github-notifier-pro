/**
 * HTTP utilities: fetch with timeout, configurable retry strategy.
 *
 * Pure helpers shared by the GitHub API client. No GitHub-specific knowledge,
 * no shared state — extracted so the API client doesn't have to mix transport
 * concerns with endpoint logic.
 */

import { API_TIMEOUTS } from "./constants.js";

/**
 * Create a fetch request with timeout
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @param {number} timeout - Timeout in milliseconds (default: 30s)
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}, timeout = API_TIMEOUTS.DEFAULT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Request timeout", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Unified retry function with configurable strategy
 * @param {Function} fetchFn - Function that returns a fetch promise
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.baseDelay - Base delay in milliseconds (default: 1000)
 * @param {string} options.backoff - Backoff strategy: 'exponential' or 'linear' (default: 'exponential')
 * @param {Array<number>} options.retryOn - HTTP status codes to retry on (default: [429])
 * @param {boolean} options.checkResponse - Whether to check response.ok (default: true)
 * @returns {Promise<Response>}
 */
export async function retryWithStrategy(fetchFn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = API_TIMEOUTS.RETRY_BASE_DELAY,
    backoff = "exponential",
    retryOn = [429],
    checkResponse = true,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchFn();

      // If checking response and got a response object
      if (checkResponse && response && typeof response.status === "number") {
        // Success cases
        if (response.ok || response.status === 205) {
          return response;
        }

        // Check if we should retry this status code.
        // Note: including 500 in retryOn acts as a wildcard for all 5xx errors.
        const shouldRetry =
          retryOn.includes(response.status) || (response.status >= 500 && retryOn.includes(500));

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
        const shouldRetry = retryOn.includes(status) || (status >= 500 && retryOn.includes(500));

        if (!shouldRetry && status >= 400 && status < 500) {
          throw error;
        }
      }

      // Network errors or retryable errors - continue to retry
    }

    // Calculate delay based on backoff strategy
    const delay =
      backoff === "exponential" ? baseDelay * Math.pow(2, attempt) : baseDelay * (attempt + 1);

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw lastError;
}
