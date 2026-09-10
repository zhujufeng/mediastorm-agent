# Pi 二次开发调研

研究日期：2026-09-09。以正式版本 **v0.85.1** 为准；本地已经安装并运行接入检查。本文区分“官方提供”“本地已验证”和“建议后续开发”。

## 1. 先把结论说清楚

适合先使用 **Pi SDK + 公司工具和规则 + 简单界面**。SDK 可以理解为“把 Pi 放进自己应用的一组开发接口”。

公司需要开发的重点，是让员工按清晰流程完成任务，以及让代码确实经过检查。无需一开始维护一套修改过的 Pi 内核，也无需重新实现模型对话、工具调用和会话记录。

首个任务可以用数据采集，但产品目标是公司 AI 开发的体系化、工程化，不能把范围锁成一个采集工具。

推进顺序已于 2026-09-09 确认：先使用 Pi CLI 与现有 Trellis 资源跑通真实任务，再根据具体需要增加扩展或 SDK 应用入口。上面的 SDK 方案是后续应用集成建议，不要求第一轮就开发自有界面。

## 2. 开源、版本与许可

Pi 采用 MIT 许可，允许修改、内部使用和商业分发；分发副本或实质性部分时需要保留版权及许可声明。公司修改不因 Pi 的 MIT 条款而被要求公开。

旧 badlogic/pi-mono 地址已转向 earendil-works/pi。本次官方最新正式版本为 v0.85.1，发布于 2026-09-05；本项目固定该版本，不跟随 main 自动更新。

来源：[MIT License](https://github.com/earendil-works/pi/blob/v0.85.1/LICENSE)、[正式发行](https://github.com/earendil-works/pi/releases/tag/v0.85.1)、[包及 Node 要求](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/package.json)。

Trellis 是独立项目，本机 0.6.6 包声明 AGPL-3.0-only；Pi 的 MIT 结论不能套用到 Trellis 代码。当前使用 Trellis 管理本仓库开发，未把 trellis-core 加入应用依赖。未来若打包其生成的脚本或扩展，应按实际分发内容处理对应许可；本文没有认定完整公司产品已完成许可审查。[Trellis 官方仓库与许可](https://github.com/mindfold-ai/Trellis)。

## 3. Pi 能提供什么，我们还要做什么

| 需要的能力 | Pi 提供的基础 | 公司应用的工作 |
| --- | --- | --- |
| 理解需求、讨论方案 | 模型调用与对话 | 决定该问哪些业务问题，保存确认过的需求 |
| 读项目、改代码、运行命令 | 内置工具及 Agent 循环 | 选定项目和实际执行环境，控制可用能力 |
| 使用公司方法 | 技能、提示模板、扩展加载 | 整理真实范例、适用条件和验证办法 |
| 显示正在做什么 | 消息与工具事件 | 用同事能理解的语言展示进度、改动和失败 |
| 保存对话、恢复工作 | 会话持久化及恢复接口 | 把会话对应到需求、项目、产物和任务状态 |
| 判断可否交付 | 可以调用测试与其他检查工具 | 以实际检查和产物为依据，保留人工审查 |

Pi 自身是可定制的编程 Agent，不是现成的公司多人协作平台。账号、项目访问、员工操作界面和交付规则仍需要应用实现。[产品入口](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/README.md)。

## 4. 怎样选择二次开发方式

| 方式 | 简单解释 | 当前建议 |
| --- | --- | --- |
| Skills / Prompt Templates | 给 AI 方法和任务提示 | 保存短方法、范例与检查说明 |
| Extensions | 为 Pi 增加实际可调用的工具和事件处理 | 连接已有脚本、公司能力、检查程序 |
| Pi Package | 把技能、扩展、提示统一分发 | 多项目需要一致版本时再提取内部包 |
| SDK | 把 Pi 放进自己的应用 | 公司产品的首选接入方式 |
| stdio RPC | 另一个程序通过进程输入输出控制 Pi | 主应用不是 Node 时评估 |
| fork 核心源码 | 自己维护改过的 Pi | 公开接口确实不够用时再考虑 |

官方明确提供 SDK 嵌入和无须 fork 的扩展方式。[SDK](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)、[Extensions](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md)。

Package 支持 npm、Git 和本地路径；Git 可以使用公司已有的私有仓库认证，并固定版本。它是研发分发能力的方式，不要求业务同事自己管理包。[Packages](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md)。

RPC 是 stdin/stdout 上的 JSONL 协议；它不是 Web 服务，部分终端 UI 能力在 RPC 下有限制。若使用 RPC，还需要自己的进程管理和用户界面。[RPC](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/rpc.md)。

## 5. 本项目采用哪些包

当前只声明两个直接依赖，并固定为 0.85.1：

- @earendil-works/pi-coding-agent：SDK、资源加载器、会话与扩展。
- @earendil-works/pi-ai：检查脚本直接使用它的内存凭证存储，因此显式声明依赖。

运行要求 Node ≥ 22.19.0。当前只有一个原生 ESM 检查脚本，没有增加 Web 框架、数据库、构建器或测试框架。应用代码真正开始开发时，再按需要引入 TypeScript 编译检查。

不使用 v0.85.1 中撤回发布的实验 client/plugin/server 入口。官方说明这些内容回到 source-only，稳定接入继续使用包根 SDK 或 stdio RPC。[发行说明](https://github.com/earendil-works/pi/releases/tag/v0.85.1)。

## 6. 实际 SDK 接入顺序

一个应用中的最小会话流程：

1. 创建 ModelRuntime，明确使用哪个模型、怎样取得凭证。
2. 创建 DefaultResourceLoader，指定项目目录 cwd、应用配置目录 agentDir 和资源范围。
3. 调用 loader.reload()，加载所需资源。
4. 调用 createAgentSession，传入资源加载器、会话存储和允许使用的工具。
5. 订阅 session.subscribe 事件；使用扩展时调用 session.bindExtensions。
6. 调用 session.prompt，展示消息和工具执行结果。
7. 结束后取消订阅并调用 session.dispose。

本地可运行参考是 [check-pi.mjs](../scripts/check-pi.mjs)。它只走初始化和扩展绑定步骤，刻意不调用 prompt；不要把它误当业务产品的入口。

精确 API 来源：[公开导出](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/index.ts)、[SDK 参数](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/sdk.ts)、[资源加载参数](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/resource-loader.ts)、[扩展绑定](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts)。

### 已核实的接口细节

- 部分 SDK 文档示例省略了目录，但当前 DefaultResourceLoader 的类型要求同时传入 cwd 和 agentDir。
- tools 接受名称字符串数组；自定义工具定义放在 customTools。明确指定白名单时，要包含想启用的自定义工具名。
- tools: [] 会把工具从会话的配置列表中排除。session.getAllTools() 也受这个限制；要检查扩展是否注册了工具，应在资源加载结果中检查注册信息。
- 创建会话与绑定扩展是两步；启动事件 session_start 由 bindExtensions 触发。
- noExtensions 等选项禁用默认发现，显式追加的路径和内联扩展仍能加载。应用可以据此只加载明确选择的资源。
- extensionsOverride 在扩展加载后工作，不能用它阻止不受信任的扩展代码先执行。

上述具体行为已经对照固定版本源码；“扩展注册”和“会话工具白名单”的区别也在本地检查中得到验证。

## 7. 真实模型、界面和会话要怎样接

真实模型由 ModelRuntime 管理，支持应用自己的凭证存储和模型配置。选择到模型条目，不代表认证有效。不要在公司应用中照搬默认配置而意外共用开发者的个人账号。[ModelRuntime](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/model-runtime.ts)。

通过 session.subscribe 接收文本增量、工具开始、工具结果、重试和压缩等事件。界面优先展示员工需要的信息，例如“正在检查报表计算”“发现两项错误”，并允许查看具体命令和结果。Agent 结束一次回答，不等于工程验收通过。[事件与对话生命周期](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)。

Pi 会话采用 JSONL 树结构，支持恢复和分支。压缩是有损的，完整记录仍在会话文件中；这不能替代明确保存的需求、代码版本和交付状态。[Session Format](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/session-format.md)。

新建、切换、恢复、fork 和导入会话属于 AgentSessionRuntime。更换 session 后，事件订阅和扩展绑定也要跟着更新。首个单任务试点不需要提前建设复杂会话平台。[会话运行时](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session-runtime.ts)。

## 8. 你的采集方法怎样成为公司能力

每个成熟方法先整理成三个部分：

1. **怎样判断**：适合什么需求，何时使用 HTTP、浏览器插件或 RPA，有哪些不适用情况。
2. **怎样执行**：已有程序、清晰参数、运行条件、结果位置和维护者。
3. **怎样验收**：字段是否完整，日期范围是否覆盖，重跑会不会重复，失败怎样识别。

方法和范例可以放进技能或项目规范；实际程序通过扩展工具连接。已有 Python 程序可以保留，Pi 扩展能够执行子进程并返回结构化结果、进度及错误，不必全部改写成 JavaScript。[扩展工具接口](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md)。

本项目的设计建议：大量采集数据保存在文件或目标存储，给模型样本、统计和异常摘要；重复任务使用验证过的程序运行。Agent 负责需求、开发和变化处理。

浏览器插件与 Pi Extension 是两种不同扩展。依赖员工浏览器登录或桌面 RPA 的能力，需要本机连接或合适执行环境；云端聊天页不会自动获得本机登录态。具体连接取决于首个任务。

## 9. Trellis 与公司产品怎样配合

已执行：

    trellis init --codex --pi --user mediastorm --yes --no-monorepo

Trellis 在本仓库生成规范、任务、工作记录，以及 Codex/Pi 的开发入口；Pi 侧还生成 trellis_subagent 扩展工具。这些可以作为开发本产品的现成基础，不必重写一套任务目录和记录工具。

但初始化配置本身不会建立公司可复用资产，也不会保证 AI 严格按流程行事。对业务同事的应用，要把重要状态和检查结果放在程序中；不宜直接把长篇开发工作流原样展示给他们。

目前已验证“Pi 能加载 Trellis 扩展并注册工具”，没有验证子 Agent 实际执行、完整任务流程或 Codex 新会话 Hook 自动注入。[Trellis 入门与平台初始化](https://docs.trytrellis.app/start/install-and-first-task)。

## 10. 执行与交付的边界

Pi 按启动它的本机用户权限运行，项目信任控制的是资源加载；它没有内置安全沙箱。cwd、提示词和工具名称白名单都不能充当操作系统文件隔离。实际业务执行需要选择适合的项目目录、账号和隔离环境。[Security](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/security.md)。

公司产品应以检查程序退出状态和实际产物判断交付，不能只接受模型自称“完成”。第一版保留开发者审查，不自动发布生产环境。

## 11. 本次验证记录

2026-09-09，macOS，Node v24.14.1，Python 3.14.6，Trellis 0.6.6。

| 检查 | 结果 |
| --- | --- |
| 安装并锁定 Pi 两个直接依赖 | 0.85.1 |
| npm run pi -- --version | 0.85.1 |
| npm run check | 通过 |
| 实际 Trellis 扩展注册 trellis_subagent | 通过 |
| 扩展加载与启动无错误；启动探针收到一次 session_start | 通过 |
| 会话使用内存；配置和激活的工具列表都为空 | 通过 |
| 真实模型对话、子 Agent、业务任务、质量提升 | 尚未验证 |

初始化检查使用临时配置目录和内存凭证，不读取个人 Pi 凭证文件、不发送模型请求，最后清理临时目录。安装依赖需要联网；已经安装后的 npm run check 不需要模型服务。

下一步实施顺序见 [development-plan.md](development-plan.md)。

## 12. 进一步明确：先把个人方法变成同事能复用的能力

2026-09-09 补充阅读 pi.dev 的 Using Pi、Skills、Prompt Templates、Extensions、Packages、SDK、RPC、Settings 与 Security，并对照本地 0.85.1 随包文档。用户进一步确认：开发同事与业务同事都要覆盖，当前优先把自己的方法变成可复用能力。以下是据此提出的建议，尚未实现，也不代表已选定试点。

### 怎样选择定制入口

| 内容 | Pi 中的承载方式 | 本项目建议 |
| --- | --- | --- |
| 每个任务都适用的简短约定 | AGENTS.md；必要时 APPEND_SYSTEM.md | 记录项目入口、检查命令、交付要求，详细方法按需读取 |
| 某类任务的判断方法和范例 | Skill，附参考资料与脚本 | 先选一个真实案例提炼；复用已有技能前核对工具和环境依赖 |
| 同事容易发现和启动的入口 | Prompt Template，或扩展命令 | 提示模板适合组织提问；扩展命令适合直接运行确定的检查 |
| 已有程序的可靠调用 | 先让 Skill 指向现成 CLI；需要时用 Extension 注册工具 | 反复出现参数错误、需要结构化结果或进度时再封装 |
| 多人安装同一套方法 | Pi Package | 验证后通过公司 Git 或 npm 分发，固定经过验证的版本 |
| 面向业务同事的操作界面 | SDK；跨进程集成可选 RPC | 复用方法与脚本，按实际使用困难设计界面 |

官方依据：[上下文文件](https://pi.dev/docs/latest/usage#context-files)、[Skills](https://pi.dev/docs/latest/skills)、[提示模板](https://pi.dev/docs/latest/prompt-templates)、[Extensions](https://pi.dev/docs/latest/extensions)、[Packages](https://pi.dev/docs/latest/packages)、[SDK](https://pi.dev/docs/latest/sdk)、[RPC](https://pi.dev/docs/latest/rpc)。

Pi 可发现共享的 `.agents/skills`，也能配置其他工具的技能目录。这解决的是加载路径；技能中依赖的专用工具、环境变量和登录方式仍要适配。不要直接把个人所有技能作为公司默认配置。

### 一个方法首先要说明什么

从一个已经做成的任务提炼六项内容：

1. **适用条件**：输入是什么，哪些相似需求可以复用，哪些需求超出范围。
2. **必要问题**：只有用户能决定的业务要求，如字段口径、日期范围和更新频率。
3. **选择依据**：为何使用现成程序，什么时候修改它，什么情况需要换方案。
4. **执行资源**：真实项目、脚本入口、运行环境、参数、配置来源和输出位置。
5. **失败处理**：怎样区分没有数据、登录失效、程序错误和未覆盖的需求。
6. **验收与接手**：用什么样例判断正确，怎样重跑，谁负责维护。

以“给现有采集器增加一个字段”为候选例子：先确认字段定义和样例，定位已有采集方法，在工作副本里修改，运行项目检查，再检查新增字段及原有输出，最后交付差异、运行说明和检查记录。报表与内部工具开发也可以按此提炼。

### 说明、执行与验收要分别落地

Pi 启动时主要把 Skill 的名称与描述放进上下文，正文按需读取；官方明确提醒模型有时会漏读。试点可以显式使用 `/skill:方法名`。方法名是占位符，应替换成实际注册名称。入口明确之后，仍需观察执行是否符合方法。[Skill 加载行为](https://pi.dev/docs/latest/skills#how-skills-work)。

Prompt Template 展开为提示文字；Extension 的 `registerCommand` 执行程序，`registerTool` 提供模型可调用的工具。若需要稳定的交付检查，建议用扩展命令直接运行项目已有检查，保存命令退出状态与实际产物，再由模型解释失败。检查结果应对应交付时的代码和输入，修改后重新检查。这些是需要本项目实现的行为，安装 Pi 不会自动获得。

Pi 的 `agent_end` 之后仍可能继续重试或处理排队消息；`agent_settled` 表示自动运行已停稳。二者都不能证明业务验收通过。[运行事件](https://pi.dev/docs/latest/extensions#agent-events)。

工具限制和事件拦截可以辅助流程管理；多人服务所需的执行隔离仍由操作系统、容器或远端环境承担。[执行边界](https://pi.dev/docs/latest/security#no-built-in-sandbox)。

### 第一轮怎么验证有用

建议选一个真实的小任务，先由本人记录关键判断，再让另一位开发同事在相同模型与执行环境下使用整理后的方法完成相似任务。保留一个正常例子、一个缺少必要输入的例子和一个执行失败的例子。

记录四项结果：是否完成且通过检查、需要本人补充几次、总耗时与模型费用、另一人能否重跑及修改。样例少时用于发现问题，不据此宣称已经提高全公司效率。

按观察到的问题补能力：漏读方法就改入口；不会选方案就补判断依据；脚本调用不稳就加工具封装；检查不到问题就补验收；主要卡在安装和操作时再完善分发与界面。

开发同事先用 Pi CLI 修正方法。业务同事后续使用相同方法与执行程序，通过中文提问、样例预览、产物和错误说明完成工作；终端组件需按目标界面重新实现。当前优先复用已有 Trellis 资源与脚本，选定案例后再决定最小新增内容。
