# MediaStorm Agent

基于 [Pi](https://pi.dev) 的桌面 Agent 平台。选择项目，直接说“帮我优化当前项目”，助手会调查问题、逐步澄清需求，确认方案后完成实现与检查，交付时由你验收。

当前为 **0.4.0 Mac 桌面预览版**，支持 Apple Silicon（M 系列）Mac / macOS 13.5+。Windows 与 Intel Mac 尚未构建验证。

## 下载安装

**[下载 Mac 安装包（M 系列）](https://github.com/zhujufeng/mediastorm-agent/releases/download/v0.4.0/MediaStorm-Agent-0.4.0-mac-arm64.dmg)** · [版本说明与校验文件](https://github.com/zhujufeng/mediastorm-agent/releases/tag/v0.4.0)

打开 DMG，将应用拖入 Applications，然后从应用程序启动。无需安装 Node、npm 或 Pi。

预览版尚未完成 Apple 签名公证，首次打开可能被 macOS 拦截。确认来自本仓库后，按 [Apple 的打开说明](https://support.apple.com/zh-cn/102445) 操作。当前通过下载新版覆盖应用更新，正式签名版的应用内升级仍待验证。

## 已有能力

- **项目接手与优化助手**：调查已有 AI 开发项目，提供文件依据、运行说明、改进建议与交付报告。
- **通用开发助手**：完成明确的新功能和修复需求。
- **故障修复与代码审查助手**：提供专门的诊断和审查方法，可在能力库查看职责、步骤与实际提示词。四个角色共用五个基础插件。
- **可见的任务流程**：需求、方案、实现、检查和验收阶段持续展示，关键节点由使用者确认。
- **项目记忆**：已验收任务保留决定、检查结果和来源；重新打开项目可以继续工作、检索经验。
- **模型连接**：订阅登录与兼容中转站；输入框旁直接搜索并切换已连接模型，中转站模型可保存后反复选择。
- **插件可见**：展示真实加载状态、当前可调用的工具及代码索引状态；自研“项目改动”插件提供只读 Git 差异。
- **桌面操作**：项目选择、流式对话、Markdown、文件差异、历史对话与重启恢复。

Pi SDK 固定为 0.85.1，工作流复用 Trellis 0.6.6，配合 Ponytail 4.9.0 控制不必要的复杂度、CodeGraph 0.9.4 检索代码结构。

## 从源码启动桌面版

开发环境需要 Node.js ≥ 22.19.0 和 Git；桌面构建当前要求 Apple Silicon Mac。

```sh
git clone https://github.com/zhujufeng/mediastorm-agent.git
cd mediastorm-agent
npm ci
npm run desktop:runtime
npm run desktop
```

首次准备会下载固定版本的 Node、Python 和 CodeGraph 运行时并校验 SHA-256。打开应用后：

1. 点击“连接模型”，登录订阅账户，或保存并测试中转站配置。
2. 点击“打开项目”，选择本地 Git 仓库根目录。
3. 直接描述需求，例如“帮我优化当前项目，先看看有什么问题”。
4. 回答必要问题、确认方案；检查完成后查看差异并验收。

模型凭据在本机加密保存，任务和经验保存在所选项目的 `.trellis/`。业务项目自身的依赖和服务需要按该项目说明准备。

## 构建 Mac 安装包

```sh
npm run check
npm run check:desktop
npm run desktop:package
npm run check:mac-package
```

生成 `dist/MediaStorm-Agent-0.4.0-mac-arm64.dmg`，打开后将应用拖入 Applications，以后可从启动台直接启动。安装包和运行时由源码生成，不存入 Git。

**这是预览版本。** 已验证 OpenAI 浏览器授权、实际模型请求和本机桌面操作；其他账户、真实中转站业务任务及另一台 Mac 安装仍需验收。当前只有本机 ad-hoc 签名，尚未完成 Developer ID 签名和 Apple 公证。详细操作及验证范围见[桌面试用说明](docs/desktop-pilot.md)。

## CLI 与项目开发

本机安装 Node.js、Python ≥ 3.9 和 Bash 后，也可以使用终端入口：

```sh
npm run pi
# 或指定自己的 Git 项目根目录
npm run pi:project -- /path/to/your-project
```

Mac 可双击本目录的 `启动助手.command` 打开同一个项目菜单。代码结构检索需要可用的 CodeGraph CLI 和项目索引；完整说明见 [CLI 使用说明](docs/pi-pilot.md)。

开发本平台时，先初始化自己的 Trellis 身份，再让开发助手读取 [AGENTS.md](AGENTS.md)：

```sh
python3 .trellis/scripts/init_developer.py your-name
python3 .trellis/scripts/get_context.py
```

公开仓库包含源码、锁定依赖、工作流、工程规范、检查和打包脚本。安装包位于 GitHub Releases。登录凭据、同事的私有项目副本、本机任务历史和开发日志留在本地。

## 文档与上游

- [Pi 定制调研](docs/pi-research.md)、[工作流设计](docs/pi-workflow-proposal.md)、[开发计划](docs/development-plan.md)
- [后端约定](.trellis/spec/backend/index.md)、[前端约定](.trellis/spec/frontend/index.md)
- 上游：[Pi](https://github.com/earendil-works/pi)、[Trellis](https://github.com/mindfold-ai/Trellis)、[Ponytail](https://pi.dev/packages/@dietrichgebert/ponytail)、[CodeGraph](https://github.com/colbymchenry/codegraph)
- [开发自己的 Agent 与插件](docs/agent-development.md)
- 桌面交互参考：[pi-agent-desktop](https://github.com/abcwyc/pi-agent-desktop)

Trellis 随仓库保留的许可见 [.trellis/LICENSE](.trellis/LICENSE)；其他依赖的许可保留在各包中。

软件内更新与维护者发布流程见[Mac 安装与更新发布](docs/releasing.md)。当前试用包尚未完成签名公证，完整升级链路仍待验证。
