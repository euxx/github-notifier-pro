# Project Conventions

## After Making Changes

After modifying code, ensure to run the following commands to maintain code quality:

- `npm run ci` - Run all checks (test + lint:fix + format)
- `npm run dev` - Prepare Firefox dev environment (ci + dev:firefox)
- `npm run all` - Full build for release (ci + build Chrome & Firefox)

Or run individually:

- `npm test` - Run tests (Vitest)
- `npm run lint` - Lint code
- `npm run format` - Format code with Prettier

Refer to [DEVELOPMENT.md](DEVELOPMENT.md) for more details on available scripts and project setup.
