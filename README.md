# GitHub Notifier Pro

A Chrome extension for GitHub notifications with offline support and smart rate limiting.

## Features

- Real-time notifications with auto-refresh
- **Desktop notifications** - Get notified instantly with system notifications
  - Click to open notification directly
  - Auto-dismiss after a few seconds
- Dark/Light/System theme support
- **Two authentication methods:**
  - **Device Flow OAuth** (recommended) - Secure, no secrets needed
  - **Personal Access Token** - Quick setup
- Offline support with cached data
- Smart rate limiting and timeout handling
- Clean, modern UI

## Installation

1. Clone this repository
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" → Select project directory

## Authentication Setup

### Method 1: OAuth (Recommended) 🔐

**More secure** - Uses GitHub's Device Flow, no client secrets required!

1. [Create a GitHub OAuth App](https://github.com/settings/applications/new)
   - Application name: `GitHub Notifier Pro`
   - Homepage URL: `https://github.com/YOUR_USERNAME/github-notifier-pro`
   - Authorization callback URL: `http://127.0.0.1` (required but not used for Device Flow)
2. Copy `src/config/config.example.js` to `src/config/config.js`
3. Fill in your CLIENT_ID
4. Click the extension icon → "Sign in with GitHub"
5. Follow the on-screen instructions (visit link + enter code)

### Method 2: Personal Access Token 🔑

**Quickest** - But requires manual token management

1. [Generate GitHub PAT](https://github.com/settings/tokens/new?scopes=repo,notifications) with `repo` and `notifications` scopes
2. Click the extension icon → "Use PAT"
3. Paste your token

**Troubleshooting**: "?" = not logged in, "⏱" = rate limited (auto-recovers)

## Project Structure

```
├── manifest.json
├── src/
│   ├── background/service-worker.js  # Background tasks
│   ├── auth/
│   │   ├── device-flow.html         # Device Flow authorization page
│   │   └── device-flow.js           # Device Flow logic
│   ├── popup/                        # UI + settings
│   ├── lib/                          # Core libraries
│   │   ├── github-api.js            # GitHub API + Device Flow
│   │   ├── storage.js               # Data persistence
│   │   ├── theme.js                 # Theme management utility
│   │   ├── chrome-api.js            # Chrome API wrappers
│   │   └── constants.js
│   ├── config/config.js             # OAuth configuration
│   └── styles/
│       ├── variables.css            # Theme variables
│       ├── device-flow.css          # Device Flow UI styles
│       └── popup.css                # Popup UI styles
└── images/
```

## Development

Built with vanilla JS and Chrome Manifest V3.

**Technologies:**
- Chrome Extensions API (Manifest V3)
- GitHub REST API
- GitHub Device Flow OAuth 2.0
- ES6 Modules

**Key Features:**
- Secure authentication without client secrets
- Optimized notification fetching with caching
- Real-time badge updates
- Offline-first architecture

## License

MIT
