# Mac 桌面运行时契约

## 边界与入口

- desktop/main.mjs：Electron 主进程、系统文件夹选择、有限 IPC、safeStorage。
- desktop/worker.mjs：唯一 Node 子进程，Pi 0.85.1 公共 SDK 与固定插件。
- desktop/store.mjs：输入校验、原子写入和串行 CredentialStore。
- scripts/prepare-desktop-runtime.mjs / package-mac.mjs：固定运行时与 allowlist 打包。

Electron ESM 入口注册 app.whenReady().then(...)，不顶层 await ready。页面启用 contextIsolation、sandbox、禁用 Node，不开放导航或任意 shell；权限请求与检查只允许本窗口的 clipboard-sanitized-write，不开放读取剪贴板等其他权限；IPC 校验发送 frame、动作和确认值。用户主动发起登录后，主进程自动打开 SDK 返回的 HTTP(S) 授权页面；也可点击重开。仅当前登录允许的链接有效，结束即清空。此隔离只保护界面，不是项目命令执行沙箱。

单实例应用、单 worker、同一时间一个可变操作。停止可打断当前模型与 UI 等待，不取消进行中的原子凭据保存；退出先 abort/dispose 再结束进程。关闭 Mac 窗口隐藏应用，Cmd+Q 完全退出。

## 路径与资源

app.getPath('userData') 保存 model.json、credentials.enc、projects.json 和按真实项目路径 SHA-256 分目录的 Pi 会话；从不写安装目录，也不继承个人 Pi 插件/密钥或 Codex/Trellis 会话环境变量。项目任务和经验仍存放目标项目 .trellis。

prepareProject/projectLaunch 复用 CLI 准备与资源清单。旧会话 dispose 后切换 worker cwd，重新加载扩展，SessionManager.continueRecent 仅从该项目自己的 sessionDir 恢复。一次只支持一个项目，切换不并发执行。Trellis 子 Agent 终端工具在桌面禁用，其他固定扩展保留；自有 trellis-product.mjs 跳过上游流程提示注入，保留任务运行支持，不修改生成的 Trellis 源码。产品技能采用明确目录清单，不把平台开发用 trellis-* 技能载入员工会话。

SDK loader 的 appendSystemPrompt 为 string[]；自定义模型需要 cost={input:0,output:0,cacheRead:0,cacheWrite:0}，桌面不展示这些默认值为真实计费。

## 受控网页工具

`desktop/browser-page.mjs`仅接受可信宿主的已连接Browser和真实确认回调，先确认再创建自有target；每次读取另行确认，并在确认/提取后复核主frame、loader、URL和导航revision。只提供read/close，不接受模型提供的脚本、targetId或批准值。宿主须禁用非目标页自动连接/采集、设置协议超时，并在中止/退出时await close；模块不能Browser.close或操作其他页面。创建/断线后的清理状态未知须报告，不自动重试。

Fetch限制仅作用于截获的目标HTTP(S)请求，不是全浏览器/系统网络沙箱。固定主frame提取排除表单/隐藏节点，返回有限、常见凭据过滤的文本和untrusted标记；业务数据传输仍需单独确认。worker通过SDK customTools注册storm_browser_page；browser-tool.mjs负责固定Chrome连接、三次真实确认、单调用read/close/disconnect及stop。MediaStorm工具事件门禁要求有效批准、实施阶段和独占控制，不进入审查白名单。项目切换和退出await stop，关闭未知保留失败，退出失败不能自动强杀；重复退出也须等待。连接超时后的迟到结果只disconnect，不开页。Puppeteer Core25.10.0为唯一生产连接驱动，Playwright仍仅测试，不随包下载浏览器。`check:browser-page`使用合成临时浏览器验证；check:desktop-ui通过仅测试预加载器替换连接端点，验证真实确认按钮和输出；具体接口、范围与未覆盖项见`docs/browser-page-channel.md`。

## 独立数据采集入口

worker的workspaceKind区分project/collector，collect动作仅创建userData/collector作为SDK会话cwd，不初始化Git/Trellis，不记入最近项目；目录不暴露为业务项目。独立模式DefaultResourceLoader禁用全部扩展/技能/项目上下文，仅附加desktop/collector.mjs说明；SDK tools严格为['storm_browser_page','storm_collection_plan','storm_collection_run']，customTools提供对应定义并共享互斥。Pi0.85.1 tools是名字白名单，不是工具实现数组；[]会禁用customTools，不能用setActiveTools绕过。

独立入口不继承项目任务批准，浏览器工具每次仍需真实确认。fresh/resume沿用当前workspaceKind及对应会话目录，禁止跨目录恢复；返回项目重新加载原扩展/角色门禁。没有第二套采集任务存储。UI单独欢迎页/采集历史，不显示Git差异与项目阶段入口；截图随入口切换清除。生成/运行核验未实现时必须明确，不将提示词描述当作已实现功能。

collection-plan.mjs提供propose/current。完整结构经边界校验后计算SHA256；先appendCustomEntry写pending以撤销旧确认，再真实UI确认，finally写confirmed/cancelled。原生会话记录的dataVerified和executionAuthorized固定false；任何后续能力不得把需求确认当执行授权或数据验证。浏览器引用只校验本会话成功toolCallId及origin，路径、字段映射及样例正确性仍未核验；截图来源检查本会话用户图片存在，不声称做过OCR核验。最多12字段/5样例，行宽一致、字段唯一、缺失用null；URL拒绝凭据/查询参数，筛选写入scope。catalog只读投影状态/摘要/格式化文本，界面无写状态接口，切换入口清空方案查看弹窗。check-collection-plan及真实worker/UI覆盖确认/取消/停止/恢复、互斥、来源错配和记录损坏。

## 当前页数据产物

方案可选capture=current-page-table；未传时不新增规范字段，保留旧方案摘要兼容。run仅接受已确认data或chrome-extension/current-page-table、明确URL及完整非空预期样例。与方案/网页工具共用互斥，重新走真实browserTool打开读取及清理，不能由模型提供数据替代实跑。

browser-page固定隔离世界提取标准HTML表格：最多20候选、12列/50条，表格最多6000字符，正文与表格合计12000字符。单行TH表头，无合并/页脚/不规则行；敏感表头整表值过滤并省略正文/标题，扫描截断不得交付。返回pageUrl只在无查询参数时包含完整URL。字段精确匹配唯一表格、重复/缺失/超限或预期样例不匹配均失败。不点击/翻页/读取接口；只对当前DOM快照负责。

collection-data在原生SDK custom entry保存pending/failed/ready，ready绑定planDigest/data digest/engineDigest（实际共享函数源码摘要）/时间/来源/columns/records，untrusted=true、allPagesVerified=false、filtersVerified=false。任何新方案先失效旧结果，包括同内容重确认；失败重跑不能复用旧成功产物。旧记录缺少engineDigest或算法源码变化时不可再作为当前产物导出，历史保留，需重新运行。worker.collectionExport只导出与当前confirmed方案绑定且摘要有效的结果；项目模式禁用。

main的csv/json导出先校验查看弹窗绑定的结果digest，原生save dialog选择路径后再次复核digest；模型没有导出路径工具。saveCollectionFile同目录随机暂存、写完后linkSync独占落地，目标已存在或文件系统不支持则失败，不覆盖。CSV全字段引用、转义双引号并中和公式/控制字符前缀；JSON保留原值与覆盖说明。catalog仅投影摘要、数量和前5条预览；UI显示当前页结果而不宣称全站或筛选范围验证。check-collection-data、真实合成browser-page以及UI文件导出固定真值验证。

## 固定Chrome插件产物

collection-extension生成固定MV3模板，不接受模型代码/选择器。复用browser-page导出的extractPage/sanitizeBrowserPage以及collection-data的collectionRows/collectionCSV等显式受信任函数，序列化函数清单包含所有依赖，不复制第二套表格算法。extractPage的tablesOnly=true只用于插件，不取正文/标题，默认false保留桌面行为。

worker.collectionExport(chrome-extension)要求当前confirmed插件形式与同摘要ready桌面基线。main先核对查看时digest，再经原生目录选择、复核基线和bundle摘要，mkdtemp创建唯一新子文件夹；固定8文件名、长度/摘要校验、0600文件，不覆盖。界面提示包含业务样例、未自动安装，失败或取消不声称已保存。没有新增模型工具/任意路径权限。

manifest只activeTab/scripting，无host_permissions/background/content_scripts/web_accessible_resources；CSP仅self。popup用户点击后仅准确URL当前标签页主frame，ISOLATED固定函数读取；documentId定向复核与pendingUrl检查防导航换文档。每次await后复核停止令牌，不再发起后续读取；超时/停止忽略迟到结果，重跑清除旧Blob下载链接；关闭不保存预览。预期完整样例每次仍需匹配，变化后重新确认，不自动放宽。JSON带覆盖限制及数据摘要，CSV复用公式中和。不上传模型或外网，不读Cookie。

verification.json记录源方案/桌面基线与引擎摘要及文件SHA256。popup启动时校验方案摘要和固定文件清单的实际SHA256，变化后禁用读取；businessExtensionRunVerified=false；不是本地防篡改签名，更不是使用者真实后台的插件运行证据。check:collection-extension --unit验证生成物及纯函数依赖/边界，日常check:all包含；无参数另实际加载生成MV3、核对activeTab拒绝/授予、读取、下载、停止和失败。Extensions.triggerAction需要Target.getTargets(type=tab)的tab target，不是page target；实验调试flag仅临时Chrome测试。生产不自动安装或修改个人Chrome。

## 截图输入

单张PNG/JPEG，4MiB、最长边4096像素。main的prepareImage与prompt共用签名/尺寸校验、nativeImage真实解码及PNG重编码；renderer不接收文件路径权限，只从原生文件输入/粘贴读取所选文件，预览仅使用main返回的规范图片。worker独立校验有界PNG，图片只能随自然语言prompt，不能混入斜杠命令。Pi0.85.1实际ImageContent字段为type/data/mimeType，通过session.prompt(text,{images})传递；不能照抄不匹配的source示例。

发送前真实确认接收模型/地址及本地会话保存，取消不写会话；stop中止待确认。中转站vision默认false，目录/配置不声明图片能力时拒绝新图片及含图片的现有上下文，不能静默丢图。图片保存在原有Pi会话，界面只回传imageCount，不批量广播base64。预览/草稿不持久化，切换项目或会话递增imageEpoch清除草稿，迟到FileReader结果不得进入新项目；未发图片阻止应用内更新重启。截图不等于浏览器或代码操作授权，不承诺自动匿名化。

check:all覆盖格式、能力、确认、请求及恢复，check:desktop-ui用合成PNG/JPEG及回环模型实际验证UI和main解码。说明见docs/screenshot-input.md。

## 账户

通过 ModelRuntime.login(provider,'oauth',interaction) 和实际 provider.auth.oauth 提供账户选项。支持的服务不等于每个账户都有对应权限。ModelRuntime 默认关闭模型目录网络发现；登录/模型调用仍按用户操作执行。

CredentialStore 的修改串行且失败不覆盖。主进程使用 safeStorage 异步加密后原子落盘；解密失败保留原文件。密钥不返回 renderer、不写项目、不作为 models.json 的命令表达式。中转站地址只允许 HTTPS（回环 HTTP 除外），禁止地址中的用户名、密码、查询参数和片段。

中转站 credential.env.STORM_PROXY_BASE_URL 绑定地址，空密钥只能保留同地址的已存凭据；发消息/测试前再次校验，避免配置与密钥跨文件更新失败后错投端点。费用和接口兼容以实际服务为准。

## 分发和验证

当前仅验证 arm64 / macOS 13.5+；运行时 Node 24.14.1、Python 3.12.14、dugite 3.2.3 Git、CodeGraph 0.9.4、飞书 CLI 1.0.90 随包，Bash 使用系统版本。下载固定 SHA-256。打包只复制 desktop、必要 .pi、Trellis 脚本/工作流/许可、启动辅助和生产依赖；绝不复制业务副本、个人 .local、任务、日志或凭据。移除 esbuild 的其他平台二进制。

应用用本机 ad-hoc 签名；此步骤不等于 Developer ID 签名或 Apple 公证。签名、公证、另一台 Mac 和真实账户均需各自记录验证状态。

npm run check 保留原 SDK/工作流回归；npm run check:desktop 用真实 SDK、运行时、临时项目和回环 HTTP 模型替身验证流式响应、恢复、凭据绑定、确认/取消与只读差异预览。后者需环境允许监听 127.0.0.1，不访问外部模型。可传安装包 Contents/Resources/app 目录，验证脱离源码后的运行路径。

staging 使用系统临时目录的 mkdtemp，在 finally 中清理，DMG 组装目录同样位于 staging 内；不将整份生产依赖留在源码 .local 中。npm run clean 可删除 dist 与下载缓存，但保留 runtime、CLI 最近项目及所有用户账户/任务。

packager 必须设置 derefSymlinks:false，保留 CodeGraph/Python/Node 的相对启动链接。只验证源目录或 SDK 注册不能发现打包链接损坏；发布检查需对脱离源码的应用副本运行每个运行时的 --version 与完整桌面回归。

packager 20.3.0 还会将保留的链接改为 staging 绝对地址。签名前按 staging 中的相对关系恢复安装包链接，拒绝越界/缺失目标；DMG 创建前必须通过 codesign --verify --deep --strict。独立目录测试须检查所有链接目标在应用包内，避免 staging 仍存在时得到假通过。

worker 设置 PYTHONDONTWRITEBYTECODE=1，避免 Trellis 调用随包 Python 时在已签名的标准库目录写缓存。包检查在运行 SDK/工作流之后再验签；不能只检查新生成的静态包。

OAuth 的 source=auth / promptType 原样传给 renderer，manual_code 与本机回调并行；合并局部 signal、主动取消与 15 分钟超时。OpenAI 的 browser/device_code 选择来自设置，默认 browser。连接测试最多等待 45 秒。

SessionManager.list/open 管理当前项目历史，只暴露 id/标题/时间/是否当前；resume 在 worker 校验 id 所属 cwd 和真实路径，不接受任意文件路径。实时与历史消息只发 user/assistant/toolResult 三类，内部 custom/thinking 不可展示。messages.mjs 投影公开文本（最多 60,000 字符并标记截断）、toolCallId、调用名称及有限摘要；只允许已知文件工具路径，Bash 只显示首个可执行词，不传任意参数对象。Pi 0.85.1 在 message_end 订阅通知之后同步保存同一个消息对象：实时用临时 ID，微任务按对象引用找到原生 entry ID，发 previousId 显式重绑定；历史用 sessionId:entryId，不能用时间戳或文本猜关联。最近 200 条来自当前 branch 的公开消息，保留省略数量。

check:mac-package 同时从独立应用副本加载 Markdown 与真实 OAuth 回归，确保 marked 等传递依赖实际随包、回调桥接仍可用。

## 飞书 CLI

官方归档含二进制、许可证和内嵌技能，固定URL/SHA-256后解压至runtime/lark，runtime/bin/lark-cli为相对链接。无需npm依赖/全局安装；CLI和桌面的storm_lark都根据扩展自身位置调用这个路径，不从PATH选择个人版本。飞书配置/登录沿用CLI原生终端，不在模型对话接收密钥、不复制构建者配置，不自更新签名包。CLI账户存储独立于产品模型credentials.enc，可复用同一系统用户已有CLI身份，但以用户确认后的状态检查为准。

storm_lark仅精确离线形式免确认；业务调用要求显式身份并通过ctx.ui.confirm，取消/无UI/中止不得执行。参数直接传execFile，不拼shell；限制120秒/1MiB，输出分片仅用于离线文档，业务操作不能为翻页输出而重复执行。常见凭据键脱敏不代表任意文本脱敏；业务输出可能进入会话/模型，数据政策仍由使用者确认。退出码10及其他非零状态不能伪装成功，超时或取消后的副作用可能未知。

check:lark使用临时HOME、离线CLI和假进程验证，不读取真实账户。check:mac-package从独立副本再次运行，并在运行后验签。真实飞书授权/业务数据验收单独记录。

## Mac 软件更新与发布

package.json 为唯一应用版本来源，锁文件根版本同步；HTML、packager、DMG/ZIP 和检查读取该版本。打包 package.json 附带 sourceCommit 与 releaseChannel；只有显式 --release、干净源码、Developer ID 身份及 notarytool profile 才能生成 stable 包。

主进程通过 desktop/updates.mjs 接 Electron autoUpdater，更新源固定到本仓库的 update.electronjs.org darwin-arm64 端点；renderer 只能请求 updateStatus/checkUpdate/installUpdate/releasePage，不接受任意更新 URL。状态查询与更新动作在 worker boot 门槛之前处理，模型故障不能阻断软件修复入口。开发、本机试用、非支持架构或未移入 Applications 的包不启用原地更新。

原生事件拥有检查/下载/就绪/错误状态；重复检查不发第二次请求，错误可重试。安装必须在空闲、无工作流确认时，由原生确认框明确选择；主进程持有 operation 直到安全关闭 worker 并调用 quitAndInstall。窗口 close 隐藏逻辑通过 quitting 放行更新退出，避免下载后无法替换。未发送的编辑内容在 renderer 阻止重启；任务/对话仍由原 worker 持久化。

正式签名发生在 packager 链接恢复之后，复用其锁定的 @electron/osx-sign，启用 hardened runtime 与 JIT entitlement。应用公证通过并 staple 后再制作用于更新的 ZIP；DMG 另签名、公证并 staple。更新 ZIP 解压后也要验证签名与公证，不能只核对旁边的 .app。正式发布路径拒绝 local 包、版本/源码不符、未推送源码或检查失败的产物，只创建 Release 草稿；另一台 Mac 及两个实际签名版本之间的升级须独立验证。

签名/公证仅在维护者本机钥匙串配置；不复制到应用，不提交 Git。没有 Developer ID 时只能声明本机试用包与模拟更新状态回归通过，不宣称正式分发或真实升级成功。

锁定的 @electron/osx-sign 2.7.0 导出 `sign`（返回 Promise），不是旧版 `signAsync`；check:updates 在源码模式验证实际导出。


## 工作台展示通道

### 1. 范围与触发

修改消息/工具投影、任务/检查侧栏、确认展示、Git 差异或异步 catalog 时遵循此契约。仅覆盖本地展示，不授予执行或批准权限。

### 2. 接口

- `workspaceState()` → `{ epoch, revision, workflow, busy }`；`workflow`/`busy` 事件和 `catalog()` 共用这些字段。
- 扩展事件：`mediastorm:workflow(snapshot)`、`mediastorm:confirmation({ kind, digest, title, snapshot } | null)`。
- `messageProjection(manager)` 提供 `start/update/end/history`；结束投影含 `id/previousId`，工具关联用 `toolCallId`。
- `projectChanges(project, signal?)` → `{ text, files, omitted, truncated }`；`files[]` 包含 `group/status/path/oldPath?/patch/binary/truncated`。
- Renderer 的 `answer({ id, value })` 保持既有 IPC；无直接写 phase/approval/check 的接口。

### 3. 数据与生命周期

每次打开项目/会话创建独立公开 createEventBus 并交给 DefaultResourceLoader；订阅 mediastorm:workflow 与 mediastorm:confirmation。旧 bus 清空，项目 epoch 随 project/history/message/tool/workflow/changes/catalog 返回，renderer 丢弃旧异步响应。workflow 在 catalog 中保留最新快照以覆盖首屏订阅时序；空任务和读取失败显式返回，不猜 widget 或其他会话的状态。workflow/busy 事件和 catalog 共享进程内递增 revision，并同时携带 workflow、busy、epoch；任何一种投影都能补齐另一字段，避免只因丢弃旧事件而漏掉状态。catalog 先完成所有异步查询，最后同步采集这些字段；会话列表查询跨越 epoch 时重新采集。renderer 统一拒绝旧 epoch/同 epoch 旧 revision，fatal 清除成功缓存并锁定断线态，后续 catalog/事件不能恢复成功；只有重开应用重建运行时才能解除。序号不写入账户或会话存储，不参与批准摘要。

确认元数据只消费到紧随其后、标题匹配的非 OAuth confirm question，保留原问题 ID、正文、signal/timeout。元数据不是批准凭证；main 仍校验 questions Map 中有效 ID 与值，扩展仍复核计划/交付摘要。stop 在主进程同步撤销问题 ID，再请求 worker 中止，避免 dismiss 往返期间旧确认复活。不新增任务写入、任意路径或 shell IPC。

结构化 Git 查询复用 projectChanges，保留 CLI text，并返回 files（group/status/path/oldPath/patch/binary/truncated）、omitted/truncated。固定 NUL name-status 与 ls-files 查询，不从可读 diff 标题猜路径；--literal-pathspecs 防止特殊文件名成为 Git 通配表达式，路径仅来自本次 Git 查询。未跟踪文件不读内容；至多 100 项，单 patch 128 KiB、总 patch 1 MiB，元数据单查询 2 MiB，10 秒总期限。缓冲截断时不使用不完整 NUL 记录，取消和其他错误不能伪装为干净工作区。原 fsmonitor/ext-diff/textconv 保护保留；这仍不是仓库执行沙箱。

### 4. 验证与错误矩阵

| 输入/状态 | 必须行为 |
| --- | --- |
| 旧 epoch 或同 epoch 较低 revision | 不应用该投影，不回退工作流或 busy |
| catalog 查询期间 epoch 变化 | 重新采集；不得把旧会话列表配上新项目 |
| fatal 后迟到 catalog、事件或搜索 | 保持断线，不恢复旧成功检查/确认 |
| 空任务或快照读取失败 | 显示空/失败状态，不借用旧任务 |
| 过期问题 ID、错误确认值、取消/停止 | 主进程拒绝或取消，不写批准状态 |
| Git 超限、不完整 NUL 记录、取消/命令错误 | 明示截断或失败，不拼错路径、不伪装无改动 |

### 5. 正常、基本和错误场景

正常：真实消息→工具→实际检查记录→当前有效确认→原摘要二次校验。基本：未绑定任务仍可普通对话，未跟踪文件只显示名称。错误：成功快照被失效后，又因一次搜索或迟到目录查询恢复「检查通过」。

### 6. 必须验证

`check-workspace.mjs` 覆盖消息/快照投影、过滤、Git 路径和限制；`check-desktop.mjs` 覆盖 worker 与原协议。`check-desktop-ui.cjs` 用真实主进程/SDK和 Promise 屏障暂停会话列表、catalog 返回及模型续步，断言逆序返回不能恢复成功或解除 busy；实际终止临时 worker 后重复搜索/释放旧响应，断言断线持续。确认摘要、默认取消和原 OAuth 回归仍须通过。

### 7. 错误与正确

错误：`return { workflow, busy, sessions: await projectSessions() }` 在 await 前冻结部分状态；搜索调用完整 `updateCatalog(catalog)` 重放缓存。正确：先完成列表查询并核对 epoch，再同步采样 `workspaceState()`；接收方检查 revision，搜索只 `renderSessions()`。DOM 状态正确不代表截图已刷新，图像仍须等绘制并实际读取。

## 模型选择与能力库（0.4.0）

selectModel 只接受已登录订阅中的已知模型或已保存中转站模型，最终走 saveModel 的统一校验、凭据地址绑定和保存路径。renderer 不传任意已保存配置作为快捷切换授权。proxy-models.json 存储同一地址最多 20 个非秘密配置；切换订阅时保留，首次旧配置迁移在离开原中转站前保存。更换地址仍需密钥，旧地址列表移除。agent.json 只保存新任务默认角色 ID。worker经校验保存profile后通过项目eventBus发mediastorm:profile同步活动工具；未完成任务角色仍优先，界面通知不会把新默认角色当作现有任务权限变化。审查与实施的工具策略由MediaStorm扩展统一用于CLI和桌面，不能在worker复制第二套白名单。

catalog 的角色来自同一注册表，插件入口来自 .pi/settings.json.extensions，名称说明来自 stormPlugins；加载状态来自 SDK resolvedPath，工具来自注册表与当前 session.getActiveToolNames 的交集。关闭/切换项目清空加载快照，未知插件显示通用名称。索引存在不是健康或已调用的证明。

--preview 发布仅接受 local 包，同样核对提交、版本、回归和独立安装包，生成 SHA-256；完整上传后公开为 prerelease，仅提供 DMG 和校验文件。正式稳定路径仍需签名公证。预览不会启用原地更新，不混入正式更新 ZIP。
