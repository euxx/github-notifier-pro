/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../src/lib/avatar-cache.js", () => ({
  getAvatarSrc: vi.fn((person) => person?.avatar_url ?? null),
  ensureAvatarsCached: vi.fn(),
}));

const sendMessage = vi.fn();
const onMarkRepoAsRead = vi.fn();

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
  };
}

describe("notification repo header links", () => {
  let notificationsList;
  let emptyState;
  let markAllBtn;

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

    initRenderer({
      notificationsList,
      emptyState,
      markAllBtn,
      sendMessage,
      onUserAction: vi.fn(),
      onMarkRepoAsRead,
    });
  });

  it("renders separate homepage and notifications links for each repo header", () => {
    renderNotifications([makeNotif(1)]);

    const repoHeader = notificationsList.querySelector(".repo-group-header");
    const repoHomeLink = repoHeader.querySelector(".repo-home-link");
    const repoNotificationsLink = repoHeader.querySelector(".repo-notifications-link");

    expect(repoHeader.tagName).toBe("DIV");
    expect(repoHomeLink.getAttribute("href")).toBe("https://github.com/owner/repo");
    expect(repoNotificationsLink.getAttribute("href")).toBe(
      "https://github.com/notifications?query=repo%3Aowner%2Frepo",
    );
    expect(repoNotificationsLink.textContent).toBe("owner/repo");
  });

  it("keeps mark repo as read independent from repo links", () => {
    renderNotifications([makeNotif(1)]);

    const markReadBtn = notificationsList.querySelector(".repo-mark-read-btn");
    markReadBtn.click();

    expect(onMarkRepoAsRead).toHaveBeenCalledWith("owner/repo");
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
