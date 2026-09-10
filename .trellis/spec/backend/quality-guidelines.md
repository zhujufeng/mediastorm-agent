# Quality and Pi Integration Contract

## 1. Scope

Verify that the pinned Pi SDK and the actual Trellis extension can initialize together. This is technical feasibility evidence only.

## 2. Commands and APIs

- npm run check → node scripts/check-pi.mjs, then node scripts/check-workflow.mjs.
- ModelRuntime.create, DefaultResourceLoader.reload, createAgentSession, session.bindExtensions, session.dispose.
- Official version-specific API notes: docs/pi-research.md.

## 3. Contract

Use in-memory settings, credentials, model configuration, and session state, with a temporary agentDir. Disable automatic resource discovery; explicitly load .pi/extensions/trellis/index.ts.

Do not call session.prompt, execute tools, or require a model key. Use tools: [] to exclude all tools from this check's session.

## 4. Validation and Error Matrix

| Condition | Required result |
| --- | --- |
| SDK import or initialization fails | Nonzero exit |
| Extension load/start reports errors | Failed assertion |
| Trellis extension does not register trellis_subagent | Failed assertion |
| Startup event missing or duplicated | Failed assertion |
| Session persists to disk or exposes tools | Failed assertion |
| All assertions pass | Fixed PASS line and zero exit |

## 5. Good / Base / Bad Cases

- Good: run from the project directory after npm ci --ignore-scripts; all assertions pass.
- Base: no model key or personal Pi configuration is needed.
- Bad: removing the Trellis extension or its registration must fail the check.

## 6. Required Check

The runnable assertion script is scripts/check-pi.mjs. Keep its checks for extension registration, startup errors/events, in-memory state, configured tools, and active tools.

Workflow behavior is checked in scripts/check-workflow.mjs; see pi-workflow.md. The original check-pi.mjs retains its no-tool-execution contract. Do not add a framework just for these checks.

## 7. Wrong vs Correct

Wrong: with tools: [], expect session.getAllTools() to list every extension registration.

Correct: inspect loader.getExtensions().extensions for registration, then assert session.getAllTools() and session.getActiveToolNames() are empty. Pi applies the allowlist to configured tool definitions too.

Wrong: report a business task as complete because the model said it passed.

Correct: check the actual command outcome and relevant artifact against agreed requirements. This remains future product work.
