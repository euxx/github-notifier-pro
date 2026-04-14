/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";

beforeAll(() => {
  if (typeof CSS === "undefined" || !CSS.escape) {
    // @ts-ignore
    globalThis.CSS = {
      escape(value) {
        const str = String(value);
        const length = str.length;
        let result = "";
        for (let i = 0; i < length; i++) {
          const code = str.charCodeAt(i);
          if (code === 0x0000) {
            result += "\uFFFD";
            continue;
          }
          if (
            (code >= 0x0001 && code <= 0x001f) ||
            code === 0x007f ||
            (i === 0 && code >= 0x0030 && code <= 0x0039) ||
            (i === 1 && code >= 0x0030 && code <= 0x0039 && str.charCodeAt(0) === 0x002d)
          ) {
            result += `\\${code.toString(16)} `;
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

vi.mock("../src/lib/constants.js", () => ({
  GITHUB_SITE_BASE: "https://github.com",
  ANIMATION_DURATION: { FADE_OUT: 0, ERROR_BACKGROUND_FADE: 0 },
  NOTIFICATION_TYPES: { RELEASE: "Release" },
  MESSAGE_TYPES: {
    MARK_AS_READ: "markAsRead",
    OPEN_NOTIFICATION: "openNotification",
  },
  TIME_CONVERSION: { MS_PER_MINUTE: 60000 },
}));

vi.mock("../src/lib/format-utils.js", () => ({
  formatReason: vi.fn((reason) => reason),
  getNotificationStatus: vi.fn(() => "Status"),
  getReasonPriority: vi.fn(() => null),
}));

vi.mock("../src/lib/icons.js", () => ({
  getIconSVGElement: vi.fn(() => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    return svg;
  }),
}));

const sendMessage = vi.fn();

const { initRenderer, renderNotifications, clearNotificationCache } =
  await import("../src/popup/notification-renderer.js");

function makeNotif(id) {
  return {
    id: String(id),
    title: `Notification ${id}`,
    reason: "mention",
    updated_at: new Date().toISOString(),
    icon: "issue",
    type: "Issue",
    url: "https://github.com/owner/repo/issues/1",
    repository: {
      full_name: "owner/repo",
      html_url: "https://github.com/owner/repo",
    },
    author: {
      login: "octocat",
      avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    },
  };
}

describe("notification main open target", () => {
  let notificationsList;
  let emptyState;
  let markAllBtn;
  let closeSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    clearNotificationCache();

    document.body.innerHTML = `
      <ul id="notifications-list"></ul>
      <div id="empty-state" hidden></div>
      <button id="mark-all-btn"></button>
    `;

    notificationsList = document.getElementById("notifications-list");
    emptyState = document.getElementById("empty-state");
    markAllBtn = document.getElementById("mark-all-btn");
    closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});

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

  afterEach(() => {
    closeSpy.mockRestore();
  });

  it("renders an explicit main open target inside notification-main", () => {
    renderNotifications([makeNotif(1)]);

    const openTarget = notificationsList.querySelector(
      '.notification-item[data-id="1"] .notification-main .notification-open-target',
    );

    expect(openTarget).not.toBeNull();
    expect(openTarget.tagName).toBe("BUTTON");
  });

  it("opens the notification from the main target", async () => {
    renderNotifications([makeNotif(1)]);
    sendMessage.mockResolvedValueOnce({ success: true });

    const openTarget = notificationsList.querySelector(
      '.notification-item[data-id="1"] .notification-open-target',
    );
    openTarget.click();

    expect(sendMessage).toHaveBeenCalledWith("openNotification", { notificationId: "1" });
    await vi.waitFor(() => {
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  it("keeps row click behavior unchanged outside the explicit open target", async () => {
    renderNotifications([makeNotif(1)]);
    sendMessage.mockResolvedValueOnce({ success: true });

    const item = notificationsList.querySelector('.notification-item[data-id="1"]');
    item.click();

    expect(sendMessage).toHaveBeenCalledWith("openNotification", { notificationId: "1" });
    await vi.waitFor(() => {
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  it("keeps the avatar link and mark-as-read button independent from notification open", () => {
    renderNotifications([makeNotif(1)]);

    const avatarLink = notificationsList.querySelector(
      '.notification-item[data-id="1"] .author-profile-link',
    );
    avatarLink.click();
    expect(sendMessage).not.toHaveBeenCalledWith("openNotification", { notificationId: "1" });

    const markReadBtn = notificationsList.querySelector(
      '.notification-item[data-id="1"] .btn-mark-read',
    );
    markReadBtn.click();

    expect(sendMessage).toHaveBeenCalledWith("markAsRead", { notificationId: "1" });
    expect(sendMessage).not.toHaveBeenCalledWith("openNotification", { notificationId: "1" });
  });
});
