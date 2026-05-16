import { describe, it, expect } from "vitest";
import { classifyError } from "../src/lib/http.js";

describe("classifyError", () => {
  it('should classify rate limit errors as "rate-limited"', () => {
    expect(classifyError(new Error("Rate limited until 12:00"))).toBe("rate-limited");
  });

  it('should classify timeout errors as "timeout"', () => {
    expect(classifyError(new Error("Request timeout after 30s"))).toBe("timeout");
  });

  it('should classify network errors as "offline"', () => {
    expect(classifyError(new Error("NetworkError when attempting to fetch"))).toBe("offline");
    expect(classifyError(new Error("Failed to fetch"))).toBe("offline");
  });

  it('should classify other errors as "unknown"', () => {
    expect(classifyError(new Error("Something went wrong"))).toBe("unknown");
  });

  it("should handle null/undefined errors", () => {
    expect(classifyError(null)).toBe("unknown");
    expect(classifyError(undefined)).toBe("unknown");
    expect(classifyError({})).toBe("unknown");
  });
});
