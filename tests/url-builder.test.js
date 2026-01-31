import { describe, it, expect } from 'vitest';
import { buildNotificationUrl } from '../src/lib/url-builder.js';

const GITHUB_BASE = 'https://github.com';

describe('buildNotificationUrl', () => {
  describe('when html_url is present', () => {
    it('should return html_url directly', () => {
      const notification = {
        html_url: 'https://github.com/owner/repo/issues/123',
        type: 'Issue',
        repository: { full_name: 'owner/repo' },
      };
      expect(buildNotificationUrl(notification)).toBe(
        'https://github.com/owner/repo/issues/123'
      );
    });
  });

  describe('Issue notifications', () => {
    it('should build issue URL with number', () => {
      const notification = {
        type: 'Issue',
        number: 42,
        repository: { full_name: 'owner/repo', html_url: `${GITHUB_BASE}/owner/repo` },
      };
      expect(buildNotificationUrl(notification)).toBe(`${GITHUB_BASE}/owner/repo/issues/42`);
    });

    it('should build issues list URL without number', () => {
      const notification = {
        type: 'Issue',
        repository: { full_name: 'owner/repo', html_url: `${GITHUB_BASE}/owner/repo` },
      };
      expect(buildNotificationUrl(notification)).toBe(`${GITHUB_BASE}/owner/repo/issues`);
    });
  });

  describe('PullRequest notifications', () => {
    it('should build PR URL with number', () => {
      const notification = {
        type: 'PullRequest',
        number: 100,
        repository: { full_name: 'owner/repo', html_url: `${GITHUB_BASE}/owner/repo` },
      };
      expect(buildNotificationUrl(notification)).toBe(`${GITHUB_BASE}/owner/repo/pull/100`);
    });

    it('should build PRs list URL without number', () => {
      const notification = {
        type: 'PullRequest',
        repository: { full_name: 'owner/repo', html_url: `${GITHUB_BASE}/owner/repo` },
      };
      expect(buildNotificationUrl(notification)).toBe(`${GITHUB_BASE}/owner/repo/pulls`);
    });
  });

  describe('Release notifications', () => {
    it('should build releases URL', () => {
      const notification = {
        type: 'Release',
        repository: { full_name: 'owner/repo', html_url: `${GITHUB_BASE}/owner/repo` },
      };
      expect(buildNotificationUrl(notification)).toBe(`${GITHUB_BASE}/owner/repo/releases`);
    });
  });

  describe('Commit notifications', () => {
    it('should build commit URL with SHA from API URL', () => {
      const notification = {
        type: 'Commit',
        url: 'https://api.github.com/repos/owner/repo/commits/abc123def',
        repository: { full_name: 'owner/repo', html_url: `${GITHUB_BASE}/owner/repo` },
      };
      expect(buildNotificationUrl(notification)).toBe(
        `${GITHUB_BASE}/owner/repo/commit/abc123def`
      );
    });

    it('should build commits list URL without API URL', () => {
      const notification = {
        type: 'Commit',
        repository: { full_name: 'owner/repo', html_url: `${GITHUB_BASE}/owner/repo` },
      };
      expect(buildNotificationUrl(notification)).toBe(`${GITHUB_BASE}/owner/repo/commits`);
    });
  });

  describe('Discussion notifications', () => {
    it('should build discussions URL', () => {
      const notification = {
        type: 'Discussion',
        repository: { full_name: 'owner/repo', html_url: `${GITHUB_BASE}/owner/repo` },
      };
      expect(buildNotificationUrl(notification)).toBe(`${GITHUB_BASE}/owner/repo/discussions`);
    });
  });

  describe('CheckSuite notifications', () => {
    it('should build actions URL', () => {
      const notification = {
        type: 'CheckSuite',
        repository: { full_name: 'owner/repo', html_url: `${GITHUB_BASE}/owner/repo` },
      };
      expect(buildNotificationUrl(notification)).toBe(`${GITHUB_BASE}/owner/repo/actions`);
    });
  });

  describe('RepositoryInvitation notifications', () => {
    it('should build invitations URL', () => {
      const notification = {
        type: 'RepositoryInvitation',
        repository: { full_name: 'owner/repo', html_url: `${GITHUB_BASE}/owner/repo` },
      };
      expect(buildNotificationUrl(notification)).toBe(`${GITHUB_BASE}/owner/repo/invitations`);
    });
  });

  describe('RepositoryVulnerabilityAlert notifications', () => {
    it('should build dependencies URL', () => {
      const notification = {
        type: 'RepositoryVulnerabilityAlert',
        repository: { full_name: 'owner/repo', html_url: `${GITHUB_BASE}/owner/repo` },
      };
      expect(buildNotificationUrl(notification)).toBe(
        `${GITHUB_BASE}/owner/repo/network/dependencies`
      );
    });
  });

  describe('RepositoryDependabotAlertsThread notifications', () => {
    it('should build dependabot URL', () => {
      const notification = {
        type: 'RepositoryDependabotAlertsThread',
        repository: { full_name: 'owner/repo', html_url: `${GITHUB_BASE}/owner/repo` },
      };
      expect(buildNotificationUrl(notification)).toBe(
        `${GITHUB_BASE}/owner/repo/security/dependabot`
      );
    });
  });

  describe('Unknown notification types', () => {
    it('should fallback to repository URL', () => {
      const notification = {
        type: 'UnknownType',
        repository: { full_name: 'owner/repo', html_url: `${GITHUB_BASE}/owner/repo` },
      };
      expect(buildNotificationUrl(notification)).toBe(`${GITHUB_BASE}/owner/repo`);
    });
  });
});
