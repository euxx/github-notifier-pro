import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the config module before importing github-api
vi.mock('../src/config/config.js', () => ({
  CLIENT_ID: 'test-client-id',
}));

// Mock url-builder
vi.mock('../src/lib/url-builder.js', () => ({
  buildNotificationUrl: vi.fn((notif) => `https://github.com/${notif.repository?.full_name || 'test/repo'}`),
}));

// Import after mocks are set up
const { github, default: githubDefault } = await import('../src/lib/github-api.js');

describe('GitHubAPI', () => {
  let mockFetch;

  beforeEach(() => {
    // Reset github state
    github.token = null;
    github.username = null;
    github.userInfo = null;
    github.pollInterval = 60;
    github.lastUpdate = null;
    github.rateLimit = {
      limit: null,
      remaining: null,
      reset: null,
      isLimited: false,
    };

    // Mock fetch globally
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('isAuthenticated', () => {
    it('should return false when no token', () => {
      expect(github.isAuthenticated).toBe(false);
    });

    it('should return true when token exists', () => {
      github.token = 'test-token';
      expect(github.isAuthenticated).toBe(true);
    });
  });

  describe('headers', () => {
    it('should return base headers without token', () => {
      const headers = github.headers;
      expect(headers['Accept']).toBe('application/vnd.github+json');
      expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('should include Authorization header with token', () => {
      github.token = 'test-token';
      const headers = github.headers;
      expect(headers['Authorization']).toBe('Bearer test-token');
    });
  });

  describe('updateRateLimit', () => {
    it('should update rate limit from response headers', () => {
      const mockResponse = {
        headers: {
          get: vi.fn((name) => {
            const headers = {
              'X-RateLimit-Limit': '5000',
              'X-RateLimit-Remaining': '4999',
              'X-RateLimit-Reset': '1700000000',
            };
            return headers[name];
          }),
        },
      };

      github.updateRateLimit(mockResponse);

      expect(github.rateLimit.limit).toBe(5000);
      expect(github.rateLimit.remaining).toBe(4999);
      expect(github.rateLimit.reset).toBe(1700000000);
      expect(github.rateLimit.isLimited).toBe(false);
    });

    it('should set isLimited when remaining is 0', () => {
      const mockResponse = {
        headers: {
          get: vi.fn((name) => {
            const headers = {
              'X-RateLimit-Limit': '5000',
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': '1700000000',
            };
            return headers[name];
          }),
        },
      };

      github.updateRateLimit(mockResponse);

      expect(github.rateLimit.isLimited).toBe(true);
    });
  });

  describe('isRateLimited', () => {
    it('should return false when not limited', () => {
      github.rateLimit.isLimited = false;
      expect(github.isRateLimited()).toBe(false);
    });

    it('should return true when limited and reset time not passed', () => {
      const futureReset = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      github.rateLimit.isLimited = true;
      github.rateLimit.reset = futureReset;

      expect(github.isRateLimited()).toBe(true);
    });

    it('should return false and clear isLimited when reset time has passed', () => {
      const pastReset = Math.floor(Date.now() / 1000) - 100; // 100 seconds ago
      github.rateLimit.isLimited = true;
      github.rateLimit.reset = pastReset;

      expect(github.isRateLimited()).toBe(false);
      expect(github.rateLimit.isLimited).toBe(false);
    });
  });

  describe('getRateLimitInfo', () => {
    it('should return rate limit info with human-readable time', () => {
      const futureReset = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now
      github.rateLimit = {
        limit: 5000,
        remaining: 100,
        reset: futureReset,
        isLimited: false,
      };

      const info = github.getRateLimitInfo();

      expect(info.limit).toBe(5000);
      expect(info.remaining).toBe(100);
      expect(info.resetTime).toBeDefined();
      expect(info.resetIn).toMatch(/\d+ min|soon/);
      expect(info.resetDate).toBeInstanceOf(Date);
    });
  });

  describe('login with PAT', () => {
    it('should set token and fetch username on PAT login', async() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          login: 'testuser',
          avatar_url: 'https://avatar.url',
          html_url: 'https://github.com/testuser',
        }),
        headers: {
          get: () => null,
        },
      });

      await github.login('pat', 'ghp_testtoken');

      expect(github.token).toBe('ghp_testtoken');
      expect(github.username).toBe('testuser');
      expect(github.userInfo.login).toBe('testuser');
    });

    it('should throw error when PAT login without token', async() => {
      await expect(github.login('pat')).rejects.toThrow('Token required for PAT authentication');
    });

    it('should throw error when fetchUsername fails', async() => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => null },
      });

      await expect(github.login('pat', 'invalid-token')).rejects.toThrow('Failed to fetch username');
    });
  });

  describe('logout', () => {
    it('should clear all auth state', () => {
      github.token = 'test-token';
      github.username = 'testuser';
      github.userInfo = { login: 'testuser' };

      github.logout();

      expect(github.token).toBeNull();
      expect(github.username).toBeNull();
      expect(github.userInfo).toBeNull();
    });
  });

  describe('getNotifications', () => {
    it('should throw when not authenticated', async() => {
      github.token = null;
      await expect(github.getNotifications()).rejects.toThrow('Not authenticated');
    });

    it('should throw when rate limited', async() => {
      github.token = 'test-token';
      github.rateLimit.isLimited = true;
      github.rateLimit.reset = Math.floor(Date.now() / 1000) + 3600;

      await expect(github.getNotifications()).rejects.toThrow(/Rate limited/);
    });

    it('should fetch and return notifications', async() => {
      github.token = 'test-token';

      const mockNotifications = [
        { id: '1', subject: { title: 'Test Issue' } },
        { id: '2', subject: { title: 'Test PR' } },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockNotifications),
        headers: {
          get: vi.fn((name) => {
            if (name === 'X-Poll-Interval') return '60';
            if (name === 'Link') return null;
            return null;
          }),
        },
      });

      const result = await github.getNotifications();

      expect(result).toEqual(mockNotifications);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(github.lastUpdate).not.toBeNull();
    });

    it('should update poll interval from response', async() => {
      github.token = 'test-token';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        headers: {
          get: vi.fn((name) => {
            if (name === 'X-Poll-Interval') return '120';
            return null;
          }),
        },
      });

      await github.getNotifications();

      expect(github.pollInterval).toBe(120);
    });

    it('should enforce minimum poll interval', async() => {
      github.token = 'test-token';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        headers: {
          get: vi.fn((name) => {
            if (name === 'X-Poll-Interval') return '30'; // Below minimum
            return null;
          }),
        },
      });

      await github.getNotifications();

      expect(github.pollInterval).toBe(60); // Should be MIN_POLL_INTERVAL_SECONDS
    });
  });

  describe('markAsRead', () => {
    it('should call PATCH on notification thread', async() => {
      github.token = 'test-token';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 205,
        headers: { get: () => null },
      });

      const result = await github.markAsRead('12345');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/notifications/threads/12345',
        expect.objectContaining({
          method: 'PATCH',
        }),
      );
    });
  });

  describe('markAllAsRead', () => {
    it('should call PUT on notifications endpoint', async() => {
      github.token = 'test-token';
      github.lastUpdate = '2024-01-01T00:00:00Z';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 205,
        headers: { get: () => null },
      });

      const result = await github.markAllAsRead();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/notifications',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('last_read_at'),
        }),
      );
    });

    it('should set lastUpdate if not present', async() => {
      github.token = 'test-token';
      github.lastUpdate = null;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 205,
        headers: { get: () => null },
      });

      await github.markAllAsRead();

      expect(github.lastUpdate).not.toBeNull();
    });
  });

  describe('parseCheckSuiteStatus', () => {
    // Access private method through prototype or test via getNotificationDetails
    const testCases = [
      { title: 'Build succeeded', expected: { conclusion: 'success', status: 'completed' } },
      { title: 'Tests passed', expected: { conclusion: 'success', status: 'completed' } },
      { title: 'Build failed', expected: { conclusion: 'failure', status: 'completed' } },
      { title: 'Deploy cancelled', expected: { conclusion: 'cancelled', status: 'completed' } },
      { title: 'Lint skipped', expected: { conclusion: 'skipped', status: 'completed' } },
      { title: 'Build in progress', expected: { conclusion: null, status: 'in_progress' } },
      { title: 'Job queued', expected: { conclusion: null, status: 'queued' } },
      { title: 'Unknown status', expected: { conclusion: null, status: 'completed' } },
    ];

    testCases.forEach(({ title, expected }) => {
      it(`should parse "${title}" correctly`, () => {
        // Access the method - it's on the prototype
        const result = github.parseCheckSuiteStatus(title);
        expect(result).toEqual(expected);
      });
    });
  });

  describe('getNotificationDetails', () => {
    beforeEach(() => {
      github.token = 'test-token';
    });

    it('should return html_url from buildNotificationUrl when no subject.url', async() => {
      const notification = {
        subject: {
          type: 'Release',
          title: 'v1.0.0',
        },
        repository: {
          full_name: 'owner/repo',
          html_url: 'https://github.com/owner/repo',
        },
      };

      const result = await github.getNotificationDetails(notification);

      expect(result.html_url).toBe('https://github.com/owner/repo');
    });

    it('should fetch details from subject.url when present', async() => {
      const notification = {
        subject: {
          type: 'Issue',
          title: 'Test Issue',
          url: 'https://api.github.com/repos/owner/repo/issues/42',
        },
        repository: {
          full_name: 'owner/repo',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          html_url: 'https://github.com/owner/repo/issues/42',
          state: 'open',
          user: { login: 'author' },
        }),
        headers: { get: () => null },
      });

      const result = await github.getNotificationDetails(notification);

      expect(result.html_url).toBe('https://github.com/owner/repo/issues/42');
      expect(result.state).toBe('open');
    });

    it('should handle CheckSuite notifications', async() => {
      const notification = {
        subject: {
          type: 'CheckSuite',
          title: 'CI workflow run succeeded',
        },
        repository: {
          full_name: 'owner/repo',
          owner: { login: 'owner' },
        },
        updated_at: new Date().toISOString(),
      };

      // Mock workflow runs API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          workflow_runs: [],
        }),
        headers: { get: () => null },
      });

      const result = await github.getNotificationDetails(notification);

      expect(result.conclusion).toBe('success');
      expect(result.status).toBe('completed');
    });
  });

  describe('singleton export', () => {
    it('should export same instance as default and named', () => {
      expect(github).toBe(githubDefault);
    });
  });
});

describe('retry logic', () => {
  let mockFetch;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    github.token = 'test-token';
    github.rateLimit.isLimited = false;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should retry on 429 (rate limit) status', async() => {
    // First call returns 429, second returns success
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => null },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        headers: { get: () => null },
      });

    const promise = github.getNotifications();

    // Advance past retry delay
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;

    expect(result).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should retry on 500+ server errors', async() => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: { get: () => null },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ id: '1' }]),
        headers: { get: () => null },
      });

    const promise = github.getNotifications();

    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;

    expect(result).toEqual([{ id: '1' }]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
