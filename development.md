# Development

## Setup

```bash
npm install
npm run prepare
```

## Scripts

| Command                | Description                                   |
| ---------------------- | --------------------------------------------- |
| `npm run ci`           | Run all checks (test + lint:fix + format)     |
| `npm run dev`          | Run CI then prepare Firefox dev environment   |
| `npm run all`          | Run CI then build Chrome & Firefox packages   |
| `npm test`             | Run tests (Vitest)                            |
| `npm run prepare`      | Setup Husky git hooks                         |
| `npm run lint`         | Lint code                                     |
| `npm run lint:fix`     | Lint and auto-fix                             |
| `npm run format`       | Format code with Prettier                     |
| `npm run format:check` | Check code formatting                         |
| `npm run build`        | Build Chrome and Firefox packages             |
| `npm run dev:firefox`  | Create Firefox dev environment                |

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
