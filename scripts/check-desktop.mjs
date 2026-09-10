import assert from 'node:assert/strict';
import http from 'node:http';
import { fork, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopCredentials, validateSettings } from '../desktop/store.mjs';

const root = process.argv[2] || fileURLToPath(new URL('../', import.meta.url));
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'storm-desktop-check-')));
const requests = new Map(); let child, server, nextQuestion, records = {}, events = [], bodies = [];
try {
  const portableEnv = { HOME:dir, PATH:'/usr/bin:/bin' };
  for (const binary of ['runtime/node/bin/node','runtime/python/bin/python3','runtime/bin/codegraph','node_modules/dugite/git/bin/git']) {
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
  assert.equal(catalog.plugins.length,5); assert.ok(catalog.plugins.every(p => !p.loaded));
  await request('open',{path:project});
  const loadedCatalog = await request('catalog');
  assert.ok(loadedCatalog.plugins.every(p => p.loaded));
  assert.ok(loadedCatalog.plugins.find(p => p.name === 'CodeGraph').tools.includes('codegraph_explore'));
  assert.ok(!loadedCatalog.plugins.find(p => p.name === 'Trellis').tools.includes('trellis_subagent'));
  await assert.rejects(request('profile',{id:'unknown'}),/未知/);
  assert.equal((await request('profile',{id:'bug-fix'})).profile,'bug-fix');
  let diagnostics = await request('diagnostics'); assert.equal(diagnostics.project,project);
  for (const name of ['storm_task','storm_check','codegraph_explore','storm_changes']) assert.ok(diagnostics.tools.includes(name),name);
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
  await request('prompt',{text:'desktop local regression'});
  assert.ok(JSON.stringify(bodies.at(-1).messages).includes('角色：故障定位与修复助手'));
  assert.ok(events.filter(e => ['message','stream','message-end'].includes(e.type)).every(e => ['user','assistant','toolResult'].includes(e.message.role)), 'Hidden extension context must not enter the visible stream');
  assert.ok(events.some(e=>e.type==='stream' && e.message.text.includes('LOCAL_OK')));
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
  for (const consent of [false, true]) {
    const questionReady = new Promise(resolve => { nextQuestion=resolve; });
    const turn = request('prompt',{text:'desktop confirmation '+String(consent)});
    const q = await Promise.race([questionReady,turn.then(()=>{throw new Error('Confirmation was not requested');})]);
    assert.equal(q.kind,'confirm'); assert.match(q.message,/Check|true/);
    child.send({reply:q.id,value:consent}); await turn;
    const task = readdirSync(join(project,'.trellis/tasks')).find(x=>x.includes('storm-'));
    const progress = JSON.parse(readFileSync(join(project,'.trellis/tasks',task,'progress.json'),'utf8'));
    assert.equal(progress.phase,consent?'implementing':'awaiting_approval');
  }
  await request('profile',{id:'code-review'});
  await request('prompt',{text:'Check the existing task role'});
  assert.ok(JSON.stringify(bodies.at(-1).messages).includes('角色：通用开发助手'),'An existing task must retain its accepted role');
  assert.match((await request('changes')).text,/未跟踪文件/);
  await assert.rejects(request('saveModel',{...valid,baseUrl:'https://new.example.com/v1',key:''}),/密钥/);
  console.log('PASS: desktop validation, serialized credentials, model switching/restart, role prompts, actual plugin catalog, real SDK/plugins, missing auth, same-name project isolation, configuration, conversation recovery, model streaming, and approval/cancellation bridge. Local HTTP fixture only; no external model calls.');
} finally { server?.close(); child?.kill(); rmSync(dir,{recursive:true,force:true}); }
