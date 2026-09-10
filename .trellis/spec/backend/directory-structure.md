# 目录与资源边界

完整目录职责及命令见 [工程结构与开发流程](../../../docs/development-plan.md)。

- desktop 管理 Electron 与 Pi worker；.pi/extensions/mediastorm 管理任务、角色与项目记忆。两种入口复用 scripts/pi-project.mjs，不复制业务逻辑。
- 上游 Trellis 生成代码和许可证保留；.agents/.codex 用于开发平台，不进入桌面包。不要添加与现有原生技术栈无关的空目录或模板规范。
- 业务仓库放在平台外，使用者主动打开。CLI 不扫描试点目录；测试仅用系统临时项目。
- 本地账户在应用 userData；任务与记忆在目标项目；平台开发记录不提交 Git。依赖、运行时、生成物分别在 node_modules、runtime、dist。
- 打包使用 allowlist；独立 staging 在系统临时目录创建，成功或失败均 finally 清理。下载缓存使用 .local/desktop-downloads，CLI 历史使用 .local/projects.json。
- npm run clean 只删除 dist 与下载缓存；不得删账户、CLI 历史或项目记忆。
- npm run check:repository 检查待提交目录、生成物/凭据文件名、JS 语法和锁文件。新增顶层入口需明确职责并同步清单。
