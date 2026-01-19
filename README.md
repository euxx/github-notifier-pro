# GitHub Notifier Pro

A Chrome extension for GitHub notifications with offline support and smart rate limiting.

## Features

- Real-time notifications with auto-refresh
- Dark/Light/System theme support
- Personal Access Token authentication
- Offline support with cached data
- Smart rate limiting and timeout handling
- Clean, modern UI

## Installation

1. Clone this repository
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" → Select project directory

## Setup

1. [Generate GitHub PAT](https://github.com/settings/tokens/new?scopes=repo,notifications) with `repo` and `notifications` scopes
2. Click the extension icon and paste your token

**Troubleshooting**: "?" = not logged in, "⏱" = rate limited (auto-recovers)

## Project Structure

```
├── manifest.json
├── src/
│   ├── background/service-worker.js
│   ├── popup/                 # UI + settings
│   ├── lib/                   # Core libraries
│   ├── config/config.js
│   └── styles/variables.css
└── images/
```

## Development

Built with vanilla JS and Chrome Manifest V3.

- Chrome Extensions API (Manifest V3)
- GitHub REST API
- ES6 Modules

## License

MIT
