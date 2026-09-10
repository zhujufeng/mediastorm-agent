import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { projectRoot } from "../.pi/extensions/mediastorm/state.mjs";

const repo = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const settings = JSON.parse(readFileSync(join(repo, ".pi/settings.json"), "utf8"));
const recentFile = join(repo, ".local/projects.json");

export function readRecentProjects(file = recentFile) {
  if (!existsSync(file)) return [];
  let recent;
  try { recent = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`无法读取最近项目列表，已保留原文件：${file}；${error.message}`); }
  if (!Array.isArray(recent) || recent.some(path => typeof path !== "string" || !isAbsolute(path))) {
    throw new Error(`最近项目列表格式错误，已保留原文件：${file}`);
  }
  return recent;
}

export function projectChoices(recent) {
  return [...new Set([...recent, repo]
    .filter(path => existsSync(join(path, ".git"))).map(path => realpathSync(path)))];
}

export function rememberProject(root, file = recentFile) {
  const recent = readRecentProjects(file);
  const canonical = realpathSync(root);
  const paths = [canonical, ...recent.filter(path => path !== canonical)].slice(0, 10);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(paths, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
}

export async function chooseProject(choices) {
  console.log("\nMediaStorm Agent · 选择本次工作的项目\n");
  choices.forEach((path, index) => console.log(`${index + 1}. ${path === repo ? "MediaStorm Agent 平台源码" : basename(path)}\n   ${path}`));
  if (process.platform === "darwin") console.log("0. 打开其他项目…（选择文件夹）");
  console.log("回车打开第 1 项；输入序号或项目路径；q 退出。最近打开的项目排在前面。\n");
  const ui = createInterface({ input: process.stdin, output: process.stdout, prompt: "选择项目 > " });
  try {
    ui.prompt();
    for await (const line of ui) {
      const answer = line.trim();
      if (answer.toLowerCase() === "q") return;
      if (answer === "0" && process.platform === "darwin") {
        const selected = spawnSync("osascript", ["-e", 'POSIX path of (choose folder with prompt "选择要交给助手的 Git 项目文件夹")'], { encoding: "utf8" });
        if (selected.status === 0) return selected.stdout.trim();
        if (!selected.stderr?.includes("(-128)")) throw new Error(`无法打开文件夹选择器：${selected.error?.message || selected.stderr}`);
      } else if (/^[1-9]\d*$/.test(answer || "1") && choices[Number(answer || "1") - 1]) {
        return choices[Number(answer || "1") - 1];
      } else {
        const path = answer.replace(/^(['"])(.*)\1$/, "$2");
        if (isAbsolute(path) || path.startsWith("./") || path.startsWith("../")) return path;
        if (path.startsWith("~/")) return join(homedir(), path.slice(2));
        console.log("请输入列表中的序号、项目路径，或 q 退出。");
      }
      ui.prompt();
    }
  } finally { ui.close(); }
}

export function prepareProject(path) {
  const root = realpathSync(path);
  const git = spawnSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (git.status !== 0 || realpathSync(git.stdout.trim()) !== root) {
    throw new Error("请指定独立 Git 仓库的根目录，不要指定父目录或项目内的子目录。");
  }
  const trellis = join(root, ".trellis");
  if (!existsSync(trellis)) {
    const staging = mkdtempSync(join(root, ".storm-setup-"));
    try {
      // ponytail: copy the pinned Trellis runtime once; existing projects require an explicit upgrade later.
      cpSync(join(repo, ".trellis/scripts"), join(staging, "scripts"), {
        recursive: true, filter: path => !path.split(/[\\/]/).includes("__pycache__") && !path.endsWith(".pyc"),
      });
      cpSync(join(repo, ".trellis/workflow.md"), join(staging, "workflow.md"));
      mkdirSync(join(staging, "tasks"));
      mkdirSync(join(staging, "spec"));
      writeFileSync(join(staging, ".developer"), "name=pi-pilot\n");
      writeFileSync(join(staging, ".gitignore"), ".developer\n.runtime/\nworkspace/\n__pycache__/\n*.pyc\n");
      const sources = ["AGENTS.md", "PROJECT_RULES.md", "CLAUDE.md", "README.md", "CONTRIBUTING.md", "docs/INDEX.md", "docs/CONTRIBUTING.md"]
        .filter(file => existsSync(join(root, file)));
      writeFileSync(join(staging, "spec/index.md"), [
        "# 项目约定入口", "", "先按本项目已有优先级读取相关规则；历史记录与现状冲突时说明来源，请使用者判断。",
        ...sources.map(file => `- ${file}`), "",
        "本目录保存本项目确认后的决定、适用范围、来源和实际检查结果。不要复制其他项目的业务结论。",
        "本次需求和阶段放在 .trellis/tasks；原始对话由 Pi 保存。", "",
      ].join("\n"));
      renameSync(staging, trellis);
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }
  projectRoot(root);
  for (const file of ["scripts/task.py", "scripts/common/active_task.py", "scripts/get_context.py", ".developer"]) {
    if (!existsSync(join(trellis, file)) || !statSync(join(trellis, file)).isFile()) {
      throw new Error(`已有 Trellis 配置不完整：缺少 ${file}。已保留原文件，请先修复。`);
    }
  }
  if (!existsSync(join(trellis, "tasks")) || !statSync(join(trellis, "tasks")).isDirectory()) {
    throw new Error("已有 Trellis 缺少 tasks 目录。已保留原配置，请先修复。");
  }
  return root;
}

export function projectLaunch(root) {
  return {
    cwd: root,
    args: [
      join(repo, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
      ...settings.extensions.flatMap(path => ["-e", resolve(repo, ".pi", path)]),
      ...settings.skills.flatMap(path => ["--skill", resolve(repo, ".pi", path)]),
      "--append-system-prompt", `当前业务项目是 ${root}。使用中文，用户直接描述需求即可，由助手管理任务和推进流程。` +
        "先读取当前项目 .trellis/spec/index.md（如有）及其相关来源；遵守项目既有规则的优先级。" +
        "任务、代码检索和检查均使用该项目；扩展和技能所在目录仅提供工具，不是业务项目。" +
        "不把个人规则中的自动推送、部署或发消息视作本次授权。",
    ],
  };
}

async function main() {
  const input = process.argv.slice(2);
  if (input.length === 1 && ["--version", "--help", "-h"].includes(input[0])) {
    console.log(input[0] === "--version"
      ? JSON.parse(readFileSync(join(repo, "node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8")).version
      : "用法：npm run pi（选择项目）\n或 npm run pi:project -- <项目根目录> [--prepare]（只准备，不启动）");
    return;
  }
  const prepareOnly = input.at(-1) === "--prepare";
  if (prepareOnly) input.pop();
  if (input.length > 1 || input[0]?.startsWith("-")) {
    throw new Error("用法：npm run pi 或 npm run pi:project -- <项目根目录> [--prepare]");
  }
  const path = input[0] || await chooseProject(projectChoices(readRecentProjects()));
  if (!path) return;
  for (const command of ["python3", "bash"]) {
    const check = spawnSync(command, ["--version"], { stdio: "ignore" });
    if (check.status !== 0) throw new Error(`缺少可用的 ${command}，请先安装后再启动。`);
  }
  const root = prepareProject(path);
  console.log(`当前项目：${root}\n任务与记忆：${join(root, ".trellis")}`);
  const graph = spawnSync("codegraph", ["--version"], { stdio: "ignore" });
  if (graph.status !== 0 || !existsSync(join(root, ".codegraph"))) {
    console.log("CodeGraph CLI 或项目索引尚未准备好；可以先读文件澄清需求。首次建索引请由使用者确认。");
  }
  if (prepareOnly) return;
  const { cwd, args } = projectLaunch(root);
  const child = spawn(process.execPath, args, { cwd, stdio: "inherit" });
  child.on("spawn", () => {
    try { rememberProject(root); }
    catch (error) { console.error(`项目已打开，但未能保存最近项目：${error.message}`); }
  });
  child.on("error", error => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
