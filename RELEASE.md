# Release Guide

## Steps to Release a New Version

1. Update CHANGELOG.md:
   - Add version entry: `## [X.Y.Z] - YYYY-MM-DD` with changes

2. Update version in `package.json`, `manifest.json`, and `manifest-firefox.json`:

   ```sh
   # Edit all three files to set "version": "X.Y.Z"
   ```

   Then run `npm install` to sync `package-lock.json`:

   ```sh
   npm install
   ```

3. Commit changes:

   ```sh
   git add CHANGELOG.md package.json package-lock.json manifest.json manifest-firefox.json
   git commit -m "chore: update version to vX.Y.Z"
   git push origin main
   ```

4. Run the release workflow:

   ```sh
   gh workflow run release.yml
   ```

   This will run tests, build Chrome & Firefox packages, and create a GitHub Release with the zip files.

5. Verify the release was created successfully:

   ```sh
   gh release view vX.Y.Z
   ```

6. Update the release notes on GitHub to match CHANGELOG.md:

   ```sh
   gh release edit vX.Y.Z --notes "## Improved
   - Change 1
   - Change 2

   **Full Changelog**: https://github.com/euxx/github-notifier-pro/compare/vPREV...vX.Y.Z"
   ```
