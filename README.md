# GitHub Notifier Pro

A browser extension that brings GitHub notifications to your browser toolbar.

![Chrome](https://img.shields.io/badge/Chrome-MV3-green) ![Firefox](https://img.shields.io/badge/Firefox-supported-orange)

## Screenshot

<!-- Add your screenshot here -->

![Popup Screenshot](images/screenshot.png)

## Features

- **Real-time notifications** - Badge shows unread count, auto-refreshes in background
- **Adaptive polling** - Automatically adjusts refresh interval (60s-10min) based on GitHub's X-Poll-Interval header
- **Smart caching** - Uses HTTP 304 responses to minimize API calls and bandwidth
- **Rate limit protection** - Tracks GitHub API limits with visual indicators and automatic retry
- **Desktop alerts** - Optional native notifications for new items
- **Quick actions** - Open, mark as read, or mark all as read
- **Rich details** - Shows PR state, issue status, author avatars
- **Secure auth** - OAuth Device Flow (no secret needed) or PAT

## Permissions

This extension requires:

| Permission       | Purpose                          |
| ---------------- | -------------------------------- |
| `notifications`  | Show desktop notifications       |
| `storage`        | Store auth token and preferences |
| `alarms`         | Background polling               |
| `identity`       | OAuth authentication flow        |
| `api.github.com` | Fetch notifications              |
| `github.com`     | OAuth authentication             |

**OAuth Scopes**: `repo`, `notifications`

## Installation

### From Source

1. Clone the repository
2. Configure OAuth:
   ```bash
   cp src/config/config.example.js src/config/config.js
   # Edit config.js with your GitHub OAuth App Client ID
   ```
3. Load in browser:
   - **Chrome**: `chrome://extensions` → Enable Developer mode → Load unpacked → Select project folder
   - **Firefox**: Run `npm run dev:firefox`, then `about:debugging` → Load Temporary Add-on → Select `dist/firefox-dev/manifest.json`

### Build for Distribution

```bash
npm run build
# Outputs: dist/github-notifier-pro-chrome.zip and dist/github-notifier-pro-firefox.zip
```

## Usage

### Authentication

1. **OAuth (recommended)** - Click "Sign in with GitHub", enter the code on GitHub
2. **Personal Access Token** - Generate a token with `repo` and `notifications` scopes at [GitHub Settings](https://github.com/settings/tokens)


## Development

See [development.md](development.md) for build instructions and contribution guidelines.

## License

MIT
