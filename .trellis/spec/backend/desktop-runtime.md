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

prepareProject/projectLaunch 复用 CLI 准备与资源清单。旧会话 dispose 后切换 worker cwd，重新加载扩展，SessionManager.continueRecent 仅从该项目自己的 sessionDir 恢复。一次只支持一个项目，切换不并发执行。Trellis 子 Agent 终端工具在桌面禁用，其他固定扩展保留；不修改生成的 Trellis 源码。

SDK loader 的 appendSystemPrompt 为 string[]；自定义模型需要 cost={input:0,output:0,cacheRead:0,cacheWrite:0}，桌面不展示这些默认值为真实计费。

## 账户

通过 ModelRuntime.login(provider,'oauth',interaction) 和实际 provider.auth.oauth 提供账户选项。支持的服务不等于每个账户都有对应权限。ModelRuntime 默认关闭模型目录网络发现；登录/模型调用仍按用户操作执行。

CredentialStore 的修改串行且失败不覆盖。主进程使用 safeStorage 异步加密后原子落盘；解密失败保留原文件。密钥不返回 renderer、不写项目、不作为 models.json 的命令表达式。中转站地址只允许 HTTPS（回环 HTTP 除外），禁止地址中的用户名、密码、查询参数和片段。

中转站 credential.env.STORM_PROXY_BASE_URL 绑定地址，空密钥只能保留同地址的已存凭据；发消息/测试前再次校验，避免配置与密钥跨文件更新失败后错投端点。费用和接口兼容以实际服务为准。

## 分发和验证

当前仅验证 arm64 / macOS 13.5+；运行时 Node 24.14.1、Python 3.12.14、dugite 3.2.3 Git、CodeGraph 0.9.4 随包，Bash 使用系统版本。下载固定 SHA-256。打包只复制 desktop、必要 .pi、Trellis 脚本/工作流/许可、启动辅助和生产依赖；绝不复制业务副本、个人 .local、任务、日志或凭据。移除 esbuild 的其他平台二进制。

应用用本机 ad-hoc 签名；此步骤不等于 Developer ID 签名或 Apple 公证。签名、公证、另一台 Mac 和真实账户均需各自记录验证状态。

npm run check 保留原 SDK/工作流回归；npm run check:desktop 用真实 SDK、运行时、临时项目和回环 HTTP 模型替身验证流式响应、恢复、凭据绑定、确认/取消与只读差异预览。后者需环境允许监听 127.0.0.1，不访问外部模型。可传安装包 Contents/Resources/app 目录，验证脱离源码后的运行路径。

staging 使用系统临时目录的 mkdtemp，在 finally 中清理，DMG 组装目录同样位于 staging 内；不将整份生产依赖留在源码 .local 中。npm run clean 可删除 dist 与下载缓存，但保留 runtime、CLI 最近项目及所有用户账户/任务。

packager 必须设置 derefSymlinks:false，保留 CodeGraph/Python/Node 的相对启动链接。只验证源目录或 SDK 注册不能发现打包链接损坏；发布检查需对脱离源码的应用副本运行每个运行时的 --version 与完整桌面回归。

packager 20.3.0 还会将保留的链接改为 staging 绝对地址。签名前按 staging 中的相对关系恢复安装包链接，拒绝越界/缺失目标；DMG 创建前必须通过 codesign --verify --deep --strict。独立目录测试须检查所有链接目标在应用包内，避免 staging 仍存在时得到假通过。

worker 设置 PYTHONDONTWRITEBYTECODE=1，避免 Trellis 调用随包 Python 时在已签名的标准库目录写缓存。包检查在运行 SDK/工作流之后再验签；不能只检查新生成的静态包。

OAuth 的 source=auth / promptType 原样传给 renderer，manual_code 与本机回调并行；合并局部 signal、主动取消与 15 分钟超时。OpenAI 的 browser/device_code 选择来自设置，默认 browser。连接测试最多等待 45 秒。

SessionManager.list/open 管理当前项目历史，只暴露 id/标题/时间/是否当前；resume 在 worker 校验 id 所属 cwd 和真实路径，不接受任意文件路径。实时与历史消息只发 user/assistant/toolResult 三类，内部 custom/thinking 不可展示。messages.mjs 投影公开文本（最多 60,000 字符并标记截断）、toolCallId、调用名称及有限摘要；只允许已知文件工具路径，Bash 只显示首个可执行词，不传任意参数对象。Pi 0.85.1 在 message_end 订阅通知之后同步保存同一个消息对象：实时用临时 ID，微任务按对象引用找到原生 entry ID，发 previousId 显式重绑定；历史用 sessionId:entryId，不能用时间戳或文本猜关联。最近 200 条来自当前 branch 的公开消息，保留省略数量。

check:mac-package 同时从独立应用副本加载 Markdown 与真实 OAuth 回归，确保 marked 等传递依赖实际随包、回调桥接仍可用。

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

selectModel 只接受已登录订阅中的已知模型或已保存中转站模型，最终走 saveModel 的统一校验、凭据地址绑定和保存路径。renderer 不传任意已保存配置作为快捷切换授权。proxy-models.json 存储同一地址最多 20 个非秘密配置；切换订阅时保留，首次旧配置迁移在离开原中转站前保存。更换地址仍需密钥，旧地址列表移除。agent.json 只保存新任务默认角色 ID。

catalog 的角色来自同一注册表，插件入口来自 .pi/settings.json.extensions，名称说明来自 stormPlugins；加载状态来自 SDK resolvedPath，工具来自注册表与当前 session.getActiveToolNames 的交集。关闭/切换项目清空加载快照，未知插件显示通用名称。索引存在不是健康或已调用的证明。

--preview 发布仅接受 local 包，同样核对提交、版本、回归和独立安装包，生成 SHA-256；完整上传后公开为 prerelease，仅提供 DMG 和校验文件。正式稳定路径仍需签名公证。预览不会启用原地更新，不混入正式更新 ZIP。
