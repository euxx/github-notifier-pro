/**
 * @vitest-environment jsdom
 *
 * Tests for filter rule editing context in popup.js.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("../src/lib/chrome-api.js", () => ({
  alarms: { getAll: vi.fn().mockResolvedValue([]) },
  storage: {
    local: { get: vi.fn().mockResolvedValue({}), set: vi.fn(), remove: vi.fn() },
    onChanged: { addListener: vi.fn() },
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
    onMessage: { addListener: vi.fn() },
  },
  tabs: { create: vi.fn() },
}));

vi.mock("../src/lib/storage.js", () => ({
  getToken: vi.fn().mockResolvedValue(null),
  getTheme: vi.fn().mockResolvedValue("system"),
  setTheme: vi.fn().mockResolvedValue(undefined),
  getUsername: vi.fn().mockResolvedValue(null),
  getUserInfo: vi.fn().mockResolvedValue(null),
  getNotifications: vi.fn().mockResolvedValue([]),
  getAuthMethod: vi.fn().mockResolvedValue(null),
  getPopupWidth: vi.fn().mockResolvedValue(600),
  setPopupWidth: vi.fn().mockResolvedValue(undefined),
  getEnableDesktopNotifications: vi.fn().mockResolvedValue(false),
  setEnableDesktopNotifications: vi.fn().mockResolvedValue(undefined),
  getNotificationFilterStats: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/lib/theme.js", () => ({
  applyTheme: vi.fn(),
}));

vi.mock("../src/popup/notification-renderer.js", () => ({
  initRenderer: vi.fn(),
  renderNotifications: vi.fn(),
  getCachedNotifications: vi.fn().mockReturnValue(null),
  clearNotificationCache: vi.fn(),
}));

const RULES = [
  { repos: ["owner/alpha"], keywords: ["bug"] },
  { repos: ["owner/beta"], keywords: ["release"] },
];

function setupDOM() {
  document.body.innerHTML = `
    <div class="header">
      <button id="settings-icon-btn"></button>
      <button id="filter-icon-btn"></button>
    </div>
    <div id="login-view" hidden></div>
    <div id="main-view" hidden></div>
    <div id="settings-view" hidden></div>
    <div id="filter-view" hidden>
      <div class="settings-header">
        <button id="filter-back-btn"></button>
        <button id="filter-add-rule-btn" hidden></button>
        <button id="filter-creator-toggle">+ New Rule</button>
      </div>
      <div class="filter-content">
        <p id="filter-error" hidden></p>
        <div id="filter-creator" hidden>
          <div class="filter-creator-header">
            <span id="filter-creator-label">New Rule</span>
          </div>
          <input id="filter-new-repo-input" />
          <button id="filter-new-repo-add"></button>
          <div id="filter-new-repo-chips"></div>
          <input id="filter-new-kw-input" />
          <button id="filter-new-kw-add"></button>
          <div id="filter-new-kw-chips"></div>
        </div>
        <div id="filter-rules-list"></div>
      </div>
    </div>
    <div id="auth-methods"></div>
    <button id="oauth-method"></button>
    <button id="pat-method"></button>
    <div id="pat-input-form" hidden></div>
    <input id="pat-input" />
    <button id="pat-cancel-btn"></button>
    <button id="pat-login-btn"></button>
    <div id="login-error" hidden></div>
    <button id="settings-back-btn"></button>
    <input id="popup-width-input" type="number" value="600" />
    <button id="width-decrease"></button>
    <button id="width-increase"></button>
    <input id="desktop-notifications-toggle" type="checkbox" />
    <div id="desktop-notifications-hint" hidden></div>
    <button id="settings-logout-btn"></button>
    <button id="refresh-btn"></button>
    <button id="mark-all-btn"></button>
    <span id="refresh-countdown"></span>
    <div id="username"></div>
    <img id="user-avatar" hidden />
    <a id="user-profile-link"></a>
    <ul id="notifications-list"></ul>
    <div id="empty-state" hidden></div>
    <div id="notifications-container"></div>
    <span id="settings-username"></span>
    <img id="settings-avatar" />
    <a id="settings-profile-link"></a>
    <span id="settings-auth-method"></span>
    <div class="footer"></div>
  `;
  document.body.style.minHeight = "300px";
  document.body.style.maxHeight = "600px";
}

async function flushTasks() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadPopup() {
  const { runtime } = await import("../src/lib/chrome-api.js");
  const storage = await import("../src/lib/storage.js");

  runtime.sendMessage.mockImplementation(({ action }) => {
    if (action === "getState") {
      return Promise.resolve({ isAuthenticated: false });
    }
    if (action === "getNotificationFilter") {
      return Promise.resolve({ filter: RULES });
    }
    if (action === "setNotificationFilter") {
      return Promise.resolve({ success: true });
    }
    return Promise.resolve({});
  });
  storage.getNotificationFilterStats.mockResolvedValue([]);

  await import("../src/popup/popup.js");
  await flushTasks();
}

beforeAll(() => {
  window.matchMedia = vi.fn().mockReturnValue({ addEventListener: vi.fn() });
  globalThis.requestAnimationFrame = vi.fn((callback) => callback());
});

describe("popup filter rules", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    globalThis.requestAnimationFrame = vi.fn((callback) => callback());
    setupDOM();
  });

  it("shows which saved rule is currently being edited", async () => {
    await loadPopup();

    document.getElementById("filter-icon-btn").click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll("#filter-rules-list .filter-rule-row")).toHaveLength(2);
    });

    const rowsBeforeEdit = document.querySelectorAll("#filter-rules-list .filter-rule-row");
    rowsBeforeEdit[1].querySelector(".filter-rule-edit-btn").click();

    await vi.waitFor(() => {
      expect(document.getElementById("filter-creator-label").textContent).toBe("Edit Rule");
    });

    const rowsAfterEdit = document.querySelectorAll("#filter-rules-list .filter-rule-row");
    const editingButton = rowsAfterEdit[1].querySelector(".filter-rule-edit-btn");
    const removeButton = rowsAfterEdit[1].querySelector(".filter-rule-remove-btn");
    expect(rowsAfterEdit[1].classList.contains("is-editing")).toBe(true);
    expect(editingButton.getAttribute("aria-label")).toBe("Editing current rule");
    expect(editingButton.querySelector("svg")).not.toBeNull();
    expect(editingButton.disabled).toBe(true);
    expect(removeButton.getAttribute("aria-label")).toBe("Remove rule");
    expect(removeButton.querySelector("svg")).not.toBeNull();
  });

  it("clears the editing marker after canceling the form", async () => {
    await loadPopup();

    document.getElementById("filter-icon-btn").click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll("#filter-rules-list .filter-rule-row")).toHaveLength(2);
    });

    document
      .querySelectorAll("#filter-rules-list .filter-rule-row")[1]
      .querySelector(".filter-rule-edit-btn")
      .click();
    await vi.waitFor(() => {
      expect(document.getElementById("filter-creator-label").textContent).toBe("Edit Rule");
    });

    document.getElementById("filter-creator-toggle").click();
    await flushTasks();

    const rowsAfterCancel = document.querySelectorAll("#filter-rules-list .filter-rule-row");
    expect(document.getElementById("filter-creator").hidden).toBe(true);
    expect(document.getElementById("filter-add-rule-btn").hidden).toBe(true);
    expect(Array.from(rowsAfterCancel).every((row) => !row.classList.contains("is-editing"))).toBe(
      true,
    );
    expect(
      Array.from(rowsAfterCancel).every(
        (row) =>
          row.querySelector(".filter-rule-edit-btn").getAttribute("aria-label") === "Edit rule",
      ),
    ).toBe(true);
  });

  it("focuses the repo input when opening a new rule form", async () => {
    await loadPopup();

    document.getElementById("filter-icon-btn").click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll("#filter-rules-list .filter-rule-row")).toHaveLength(2);
    });

    document.getElementById("filter-creator-toggle").click();

    expect(document.getElementById("filter-creator").hidden).toBe(false);
    expect(document.activeElement).toBe(document.getElementById("filter-new-repo-input"));
  });

  it("scrolls the creator form into view when editing a rule", async () => {
    await loadPopup();

    document.getElementById("filter-icon-btn").click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll("#filter-rules-list .filter-rule-row")).toHaveLength(2);
    });

    const filterContent = document.querySelector(".filter-content");
    filterContent.scrollTo = vi.fn();

    document
      .querySelectorAll("#filter-rules-list .filter-rule-row")[1]
      .querySelector(".filter-rule-edit-btn")
      .click();

    expect(filterContent.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("skips scrolling when the creator is canceled before the animation frame runs", async () => {
    await loadPopup();

    document.getElementById("filter-icon-btn").click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll("#filter-rules-list .filter-rule-row")).toHaveLength(2);
    });

    const filterContent = document.querySelector(".filter-content");
    filterContent.scrollTo = vi.fn();

    let rafCallback;
    globalThis.requestAnimationFrame = vi.fn((callback) => {
      rafCallback = callback;
    });

    document
      .querySelectorAll("#filter-rules-list .filter-rule-row")[1]
      .querySelector(".filter-rule-edit-btn")
      .click();
    document.getElementById("filter-creator-toggle").click();

    expect(document.getElementById("filter-creator").hidden).toBe(true);
    rafCallback();

    expect(filterContent.scrollTo).not.toHaveBeenCalled();
  });

  it("sizes the filter overlay from content height instead of always using the max height", async () => {
    const filterHeader = document.querySelector("#filter-view .settings-header");
    const filterContent = document.querySelector(".filter-content");

    Object.defineProperty(filterHeader, "offsetHeight", {
      configurable: true,
      get: () => 48,
    });
    Object.defineProperty(filterContent, "scrollHeight", {
      configurable: true,
      get: () => 372,
    });

    await loadPopup();

    const mainView = document.getElementById("main-view");
    document.getElementById("filter-icon-btn").click();

    await vi.waitFor(() => {
      expect(mainView.style.getPropertyValue("--filter-overlay-height")).toBe("420px");
    });
  });

  it("keeps filter layout state scoped to the filters page", async () => {
    await loadPopup();

    const mainView = document.getElementById("main-view");
    document.getElementById("filter-icon-btn").click();

    await vi.waitFor(() => {
      expect(mainView.classList.contains("filter-active")).toBe(true);
      expect(mainView.style.getPropertyValue("--filter-overlay-height")).toBe("300px");
    });

    document.getElementById("filter-back-btn").click();
    await flushTasks();

    expect(mainView.classList.contains("filter-active")).toBe(false);
    expect(mainView.style.getPropertyValue("--filter-overlay-height")).toBe("");
  });
});
