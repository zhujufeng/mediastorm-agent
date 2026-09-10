# Mac 安装与更新发布

同事只需要第一次下载安装。正式安装版左下角“软件更新”及应用菜单“检查更新…”用于获取新版；下载完成后可选择稍后，或在空闲时重启安装。原生更新也会在下次正常重启时应用已下载版本。登录、最近项目、对话保留在原应用数据目录，项目任务与经验仍在项目中。

当前 0.4.0 已接入更新功能，尚未完成 Developer ID 签名、公证和两个真实签名版本之间的升级验证。旧 0.2.0 没有更新功能，需要手动安装一次包含更新功能的正式版。本机试用包可以生成 DMG，但不能作为稳定更新源。

## 更新来源

- 安装与版本记录：[GitHub Releases](https://github.com/zhujufeng/mediastorm-agent/releases)。已公开 Mac 预览 DMG 与 SHA-256 校验文件；预览标记为 prerelease，不进入稳定更新源。
- 更新检查：`https://update.electronjs.org/zhujufeng/mediastorm-agent/darwin-arm64/<当前版本>`。
- 使用 Electron 内置 autoUpdater / Squirrel.Mac；更新包为带 `-mac-arm64` 的 ZIP。DMG 供首次安装，ZIP 供更新器使用。
- 同事无需 GitHub 账号、Node、npm 或独立安装 Pi；网络需要能访问 GitHub Releases 和 Electron 更新服务。
- 更新组件负责签名校验与应用替换，不执行来自版本说明的代码，也不接受用户输入的更新 URL。

## DMG、签名与公证的区别

DMG 是安装文件容器，可以不使用 Apple Developer 账号生成。未完成签名、公证的应用首次打开可能被 macOS 拦截。Developer ID 签名标识发布者，Apple 公证用于系统分发检查；Electron 的 Mac 自动更新要求代码签名。公开项目并不免除这些条件。

首次正式发布需要可用的 Developer ID Application 身份和 Apple 公证凭据。由维护者在本机钥匙串配置；证书私钥、密码、Apple API key 都不提交到 Git，也不放进同事的应用。当前发布脚本使用 `notarytool` 已保存的 keychain profile，而不是从源码读取账户密码。

## 无证书时发布公开试用版

无需先购买 Apple Developer，也可以提供 DMG 下载。提交并推送版本对应源码后执行：

```sh
npm run desktop:package
npm run desktop:publish -- --preview /path/to/release-notes.md
```

`--preview` 检查提交与构建一致，执行 SDK 回归及独立包验证，生成 SHA-256，先上传完整 DMG 到草稿，再公开为 prerelease。它自动注明 ad-hoc 签名、未公证和手动更新限制，不上传自动更新 ZIP。首次运行可能需要按系统“隐私与安全性”提示允许打开，见 [Apple 说明](https://support.apple.com/zh-cn/102445)。不要求同事关闭系统安全保护。

同事下次从软件里的“下载与版本记录”取得新版，退出应用后覆盖 Applications 中的同名应用。登录和已保存对话保留在应用数据目录。若上传中断，先检查 GitHub 是否留下草稿；不要覆盖已经公开的版本资产。

## 维护者的正式签名发布步骤

1. 在 `package.json` 更新版本为 `x.y.z`，同步 `package-lock.json` 的两个根版本。所有界面与构建产物读取这个版本，不再手改 HTML。保持应用名称、bundle ID 和签名身份连续。
2. 编写本次版本说明，提交并推送源码；正式构建要求 Git 工作区干净，安装包记录对应提交。
3. 在已配置身份的 Mac 上设置 `STORM_SIGN_IDENTITY` 为钥匙串里的 Developer ID Application 完整名称，`STORM_NOTARY_PROFILE` 为保存的 notarytool 配置名。这两个环境变量不包含私钥或密码。
4. 执行：

```sh
npm ci
npm run desktop:runtime
npm run desktop:release
npm run desktop:publish -- /path/to/release-notes.md
```

`desktop:release` 先恢复包内链接，再签名所有原生程序、公证应用并附加公证票据，生成 ZIP 和 DMG，最后签名、公证 DMG。任一步失败会停止。无证书时仍可运行 `npm run desktop:package` 生成仅供本机验证的试用包。

`desktop:publish` 核对源码提交、版本和正式包标记，重跑离线与独立安装包检查，并确认对应提交已在 GitHub。它将两个产物上传为 **Release 草稿**。同事的更新源不会读取草稿；同一个版本不可重复覆盖，应使用新版本号。

5. 在另一台 M 系列 Mac 验证首次安装、浏览器登录、打开项目、任务和重启恢复。随后用两个签名版本验证旧版检查更新、下载、取消/重启、账号与对话保留、网络失败及忙时拒绝重启。
6. 通过后在 GitHub 发布草稿，作为正常 Release（不要勾选 prerelease）。同事点击“检查更新”即可获得新版。若两个版本间升级尚未验证，不宣称完整更新链路已验收。

首次 DMG 安装后需移入 Applications 再运行；直接从磁盘镜像运行时不会启用原地升级。系统会按用户权限请求必要的安装许可。当前只支持 macOS 13.5+ / arm64；Windows 和 Intel Mac 不共用这一更新包。

## 验证与撤回

- `npm run check:updates`：用真实状态桥接和模拟原生事件，检查重复调用、错误重试、未签名版本禁用、忙时拒绝、取消和安全关闭失败。
- `npm run check:desktop`：保留真实 SDK 的账户/项目/会话回归，并运行上述更新回归。
- `npm run check:mac-package`：复制应用到源码外执行验证，解压更新 ZIP 并核对版本和签名；正式包额外检查公证与系统信任。
- 发现坏版本时先撤下对应 Release 的公开状态，再以更高版本号发布修复。官方更新服务有缓存，撤下不会召回已下载版本；必要时通知试用者停止安装。保留旧 DMG 供维护者恢复，不自动降级项目数据。

依据：[Electron 更新机制](https://www.electronjs.org/docs/latest/tutorial/updates)、[autoUpdater API](https://www.electronjs.org/docs/latest/api/auto-updater)、[官方服务与 ZIP 命名](https://github.com/electron/update.electronjs.org)、[签名与公证](https://www.electronjs.org/docs/latest/tutorial/code-signing)。
