import { createHash } from 'node:crypto';
import { browserPageUrl } from './browser-page.mjs';
import { textInput } from './store.mjs';
import { buildCollectionData, collectionDataKind, requireCollectionDataPlan } from './collection-data.mjs';

const kind = 'mediastorm-collection-plan';
const formats = {data:'直接交付数据', 'chrome-extension':'Chrome插件', python:'Python代码', typescript:'TypeScript代码'};
const string = maxLength => ({type:'string', minLength:1, maxLength});
const object = (properties, required = Object.keys(properties)) => ({type:'object', properties, required, additionalProperties:false});
const list = (items, maxItems, minItems = 0) => ({type:'array', items, minItems, maxItems});
const schema = object({
  goal:string(500), capture:{type:'string',enum:['current-page-table']}, source:object({basis:{type:'string', enum:['description','screenshot','browser']}, url:string(4096), toolCallId:string(200)}, ['basis']),
  fields:list(object({name:string(80), meaning:string(300)}), 12, 1),
  samples:list(list({type:['string','null'], maxLength:300}, 12, 1), 5),
  missing:list(string(300), 12), scope:string(1000), maxRecords:{type:'integer', minimum:1, maximum:100000},
  delivery:object({format:{type:'string', enum:Object.keys(formats)}, reason:string(500)}),
}, ['goal','source','fields','samples','missing','scope','maxRecords','delivery']);
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('采集方案字段无效。');
}
function array(value, max, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error('采集方案列表数量无效。');
  return value;
}
export function validateCollectionPlan(input) {
  keys(input, Object.keys(schema.properties)); keys(input.source, ['basis','url','toolCallId']); keys(input.delivery, ['format','reason']);
  if (!['description','screenshot','browser'].includes(input.source.basis) || !Object.hasOwn(formats, input.delivery.format)) throw new Error('来源或交付形式无效。');
  if (input.capture !== undefined && input.capture !== 'current-page-table') throw new Error('采集模式无效。');
  const source = {basis:input.source.basis};
  if (input.source.url !== undefined) {
    const url = browserPageUrl(input.source.url);
    if (url.search) throw new Error('来源地址不能包含查询参数；筛选条件请写入采集范围。');
    source.url = url.href;
  }
  if (input.source.toolCallId !== undefined) source.toolCallId = textInput(input.source.toolCallId, '来源调用ID', 200);
  if (source.basis !== 'browser' && source.toolCallId) throw new Error('只有浏览器来源可以引用调用ID。');
  const fields = array(input.fields, 12, 1).map(field => { keys(field,['name','meaning']); return {name:textInput(field.name,'字段名',80), meaning:textInput(field.meaning,'字段含义',300)}; });
  if (new Set(fields.map(field => field.name)).size !== fields.length) throw new Error('字段名不能重复。');
  const samples = array(input.samples, 5).map(row => {
    if (array(row,12,1).length !== fields.length) throw new Error('样例每行须与字段数量一致；缺失值使用null。');
    return row.map(value => value === null ? null : textInput(value, '样例值',300));
  });
  if (!Number.isSafeInteger(input.maxRecords) || input.maxRecords < 1 || input.maxRecords > 100000) throw new Error('采集条数上限须在1到100000之间。');
  return {goal:textInput(input.goal,'采集目标',500), ...(input.capture ? {capture:input.capture} : {}), source, fields, samples, missing:array(input.missing,12).map(value=>textInput(value,'缺失项',300)),
    scope:textInput(input.scope,'采集范围',1000), maxRecords:input.maxRecords,
    delivery:{format:input.delivery.format, reason:textInput(input.delivery.reason,'交付理由',500)}};
}
const digest = plan => createHash('sha256').update(JSON.stringify(plan)).digest('hex');
export function currentCollectionPlan(manager) {
  const entry = manager?.getBranch().findLast(item => item.type === 'custom' && item.customType === kind);
  if (!entry) return null;
  const value = entry.data;
  if (!value || value.version !== 1 || value.dataVerified !== false || value.executionAuthorized !== false || digest(validateCollectionPlan(value.plan)) !== value.digest || !['pending','confirmed','cancelled'].includes(value.status)) throw new Error('采集方案记录无效，请重新整理并确认。');
  return value;
}
export function renderCollectionPlan(plan) {
  return [`目标：${plan.goal}`, `来源：${({description:'需求描述（未核验）', screenshot:'会话截图（未核验）', browser:'本会话浏览器正文（字段对应关系未核验）'})[plan.source.basis]}`,
    `采集方式：${plan.capture === 'current-page-table' ? '仅当前页可见标准表格；不翻页、不自动筛选，不验证时间范围' : '尚未确定，不能自动执行'}`, `地址：${plan.source.url || '尚未确定'}`,  `来源调用：${plan.source.toolCallId || '无'}`,
    '字段：', ...plan.fields.map((field,i)=>`${i+1}. ${field.name}：${field.meaning}`),
    '样例（AI整理草案，不是已验证数据）：', ...(plan.samples.length ? plan.samples.map((row,i)=>`样例${i+1}：` + row.map((value,j)=>`${plan.fields[j].name} = ${value === null ? '缺失' : JSON.stringify(value)}`).join('；')) : ['尚无样例，不得据此声称已完成采集。']),
    `缺失/待核对：${plan.missing.join('；') || '未列出；不代表数据已完整'}`, `范围：${plan.scope}`, `最多条数：${plan.maxRecords}`,
    `交付形式：${formats[plan.delivery.format]}`, `选择理由：${plan.delivery.reason}`,
    '确认仅认可需求、字段和交付方向；样例正确性、字段对应关系及全量完整性均尚未验证。不会授权额外网页访问或代码执行，也不代表交付验收。'].join('\n');
}
function checkSource(plan, manager) {
  const branch = manager.getBranch();
  if (plan.source.basis === 'screenshot' && !branch.some(entry => entry.type === 'message' && entry.message.role === 'user' && Array.isArray(entry.message.content) && entry.message.content.some(part=>part.type==='image'))) throw new Error('本会话没有可引用的用户截图。');
  if (plan.source.basis !== 'browser') return;
  const message = branch.findLast(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'storm_browser_page' && entry.message.toolCallId === plan.source.toolCallId)?.message;
  if (!message || message.isError || !plan.source.url) throw new Error('浏览器来源必须引用本会话成功的网页读取和来源地址。');
  let data;
  try { data = JSON.parse(message.content.filter(part=>part.type==='text').map(part=>part.text).join('\n')); } catch { throw new Error('浏览器来源结果无法核对。'); }
  if (data.untrusted !== true || data.source !== new URL(plan.source.url).origin) throw new Error('方案地址与网页读取来源不一致。');
}
export function collectionTools(browser, manager) {
  let pending = false;
  const planTool = {
    name:'storm_collection_plan', label:'确认采集方案',
    description:'独立采集对话中整理字段、最多5条样例、缺失项、范围与交付形式并请求真实确认。action=current读取当前方案；action=propose提交完整plan。样例只是草案，来源引用不等于字段映射已验证。取消后等待用户修改意见，不重复弹窗。',
    parameters:object({action:{type:'string',enum:['current','propose']}, plan:schema}, ['action']),
    async execute(_id, params, signal, _update, ctx) {
      keys(params,['action','plan']);
      if (params.action === 'current' && params.plan === undefined) return {content:[{type:'text',text:JSON.stringify(currentCollectionPlan(manager()))}]};
      if (params.action !== 'propose') throw new Error('采集方案操作无效。');
      if (!ctx.hasUI) throw new Error('采集方案需要真实确认界面。');
      signal?.throwIfAborted();
      const plan = validateCollectionPlan(params.plan), store = manager();
      checkSource(plan, store);
      const record = {version:1, plan, digest:digest(plan), status:'cancelled', dataVerified:false, executionAuthorized:false, at:new Date().toISOString()};
      store.appendCustomEntry(kind, {...record, status:'pending'});
      store.appendCustomEntry(collectionDataKind, {status:'invalidated', planDigest:record.digest});
      try {
        const accepted = await ctx.ui.confirm('确认采集字段、样例与交付方向？', renderCollectionPlan(plan), {signal, timeout:120000});
        signal?.throwIfAborted();
        if (accepted === true) record.status = 'confirmed';
      } finally { store.appendCustomEntry(kind, record); }
      return {content:[{type:'text',text:JSON.stringify(record)}], details:record};
    },
  };
  const runTool = {
    name:'storm_collection_run', label:'采集当前页表格',
    description:'仅对已确认的data或chrome-extension/current-page-table方案做桌面当前页核验。重新打开并真实确认读取源页面，精确匹配唯一表格及字段和完整预期样例。最多50条/快照上限内；不翻页或验证时间筛选，超限/不匹配不返回部分成功。结果保存后由用户主动导出CSV/JSON；插件形式还可导出固定模板的Chrome插件文件夹，需手动加载和实跑，不自动安装。不能执行任意插件代码、Python或TS。',
    parameters:object({}),
    async execute(id, params, signal, update, ctx) {
      keys(params, []);
      const store = manager(), plan = currentCollectionPlan(store);
      requireCollectionDataPlan(plan);
      signal?.throwIfAborted();
      store.appendCustomEntry(collectionDataKind, {status:'pending', planDigest:plan.digest});
      try {
        const result = await browser.execute(id, {url:plan.plan.source.url}, signal, update, ctx);
        signal?.throwIfAborted();
        const latest = currentCollectionPlan(store);
        if (latest?.status !== 'confirmed' || latest.digest !== plan.digest) throw new Error('采集期间方案已变化，请重新确认。');
        const artifact = buildCollectionData(plan, result.details);
        store.appendCustomEntry(collectionDataKind, artifact);
        return {content:[{type:'text',text:JSON.stringify(artifact)}],details:artifact};
      } catch (error) {
        store.appendCustomEntry(collectionDataKind, {status:'failed',planDigest:plan.digest});
        throw error;
      }
    },
  };
  return [browser, planTool, runTool].map(tool => ({...tool, async execute(...args) {
    if (pending) throw new Error('网页调查、方案确认或采集正在进行，请等待结束。');
    pending = true;
    try { return await tool.execute(...args); } finally { pending = false; }
  }}));
}
