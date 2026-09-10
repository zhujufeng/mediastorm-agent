# 桌面界面约定

Electron 44.3.0、原生 HTML/CSS/JavaScript，无 React 和 UI 框架。入口 desktop/index.html、app.js、app.css；Markdown 在 markdown.mjs，主进程与 Pi worker 不进入 renderer。开发前阅读任务 PRD、docs/desktop-pilot.md 和 backend/desktop-runtime.md。

- 中文、原生表单与 dialog、可访问标签、可见焦点；Enter 发送，Shift+Enter 换行，中文组合输入期间不触发发送。
- 主体是项目侧栏和对话；历史按项目展示，任务细节可收起，当前阶段仍在顶部可见。颜色使用 CSS tokens，系统深浅色同步。
- 首次使用明确连接模型、打开项目两步。已有凭据不等于模型权限已通过测试；实际成功测试才提示连接可用。
- OAuth prompt 保留来源和类型，使用设置里的 auth-progress，禁止加入普通 question 模态队列。manual_code 是与自动回调竞速的备用输入，默认折叠，不抢焦点，不遮住授权链接。取消/超时/回调后清空输入和过期请求。
- 成功反馈与错误区分颜色和文案；登录成功自动保存所选模型。中转站“保存并测试”先保存当前表单，不能测试旧设置后误报当前输入可用。
- Model、工具结果、错误和 Git diff 通过 textContent 呈现。Markdown 只复用随 Pi 固定的 marked lexer，按 DOM 类型白名单创建节点；原始 HTML、图片和链接不执行、不联网，不使用 innerHTML。
- 历史与实时消息共用 worker 的可见角色过滤，禁止短暂显示 display:false 的内部扩展上下文。
- 工作流确认默认聚焦取消；Esc、停止、切换项目不能隐式批准。OAuth 不需要普通工作流确认。
- 读历史时不强制滚到底部；消息发送失败保留输入，密钥保存后清空。代码复制仅请求剪贴板写权限，不读取剪贴板。

## 验证

npm run check:desktop 包含 Markdown 安全输出、真实 SDK OAuth 本机回调（模拟令牌端点）和桌面工作流/会话隔离回归。实际桌面还要验证登录自动开浏览器与返回、设置、流式、确认/取消、代码复制、历史和差异预览。模拟测试不代替真实账户；记录真实账号是否完成授权和实际请求，不能由 UI“已登录”推断业务质量。
