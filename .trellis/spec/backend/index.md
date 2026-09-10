# Backend / SDK Guidelines

Current scope: Node ESM integration checks and a Pi 0.85.1 workflow extension. A Mac Electron desktop preview now reuses this runtime; there is no hosted application server or database.

These are this new repository's initial conventions, not audited company-wide engineering standards.

## Pre-Development Checklist

Read README.md, docs/pi-research.md, and the current task's prd.md.

- [Directory structure](directory-structure.md)
- [Quality and SDK check contract](quality-guidelines.md)
- [Error handling](error-handling.md)
- [Logging](logging-guidelines.md)
- [Database status](database-guidelines.md)
- [Pi 工作流契约](pi-workflow.md)
- [Mac 桌面运行时](desktop-runtime.md)

## Quality Check

Run npm run check. For changes to this check, also run node --check scripts/check-pi.mjs.

No standalone linter or TypeScript compiler is configured at this stage. Do not report either as passed. Add suitable checks when actual application code is introduced.
