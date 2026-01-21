/**
 * Theme management utility
 * Handles theme application and system preference detection
 */

/**
 * Apply theme to document body
 * @param {string} theme - Theme name: 'light', 'dark', or 'system'
 */
export function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
  } else if (theme === 'light') {
    document.body.classList.remove('dark-theme');
  } else if (theme === 'system') {
    // Follow system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }
}

/**
 * Initialize theme from storage
 * @param {Function} getTheme - Storage function to get theme preference
 * @returns {Promise<void>}
 */
export async function initTheme(getTheme) {
  const theme = await getTheme();
  applyTheme(theme || 'system');
}
