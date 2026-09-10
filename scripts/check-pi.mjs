import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

// SDK integration check, not the business application. Never calls prompt().
// Sources and version-specific API notes: docs/pi-research.md.
const cwd = fileURLToPath(new URL("../", import.meta.url));
const agentDir = mkdtempSync(join(tmpdir(), "mediastorm-pi-check-"));
let session;

try {
  const settingsManager = SettingsManager.inMemory({});
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  let startupEvents = 0;
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    // Explicit project extension only; no personal resource discovery.
    additionalExtensionPaths: [join(cwd, ".pi/extensions/trellis/index.ts")],
    extensionFactories: [(pi) => {
      pi.on("session_start", () => { startupEvents += 1; });
    }],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, [], "Extensions must load");
  assert.ok(loader.getExtensions().extensions.some((extension) =>
    extension.tools.has("trellis_subagent")), "Trellis must register its tool");

  ({ session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    settingsManager,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    tools: [],
  }));
  const extensionErrors = [];
  await session.bindExtensions({ onError: (error) => extensionErrors.push(error) });

  assert.deepEqual(extensionErrors, [], "Extension startup must succeed");
  assert.equal(startupEvents, 1, "SDK must deliver session_start");
  assert.equal(session.sessionFile, undefined, "Check must use an in-memory session");
  assert.deepEqual(session.getAllTools(), [], "Tool allowlist must exclude registered tools");
  assert.deepEqual(session.getActiveToolNames(), [], "No execution tools may be active");
  console.log("PASS: Pi SDK, Trellis extension, startup event, in-memory session, disabled tools.");
} finally {
  session?.dispose();
  rmSync(agentDir, { recursive: true, force: true });
}
