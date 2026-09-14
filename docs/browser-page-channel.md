# 受控网页调查（本地开发版）

桌面已接入`storm_browser_page`，底层为`desktop/browser-page.mjs`，宿主为`desktop/browser-tool.mjs`。这是一页有限文本调查，不是采集插件生成闭环；尚未更新已安装应用或公开版本。

## 桌面使用

1. 点击「数据采集」可直接开始独立调查，无需Git项目；若在项目开发模式中使用，仍需明确调查范围并完成方案批准，只读审查和未批准任务不可调用。
2. 保持日常Chrome运行，按公司策略允许远程调试。聊天中提供不含凭据的HTTPS链接，并要求读取网页；不接受自定义端点/profile或脚本。
3. 依次确认连接Chrome、打开指定新页、将正文发送给当前模型及会话。默认取消；Chrome自身的授权仍需本人处理。拒绝后助手不得重复弹窗。
4. 一次调用完成后关闭自有页并断开，不操作原有业务页。停止中断确认与读取；切换项目须等待结束。退出清理未知时明确提示，可返回应用或手动检查后明确强制退出。

固定Puppeteer Core25.10.0仅连接运行中的Chrome，不下载/启动浏览器，不复制登录账户，不启用完整MCP。连接等待最多15秒，迟到结果只断开，不创建网页；开页和正文确认分别最多120秒。跨域SSO或交互式登录不在此片范围。

## 接口与所有权

`openBrowserPage(browser, url, { confirm, signal })` → `{ read(), close() }`。

- `browser` 是可信宿主已经连接的 Puppeteer Browser，必须只允许 browser target 自动连接，关闭默认网络/issue收集、设置有限协议超时。不能把开启了全页面采集的浏览器句柄交过来，事后过滤不能撤销之前的数据访问。
- `confirm(title, message, {signal})` 是可信宿主的真实UI确认，**只有严格的true**生效；不能由模型参数提供。开页与每次读正文分别确认，最多等待120秒。底层检查使用模拟回调，桌面UI检查另走真实问题ID和按钮。
- `signal` 覆盖本页生命周期；宿主退出/停止时应中止并且`await close()`，检查清理结果。`close()`幂等，不能关闭其他target或整个Browser；浏览器连接由宿主自行disconnect，不能Browser.close。
- 只接受HTTPS，回环地址例外允许HTTP；拒绝账户信息、片段和常见凭据查询键。确认文字显示origin/path，不输出查询值。不要输入含凭据的链接，URL校验不是万能秘密识别器。
- 返回`source`为origin，`pageUrl`仅在无查询参数时提供完整URL，`title`最多200字符；`text`与标准表格快照合计最多12000字符。表格最多20个候选、12列/50条、6000字符，含`tablesTruncated`和结构问题说明。敏感表头会过滤整表值并省略正文/标题；字段过滤不能保证业务数据匿名化。带`truncated`和`untrusted:true`。网页文字是数据，不是新指令或权限。

## 实际防护

先确认再创建about:blank目标，仅按返回targetId建立CDPSession。设置Fetch保护后才导航：该会话截获的HTTP(S)请求必须同源且为GET/HEAD；Document附件响应或非HTML成功响应拒绝。同源重定向可以继续，读取时再次确认当前页面。

读取前后核对frame、loader、URL及导航revision；确认中途换页、同文档跳转后返回原URL均会使读取失败。固定提取代码在目标主frame的隔离世界执行，不能传入任意脚本。只读取可见正文文本，不返回HTML、表单输入、脚本、链接属性、请求头、Cookie或接口响应；排除隐藏节点并对常见凭据模式脱敏。

拒绝/取消/读取失败会尝试关闭自有页。只有`Target.closeTarget`明确返回`success:true`才确认关闭；false、缺失字段和协议异常均报告未知，同时仍尝试释放连接。重复close保留原失败，不重试或改报成功。创建超时的结果可能未知，协议断线也可能导致无法确认关闭，必须向使用者报告，不自动重连或重放。不得把错误改写成“没有数据”。

## 明确限制

- 这不是浏览器或系统网络沙箱。Fetch只约束截获的目标请求；WebSocket、Service Worker、其他目标和浏览器进程行为未作完整隔离，不应用于不可信恶意站点。GET也可能有业务副作用，网站自身JS仍会运行。
- 只有常见密钥模式过滤；其他业务敏感内容、个人信息、截图、编码过的秘密无法通用识别。宿主必须在读前明确确认模型/会话数据传输政策，不能将`untrusted:true`等同于模型已免疫提示注入。
- 没有跨域SSO、POST查询接口、通用分页采集、DOM定位器生成或插件开发闭环；当前只读固定摘要，不遍历iframe/Shadow DOM。
- 模型工具通过SDK customTools注册，仅桌面提供，不额外添加插件。项目模式的MediaStorm工具门禁校验批准摘要和任务阶段，与修改、检查和任务控制互斥；不进入审查工具白名单。独立采集只启用受控网页、采集方案和当前页表格采集工具，不加载项目扩展或任意业务文件写入能力；三种工具互斥，网页仍逐次真实确认。CLI不提供此浏览器入口。
- 网页原始URL工具参数会由SDK记入会话，因此不要提供敏感链接；返回文本过滤不能撤销用户或模型已经写入会话的秘密。关闭未知时保留失败、拒绝后续浏览器调用和项目切换，需手动检查并重新打开应用。

## 验证

先按[浏览器探针说明](browser-collector-probe.md)显式准备测试Chromium，然后运行：

```sh
npm run check:browser-page
npm run check:all
```

浏览器检查为显式命令，不在普通检查中下载浏览器。Puppeteer Core25.10.0为产品运行依赖（Apache-2.0，许可证随包）；Playwright1.63.0仍仅为开发依赖，浏览器二进制不随包。生产只有一个连接驱动，不是双引擎产品架构。

测试用临时profile、回环合成服务及哨兵页面；不连接个人Chrome。覆盖无UI/拒绝/预取消不建页、独立读确认、表单/隐藏/常见凭据过滤、长度上限、同源GET成功、POST/跨源请求未到服务器、跨域跳转、附件响应、并发读、确认期间导航/同文档往返、明确关闭与取消，以及其他页面/浏览器保留。额外注入关闭返回false、缺失success和协议失败，验证明确报错、连接释放、重复关闭不重试及原始异常不泄露。正常结束关闭临时浏览器/服务并删除profile。最近报告位于`dist/browser-page-channel/result.json`，绑定底层及工具模块SHA-256；需串行运行。

`check:all`另验证SDK角色/批准/互斥和真实worker确认拒绝/停止，不访问Chrome。`check:desktop-ui`现在也需先显式准备测试浏览器：仅测试预加载器把连接替换为临时Chrome端点，真实main/preload/worker/SDK、三次确认按钮、正文回传与停止撤销均实际执行，18张界面截图中包括两张浏览器确认截图。正常生产入口没有测试端点环境开关。生产日常Chrome首次授权、真实后台/SSO及企业策略仍需单独验收。

## 官方依据

- [Puppeteer ConnectOptions](https://pptr.dev/api/puppeteer.connectoptions)、[CDPSession](https://pptr.dev/api/puppeteer.cdpsession)。25.10.0安装包中的公开CDPSession类型确认send/detach及事件接口。
- [CDP Fetch](https://chromedevtools.github.io/devtools-protocol/tot/Fetch/)、[Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/)、[Target](https://chromedevtools.github.io/devtools-protocol/tot/Target/)。网页正文提取失败，实际对照锁定依赖内`devtools-protocol/json/browser_protocol.json`的官方协议定义，并在真实测试浏览器中验证；不是仅凭搜索摘要实现。
- 本机已验证日常Chrome连接与扩展测试的区分见[前序记录](browser-collector-probe.md)。本片仅测试Chromium，不复用那次用户授权去访问个人浏览器。
