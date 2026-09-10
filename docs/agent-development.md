# 开发自己的 Agent 与插件

同事使用桌面的“Agent 与插件”选择角色、查看提示词和当前项目的工具；开发者在本仓库修改角色或 Pi 扩展，检查后随下一个安装包发布。当前不是在线插件商店，用户项目里的任意插件不会自动运行。

## 角色：把你的方法写成可复用能力

角色注册在 `.pi/extensions/mediastorm/agents.mjs`。目前有项目接手、需求开发、故障修复、代码审查。每个角色包含：

- `name`、`shortName`、`description`：用户能识别的名称与适用问题。
- `steps`、`deliverables`：过程和可验收交付。
- `prompt`：职责、证据要求、边界和处理方式；不编造专家经历或已获得的权限。
- `skill`：工作法 Markdown 的实际路径。新增专门工作法放在 `.pi/skills/<name>/SKILL.md`，已有技能目录会加载它。
- `icon`：使用桌面已有图标名，如 `folder`、`code`、`settings`、`check`。

复制一个已有角色，给它新的稳定 ID 和工作方法即可。任务工具的参数枚举和桌面目录都从同一个注册表生成，无需另写一个界面。已存在任务使用保存的角色 ID，不能随意删除或更名；先完成兼容迁移。

`agentInstructions()` 生成界面可查看的角色提示词，并由 MediaStorm 的 `before_agent_start` 加入实际模型上下文。桌面选择是新任务偏好，保存到本机；恢复已有任务时，任务记录的角色优先。公共的项目规范、确认与检查、对话压缩和项目记忆机制仍然生效。角色切换不会批准方案或修改已确认范围。

代码审查默认只读：使用 `storm_changes`、读取文件和 CodeGraph 分析；用户要求修复后再进入实施工作流。其余开发角色也须经过共同的方案和验收门槛。

## 插件：给角色增加真实工具

一个已经投入使用的自研例子是 `.pi/extensions/project-changes.mjs`：

1. 默认导出 Pi extension 函数，用 `pi.registerTool()` 注册 `storm_changes`。
2. 工具只读取 `ctx.cwd` 的 Git 状态和差异，参数不接受路径、命令或 URL。
3. 同一个 `projectChanges()` 被桌面的“文件改动”复用；不维护第二份 Git 实现。
4. `.pi/settings.json` 的 `extensions` 显式注册入口；`stormPlugins` 中填名称、说明，包依赖版本取 `package.json`，本地自研扩展使用应用版本。
5. 公共工作流明确将这个固定只读工具加入 `readableTools`。任何新工具默认按可能修改项目处理，不得为方便而把 Bash 或任意外部插件整体加入只读名单。

开发新插件可从这个实际文件开始，调用 Pi 0.85.1 的公开 SDK。入口放在 `.pi/extensions/`，随 allowlist 打包；新增 npm 依赖要固定版本并保留许可。若需要 UI 确认，复用 `ctx.ui.confirm/input/select`，不要调用仅支持终端的 `ctx.ui.custom`。

能力库的“已加载”来自 SDK loader 结果，工具名称来自该扩展的注册表与当前 session 的实际可调用工具交集。Trellis 的终端子 Agent 工具在桌面不可用，不会出现在可调用列表；Ponytail 主要通过上下文和事件生效，不因没有工具名称而被误报未加载。CodeGraph 索引是否存在与插件加载分开显示，存在不代表完整或健康。

当前四个角色共用五个插件。角色提示词决定工作重点，不提供插件权限隔离；按角色装配不同扩展应同时解决旧任务恢复与插件切换，不能只改界面上的勾选状态。

## 检查与发布

```sh
npm run check
npm run check:desktop
npm run desktop
```

现有回归检查角色提示词确实进入 SDK 请求、旧任务角色保持、只读改动工具无需实施批准、插件实际加载与工具可见性。新增工具还需覆盖自己的输入边界与结果，实际试用一项代表性任务。桌面目录出现了一个角色，不代表其任务质量已经验收。

修改应用版本并提交、推送后，按 [发布说明](releasing.md) 构建并发布新的安装包。同事下载应用，不用自行复制技能和扩展文件。

## 参考与取舍

- [Paseo Pi](https://paseo.sh/pi)：参考对话附近的模型控制、项目与工作状态，以及可发现的插件入口；没有移植其远程守护进程或移动端系统。
- [AO 专家库](https://ao.aiolaola.com/experts)：阅读了代码审查员角色，借鉴职责、规则、工作步骤、结果格式的组织方式。本项目角色提示词按实际工具和确认流程重新编写，没有照搬其角色履历或成功指标。
- API 以当前安装的 Pi 0.85.1 `Extension`、`registerTool`、`before_agent_start`、`ModelRuntime` 为准。
