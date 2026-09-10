import { fileURLToPath } from "node:url";

export const agents = {
  "project-takeover": {
    name: "项目接手与优化助手",
    description: "调查已有项目，确定本轮改进，交付运行说明、实际检查和维护经验。",
    skill: fileURLToPath(new URL("../../skills/project-takeover/SKILL.md", import.meta.url)),
  },
  development: {
    name: "通用开发助手",
    description: "完成已明确的新功能或修复需求，沿用需求确认、实现和检查流程。",
    skill: fileURLToPath(new URL("../../skills/mediastorm-workflow/SKILL.md", import.meta.url)),
  },
};

export function agentProfile(id = "development") {
  if (!Object.hasOwn(agents, id)) throw new Error(`未知 Agent：${id}。请查看 storm_task agents。`);
  return agents[id];
}
