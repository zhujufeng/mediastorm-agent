# 内置飞书 CLI

当前源码内置官方 [larksuite/cli](https://github.com/larksuite/cli) **1.0.90**（MIT）。随 Mac arm64 安装包提供，不需要员工再安装 Node/npm/CLI；从 0.5.0 预览版起随包提供。

## 怎么用

选择项目后，直接说“读取这张飞书多维表格”“分析表里的数据”“把结果写成飞书文档”。助手通过 `storm_lark` 调用 CLI，并按需读取 CLI 内嵌的领域技能和参考文档。不新增公司后端或飞书专用登录页。

代码审查角色只允许离线版本、帮助和技能读取，不开放飞书业务调用；需先明确离开审查模式。其他角色的离线版本、帮助与技能读取不询问；联网/业务操作会展示参数并要求单独确认。取消就不执行。飞书使用的是 CLI 当前配置的账户，并非模型订阅账户；不要仅凭插件显示“已加载”判断已登录。

## 首次配置或登录

在 Mac 的“终端”中使用随包程序。下例假设应用安装在 `/Applications`；不同安装位置请替换路径。

```sh
LARK="/Applications/MediaStorm Agent.app/Contents/Resources/app/runtime/bin/lark-cli"
"$LARK" --version
"$LARK" auth status
```

如果此前在 Codex 等工具中使用官方 CLI，可能可以复用同一系统用户的配置/钥匙串；以实际状态为准。**不要为复用而复制密钥文件或重新创建应用。**

确实首次使用时，按 CLI 原生引导配置并在浏览器完成操作：

```sh
"$LARK" config init
"$LARK" auth login --help
```

选择此次所需的最小业务域授权，例如只处理云文档时：

```sh
"$LARK" auth login --domain docs
```

多维表格或其他域的具体范围按该版本 `auth login --help` / 领域技能提示选择，不默认授权全部域。返回助手后，再确认执行一次账户检查。原生终端登录流程不属于桌面模型订阅登录；没有桌面一键飞书登录承诺。

源码环境先 `npm run desktop:runtime`，再从平台根目录使用 `./runtime/bin/lark-cli`。Mac arm64之外的内置分发尚未验证。

## 边界

- CLI保留上游配置与凭据存储方式；不是产品的 `credentials.enc`。安装包不带任何账户；卸载/清理平台构建不会清除 CLI 账户。退出使用 CLI 原生 `auth logout`，服务端授权撤销另按飞书授权管理操作。
- 不向助手发送 App Secret、access token、refresh token。输出仅做常见令牌键与Bearer值脱敏，不保证任意业务文本中都不存在秘密。
- 原始业务结果可能进入模型请求和本地 Pi 会话；仅授权读取公司允许送入当前模型的数据。大表优先按上游SOP导出最小字段并程序计算。
- 发消息、改数据、删除、发布前核对对象和影响。上游高风险确认返回不代表成功，不能自动追加确认参数重试；超时结果不明时先核查。
- `storm_lark` 不运行自更新、配置/登录、底层 `api` 或任意可执行程序；需要这些能力时使用原生终端。嵌入技能的assets/scripts未随CLI提供，不能当存在使用。
- 内置CLI随产品升级；不要在已签名应用包中自更新。没有公司级集中权限/审计，也不是项目命令沙箱。
- 不解除原本的Bash工作流限制。非离线CLI调用可能导出本地文件，会保守失效活动任务的旧检查；取消后也需重新检查。

## 维护与检查

`prepare-desktop-runtime.mjs` 固定官方发行URL和SHA-256，归档中的许可证及文档保存在 `runtime/lark`；相对启动链接在 `runtime/bin/lark-cli`。禁止复制个人全局安装作为构建输入。

```sh
npm run desktop:runtime
npm run check:all
npm run desktop:package
npm run check:mac-package
```

`check:lark` 使用临时目录、离线CLI文档及假可执行程序验证：固定版本、内嵌技能、许可、参数不经shell、取消/无UI不执行、退出码、缺失运行时。独立包检查重复验证，不依赖开发机全局CLI。真实账户登录和真实业务操作需单独人工验收，不能用离线检查冒充。
