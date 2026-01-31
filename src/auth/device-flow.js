/**
 * Device Flow authorization page script
 */

import * as storage from '../lib/storage.js';
import github from '../lib/github-api.js';
import { initTheme } from '../lib/theme.js';
import { runtime } from '../lib/chrome-api.js';
import { ANIMATION_DURATION } from '../lib/constants.js';

const deviceCodeEl = document.getElementById('device-code');
const copyBtn = document.getElementById('copy-btn');
const openGithubBtn = document.getElementById('open-github-btn');
const statusEl = document.getElementById('status');
const statusTextEl = document.getElementById('status-text');
const countdownEl = document.getElementById('countdown');

let verificationUri = '';
const cancelled = false;

// Initialize theme
initTheme(storage.getTheme);

// Start Device Flow on page load
startDeviceFlow();

async function startDeviceFlow() {
  try {
    await github.loginWithDeviceFlow({
      onDeviceCode: (data) => {
        verificationUri = data.verification_uri;
        deviceCodeEl.textContent = data.user_code;

        // Enable buttons
        copyBtn.disabled = false;
        openGithubBtn.disabled = false;

        // Auto-copy device code to clipboard
        navigator.clipboard
          .writeText(data.user_code)
          .then(() => {
            copyBtn.textContent = '✓ Copied!';

            // Wait before opening GitHub (let user see the "Copied!" message)
            setTimeout(() => {
              window.open(verificationUri, '_blank');
            }, ANIMATION_DURATION.GITHUB_OPEN_DELAY);

            setTimeout(() => {
              copyBtn.textContent = 'Copy Code';
            }, ANIMATION_DURATION.COPY_FEEDBACK);
          })
          .catch((err) => {
            console.error('Failed to auto-copy code:', err);
            // Still open GitHub even if copy fails
            window.open(verificationUri, '_blank');
          });

        // Start countdown
        let remaining = data.expires_in;
        const interval = setInterval(() => {
          if (cancelled || remaining <= 0) {
            clearInterval(interval);
            return;
          }

          remaining--;
          const minutes = Math.floor(remaining / 60);
          const seconds = remaining % 60;
          countdownEl.textContent = `Expires in ${minutes}:${seconds.toString().padStart(2, '0')}`;
        }, ANIMATION_DURATION.COUNTDOWN_INTERVAL);
      },
      onProgress: (progress) => {
        const minutes = Math.floor(progress.remainingTime / 60);
        statusTextEl.textContent = `Waiting for authorization... (~${minutes} min remaining)`;
      },
      onCancel: () => cancelled,
    });

    // Success!
    const token = github.token;
    const username = github.username;

    // Save to storage
    await storage.setToken(token);
    await storage.setUsername(username);
    await storage.setAuthMethod('oauth');

    // Notify user
    statusEl.className = 'status success';
    statusTextEl.textContent = `✅ Successfully authorized as ${username}!`;
    countdownEl.textContent = 'Closing in 2 seconds...';

    // Close window and redirect to popup
    setTimeout(() => {
      window.close();
      // If window.close() doesn't work (some browsers block it), redirect
      if (!window.closed) {
        window.location.href = runtime.getURL('src/popup/popup.html');
      }
    }, ANIMATION_DURATION.AUTO_CLOSE);
  } catch (error) {
    console.error('Device Flow error:', error);
    statusEl.className = 'status error';
    statusTextEl.textContent = `❌ Error: ${error.message}`;
    countdownEl.textContent = '';
  }
}

// Copy device code
copyBtn.addEventListener('click', async () => {
  const code = deviceCodeEl.textContent;
  try {
    await navigator.clipboard.writeText(code);
    copyBtn.textContent = '✓ Copied!';
    setTimeout(() => {
      copyBtn.textContent = 'Copy Code';
    }, ANIMATION_DURATION.AUTO_CLOSE);
  } catch (err) {
    console.error('Failed to copy:', err);
  }
});

// Open GitHub
openGithubBtn.addEventListener('click', () => {
  window.open(verificationUri, '_blank');
});
