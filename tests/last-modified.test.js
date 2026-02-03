/**
 * Tests for Last-Modified/If-Modified-Since polling optimization
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { github } from '../src/lib/github-api.js';

describe('Last-Modified polling optimization', () => {
  beforeEach(() => {
    github.token = null;
    github.username = null;
    github.lastModified = null;
    vi.clearAllMocks();
  });

  it('should initialize with null lastModified', () => {
    expect(github.lastModified).toBeNull();
  });

  it('should include If-Modified-Since header on subsequent requests', async () => {
    github.token = 'test_token';
    github.username = 'testuser';

    const mockResponses = [
      // First request - returns 200 with Last-Modified
      {
        ok: true,
        status: 200,
        headers: new Map([
          ['Last-Modified', 'Mon, 03 Feb 2026 10:30:00 GMT'],
          ['X-Poll-Interval', '60'],
        ]),
        json: async () => [],
      },
      // Second request - returns 304 Not Modified
      {
        ok: false,
        status: 304,
        headers: new Map([['X-Poll-Interval', '60']]),
      },
    ];

    let requestCount = 0;
    let capturedHeaders = null;

    global.fetch = vi.fn(async (url, options) => {
      if (requestCount === 1) {
        // Capture headers from second request
        capturedHeaders = options.headers;
      }
      const response = mockResponses[requestCount++];
      // Convert Map to Headers-like object
      response.headers.get = (key) => {
        const map = response.headers;
        for (const [k, v] of map.entries()) {
          if (k.toLowerCase() === key.toLowerCase()) {
            return v;
          }
        }
        return null;
      };
      return response;
    });

    // First request
    const result1 = await github.getNotifications();
    expect(result1).not.toBeNull();
    expect(github.lastModified).toBe('Mon, 03 Feb 2026 10:30:00 GMT');

    // Second request
    const result2 = await github.getNotifications();
    expect(result2).toBeNull(); // 304 returns null
    expect(capturedHeaders['If-Modified-Since']).toBe('Mon, 03 Feb 2026 10:30:00 GMT');
  });

  it('should save Last-Modified header from 200 responses', async () => {
    github.token = 'test_token';
    github.username = 'testuser';

    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Map([
        ['Last-Modified', 'Mon, 03 Feb 2026 12:00:00 GMT'],
        ['X-Poll-Interval', '60'],
      ]),
      json: async () => [],
    }));

    // Mock Headers.get method
    global.fetch.mockImplementation(async () => {
      const headers = new Map([
        ['Last-Modified', 'Mon, 03 Feb 2026 12:00:00 GMT'],
        ['X-Poll-Interval', '60'],
      ]);
      return {
        ok: true,
        status: 200,
        headers: {
          get: (key) => {
            for (const [k, v] of headers.entries()) {
              if (k.toLowerCase() === key.toLowerCase()) {
                return v;
              }
            }
            return null;
          },
        },
        json: async () => [],
      };
    });

    await github.getNotifications();
    expect(github.lastModified).toBe('Mon, 03 Feb 2026 12:00:00 GMT');
  });

  it('should return null for 304 Not Modified responses', async () => {
    github.token = 'test_token';
    github.username = 'testuser';
    github.lastModified = 'Mon, 03 Feb 2026 10:00:00 GMT';

    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 304,
      headers: {
        get: (key) => {
          if (key.toLowerCase() === 'x-poll-interval') return '60';
          return null;
        },
      },
    }));

    const result = await github.getNotifications();
    expect(result).toBeNull();
  });

  it('should clear lastModified on logout', () => {
    github.token = 'test_token';
    github.username = 'testuser';
    github.lastModified = 'Mon, 03 Feb 2026 10:00:00 GMT';

    github.logout();

    expect(github.token).toBeNull();
    expect(github.username).toBeNull();
    expect(github.lastModified).toBeNull();
  });

  it('should include explicit query parameters', async () => {
    github.token = 'test_token';
    github.username = 'testuser';

    let capturedUrl = null;

    global.fetch = vi.fn(async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        headers: {
          get: () => null,
        },
        json: async () => [],
      };
    });

    await github.getNotifications();

    expect(capturedUrl).toContain('participating=false');
    expect(capturedUrl).toContain('all=false');
    expect(capturedUrl).toContain('per_page=50');
  });
});
