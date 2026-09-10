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

packager 必须设置 derefSymlinks:false，保留 CodeGraph/Python/Node 的相对启动链接。只验证源目录或 SDK 注册不能发现打包链接损坏；发布检查需对脱离源码的应用副本运行每个运行时的 --version 与完整桌面回归。

packager 20.3.0 还会将保留的链接改为 staging 绝对地址。签名前按 staging 中的相对关系恢复安装包链接，拒绝越界/缺失目标；DMG 创建前必须通过 codesign --verify --deep --strict。独立目录测试须检查所有链接目标在应用包内，避免 staging 仍存在时得到假通过。

worker 设置 PYTHONDONTWRITEBYTECODE=1，避免 Trellis 调用随包 Python 时在已签名的标准库目录写缓存。包检查在运行 SDK/工作流之后再验签；不能只检查新生成的静态包。

OAuth 的 source=auth / promptType 原样传给 renderer，manual_code 与本机回调并行；合并局部 signal、主动取消与 15 分钟超时。OpenAI 的 browser/device_code 选择来自设置，默认 browser。连接测试最多等待 45 秒。

SessionManager.list/open 管理当前项目历史，只暴露 id/标题/时间/是否当前；resume 在 worker 校验 id 所属 cwd 和真实路径，不接受任意文件路径。实时与历史消息只发 user/assistant/toolResult 三类，内部 custom 上下文不可展示。

check:mac-package 同时从独立应用副本加载 Markdown 与真实 OAuth 回归，确保 marked 等传递依赖实际随包、回调桥接仍可用。
