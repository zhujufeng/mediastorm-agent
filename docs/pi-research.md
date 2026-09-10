# Pi 集成依据

本项目使用 Pi **0.85.1 公共 SDK**，通过扩展与技能定制 Agent，不维护 Pi 内核分支。以下记录实际选择及版本依据；现行工程入口见 [开发流程](development-plan.md)，使用方法见 [桌面说明](desktop-pilot.md) 和 [CLI 说明](pi-pilot.md)。

## 已采用的边界

| 内容 | 归属 |
| --- | --- |
| 模型调用、工具循环、会话与 OAuth | Pi SDK |
| 角色职责与实际提示词 | `.pi/extensions/mediastorm/agents.mjs` |
| 需求澄清、方案确认、检查、验收和项目经验 | MediaStorm 工作流，复用 Trellis 项目文件 |
| 桌面、项目选择、加密账户、插件状态和安装更新 | Electron 主进程、隔离页面与 Pi worker |
| 简洁代码方法 | Ponytail |
| 符号与调用关系 | CodeGraph 及 Pi 适配器 |

技能承载工作方法；扩展注册工具与事件。Pi Package 分发资源，但不会自动提供桌面安装、权限隔离或用户界面。当前资源随应用版本发布，四个角色共用显式配置的五个插件，不自动发现个人插件。

## 固定版本与来源

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `@earendil-works/pi-coding-agent`、`pi-ai` | 0.85.1 | 会话、扩展、模型与凭据 API |
| Trellis 生成资源 | 0.6.6 | 工作流、项目上下文和任务文件 |
| `@dietrichgebert/ponytail` | 4.9.0 | 减少不必要的代码和抽象 |
| `@vndv/pi-codegraph` | 0.1.10 | Pi 工具适配 |
| `@colbymchenry/codegraph` | 0.9.4 | 本机结构索引 |

依赖与桌面框架的完整版本以 `package.json`、`package-lock.json` 为准；便携 Node/Python 的版本和 SHA-256 在 `scripts/prepare-desktop-runtime.mjs` 固定。

版本依据：[Pi 0.85.1 发行说明](https://github.com/earendil-works/pi/releases/tag/v0.85.1)、[SDK](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)、[Extensions](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md)、[Packages](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md)。不使用该版本撤回发布的实验 client/plugin/server 入口。

## SDK 接入顺序

1. `ModelRuntime.create` 配置模型与凭据，关闭自动模型目录网络发现。
2. `DefaultResourceLoader.reload` 按当前项目和显式资源清单加载扩展与技能。
3. `createAgentSession` 指定运行时、会话存储、项目和可用工具。
4. `session.subscribe` 接收事件，`session.bindExtensions` 绑定扩展 UI 桥接。
5. `session.prompt` 执行请求；项目切换与退出时取消、释放旧会话。

初始化参考 [check-pi.mjs](../scripts/check-pi.mjs)，实际桌面入口见 [worker.mjs](../desktop/worker.mjs)。初始化检查使用内存状态、不调用模型；工作流与模型接线另由 `check-workflow.mjs`、`check-desktop.mjs` 验证。

## 项目记忆与执行边界

任务需求保存在 `prd.md`，复杂任务补 `design.md`、`implement.md`；已验收交付与检查记录在 `progress.json`，由验收指纹校验。长期约定放在目标项目 `.trellis/spec/`，原始对话由 Pi 会话管理。按真实项目路径隔离，不仅按目录名称区分；历史检查不会被解释为本次重新运行。

Pi 按本机用户权限执行。项目目录、提示词、确认门槛和工具清单不构成操作系统沙箱；Electron 页面隔离也不隔离业务命令。详见 [Pi Security](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/security.md)。实际检查结果和使用者验收共同决定交付，模型自称完成不能替代它们。

## 取舍与参考

- 逐题澄清使用 Trellis 与本项目工作流，不重复引入第二套 spec/访谈状态。
- 项目记忆复用任务与规范，不再维护第二个独立记忆仓库。
- CodeGraph 结构检索与项目经验检索各自承担不同职责；无索引时明确告知，首次索引由使用者确认。
- 桌面参考 [pi-agent-desktop](https://github.com/abcwyc/pi-agent-desktop)、[Paseo](https://paseo.sh/pi) 的对话与模型入口；能力库参考 [AO 专家库](https://ao.aiolaola.com/experts) 的职责和提示词可见性。角色内容由本项目编写。

## 上游许可

Pi 的 [MIT 许可](https://github.com/earendil-works/pi/blob/v0.85.1/LICENSE) 与 Trellis 的许可分别处理。仓库保留 [Trellis 许可](../.trellis/LICENSE) 及实际分发的生成源码，安装包保留各运行时和依赖许可证。完整产品的许可判断不能仅由 Pi 的许可推断。
