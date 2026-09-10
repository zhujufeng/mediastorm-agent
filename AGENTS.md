<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## Project Context

- Product: MediaStorm's Pi-based company Agent platform. The first Agent helps employees take over and improve AI-built projects so others can run, verify, and maintain them. Agent profiles share task planning, project memory, recovery and confirmation mechanisms.
- Data collection is a first-pilot candidate, not the whole product. The personal EZagent plugin is a separate project.
- Start with README.md, docs/pi-research.md, and docs/development-plan.md.
- Current stage: Mac Electron desktop preview plus Pi workflows for project takeover and development. Two real Pi tasks and project-memory recovery have been tried in the forecast project. Desktop local-model regressions cover streaming, recovery and approval/cancellation. Packaged runtimes and a Mac arm64 DMG are implemented; OpenAI browser authorization and a real model response are verified, along with desktop Markdown/copy/history/diff checks. Other providers, another Mac, and Developer ID/notarization await validation. See docs/desktop-pilot.md and .trellis/spec/backend/desktop-runtime.md before changing desktop behavior; see docs/pi-pilot.md and .trellis/spec/backend/pi-workflow.md for the underlying workflow.
- Confirmed sequence: first validate a real development task through Pi CLI and existing Trellis resources, with developers operating it. Add extensions for observed gaps. The company allows internal desktop apps; desktop is the confirmed primary employee entry point. User confirmed Mac first, with Windows later; the Mac preview uses Electron 44.3.0 with vanilla HTML/CSS/JS and bundles its runtime. See docs/pi-workflow-proposal.md for delivery and memory requirements.
- Use the pinned Pi 0.85.1 public SDK. Check the actual API and official sources before adding integrations.
- Project checks: npm run check; npm run check:desktop (Markdown safety, real SDK OAuth with mocked token endpoints, and local loopback model fixture). This is an offline integration check, not proof of business-task quality.
- Trellis specs describe this repository's current conventions. Do not present them as company-wide standards derived from an audit.
- User-facing explanations and product documents should use plain Chinese.

- Public repository: keep credentials, colleague project copies, local task history and developer journals out of Git. The checked-in Trellis scripts/specs are reusable; initialize your own developer identity with `python3 .trellis/scripts/init_developer.py <name>`.
