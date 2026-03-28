/**
 * @vitest-environment jsdom
 *
 * Tests for device-flow.js — OAuth Device Flow UI interactions.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// -- Mocks -------------------------------------------------------------------

vi.mock("../src/lib/github-api.js", () => ({
  default: {
    loginWithDeviceFlow: vi.fn(),
    token: null,
    username: null,
  },
}));

vi.mock("../src/lib/storage.js", () => ({
  getTheme: vi.fn().mockResolvedValue("system"),
  setToken: vi.fn().mockResolvedValue(undefined),
  setUsername: vi.fn().mockResolvedValue(undefined),
  setAuthMethod: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/lib/theme.js", () => ({
  initTheme: vi.fn(),
  applyTheme: vi.fn(),
}));

vi.mock("../src/lib/chrome-api.js", () => ({
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    getURL: vi.fn((path) => `chrome-extension://test-id/${path}`),
  },
}));

vi.mock("../src/lib/constants.js", () => ({
  ANIMATION_DURATION: {
    GITHUB_OPEN_DELAY: 0,
    COPY_FEEDBACK: 0,
    COUNTDOWN_INTERVAL: 60_000,
    // Use a large value so the close setTimeout never fires during tests
    AUTO_CLOSE: 60_000,
  },
  MESSAGE_TYPES: {
    LOGIN: "login",
  },
}));

// -- Browser API stubs -------------------------------------------------------

beforeAll(() => {
  // jsdom doesn't implement the Clipboard API
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
    writable: true,
  });
  // Suppress window.open navigation
  vi.spyOn(window, "open").mockImplementation(() => null);
});

// -- Helpers -----------------------------------------------------------------

function setupDOM() {
  document.body.innerHTML = `
    <div id="device-code"></div>
    <button id="copy-btn" disabled></button>
    <button id="open-github-btn" disabled></button>
    <div id="status" class="status pending"></div>
    <div id="status-text"></div>
    <div id="countdown"></div>
  `;
}

// -- Tests -------------------------------------------------------------------

describe("device-flow", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupDOM();
  });

  it("displays device code and enables buttons when device code arrives", async () => {
    const { default: github } = await import("../src/lib/github-api.js");
    github.loginWithDeviceFlow.mockImplementation(async ({ onDeviceCode }) => {
      onDeviceCode({
        verification_uri: "https://github.com/login/device",
        user_code: "ABCD-1234",
        expires_in: 900,
      });
      // Hold indefinitely — we only want to test the onDeviceCode callback effects
      await new Promise(() => {});
    });

    await import("../src/auth/device-flow.js");

    // onDeviceCode runs synchronously inside the mock (before its internal await)
    expect(document.getElementById("device-code").textContent).toBe("ABCD-1234");
    expect(document.getElementById("copy-btn").disabled).toBe(false);
    expect(document.getElementById("open-github-btn").disabled).toBe(false);
  });

  it("shows success status after authorization completes", async () => {
    const { default: github } = await import("../src/lib/github-api.js");
    github.loginWithDeviceFlow.mockImplementation(async ({ onDeviceCode }) => {
      onDeviceCode({
        verification_uri: "https://github.com/login/device",
        user_code: "ABCD-1234",
        expires_in: 900,
      });
      return true;
    });
    github.token = "gho_test_token";
    github.username = "testuser";

    await import("../src/auth/device-flow.js");

    const statusEl = document.getElementById("status");
    await vi.waitFor(() => expect(statusEl.className).toContain("success"));

    expect(document.getElementById("status-text").textContent).toContain("testuser");
  });

  it("falls back to direct storage when background worker message fails", async () => {
    const { default: github } = await import("../src/lib/github-api.js");
    const { runtime } = await import("../src/lib/chrome-api.js");
    const storage = await import("../src/lib/storage.js");

    github.loginWithDeviceFlow.mockResolvedValue(true);
    github.token = "gho_test_token";
    github.username = "testuser";
    runtime.sendMessage.mockRejectedValue(new Error("message channel closed"));

    await import("../src/auth/device-flow.js");

    await vi.waitFor(() => expect(storage.setToken).toHaveBeenCalledWith("gho_test_token"));
    expect(storage.setUsername).toHaveBeenCalledWith("testuser");
    expect(storage.setAuthMethod).toHaveBeenCalledWith("oauth");
  });

  it("shows error status when authorization fails", async () => {
    const { default: github } = await import("../src/lib/github-api.js");
    github.loginWithDeviceFlow.mockRejectedValue(new Error("access_denied"));

    await import("../src/auth/device-flow.js");

    const statusEl = document.getElementById("status");
    await vi.waitFor(() => expect(statusEl.className).toContain("error"));

    expect(document.getElementById("status-text").textContent).toContain("access_denied");
  });
});
