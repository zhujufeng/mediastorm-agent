import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const moduleRoot=process.argv.includes('--unit')&&process.argv[3]||fileURLToPath(new URL('../',import.meta.url));
const {withSurveyPage,publicResponse,connectionDiagnostic,parseResponse}=await import(pathToFileURL(join(moduleRoot,'desktop/browser-survey.mjs')).href);
const {recipeAccess,currentRecipeResult,serializeRecipeResult,appendRecipePage,validateRecipe}=await import(pathToFileURL(join(moduleRoot,'desktop/collection-recipe.mjs')).href);
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {fork} from 'node:child_process';
const recipe=validateRecipe({name:'每日商品',scope:'当前页面日期筛选下的全部商品',arrayPath:['rows'],idPath:['id'],totalPath:['total'],fields:[{name:'商品ID',path:['id']},{name:'商品名',path:['name']}],maxRecords:100,maxPages:10});
const fixture=(page,id=page,total=3)=>({issues:[],documents:[{url:'https://example.test/data',method:'POST',data:{rows:[{id,name:'商品'+id}],total}}],snapshot:{filters:['昨日'],paging:{regions:1,current:page,hasNext:true,nextDisabled:page===3}}});
const fresh=()=>({pages:0,ids:new Set(),records:[]});
const specification={...recipe,endpoint:'https://example.test/data',method:'POST'};
const state=fresh();assert.equal(appendRecipePage(state,specification,fixture(1)),false);
assert.throws(()=>appendRecipePage(state,specification,fixture(2,1)),/重复/);
assert.throws(()=>appendRecipePage(state,specification,fixture(3)),/页序/);
assert.throws(()=>appendRecipePage(state,specification,fixture(2,2,4)),/总数发生变化/);
assert.throws(()=>appendRecipePage(state,specification,{...fixture(2),snapshot:{...fixture(2).snapshot,filters:['其他日期']}}),/筛选/);
assert.equal(appendRecipePage(state,specification,fixture(2)),false);assert.equal(appendRecipePage(state,specification,fixture(3)),true);
assert.equal(state.ids.size,3);
const empty=fixture(1,1,0);empty.documents[0].data.rows=[];empty.snapshot.paging.nextDisabled=true;assert.equal(appendRecipePage(fresh(),specification,empty),true);
const premature=fixture(1);premature.snapshot.paging.nextDisabled=true;assert.throws(()=>appendRecipePage(fresh(),specification,premature),/总数不一致/);
assert.throws(()=>appendRecipePage(fresh(),{...specification,totalPath:['rows','length']},fixture(1)),/length/);
const huge=fresh();huge.bytes=10*1024*1024;assert.throws(()=>appendRecipePage(huge,specification,fixture(1)),/10MiB/);
assert.throws(()=>validateRecipe({...recipe,fields:[recipe.fields[1]]}),/唯一ID/);
assert.deepEqual(parseResponse('{"id":9007199254740993,"amount":0.1234567890123456789}'),{id:'9007199254740993',amount:'0.1234567890123456789'});
assert.equal(connectionDiagnostic(new Error('masked',{cause:{error:{code:'ECONNREFUSED'}}})),'ECONNREFUSED');
assert.deepEqual(publicResponse({password:'never',rows:[{id:1,authorization:'never'}]}),{rows:[{id:1}]});
assert.equal(publicResponse({text:'x'.repeat(4001)}).text,'[字段超过4000字符，已省略]');
const omitted=fixture(1);omitted.documents[0].data.rows[0].name='[字段超过4000字符，已省略]';assert.throws(()=>appendRecipePage(fresh(),specification,omitted),/过滤或过长/);
assert.equal(publicResponse('https://example.test/path?token=never'),'[含敏感参数或片段的链接，已省略]');
assert.equal(publicResponse('https://example.test/path?productId=123'),'https://example.test/path?productId=123');
const yesUI={hasUI:true,ui:{confirm:async()=>true}};
let started,releaseConnection,disconnected,disconnects=0;
const connectionStarted=new Promise(resolve=>{started=resolve;}),lateConnection=new Promise(resolve=>{releaseConnection=resolve;}),lateDisconnected=new Promise(resolve=>{disconnected=resolve;});
const cancelled=new AbortController();
const late=withSurveyPage(yesUI,cancelled.signal,()=>assert.fail('cancelled connection must not inspect pages'),()=>{started();return lateConnection;});
await connectionStarted;cancelled.abort();await assert.rejects(late,/取消/);
releaseConnection({disconnect:async()=>{disconnects++;disconnected();}});await lateDisconnected;assert.equal(disconnects,1);
const broken=recipeAccess(()=>SessionManager.inMemory(),async()=>({target:()=>({createCDPSession:async()=>({send:async()=>({targetInfos:[]}),detach:async()=>{throw new Error('synthetic detach failure');}})}),disconnect:async()=>{disconnects++;}}));
await assert.rejects(broken.tool.execute('cleanup',{action:'survey'},undefined,undefined,yesUI),/释放未确认/);
await assert.rejects(broken.stop(),/释放未确认/);assert.equal(disconnects,2);
if (process.argv.includes('--unit')) { console.log('PASS: response secret filtering, bounded fields and nested transport diagnostics.'); }
else {
  assert.equal(process.platform,'darwin','Default channel discovery fixture currently targets Mac only.');
  const root=fileURLToPath(new URL('../',import.meta.url));
  process.env.PLAYWRIGHT_BROWSERS_PATH=join(root,'.local/desktop-downloads/playwright');
  const {chromium}=await import('playwright');
  const temporary=await mkdtemp(join(tmpdir(),'storm-survey-'));
  const oldHome=process.env.HOME;
  let context,worker,posts=0,assets=0,day=0,repeated=false,expired=false;
  const modelBodies=[];
  const cross=createServer((_req,res)=>{assets++;res.setHeader('Content-Type','application/javascript');res.end('window.assetReady=true;');});
  const server=createServer((req,res)=>{
    if(req.url==='/v1/chat/completions') {
      let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
        const body=JSON.parse(raw);modelBodies.push(body);
        const userIndex=body.messages.findLastIndex(message=>message.role==='user');
        const messages=body.messages.slice(userIndex+1).filter(message=>message.role==='tool');
        const rerun=/运行已保存/.test(JSON.stringify(body.messages[userIndex].content));
        let args;
        if(rerun){if(!messages.length)args={action:'run'};}
        else if(!messages.length)args={action:'survey'};
        else if(messages.length===1) {
          const observation=JSON.parse(messages[0].content);
          const candidate=observation.candidates.find(item=>item.preview&&Object.values(item.preview).some(value=>value?.arrayLength>0));
          const arrayKey=Object.keys(candidate.preview).find(key=>candidate.preview[key]?.arrayLength>0);
          const sample=candidate.preview[arrayKey].samples[0];
          const totalKey=Object.keys(candidate.preview).find(key=>/total/i.test(key)&&/^\d+$/.test(String(candidate.preview[key])));
          const idKey=Object.keys(sample).find(key=>/^id$/i.test(key));
          args={action:'plan',surveyId:observation.surveyId,candidateId:candidate.id,recipe:{...recipe,arrayPath:[arrayKey],idPath:[idKey],totalPath:[totalKey],fields:Object.keys(sample).map(key=>({name:key,path:[key]}))}};
        } else if(messages.length===2)args={action:'run'};
        const delta=args?{role:'assistant',tool_calls:[{index:0,id:'autonomous-'+modelBodies.length,type:'function',function:{name:'storm_collection_autonomous',arguments:JSON.stringify(args)}}]}:{role:'assistant',content:'已完成实际全量核对。'};
        res.writeHead(200,{'Content-Type':'text/event-stream'});
        res.end('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta,finish_reason:null}]})+'\n\n'+'data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:{},finish_reason:args?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\ndata: [DONE]\n\n');
      });return;
    }
    if(req.url==='/data') {posts++;if(expired||!req.headers.cookie?.includes('synthetic-session-not-for-model')){res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":"login required"}');return;}let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{const page=JSON.parse(body||'{}').page||1;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({total:3,rows:[{id:day*10+(repeated?1:page),name:'合成商品'+page,password:'do-not-send'}]}));});return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if(req.url==='/sentinel') {res.end('<title>哨兵</title><h1>other-page-private</h1>');return;}
    res.setHeader('Set-Cookie','session=synthetic-session-not-for-model; HttpOnly; SameSite=Lax');
    res.end(`<title>商品调查测试</title><script src="http://127.0.0.1:${cross.address().port}/asset.js"></script><h1>商品列表</h1><form><input name="date" value="2026-09-15"></form><div id="loaded"></div><div class="pagination"><button onclick="go(1)">1</button><span aria-current="page">1</span><button id="next" aria-label="下一页" onclick="go(current+1)">下一页</button></div><script>let current=1;function go(page){history.replaceState({},'', '/products?page='+page);fetch('/data',{method:'POST',body:JSON.stringify({page})}).then(r=>r.json()).then(d=>{current=page;document.querySelector('#loaded').textContent='ready';document.querySelector('[aria-current]').textContent=page;document.querySelector('#next').disabled=page===3;});}go(Number(new URLSearchParams(location.search).get('page')||1));</script>`);
  });
  const listen=service=>new Promise(resolve=>service.listen(0,'127.0.0.1',resolve));
  const stop=service=>{service.closeAllConnections();return new Promise(resolve=>service.close(resolve));};
  try {
    await listen(cross);await listen(server);
    const base=`http://127.0.0.1:${server.address().port}`;
    const profile=join(temporary,'profile');
    context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--remote-debugging-port=0']});
    const sentinel=context.pages()[0];await sentinel.goto(base+'/sentinel');await sentinel.evaluate(()=>window.kept='untouched');
    const chosen=await context.newPage();await chosen.goto(base+'/products');await chosen.waitForSelector('#loaded:text("ready")');
    const home=join(temporary,'home');await mkdir(join(home,'Library/Application Support/Google/Chrome'),{recursive:true});
    await writeFile(join(home,'Library/Application Support/Google/Chrome/DevToolsActivePort'),await readFile(join(profile,'DevToolsActivePort')));
    process.env.HOME=home;
    let confirmations=0;
    const ctx={hasUI:true,ui:{confirm:async()=>{confirmations++;return true;},select:async(_title,labels)=>labels.find(label=>label.includes('商品调查测试'))}};
    const result=await withSurveyPage(ctx,undefined,async page=>page.observe());
    assert.equal(confirmations,2);assert.ok(result.documents.some(doc=>doc.method==='POST'&&doc.data.rows?.[0]?.id==='1'));
    assert.ok(!JSON.stringify(result).includes('do-not-send'));assert.ok(!JSON.stringify(result).includes('other-page-private'));
    assert.ok(result.snapshot.filters.includes('2026-09-15'));
    assert.ok(posts>=2&&assets>=2,'normal POST and cross-origin asset loading survive reload');
    assert.equal(await sentinel.evaluate(()=>window.kept),'untouched');assert.equal(chosen.isClosed(),false);assert.equal(context.pages().length,2);
    await assert.rejects(withSurveyPage({hasUI:false},undefined,()=>{}),/真实授权/);
    await assert.rejects(withSurveyPage({hasUI:true,ui:{confirm:async()=>false}},undefined,()=>{throw new Error('must not run');}),/取消/);
    const beforeDecline=posts;
    for(const decline of ['select','scope']){
      let count=0;const rejecting={hasUI:true,ui:{confirm:async()=>++count===1,select:async(...args)=>decline==='select'?undefined:ctx.ui.select(...args)}};
      await assert.rejects(withSurveyPage(rejecting,undefined,()=>assert.fail('declined scope must not run')),/取消/);
    }
    assert.equal(posts,beforeDecline,'Declining selection or scope does not refresh or query the page');
    const abort=new AbortController();
    await assert.rejects(withSurveyPage(ctx,abort.signal,async page=>{setTimeout(()=>abort.abort(),100);await page.observe();}),/取消|aborted/);
    assert.equal(chosen.isClosed(),false);assert.equal(context.pages().length,2);
    await assert.rejects(withSurveyPage(ctx,undefined,async page=>{
      await chosen.evaluate(()=>{history.pushState({},'', '/unauthorized');history.replaceState({},'', '/products');});
      await page.dom();
    }),/离开授权范围/);
    assert.equal(chosen.isClosed(),false);
    await withSurveyPage(ctx,undefined,async page=>{
      const pending=page.observe();await new Promise(resolve=>setTimeout(resolve,400));day=1;await chosen.reload();
      const snapshot=await pending;assert.ok(snapshot.documents.length);assert.ok(snapshot.documents.every(document=>document.data.rows?.[0]?.id==='11'),'A same-URL replacement cannot return the previous document response');
    });day=0;
    const manager=SessionManager.inMemory();const access=recipeAccess(()=>manager);
    const call=params=>access.tool.execute('fixture',params,undefined,undefined,ctx);
    const investigation=(await call({action:'survey'})).details;
    const candidate=investigation.candidates.find(item=>item.method==='POST'&&item.preview?.rows?.arrayLength);
    assert.ok(candidate);
    await call({action:'plan',surveyId:investigation.surveyId,candidateId:candidate.id,recipe});
    await call({action:'run'});
    const first=currentRecipeResult(manager);assert.deepEqual(first.data.records.map(row=>row[0]),['1','2','3']);
    assert.equal(first.data.pages,3);assert.equal(first.data.allPagesVerified,true);
    assert.match(serializeRecipeResult(first,'csv'),/合成商品3/);
    assert.equal(JSON.parse(serializeRecipeResult(first,'json')).expectedTotal,3);
    await access.stop();day=1;
    const restored=recipeAccess(()=>manager);
    await restored.tool.execute('next-day',{action:'run'},undefined,undefined,ctx);
    assert.deepEqual(currentRecipeResult(manager).data.records.map(row=>row[0]),['11','12','13']);
    repeated=true;
    await assert.rejects(restored.tool.execute('bad-page',{action:'run'},undefined,undefined,ctx),/重复/);
    assert.equal(currentRecipeResult(manager),null,'failed run cannot reuse yesterday’s result');
    await restored.stop();assert.equal(context.pages().length,2);
    repeated=false;
    const dataDir=join(temporary,'app-data');await mkdir(dataDir);
    const requests=new Map();let credentials={},sequence=0;
    const request=(action,data={})=>new Promise((resolve,reject)=>{const id=String(++sequence);const timer=setTimeout(()=>{requests.delete(id);reject(new Error('worker timeout: '+action));},90000);requests.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});worker.send({id,action,data});});
    let questions=0,onWorking;
    await new Promise((resolve,reject)=>{
      worker=fork(join(root,'desktop/worker.mjs'),[],{execPath:join(root,'runtime/node/bin/node'),cwd:dataDir,env:{HOME:home,PATH:[join(root,'runtime/node/bin'),'/usr/bin','/bin'].join(':'),STORM_USER_DATA:dataDir,PI_CODING_AGENT_DIR:join(dataDir,'pi')},stdio:['ignore','pipe','pipe','ipc']});
      let errors='';worker.stderr.on('data',chunk=>errors=(errors+chunk).slice(-4000));worker.stdout.on('data',()=>{});worker.once('error',reject);worker.on('exit',code=>{for(const entry of requests.values())entry.reject(new Error('worker exited: '+errors));requests.clear();if(code)reject(new Error(errors));});
      worker.on('message',event=>{
        if(event.type==='ready')resolve();
        else if(event.type==='working')onWorking?.(event.text);
        else if(event.type==='credentials'){if(event.action==='write')credentials=structuredClone(event.data);worker.send({reply:event.id,value:event.action==='write'?true:credentials});}
        else if(event.type==='response'){const entry=requests.get(event.id);requests.delete(event.id);event.error?entry?.reject(new Error(event.error)):entry?.resolve(event.value);}
        else if(event.type==='question'){questions++;worker.send({reply:event.id,value:event.kind==='select'?event.options.find(option=>option.label.includes('商品调查测试'))?.id:true});}
      });
    });
    await request('saveModel',{provider:'storm-proxy',model:'fixture',baseUrl:base+'/v1',api:'openai-completions',key:'synthetic-only'});
    await request('collect');
    await request('prompt',{text:'全部商品，每天采集一遍。'});
    const catalog=await request('catalog');assert.equal(catalog.collectionData.count,3);assert.equal(catalog.collectionRecipe.status,'confirmed');
    assert.equal(modelBodies.length,4,'real SDK continues survey → plan → run without user teaching API or selectors');
    assert.ok(questions>=5,'scope and plan approvals remain real bridge requests');
    assert.ok(!JSON.stringify(modelBodies).includes('do-not-send'));
    assert.ok(!JSON.stringify(modelBodies).includes('synthetic-session-not-for-model'));
    const exported=await request('collectionExport',{format:'json',digest:catalog.collectionData.digest});assert.equal(JSON.parse(exported.content).uniqueCount,3);
    await assert.rejects(request('collectionExport',{format:'json',digest:'stale'}),/变化/);
    const pageReached=new Promise(resolve=>{onWorking=text=>{if(/第1页/.test(text))resolve();};});
    const stopping=request('prompt',{text:'运行已保存方案'}).then(()=>null,error=>error);
    await Promise.race([pageReached,stopping.then(()=>{throw new Error('Run finished before the stop barrier');})]);
    await request('stop');await stopping;onWorking=undefined;
    assert.equal((await request('catalog')).collectionData,null,'Real worker stop invalidates a previous successful full result');
    assert.equal(chosen.isClosed(),false);
    const exited=new Promise(resolve=>worker.once('exit',resolve));await request('close');await exited;worker=undefined;
    expired=true;
    await assert.rejects(restored.tool.execute('expired',{action:'run'},undefined,undefined,ctx),/HTTP 401/);
    assert.equal(currentRecipeResult(manager),null);
    await restored.stop();
    console.log('PASS: real worker/SDK/model tool loop autonomously discovers response field paths, confirms, collects all pages and exports; no API/selector instructions in the user goal. Synthetic model only.');
    console.log('PASS: real default Chrome discovery and borrowed-tab JSON investigation; confirmed three-page collection, exact CSV/JSON truth, next-day changed IDs, duplicate-page failure and result invalidation.');
  } finally {
    if(oldHome===undefined)delete process.env.HOME;else process.env.HOME=oldHome;
    if(worker){const exited=new Promise(resolve=>worker.once('exit',resolve));worker.kill();await exited;}
    await context?.close();await stop(server);await stop(cross);await rm(temporary,{recursive:true,force:true});
  }
}
