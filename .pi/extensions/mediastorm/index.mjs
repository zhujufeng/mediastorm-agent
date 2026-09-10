import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  canEditDocument, documentNames, loadProgress, phases, planDigest, projectRoot,
  readDocument, relativeTask, requireApproval, saveProgress, taskList, taskPath,
} from "./state.mjs";
import { agentProfile, agentInstructions, agents } from "./agents.mjs";
import {
  assessmentReport, assessmentSchema, deliveryDigest, handoffReport, handoffSchema,
  projectMemory, renderAssessment, renderHandoff,
} from "./reports.mjs";

const executeFile = promisify(execFile);
const textResult = text => ({ content: [{ type: "text", text }] });
const readableTools = new Set(["read", "grep", "find", "ls", "storm_changes"]);
const workingPhases = new Set(["implementing", "checking", "awaiting_acceptance"]);
const workflowSkill = fileURLToPath(new URL("../../skills/mediastorm-workflow/SKILL.md", import.meta.url));

export default function mediaStorm(pi) {
  if (process.env.TRELLIS_SUBAGENT_CHILD === "1") return;
  let task;
  let busy = false;
  let activity = "尚未开始";
  const pendingMutations = new Set();
  let pendingCheck;
  let pendingControl;

  const python = async (ctx, args) => {
    const id = ctx.sessionManager.getSessionId();
    const key = process.env.TRELLIS_CONTEXT_ID || `pi_${id.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
    return executeFile("python3", args, { cwd: projectRoot(ctx.cwd), timeout: 20000,
      env: { ...process.env, TRELLIS_CONTEXT_ID: key }, maxBuffer: 1024 * 1024 });
  };
  const bind = async (ctx, ref) => {
    const root = projectRoot(ctx.cwd);
    const selected = taskPath(root, ref);
    await python(ctx, ["-c", [
      "import sys", "from pathlib import Path", "sys.path.insert(0, '.trellis/scripts')",
      "from common.active_task import set_active_task",
      "assert set_active_task(sys.argv[1], Path.cwd()), 'Cannot bind Trellis task'",
    ].join("\n"), relativeTask(root, selected)]);
    task = selected;
  };
  const current = () => {
    if (!task) throw new Error("尚未记录任务。请根据用户的工作请求调用 storm_task 新建或恢复任务。");
    return loadProgress(task);
  };
  const refresh = ctx => {
    if (!ctx.hasUI) return;
    try {
      const root = projectRoot(ctx.cwd);
      const state = task && current();
      ctx.ui.setStatus("mediastorm", `${basename(root)} · ${state ? phases[state.phase] : "直接描述需求即可"}`);
      ctx.ui.setWidget("mediastorm", [`项目：${basename(root)}`, `目录：${root}`, ...(state ? [
        `助手：${agentProfile(state.agent).name}`,
        `任务：${JSON.parse(readDocument(task, "task.json")).title}`,
        `阶段：${phases[state.phase]} · ${busy ? activity : "当前空闲"}`,
        `当前工作：${state.summary}`,
        `下一步：${state.next}`,
      ] : ["项目接手与优化助手 · 直接说：帮我优化当前项目。", "也可以描述明确的开发需求，或说：查看项目经验。"])]);
    } catch (error) {
      ctx.ui.setWidget("mediastorm", [`无法读取项目进度：${error.message}`]);
      ctx.ui.setStatus("mediastorm", "进度读取失败");
    }
  };
  const kickoff = () => pi.sendUserMessage(
    `按 MediaStorm 工作流继续当前任务。先读取 ${workflowSkill}，` +
    "以及当前任务的 prd.md、可选 design.md、implement.md 和 progress.json；说明当前阶段，再推进下一步。",
  );

  const runAction = async (args, ctx, fromTool = false, signal, options = {}) => {
    try {
      if (!ctx.hasUI) throw new Error("任务确认需要交互界面，不能在无界面模式代替用户确认。");
      signal?.throwIfAborted();
      if (!fromTool && !ctx.isIdle()) throw new Error("请等待当前执行结束，或先按 Esc 停止后再操作。");
      let [action, ...words] = args.trim().split(/\s+/);
      if (!action) {
        const choice = await ctx.ui.select("接下来做什么？", [
          "新建任务", "继续项目任务", "查看需求与方案", "确认方案并开始", "验收交付", "查看进度", "查看项目经验", "查看可用助手",
        ]);
        action = { 新建任务: "new", 继续项目任务: "resume", 查看需求与方案: "spec",
          确认方案并开始: "approve", 验收交付: "accept", 查看进度: "status", 查看项目经验: "memory", 查看可用助手: "agents" }[choice];
        if (!action) return false;
      }
      const root = projectRoot(ctx.cwd);
      if (action === "new") {
        let agent = options.agent || "project-takeover";
        if (!fromTool) {
          const choice = await ctx.ui.select("选择助手", Object.values(agents).map(item => item.name), { signal });
          if (!choice) return false;
          agent = Object.keys(agents).find(id => agents[id].name === choice);
        }
        agentProfile(agent);
        const title = (words.join(" ") || await ctx.ui.input("想完成什么？用一句话描述。"))?.trim();
        if (!title) return false;
        if (title.length > 200) throw new Error("任务标题请控制在 200 字以内。");
        if (fromTool && task && current().phase !== "completed" &&
            JSON.parse(readDocument(task, "task.json")).title === title && (current().agent || "development") === agent) return true;
        const { stdout } = await python(ctx, [".trellis/scripts/task.py", "create", title,
          "--slug", `storm-${randomUUID().slice(0, 8)}`, "--description", title, "--no-start"]);
        const ref = stdout.split(/\r?\n/).find(line => /^\.trellis\/tasks\/[^/]+$/.test(line));
        if (!ref) throw new Error("Trellis 未返回新任务路径，请查看任务目录。");
        const created = taskPath(root, ref);
        saveProgress(created, { version: 1, agent, phase: "clarify", summary: title,
          next: "先查项目，再逐题澄清需求。", checkCommand: "", approval: null, check: null });
        await bind(ctx, ref);
        pi.appendEntry("mediastorm-task", { root, ref });
        if (!fromTool) kickoff();
      } else if (action === "resume") {
        if (fromTool && task && current().phase !== "completed") return true;
        const tasks = taskList(root).filter(item => item.state.phase !== "completed");
        if (!tasks.length) throw new Error("当前项目没有可继续的 MediaStorm 任务。");
        const labels = tasks.map(item => `${item.title} · ${phases[item.state.phase]} · ${item.ref}`);
        const chosen = fromTool && tasks.length === 1 ? labels[0]
          : await ctx.ui.select("选择要继续的项目任务", labels, { signal });
        if (!chosen) return false;
        signal?.throwIfAborted();
        const selected = tasks[labels.indexOf(chosen)];
        await bind(ctx, selected.ref);
        pi.appendEntry("mediastorm-task", { root, ref: selected.ref });
        ctx.ui.notify(`已恢复：${selected.title}。需求与阶段来自当前项目记录。`, "info");
        if (!fromTool) kickoff();
      } else if (action === "spec") {
        const state = current();
        pi.sendMessage({ customType: "mediastorm-spec", display: true,
          content: [renderAssessment(state.assessment), ...documentNames.map(name => `## ${name}\n${readDocument(task, name) || "尚未填写"}`),
            renderHandoff(state.handoff, state.check)].join("\n\n") });
      } else if (action === "approve") {
        const state = current();
        if (state.phase !== "awaiting_approval") throw new Error("请先把需求澄清到等待方案确认阶段。");
        if (state.agent === "project-takeover") {
          if (!state.assessment) throw new Error("项目接手任务需要先用 storm_assessment 记录调查、问题依据和本轮范围。");
          assessmentReport(root, state.assessment);
        }
        const prd = readDocument(task, "prd.md").trim();
        if (!prd || !state.checkCommand.trim()) throw new Error("需要先写好需求和实际检查命令。");
        const digest = planDigest(task, state.checkCommand);
        const plan = [renderAssessment(state.assessment), ...documentNames.map(name => `## ${name}\n${readDocument(task, name) || "无需单独文档"}`)].join("\n\n");
        if (!await ctx.ui.confirm("确认需求、方案与验收方式后开始？", `${plan}\n\n检查命令：${state.checkCommand}`, { signal })) return false;
        signal?.throwIfAborted();
        if (digest !== planDigest(task, current().checkCommand)) throw new Error("方案在确认期间发生变化，请重新查看。");
        await python(ctx, [".trellis/scripts/task.py", "start", relativeTask(root, task)]);
        saveProgress(task, { ...state, phase: "implementing", approval: digest, check: null, handoff: null,
          next: "自动实现并运行已确认的检查命令。" });
        if (!fromTool) kickoff();
      } else if (action === "accept") {
        const state = current();
        requireApproval(task, state);
        if (state.phase !== "awaiting_acceptance" || state.check?.exitCode !== 0 || state.check?.killed) {
          throw new Error("尚无通过的检查和待验收交付，请先完成检查。");
        }
        if (state.agent === "project-takeover" && !state.handoff) throw new Error("请先用 storm_handoff 整理交付和拟保留的项目经验。");
        if (state.handoff) handoffReport(root, state.handoff);
        const digest = deliveryDigest(state);
        if (!await ctx.ui.confirm("确认验收当前交付和项目经验？", `${state.summary}\n${renderHandoff(state.handoff, state.check)}\n检查：${state.checkCommand}\n请结合代码差异、产物与检查输出判断。`, { signal })) return false;
        signal?.throwIfAborted();
        const latest = current();
        requireApproval(task, latest);
        if (latest.phase !== "awaiting_acceptance" || latest.check?.exitCode !== 0 || latest.check?.killed) throw new Error("交付状态已变化，请重新检查。");
        if (digest !== deliveryDigest(latest)) throw new Error("交付报告或检查在确认期间发生变化，请重新查看。");
        saveProgress(task, { ...latest, phase: "completed", acceptedAt: new Date().toISOString(), acceptance: digest,
          next: "已验收；后续改动请新建任务。" });
        ctx.ui.notify(latest.handoff ? "已记录验收。交付中的项目经验可供本项目后续任务读取。"
          : "已记录验收。项目需求和检查记录已保留。", "info");
      } else if (action === "agents") {
        if (!fromTool) ctx.ui.notify(Object.entries(agents).map(([id, item]) => `${item.name}（${id}）：${item.description}`).join("\n"), "info");
      } else if (action === "memory") {
        if (!fromTool) pi.sendMessage({ customType: "mediastorm-memory", display: true,
          content: JSON.stringify(projectMemory(root, words.join(" ")), null, 2) });
      } else if (action === "status") {
        const state = current();
        ctx.ui.notify(`${phases[state.phase]}：${state.summary}\n下一步：${state.next}`, "info");
      } else throw new Error("可用操作：new、resume、status、spec、approve、accept、agents、memory。");
      return true;
    } catch (error) {
      if (fromTool) throw error;
      ctx.ui.notify(error.message, "error");
    } finally { refresh(ctx); }
  };

  pi.registerCommand("storm", {
    description: "备用工作流入口：new / resume / status / spec / approve / accept / agents / memory",
    handler: (args, ctx) => runAction(args, ctx),
  });

  pi.registerTool({
    name: "storm_task", label: "推进项目任务",
    description: "根据自然语言工作请求新建或恢复任务、展示方案、请求用户确认或验收。普通聊天无需建任务。" +
      "新任务传入使用者选择的 agent；未指定时默认 project-takeover。agents 查看所有助手，memory 只读查询已验收交付、检查和遗留事项，无需建立或恢复任务。回顾上次工作时省略 query。" +
      "approve/accept 打开真实确认界面，模型无法自行批准。用户取消后停止推进，等待新意见，不要反复弹窗。",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["new", "resume", "spec", "status", "approve", "accept", "agents", "memory"] },
      title: { type: "string", minLength: 1, maxLength: 200 },
      agent: { type: "string", enum: Object.keys(agents) },
      query: { type: "string", maxLength: 200 },
    }, required: ["action"], additionalProperties: false },
    async execute(_id, params, signal, _update, ctx) {
      if (params.action === "new" && !params.title?.trim()) throw new Error("新任务需要概括用户目标的标题。");
      if (params.agent !== undefined && params.action !== "new") throw new Error("Agent 只能在新建任务时选择；继续任务会恢复原来的助手。");
      const applied = await runAction(`${params.action} ${params.title || ""}`, ctx, true, signal, params);
      if (params.action === "agents") return textResult(JSON.stringify({ agents }));
      if (params.action === "memory") return textResult(JSON.stringify(projectMemory(projectRoot(ctx.cwd), params.query)));
      return textResult(JSON.stringify({ applied, task: task || null, progress: task ? current() : null,
        next: applied ? `读取 ${workflowSkill}、${agentProfile(task ? current().agent : undefined).skill} 和当前任务记录，按实际阶段继续。`
          : "用户未确认或未选择，保持当前记录并等待用户意见。不要重复弹窗，不要继续实施或验收。" }));
    },
  });

  pi.registerTool({
    name: "storm_assessment", label: "记录项目调查",
    description: "在方案确认前记录项目概况、运行方式（注明是否运行过）、最多三个有文件来源的问题、本轮范围和要保留的行为。来源用项目相对文件路径。",
    parameters: assessmentSchema,
    async execute(_id, params, signal, _update, ctx) {
      signal?.throwIfAborted();
      const state = current();
      if (!["clarify", "awaiting_approval"].includes(state.phase)) throw new Error("修改调查范围前请先回到澄清阶段。");
      const assessment = assessmentReport(projectRoot(ctx.cwd), params);
      saveProgress(task, { ...state, assessment, phase: "clarify", approval: null, check: null, handoff: null,
        next: "确认本轮重点、需求和检查方式后，请用户确认方案。" });
      refresh(ctx);
      return textResult(renderAssessment(assessment));
    },
  });

  pi.registerTool({
    name: "storm_handoff", label: "整理交付与项目经验",
    description: "真实检查通过后记录交付摘要、运行说明、遗留事项和拟保留经验。经验必须有本项目文件来源，随用户验收后供后续任务读取；更新此报告不会改变实际检查结果。",
    parameters: handoffSchema,
    async execute(_id, params, signal, _update, ctx) {
      signal?.throwIfAborted();
      const state = current();
      requireApproval(task, state);
      if (state.check?.exitCode !== 0 || state.check?.killed) throw new Error("实际检查未通过，不能整理待验收交付。");
      const handoff = handoffReport(projectRoot(ctx.cwd), params);
      saveProgress(task, { ...state, handoff, next: "展示交付与项目经验，进入等待验收。" });
      refresh(ctx);
      return textResult(renderHandoff(handoff, state.check));
    },
  });

  pi.registerTool({
    name: "storm_progress", label: "记录任务进度",
    description: "记录当前工作、下一步和阶段。无法代替用户确认方案或验收。澄清时确定 checkCommand。",
    parameters: { type: "object", properties: {
      phase: { type: "string", enum: Object.keys(phases).filter(phase => phase !== "completed") },
      summary: { type: "string", minLength: 1, maxLength: 500 },
      next: { type: "string", minLength: 1, maxLength: 500 },
      checkCommand: { type: "string", minLength: 1, maxLength: 2000 },
    }, required: ["phase", "summary", "next"], additionalProperties: false },
    async execute(_id, params, _signal, _update, ctx) {
      const state = current();
      if (state.phase === "completed") throw new Error("任务已验收，请新建任务。");
      const updated = { ...state, ...params };
      if (workingPhases.has(params.phase)) requireApproval(task, updated);
      if (params.phase === "awaiting_acceptance" && (state.check?.exitCode !== 0 || state.check?.killed)) {
        throw new Error("检查未通过，请先运行 storm_check。");
      }
      if (params.phase === "awaiting_acceptance" && state.agent === "project-takeover" && !state.handoff) {
        throw new Error("项目接手任务需要先用 storm_handoff 整理交付报告。");
      }
      if (!workingPhases.has(params.phase)) { updated.approval = null; updated.check = null; updated.handoff = null; }
      saveProgress(task, updated);
      refresh(ctx);
      return textResult(`${phases[params.phase]}：${params.summary}`);
    },
  });

  pi.registerTool({
    name: "storm_check", label: "运行已确认的检查",
    description: "运行用户已确认的 checkCommand，保存真实输出和退出状态。失败时修复后重试。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(_id, _params, signal, _update, ctx) {
      const state = current();
      requireApproval(task, state);
      saveProgress(task, { ...state, phase: "checking", check: null, handoff: null, next: "等待实际检查结果。" });
      refresh(ctx);
      try {
        const result = await pi.exec("bash", ["-lc", state.checkCommand], { cwd: projectRoot(ctx.cwd), signal, timeout: 120000 });
        const latest = current();
        requireApproval(task, latest);
        const check = { exitCode: result.code, killed: result.killed, stdout: result.stdout,
          stderr: result.stderr, command: state.checkCommand, at: new Date().toISOString() };
        // ponytail: retain the latest check only; add history when a pilot needs comparisons.
        saveProgress(task, { ...latest, check, next: result.code === 0 && !result.killed
          ? "检查通过，整理交付后进入等待验收。" : "检查失败或中断，请修复后重新检查。" });
        if (result.code !== 0 || result.killed) throw new Error(`检查失败或中断。\n${result.stdout}\n${result.stderr}`);
        return textResult(`检查通过。\n${result.stdout}\n${result.stderr}`);
      } finally { refresh(ctx); }
    },
  });

  const restore = async (_event, ctx) => {
    task = undefined; busy = false; activity = "当前空闲";
    pendingMutations.clear(); pendingCheck = undefined; pendingControl = undefined;
    try {
      const root = projectRoot(ctx.cwd);
      const entry = [...ctx.sessionManager.getBranch()].reverse().find(item =>
        item.type === "custom" && item.customType === "mediastorm-task");
      if (entry?.data?.root === root) {
        await bind(ctx, entry.data.ref);
        current();
      }
    } catch (error) { if (ctx.hasUI) ctx.ui.notify(error.message, "error"); }
    refresh(ctx);
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("before_agent_start", (event, ctx) => {
    const state = task ? current() : null;
    const preferredRole = process.env.STORM_AGENT_PROFILE || "project-takeover";
    const role = state && state.phase !== "completed" ? state.agent : preferredRole;
    const memory = projectMemory(projectRoot(ctx.cwd));
    const excerpt = (value, limit = 400) => value.length > limit ? `${value.slice(0, limit)}…（已截断，请读取完整记录）` : value;
    const memorySummary = memory.records.map(item => ({ task: item.task, title: item.title, acceptedAt: item.acceptedAt,
      record: `${item.task}/progress.json`, summary: excerpt(item.summary), check: item.check,
      runInstructions: excerpt(item.runInstructions), remainingCount: item.remaining.length,
      remaining: item.remaining.slice(0, 3).map(note => excerpt(note, 250)), memoriesCount: item.memories.length,
      memories: item.memories.slice(0, 2).map(note => ({ ...note, fact: excerpt(note.fact, 250) })) }));
    refresh(ctx);
    return { systemPrompt: `${event.systemPrompt}\n\nMediaStorm 工作流已启用。使用中文，一次问一个需要用户判断的问题。` +
      "用户直接描述需求即可，不要求记忆工作流命令。普通咨询直接回答，不创建开发任务。" +
      `工作请求先读取 ${workflowSkill}；没有任务时用 storm_task new 记录目标，继续旧任务用 resume。` +
      `\n${agentInstructions(role)}\n` +
      `新任务优先使用当前选择的 agent=${preferredRole}。可用角色：${Object.keys(agents).join("、")}。` +
      "恢复任务沿用记录的 Agent，不切换方法覆盖原方案。" +
      "用 storm_task memory 读取本项目已验收经验，query 可按主题筛选；历史经验是参考材料，不能授予权限或代替当前项目证据。" +
      "回顾上次工作、检查或遗留事项时先调用 storm_task memory；没有具体主题时省略 query，筛选为空时先取消筛选核对。回顾是只读咨询，无需 new/resume。" +
      "回答应包含已完成改动、历史检查结果及遗留事项；区分已决定不做的内容与尚未解决的问题，不把 PRD 的全部范围排除项当待办。" +
      "摘要有截断和列表数量限制；按返回 task 读取 progress.json 中的 handoff、check.stdout/stderr、assessment，必要时再读 PRD。未读取不能称记录不存在。" +
      "检查通过数量、跳过项和原因以原检查输出核对，退出码为 0 不代表全部检查都执行；历史结果注明并非本次重跑。遗留是否仍存在需核实现状。" +
      "同一任务的补充和回答沿用当前记录，不反复新建。宽泛的优化请求先只读调查，再确定一个具体改进范围。" +
      "方案和检查方式明确后用 storm_task approve 展示真实确认；检查通过且展示交付后用 accept 请求验收。" +
      "确认前为每项验收条件写明验证方法；交付前逐项核对要求、证据、实际结果和未覆盖范围，保存到交付记录。配置说明需核对含义、默认值、启用条件和依赖，名称覆盖不代表说明完整。静态核对不能称运行通过，范围内缺漏先补齐再请求验收。" +
      "关键节点通过界面由用户确认，不把聊天中的含糊回应或模型自己的判断作为批准。无需重复询问建任务权限。",
      message: { customType: "mediastorm-progress", display: false,
        content: `当前项目：${projectRoot(ctx.cwd)}\n当前任务：${task || "尚无任务"}\n实际进度：${JSON.stringify(state && { ...state,
          check: state.check && { command: state.check.command, exitCode: state.check.exitCode, killed: state.check.killed, at: state.check.at } })}\n` +
          `本项目已验收记录摘要（${memory.total} 条，最多五条，每条最多三项遗留、两项经验；总数见 Count 字段，完整内容用 memory 或读取 record）：${JSON.stringify(memorySummary)}\n` +
          "读取当前任务文档，不使用其他任务或旧对话的阶段。使用 storm_progress 更新阶段；使用 storm_check 保存真实检查。" } };
  });
  pi.on("tool_call", (event, ctx) => {
    try {
      const root = projectRoot(ctx.cwd);
      if (event.toolName.startsWith("codegraph_")) {
        event.input.projectPath = root;
        return;
      }
      if (readableTools.has(event.toolName)) return;
      if (pendingControl) return { block: true, reason: "任务切换或用户确认正在进行，请等待结束后再推进。" };
      if (["storm_task", "storm_assessment", "storm_handoff"].includes(event.toolName)) {
        if (pendingMutations.size || pendingCheck) return { block: true, reason: "请等待当前修改或检查结束后，再切换任务或请求确认。" };
        pendingControl = event.toolCallId;
        return;
      }
      if (!task) return { block: true, reason: "先用 storm_task 根据用户目标记录任务。未确认方案时只允许读取项目。" };
      const state = current();
      if (event.toolName === "storm_progress") return;
      const approved = state.approval && state.phase !== "completed";
      const docEdit = ["write", "edit"].includes(event.toolName) && canEditDocument(ctx.cwd, task, event.input.path);
      if (!approved && !(docEdit && ["clarify", "awaiting_approval"].includes(state.phase))) {
        return { block: true, reason: "当前只允许读代码、检索和完善任务文档。方案明确后用 storm_task approve 请求用户确认。" };
      }
      if (approved && event.toolName === "storm_check") {
        if (pendingMutations.size || pendingCheck) return { block: true, reason: "请等待当前修改或检查结束，再单独运行检查。" };
        pendingCheck = event.toolCallId;
      }
      if (approved && event.toolName !== "storm_check") {
        if (pendingCheck) return { block: true, reason: "检查正在执行，请等待结束后再修改代码。" };
        pendingMutations.add(event.toolCallId);
        // Any potentially mutating tool invalidates a prior check before it runs.
        saveProgress(task, { ...state, check: null, handoff: null, phase: "implementing", next: "改动后重新运行检查。" });
      }
    } catch (error) { return { block: true, reason: error.message }; }
  });
  pi.on("agent_start", (_event, ctx) => { busy = true; activity = "正在处理"; refresh(ctx); });
  pi.on("tool_execution_start", (event, ctx) => { activity = `正在执行 ${event.toolName}`; refresh(ctx); });
  pi.on("tool_execution_end", (event, ctx) => {
    pendingMutations.delete(event.toolCallId);
    if (pendingCheck === event.toolCallId) pendingCheck = undefined;
    if (pendingControl === event.toolCallId) pendingControl = undefined;
    activity = event.isError ? "工具失败，正在处理" : "正在处理";
    refresh(ctx);
  });
  pi.on("agent_settled", (_event, ctx) => { busy = false; refresh(ctx); });
}
