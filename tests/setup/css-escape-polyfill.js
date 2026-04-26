/**
 * Shared CSS.escape polyfill for jsdom-based tests.
 *
 * jsdom 28+ doesn't expose `window.CSS`. The notification renderer relies on
 * CSS.escape() when building selectors for marking notifications as read.
 *
 * Loaded automatically by every test via `setupFiles` in vitest.config.js,
 * so individual test files don't need to repeat this block.
 */

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
        // Control chars and first-char digit require hex escaping per CSS spec
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
