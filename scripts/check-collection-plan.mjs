import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { collectionTools, currentCollectionPlan, validateCollectionPlan } from '../desktop/collection-plan.mjs';

const manager = SessionManager.inMemory();
const plan = {goal:'导出订单', source:{basis:'description', url:'https://example.com/orders'},
  fields:[{name:'订单号',meaning:'后台显示的编号'}, {name:'金额',meaning:'原币种金额文本'}],
  samples:[['A-1',null]], missing:['金额和币种待确认'], scope:'上月订单，不操作删除或提交', maxRecords:100,
  delivery:{format:'python',reason:'后续需要批量清洗，API与登录方式仍待调查'}};
const tools = collectionTools({name:'storm_browser_page',execute:async()=>({content:[]})}, () => manager);
const tool = tools[1];
const ctx = {hasUI:true, ui:{confirm:async()=>true}};
const call = (args, context = ctx, signal) => tool.execute('plan-fixture', args, signal, undefined, context);
assert.equal(currentCollectionPlan(manager), null);
for (const bad of [{...plan, confirmed:true}, {...plan,maxRecords:0}, {...plan,fields:[plan.fields[0],plan.fields[0]]}, {...plan,samples:[['wrong width']]}, {...plan,source:{basis:'description',url:'https://example.com/?token=secret'}}, {...plan,delivery:{format:'bash',reason:'no'}}]) assert.throws(()=>validateCollectionPlan(bad));
await assert.rejects(call({action:'propose',plan},{hasUI:false}),/真实确认/);
assert.equal(currentCollectionPlan(manager),null);
let shown;
await call({action:'propose',plan},{hasUI:true,ui:{confirm:async(title,text)=>{shown=text;return true;}}});
assert.match(shown,/尚未验证/); assert.match(shown,/Python代码/);
assert.equal(currentCollectionPlan(manager).status,'confirmed');
assert.equal(currentCollectionPlan(manager).executionAuthorized,false);
assert.equal(currentCollectionPlan(manager).dataVerified,false);
const original = currentCollectionPlan(manager).digest;
await call({action:'propose',plan:{...plan,maxRecords:50}},{hasUI:true,ui:{confirm:async()=>false}});
assert.equal(currentCollectionPlan(manager).status,'cancelled');
assert.notEqual(currentCollectionPlan(manager).digest,original);
const controller = new AbortController();
let release, entered;
const waiting = new Promise(resolve=>{entered=resolve;});
const pending = call({action:'propose',plan},{hasUI:true,ui:{confirm:async()=>{entered();return new Promise(resolve=>{release=resolve;});}}},controller.signal);
const rejection = assert.rejects(pending,/abort/i);
await waiting;
assert.equal(currentCollectionPlan(manager).status,'pending');
await assert.rejects(tools[0].execute(),/正在进行/);
await assert.rejects(call({action:'current'}),/正在进行/);
controller.abort(); release(true); await rejection;
assert.equal(currentCollectionPlan(manager).status,'cancelled');
await assert.rejects(call({action:'propose',plan:{...plan,source:{basis:'screenshot'}}}),/没有.*截图/);
await assert.rejects(call({action:'propose',plan:{...plan,source:{basis:'browser',url:'https://example.com/',toolCallId:'missing'}}}),/成功/);
manager.appendMessage({role:'toolResult',toolName:'storm_browser_page',toolCallId:'page-1',isError:false,content:[{type:'text',text:JSON.stringify({source:'https://example.com',text:'订单 A-1',title:'fixture',untrusted:true})}],timestamp:Date.now()});
await assert.rejects(call({action:'propose',plan:{...plan,source:{basis:'browser',url:'https://different.example/',toolCallId:'page-1'}}}),/不一致/);
await call({action:'propose',plan:{...plan,source:{basis:'browser',url:'https://example.com/orders',toolCallId:'page-1'}}});
assert.equal(currentCollectionPlan(manager).plan.source.toolCallId,'page-1');
assert.equal(JSON.parse((await call({action:'current'})).content[0].text).status,'confirmed');
manager.appendCustomEntry('mediastorm-collection-plan',{...currentCollectionPlan(manager),executionAuthorized:true});
assert.throws(()=>currentCollectionPlan(manager),/记录无效/);
console.log('PASS: collection plan validation, real SDK custom records, explicit confirmation/cancel, stale consent, shared tool exclusion, provenance checks and no execution/data verification grants.');
