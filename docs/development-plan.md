# 工程结构与开发流程

本仓库只维护 MediaStorm Agent 平台。业务项目放在平台仓库之外，由使用者主动打开；测试使用临时项目，不依赖真实业务副本。

## 目录职责

| 位置 | 职责 |
| --- | --- |
| `desktop/` | Electron 界面、主进程、Pi worker、账户存储和更新 |
| `.pi/extensions/mediastorm/` | Agent 定义、任务状态、确认与项目记忆 |
| `.pi/extensions/project-changes.mjs` | 共用的只读 Git 差异工具 |
| `.pi/settings.json`、`.pi/skills/` | 固定插件清单与工作方法 |
| `.trellis/scripts/`、`.pi/extensions/trellis/` | 复用的 Trellis 运行代码，保留上游许可 |
| `.trellis/spec/` | 本项目实际采用的工程约定 |
| `.agents/`、`.codex/` | 开发平台源码时使用的 Trellis 集成，不进入安装包 |
| `scripts/` | 启动、断言检查、运行时准备、打包和发布 |
| `.github/workflows/check.yml` | 干净检出后的 Mac arm64 自动检查与打包验证 |
| `docs/` | 现行使用、开发和发布说明 |

Electron 主进程管理系统能力，隔离页面只通过有限 IPC 操作；Pi 在独立 Node worker 运行。Agent 定义由同一注册表提供给 UI 与模型；CLI 和桌面共用项目准备、插件和工作流。详细契约见 [桌面运行时](../.trellis/spec/backend/desktop-runtime.md)、[工作流](../.trellis/spec/backend/pi-workflow.md)。

当前使用 Node ESM、原生 HTML/CSS/JS 和文件存储。按实际需求增加模块，不创建空的服务层、数据库层或规范模板。

## 本地数据与生成物

| 位置 | 内容与清理方式 |
| --- | --- |
| `node_modules/` | 锁定依赖；通过 `npm ci` 重建 |
| `runtime/` | 桌面开发和打包需要的便携运行时；通过 `npm run desktop:runtime` 准备 |
| `dist/` | 可重建的安装产物；通过 `npm run clean` 清理，发布记录保留在 GitHub Releases |
| `.local/desktop-downloads/` | 已校验的运行时下载缓存；同样由 `npm run clean` 清理 |
| `.local/projects.json` | CLI 最近项目；只记录用户实际打开的项目 |
| 系统临时目录 | 测试项目与打包 staging；独立创建，在 `finally` 清理 |
| Electron `userData` | 加密凭据、模型、最近项目及按项目隔离的会话，应用升级保留 |
| 目标项目 `.trellis/` | 该项目的需求、任务、规范与已验收经验 |

本机数据和生成物不提交 Git。平台开发过程的 `.trellis/tasks/`、`.trellis/workspace/` 也仅留本地。清理构建产物不会删除账户、最近项目、业务项目或任务记忆。

## 开发与检查

在 M 系列 Mac、Node.js ≥ 22.19.0 和 Git 环境下：

```sh
npm ci
npm run desktop:runtime
npm run check:all
npm run desktop
```

开发前读取相关 `.trellis/spec/`，按实际影响修改共用入口；外部 SDK 使用固定版本的公开 API。依赖使用精确版本，修改依赖时同步锁文件。

| 命令 | 验证内容 |
| --- | --- |
| `npm run check:repository` | 版本与锁文件、固定依赖、JavaScript 语法、待提交文件的目录和隐私边界 |
| `npm run check` | 上述检查，以及真实 Pi SDK/插件和任务工作流回归 |
| `npm run check:desktop` | Markdown、更新状态、模拟令牌端点的 OAuth、回环模型、账户与项目隔离 |
| `npm run check:all` | 日常完整检查，等于 `check` 加 `check:desktop` |
| `npm run desktop:package` | 构建当前源码的 Mac 预览安装包 |
| `npm run check:mac-package` | 脱离源码运行安装包，验证运行时、CodeGraph、链接、签名结构及 DMG/ZIP |
| `npm run clean` | 清理安装产物与下载缓存 |

仓库检查覆盖 Git 已跟踪和未忽略的新文件，不能代替密钥内容审查。新增顶层入口时先说明职责，再更新检查中的目录清单。测试使用系统临时项目和模拟账户，不依赖真实业务仓库或个人密钥。

向 main 推送、提出 PR 或手动触发 GitHub Actions 时，会在 Mac arm64 上从 `npm ci` 开始运行统一检查、构建和独立包检查。CI 只有读权限，不发布 Release，也不配置真实账户或签名证书。语法检查不是 TypeScript 类型检查；模拟模型测试不是业务质量验收。

## 发布与后续验收

版本以 `package.json` 为准；提交源码后构建，安装包记录源码提交。不得覆盖已公开版本资产。预览和正式签名发布共用 [发布流程](releasing.md)，下载入口见 [README](../README.md)。

当前仍需完成：另一台 Mac 上的完整任务与恢复、更多真实模型服务、Developer ID 签名与公证，以及两个正式版本之间的实际升级。Windows 和 Intel Mac 单独适配验证。新增专门能力按 [Agent 与插件开发](agent-development.md) 扩展现有接口。
