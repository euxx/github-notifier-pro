import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyTheme, initTheme } from "../src/lib/theme.js";

describe("theme", () => {
  let mockClassList;
  let mockMatchMedia;

  beforeEach(() => {
    // Mock document.body.classList
    mockClassList = {
      add: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal("document", {
      body: {
        classList: mockClassList,
      },
    });

    // Mock window.matchMedia
    mockMatchMedia = vi.fn();
    vi.stubGlobal("window", {
      matchMedia: mockMatchMedia,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("applyTheme", () => {
    it("should add dark-theme class for dark theme", () => {
      applyTheme("dark");

      expect(mockClassList.add).toHaveBeenCalledWith("dark-theme");
      expect(mockClassList.remove).not.toHaveBeenCalled();
    });

    it("should remove dark-theme class for light theme", () => {
      applyTheme("light");

      expect(mockClassList.remove).toHaveBeenCalledWith("dark-theme");
      expect(mockClassList.add).not.toHaveBeenCalled();
    });

    it("should add dark-theme class for system theme when system prefers dark", () => {
      mockMatchMedia.mockReturnValue({ matches: true });

      applyTheme("system");

      expect(mockMatchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
      expect(mockClassList.add).toHaveBeenCalledWith("dark-theme");
    });

    it("should remove dark-theme class for system theme when system prefers light", () => {
      mockMatchMedia.mockReturnValue({ matches: false });

      applyTheme("system");

      expect(mockMatchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
      expect(mockClassList.remove).toHaveBeenCalledWith("dark-theme");
    });
  });

  describe("initTheme", () => {
    it("should apply theme from storage", async () => {
      const mockGetTheme = vi.fn().mockResolvedValue("dark");

      await initTheme(mockGetTheme);

      expect(mockGetTheme).toHaveBeenCalled();
      expect(mockClassList.add).toHaveBeenCalledWith("dark-theme");
    });

    it("should default to system theme if no theme in storage", async () => {
      const mockGetTheme = vi.fn().mockResolvedValue(null);
      mockMatchMedia.mockReturnValue({ matches: true });

      await initTheme(mockGetTheme);

      expect(mockGetTheme).toHaveBeenCalled();
      expect(mockMatchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
      expect(mockClassList.add).toHaveBeenCalledWith("dark-theme");
    });

    it("should apply light theme from storage", async () => {
      const mockGetTheme = vi.fn().mockResolvedValue("light");

      await initTheme(mockGetTheme);

      expect(mockGetTheme).toHaveBeenCalled();
      expect(mockClassList.remove).toHaveBeenCalledWith("dark-theme");
    });
  });
});
