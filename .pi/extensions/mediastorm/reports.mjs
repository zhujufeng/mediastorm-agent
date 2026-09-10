import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { taskList } from "./state.mjs";

const text = { type: "string", minLength: 1, maxLength: 2000 };
const list = (items, maxItems) => ({ type: "array", items, maxItems });
export const assessmentSchema = {
  type: "object", additionalProperties: false,
  properties: {
    overview: text, runInstructions: text, focus: text, preserve: list(text, 10),
    findings: list({ type: "object", additionalProperties: false,
      properties: { title: text, impact: text, evidence: { ...list(text, 5), minItems: 1 } },
      required: ["title", "impact", "evidence"],
    }, 3),
  }, required: ["overview", "runInstructions", "focus", "preserve", "findings"],
};
export const handoffSchema = {
  type: "object", additionalProperties: false,
  properties: {
    summary: text, runInstructions: text, remaining: list(text, 10),
    memories: list({ type: "object", additionalProperties: false,
      properties: { fact: text, source: text }, required: ["fact", "source"],
    }, 8),
  }, required: ["summary", "runInstructions", "remaining", "memories"],
};

function checkedText(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) {
    throw new Error("报告文字不能为空，且每项不能超过 2000 字。");
  }
  return value.trim();
}

function checkedList(value, max, normalize) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`报告列表最多 ${max} 项。`);
  return value.map(normalize);
}

function sourceFile(root, value, checkExists) {
  const source = checkedText(value);
  if (isAbsolute(source) || source.split(/[\\/]/).includes("..")) throw new Error("报告来源必须是当前项目内的相对文件路径。");
  if (checkExists) {
    const file = realpathSync(resolve(root, source));
    const ref = relative(root, file);
    if (isAbsolute(ref) || ref === ".." || ref.startsWith(`..${sep}`) || !statSync(file).isFile()) {
      throw new Error("报告来源必须是当前项目内的文件，不能通过符号链接跨项目。");
    }
  }
  return source;
}

export function assessmentReport(root, report) {
  return {
    overview: checkedText(report?.overview), runInstructions: checkedText(report?.runInstructions),
    focus: checkedText(report?.focus), preserve: checkedList(report?.preserve, 10, checkedText),
    findings: checkedList(report?.findings, 3, item => {
      const evidence = checkedList(item?.evidence, 5, source => sourceFile(root, source, true));
      if (!evidence.length) throw new Error("每个问题至少需要一个项目文件来源。");
      return { title: checkedText(item?.title), impact: checkedText(item?.impact), evidence };
    }),
  };
}

export function handoffReport(root, report, checkExists = true) {
  return {
    summary: checkedText(report?.summary), runInstructions: checkedText(report?.runInstructions),
    remaining: checkedList(report?.remaining, 10, checkedText),
    memories: checkedList(report?.memories, 8, item => ({
      fact: checkedText(item?.fact), source: sourceFile(root, item?.source, checkExists),
    })),
  };
}

export function renderAssessment(report) {
  if (!report) return "尚未记录项目调查。";
  return ["## 项目调查", report.overview, "### 运行方式与验证状态", report.runInstructions,
    "### 发现的问题", ...report.findings.map(item => `- ${item.title}：${item.impact}\n  来源：${item.evidence.join("、")}`),
    "### 本轮范围", report.focus, "### 需要保留的行为", ...report.preserve.map(item => `- ${item}`),
  ].join("\n");
}

export function renderHandoff(report, check) {
  if (!report) return "尚未整理交付报告。";
  return ["## 交付报告", report.summary, "### 运行说明", report.runInstructions,
    "### 实际检查", check ? `命令：${check.command}\n退出码：${check.exitCode}；中断：${check.killed}\n时间：${check.at}` : "尚无检查记录。",
    "### 遗留事项", ...(report.remaining.length ? report.remaining.map(item => `- ${item}`) : ["未记录遗留事项。"]),
    "### 随验收保留的项目经验", ...report.memories.map(item => `- ${item.fact}\n  来源：${item.source}`),
    "经验由助手整理，使用者在验收时确认；后续使用时应对照当前项目文件核实。",
  ].join("\n");
}

export function deliveryDigest(state) {
  return createHash("sha256").update(JSON.stringify([state.approval, state.check, state.handoff, state.summary])).digest("hex");
}

export function projectMemory(root, query = "") {
  const search = query.trim().toLocaleLowerCase();
  // ponytail: scan task files for the pilot; add an index only when project history makes retrieval slow.
  const records = taskList(root, true).filter(item => item.state.phase === "completed" && item.state.handoff)
    .map(item => {
      if (!item.state.acceptedAt || item.state.acceptance !== deliveryDigest(item.state) ||
          item.state.check?.exitCode !== 0 || item.state.check?.killed) {
        throw new Error(`已验收交付记录已变化或缺少验收证据：${item.ref}。请核对原记录。`);
      }
      return { task: item.ref, title: item.title, agent: item.state.agent || "development",
        acceptedAt: item.state.acceptedAt, check: {
          command: item.state.check.command, at: item.state.check.at,
          exitCode: item.state.check.exitCode, killed: item.state.check.killed,
        }, ...handoffReport(root, item.state.handoff, false),
      };
    })
    .filter(item => !search || JSON.stringify(item).toLocaleLowerCase().includes(search))
    .sort((a, b) => (b.acceptedAt || "").localeCompare(a.acceptedAt || ""));
  return { total: records.length, records: records.slice(0, 5),
    note: "仅展示本项目最近五条匹配的已验收交付；来源可能已变化，使用前核对当前文件。可用 query 筛选，原记录保留在任务文件中。" };
}
