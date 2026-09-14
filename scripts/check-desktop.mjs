import assert from 'node:assert/strict';
import http from 'node:http';
import { fork, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopCredentials, validateSettings } from '../desktop/store.mjs';
import { SessionManager } from '@earendil-works/pi-coding-agent';

const root = process.argv[2] || fileURLToPath(new URL('../', import.meta.url));
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'storm-desktop-check-')));
const requests = new Map(); let child, server, nextQuestion, records = {}, events = [], bodies = [];
try {
  const portableEnv = { HOME:dir, PATH:'/usr/bin:/bin' };
  for (const binary of ['runtime/node/bin/node','runtime/python/bin/python3','runtime/bin/codegraph','runtime/bin/lark-cli','node_modules/dugite/git/bin/git']) {
    assert.ok(execFileSync(join(root,binary),['--version'],{env:portableEnv,encoding:'utf8',timeout:15000}).trim(),binary);
  }
  assert.throws(() => validateSettings({ provider:'storm-proxy', model:'demo', baseUrl:'http://example.com/v1', api:'openai-completions' }), /HTTPS/);
  assert.throws(() => validateSettings({ provider:'storm-proxy', model:'demo', baseUrl:'https://example.com/v1?key=secret', api:'openai-completions' }), /密钥/);
  assert.throws(() => validateSettings({ provider:'storm-proxy', model:'demo', baseUrl:'https://example.com/v1', api:'unknown' }), /协议/);
  const valid = validateSettings({ provider:'storm-proxy', model:'demo', baseUrl:'https://example.com/v1/', api:'openai-completions' });
  assert.equal(valid.baseUrl, 'https://example.com/v1'); assert.equal(valid.maxTokens, 8192);
  const store = new DesktopCredentials(async () => structuredClone(records), async data => { records = structuredClone(data); });
  await Promise.all(Array.from({length:5}, () => store.modify('test', async old => ({ type:'api_key', key:String(Number(old?.key ?? 0) + 1) }))));
  assert.equal((await store.read('test')).key, '5');
  await assert.rejects(() => store.modify('test', async () => { throw new Error('do not save'); }));
  assert.equal((await store.read('test')).key, '5');
  await store.delete('test'); assert.equal(await store.read('test'), undefined);
  const project = join(dir, 'a', 'same name'), other = join(dir, 'b', 'same name');
  for (const p of [project, other]) { mkdirSync(p, {recursive:true}); execFileSync('git', ['init','-q',p]); writeFileSync(join(p,'README.md'),'# Desktop fixture\n'); }
  const dataDir = join(dir,'app-data'); mkdirSync(dataDir);
  const request = (action, data = {}) => new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`Timeout: ${action}`)); }, 25000);
    requests.set(id, {resolve: v => {clearTimeout(timer);resolve(v);}, reject: e=>{clearTimeout(timer);reject(e);}});
    child.send({id,action,data});
  });
  const start = () => new Promise((resolve, reject) => {
    child = fork(join(root,'desktop/worker.mjs'), [], {execPath:join(root,'runtime/node/bin/node'),cwd:dataDir, env:{ HOME:dir, PATH:[join(root,'runtime/bin'),join(root,'runtime/node/bin'),join(root,'runtime/python/bin'),join(root,'node_modules/dugite/git/bin'),'/usr/bin','/bin'].join(':'), STORM_USER_DATA:dataDir, PI_CODING_AGENT_DIR:join(dataDir,'pi'), LANG:'en_US.UTF-8' }, stdio:['ignore','pipe','pipe','ipc']});
    let errors = ''; child.stderr.on('data',b=>errors+=b); child.stdout.on('data',()=>{});
    child.on('exit',code => { if (code) reject(new Error(errors)); });
    child.on('message', event => {
      if(event.type === 'ready') resolve();
      else if(event.type === 'credentials') {
        if (event.action === 'write') records = structuredClone(event.data);
        child.send({reply:event.id,value:event.action === 'write' ? true : records});
      } else if(event.type === 'response') {
        const r=requests.get(event.id);requests.delete(event.id); event.error ? r?.reject(new Error(event.error)):r?.resolve(event.value);
      } else { events.push(event); if(event.type==='question') nextQuestion?.(event); }
    });
  });
  await start();
  const catalog = await request('catalog'); assert.ok(catalog.providers.some(p=>p.id==='openai-codex')); assert.equal(catalog.config,null);
  assert.equal(catalog.agents.length,4); assert.ok(catalog.agents.every(a => a.prompt.includes(a.name) && a.workflow));
  assert.equal(catalog.plugins.length,6); assert.ok(catalog.plugins.every(p => !p.loaded));
  await request('open',{path:project});
  const loadedCatalog = await request('catalog');
  assert.ok(loadedCatalog.plugins.every(p => p.loaded));
  assert.ok(loadedCatalog.plugins.find(p => p.name === 'CodeGraph').tools.includes('codegraph_explore'));
  assert.ok(!loadedCatalog.plugins.find(p => p.name === 'Trellis').tools.includes('trellis_subagent'));
  await assert.rejects(request('profile',{id:'unknown'}),/未知/);
  await request('profile', {id:'code-review'});
  const reviewTools = (await request('diagnostics')).tools;
  assert.ok(reviewTools.includes('read') && reviewTools.includes('storm_changes'));
  for (const name of ['bash', 'write', 'edit', 'storm_check', 'storm_progress', 'storm_assessment', 'storm_handoff', 'storm_browser_page']) assert.ok(!reviewTools.includes(name), name);
  assert.ok(!(await request('catalog')).plugins.find(p => p.name === 'MediaStorm 工作流').tools.includes('storm_check'));
  assert.equal((await request('profile',{id:'bug-fix'})).profile,'bug-fix');
  let diagnostics = await request('diagnostics'); assert.equal(diagnostics.project,project);
  for (const name of ['storm_task','storm_check','codegraph_explore','storm_changes','storm_lark','storm_browser_page']) assert.ok(diagnostics.tools.includes(name),name);
  assert.ok(events.some(e=>e.type==='widget' && e.key==='mediastorm'));
  await assert.rejects(request('prompt',{text:'hello'}), /模型/);
  // Extension command runs locally, without an account or any model request.
  await request('saveModel',{provider:'openai-codex',model:catalog.providers.find(p=>p.id==='openai-codex').models[0].id});
  await assert.rejects(request('prompt',{text:'hello'}), /登录/);
  await request('open',{path:other});
  const otherDiagnostics = await request('diagnostics'); assert.notEqual(otherDiagnostics.sessionFile,diagnostics.sessionFile);
  await request('close');
  await new Promise(resolve => child.once('exit', resolve));
  await start();
  const restored = await request('catalog'); assert.equal(restored.config.provider,'openai-codex'); assert.equal(restored.profile,'bug-fix'); assert.deepEqual(restored.recent,[other,project]);
  await request('open',{path:project});
  diagnostics = await request('diagnostics'); assert.equal(diagnostics.project,project);
  await assert.rejects(request('saveModel',{...valid,key:''}), /密钥/);
  assert.ok(!existsSync(join(dataDir,'auth.json')));
  server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); bodies.push(body);
    assert.equal(req.headers.authorization, 'Bearer local-fixture');
    let delta = {role:'assistant',content:'LOCAL_OK'}, finish = 'stop';
    const start = body.messages.findLastIndex(m=>m.role==='user' && JSON.stringify(m.content).includes('desktop confirmation'));
    if (start >= 0) {
      const completed = body.messages.slice(start+1).filter(m=>m.role==='tool').length;
      const task = '.trellis/tasks/' + readdirSync(join(project,'.trellis/tasks')).find(x=>x.includes('storm-'));
      const steps = [
        ['storm_task',{action:'new',title:'Desktop confirmation',agent:'development'}],
        ['write',{path:task+'/prd.md',content:'# Desktop confirmation\nValidate confirmation bridge; do not change business code. Check: true.\n'}],
        ['write',{path:task+'/design.md',content:'# Design\nValidate confirmation only.\n'}],
        ['storm_progress',{phase:'awaiting_approval',summary:'Desktop confirmation check',next:'Confirm the plan',checkCommand:'true'}],
        ['storm_task',{action:'approve'}],
      ];
      if (steps[completed]) {
        const [name,args] = steps[completed]; finish = 'tool_calls';
        delta = {role:'assistant',tool_calls:[{index:0,id:'fixture-'+Date.now(),type:'function',function:{name,arguments:JSON.stringify(args)}}]};
      }
    }
    const larkStart = body.messages.findLastIndex(m => m.role === 'user' && JSON.stringify(m.content).includes('desktop lark cancel'));
    if (larkStart >= 0 && !body.messages.slice(larkStart + 1).some(m => m.role === 'tool')) {
      finish = 'tool_calls';
      delta = {role:'assistant',tool_calls:[{index:0,id:'lark-fixture',type:'function',function:{name:'storm_lark',arguments:JSON.stringify({args:['base','+record-list','--as','user']})}}]};
    }
    const reviewStart = body.messages.findLastIndex(m => m.role === 'user' && JSON.stringify(m.content).includes('review blocked command'));
    if (reviewStart >= 0 && !body.messages.slice(reviewStart + 1).some(m => m.role === 'tool')) {
      finish = 'tool_calls';
      delta = {role:'assistant',tool_calls:[{index:0,id:'review-fixture',type:'function',function:{name:'bash',arguments:JSON.stringify({command:'touch review-should-not-write'})}}]};
    }
    const browserStart = body.messages.findLastIndex(m => m.role === 'user' && JSON.stringify(m.content).includes('desktop browser consent'));
    if (browserStart >= 0 && !body.messages.slice(browserStart + 1).some(m => m.role === 'tool')) {
      finish = 'tool_calls';
      delta = {role:'assistant',tool_calls:[{index:0,id:'browser-fixture-'+Date.now(),type:'function',function:{name:'storm_browser_page',arguments:JSON.stringify({url:'https://example.com/synthetic'})}}]};
    }
    const planStart = body.messages.findLastIndex(m => m.role === 'user' && JSON.stringify(m.content).includes('collection plan fixture'));
    if (planStart >= 0 && !body.messages.slice(planStart + 1).some(m => m.role === 'tool')) {
      const plan = {goal:'订单调查',source:{basis:'description'},fields:[{name:'编号',meaning:'订单编号'}],samples:[['A-1']],missing:['来源尚未核验'],scope:'上月订单',maxRecords:100,delivery:{format:'python',reason:'计划用于后续分析，认证方式待确认'}};
      finish = 'tool_calls';
      delta = {role:'assistant',tool_calls:[{index:0,id:'collection-plan-'+Date.now(),type:'function',function:{name:'storm_collection_plan',arguments:JSON.stringify({action:'propose',plan})}}]};
    }
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    res.end('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta,finish_reason:null}]})+'\n\n' +
      'data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  await request('saveModel',{...valid,baseUrl:`http://127.0.0.1:${server.address().port}/v1`,key:'local-fixture'});
  const proxy = (await request('catalog')).config;
  await request('saveModel',{...proxy,model:'second-model'});
  const accountModel = catalog.providers.find(p => p.id === 'openai-codex').models[0].id;
  records['openai-codex'] = {type:'api_key',key:'fixture-only'};
  await request('selectModel',{provider:'openai-codex',model:accountModel});
  assert.equal((await request('catalog')).proxyModels.length,2);
  await assert.rejects(request('selectModel',{provider:'openai-codex',model:'nonexistent'}),/没有这个模型/);
  assert.equal((await request('catalog')).config.model,accountModel);
  await request('close'); await new Promise(resolve => child.once('exit',resolve)); await start();
  assert.equal((await request('catalog')).proxyModels.length,2,'Proxy models must survive switching to an account and restarting');
  assert.equal((await request('selectModel',proxy)).config.model,'demo');
  await assert.rejects(request('selectModel',{...proxy,baseUrl:'https://unrecognized.example/v1'}),/找不到/);
  await request('open',{path:project}); await request('profile',{id:'bug-fix'});
  assert.match((await request('testModel')).message,/实际响应/);
  assert.equal(bodies.at(-1).model,'demo');
  await request('profile', {id:'code-review'});
  await request('prompt', {text:'desktop local regression (read-only)'});
  assert.match(JSON.stringify(bodies.at(-1).messages), /角色：代码审查与简化助手/);
  assert.ok(!bodies.at(-1).tools.some(tool => ['bash','write','edit','storm_check'].includes(tool.function.name)));
  await request('prompt', {text:'review blocked command'});
  assert.equal(existsSync(join(project, 'review-should-not-write')), false);
  assert.equal((await request('catalog')).workflow.task, null);
  await request('profile', {id:'bug-fix'});
  assert.ok((await request('diagnostics')).tools.includes('bash'), 'Idle profile switch restores the original allowed tools');
  await request('prompt',{text:'desktop local regression'});
  assert.ok(JSON.stringify(bodies.at(-1).messages).includes('角色：故障定位与修复助手'));
  assert.doesNotMatch(JSON.stringify(bodies.at(-1).messages), /<trellis-workflow>|<first-reply-notice>|Trellis Task Context|<workflow-state>/);
  assert.ok(!bodies.at(-1).tools.some(tool => tool.function.name === 'trellis_subagent'));
  assert.match(JSON.stringify(bodies.at(-1).messages), /项目既有业务规范与技术约束继续遵守/);
  assert.ok(events.filter(e => ['message','stream','message-end'].includes(e.type)).every(e => ['user','assistant','toolResult'].includes(e.message.role)), 'Hidden extension context must not enter the visible stream');
  assert.ok(events.some(e=>e.type==='stream' && e.message.text.includes('LOCAL_OK')));
  const finalMessage = events.findLast(e => e.type === 'message-end' && e.message.role === 'assistant').message;
  assert.ok(finalMessage.id && finalMessage.previousId);
  assert.ok(events.some(e => e.type === 'stream' && e.message.id === finalMessage.previousId));
  assert.equal(events.findLast(e => e.type === 'history').messages.at(-1).id, finalMessage.id);
  const persisted = (await request('diagnostics')).sessionFile;
  assert.ok(readFileSync(persisted,'utf8').includes('LOCAL_OK'));
  const savedConversation = (await request('catalog')).sessions.find(s => s.active);
  assert.ok(savedConversation?.title.includes('desktop local regression'));
  await request('fresh');
  assert.notEqual((await request('diagnostics')).sessionFile, persisted);
  await assert.rejects(request('resume', {id:'../../outside'}), /不属于/);
  await request('resume', {id:savedConversation.id});
  assert.equal((await request('diagnostics')).sessionFile, persisted);
  await request('open',{path:other});
  await assert.rejects(request('resume', {id:savedConversation.id}), /不属于/);
  events=[];
  await request('open',{path:project});
  assert.ok(events.some(e=>e.type==='history' && e.messages.some(m=>m.text.includes('LOCAL_OK'))));
  assert.equal((await request('diagnostics')).sessionFile,persisted);
  assert.equal(events.findLast(e => e.type === 'history').messages.at(-1).id, finalMessage.id, 'Persisted message IDs survive reopening');
  assert.equal((await request('catalog')).workflow.task, null);
  {
    const questionReady = new Promise(resolve => { nextQuestion = resolve; });
    const turn = request('prompt', {text:'desktop lark cancel'});
    const q = await Promise.race([questionReady, turn.then(() => { throw new Error('Lark confirmation missing'); })]);
    assert.equal(q.kind, 'confirm'); assert.equal(q.title, '飞书操作确认');
    assert.equal(q.workflow, undefined, 'CLI consent must not masquerade as code plan approval');
    child.send({reply:q.id, value:false}); await turn;
    assert.ok(JSON.stringify(bodies.at(-1).messages).includes('用户取消，未调用飞书 CLI'));
    assert.equal((await request('catalog')).workflow.task, null, 'Standalone CLI use does not create a code task');
  }
  for (const consent of [false, true]) {
    const questionReady = new Promise(resolve => { nextQuestion=resolve; });
    const turn = request('prompt',{text:'desktop confirmation '+String(consent)});
    const q = await Promise.race([questionReady,turn.then(()=>{throw new Error('Confirmation was not requested');})]);
    assert.equal(q.kind,'confirm'); assert.match(q.message,/Check|true/);
    assert.equal(q.workflow.kind, 'approve'); assert.match(q.workflow.digest, /^[a-f0-9]{64}$/);
    assert.equal(q.workflow.snapshot.phase, 'awaiting_approval');
    assert.match(q.workflow.snapshot.documents['prd.md'], /Desktop confirmation/);
    child.send({reply:q.id,value:consent}); await turn;
    const task = readdirSync(join(project,'.trellis/tasks')).find(x=>x.includes('storm-'));
    const progress = JSON.parse(readFileSync(join(project,'.trellis/tasks',task,'progress.json'),'utf8'));
    assert.equal(progress.phase,consent?'implementing':'awaiting_approval');
    assert.equal((await request('catalog')).workflow.phase, progress.phase);
    assert.ok(events.filter(e => e.type === 'tool').every(e => e.toolCallId && !('args' in e)), 'Tool events expose IDs, not arbitrary arguments');
  }
  for (const cancel of ['reject', 'stop']) {
    const questionReady = new Promise(resolve => { nextQuestion = resolve; });
    const turn = request('prompt', {text:'desktop browser consent ' + cancel});
    const q = await Promise.race([questionReady, turn.then(() => { throw new Error('Browser confirmation missing'); })]);
    assert.equal(q.title, '连接日常 Chrome？'); assert.equal(q.kind, 'confirm');
    assert.equal(q.workflow, undefined);
    await assert.rejects(request('open', {path:other}), /停止/);
    if (cancel === 'reject') child.send({reply:q.id, value:false});
    else await request('stop');
    await turn;
    assert.ok(events.some(e => e.type === 'dismiss' && e.id === q.id));
    child.send({reply:q.id, value:true}); // Expired reply cannot start a connection.
    assert.equal((await request('catalog')).busy, false);
    assert.equal((await request('catalog')).workflow.phase, 'implementing');
  }
  await request('profile',{id:'code-review'});
  assert.ok((await request('diagnostics')).tools.includes('bash'), 'An active development task takes precedence over the new-task default');
  await request('prompt',{text:'Check the existing task role'});
  assert.ok(JSON.stringify(bodies.at(-1).messages).includes('角色：通用开发助手'),'An existing task must retain its accepted role');
  assert.match((await request('changes')).text,/未跟踪文件/);
  await assert.rejects(request('saveModel',{...valid,baseUrl:'https://new.example.com/v1',key:''}),/密钥/);
  // Seed an old generated instruction only while the worker is stopped: no concurrent session writer.
  await request('close'); await new Promise(resolve => child.once('exit', resolve));
  const oldSession = SessionManager.open(persisted);
  oldSession.appendCustomMessageEntry('trellis-runtime-context', 'LEGACY_WORKFLOW_SENTINEL', false);
  oldSession.appendCustomMessageEntry('project-policy', 'KEEP_PROJECT_POLICY_SENTINEL', false);
  oldSession.appendMessage({role:'user',content:'保留用户引用 <workflow-state>USER_TEXT</workflow-state>',timestamp:Date.now()});
  await start(); await request('open', {path:project});
  await request('prompt', {text:'context restore regression'});
  const restoredRequest = JSON.stringify(bodies.at(-1).messages);
  assert.doesNotMatch(restoredRequest, /LEGACY_WORKFLOW_SENTINEL/);
  assert.match(restoredRequest, /KEEP_PROJECT_POLICY_SENTINEL/);
  assert.match(restoredRequest, /<workflow-state>USER_TEXT<\/workflow-state>/);
  assert.match(restoredRequest, /角色：通用开发助手/);
  assert.equal((await request('catalog')).workflow.phase, 'implementing');
  assert.ok((await request('diagnostics')).tools.includes('bash'), 'Restart restores the active task capability, not the selected new-task default');
  assert.ok(!(await request('diagnostics')).tools.includes('trellis_subagent'), 'Policy must never re-enable the host-excluded tool');
  assert.ok(readFileSync(persisted, 'utf8').includes('LEGACY_WORKFLOW_SENTINEL'), 'Filtering requests never erases saved history');
  const picture = {mimeType:'image/png', data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jmioAAAAASUVORK5CYII='};
  const imageConfig = (await request('catalog')).config;
  const beforeImageRequests = bodies.length;
  await assert.rejects(request('prompt', {text:'picture', image:picture}), /未声明支持图片/);
  assert.equal(bodies.length, beforeImageRequests);
  await request('saveModel', {...imageConfig, vision:true});
  assert.equal((await request('catalog')).supportsImages, true);
  for (const choice of ['cancel', 'stop', 'send']) {
    const count = bodies.length;
    const questionReady = new Promise(resolve => { nextQuestion = resolve; });
    const turn = request('prompt', {text:'Screenshot fixture ' + choice, image:picture});
    const outcome = choice === 'send' ? turn : assert.rejects(turn, /取消|abort/i);
    const q = await questionReady;
    assert.equal(q.title, '发送这张截图给模型？'); assert.match(q.message, /storm-proxy/);
    if (choice === 'stop') await request('stop'); else child.send({reply:q.id, value:choice === 'send'});
    await outcome;
    if (choice !== 'send') {
      assert.equal(bodies.length, count);
      assert.ok(!readFileSync((await request('diagnostics')).sessionFile, 'utf8').includes(picture.data));
    }
  }
  assert.ok(JSON.stringify(bodies.at(-1).messages).includes('data:image/png;base64,' + picture.data));
  const imageSession = (await request('diagnostics')).sessionFile;
  assert.ok(readFileSync(imageSession, 'utf8').includes(picture.data));
  const imageEvents = events.filter(e => e.type === 'history').at(-1);
  assert.ok(imageEvents.messages.some(m => m.imageCount === 1));
  assert.ok(!JSON.stringify(imageEvents).includes(picture.data));
  await request('saveModel', {...imageConfig, vision:false});
  await assert.rejects(request('prompt', {text:'Do not silently drop a previous image'}), /不能静默丢图/);
  await request('saveModel', {...imageConfig, vision:true});
  await request('open', {path:project});
  await request('prompt', {text:'Restored picture context'});
  assert.ok(JSON.stringify(bodies.at(-1).messages).includes(picture.data));
  const projectConversation = (await request('catalog')).sessions.find(s => s.active);
  const independent = await request('collect');
  assert.equal(independent.project, null); assert.equal(independent.workspaceKind, 'collector');
  assert.deepEqual((await request('diagnostics')).tools, ['storm_browser_page','storm_collection_plan','storm_collection_run']);
  assert.ok(independent.plugins.every(p => !p.loaded));
  assert.equal(existsSync(join(dataDir, 'collector', '.git')), false);
  assert.equal(existsSync(join(dataDir, 'collector', '.trellis')), false);
  await assert.rejects(request('resume', {id:projectConversation.id}), /不属于/);
  await assert.rejects(request('changes'), /不提供Git/);
  await request('prompt', {text:'请帮我选择采集交付方式'});
  assert.match(JSON.stringify(bodies.at(-1).messages), /独立采集对话/);
  assert.match(JSON.stringify(bodies.at(-1).messages), /Python/);
  assert.doesNotMatch(JSON.stringify(bodies.at(-1).messages), /MediaStorm 工作流已启用|Desktop confirmation|Screenshot fixture/);
  assert.deepEqual(bodies.at(-1).tools.map(t => t.function.name), ['storm_browser_page','storm_collection_plan','storm_collection_run']);
  {
    const questionReady = new Promise(resolve => { nextQuestion = resolve; });
    const turn = request('prompt', {text:'desktop browser consent independent'});
    const q = await questionReady; assert.equal(q.title, '连接日常 Chrome？');
    child.send({reply:q.id, value:false}); await turn;
  }
  for (const decision of [true,false,'stop',true]) {
    const questionReady = new Promise(resolve=>{nextQuestion=resolve;});
    const turn = request('prompt',{text:'collection plan fixture '+decision});
    const q = await questionReady;
    assert.equal(q.title,'确认采集字段、样例与交付方向？'); assert.match(q.message,/尚未验证/);
    if (decision === 'stop') await request('stop'); else child.send({reply:q.id,value:decision});
    await turn;
    assert.equal((await request('catalog')).collectionPlan.status,decision === true?'confirmed':'cancelled');
  }
  const collectorSession = (await request('catalog')).sessions.find(s => s.active);
  await request('fresh');
  assert.equal((await request('catalog')).workspaceKind, 'collector');
  await request('resume', {id:collectorSession.id});
  assert.equal((await request('catalog')).collectionPlan.status,'confirmed');
  assert.ok(events.findLast(e => e.type === 'history').messages.some(m => m.text.includes('请选择') || m.text.includes('请帮我选择')));
  await request('open', {path:project});
  assert.equal((await request('catalog')).workspaceKind, 'project');
  assert.ok((await request('diagnostics')).tools.includes('storm_task'));
  assert.ok(!(await request('diagnostics')).tools.includes('storm_collection_plan'));
  await assert.rejects(request('resume', {id:collectorSession.id}), /不属于/);
  console.log('PASS: independent collector needs no Git/Trellis, has only browser/plan/current-table capabilities, retains real consent, isolates project context/history and restores normal project gates.');
  console.log('PASS: screenshot capability gate, real worker consent/cancel/stop, provider image payload, session persistence/restore, bounded image metadata projection and no silent dropping.');
  console.log('PASS: desktop validation, credentials, model/role restoration, plugin catalog, unified workflow prompts, non-destructive legacy context filtering, SDK/plugins, streaming and approval/cancellation bridge. Local HTTP fixture only; no external model calls.');
} finally { server?.close(); child?.kill(); rmSync(dir,{recursive:true,force:true}); }
