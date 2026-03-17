# Development

## Installation from Source

1. Clone the repository
2. Install dependencies and set up git hooks:
   ```bash
   npm install
   npm run prepare
   ```
3. Configure OAuth:
   ```bash
   cp src/config/config.example.js src/config/config.js
   # Edit config.js with your GitHub OAuth App Client ID
   ```
4. Load in browser:
   - **Chrome**: `chrome://extensions` → Enable Developer mode → Load unpacked → Select project folder
   - **Firefox**: Run `npm run dev:firefox`, then `about:debugging` → Load Temporary Add-on → Select `dist/firefox-dev/manifest.json`

## Scripts

| Command                | Description                                 |
| ---------------------- | ------------------------------------------- |
| `npm run ci`           | Run all checks (test + lint + format check) |
| `npm run dev`          | Run CI then prepare Firefox dev environment |
| `npm run all`          | Run CI then build Chrome & Firefox packages |
| `npm test`             | Run tests (Vitest)                          |
| `npm run prepare`      | Setup Husky git hooks                       |
| `npm run lint`         | Lint code                                   |
| `npm run lint:fix`     | Lint and auto-fix                           |
| `npm run format`       | Format code with Prettier                   |
| `npm run format:check` | Check code formatting                       |
| `npm run build`        | Build Chrome and Firefox packages           |
| `npm run dev:firefox`  | Create Firefox dev environment              |

## Project Structure

```
src/
├── auth/           # Device Flow OAuth UI
├── background/     # Service worker
├── config/         # GitHub OAuth configuration
├── lib/            # Shared utilities
├── popup/          # Extension popup UI
└── styles/         # CSS variables and styles
tests/              # Unit tests (Vitest)
```

## Building

### Chrome

```bash
npm run build
# Output: dist/github-notifier-pro-chrome.zip
```

### Firefox Development

```bash
npm run dev:firefox
# Load from: dist/firefox-dev/manifest.json
```

## Testing

```bash
npm test     # Run all tests
npm run ci   # Run tests + lint + format in one step
```
