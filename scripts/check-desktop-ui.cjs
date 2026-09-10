// Real main/preload/worker/SDK. Only the remote model is replaced by a local HTTP fixture.
const { app, BrowserWindow, nativeTheme, session, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'storm-real-ui-')));
const dataDir = join(temporary, 'data'), project = join(temporary, 'a', '示例项目'), other = join(temporary, 'b', '示例项目');
mkdirSync(dataDir, { recursive: true }); process.env.STORM_TEST_DATA = dataDir;
const evidence = resolve(process.env.STORM_UI_EVIDENCE || '.local/desktop-ui-evidence'); mkdirSync(evidence, { recursive: true });
const failures = [], passed = [], screenshots = [], remote = [], requests = [];
let window, server, finishing = false, watchdog, worker, listReached, modelGate, catalogGate;
const catalogResults = [];
function barrier() {
  let reach, release;
  const reached = new Promise(resolve => { reach = resolve; }), released = new Promise(resolve => { release = resolve; });
  return { reached, release, async pause(value) { reach(value); await released; } };
}
// Test-only scheduling barriers. Production main/worker code and IPC authority are unchanged.
const gateFile = join(temporary, 'list-gate.mjs');
writeFileSync(gateFile, `import { SessionManager } from ${JSON.stringify(resolve('node_modules/@earendil-works/pi-coding-agent/dist/index.js'))};
let hold = false, release;
process.on('message', m => { if (m.testList === 'hold') hold = true; if (m.testList === 'release') release?.(); });
const list = SessionManager.list;
SessionManager.list = async (...args) => { const result = await list(...args); if (hold) { hold = false; await new Promise(resolve => { release = resolve; process.send({type:'test-list-held'}); }); } return result; };
`);
const childProcess = require('node:child_process'), fork = childProcess.fork;
childProcess.fork = (path, args, options) => {
  const child = fork(path, args, { ...options, execArgv: [...(options.execArgv || []), '--import', gateFile] });
  worker = child; child.on('message', event => { if (event.type === 'test-list-held') listReached?.(); }); return child;
};
require('node:module').syncBuiltinESMExports();
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (...args) => {
  const gate = channel === 'storm:invoke' && args[1] === 'catalog' ? catalogGate : null;
  if (gate) catalogGate = null;
  const value = await listener(...args);
  if (channel === 'storm:invoke' && args[1] === 'catalog') catalogResults.push(value);
  if (gate) await gate.pause(value);
  return value;
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = code => window.webContents.executeJavaScript(code);
const text = selector => js(`document.querySelector(${JSON.stringify(selector)}).textContent`);
const hidden = selector => js(`document.querySelector(${JSON.stringify(selector)}).hidden`);
async function until(test, label, timeout = 20000) {
  const start = Date.now();
  while (!await test()) { assert.ok(Date.now() - start < timeout, `Timed out: ${label}`); await delay(40); }
}
async function click(selector) {
  const point = await js(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled || !node.getClientRects().length) throw new Error('Not clickable: ' + ${JSON.stringify(selector)}); node.scrollIntoView({block:'nearest'}); const r=node.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
  window.webContents.sendInputEvent({ type:'mouseDown', button:'left', clickCount:1, ...point });
  window.webContents.sendInputEvent({ type:'mouseUp', button:'left', clickCount:1, ...point });
  await delay(65);
}
async function input(selector, value) {
  await js(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); node.focus(); node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('input', {bubbles:true})); })()`);
}
function key(keyCode, modifiers = [], character = false) {
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (character) window.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}
async function idle() { await until(async () => !(await hidden('#send')) && !(await js("document.querySelector('#send').disabled")), 'idle'); }
async function prompt(value) { await idle(); await input('#prompt', value); await click('#send'); }
async function shot(name) {
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const image = await window.webContents.capturePage(undefined, { stayAwake: true }); assert.ok(!image.isEmpty());
  const path = join(evidence, `${name}.png`); writeFileSync(path, image.toPNG()); screenshots.push(path);
}
async function layout(label) {
  const result = await js(`(() => ({overflow:document.documentElement.scrollWidth > innerWidth, clipped:[...document.querySelectorAll('button,textarea,input')].filter(e=>e.getClientRects().length && !e.closest('dialog:not([open]),[popover]:not(:popover-open)')).filter(e=>{const r=e.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1}).map(e=>e.id), node:typeof window.require}))()`);
  assert.equal(result.overflow, false, label); assert.deepEqual(result.clipped, [], label); assert.equal(result.node, 'undefined');
}
const taskRef = () => '.trellis/tasks/' + readdirSync(join(project, '.trellis/tasks')).find(name => name.includes('storm-'));
const progress = () => JSON.parse(readFileSync(join(project, taskRef(), 'progress.json'), 'utf8'));
async function run() {
  for (const root of [project, other]) {
    mkdirSync(root, { recursive: true });
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@localhost', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@localhost' } });
    git('init', '-q');
    writeFileSync(join(root, '.gitignore'), '.trellis/\n');
    writeFileSync(join(root, 'README.md'), '# 原始说明\n'); writeFileSync(join(root, 'style.css'), 'a { color: red; }\n');
    writeFileSync(join(root, 'verify.cjs'), "const assert=require('node:assert/strict'); const fs=require('node:fs'); setTimeout(()=>{assert.match(fs.readFileSync('README.md','utf8'),/已完成/); console.log('PASS actual README assertion');},1200);\n");
    git('add', '--all'); const tree = git('write-tree').trim(); const commit = git('commit-tree', tree, '-m', 'Isolated UI fixture baseline').trim(); git('update-ref', 'HEAD', commit);
  }
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify([project, other]));
  server = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests.push(body); assert.equal(req.headers.authorization, 'Bearer local-ui-fixture');
      const start = body.messages.findLastIndex(m => m.role === 'user' && /UI_(PLAN|EXECUTE|RETRY|ACCEPT|SLOW|TEXT)/.test(JSON.stringify(m.content)));
      const trigger = start >= 0 ? JSON.stringify(body.messages[start].content) : '';
      const completed = start >= 0 ? body.messages.slice(start + 1).filter(m => m.role === 'tool').length : 0;
      if (modelGate && trigger.includes('UI_RETRY') && completed === 1) { const gate = modelGate; modelGate = null; await gate.pause(); }
      const ref = taskRef();
      const plans = [
        ['storm_task', { action: 'new', title: '完善项目说明与样式', agent: 'development' }],
        ['write', { path: ref + '/prd.md', content: '# 完善项目说明与样式\n\n更新 README 和样式；保留现有接口与路径。\n验收方式：node verify.cjs 实际核对 README。\n' }],
        ['write', { path: ref + '/design.md', content: '# 实施方案\n仅修改说明与文字颜色，不改变业务接口。\n' }],
        ['storm_progress', { phase: 'awaiting_approval', summary: '已查看项目，建议更新说明与样式，保持业务行为。', next: '请查看完整需求与验收方式，再决定是否开始。', checkCommand: 'node verify.cjs' }],
        ['storm_task', { action: 'approve' }],
      ];
      const execute = [
        ['storm_task', { action: 'approve' }],
        ['read', { path: 'missing-file.txt' }],
        ['write', { path: 'README.md', content: '# 待修复的说明\n' }],
        ['storm_check', {}],
      ];
      const retry = [
        ['write', { path: 'README.md', content: '# 项目说明已完成\n真实本地模型替身驱动的工作流验证。\n' }],
        ['write', { path: 'style.css', content: 'a { color: green; }\n' }],
        ['storm_check', {}],
        ['storm_handoff', { summary: 'README 与样式已修改，实际检查通过。', runInstructions: 'node verify.cjs；已实际执行 README 断言。', remaining: ['真实提供者与跨设备未在这个本地替身检查中验证。'], memories: [{ fact: 'verify.cjs 核对 README 的完成文字。', source: 'verify.cjs' }] }],
        ['storm_progress', { phase: 'awaiting_acceptance', summary: '项目说明与样式已更新，等待你审阅差异和检查。', next: '查看结果后决定是否验收。' }],
        ['storm_task', { action: 'accept' }],
      ];
      let steps = trigger.includes('UI_PLAN') ? plans : trigger.includes('UI_EXECUTE') ? execute : trigger.includes('UI_RETRY') ? retry : trigger.includes('UI_ACCEPT') ? [['storm_task', { action: 'accept' }]] : [];
      if (completed && trigger.includes('UI_EXECUTE')) {
        const result = body.messages.slice(start + 1).find(m => m.role === 'tool');
        try { if (JSON.parse(result.content).applied === false) steps = []; } catch { /* Normal non-JSON tool text. */ }
      }
      let delta = { role: 'assistant', content: '已记录本轮结果。请审阅工作详情。\n\n```js\nconsole.log("本地验证");\n```\n<img src=x onerror="window.injected=true">' }, finish = 'stop';
      if (steps[completed]) {
        const [name, args] = steps[completed]; finish = 'tool_calls';
        delta = { role: 'assistant', tool_calls: [{ index: 0, id: `ui-${requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
      }
      const chunk = (data, reason = null) => 'data: ' + JSON.stringify({ id: 'ui-fixture', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: data, finish_reason: reason }] }) + '\n\n';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (trigger.includes('UI_SLOW')) {
        res.write(chunk({ role: 'assistant', content: '正在等待本地响应，可以停止。' }));
        const update = setTimeout(() => res.write(chunk({ content: '\n后续流式片段仍在等待。' })), 400);
        const timer = setTimeout(() => res.end(chunk({}, 'stop') + 'data: [DONE]\n\n'), 15000); res.on('close', () => { clearTimeout(timer); clearTimeout(update); }); return;
      }
      res.end(chunk(delta) + chunk({}, finish) + 'data: [DONE]\n\n');
    } catch (error) { failures.push(error.stack); res.writeHead(500); res.end('fixture failure'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await import('../desktop/main.mjs'); await app.whenReady();
  nativeTheme.themeSource = 'light'; app.setActivationPolicy('regular'); await app.dock.show();
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => { const external = /^(https?|wss?):/.test(details.url); if (external) remote.push(details.url); callback({ cancel: external }); });
  await until(() => { window = BrowserWindow.getAllWindows()[0]; return window; }, 'production BrowserWindow');
  window.webContents.setBackgroundThrottling(false);
  window.webContents.on('console-message', details => { if (details.level === 'error') failures.push(details.message); });
  window.webContents.on('render-process-gone', (_event, details) => failures.push(details.reason));
  await until(() => !window.webContents.isLoadingMainFrame(), 'production page load');
  window.webContents.debugger.attach('1.3'); await window.webContents.debugger.sendCommand('Runtime.enable');
  window.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') failures.push(JSON.stringify(params.exceptionDetails)); });
  window.setContentSize(1440, 900); window.show(); app.focus({ steal: true }); window.focus(); window.webContents.focus();
  await until(() => js('document.hasFocus()'), 'native focus');
  await until(() => js("document.querySelectorAll('#recent button').length === 2"), 'initial catalog');
  await js('window.uiEvents=[];window.storm.onEvent(event=>window.uiEvents.push(event)); void 0');
  await layout('home 1440'); await shot('workspace-01-home-light');
  await click('#recent button'); await idle();
  await until(() => js("document.querySelector('#project-path').textContent === " + JSON.stringify(project)), 'real project');
  await click('#settings-open'); await click('#proxy-tab');
  await input('#base-url', `http://127.0.0.1:${server.address().port}/v1`); await input('#proxy-model', 'local-ui'); await input('#key', 'local-ui-fixture');
  await shot('workspace-02-settings-light'); await click('#test-model');
  await until(async () => /实际响应/.test(await text('#model-feedback')), 'real local connection test');
  assert.equal(await js("document.querySelector('#key').value"), ''); await click('#settings-close'); await idle();
  await input('#prompt', '键盘输入'); key('Return', ['shift'], true); await delay(80); assert.match(await js("document.querySelector('#prompt').value"), /\n/);
  const before = requests.length;
  await js("document.querySelector('#prompt').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))");
  await delay(80); assert.equal(requests.length, before, 'IME must not submit');
  await js("document.querySelector('#prompt').focus()"); key('Tab'); await delay(80);
  assert.equal(await js("getComputedStyle(document.activeElement).outlineStyle"), 'solid');
  const listHeld = new Promise(resolve => { listReached = resolve; });
  worker.send({ reply: 'test-only', testList: 'hold' }); await click('#library-open'); await listHeld;
  await input('#prompt', 'UI_PLAN 请先整理需求与方案'); key('Return');
  await until(async () => !(await hidden('#workflow-actions')), 'actual approval question');
  assert.equal(progress().phase, 'awaiting_approval'); assert.equal(await js('document.activeElement.id'), 'workflow-cancel');
  assert.equal(await js("document.querySelector('#question').open"), false, 'Workflow uses inspector, not generic dialog');
  worker.send({ reply: 'test-only', testList: 'release' });
  await until(() => js("document.querySelector('#library').open"), 'catalog after held session list');
  assert.equal(catalogResults.at(-1).workflow.phase, 'awaiting_approval', 'Catalog samples workflow after the awaited list');
  assert.equal(catalogResults.at(-1).busy, true, 'Catalog samples busy after the awaited list');
  assert.equal(catalogResults.at(-1).revision, await js("window.uiEvents.findLast(e=>e.type==='workflow'||e.type==='busy').revision"));
  await click('#library-close');
  assert.equal(await js("document.querySelector('[data-document=\"prd.md\"]').open && document.querySelector('[data-document=\"design.md\"]').open"), true);
  assert.match(await text('[data-document="prd.md"] > summary'), /需求与验收标准/);
  assert.equal(await text('[data-document="prd.md"] .document-filename'), 'prd.md');
  assert.equal(await text('#decision-command'), 'node verify.cjs');
  assert.match(await text('#confirmation-text'), /node verify.cjs/); await layout('approval'); await shot('workspace-03-approval-light');
  const firstQuestion = await js("window.uiEvents.findLast(e=>e.type==='question').id");
  assert.equal(await js(`window.storm.invoke('answer',{id:${JSON.stringify(firstQuestion)},value:'true'}).then(()=>false,()=>true)`), true, 'Wrong answer type rejected without consuming the question');
  key('Escape'); await idle(); assert.equal(progress().approval, null);
  assert.equal(await js(`window.storm.invoke('answer',{id:${JSON.stringify(firstQuestion)},value:true}).then(()=>false,()=>true)`), true, 'Expired answer rejected by actual main');
  passed.push('Actual onboarding, encrypted temporary credential save/local model test, keyboard/IME, default cancel, Escape and stale-ID rejection');

  await prompt('UI_EXECUTE 请按方案开始'); await until(async () => !(await hidden('#workflow-actions')), 'second approval');
  await click('#revision summary'); await input('#revision-text', '保留业务接口，不增加范围。'); await click('#workflow-revise');
  assert.match(await js("document.querySelector('#prompt').value"), /保留业务接口/); await idle(); assert.equal(progress().approval, null);
  assert.match(readFileSync(join(project, 'README.md'), 'utf8'), /原始说明/);
  await prompt('UI_EXECUTE 先测试停止确认'); await until(async () => !(await hidden('#workflow-actions')), 'approval before stop');
  const stoppedQuestion = await js("window.uiEvents.findLast(e=>e.type==='question').id");
  await click('#stop'); await idle(); assert.equal(progress().approval, null); assert.equal(await hidden('#workflow-actions'), true);
  assert.equal(await js(`window.storm.invoke('answer',{id:${JSON.stringify(stoppedQuestion)},value:true}).then(()=>false,()=>true)`), true);
  await prompt('UI_EXECUTE 同意原方案，请开始'); await until(async () => !(await hidden('#workflow-actions')), 'third approval'); await click('#workflow-confirm');
  await until(() => progress().phase === 'checking', 'actual check running'); await click('[data-panel="checks"]'); await shot('workspace-04-running-light');
  await idle(); assert.notEqual(progress().check.exitCode, 0); assert.match(await text('#checks-title'), /失败/); assert.equal(await hidden('#workflow-actions'), true);
  assert.ok(await js("document.querySelectorAll('.process-tool[data-state=error]').length >= 2")); await shot('workspace-05-failure-light');
  passed.push('Revision cancels without approval; true approval gates real writes; tool failure and actual failed check are visible and cannot accept');

  await prompt('UI_RETRY 请修复并重新检查');
  await until(async () => !(await hidden('#workflow-actions')), 'actual acceptance question');
  assert.equal(progress().check.exitCode, 0); assert.equal(progress().phase, 'awaiting_acceptance'); assert.match(await text('#checks-log'), /PASS actual README assertion/);
  assert.equal(await js("document.querySelector('[data-document=handoff]').open"), true, 'Actual handoff expanded on acceptance');
  assert.match(await text('[data-document=handoff] .markdown'), /README 与样式已修改/);
  assert.equal(await text('#decision-command'), progress().check.command);
  await shot('workspace-06-checks-light'); await click('[data-panel="changes"]');
  await until(() => js("document.querySelectorAll('#file-list button').length === 2"), 'per-file real git');
  await click('#file-list button:nth-child(1)'); const firstPatch = await text('#diff-patch');
  await click('#file-list button:nth-child(2)'); const secondPatch = await text('#diff-patch'); assert.notEqual(firstPatch, secondPatch); assert.match(secondPatch, /green/);
  await shot('workspace-07-changes-light'); nativeTheme.themeSource = 'dark'; await delay(100); await shot('workspace-08-changes-dark');
  window.setContentSize(1040, 760); await delay(100); await layout('1040 dark'); await shot('workspace-09-compact-dark');
  nativeTheme.themeSource = 'light'; await delay(100); await layout('1040 light'); await shot('workspace-10-compact-light');
  await click('#workflow-cancel'); await idle(); assert.equal(progress().phase, 'awaiting_acceptance');
  const delayedCatalog = barrier(); catalogGate = delayedCatalog;
  await click('#library-open'); const oldCatalog = await delayedCatalog.reached;
  assert.equal(oldCatalog.workflow.check.exitCode, 0); assert.equal(oldCatalog.busy, false);
  const oldEvents = await js("['workflow','busy'].map(type=>window.uiEvents.findLast(e=>e.type===type))");
  const afterWrite = barrier(); modelGate = afterWrite;
  await prompt('UI_RETRY 再核对改动后的检查状态'); await afterWrite.reached;
  assert.equal(progress().check, null, 'Real write invalidates the successful check');
  const newer = await js("window.uiEvents.findLast(e=>e.type==='workflow'||e.type==='busy')");
  assert.ok(newer.revision > oldCatalog.revision);
  const count = await js('window.uiEvents.length');
  for (const event of oldEvents) window.webContents.send('storm:event', event);
  await until(() => js(`window.uiEvents.length === ${count + oldEvents.length}`), 'replayed old workflow and busy received');
  assert.notEqual(await text('#checks-title'), '检查命令执行成功'); assert.equal(await hidden('#send'), true);
  delayedCatalog.release(); await until(() => js("document.querySelector('#library').open"), 'old catalog delivered after new workflow');
  assert.notEqual(await text('#checks-title'), '检查命令执行成功');
  assert.equal(await hidden('#send'), true, 'Late catalog cannot clear newer busy');
  assert.equal(await text('#phase-label'), newer.workflow.phaseLabel);
  assert.equal(await hidden('#workflow-actions'), true);
  await click('#library-close'); await click('[data-panel="checks"]'); await shot('workspace-15-stale-catalog-rejected');
  afterWrite.release(); await until(async () => !(await hidden('#workflow-actions')), 'fresh acceptance after recheck');
  await click('#workflow-cancel'); await idle();
  await prompt('UI_ACCEPT 我已审阅，准备验收'); await until(async () => !(await hidden('#workflow-actions')), 'acceptance retry'); await click('#workflow-confirm'); await idle();
  assert.equal(progress().phase, 'completed'); assert.match(progress().acceptance, /^[a-f0-9]{64}$/); await shot('workspace-11-accepted-light');
  passed.push('Actual successful check/output, distinct real Git file patches, true delivery digest acceptance/cancellation, system themes and 1440×900/1040×760');

  window.setContentSize(1440, 900); await click('#progress-close');
  await js("document.querySelector('.process').open=true;document.querySelector('#messages').scrollTop=0");
  await prompt('UI_TEXT 展示公开回答'); await idle();
  assert.equal(await js("document.querySelector('.process').open"), true, 'Process expansion survives settled history rebuild');
  assert.equal(await js("Boolean(window.injected)||Boolean(document.querySelector('#messages img'))"), false, 'Model HTML remains inert');
  window.show(); app.focus({steal:true}); window.focus(); window.webContents.focus();
  await until(() => js('document.hasFocus()'), 'copy focus');
  await click('.code-heading button');
  assert.equal(await text('.code-heading button'), '已复制');
  const originalIds = await js("window.uiEvents.findLast(e=>e.type==='history').messages.map(m=>m.id)");
  assert.equal(new Set(originalIds).size, originalIds.length);
  const current = await js("window.storm.invoke('catalog').then(c=>c.sessions.find(s=>s.active).id)");
  await click('#composer-model'); await shot('workspace-12-model-picker'); await input('#model-search', 'does-not-exist'); assert.match(await text('#model-options'), /没有匹配/); key('Escape');
  await input('#prompt', '保留这个草稿'); await click('#composer-model'); await input('#model-search', 'local-ui'); key('Down');
  await until(() => js("document.activeElement.classList.contains('model-choice')"), 'arrow-key model focus');
  key('Return', [], true); await delay(80); await idle();
  await until(() => js("!document.querySelector('#model-picker').matches(':popover-open')"), 'keyboard model choice');
  assert.equal(await js("document.querySelector('#prompt').value"), '保留这个草稿'); await input('#prompt', '');
  await click('#library-open'); await shot('workspace-13-library'); await click('#plugins-tab'); assert.equal(await js("document.querySelectorAll('.plugin-loaded').length"), 5); await click('#library-close');
  await click('#updates-open'); assert.match(await text('#update-message'), /开发版本/); await click('#updates-close');
  await prompt('/storm'); await until(() => js("document.querySelector('#question').open"), 'generic select after workflow confirmation');
  assert.equal(await js("Boolean(window.uiEvents.findLast(e=>e.type==='question').workflow)"), false, 'Workflow metadata is single-use');
  key('Escape'); await idle();
  await input('#session-search', 'does-not-exist'); assert.equal(await js("document.querySelectorAll('#sessions button').length"), 0); await input('#session-search', '');
  key('N', ['meta']); await delay(100); await idle(); assert.equal(await js("document.querySelectorAll('.round').length"), 0);
  await js(`document.querySelectorAll('#sessions button')[0].click()`); await idle();
  await until(() => js("window.storm.invoke('catalog').then(c=>c.sessions.some(s=>s.id===" + JSON.stringify(current) + "&&s.active))"), 'actual history resume');
  assert.deepEqual(await js("window.uiEvents.findLast(e=>e.type==='history').messages.map(m=>m.id)"), originalIds);
  await click('#recent button:nth-child(2)'); await idle();
  await until(() => js("document.querySelector('#project-path').textContent === " + JSON.stringify(other)), 'same-name other project');
  assert.equal(await js("document.querySelectorAll('.round').length"), 0); assert.equal(await js("window.storm.invoke('catalog').then(c=>c.workflow.task)"), null);
  await click('#recent button:nth-child(2)'); await idle();
  await input('#prompt', 'x'.repeat(50001)); await click('#send'); await idle();
  assert.equal(await js("document.querySelector('#prompt').value.length"), 50001, 'Rejected send preserves input');
  await prompt('UI_SLOW 验证停止'); await until(async () => /可以停止/.test(await text('#messages')), 'live streaming');
  await js("document.querySelector('#messages').scrollTop=0"); await delay(600);
  assert.ok(await js("document.querySelector('#messages').scrollTop < 100"), 'Streaming updates preserve reading position');
  await click('#stop'); await idle();
  assert.match(await js("[...document.querySelectorAll('.message .error')].at(-1).textContent"), /停止|abort/i);
  const scroll = await js("document.querySelector('#messages').scrollTop"); assert.ok(scroll < 100, 'Stop/history does not pull reader to bottom');
  await js("document.querySelector('#messages').scrollTop=document.querySelector('#messages').scrollHeight");
  await shot('workspace-14-stopped-light');
  assert.equal(await js("JSON.stringify(window.uiEvents).includes('local-ui-fixture')"), false, 'Credentials never enter presentation events');
  passed.push('History IDs/expansion, model HTML safety and copy, real model picker/library/update UI, search, session/project isolation, rejected-input recovery and streamed stop/read position');
  // Hold a genuine successful catalog until after the actual worker exits.
  const afterFatal = barrier(); catalogGate = afterFatal;
  await click('#library-open'); assert.equal((await afterFatal.reached).workflow.check.exitCode, 0);
  const sessionCount = await js("document.querySelectorAll('#sessions button').length");
  worker.kill(); await until(() => js("window.uiEvents.some(e=>e.type==='fatal')"), 'actual worker exit');
  assert.equal(await text('#checks-title'), '检查状态不可用');
  for (const query of ['does-not-exist', '']) {
    await input('#session-search', query);
    assert.equal(await text('#checks-title'), '检查状态不可用'); assert.equal(await hidden('#workflow-actions'), true);
    assert.equal(await js("document.querySelectorAll('#sessions button').length"), query ? 0 : sessionCount, 'Disconnected search still redraws only the session list');
  }
  afterFatal.release(); await until(() => js("document.querySelector('#library').open"), 'catalog delivered after fatal');
  await click('#library-close');
  assert.equal(await text('#checks-title'), '检查状态不可用'); assert.equal(await text('#phase-label'), '进度读取失败');
  assert.doesNotMatch(await text('#checks-log'), /PASS actual/);
  assert.equal(await hidden('#workflow-actions'), true); await click('#progress-toggle'); await shot('workspace-16-disconnected');
  passed.push('Deterministic barriers: catalog collected after held SDK session list; old successful catalog rejected after real check invalidation/busy and after actual worker fatal; search cannot restore success');
  assert.deepEqual(remote, [], 'Renderer makes no remote requests'); assert.deepEqual(failures, []);
}
async function finish(code) {
  if (finishing) return; finishing = true; clearTimeout(watchdog); server?.closeAllConnections(); server?.close();
  writeFileSync(join(evidence, 'desktop-ui-check.json'), JSON.stringify({ at: new Date().toISOString(), exitCode: code, passed, failures, remote, screenshots, modelRequests: requests.length, limits: ['本地 HTTP 模型替身，不验证真实提供者或业务质量。', 'IME 仅验证 composition 键盘事件，不操作系统候选词窗口。', '未打包、安装、发布或跨设备验证。'] }, null, 2) + '\n');
  for (const note of passed) console.log(`PASS: ${note}`);
  console.log(`UI evidence: ${evidence}; screenshots: ${screenshots.length}`);
  app.once('will-quit', () => { rmSync(temporary, { recursive: true, force: true }); app.exit(code); }); app.quit();
}
watchdog = setTimeout(() => { failures.push('Real desktop UI check exceeded 180 seconds'); void finish(1); }, 180000);
run().then(() => finish(0)).catch(error => { failures.push(error.stack); console.error(error); return finish(1); });
