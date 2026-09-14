import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowserPage, browserPageUrl, redactBrowserText } from '../desktop/browser-page.mjs';
import { browserTool, browserConnectOptions } from '../desktop/browser-tool.mjs';
import { buildCollectionData } from '../desktop/collection-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, '.local/desktop-downloads/playwright');
const { chromium } = await import('playwright');
const { default: puppeteer } = await import('puppeteer-core');
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = server => `http://127.0.0.1:${server.address().port}`;
const stop = server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); };
function barrier() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

for (const value of ['file:///etc/passwd', 'javascript:alert(1)', 'http://example.com', 'https://a:b@example.com', 'https://example.com/#secret', 'https://example.com/?access_token=secret', 'https://example.com/\n']) assert.throws(() => browserPageUrl(value));
assert.equal(browserPageUrl('https://example.com/a?q=1').origin, 'https://example.com');
assert.equal(redactBrowserText('Bearer tokenvalue api_key=keyvalue password="with spaces"'), 'Bearer [REDACTED] api_key=[REDACTED] password=[REDACTED]');

test('owned browser page consent, filtering, navigation binding and cleanup', { timeout: 90000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'storm-page-channel-'));
  const profile = join(temporary, 'profile');
  let context, browser, channel;
  let crossRequests = 0, posts = 0, gets = 0;
  const cross = createServer((_req, res) => { crossRequests++; res.end('cross-origin secret'); });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/get') { gets++; return res.end('read'); }
    if (req.url === '/post') { posts++; return res.end('mutated'); }
    if (req.url === '/redirect') { res.writeHead(302, { Location: origin(cross) + '/cross' }); return res.end(); }
    if (req.url === '/download') { res.setHeader('Content-Disposition', 'attachment; filename="never-download.html"'); return res.end('download'); }
    if (req.url?.startsWith('/table')) {
      const header = req.url === '/table-secret' ? 'password' : '金额';
      const count = req.url === '/table-large' ? 51 : 2;
      return res.end('<!doctype html><table><tr><th>订单号</th><th>'+header+'</th></tr>'+Array.from({length:count},(_,i)=>`<tr><td>A-${i+1}</td><td>${req.url === '/table-secret' ? 'credential-value' : (i+1)*10}</td></tr>`).join('')+'</table>');
    }
    if (req.url === '/long') return res.end('<!doctype html><p>' + '合成文本'.repeat(10000) + '</p>');
    if (req.url === '/changed') return res.end('<!doctype html><h1>不允许回传的新页面内容</h1>');
    if (req.url === '/requests') return res.end(`<!doctype html><h1>请求测试</h1><p id="done">pending</p><script>Promise.allSettled([fetch('/get'),fetch('/post',{method:'POST'}),fetch('${origin(cross)}/cross')]).then(()=>document.querySelector('#done').textContent='done')</script>`);
    res.end(`<!doctype html><meta charset="utf-8"><title>合成标题 Bearer title-secret</title><h1>安全数据</h1><p>api_key=body-secret</p><p>password="password-secret"</p><form><label>form-secret</label><input value="input-secret"></form><textarea>textarea-secret</textarea><input value="outside-input-secret"><div hidden>hidden-secret</div><div style="display:none">css-hidden-secret</div><div style="opacity:0"><span>opacity-secret</span></div><script>window.fixture='script-secret'</script>`);
  });
  const passed = [], report = { status: 'failed', passed,
    moduleSHA256: createHash('sha256').update(await readFile(join(root, 'desktop/browser-page.mjs'))).digest('hex'),
    toolSHA256: createHash('sha256').update(await readFile(join(root, 'desktop/browser-tool.mjs'))).digest('hex'),
    untested: ['个人浏览器/真实后台', 'WebSocket/ServiceWorker/系统网络隔离'] };
  t.after(async () => {
    const cleaned = await Promise.allSettled([channel?.close()]);
    cleaned.push(...await Promise.allSettled([browser?.disconnect(), context?.close(), stop(server), stop(cross)]));
    await rm(temporary, { recursive: true, force: true });
    report.cleanup = !server.listening && !cross.listening && !browser?.connected && cleaned.every(item => item.status === 'fulfilled');
    if (!report.cleanup) report.status = 'failed';
    const evidence = join(root, 'dist/browser-page-channel'); await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    assert.equal(report.cleanup, true);
  });
  await listen(cross); await listen(server);
  const base = origin(server);
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: ['--remote-debugging-port=0'] });
  const sentinel = context.pages()[0]; await sentinel.goto(base + '/sentinel');
  await sentinel.evaluate(() => { window.sentinel = 'keep-me'; });
  const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
  browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${path}`, defaultViewport: null,
    targetFilter: target => target.type() === 'browser', networkEnabled: false, issuesEnabled: false, protocolTimeout: 10000 });
  report.browser = await browser.version();
  const pass = name => { passed.push(name); console.log('PASS:', name); };
  const approved = { confirm: async () => true };
  await assert.rejects(openBrowserPage(browser, base + '/plain'), /确认界面/);
  await assert.rejects(openBrowserPage(browser, base + '/plain', { confirm: async () => false }), /取消/);
  await assert.rejects(openBrowserPage(browser, base + '/plain', { ...approved, signal: AbortSignal.abort() }));
  assert.equal(context.pages().length, 1); pass('missing UI, rejection and pre-abort never create a tab');

  let confirms = 0;
  channel = await openBrowserPage(browser, base + '/plain', { confirm: async () => { confirms++; return true; } });
  const data = await channel.read();
  assert.equal(confirms, 2); assert.match(data.text, /安全数据/);
  assert.equal(data.untrusted, true); assert.equal(data.source, base);
  assert.doesNotMatch(JSON.stringify(data), /title-secret|body-secret|password-secret|form-secret|input-secret|textarea-secret|hidden-secret|opacity-secret|script-secret/);
  assert.match(data.text, /REDACTED/);
  await channel.close(); await channel.close(); channel = undefined;
  assert.equal(await sentinel.evaluate(() => window.sentinel), 'keep-me');
  pass('separate open/read consent; fixed bounded extraction excludes forms, hidden content and common secrets; only owned tab closes');

  channel = await openBrowserPage(browser, base + '/long', approved);
  const long = await channel.read(); assert.ok(long.truncated); assert.ok(long.text.length <= 12000);
  await channel.close(); channel = undefined; pass('large document explicitly truncated');

  channel = await openBrowserPage(browser, base + '/requests', approved);
  const requestsPage = context.pages().find(page => page.url() === base + '/requests');
  await requestsPage.waitForFunction(() => document.querySelector('#done').textContent === 'done');
  assert.equal(gets, 1); assert.equal(posts, 0); assert.equal(crossRequests, 0);
  await channel.close(); channel = undefined; pass('same-origin GET allowed; POST and cross-origin request never reach server');
  await assert.rejects(openBrowserPage(browser, base + '/redirect', approved), /拒绝|失败/);
  assert.equal(crossRequests, 0); pass('cross-origin document redirect denied');
  await assert.rejects(openBrowserPage(browser, base + '/download', approved), /拒绝|失败/);
  pass('attachment document response denied');

  let count = 0;
  channel = await openBrowserPage(browser, base + '/plain', { confirm: async () => ++count === 1 });
  await assert.rejects(channel.read(), /读取已停止/); await channel.close(); channel = undefined;
  pass('read denial closes owned page and returns no content');

  channel = await openBrowserPage(browser, base + '/table', approved);
  const tableData = await channel.read();
  assert.deepEqual(tableData.tables[0].headers,['订单号','金额']);
  const collected = buildCollectionData({status:'confirmed',digest:'fixture',plan:{capture:'current-page-table',delivery:{format:'data'},source:{url:base+'/table'},fields:[{name:'订单号'},{name:'金额'}],samples:[['A-1','10']],maxRecords:10}},tableData);
  assert.deepEqual(collected.data.records,[['A-1','10'],['A-2','20']]);
  await channel.close(); channel = undefined;
  channel = await openBrowserPage(browser,base+'/table-secret',approved);
  const secretTable = await channel.read(); assert.equal(secretTable.tables[0].rows[0][1],'[REDACTED]'); assert.match(secretTable.tables[0].issue,/敏感/); assert.doesNotMatch(JSON.stringify(secretTable),/credential-value/);
  await channel.close(); channel = undefined;
  channel = await openBrowserPage(browser,base+'/table-large',approved);
  assert.match((await channel.read()).tables[0].issue,/50条/);
  await channel.close(); channel = undefined;
  pass('real standard-table extraction matches fixed truth; credential columns filtered and oversized table cannot be delivered');

  const entered = barrier(), release = barrier(); count = 0;
  channel = await openBrowserPage(browser, base + '/plain', { confirm: async () => {
    if (++count === 1) return true; entered.resolve(); return release.promise;
  } });
  const pending = channel.read(); const rejected = assert.rejects(pending, /页面变化/);
  await entered.promise;
  await assert.rejects(channel.read(), /并发/);
  const changed = context.pages().find(page => page.url() === base + '/plain');
  await changed.goto(base + '/changed'); release.resolve(true);
  await rejected; await channel.close(); channel = undefined;
  pass('parallel read refused; navigation while consent is pending invalidates the read');

  const changedWithin = barrier(), allowWithin = barrier(); count = 0;
  channel = await openBrowserPage(browser, base + '/plain', { confirm: async () => {
    if (++count === 1) return true; changedWithin.resolve(); return allowWithin.promise;
  } });
  const invalidated = assert.rejects(channel.read(), /页面变化/);
  await changedWithin.promise;
  const sameDocument = context.pages().find(page => page.url() === base + '/plain');
  await sameDocument.evaluate(() => { history.pushState({}, '', '/changed'); history.replaceState({}, '', '/plain'); });
  allowWithin.resolve(true); await invalidated; await channel.close(); channel = undefined;
  pass('same-document navigation away and back invalidates consent even with unchanged URL/loader');

  const closingWait = barrier(); count = 0;
  channel = await openBrowserPage(browser, base + '/plain', { confirm: async () => {
    if (++count === 1) return true; closingWait.resolve(); return new Promise(() => {});
  } });
  const closedRead = assert.rejects(channel.read(), /读取已停止/);
  await closingWait.promise; await channel.close(); await closedRead; channel = undefined;
  pass('explicit close cancels an outstanding confirmation without waiting for UI');

  const abort = new AbortController(), waiting = barrier(); count = 0;
  channel = await openBrowserPage(browser, base + '/plain', { signal: abort.signal, confirm: async () => {
    if (++count === 1) return true; waiting.resolve(); return new Promise(() => {});
  } });
  const cancelled = assert.rejects(channel.read(), /取消/);
  await waiting.promise; abort.abort(); await cancelled;
  await channel.close(); channel = undefined;
  assert.equal(await sentinel.evaluate(() => window.sentinel), 'keep-me');
  assert.equal(context.pages().length, 1);
  pass('abort stops pending confirmation, closes owned tab and preserves unrelated page/browser');
  for (const outcome of ['false', 'missing', 'throw']) {
    let closes = 0, detaches = 0;
    const wrapped = { target: () => ({ createCDPSession: async () => {
      const session = await browser.target().createCDPSession();
      return new Proxy(session, { get(target, key) {
        if (key === 'send') return (method, ...args) => {
          if (method !== 'Target.closeTarget') return target.send(method, ...args);
          closes++;
          if (outcome === 'throw') return Promise.reject(new Error('raw protocol secret'));
          return Promise.resolve(outcome === 'false' ? { success: false } : {});
        };
        if (key === 'detach') return () => { detaches++; return target.detach(); };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    } }) };
    channel = await openBrowserPage(wrapped, base + '/plain', approved);
    const owned = context.pages().find(page => page.url() === base + '/plain');
    try {
      await assert.rejects(channel.close(), { message: '无法确认自有页面已关闭，请手动检查；不自动重连。' });
      await assert.rejects(channel.close(), /无法确认/);
      await assert.rejects(channel.read(), /已关闭/);
      assert.equal(closes, 1); assert.equal(detaches, 1);
      assert.equal(owned.isClosed(), false);
      assert.equal(await sentinel.evaluate(() => window.sentinel), 'keep-me');
    } finally {
      channel = undefined;
      await owned.close(); // Test-owner cleanup of the deliberately unclosed synthetic target.
    }
    let disconnects = 0;
    const failedHost = browserTool(async () => ({...wrapped, disconnect: async () => { disconnects++; }}));
    try {
      await assert.rejects(failedHost.tool.execute('failure', {url:base + '/plain'}, undefined, undefined,
        {hasUI:true, ui:{confirm:async () => true}}), /无法确认/);
      await assert.rejects(failedHost.stop(), /无法确认/);
      await assert.rejects(failedHost.tool.execute('retry', {url:base + '/plain'}, undefined, undefined,
        {hasUI:true, ui:{confirm:async () => true}}), /无法确认/);
      assert.equal(disconnects, 1);
    } finally { await context.pages().find(page => page.url() === base + '/plain')?.close(); }
  }
  pass('false/missing/failed close response reports uncertainty, releases connection and never retries or exposes protocol errors');
  let toolBrowser, connects = 0;
  const connect = async () => {
    connects++;
    const { channel: _channel, ...options } = browserConnectOptions;
    toolBrowser = await puppeteer.connect({ ...options, browserWSEndpoint: `ws://127.0.0.1:${port}${path}` });
    return toolBrowser;
  };
  const access = browserTool(connect);
  const call = (host, confirm, params = {url:base + '/plain'}, signal) => host.tool.execute('fixture', params, signal, undefined, {hasUI:true, ui:{confirm}});
  await assert.rejects(access.tool.execute('fixture', {url:base + '/plain'}, undefined, undefined, {hasUI:false}), /真实确认/);
  await assert.rejects(call(access, async () => false), /未同意/);
  await assert.rejects(call(access, async () => true, {url:base + '/plain', approved:true}), /只接受url/);
  assert.equal(connects, 0);
  const titles = [];
  const result = await call(access, async title => { titles.push(title); return true; });
  assert.equal(titles.length, 3); assert.match(result.content[0].text, /安全数据/);
  assert.equal(toolBrowser.connected, false); assert.equal(context.pages().length, 1);
  pass('one-shot tool validates host/input, confirms connection/open/read and closes/disconnects before returning');

  const toolWaiting = barrier();
  const cancelledTool = assert.rejects(call(access, async title => {
    if (title.includes('发送给模型')) { toolWaiting.resolve(); return new Promise(() => {}); }
    return true;
  }), /读取已停止/);
  await toolWaiting.promise;
  await assert.rejects(call(access, async () => true), /已有浏览器操作/);
  const observedClose = context.pages().find(page => page.url() === base + '/plain').waitForEvent('close', {timeout:10000});
  await Promise.all([access.stop(), cancelledTool, observedClose]);
  assert.equal(toolBrowser.connected, false); assert.equal(context.pages().length, 1);
  pass('host stop cancels pending read and awaits target/connection cleanup');

  const connecting = barrier(), connected = barrier();
  const late = browserTool(() => { connecting.resolve(); return connected.promise; });
  const lateResult = assert.rejects(call(late, async () => true), /连接失败、取消或超时/);
  await connecting.promise; await late.stop(); await lateResult;
  let lateDisconnects = 0;
  connected.resolve({disconnect: async () => { lateDisconnects++; }});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lateDisconnects, 1); assert.equal(context.pages().length, 1);
  pass('cancelled connect cannot open pages; late connection is disconnected without replay');
  assert.equal(await sentinel.evaluate(() => window.sentinel), 'keep-me');
  report.status = 'passed';
});
