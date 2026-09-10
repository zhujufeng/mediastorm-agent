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

## 项目上下文

- 产品：基于 Pi 的公司 Agent 平台，桌面为主要入口。当前 Mac arm64 预览使用 Electron 与原生 HTML/CSS/JS；Windows 和 Intel Mac 后续单独验证。
- 先读 README.md、docs/development-plan.md、docs/pi-research.md。桌面契约在 .trellis/spec/backend/desktop-runtime.md，任务与记忆契约在 .trellis/spec/backend/pi-workflow.md。
- 四个 Agent 共用五个显式插件。角色定义、实际提示词及 UI 共用同一来源；项目准备、任务、检查和已验收经验由 CLI 与桌面复用。
- Pi 固定 0.85.1，只使用版本对应的公开 SDK。外部集成先核对实际 API 和官方依据。
- 日常完整检查：npm run check:all。check:repository 验证目录边界、JavaScript 语法及锁文件；桌面回归使用模拟账户和回环模型。打包改动还需构建并运行 check:mac-package。没有独立 lint 或 TypeScript 类型检查。
- 业务仓库必须位于平台之外；不得引入同事副本、参考项目克隆、个人路径或真实数据作为测试依赖。测试和构建使用独立临时目录并清理；可重建产物放 dist，运行时放 runtime，下载缓存和 CLI 最近项目放 .local。npm run clean 只清理产物和下载缓存。
- 账户在 Electron userData，任务与记忆在目标项目 .trellis。源码不携带凭据、个人会话、开发日志或历史任务。现有记录和账户不会随清理或升级删除。
- .trellis/spec 只保留现行可执行约定，不保留空模板或将本项目约定宣称为已审计的公司标准。上游生成的运行代码与许可证保留，更新 Trellis 时重新检查集成和规范。
- GitHub Actions 在 Mac arm64 干净检出后安装依赖、准备运行时、运行检查和独立打包；发布另按 docs/releasing.md，不由检查工作流自动发布。
- 已发布 0.4.0 预览；Developer ID、公证、另一台 Mac 完整业务任务及实际自动升级仍待验收。公开 DMG 不等于这些验证完成。
- 面向使用者的说明和产品文档使用简洁中文。初始化开发身份：python3 .trellis/scripts/init_developer.py <name>。
