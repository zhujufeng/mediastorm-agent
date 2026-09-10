import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { loadProgress, projectRoot, taskList, taskPath } from "../.pi/extensions/mediastorm/state.mjs";
import { prepareProject, projectLaunch, projectChoices, readRecentProjects, rememberProject } from "./pi-project.mjs";
import { projectMemory } from "../.pi/extensions/mediastorm/reports.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const initialCwd = process.cwd();
const temporary = realpathSync(mkdtempSync(join(tmpdir(), "mediastorm-workflow-")));
const project = join(temporary, "a/project");
const otherProject = join(temporary, "b/project");
const sessions = [];
const errors = [];
const messages = [];
const notices = [];
const widgets = new Map();
const selections = [];
const confirmations = [];
let consent = true;
let confirmEffect;

try {
  mkdirSync(join(temporary, ".trellis"));
  for (const root of [project, otherProject]) {
    mkdirSync(root, { recursive: true });
    execFileSync("git", ["init", "-q", root]);
    writeFileSync(join(root, "README.md"), "# Existing project\n");
    assert.throws(() => projectRoot(root), /未初始化/, "Do not cross an uninitialized Git repository into its parent");
    assert.equal(prepareProject(root), root);
    assert.equal(projectRoot(root), root);
    const memory = join(root, ".trellis/spec/index.md");
    assert.match(readFileSync(memory, "utf8"), /README.md/);
    writeFileSync(memory, "# Existing project decisions\n");
    prepareProject(root);
    assert.equal(readFileSync(memory, "utf8"), "# Existing project decisions\n", "Repeated setup preserves project memory");
    assert.equal(readFileSync(join(root, "README.md"), "utf8"), "# Existing project\n");
    const subdir = join(root, "src");
    mkdirSync(subdir);
    assert.equal(projectRoot(subdir), root);
    assert.throws(() => prepareProject(subdir), /根目录/);
  }
  const incomplete = join(temporary, "incomplete");
  const recentFile = join(temporary, "local/projects.json");
  assert.deepEqual(readRecentProjects(recentFile), []);
  rememberProject(project, recentFile);
  rememberProject(otherProject, recentFile);
  rememberProject(project, recentFile);
  assert.deepEqual(readRecentProjects(recentFile), [project, otherProject], "Reopening moves a project first without duplicates");
  assert.deepEqual(projectChoices([project, join(temporary, "missing"), otherProject, project], join(temporary, "a")),
    [project, otherProject, realpathSync(repo)], "Keep same-name projects distinct and omit missing directories");
  for (const broken of ["{", '{"paths":[]}', '["relative/path"]']) {
    writeFileSync(recentFile, broken);
    assert.throws(() => rememberProject(project, recentFile), /保留原文件/);
    assert.equal(readFileSync(recentFile, "utf8"), broken);
  }
  const pickerCode = `import { chooseProject } from ${JSON.stringify(new URL("./pi-project.mjs", import.meta.url).href)};
    console.log('SELECTED=' + JSON.stringify(await chooseProject(${JSON.stringify([project, otherProject])})));`;
  for (const [input, selected] of [["99\n2\n", otherProject], ["\n", project], ["q\n", undefined], ["", undefined], [`"${project}"\n`, project]]) {
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", pickerCode], { input, encoding: "utf8", timeout: 10000 });
    assert.ok(output.includes(`SELECTED=${JSON.stringify(selected)}`), "Project picker handles retry, default, cancellation, EOF and paths");
  }
  const prepared = execFileSync(process.execPath, [join(repo, "scripts/pi-project.mjs"), otherProject, "--prepare"], { encoding: "utf8", timeout: 20000 });
  assert.ok(prepared.includes(`当前项目：${otherProject}`), "Explicit prepare mode does not launch a model session");
  mkdirSync(join(incomplete, ".trellis"), { recursive: true });
  execFileSync("git", ["init", "-q", incomplete]);
  assert.throws(() => prepareProject(incomplete), /不完整/);
  const linked = join(temporary, "linked");
  mkdirSync(linked);
  execFileSync("git", ["init", "-q", linked]);
  symlinkSync(join(project, ".trellis"), join(linked, ".trellis"));
  assert.throws(() => prepareProject(linked), /不能指向/);
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const open = async (cwd, manager = SessionManager.inMemory(cwd)) => {
    process.chdir(cwd); // Trellis 0.6.6 resolves its root at extension factory time.
    const launch = projectLaunch(cwd);
    assert.equal(launch.cwd, cwd);
    const paths = flag => launch.args.flatMap((arg, index) => arg === flag ? [launch.args[index + 1]] : []);
    const settingsManager = SettingsManager.inMemory({});
    const loader = new DefaultResourceLoader({ cwd, agentDir: join(temporary, "agent"), settingsManager,
      noExtensions: launch.args.includes("--no-extensions"), noSkills: launch.args.includes("--no-skills"),
      noPromptTemplates: launch.args.includes("--no-prompt-templates"), noThemes: launch.args.includes("--no-themes"),
      noContextFiles: launch.args.includes("--no-context-files"),
      additionalExtensionPaths: paths("-e"), additionalSkillPaths: paths("--skill"),
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 4, "Load the four configured extensions exactly once");
    assert.ok(loaded.extensions.some(extension => extension.commands.has("ponytail")));
    assert.ok(loaded.extensions.some(extension => extension.tools.has("codegraph_explore")));
    assert.ok(loader.getSkills().skills.some(skill => skill.name === "mediastorm-workflow"));
    assert.ok(loader.getSkills().skills.some(skill => skill.name === "project-takeover"));
    const { session } = await createAgentSession({ cwd, agentDir: join(temporary, "agent"),
      settingsManager, modelRuntime, resourceLoader: loader, sessionManager: manager, tools: [] });
    sessions.push(session);
    await session.bindExtensions({ mode: "interactive", onError: error => errors.push(error), uiContext: {
      notify: (text, level) => notices.push({ text, level }),
      setStatus: () => {}, setWidget: (key, lines) => widgets.set(key, lines),
      select: async (_title, options) => { selections.push(options); return options[0]; },
      confirm: async (title, body) => { confirmations.push({ title, body }); await confirmEffect?.(); return consent; },
    } });
    // Only model dispatch is replaced. SDK hooks, persistence, Python and pi.exec run for real.
    loaded.runtime.sendUserMessage = message => messages.push(message);
    const extension = loaded.extensions.find(item => item.commands.has("storm"));
    const ctx = session.extensionRunner.createContext();
    return {
      session, manager, ctx,
      command: args => extension.commands.get("storm").handler(args, ctx),
      tool: (name, params = {}, signal) => extension.tools.get(name).definition.execute("test", params, signal, undefined, ctx),
      async taskAction(params, signal) {
        const blocked = await this.preflight("storm_task", params, "task-control");
        assert.equal(blocked, undefined, "Task tools pass the actual workflow event gate");
        try { return JSON.parse((await this.tool("storm_task", params, signal)).content[0].text); }
        finally { await this.end("storm_task", "task-control"); }
      },
      async record(name, params, signal) {
        const id = `record-${name}`;
        assert.equal(await this.preflight(name, params, id), undefined);
        try { return await this.tool(name, params, signal); }
        finally { await this.end(name, id); }
      },
      preflight: (name, input = {}, id = name) => session.extensionRunner.emitToolCall({
        type: "tool_call", toolName: name, input, toolCallId: id,
      }),
      end: (name, id = name) => session.extensionRunner.emit({
        type: "tool_execution_end", toolName: name, toolCallId: id, result: {}, isError: false,
      }),
    };
  };

  let app = await open(project);
  assert.ok(widgets.get("mediastorm").includes(`目录：${project}`), "Project path stays visible without a task");
  const welcome = await app.session.extensionRunner.emitBeforeAgentStart("帮我优化一下这个项目", undefined, "Original prompt", {
    cwd: project, selectedTools: [],
  });
  assert.match(welcome.systemPrompt, /用户直接描述需求即可/);
  assert.match(welcome.systemPrompt, /普通咨询直接回答/);
  assert.equal(taskList(project).length, 0, "Injecting guidance alone does not create a task");
  assert.equal((await app.preflight("write", { path: "app.js" })).block, true, "No-task requests cannot bypass requirements approval");
  const begun = await app.taskAction({ action: "new", agent: "development", title: "给报表增加筛选" });
  assert.equal(begun.applied, true);
  assert.ok(widgets.get("mediastorm").includes(`目录：${project}`), "Project path stays visible with an active task");
  assert.equal(messages.length, 0, "Tool-driven continuation stays in the current model turn");
  assert.ok(begun.next.includes(join(repo, ".pi/skills/mediastorm-workflow/SKILL.md")));
  await app.taskAction({ action: "new", agent: "development", title: "给报表增加筛选" });
  assert.equal(taskList(project).length, 1, "Retrying creation for the active title does not duplicate the task");
  const task = taskPath(project, taskList(project)[0].ref);
  assert.equal(loadProgress(task).agent, "development");
  const legacyState = loadProgress(task);
  delete legacyState.agent; // A task created before Agent profiles existed.
  writeFileSync(join(task, "progress.json"), JSON.stringify(legacyState));
  const prd = join(task, "prd.md");
  writeFileSync(prd, "# 需求\n给现有报表增加账号筛选。验收：现有测试通过。\n");
  const context = await app.session.extensionRunner.emitBeforeAgentStart("继续", undefined, "Original prompt", {
    cwd: project, selectedTools: [],
  });
  assert.match(context.systemPrompt, /Original prompt/);
  assert.match(context.systemPrompt, /给现有报表增加账号筛选/);
  assert.match(context.systemPrompt, /ponytail/i);
  assert.match(context.systemPrompt, /CodeGraph tools are available/);
  assert.match(context.systemPrompt, /MediaStorm 工作流已启用/);
  assert.equal(loadProgress(task).phase, "clarify");
  assert.equal((await app.preflight("bash", { command: "echo should-not-run" })).block, true);
  assert.equal((await app.preflight("write", { path: join(project, "app.js") })).block, true);
  assert.equal(await app.preflight("write", { path: prd }), undefined);
  assert.equal(await app.preflight("read", { path: "app.js" }), undefined);
  const graphArgs = { projectPath: otherProject, query: "example" };
  await app.preflight("codegraph_explore", graphArgs);
  assert.equal(graphArgs.projectPath, project, "Graph queries are bound to the selected project");
  await assert.rejects(app.tool("storm_progress", { phase: "implementing", summary: "越过确认", next: "修改" }), /确认/);

  const progress = (phase, extra = {}) => app.tool("storm_progress", {
    phase, summary: "给报表增加筛选", next: "按阶段继续", ...extra,
  });
  await progress("awaiting_approval", { checkCommand: "node -e 'process.exit(7)'" });
  consent = false;
  assert.equal(await app.preflight("storm_task", { action: "approve" }, "dialog"), undefined);
  assert.equal((await app.preflight("storm_progress", {})).block, true, "Cannot change the plan while confirmation is open");
  assert.equal((await app.preflight("write", { path: prd })).block, true);
  assert.equal((await app.preflight("storm_check")).block, true);
  assert.equal((await app.preflight("storm_task", { action: "new", title: "race" })).block, true);
  assert.equal(JSON.parse((await app.tool("storm_task", { action: "approve" })).content[0].text).applied, false);
  await app.end("storm_task", "dialog");
  assert.equal(loadProgress(task).approval, null, "Cancelled approval must not authorize execution");
  consent = true;
  const beforeConfirmation = readFileSync(prd, "utf8");
  confirmEffect = () => writeFileSync(prd, `${beforeConfirmation}Changed during confirmation\n`);
  await assert.rejects(app.taskAction({ action: "approve" }), /确认期间发生变化/);
  assert.equal(loadProgress(task).approval, null);
  confirmEffect = undefined;
  writeFileSync(prd, beforeConfirmation);
  await app.taskAction({ action: "approve" });
  assert.equal(loadProgress(task).phase, "implementing");
  assert.equal(loadProgress(task).approval, createHash("sha256").update(JSON.stringify([
    readFileSync(prd, "utf8"), "", "node -e 'process.exit(7)'",
  ])).digest("hex"), "Legacy approvals retain their original fingerprint format");
  assert.equal(JSON.parse(readFileSync(join(task, "task.json"), "utf8")).status, "in_progress");
  writeFileSync(join(task, "implement.md"), "- [x] 已完成一个实现步骤\n");
  assert.equal(loadProgress(task).phase, "implementing", "Updating execution notes does not re-open the requirements gate");
  await assert.rejects(app.tool("storm_check"), /检查失败/);
  assert.equal(loadProgress(task).check.exitCode, 7, "Persist the SDK's actual code result");
  await assert.rejects(progress("awaiting_acceptance"), /未通过/);
  await assert.rejects(app.taskAction({ action: "accept" }), /尚无通过的检查/);
  assert.notEqual(loadProgress(task).phase, "completed");

  writeFileSync(prd, `${readFileSync(prd, "utf8")}已确认：支持多账号。\n`);
  assert.equal(loadProgress(task).phase, "awaiting_approval", "Changed requirements invalidate approval");
  assert.equal((await app.preflight("bash", { command: "echo blocked" })).block, true);
  await progress("awaiting_approval", { checkCommand: "node -e 'console.log(\"checks passed\"); console.log(process.cwd())'" });
  await app.command("approve");
  await assert.rejects(app.tool("storm_check", {}, AbortSignal.abort()), /检查失败/);
  assert.equal(loadProgress(task).check.killed, true, "Cancellation cannot count as success");
  await app.tool("storm_check");
  assert.equal(loadProgress(task).check.exitCode, 0);
  assert.match(loadProgress(task).check.stdout, /checks passed/);
  assert.ok(loadProgress(task).check.stdout.includes(project), "Checks execute in the selected business project");
  await progress("awaiting_acceptance");

  await app.preflight("write", { path: join(project, "app.js") }, "edit-one");
  assert.equal((await app.preflight("storm_task", { action: "resume" })).block, true, "Do not switch tasks during mutation");
  assert.equal(loadProgress(task).check, null, "A new modification invalidates prior evidence");
  assert.equal((await app.preflight("storm_check", {}, "check-busy")).block, true);
  await app.end("write", "edit-one");
  assert.equal(await app.preflight("storm_check", {}, "check-one"), undefined);
  assert.equal((await app.preflight("storm_task", { action: "accept" })).block, true);
  assert.equal((await app.preflight("bash", { command: "echo blocked" }, "edit-busy")).block, true);
  await app.tool("storm_check");
  await app.end("storm_check", "check-one");
  await progress("awaiting_acceptance");
  await app.session.extensionRunner.emit({ type: "agent_settled" });
  assert.equal(loadProgress(task).phase, "awaiting_acceptance", "Idle never means accepted");

  const selectedEntry = app.manager.getBranch().find(entry => entry.customType === "mediastorm-task");
  assert.ok(selectedEntry);
  app.session.dispose();
  app = await open(project); // Brand-new SDK session and extension instance.
  const selectionsBefore = selections.length;
  await app.taskAction({ action: "resume" });
  assert.equal(selections.length, selectionsBefore, "A sole unfinished project task resumes without a task picker");
  assert.equal(loadProgress(task).phase, "awaiting_acceptance");
  assert.ok(widgets.get("mediastorm").some(line => line.includes("等待验收")));
  await app.command("spec");
  const specMessage = app.manager.getBranch().find(entry => entry.type === "custom_message" && entry.customType === "mediastorm-spec");
  assert.ok(specMessage, "Spec viewing uses the actual SDK message path");

  const managerB = SessionManager.inMemory(otherProject);
  managerB.appendCustomEntry("mediastorm-task", selectedEntry.data);
  const other = await open(otherProject, managerB);
  await other.command("resume");
  assert.match(notices.at(-1).text, /没有可继续/);
  await other.command("new 备用命令验证");
  assert.ok(messages.at(-1).includes(join(repo, ".pi/skills/mediastorm-workflow/SKILL.md")), "Explicit commands still dispatch the continuation");
  assert.throws(() => taskPath(otherProject, task), /当前项目/);
  symlinkSync(task, join(otherProject, ".trellis/tasks/linked-task"));
  assert.throws(() => taskPath(otherProject, ".trellis/tasks/linked-task"), /当前项目/);

  process.chdir(project);
  consent = false;
  assert.equal((await app.taskAction({ action: "accept" })).applied, false);
  assert.equal(loadProgress(task).phase, "awaiting_acceptance");
  assert.equal(loadProgress(task).check.exitCode, 0, "Opening or cancelling acceptance preserves check evidence");
  consent = true;
  await app.taskAction({ action: "accept" });
  assert.equal(loadProgress(task).phase, "completed");
  await assert.rejects(app.tool("storm_check"), /已验收/);
  assert.equal((await app.preflight("write", { path: prd })).block, true);
  const validProgress = readFileSync(join(task, "progress.json"), "utf8");
  writeFileSync(join(task, "progress.json"), "broken json");
  assert.equal((await app.preflight("bash", { command: "echo blocked" })).block, true);
  writeFileSync(join(task, "progress.json"), validProgress);

  const catalog = await app.taskAction({ action: "agents" });
  assert.equal(catalog.agents["project-takeover"].name, "项目接手与优化助手");
  assert.equal((await app.taskAction({ action: "memory" })).total, 0, "Old tasks without a handoff do not invent project memory");
  await assert.rejects(app.taskAction({ action: "new", title: "bad", agent: "missing" }), /未知 Agent/);
  const takeover = await app.taskAction({ action: "new", title: "接手并优化现有项目" });
  assert.equal(takeover.progress.agent, "project-takeover");
  const takeoverTask = takeover.task;
  const takeoverStateFile = join(takeoverTask, "progress.json");
  assert.ok(takeover.next.includes("project-takeover/SKILL.md"));
  assert.ok(widgets.get("mediastorm").some(line => line.includes("项目接手与优化助手")));
  writeFileSync(join(takeoverTask, "prd.md"), "# 需求\n明确项目运行方式，保留现有输出。\n");
  await progress("awaiting_approval", { checkCommand: "node -e 'console.log(\"takeover check\")'" });
  await assert.rejects(app.taskAction({ action: "approve" }), /调查/);
  const assessment = {
    overview: "报表项目，调查入口与运行说明。", runInstructions: "参考 README.md；尚未实际运行。",
    findings: [{ title: "运行说明不清楚", impact: "同事无法接手", evidence: ["README.md"] }],
    focus: "本轮明确运行说明", preserve: ["保持现有输出"],
  };
  await assert.rejects(app.record("storm_assessment", { ...assessment,
    findings: [{ ...assessment.findings[0], evidence: ["missing.md"] }] }), /ENOENT/);
  symlinkSync(join(otherProject, "README.md"), join(project, "external.md"));
  await assert.rejects(app.record("storm_assessment", { ...assessment,
    findings: [{ ...assessment.findings[0], evidence: ["external.md"] }] }), /跨项目/);
  await assert.rejects(app.record("storm_assessment", { ...assessment,
    findings: [{ ...assessment.findings[0], evidence: ["../project/README.md"] }] }), /相对文件路径/);
  await assert.rejects(app.record("storm_assessment", { ...assessment,
    findings: [{ ...assessment.findings[0], evidence: [] }] }), /至少需要/);
  await app.record("storm_assessment", assessment);
  await progress("awaiting_approval");
  await app.taskAction({ action: "approve" });
  assert.match(confirmations.at(-1).body, /运行说明不清楚/);
  const modifiedAssessment = loadProgress(takeoverTask);
  modifiedAssessment.assessment.focus = "增加启动前检查说明";
  writeFileSync(takeoverStateFile, JSON.stringify(modifiedAssessment));
  assert.equal(loadProgress(takeoverTask).phase, "awaiting_approval", "Changed investigation invalidates approval");
  await app.taskAction({ action: "approve" });
  const handoff = { summary: `已明确项目运行方式。${"交付细节".repeat(110)}`, runInstructions: `按 README.md 准备运行环境。${"运行细节".repeat(110)}`,
    remaining: ["尚未在同事电脑上试用", "尚未验证生产环境", "检查细节".repeat(70), "尚未提供安装包"],
    memories: [{ fact: "运行方式以 README.md 为入口，保留现有输出。", source: "README.md" },
      { fact: "保留原架构。".repeat(60), source: "README.md" }, { fact: "已决定不拆分模块。", source: "README.md" }] };
  await assert.rejects(app.record("storm_handoff", handoff), /检查未通过/);
  await app.tool("storm_check");
  await assert.rejects(progress("awaiting_acceptance"), /交付报告/);
  await assert.rejects(app.record("storm_handoff", { ...handoff,
    memories: [{ fact: "越界来源", source: "external.md" }] }), /跨项目/);
  const passedCheck = loadProgress(takeoverTask).check;
  await app.record("storm_handoff", handoff);
  assert.deepEqual(loadProgress(takeoverTask).check, passedCheck, "Handoff preserves actual test evidence");
  assert.equal(await app.preflight("storm_handoff", handoff, "report-open"), undefined);
  assert.equal((await app.preflight("storm_check")).block, true, "Report saving serializes with checks");
  assert.equal((await app.preflight("write", { path: "README.md" })).block, true);
  await app.end("storm_handoff", "report-open");
  await app.preflight("write", { path: "README.md" }, "takeover-edit");
  assert.equal(loadProgress(takeoverTask).handoff, null, "Business mutations invalidate the old handoff");
  await app.end("write", "takeover-edit");
  await app.tool("storm_check");
  await app.record("storm_handoff", handoff);
  await app.tool("storm_check");
  assert.equal(loadProgress(takeoverTask).handoff, null, "A fresh check requires a fresh handoff");
  await app.record("storm_handoff", handoff);
  await progress("awaiting_acceptance");
  consent = false;
  assert.equal((await app.taskAction({ action: "accept" })).applied, false);
  assert.equal(projectMemory(project).total, 0, "Cancelled acceptance does not promote draft knowledge");
  assert.match(confirmations.at(-1).body, /随验收保留的项目经验/);
  assert.match(confirmations.at(-1).body, /尚未在同事电脑上试用/);
  app.session.dispose();
  app = await open(project);
  const resumedTakeover = await app.taskAction({ action: "resume" });
  assert.equal(resumedTakeover.progress.agent, "project-takeover", "Resume restores the original Agent");
  assert.deepEqual(resumedTakeover.progress.handoff, handoff, "Resume restores the unaccepted handoff without promoting it");
  consent = true;
  const beforeHandoffConfirmation = readFileSync(takeoverStateFile, "utf8");
  confirmEffect = () => {
    const state = JSON.parse(readFileSync(takeoverStateFile, "utf8"));
    state.handoff.memories[0].fact = "确认期间篡改的经验";
    writeFileSync(takeoverStateFile, JSON.stringify(state));
  };
  await assert.rejects(app.taskAction({ action: "accept" }), /确认期间发生变化/);
  assert.equal(projectMemory(project).total, 0);
  confirmEffect = undefined;
  writeFileSync(takeoverStateFile, beforeHandoffConfirmation);
  await app.taskAction({ action: "accept" });
  assert.equal(loadProgress(takeoverTask).phase, "completed");
  const memory = await app.taskAction({ action: "memory", query: "README" });
  assert.equal(memory.total, 1);
  assert.equal(memory.records[0].memories[0].fact, handoff.memories[0].fact);
  assert.equal(memory.records[0].check.exitCode, 0);
  assert.ok(memory.records[0].acceptedAt);
  assert.equal((await app.taskAction({ action: "memory", query: "不存在的主题" })).total, 0);
  assert.equal(projectMemory(otherProject).total, 0, "Identically named projects never share accepted memory");
  const acceptedState = readFileSync(takeoverStateFile, "utf8");
  const changedAccepted = JSON.parse(acceptedState);
  changedAccepted.handoff.summary = "验收后改写的报告";
  writeFileSync(takeoverStateFile, JSON.stringify(changedAccepted));
  assert.throws(() => projectMemory(project), /验收证据/);
  writeFileSync(takeoverStateFile, acceptedState);

  app.session.dispose();
  app = await open(project);
  const restoredMemory = await app.session.extensionRunner.emitBeforeAgentStart("上次改了什么，检查结果怎样，还有什么没处理？", undefined, "Original prompt", {
    cwd: project, selectedTools: [],
  });
  assert.match(JSON.stringify(restoredMemory), /运行方式以 README.md 为入口/);
  const restoredContent = restoredMemory.messages.find(item => item.customType === "mediastorm-progress").content;
  const brief = JSON.parse(restoredContent.split("\n").find(line => line.startsWith("本项目已验收记录摘要")).split("：").slice(1).join("："))[0];
  assert.equal(brief.record, `${memory.records[0].task}/progress.json`);
  assert.deepEqual(brief.check, memory.records[0].check, "Fresh sessions receive the actual command, status and time without raw output");
  assert.equal(brief.remainingCount, 4);
  assert.equal(brief.remaining.length, 3);
  assert.equal(brief.remaining[0], handoff.remaining[0]);
  assert.equal(brief.memoriesCount, 3);
  assert.equal(brief.memories.length, 2);
  for (const [text, limit] of [[brief.summary, 400], [brief.runInstructions, 400], [brief.remaining[2], 250], [brief.memories[1].fact, 250]]) {
    assert.match(text, /已截断/);
    assert.ok(text.length < limit + 30, "Long history excerpts remain bounded and explicitly marked");
  }
  const recalled = await app.taskAction({ action: "memory" });
  assert.deepEqual(recalled.records[0].remaining, handoff.remaining, "Read-only recall retrieves the full backlog, including omitted entries");
  assert.equal(recalled.records[0].summary, handoff.summary, "The full report stays available after context truncation");
  assert.equal(recalled.records[0].memories[2].fact, "已决定不拆分模块。");
  assert.equal(taskList(project).length, 2, "Recalling history does not create a task");
  assert.equal(readFileSync(takeoverStateFile, "utf8"), acceptedState, "Recalling history preserves the accepted record byte for byte");
  assert.ok(restoredContent.includes("当前任务：尚无任务"), "Viewing completed history does not resume it as active work");
  await app.taskAction({ action: "new", agent: "development", title: "后续功能开发" });
  assert.equal((await app.taskAction({ action: "memory" })).records[0].agent, "project-takeover", "Agents share project knowledge");
  await assert.rejects(app.taskAction({ action: "resume", agent: "project-takeover" }), /只能在新建/);
  const archive = join(project, ".trellis/tasks/archive/2026-09");
  mkdirSync(archive, { recursive: true });
  const archivedTask = join(archive, takeoverTask.split("/").at(-1));
  renameSync(takeoverTask, archivedTask);
  assert.throws(() => taskPath(project, archivedTask), /当前项目/);
  assert.ok(projectMemory(project).records[0].task.includes("archive/2026-09/"), "Archiving preserves project memory");
  renameSync(join(project, "README.md"), join(project, "README-renamed.md"));
  assert.equal(projectMemory(project).total, 1, "Historical source paths can become stale without destroying records");
  renameSync(join(project, "README-renamed.md"), join(project, "README.md"));
  const otherArchive = join(otherProject, ".trellis/tasks/archive");
  renameSync(otherArchive, `${otherArchive}-saved`);
  symlinkSync(archive, otherArchive);
  assert.throws(() => projectMemory(otherProject), /归档目录不能指向/);
  rmSync(otherArchive);
  renameSync(`${otherArchive}-saved`, otherArchive);
  assert.deepEqual(errors, [], "No SDK extension event errors");
  console.log("PASS: Agent selection, investigation and handoff gates, legacy tasks, accepted project memory and archives, confirmation races, checks, cancellation, recovery and project isolation. Model dispatch is mocked.");
} finally {
  for (const session of sessions) session.dispose();
  process.chdir(initialCwd);
  rmSync(temporary, { recursive: true, force: true });
}
