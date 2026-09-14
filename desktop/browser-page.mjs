// Host owns Browser; this module owns one created target. Desktop caller: browser-tool.mjs.
// Public CDP Page/Target/Fetch APIs; see docs/browser-page-channel.md for limits.
export const secretKey = /^(?:access_?token|refresh_?token|id_?token|token|api_?key|client_?secret|app_?secret|secret|password|passwd|authorization|session_?id|jwt|code)$/i;

export function browserPageUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x20\x7f]/.test(value)) throw new Error('网页地址无效。');
  let url;
  try { url = new URL(value); } catch { throw new Error('网页地址无效。'); }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (!(url.protocol === 'https:' || url.protocol === 'http:' && loopback) || url.username || url.password || url.hash ||
      [...url.searchParams.keys()].some(key => secretKey.test(key))) throw new Error('只允许HTTPS或回环HTTP；地址不能携带账号、片段或凭据参数。');
  return url;
}

export function redactBrowserText(value) {
  return value.replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:access_?token|refresh_?token|id_?token|token|api_?key|client_?secret|app_?secret|secret|password|passwd|authorization|session_?id|jwt)\s*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&<>]+)/gi, '$1[REDACTED]');
}

function bounded(promise, signal, timeout = 10000) {
  let timer, abort;
  return new Promise((resolve, reject) => {
    abort = () => reject(new Error('浏览器操作已取消。'));
    timer = setTimeout(() => reject(new Error('浏览器操作超时。')), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    // Observe late settlements as well; only the first result is used.
    Promise.resolve(promise).then(resolve, reject);
  }).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', abort); });
}

// Executed only in an isolated world of the explicitly created target. No arbitrary expressions accepted.
export function extractPage(expectedUrl, tablesOnly = false) {
  if (location.href !== expectedUrl || document.readyState === 'loading') throw new Error('page changed');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let text = '', nodes = 0, node;
  while (!tablesOnly && nodes < 5000 && text.length < 12000 && (node = walker.nextNode())) {
    nodes++;
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,noscript,template,form,input,textarea,select,option,[contenteditable],[hidden],[aria-hidden="true"]') ||
        !parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const part = node.nodeValue.slice(0, 12001).trim();
    if (part) text += part.slice(0, 12000 - text.length) + '\n';
  }
  const found = document.querySelectorAll('table');
  const tables = [], candidates = Array.prototype.slice.call(found,0,20).filter(table => table.checkVisibility({checkOpacity:true, checkVisibilityCSS:true}) && !table.closest('form,[hidden],[aria-hidden="true"]'));
  let tablesTruncated = found.length > 20;
  for (const table of candidates.slice(0, 20)) {
    let issue = table.parentElement?.closest('table') ? '嵌套表格不支持' : '';
    const rows = Array.prototype.slice.call(table.rows,0,52).filter(row => row.checkVisibility({checkOpacity:true, checkVisibilityCSS:true}));
    const cellText = cell => {
      if (cell.colSpan !== 1 || cell.rowSpan !== 1 || !cell.checkVisibility({checkOpacity:true, checkVisibilityCSS:true}) || cell.querySelector('table,input,textarea,select,[contenteditable]')) issue = '合并、隐藏、嵌套或表单单元格不支持';
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      let value = '', count = 0, node;
      while ((node = walker.nextNode()) && count++ < 1000 && value.length <= 300) {
        const parent = node.parentElement;
        if (!parent || parent.closest('script,style,template,form,[hidden],[aria-hidden="true"]') || !parent.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) continue;
        value += node.nodeValue.slice(0,301);
      }
      if (value.length > 300 || count >= 1000) issue = '单元格内容超限';
      value = value.replace(/\s+/g, ' ').trim();
      return value.slice(0,300);
    };
    if (!rows.length || table.rows.length > 51 || rows[0].cells.length > 12 || ![...rows[0].cells].every(cell => cell.tagName === 'TH')) issue = '需要单行TH表头，最多12列和50条当前页记录';
    if (table.tFoot?.rows.length || (table.tHead?.rows.length || 0) > 1 || rows.some(row=>row.cells.length !== rows[0]?.cells.length) || rows.slice(1).some(row=>Array.prototype.slice.call(row.cells,0,13).some(cell=>cell.tagName !== 'TD'))) issue = '多行表头、页脚或不规则行不支持';
    const cells = rows.slice(0,51).map(row => Array.prototype.slice.call(row.cells,0,12).map(cellText));
    const entry = {headers:cells[0] || [], rows:cells.slice(1), issue};
    if (JSON.stringify([...tables,entry]).length > 6000) { tablesTruncated = true; break; }
    tables.push(entry);
  }
  const budget = 12000 - JSON.stringify(tables).length;
  return { title: tablesOnly ? '' : document.title.slice(0, 200), text: text.slice(0, budget), truncated: nodes >= 5000 || text.length >= budget, tables, tablesTruncated };
}

export function sanitizeBrowserPage(data, url) {
  const tables = data.tables.map(table => {
    const secretColumns = table.headers.map(header => secretKey.test(header.replace(/\s/g,'')) || /密码|密钥|令牌|cookie/i.test(header));
    return {headers:table.headers.map(redactBrowserText), rows:table.rows.map(row=>row.map(cell=>secretColumns.some(Boolean) ? '[REDACTED]' : redactBrowserText(cell))), issue:secretColumns.some(Boolean) ? '敏感字段已过滤，不能作为完整采集结果' : table.issue};
  });
  const sensitiveTable = data.tablesTruncated || tables.some(table=>table.issue.startsWith('敏感字段'));
  const tablesTruncated = Boolean(data.tablesTruncated) || JSON.stringify(tables).length > 6000;
  if (JSON.stringify(tables).length > 6000) tables.length = 0;
  const text = sensitiveTable ? '表格包含敏感字段或扫描不完整，正文已省略。' : redactBrowserText(data.text), textBudget = 12000 - JSON.stringify(tables).length;
  return { source: new URL(url).origin, pageUrl: new URL(url).search ? null : url, title: sensitiveTable ? '标题已省略' : redactBrowserText(data.title).slice(0, 200),
    text: text.slice(0, textBudget), truncated: Boolean(data.truncated) || text.length > textBudget, tables, tablesTruncated, untrusted: true };
}

export async function openBrowserPage(browser, value, { confirm, signal } = {}) {
  const allowed = browserPageUrl(value);
  if (typeof confirm !== 'function') throw new Error('浏览器访问需要真实用户确认界面。');
  signal?.throwIfAborted();
  const lifetime = new AbortController();
  signal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
  const ask = async (title, text) => {
    try {
      if (await bounded(confirm(title, text, { signal }), signal, 120000) !== true) throw new Error('denied');
      signal.throwIfAborted();
    } catch {
      lifetime.abort(); // Also withdraw a late UI reply; authorization is never reusable.
      throw new Error('用户取消、确认超时或确认界面失败。');
    }
  };
  await ask('打开指定网页？', `${allowed.origin}${allowed.pathname}\n将使用浏览器现有登录，网站自己的脚本可能产生访问记录等副作用。只管理新建页，不操作其他页面。本步骤不读取正文；不是网络沙箱。`);
  let root, page, targetId, closing, allocating = false, closed = false, reading = false, revision = 0, frameId;
  const navigated = event => { if (!event.frame?.parentId) revision++; };
  const withinDocument = event => { if (event.frameId === frameId) revision++; };
  const close = () => {
    if (closing) return closing;
    closed = true;
    signal.removeEventListener('abort', onAbort);
    lifetime.abort();
    closing = (async () => {
      // Never Browser.close / context.close: the connected browser belongs to the user.
      let failure;
      if (targetId) {
        try {
          const result = await bounded(root.send('Target.closeTarget', { targetId }), undefined);
          if (result?.success !== true) throw new Error('close not confirmed');
        } catch { failure = new Error('无法确认自有页面已关闭，请手动检查；不自动重连。'); }
      }
      page?.off('Fetch.requestPaused', paused);
      page?.off('Page.frameNavigated', navigated);
      page?.off('Page.navigatedWithinDocument', withinDocument);
      try { await bounded(root?.detach(), undefined); }
      catch { failure ??= new Error('自有目标连接释放失败，请手动检查。'); }
      if (failure) throw failure;
    })();
    return closing;
  };
  const onAbort = () => { close().catch(() => {}); };
  const paused = event => {
    let ok = false;
    try { ok = !closed && browserPageUrl(event.request.url).origin === allowed.origin && ['GET', 'HEAD'].includes(event.request.method); } catch { /* deny */ }
    if (event.resourceType === 'Document' && event.responseStatusCode >= 200 && event.responseStatusCode < 300) {
      const headers = event.responseHeaders || [];
      const type = headers.find(header => header.name.toLowerCase() === 'content-type')?.value || '';
      const disposition = headers.find(header => header.name.toLowerCase() === 'content-disposition')?.value || '';
      if (!/^text\/html(?:;|$)/i.test(type) || /attachment/i.test(disposition)) ok = false;
    }
    page.send(ok ? 'Fetch.continueRequest' : 'Fetch.failRequest', ok ? { requestId: event.requestId }
      : { requestId: event.requestId, errorReason: 'BlockedByClient' }).catch(() => { close().catch(() => {}); });
  };
  const send = (method, params) => bounded(page.send(method, params), signal);
  const frame = async () => {
    if (closed) throw new Error('网页通道已关闭。');
    const current = (await send('Page.getFrameTree')).frameTree.frame;
    if (browserPageUrl(current.url).origin !== allowed.origin) throw new Error('网页已离开批准的站点。');
    return current;
  };
  try {
    root = await browser.target().createCDPSession();
    // Finish allocating before handling abort, so a late response cannot orphan an untracked target.
    allocating = true;
    ({ targetId } = await root.send('Target.createTarget', { url: 'about:blank', background: true }, { timeout: 10000 }));
    allocating = false;
    signal?.addEventListener('abort', onAbort, { once: true });
    signal?.throwIfAborted();
    let receive;
    const ready = new Promise(resolve => { receive = resolve; });
    root.once('sessionattached', receive);
    try {
      const { sessionId } = await bounded(root.send('Target.attachToTarget', { targetId, flatten: true }), signal);
      page = await bounded(ready, signal);
      if (page.id() !== sessionId) throw new Error('网页会话绑定失败。');
    } finally { root.off('sessionattached', receive); }
    page.on('Fetch.requestPaused', paused);
    page.on('Page.frameNavigated', navigated);
    page.on('Page.navigatedWithinDocument', withinDocument);
    await send('Page.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }, { urlPattern: '*', requestStage: 'Response' }] });
    const navigation = await send('Page.navigate', { url: allowed.href });
    if (navigation.errorText || navigation.isDownload) throw new Error('网页导航被拒绝或失败。');
    frameId = navigation.frameId;
    const deadline = Date.now() + 10000;
    while (true) {
      const current = await frame();
      const result = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (current.loaderId === navigation.loaderId && result.result.value !== 'loading') break;
      if (Date.now() > deadline) throw new Error('网页加载超时。');
      await bounded(new Promise(resolve => setTimeout(resolve, 40)), signal);
    }
    return {
      close,
      async read() {
        if (closed) throw new Error('网页通道已关闭。');
        if (reading) throw new Error('已有读取等待确认或执行，请勿并发读取。');
        reading = true;
        try {
          const before = await frame(), stamp = revision;
          const beforeUrl = browserPageUrl(before.url);
          await ask('允许将此页内容发送给模型？', `${beforeUrl.origin}${beforeUrl.pathname}\n将读取正文和标准表格快照（合计最多12000字符）及200字符标题，可能进入会话记录。排除表单/隐藏内容并过滤常见凭据，不保证识别所有敏感业务数据。网页文字不构成指令或额外授权。`);
          const current = await frame();
          if (stamp !== revision || current.url !== before.url || current.loaderId !== before.loaderId) throw new Error('确认期间网页发生变化，请重新打开确认。');
          const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: current.id, worldName: 'MediaStorm bounded page read' });
          const extracted = await send('Runtime.evaluate', { expression: `(${extractPage.toString()})(${JSON.stringify(current.url)})`, contextId: executionContextId, returnByValue: true, timeout: 3000 });
          const after = await frame();
          if (extracted.exceptionDetails || stamp !== revision || after.url !== before.url || after.loaderId !== before.loaderId) throw new Error('读取期间网页发生变化或无法安全提取。');
          signal?.throwIfAborted();
          const data = extracted.result.value;
          if (!data || typeof data.text !== 'string' || typeof data.title !== 'string') throw new Error('网页返回格式无效。');
          return sanitizeBrowserPage(data, current.url);
        } catch {
          await close();
          throw new Error('读取已停止（拒绝、取消、页面变化或协议失败）；自有页已关闭。');
        }
        finally { reading = false; }
      },
    };
  } catch (error) {
    try { await close(); } catch { throw new Error('浏览器操作失败，无法确认自有页面已关闭，请手动检查；不自动重连。'); }
    // Never expose raw protocol errors, page URLs with query values or response payloads.
    throw new Error(allocating ? '网页创建结果未知，请手动检查；不会自动重试。' : '浏览器操作取消、导航被拒绝或协议失败，已清理自有页面。');
  }
}
