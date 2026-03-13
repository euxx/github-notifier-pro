# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
