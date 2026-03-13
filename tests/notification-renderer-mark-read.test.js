/**
 * @vitest-environment jsdom
 *
 * DOM integration tests for mark-as-read behavior in notification-renderer.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// jsdom 28 doesn't expose window.CSS — polyfill CSS.escape for the renderer
beforeAll(() => {
  if (typeof CSS === 'undefined' || !CSS.escape) {
    // @ts-ignore
    globalThis.CSS = {
      escape(value) {
        const str = String(value);
        let result = '';
        for (let i = 0; i < str.length; i++) {
          const code = str.charCodeAt(i);
          if (code === 0) {
            result += '\uFFFD';
            continue;
          }
          if (
            code >= 0x80 ||
            code === 0x2d ||
            code === 0x5f ||
            (code >= 0x30 && code <= 0x39) ||
            (code >= 0x41 && code <= 0x5a) ||
            (code >= 0x61 && code <= 0x7a)
          ) {
            result += str[i];
          } else {
            result += `\\${str[i]}`;
          }
        }
        return result;
      },
    };
  }
});

// ── Mocks must be hoisted before any imports that use them ──────────────────

vi.mock('../src/lib/constants.js', () => ({
  ANIMATION_DURATION: { FADE_OUT: 0, ERROR_BACKGROUND_FADE: 0 },
  NOTIFICATION_TYPES: { RELEASE: 'Release' },
  MESSAGE_TYPES: {
    MARK_AS_READ: 'markAsRead',
    OPEN_NOTIFICATION: 'openNotification',
  },
  TIME_CONVERSION: { MS_PER_MINUTE: 60000 },
}));

vi.mock('../src/lib/format-utils.js', () => ({
  formatReason: vi.fn((r) => r),
  getNotificationStatus: vi.fn(() => ''),
}));

vi.mock('../src/lib/icons.js', () => ({
  getIconSVGElement: vi.fn(() => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    return el;
  }),
}));

const sendMessage = vi.fn();

const { initRenderer, renderNotifications, clearNotificationCache } =
  await import('../src/popup/notification-renderer.js');

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeNotif(id) {
  return {
    id: String(id),
    title: `Notification ${id}`,
    reason: 'mention',
    updated_at: new Date().toISOString(),
    icon: 'issue',
    type: 'Issue',
    url: 'https://github.com/owner/repo/issues/1',
    repository: {
      full_name: 'owner/repo',
      html_url: 'https://github.com/owner/repo',
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('mark single notification as read — repo header count', () => {
  let notificationsList;
  let emptyState;
  let markAllBtn;

  beforeEach(() => {
    vi.clearAllMocks();
    clearNotificationCache();

    // Build minimal popup DOM that the renderer references
    document.body.innerHTML = `
      <ul id="notifications-list"></ul>
      <div id="empty-state" hidden></div>
      <button id="mark-all-btn"></button>
    `;

    notificationsList = document.getElementById('notifications-list');
    emptyState = document.getElementById('empty-state');
    markAllBtn = document.getElementById('mark-all-btn');

    initRenderer({
      notificationsList,
      emptyState,
      markAllBtn,
      sendMessage,
      getShowHoverCards: () => false,
      onUserAction: vi.fn(),
      onMarkRepoAsRead: vi.fn(),
    });
  });

  it('decrements repo-count when one of multiple notifications is marked read', async () => {
    const notifications = [makeNotif(1), makeNotif(2)];
    renderNotifications(notifications);

    // Initial count should be 2
    const repoCountSpan = notificationsList.querySelector('.repo-count');
    expect(repoCountSpan.textContent).toBe('2');

    // Mark notification 1 as read
    sendMessage.mockResolvedValueOnce({ success: true });
    const btn = notificationsList.querySelector('.notification-item[data-id="1"] .btn-mark-read');
    btn.click();

    // Wait for the async handler to complete
    await vi.waitFor(() => {
      expect(notificationsList.querySelector('.notification-item[data-id="1"]')).toBeNull();
    });

    // Count should now be 1
    expect(repoCountSpan.textContent).toBe('1');
    // Repo header should still be present
    expect(notificationsList.querySelector('.repo-group-header')).not.toBeNull();
  });

  it('removes repo header when last notification in repo is marked read', async () => {
    renderNotifications([makeNotif(1)]);

    sendMessage.mockResolvedValueOnce({ success: true });
    const btn = notificationsList.querySelector('.notification-item[data-id="1"] .btn-mark-read');
    btn.click();

    await vi.waitFor(() => {
      expect(notificationsList.querySelector('.repo-group-header')).toBeNull();
    });

    expect(notificationsList.querySelector('.notification-item')).toBeNull();
    expect(emptyState.hidden).toBe(false);
  });

  it('does not update repo-count on API failure', async () => {
    renderNotifications([makeNotif(1), makeNotif(2)]);

    const repoCountSpan = notificationsList.querySelector('.repo-count');
    expect(repoCountSpan.textContent).toBe('2');

    sendMessage.mockResolvedValueOnce({ success: false, error: 'API error' });
    const btn = notificationsList.querySelector('.notification-item[data-id="1"] .btn-mark-read');
    btn.click();

    // Give async handler time to run
    await new Promise((r) => setTimeout(r, 50));

    // Count should remain 2
    expect(repoCountSpan.textContent).toBe('2');
    // Notification should still be present
    expect(notificationsList.querySelector('.notification-item[data-id="1"]')).not.toBeNull();
  });
});
