# 浏览器采集插件：第一片技术验证

这是开发检查，不是已上线功能。固定使用 Playwright 1.63.0（Apache-2.0）作为开发测试依赖，尚未选定产品浏览器引擎；不修改桌面入口，不内置 DrissionPage。

## 运行

在项目根目录，先安装锁定依赖，再显式下载测试浏览器：

```sh
npm ci
PLAYWRIGHT_BROWSERS_PATH="$PWD/.local/desktop-downloads/playwright" node node_modules/playwright/cli.js install chromium --no-shell
npm run check:browser-collector
```

浏览器版本由 Playwright 固定。下载缓存位于 `.local/desktop-downloads/playwright`，`npm run clean` 可清理；检查本身不下载浏览器，缺失会失败。此检查不加入 `check:all`，避免日常回归隐式下载大型浏览器。

检查会启动独立无头测试浏览器，创建回环合成后台和临时插件/profile。成功或失败后关闭浏览器和服务、删除临时目录。不会连接个人 Chrome、固定 9222 端口或真实后台。仅支持内置测试目标，不接受任意网址/profile/调试端点。

串行运行；最近一次报告与合成页面截图覆盖写入 `dist/browser-collector-probe/`。报告记录测试脚本与扩展文件哈希、实际版本、通过项、未测项及清理结果；它不是产品任务的正式交付证据。清理安装产物会删除报告。

另有故障注入用于验证失败清理：

```sh
npm run check:browser-collector -- --fail-after-launch
```

此命令**应退出 1**，报告应为 `status: failed`、`cleanup: true`，不是普通成功测试。结束后重新执行正常检查可恢复成功报告。报告缺失或清理失败都不能算通过。

## 本机验证结果

Mac arm64：Playwright 1.63.0，Chrome for Testing 153.0.8010.12，CDP 1.3。

- 真正加载 MV3 service worker 与 content script；由插件自身进行接口采集与页面翻页，均与五行固定真值一致。
- 匿名访问拒绝；首次模拟登录后，完整关闭/重启浏览器仍能采集，服务端仅记录一次登录。
- 连接自主启动浏览器的既有上下文和标签页，验证页面内随机标记仍在；连接后采集正常，断开不关闭原浏览器。
- 服务端撤销会话后拒绝；显式重新登录恢复。
- 分页中途 503、重复记录、响应超时均报错且不交付部分数据。
- 不加载插件时页面没有采集入口；独立空 profile 不继承登录。
- 主动注入启动后错误仍关闭浏览器/服务并删除临时目录；正常运行也验证清理。

## 不能由此推断

这只是**人工编写的合成插件**和测试后台，不是 AI 已能自动开发任意插件。尚未验证截图输入、生产工具门禁、取消 UI、跨域接口、验证码、企业 SSO、浏览器管理策略、扩展商店分发或用户业务验收。

尤其不能把以下两件事混为一谈：

1. 已通过：专用 profile 持久化，以及连接自主启动且允许 CDP 的测试浏览器。
2. 日常 Chrome 授权连接不能由上面的合成 CDP 测试推断；另一次经用户授权的手动验证结果见下节。正式插件运行在同事自己的已登录页面，不应要求复制 Cookie 或在插件里写账号密码。

## 日常 Chrome 连接补充验证

经用户单独授权，临时安装并核对官方 `chrome-devtools-mcp 1.9.0` 与 `puppeteer-core 25.10.0`，不添加产品依赖。本机通过 Puppeteer 官方 `connect({channel: 'chrome'})` 成功连接**已运行的 Chrome 145.0.7632.117**，没有启动或重启浏览器。

只新建合成回环页面：匿名读取返回401，模拟登录后返回固定数据；断开并重新连接后，原页面内随机标记和合成登录均保留，登录请求计数仍为1。结束时主动过期测试Cookie，按自有targetId关闭测试页并断开连接。已有业务页正文、Cookie和接口未读取。此验证不证明真实后台SSO兼容、浏览器重启后的登录或全新机器的首次授权弹窗体验。

**没有启用整套 MCP 工具。** 1.9.0 的页面快照建立过程会初始化已有页面的网络/控制台采集器，而 `allowedUrlPattern` 要求 Chrome149+。为避免扩大访问，本次只验证其底层官方连接机制：关闭默认网络/issue监听，拒绝自动连接页面，仅按本次创建返回的targetId建立CDP会话。连接库仍会接收浏览器目标元数据用于发现，但不把页面列表输出到模型或证据。这是访问范围控制，不是浏览器或网络沙箱。

探针曾出现页面发现超时与新建页导航竞态，均按自有targetId清理后修正；最终在执行采集动作前等待目标URL实际提交和DOM就绪。不能把Target元数据中的URL当作页面已加载的证据。

结论：不需要因“每次重新登录”直接选择DrissionPage。日常Chrome授权连接技术上可用，但正式接入必须先实现目标页绑定、敏感数据过滤、断线恢复和退出清理；不能原样开放整个MCP工具集合。Playwright仍仅为前一节的开发测试驱动，产品引擎尚未最终选定。

## 官方依据

- [Playwright 1.63.0 扩展测试](https://github.com/microsoft/playwright/blob/v1.63.0/docs/src/chrome-extensions-js-python.md)：持久上下文、Chromium channel、MV3 worker、侧载限制。
- [BrowserType 1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/docs/src/api/class-browsertype.md)：持久化目录与 `connectOverCDP`；默认 Chrome profile 限制及 CDP 兼容差异。
- [Chrome 现有会话授权连接](https://developer.chrome.com/docs/devtools/agents/get-started/configuration)：官方 DevTools MCP 的 `autoConnect`，不能假定其他库原生提供同样连接流程。

Playwright/Playwright Core 许可证保留在开发依赖中。本片浏览器仅用于本地测试，不随 MediaStorm 安装包分发；将来内置时需单独核对浏览器许可和通知。
