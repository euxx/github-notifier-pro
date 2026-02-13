import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Filter out expected error logs from test output
    onConsoleLog(log, type) {
      // List of expected error patterns that are intentionally tested
      const expectedErrors = [
        'Message handling error',
        'Failed to mark as read',
        'Failed to mark repo as read',
        'Failed to create desktop notification',
        'Failed to clear notification',
        'Failed to fetch details for notification',
      ];

      // Hide expected error logs
      if (type === 'stderr') {
        return !expectedErrors.some((pattern) => log.includes(pattern));
      }

      return true;
    },
  },
});
