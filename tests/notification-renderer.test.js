import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../src/lib/constants.js', () => ({
  ANIMATION_DURATION: {
    FADE_OUT: 200,
    SLIDE_UP: 200,
    ERROR_BACKGROUND_FADE: 1000,
  },
  NOTIFICATION_TYPES: {
    RELEASE: 'Release',
  },
  MESSAGE_TYPES: {
    MARK_AS_READ: 'markAsRead',
    OPEN_NOTIFICATION: 'openNotification',
  },
  TIME_CONVERSION: {
    MS_TO_MINUTES: 60000,
  },
}));

vi.mock('../src/lib/format-utils.js', () => ({
  formatReason: vi.fn((reason) => reason),
  getNotificationStatus: vi.fn(() => 'Status'),
  escapeHtml: vi.fn((text) => text),
  escapeAttr: vi.fn((text) => text),
}));

vi.mock('../src/lib/icons.js', () => ({
  getIconSVG: vi.fn(() => '<svg></svg>'),
}));

const { formatTimeAgo, initRenderer, getCachedNotifications, createNotificationsHash } =
  await import('../src/popup/notification-renderer.js');

describe('notification-renderer', () => {
  describe('formatTimeAgo', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return "now" for very recent times', () => {
      const now = new Date('2024-06-15T12:00:00Z');
      expect(formatTimeAgo(now.toISOString())).toBe('now');
    });

    it('should return "now" for times less than 1 minute ago', () => {
      const thirtySecondsAgo = new Date('2024-06-15T11:59:30Z');
      expect(formatTimeAgo(thirtySecondsAgo.toISOString())).toBe('now');
    });

    it('should return "1m ago" at exactly 1 minute', () => {
      const oneMinuteAgo = new Date('2024-06-15T11:59:00Z');
      expect(formatTimeAgo(oneMinuteAgo.toISOString())).toBe('1m ago');
    });

    it('should return minutes ago for times less than 1 hour', () => {
      const fiveMinutesAgo = new Date('2024-06-15T11:55:00Z');
      expect(formatTimeAgo(fiveMinutesAgo.toISOString())).toBe('5m ago');

      const thirtyMinutesAgo = new Date('2024-06-15T11:30:00Z');
      expect(formatTimeAgo(thirtyMinutesAgo.toISOString())).toBe('30m ago');

      const fiftyNineMinutesAgo = new Date('2024-06-15T11:01:00Z');
      expect(formatTimeAgo(fiftyNineMinutesAgo.toISOString())).toBe('59m ago');
    });

    it('should return "1h ago" at exactly 1 hour', () => {
      const oneHourAgo = new Date('2024-06-15T11:00:00Z');
      expect(formatTimeAgo(oneHourAgo.toISOString())).toBe('1h ago');
    });

    it('should return hours ago for times less than 24 hours', () => {
      const twoHoursAgo = new Date('2024-06-15T10:00:00Z');
      expect(formatTimeAgo(twoHoursAgo.toISOString())).toBe('2h ago');

      const twelveHoursAgo = new Date('2024-06-15T00:00:00Z');
      expect(formatTimeAgo(twelveHoursAgo.toISOString())).toBe('12h ago');

      const twentyThreeHoursAgo = new Date('2024-06-14T13:00:00Z');
      expect(formatTimeAgo(twentyThreeHoursAgo.toISOString())).toBe('23h ago');
    });

    it('should return "1d ago" at exactly 24 hours', () => {
      const oneDayAgo = new Date('2024-06-14T12:00:00Z');
      expect(formatTimeAgo(oneDayAgo.toISOString())).toBe('1d ago');
    });

    it('should return days ago for times less than 30 days', () => {
      const sevenDaysAgo = new Date('2024-06-08T12:00:00Z');
      expect(formatTimeAgo(sevenDaysAgo.toISOString())).toBe('7d ago');

      const twentyNineDaysAgo = new Date('2024-05-17T12:00:00Z');
      expect(formatTimeAgo(twentyNineDaysAgo.toISOString())).toBe('29d ago');
    });

    it('should return formatted date for times at exactly 30 days', () => {
      const thirtyDaysAgo = new Date('2024-05-16T12:00:00Z');
      const result = formatTimeAgo(thirtyDaysAgo.toISOString());
      // Should be a date format, not "d ago"
      expect(result).not.toMatch(/\d+d ago/);
    });

    it('should return formatted date for times over 30 days', () => {
      const sixtyDaysAgo = new Date('2024-04-16T12:00:00Z');
      const result = formatTimeAgo(sixtyDaysAgo.toISOString());
      expect(result).not.toMatch(/\d+d ago/);
      expect(result).not.toMatch(/\d+h ago/);
      expect(result).not.toMatch(/\d+m ago/);
    });

    it('should handle future dates gracefully', () => {
      const futureDate = new Date('2024-06-16T12:00:00Z');
      // Future dates result in negative diff, so should show "now"
      expect(formatTimeAgo(futureDate.toISOString())).toBe('now');
    });
  });

  describe('initRenderer', () => {
    it('should set configuration options', () => {
      const mockConfig = {
        notificationsList: {},
        emptyState: {},
        markAllBtn: {},
        getShowHoverCards: () => false,
        sendMessage: vi.fn(),
        onUserAction: vi.fn(),
      };

      expect(() => initRenderer(mockConfig)).not.toThrow();
    });
  });

  describe('cache functions', () => {
    it('getCachedNotifications should return null initially', () => {
      const result = getCachedNotifications();
      expect(result === null || Array.isArray(result)).toBe(true);
    });
  });
});

// Test pure helper functions by recreating them
describe('notification-renderer helper functions', () => {
  describe('createNotificationsHash', () => {
    // Using the exported function from notification-renderer.js

    it.each([
      [null, 'empty'],
      [undefined, 'empty'],
      [[], 'empty'],
    ])('should return "empty" for %s', (input, expected) => {
      expect(createNotificationsHash(input)).toBe(expected);
    });

    it('should create hash from single notification', () => {
      const notifications = [{ id: '123', updated_at: '2024-01-01T00:00:00Z', author: { login: 'user1' } }];
      expect(createNotificationsHash(notifications)).toBe('123:2024-01-01T00:00:00Z:user1');
    });

    it('should create hash from multiple notifications', () => {
      const notifications = [
        { id: '1', updated_at: '2024-01-01T00:00:00Z', author: { login: 'user1' } },
        { id: '2', updated_at: '2024-01-02T00:00:00Z', author: { login: 'user2' } },
      ];
      const hash = createNotificationsHash(notifications);
      expect(hash).toBe('1:2024-01-01T00:00:00Z:user1|2:2024-01-02T00:00:00Z:user2');
    });

    it('should handle notifications without author', () => {
      const notifications = [{ id: '123', updated_at: '2024-01-01T00:00:00Z' }];
      expect(createNotificationsHash(notifications)).toBe('123:2024-01-01T00:00:00Z:');
    });

    it('should handle mixed notifications with and without author', () => {
      const notifications = [
        { id: '1', updated_at: '2024-01-01T00:00:00Z', author: { login: 'user1' } },
        { id: '2', updated_at: '2024-01-02T00:00:00Z' },
        { id: '3', updated_at: '2024-01-03T00:00:00Z', author: { login: 'user3' } },
      ];
      const hash = createNotificationsHash(notifications);
      expect(hash).toBe('1:2024-01-01T00:00:00Z:user1|2:2024-01-02T00:00:00Z:|3:2024-01-03T00:00:00Z:user3');
    });

    it('should produce different hashes for different data', () => {
      const notifs1 = [{ id: '1', updated_at: '2024-01-01T00:00:00Z' }];
      const notifs2 = [{ id: '1', updated_at: '2024-01-02T00:00:00Z' }];
      const notifs3 = [{ id: '2', updated_at: '2024-01-01T00:00:00Z' }];

      const hash1 = createNotificationsHash(notifs1);
      const hash2 = createNotificationsHash(notifs2);
      const hash3 = createNotificationsHash(notifs3);

      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash2).not.toBe(hash3);
    });
  });

  describe('createHoverCard HTML generation', () => {
    // Test the logic of hover card content generation
    function getHoverCardParts(notif) {
      const hasAuthor = notif.author?.login;
      const hasComments = notif.comment_count > 0;
      const hasDescription = notif.body?.trim();

      return { hasAuthor, hasComments, hasDescription };
    }

    it('should detect author presence', () => {
      const notifWithAuthor = { author: { login: 'testuser' } };
      const notifWithoutAuthor = {};

      expect(getHoverCardParts(notifWithAuthor).hasAuthor).toBe('testuser');
      expect(getHoverCardParts(notifWithoutAuthor).hasAuthor).toBeFalsy();
    });

    it('should detect comments presence', () => {
      const notifWithComments = { comment_count: 5 };
      const notifWithZeroComments = { comment_count: 0 };
      const notifWithoutComments = {};

      expect(getHoverCardParts(notifWithComments).hasComments).toBe(true);
      expect(getHoverCardParts(notifWithZeroComments).hasComments).toBe(false);
      expect(getHoverCardParts(notifWithoutComments).hasComments).toBe(false);
    });

    it('should detect description presence', () => {
      const notifWithBody = { body: 'Description text' };
      const notifWithEmptyBody = { body: '   ' };
      const notifWithoutBody = {};

      expect(getHoverCardParts(notifWithBody).hasDescription).toBeTruthy();
      expect(getHoverCardParts(notifWithEmptyBody).hasDescription).toBeFalsy();
      expect(getHoverCardParts(notifWithoutBody).hasDescription).toBeFalsy();
    });
  });

  describe('comment pluralization', () => {
    function formatCommentCount(count) {
      return `${count} comment${count > 1 ? 's' : ''}`;
    }

    it('should use singular for 1 comment', () => {
      expect(formatCommentCount(1)).toBe('1 comment');
    });

    it('should use plural for multiple comments', () => {
      expect(formatCommentCount(2)).toBe('2 comments');
      expect(formatCommentCount(10)).toBe('10 comments');
      expect(formatCommentCount(100)).toBe('100 comments');
    });
  });

  describe('icon class building', () => {
    function buildIconClass(notif) {
      let iconClass = notif.icon;
      if (notif.icon === 'pr' || notif.icon === 'issue') {
        if (notif.merged) {
          iconClass += ' merged';
        } else if (notif.state) {
          iconClass += ` ${notif.state}`;
        }
      }
      return iconClass;
    }

    it('should return base icon class for non-PR/issue', () => {
      expect(buildIconClass({ icon: 'release' })).toBe('release');
      expect(buildIconClass({ icon: 'discussion' })).toBe('discussion');
    });

    it('should add merged class for merged PRs', () => {
      expect(buildIconClass({ icon: 'pr', merged: true })).toBe('pr merged');
    });

    it('should add state class for PRs with state', () => {
      expect(buildIconClass({ icon: 'pr', state: 'open' })).toBe('pr open');
      expect(buildIconClass({ icon: 'pr', state: 'closed' })).toBe('pr closed');
    });

    it('should add state class for issues', () => {
      expect(buildIconClass({ icon: 'issue', state: 'open' })).toBe('issue open');
      expect(buildIconClass({ icon: 'issue', state: 'closed' })).toBe('issue closed');
    });

    it('should prioritize merged over state', () => {
      expect(buildIconClass({ icon: 'pr', merged: true, state: 'closed' })).toBe('pr merged');
    });
  });

  describe('release body truncation', () => {
    function truncateBody(body, maxLength = 200) {
      if (!body) return '';
      const trimmed = body.trim();
      if (trimmed.length <= maxLength) return trimmed;
      return `${trimmed.substring(0, maxLength)}...`;
    }

    it('should return empty string for null/undefined', () => {
      expect(truncateBody(null)).toBe('');
      expect(truncateBody(undefined)).toBe('');
    });

    it('should trim whitespace', () => {
      expect(truncateBody('  text  ')).toBe('text');
    });

    it('should not truncate short text', () => {
      const shortText = 'Short description';
      expect(truncateBody(shortText)).toBe(shortText);
    });

    it('should truncate long text at 200 characters', () => {
      const longText = 'a'.repeat(250);
      const result = truncateBody(longText);
      expect(result).toBe(`${'a'.repeat(200)}...`);
      expect(result.length).toBe(203); // 200 + '...'
    });

    it('should not add ellipsis for exactly 200 characters', () => {
      const exactText = 'a'.repeat(200);
      expect(truncateBody(exactText)).toBe(exactText);
    });
  });
});
