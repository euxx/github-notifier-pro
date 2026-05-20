# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.4.0] - 2026-05-20

### Added

- Cache author avatar bytes locally as base64 data URLs so the popup renders avatars with no network or flicker on browsers that bypass HTTP caching for cross-origin extension requests (e.g. Brave Shields)

### Fixed

- Adaptive poll interval signalled by GitHub's `X-Poll-Interval` header no longer dropped when a later storage write in the same fetch cycle fails

### Changed

- Bump minimum Chrome to 114 to use the 10 MB `chrome.storage.local` quota (Chrome 99–113 capped at 5 MB)

## [1.3.1] - 2026-05-15

### Fixed

- Filter rule count badges not recomputed after mark-as-read, mark-repo-as-read, mark-all-as-read, or desktop notification click
- Sync now uses GitHub gist `updated_at` as the authoritative timestamp, avoiding missed remote changes on devices with skewed clocks
- Sync no longer flags false conflicts when filter rule field order differs (`{keywords, repos}` vs `{repos, keywords}`) or when only the timestamp changed without rule edits
- Replace `createContextualFragment` and `innerHTML` with `DOMParser` to satisfy AMO security linter

## [1.3.0] - 2026-05-14

### Added

- Notification filter rules — hide notifications by repo and/or keyword
- Browse filtered notifications inline via "· N filtered" badge
- Sync filter rules across browsers via private GitHub Gist

## [1.2.1] - 2026-04-17

### Improved

- Refine popup hover and keyboard focus feedback across links, buttons, repository headers, and notification actions
- Merge the settings avatar and username into a single accessible profile link while keeping avatar and text hover feedback independent

## [1.2.0] - 2026-04-16

### Added

- Add "go to latest comment" button for notifications (prefetched and cached)
- Add priority dot for high-priority notification reasons
- Sum PR review comments into comment count

### Fixed

- Shrink settings panel to content height by removing forced flex fill

### Changed

- Remove hover cards feature, keep native title tooltips
- Update settings icon in assets

## [1.1.0] - 2026-04-14

### Added

- Split repo header links into separate actions for better usability
- Add main open target option for notifications

### Fixed

- Preserve focus after marking notifications as read

### Improved

- Unify focus states and fix hidden tab targets
- Refine action button visibility and avatar ring styles

## [1.0.7] - 2026-04-01

### Fixed

- Unify all popup links to open at end of tab strip, matching notification click behavior

## [1.0.6] - 2026-04-01

### Fixed

- Notification detail cache not refreshed when a notification is updated, showing stale state/author info
- Replace blocking `alert()` with inline hint text for notification permission feedback in settings
- Build script no longer wipes `dist/firefox-dev` directory

### Improved

- Switch linter and formatter from ESLint/Prettier to oxlint/oxfmt
- Extract shared utilities and constants for better code organization
- Remove dead code and tighten default values

## [1.0.5] - 2026-03-13

### Fixed

- Notification count in the repository header not decrementing when a single notification is marked as read
- Countdown timer display jumping on alarm reset (was showing remaining time from the previous alarm cycle)
- Device Flow OAuth polling could exceed `expires_in` timeout after repeated `slow_down` responses from GitHub
- Theme / popup width changes not applied when browser storage write fails

## [1.0.4] - 2026-03-10

### Fixed

- Replace all `innerHTML` assignments with safe DOM API construction (createElement, textContent, replaceChildren, createContextualFragment) to satisfy Firefox AMO linter requirements
- Add `getIconSVGElement()` utility using `createContextualFragment` for safe SVG injection without innerHTML
- Add `data_collection_permissions` to Firefox manifest as required by AMO

## [1.0.3] - 2026-03-10

### Fixed

- Race condition where a 60-second auto-refresh could restore notifications already dismissed via mark-as-read, mark-all-as-read, mark-repo-as-read, or desktop notification click
- In-progress detail fetches now abort if a user action invalidates their snapshot, preventing stale data from being written back to storage
- Badge "+" indicator now only updates when a fetch actually commits to storage

## [1.0.2] - 2026-03-04

### Improved

- Unified stagger animation for all mark-as-read flows
- Eliminated redundant GET_STATE round-trip after mark-repo-as-read

## [1.0.1] - 2026-03-03

### Fixed

- Mark-as-read animation reworked to use overlay approach, fixing dark band artifact in scroll containers
- Reduced right-side jump when adjusting popup width
- CSS variables standardized across device-flow and popup styles

### Improved

- DOM removal now deferred until API confirms success for all mark-as-read flows
- Stagger timeouts properly tracked and cancellable on rollback
- Notification cache cleared on mark-all-as-read to prevent stale data

## [1.0.0] - 2026-03-03

- 🔔 Real-time unread count badge and desktop notifications
- 📋 Issues, PRs, Releases, and all notification types with rich details
- ✅ Mark as read per notification, per repository, or all at once
- 🔐 OAuth Device Flow or Personal Access Token authentication
- ✨ Clean, minimal UI — feature-rich without the clutter
- 🎨 Light / Dark / System theme with adjustable popup width
