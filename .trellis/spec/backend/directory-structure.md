# Directory Structure

- scripts/check-pi.mjs: executable offline Pi/Trellis integration check.
- scripts/check-workflow.mjs: offline workflow regression through the real SDK and local commands.
- docs/: product direction, official research, and implementation sequence.
- .trellis/: development workflow, project conventions, tasks, and journals.
- .pi/: Pi resources; extensions/trellis is generated, extensions/mediastorm and skills/mediastorm-workflow are owned by this project.
- .agents/ and .codex/: Trellis-generated Codex development resources.
- package.json and package-lock.json: private application package and exact dependency graph.

There is currently no src/ directory. Create application files only when implementing a real feature; do not add empty service, adapter, repository, or UI layers.

Use native ESM and Node APIs for the current check. The generated Trellis extension is upstream TypeScript loaded by Pi, not a company application module.
