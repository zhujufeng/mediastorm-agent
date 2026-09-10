# Pi 工作流契约

## 1. 范围

`.pi/extensions/mediastorm/` 是自有扩展；Trellis 生成文件保持上游版本。Pi 0.85.1、Ponytail 4.9.0、vndv CodeGraph 0.1.10 通过锁文件固定。`npm run pi` 限定技能来源，避免默认扫描 `.agents` 与个人技能造成冲突。

## 2. 接口

- 自然语言是主要入口；模型根据工作请求调用 `storm_task({action, title?, agent?, query?})`，action=new/resume/spec/status/approve/accept/agents/memory。普通咨询不建任务。agent 仅用于 new，query 用于 memory。
- `/storm [new <标题>|resume|spec|status|approve|accept|agents|memory <主题>]`：备用入口，与工具复用同一执行逻辑。命令新建提供助手选择。
- `storm_assessment({overview, runInstructions, findings, focus, preserve})`：澄清阶段保存调查，最多三个问题，每个问题带至少一个本项目文件依据；接手任务批准前必需。
- `storm_handoff({summary, runInstructions, remaining, memories})`：实际检查通过后保存交付，经验包含 fact/source；接手任务验收前必需。更新报告不使代码检查失效。
- `storm_progress({phase, summary, next, checkCommand?})`：Agent 写进度，不能写 completed。
- `storm_check({})`：执行已确认的检查命令，成功返回实际输出，失败抛错。
- `loadProgress(task)`：唯一进度读取入口，校验版本、字段和确认指纹。

## 3. 数据与环境

`progress.json` 的 version=1，phase 为 clarify/awaiting_approval/implementing/checking/awaiting_acceptance/completed；summary、next、checkCommand 为字符串。agent 为 agents.mjs 中的稳定 ID（project-takeover/development/bug-fix/code-review）；新建默认 project-takeover，无 agent 的旧任务视作 development。配置和技能路径由 agents.mjs 统一定义。

approval 是 prd.md、design.md 与 checkCommand 的 SHA-256；新任务额外包含 agent 和 assessment。没有这两个字段的旧任务保持原指纹。implement.md 是可持续更新的执行清单，不纳入批准指纹。

assessment、handoff 直接存储在 progress.json，通过 reports.mjs 校验和渲染，不再同步另一份报告。输入文件来源必须为本项目真实文件的相对路径，禁止越界和符号链接跨项目；工具只检查来源路径，不验证结论语义。验收时保存 acceptedAt 与 acceptance（批准指纹、检查、交付报告和交付摘要的哈希），确认期间任何一项变动拒绝推进。

projectMemory 从本项目任务及 archive/YYYY-MM/ 下读取已验收、检查成功且交付指纹匹配的记录，按时间返回最近五条匹配项；query 做字面主题筛选。不存在记录不编造经验，损坏或不匹配则报错。历史来源文件可能已更名，检索不要求其仍存在，但提示使用前重新核对。只读记忆不会恢复已归档任务为活动任务，也不会自动改写 .trellis/spec。

before_agent_start 为这五条记录提供交付摘要、运行/检查说明（各最多 400 字）、原检查命令/状态/时间、最多三项遗留和两项经验（各最多 250 字），字符串截断明确标记，remainingCount/memoriesCount 保存原列表长度，record 指向项目内原 progress.json。摘要不含 stdout/stderr。原 memory 工具返回完整交付；需要实际检查数量、跳过原因或原调查时读取任务 progress.json。此投影不增加持久化字段，不改变批准/验收指纹。

回顾历史是只读咨询，无需 new/resume；没有具体主题时 memory 不传 query，筛选为空时先取消筛选。系统提示及公共技能要求按交付、实际检查、遗留和设计决定回答，不把 PRD 的范围排除项全部视作待办；未读取不得声称记录不存在。历史检查不是本次重跑，遗留现状需核对，模型是否遵循仍需真实试用。

公共工作法要求批准前为每项验收条件指定可检验的方法，交付前逐项记录要求、证据、结果与未覆盖范围；结果放在已有 summary/runInstructions，未覆盖内容及原因放 remaining，不增加重复报告或持久化字段。配置说明需核对合法值、默认值、用途、启用条件、依赖及行为是否改变；名称出现只能证明名称覆盖。静态核对、纯函数检查与实际服务运行必须区分。此约束由技能和系统提示引导，现有工具不自动判断语义是否覆盖全部需求；不得声称通过工具门槛即质量达标。

最近一次 check 包含 exitCode、killed、stdout、stderr、command、at；由 `storm_check` 根据 `pi.exec` 返回的 **code** 转换。progress.json 使用同目录临时文件重命名写入。文件损坏必须报告，不能重置成空任务。

项目通过 ctx.cwd 找到最近 `.trellis` 的真实路径；遇到尚未初始化的 Git 根目录必须报错，不能继续向上借用父项目；`.trellis` 不能是指向其他目录的符号链接。任务真实父目录必须是该项目 `.trellis/tasks`。选择记录写入 Pi 自定义会话 entry，同时调用 Trellis `set_active_task` 绑定该会话；不通过同名目录或其他会话猜测任务。Trellis 0.6.6 扩展从 process.cwd 初始化，所以 SDK 测试在加载前切换 cwd。

`scripts/pi-project.mjs` 为外部 Git 根目录提供首次准备和启动：复制固定 Trellis 脚本与工作流，生成项目自己的任务目录和已有规则索引，不复制本原型的 SDK 规范或任务。已有配置只校验、不覆盖。CLI 用显式扩展/技能路径并关闭默认资源和上下文发现，cwd 为目标项目；工作法引用扩展自身定位的绝对技能路径。`--prepare` 只准备。此入口无自动升级或运行环境打包。

`npm run pi` 和 Mac 的 `启动助手.command` 复用同一入口，无参数时先选择项目。候选只由安装目录 `.local/projects.json` 最近路径和平台根目录组成，不扫描业务副本；按真实路径去重，缺失项不显示，平台明确标识，同名目录展示完整路径。最近列表最多十项，仅在创建 Pi 子进程后原子保存；取消和 `--prepare` 不写入。历史文件格式错误保留并报错。Mac 用 osascript 的 choose folder 打开其他项目，不经 shell 拼接路径。显式路径、--version、--help 保留；版本/帮助不初始化项目。扩展 refresh 在有任务、无任务时均显示项目名与绝对路径；状态栏含项目名，避免误把平台工作记录当业务记忆。

`TRELLIS_CONTEXT_ID` 覆盖值沿用原环境，否则与 Trellis 相同使用 `pi_<sessionId>`。检查使用本机 Bash，120 秒超时，透传 AbortSignal。未提供系统级执行隔离；第一轮同一任务只允许一个会话操作。

`storm_task` 在当前模型回合内运行，不另发续行消息。approve/accept 必须通过 `ctx.ui.confirm` 得到用户选择；工具参数不能携带批准值。取消返回 applied=false，保持原记录；AbortSignal 透传对话框。new 的同名活动任务重试沿用已有任务；resume 对唯一未完成任务直接恢复，多候选通过界面选择。命令入口保留原有续行消息行为。

## 4. 验证与错误

| 情况 | 行为 |
| --- | --- |
| 未确认方案 | 允许读取、CodeGraph、进度和当前任务文档编辑；其他 Agent 工具调用阻止 |
| 尚未建立任务 | 允许读取与任务控制；业务写入或命令执行阻止，不能借自然语言入口绕过确认 |
| 任务切换或确认正在进行 | 其他任务控制、进度修改、业务修改和检查阻止；查看资料仍允许 |
| 需求、方案或检查命令变化 | 有效阶段回到 awaiting_approval，旧检查作废 |
| 新的潜在代码修改 | 执行前清除检查结果 |
| 接手任务缺调查或交付报告 | 分别阻止批准或验收 |
| 调查内容改变 | 原方案确认失效，清除检查和交付 |
| 业务修改或重新检查 | 清除旧交付报告；成功后重新整理 |
| 取消验收 | 保留草稿，不形成已确认项目记忆 |
| 验收后手工改写交付 | 经验读取报错，不接受失配内容 |
| 同批工具中检查与修改并发 | 先进入的操作保留，后进入的冲突操作阻止；用 toolCallId 跟踪完成 |
| 检查失败、取消或无结果 | 不能进入 awaiting_acceptance，也不能验收 |
| agent_settled | 仅显示空闲，不改变任务验收状态 |
| 符号链接跨项目、错误 JSON | 报错，不接受越界任务或静默覆盖记录 |

## 5. 示例边界

正常：自然语言目标 → Agent 记录任务、调查和澄清 → 用户通过界面确认方案 → 实现 → storm_check 成功 → 用户通过界面验收。

基本：没有模型密钥仍能运行离线测试。模型工具链与备用命令都支持新建和恢复任务。

错误：模型直接把 phase 写成 completed；失败后宣称检查通过；加载其他项目的同名任务；检查与代码修改同时运行。

## 6. 必须保留的测试

`npm run check` 包含原 SDK 检查和 `scripts/check-workflow.mjs`。后者用真实扩展注册、事件、Trellis Python 和 pi.exec，仅替换发送给模型的消息；在临时项目验证上表，确保新会话及同名项目隔离。

必须保留 Agent 选择及旧任务指纹、调查/交付门槛、报告引用、确认竞争、检查与交付失效、跨 Agent 读取项目经验、恢复助手、归档检索和验收指纹变更回归。报告工具与任务切换/确认共用 pendingControl，和修改/检查互斥。

历史回顾回归须验证新会话收到交付/检查/遗留及原记录路径，文本和列表受限且有标识，完整内容仍能检索；纯读取不创建/恢复任务、不改变验收文件。离线测试不保证模型完成证据核对或正确区分设计决定与遗留问题。

改动 `.mjs` 后执行对应 `node --check`。没有独立 lint/type-check 配置，不得报告它们通过。外部手动代码修改和多会话并写尚无自动检测，不得把本工具描述为完整隔离器。

## 7. 错误与正确

错误：从 pi.exec 读取 result.exitCode，或者把 killed=true 的退出当成功。正确：读取 result.code，并同时要求 killed=false。

错误：每次更新 implement.md 都使方案失效。正确：把方案约束放入 prd.md/design.md，执行清单允许正常更新。

错误：工具返回成功即交付完成。正确：保存实际检查结果，等待用户对产物验收。

错误：用户说“优化项目”就直接重构全仓，或要求用户先学工作流命令。正确：只读调查并提出有证据的候选问题，逐题确认具体范围、保持不变的行为和验收方式。


## 角色与自研只读插件

角色职责、步骤、交付和提示词由 agents.mjs 统一生成，before_agent_start 实际注入；桌面通过 worker 的 STORM_AGENT_PROFILE 提供新任务偏好，已有任务的 agent 始终优先。角色内容不授予权限，不更改计划摘要和验收指纹。只读代码审查不要求建立实施任务，真正修复才走方案确认。

project-changes.mjs 的 storm_changes 与桌面差异视图复用相同实现，只使用当前 cwd 和固定 Git 参数，禁用外部 diff/textconv，限制时间与输出；加入 readableTools 是对此具体工具的人工审查结果。新增工具不能自动继承只读豁免。五个扩展由 .pi/settings.json 显式加载，当前四个角色共用它们。
