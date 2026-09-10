import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { agentProfile } from "./agents.mjs";

export const phases = {
  clarify: "澄清需求", awaiting_approval: "等待方案确认", implementing: "实现",
  checking: "检查", awaiting_acceptance: "等待验收", completed: "已验收",
};
export const documentNames = ["prd.md", "design.md", "implement.md"];

export function projectRoot(cwd) {
  let root = realpathSync(cwd);
  while (!existsSync(join(root, ".trellis"))) {
    if (existsSync(join(root, ".git")) || dirname(root) === root) {
      throw new Error("当前项目未初始化 Trellis，请先用 pi:project 接入该项目。");
    }
    root = dirname(root);
  }
  if (realpathSync(join(root, ".trellis")) !== join(root, ".trellis")) {
    throw new Error("项目的 .trellis 不能指向其他目录。");
  }
  return root;
}

export function taskPath(root, ref, allowArchived = false) {
  const tasks = realpathSync(join(root, ".trellis/tasks"));
  if (tasks !== join(root, ".trellis/tasks")) throw new Error("项目任务目录不能指向其他目录。");
  const task = realpathSync(resolve(root, ref));
  const archived = /^archive\/\d{4}-(0[1-9]|1[0-2])\/[^/]+$/.test(relative(tasks, task).split(sep).join("/"));
  if (dirname(task) !== tasks && !(allowArchived && archived)) throw new Error("任务必须位于当前项目的 .trellis/tasks 内。");
  return task;
}

export function readDocument(task, name) {
  const path = join(task, name);
  if (!existsSync(path)) return "";
  if (dirname(realpathSync(path)) !== task) throw new Error("任务文件不能指向其他目录。");
  return readFileSync(path, "utf8");
}

export function saveProgress(task, state) {
  const file = join(task, "progress.json");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function planDigest(task, command, state = JSON.parse(readDocument(task, "progress.json"))) {
  const parts = [
    ...documentNames.filter(name => name !== "implement.md").map(name => readDocument(task, name)), command,
  ];
  // Keep old task fingerprints valid; only new Agent records add these fields.
  if (state.agent || state.assessment) parts.push(state.agent, state.assessment);
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function loadProgress(task) {
  const state = JSON.parse(readDocument(task, "progress.json"));
  if (state.version !== 1 || !Object.hasOwn(phases, state.phase) ||
      ![state.summary, state.next, state.checkCommand].every(v => typeof v === "string")) {
    throw new Error("任务进度文件格式不正确，请检查 progress.json。");
  }
  agentProfile(state.agent);
  if (state.approval && state.approval !== planDigest(task, state.checkCommand, state)) {
    return { ...state, phase: "awaiting_approval", approval: null, check: null, handoff: null,
      next: "需求、方案或检查命令已变化，请重新确认方案。" };
  }
  return state;
}

export function requireApproval(task, state) {
  if (!state.approval || state.approval !== planDigest(task, state.checkCommand)) {
    throw new Error("当前方案尚未获用户确认，请通过 storm_task approve 展示确认界面。");
  }
  if (state.phase === "completed") throw new Error("该任务已验收，请新建任务记录后续改动。");
}

export function taskList(root, includeArchived = false) {
  if (realpathSync(join(root, ".trellis/tasks")) !== join(root, ".trellis/tasks")) throw new Error("项目任务目录不能指向其他目录。");
  const refs = readdirSync(join(root, ".trellis/tasks"), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== "archive")
    .map(entry => `.trellis/tasks/${entry.name}`);
  const archive = join(root, ".trellis/tasks/archive");
  if (includeArchived && existsSync(archive)) {
    if (realpathSync(archive) !== archive) throw new Error("项目归档目录不能指向其他目录。");
    for (const month of readdirSync(archive, { withFileTypes: true })) {
      if (!month.isDirectory() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month.name)) continue;
      for (const entry of readdirSync(join(archive, month.name), { withFileTypes: true })) {
        if (entry.isDirectory()) refs.push(`.trellis/tasks/archive/${month.name}/${entry.name}`);
      }
    }
  }
  return refs.filter(ref => existsSync(join(root, ref, "progress.json")))
    .map(ref => {
      const task = taskPath(root, ref, includeArchived);
      return { ref, title: JSON.parse(readDocument(task, "task.json")).title, state: loadProgress(task) };
    });
}

export function canEditDocument(root, task, file) {
  if (typeof file !== "string") return false;
  const path = resolve(root, file);
  if (!documentNames.some(name => path === join(task, name))) return false;
  return !existsSync(path) || realpathSync(path) === path;
}

export function relativeTask(root, task) {
  return relative(root, task).split(sep).join("/");
}
