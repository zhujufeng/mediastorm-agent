// Opt-in feasibility probe, not a product browser controller or a production collector.
// APIs: https://github.com/microsoft/playwright/blob/v1.63.0/docs/src/chrome-extensions-js-python.md
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Fixed project-owned cache; never discover personal profiles or debug endpoints.
process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, '.local/desktop-downloads/playwright');
const { chromium } = await import('playwright');
assert.ok(process.argv.slice(2).every(arg => arg === '--fail-after-launch'), 'only --fail-after-launch is supported');
const truth = [
  { id: '1', name: '合成项目甲' }, { id: '2', name: '合成项目乙' },
  { id: '3', name: '合成项目丙' }, { id: '4', name: '合成项目丁' }, { id: '5', name: '合成项目戊' },
];

// These functions are written into the isolated fixture/extension, not evaluated by the driver.
function fixturePage() {
  let page = 0;
  async function load(next) {
    const res = await fetch('/rows?page=' + next);
    document.querySelector('#session').textContent = res.ok ? '已登录' : '需要登录';
    const data = res.ok ? await res.json() : { rows: [], next: null };
    const body = document.querySelector('tbody'); body.replaceChildren();
    for (const row of data.rows) {
      const tr = body.insertRow();
      tr.insertCell().textContent = row.id; tr.insertCell().textContent = row.name;
    }
    page = next;
    document.querySelector('#next').disabled = data.next === null;
    body.dataset.page = String(page);
  }
  document.querySelector('#login').onclick = async () => { await fetch('/login', { method: 'POST' }); await load(0); };
  document.querySelector('#revoke').onclick = async () => { await fetch('/revoke', { method: 'POST' }); await load(0); };
  document.querySelector('#next').onclick = () => load(page + 1);
  load(0);
}

function collector(origin) {
  if (location.origin !== origin || location.pathname !== '/probe') return;
  const area = document.createElement('section'); area.id = 'collector';
  const output = document.createElement('pre'); output.id = 'collector-result';
  const controls = [];
  for (const mode of ['api', 'dom']) {
    const button = document.createElement('button'); button.id = 'collect-' + mode;
    button.textContent = mode === 'api' ? '插件采集接口' : '插件采集页面';
    button.onclick = async () => {
      controls.forEach(control => { control.disabled = true; });
      output.textContent = ''; output.dataset.state = 'running';
      try {
        const identity = await chrome.runtime.sendMessage('identity');
        const rows = [];
        for (let page = 0; page < 10; page++) {
          let batch, next;
          if (mode === 'api') {
            const res = await fetch('/rows?page=' + page, { signal: AbortSignal.timeout(2000) });
            if (res.status === 401) throw new Error('需要登录');
            if (!res.ok) throw new Error('接口失败: ' + res.status);
            ({ rows: batch, next } = await res.json());
          } else {
            if (document.querySelector('#session').textContent !== '已登录') throw new Error('需要登录');
            const body = document.querySelector('tbody');
            if (body.dataset.page !== String(page)) throw new Error('页面位置不匹配');
            batch = [...body.rows].map(row => ({ id: row.cells[0].textContent, name: row.cells[1].textContent }));
            next = document.querySelector('#next').disabled ? null : page + 1;
          }
          if (!Array.isArray(batch) || batch.some(row => typeof row.id !== 'string' || typeof row.name !== 'string')) throw new Error('字段不完整');
          rows.push(...batch);
          if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('重复记录');
          if (next === null) {
            output.textContent = JSON.stringify({ identity, mode, rows });
            output.dataset.state = 'done'; return;
          }
          if (next !== page + 1) throw new Error('分页不连续');
          if (mode === 'dom') {
            document.querySelector('#next').click();
            const deadline = Date.now() + 2000;
            while (document.querySelector('tbody').dataset.page !== String(next)) {
              if (Date.now() > deadline) throw new Error('翻页超时');
              await new Promise(resolve => setTimeout(resolve, 25));
            }
          }
        }
        throw new Error('超过页数上限');
      } catch (error) {
        output.textContent = JSON.stringify({ error: error.message });
        output.dataset.state = 'error';
      } finally { controls.forEach(control => { control.disabled = false; }); }
    };
    controls.push(button); area.append(button);
  }
  area.append(output); document.body.append(area);
}

test('synthetic login persistence, existing CDP session and actual MV3 collector', { timeout: 90000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'storm-browser-probe-'));
  const profile = join(temporary, 'profile'), extension = join(temporary, 'extension');
  const evidence = join(root, 'dist/browser-collector-probe');
  let context, attached, loggedIn = false, cookie = '', failPage = false, stallPage = false, duplicate = false;
  let logins = 0;
  const passed = [], pageErrors = [], browsers = [];
  const report = { status: 'failed',
    playwright: JSON.parse(await readFile(join(root, 'node_modules/playwright/package.json'), 'utf8')).version,
    checkSHA256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'), passed,
    untested: ['日常Chrome授权autoConnect', '真实后台SSO/企业浏览器策略', '自然语言生成插件', '产品集成与分发'] };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (url.pathname === '/login' && req.method === 'POST') {
      loggedIn = true; cookie = randomUUID(); logins++;
      // Synthetic HTTP-only loopback fixture, NOT a production authentication implementation.
      res.setHeader('Set-Cookie', `probe=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
      return res.end('{}');
    }
    if (url.pathname === '/revoke' && req.method === 'POST') { loggedIn = false; return res.end('{}'); }
    if (url.pathname === '/rows') {
      if (!loggedIn || !req.headers.cookie?.split('; ').includes('probe=' + cookie)) {
        res.statusCode = 401; return res.end('{}');
      }
      const page = Number(url.searchParams.get('page'));
      if (!Number.isInteger(page) || page < 0 || page > 9) { res.statusCode = 400; return res.end('{}'); }
      if (page === 1 && stallPage) return; // Owned connection is closed by the fetch deadline / cleanup.
      if (page === 1 && failPage) { res.statusCode = 503; return res.end('{}'); }
      const rows = duplicate && page === 1 ? truth.slice(0, 2) : truth.slice(page * 2, page * 2 + 2);
      return res.end(JSON.stringify({ rows, next: page * 2 + 2 < truth.length ? page + 1 : null }));
    }
    if (url.pathname === '/page.js') {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      return res.end(`(${fixturePage.toString()})();`);
    }
    if (url.pathname === '/probe') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'");
      return res.end('<!doctype html><meta charset="utf-8"><title>合成采集后台</title><h1>合成采集后台</h1><p id="session">加载中</p><button id="login">模拟登录</button><button id="revoke">撤销会话</button><table><thead><tr><th>ID</th><th>名称</th></tr></thead><tbody></tbody></table><button id="next" disabled>下一页</button><script src="/page.js"></script>');
    }
    res.statusCode = 404; res.end('{}');
  });
  t.after(async () => {
    const cleanup = await Promise.allSettled([attached?.close(), context?.close()]);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
    assert.equal(await access(temporary).then(() => true, () => false), false);
    report.browsersDisconnected = browsers.every(browser => !browser.isConnected());
    report.cleanup = cleanup.every(result => result.status === 'fulfilled') && !server.listening && report.browsersDisconnected;
    if (!report.cleanup) report.status = 'failed';
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    assert.ok(report.cleanup, 'browser/server cleanup must succeed');
  });
  await mkdir(evidence, { recursive: true });
  await rm(join(evidence, 'result.json'), { force: true });
  await rm(join(evidence, 'extension.png'), { force: true });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await mkdir(extension);
  const sources = {
    'manifest.json': JSON.stringify({ manifest_version: 3, name: 'Synthetic collector probe', version: '1.0.0',
      background: { service_worker: 'background.js' },
      content_scripts: [{ matches: ['http://127.0.0.1/probe'], js: ['content.js'] }] }),
    'background.js': "chrome.runtime.onMessage.addListener((message, sender, reply) => { if (message === 'identity') reply({id: chrome.runtime.id, version: chrome.runtime.getManifest().manifest_version}); });",
    'content.js': `(${collector.toString()})(${JSON.stringify(origin)});`,
  };
  report.extensionFiles = {};
  for (const [name, source] of Object.entries(sources)) {
    await writeFile(join(extension, name), source);
    report.extensionFiles[name] = createHash('sha256').update(source).digest('hex');
  }
  async function launch(withExtension = true) {
    const launched = await chromium.launchPersistentContext(withExtension ? profile : join(temporary, 'no-extension'), {
      channel: 'chromium', headless: true, timeout: 20000,
      args: ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
        ...(withExtension ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] : [])],
    });
    browsers.push(launched.browser());
    return launched;
  }
  async function open() {
    const page = context.pages()[0];
    page.setDefaultTimeout(6000); page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(origin + '/probe');
    await page.waitForFunction(() => document.querySelector('tbody').dataset.page === '0');
    return page;
  }
  async function collect(page, mode, expectedError) {
    await page.locator('#collect-' + mode).click();
    await page.waitForFunction(() => ['done', 'error'].includes(document.querySelector('#collector-result').dataset.state));
    const result = JSON.parse(await page.locator('#collector-result').textContent());
    if (expectedError) {
      assert.match(result.error, expectedError); assert.equal(result.rows, undefined, 'no partial success on failure');
    } else {
      assert.equal(result.identity.version, 3); assert.match(result.identity.id, /^[a-p]{32}$/);
      assert.equal(result.mode, mode); assert.deepEqual(result.rows, truth);
    }
    return result;
  }
  function pass(name) { passed.push(name); console.log('PASS:', name); }

  context = await launch();
  report.browser = context.browser().version();
  if (process.argv.includes('--fail-after-launch')) assert.fail('intentional cleanup probe');
  let page = await open();
  await collect(page, 'api', /需要登录/); pass('anonymous extension collection rejected');
  await page.locator('#login').click();
  await page.waitForFunction(() => document.querySelector('#session').textContent === '已登录');
  await collect(page, 'api'); pass('MV3 worker + content script: authenticated API pagination matches truth');
  await collect(page, 'dom'); pass('MV3 content script: DOM pagination matches truth');
  await page.screenshot({ path: join(evidence, 'extension.png'), fullPage: true });

  // Read only the debugger endpoint generated by THIS launch, never a user-supplied endpoint.
  const [port, wsPath] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
  assert.match(port, /^\d+$/); assert.match(wsPath, /^\/devtools\/browser\//);
  const marker = randomUUID();
  await page.evaluate(value => { window.probeMarker = value; }, marker);
  attached = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${wsPath}`, { timeout: 6000 });
  assert.equal(attached.contexts().length, 1);
  const samePage = attached.contexts()[0].pages().find(candidate => candidate.url() === origin + '/probe');
  assert.ok(samePage); assert.equal(await samePage.evaluate(() => window.probeMarker), marker);
  const protocol = await attached.contexts()[0].newCDPSession(samePage);
  report.cdp = await protocol.send('Browser.getVersion');
  await protocol.detach();
  await collect(samePage, 'api');
  await attached.close(); attached = undefined;
  assert.equal(await page.evaluate(() => window.probeMarker), marker, 'disconnect must not close owner browser');
  pass('CDP attaches existing owned tab and session; disconnect preserves owner');

  await context.close(); context = undefined;
  context = await launch(); page = await open();
  assert.equal(await page.locator('#session').textContent(), '已登录');
  await collect(page, 'api'); assert.equal(logins, 1); pass('full browser restart reuses login without another login request');

  failPage = true; await collect(page, 'api', /503/); failPage = false;
  pass('mid-pagination server failure rejects partial output');
  duplicate = true; await collect(page, 'api', /重复记录/); duplicate = false;
  pass('duplicate records rejected');
  stallPage = true; await collect(page, 'api', /timeout|timed out/i); stallPage = false;
  pass('stalled response times out without partial output');
  await page.locator('#revoke').click();
  await page.waitForFunction(() => document.querySelector('#session').textContent === '需要登录');
  await collect(page, 'api', /需要登录/); pass('server revocation rejects persisted login');
  await page.locator('#login').click();
  await page.waitForFunction(() => document.querySelector('#session').textContent === '已登录');
  await collect(page, 'api'); pass('explicit re-login recovers');

  await context.close(); context = undefined;
  context = await launch(false); page = await open();
  assert.equal(await page.locator('#collector').count(), 0);
  assert.equal(await page.locator('#session').textContent(), '需要登录');
  pass('negative control: fixture alone has no collector and separate profile has no login');
  assert.deepEqual(pageErrors, []);
  report.status = 'passed';
});
