import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {withSurveyPage,responsePreview} from './browser-survey.mjs';
import {secretKey} from './browser-page.mjs';
import {collectionCSV} from './collection-data.mjs';

const recipeKind='mediastorm-collection-recipe', resultKind='mediastorm-collection-recipe-result';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const engine=createHash('sha256').update(readFileSync(new URL('./browser-survey.mjs',import.meta.url))).update(readFileSync(new URL('./collection-recipe.mjs',import.meta.url))).digest('hex');
const forbidden=key=>secretKey.test(key)||/cookie|csrf|credential|signature/i.test(key)||['__proto__','constructor','prototype'].includes(key);
function path(value) {
  if(!Array.isArray(value)||value.length>8||value.some(key=>typeof key!=='string'||!key||key.length>80||forbidden(key)))throw new Error('字段路径无效或涉及凭据。');
  return value;
}
function get(value,keys) {
  for(const key of path(keys)) {if(Array.isArray(value)&&!/^(0|[1-9]\d*)$/.test(key))throw new Error('只能引用JSON数组中的实际元素，不能把length当作接口总数。');if(!value||typeof value!=='object'||!Object.hasOwn(value,key))throw new Error('接口字段缺失，需重新调查。');value=value[key];}
  return value;
}
function text(value,max=300) {if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('方案文字无效。');return value.trim();}
function exact(value,keys) {if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw new Error('方案包含未知字段。');}
export function validateRecipe(input) {
  exact(input,['name','scope','arrayPath','idPath','totalPath','fields','maxRecords','maxPages']);
  if(!Array.isArray(input.fields)||input.fields.length<1||input.fields.length>20)throw new Error('请选择1至20个业务字段。');
  const fields=input.fields.map(field=>{exact(field,['name','path']);return {name:text(field.name,80),path:path(field.path)};});
  if(new Set(fields.map(field=>field.name)).size!==fields.length)throw new Error('字段名称重复。');
  if(!fields.some(field=>JSON.stringify(field.path)===JSON.stringify(path(input.idPath))))throw new Error('导出字段必须包含商品唯一ID，便于核对。');
  if(!Number.isSafeInteger(input.maxRecords)||input.maxRecords<1||input.maxRecords>100000||!Number.isSafeInteger(input.maxPages)||input.maxPages<1||input.maxPages>100)throw new Error('采集上限无效。');
  return {name:text(input.name),scope:text(input.scope,1000),arrayPath:path(input.arrayPath),idPath:path(input.idPath),totalPath:path(input.totalPath),fields,maxRecords:input.maxRecords,maxPages:input.maxPages};
}
function mapped(recipe,data) {
  const list=get(data,recipe.arrayPath),rawTotal=get(data,recipe.totalPath);
  const total=typeof rawTotal==='string'&&/^\d+$/.test(rawTotal)?Number(rawTotal):rawTotal;
  if(!Array.isArray(list)||!Number.isSafeInteger(total)||total<0||total>recipe.maxRecords||list.length>recipe.maxRecords)throw new Error('列表或总数无效，或超出确认上限。');
  const scalar=value=>{if(value===null)return null;if(!['string','number','boolean'].includes(typeof value))throw new Error('字段不是可导出的标量。');const result=String(value);if(result.length>4000||result.includes('[REDACTED]')||result.includes('已省略]'))throw new Error('字段被过滤或过长，不能完整交付。');return result;};
  const ids=list.map(row=>{const id=scalar(get(row,recipe.idPath));if(!id||id.length>500)throw new Error('商品唯一ID无效。');return id;});
  if(new Set(ids).size!==ids.length)throw new Error('单页存在重复商品ID。');
  return {total,ids,records:list.map(row=>recipe.fields.map(field=>scalar(get(row,field.path))))};
}
export function appendRecipePage(state,recipe,observation) {
  if(observation.issues.length)throw new Error('响应调查未完整完成：'+observation.issues.join('；'));
  const matches=observation.documents.filter(doc=>doc.url===recipe.endpoint&&doc.method===recipe.method).map(doc=>mapped(recipe,doc.data));
  const distinct=new Map(matches.map(value=>[hash(value),value]));
  if(distinct.size!==1)throw new Error('未找到唯一且一致的商品响应，不能合并未知数据。');
  const page=[...distinct.values()][0], paging=observation.snapshot.paging;
  if(paging.regions!==1||paging.current!==state.pages+1||!paging.hasNext)throw new Error('页序或分页终点无法核对，未声明全量成功。');
  const filters=observation.snapshot.scopeFingerprint || hash(observation.snapshot.filters);
  if(state.pages&&(state.filters!==filters||state.total!==page.total))throw new Error('采集期间筛选条件或总数发生变化，请重新运行。');
  if(state.pages>=recipe.maxPages)throw new Error('超过已确认页数上限。');
  if(page.ids.some(id=>state.ids.has(id)))throw new Error('出现重复页或重复商品ID，已停止。');
  if(!page.ids.length&&!(state.pages===0&&page.total===0&&paging.nextDisabled))throw new Error('提前出现空页，不能视为全部完成。');
  if(state.ids.size+page.ids.length>page.total)throw new Error('商品数超过接口总数。');
  const size=Buffer.byteLength(JSON.stringify([page.ids,page.records]));
  if((state.bytes??0)+size>10*1024*1024)throw new Error('采集输出超过10MiB上限，不返回部分成功。');
  state.bytes=(state.bytes??0)+size;
  page.ids.forEach(id=>state.ids.add(id));state.records.push(...page.records);state.pages++;state.total=page.total;state.filters=filters;
  if(paging.nextDisabled) {if(state.ids.size!==page.total)throw new Error('已到分页终点，但商品数与总数不一致。');return true;}
  if(state.ids.size===page.total)throw new Error('接口总数与下一页控件矛盾，请重新核对总数字段。');
  return false;
}
export function currentRecipe(manager) {
  const entry=manager?.getBranch().findLast(entry=>entry.type==='custom'&&[recipeKind,'mediastorm-collection-plan'].includes(entry.customType));
  const record=entry?.customType===recipeKind?entry.data:null;
  if(!record)return null;
  if(!['pending','confirmed','cancelled'].includes(record.status)||record.digest!==hash(record.plan))throw new Error('保存的采集方案损坏。');
  validateRecipe(record.plan.recipe);
  return record;
}
export function currentRecipeResult(manager) {
  const recipe=currentRecipe(manager), result=manager?.getBranch().findLast(entry=>entry.type==='custom'&&entry.customType===resultKind)?.data;
  if(recipe?.status!=='confirmed'||recipe.plan.engine!==engine||result?.status!=='ready'||result.data?.planDigest!==recipe.digest||result.data?.engine!==engine)return null;
  if(result.digest!==hash(result.data))throw new Error('采集结果摘要损坏。');
  return result;
}
export function renderRecipe(record) {
  const {recipe,source,endpoint,sampleTotal,samplePreview=[]}=record.plan;
  const samples=samplePreview.map(row=>recipe.fields.map((field,index)=>`${field.name}=${JSON.stringify(row[index])}`).join('；')).join('\n');
  return `${recipe.name}\n来源：${source}\n商品响应：${endpoint}\n范围：${recipe.scope}\n日期政策：沿用每次选择页面的当前筛选，不自动切换到今天或昨天。运行期间筛选必须保持不变。\n字段：${recipe.fields.map(field=>field.name).join('、')}\n调查时总数：${sampleTotal}；当时样例（重跑不依赖旧值，长字段预览会缩短）：\n${samples}\n上限：${recipe.maxPages}页 / ${recipe.maxRecords}条\n总数与第一页、连续页序、唯一ID和末页控件共同核对；不是数据库一致性快照。\n${record.plan.engine===engine?'':'采集引擎已变化，需要重新调查和确认。'}`;
}
export function serializeRecipeResult(artifact,format) {
  if(!artifact||artifact.status!=='ready'||artifact.digest!==hash(artifact.data)||artifact.data.engine!==engine)throw new Error('没有有效的全量采集结果。');
  if(format==='json')return JSON.stringify({...artifact.data,digest:artifact.digest},null,2)+'\n';
  if(format==='csv')return collectionCSV(artifact.data.columns,artifact.data.records.map(row=>row.map(value=>value??'')));
  throw new Error('此采集方案只导出CSV或JSON，不生成浏览器插件。');
}
function resultBrief(artifact) {
  if(!artifact)return null;
  const {data}=artifact;
  return {status:'ready',digest:artifact.digest,count:data.uniqueCount,pages:data.pages,expectedTotal:data.expectedTotal,
    columns:data.columns,preview:data.records.slice(0,3).map(row=>row.map(cell=>typeof cell==='string'?cell.slice(0,200):cell)),previewMayBeShortened:true,warning:data.warning,untrusted:true};
}
const string={type:'string',minLength:1,maxLength:300};
const pathSchema={type:'array',items:{type:'string',minLength:1,maxLength:80},maxItems:8};
const recipeSchema={type:'object',additionalProperties:false,properties:{name:string,scope:{...string,maxLength:1000},arrayPath:pathSchema,idPath:pathSchema,totalPath:pathSchema,
  fields:{type:'array',minItems:1,maxItems:20,items:{type:'object',additionalProperties:false,properties:{name:string,path:pathSchema},required:['name','path']}},
  maxRecords:{type:'integer',minimum:1,maximum:100000},maxPages:{type:'integer',minimum:1,maximum:100}},required:['name','scope','arrayPath','idPath','totalPath','fields','maxRecords','maxPages']};
export function recipeAccess(manager,connect) {
  let active,controller,survey,cleanupError;
  const tool={name:'storm_collection_autonomous',label:'调查并采集全部商品',description:'独立采集：survey让用户选择已登录页并授权，监听刷新后的真实JSON响应和分页。分析返回的候选及字段路径，用plan确认范围和可复用方案，然后run实际从第一页逐页采集核对并保存CSV/JSON产物。current读取方案。不要让用户提供接口或选择器，不把总数字段猜测当核验。支持识别的唯一分页组件，不支持任意点击、HTTP重放、Cookie或脚本。日期沿用当前页面筛选并核对运行期间不变，不执行无人值守定时。',
    parameters:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['survey','plan','run','current']},surveyId:string,candidateId:string,recipe:recipeSchema},required:['action']},
    async execute(_id,params,signal,_update,ctx) {
      if(active)throw new Error('采集操作正在进行。');if(cleanupError)throw cleanupError;
      exact(params,params?.action==='plan'?['action','surveyId','candidateId','recipe']:['action']);
      controller=new AbortController();const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
      const execute=async()=>{
        const store=manager();combined.throwIfAborted();
        if(params.action==='current')return {recipe:currentRecipe(store),result:resultBrief(currentRecipeResult(store))};
        if(!ctx.hasUI)throw new Error('采集需要真实桌面确认。');
        if(params.action==='survey') {
          survey=undefined;
          const observed=await withSurveyPage(ctx,combined,page=>page.observe(),connect);
          combined.throwIfAborted();survey={...observed,id:randomUUID()};
          let left=18000;
          const candidates=observed.documents.map(doc=>{const preview=responsePreview(doc.data),size=JSON.stringify(preview).length;if(size>left)return {id:doc.id,url:doc.url,method:doc.method,omitted:true};left-=size;return {id:doc.id,url:doc.url,method:doc.method,preview};});
          return {surveyId:survey.id,source:survey.source,snapshot:survey.snapshot,candidates,issues:survey.issues,untrusted:true};
        }
        if(params.action==='plan') {
          if(!survey||params.surveyId!==survey.id)throw new Error('需要先完成当前会话的真实网页调查。');
          const candidate=survey.documents.find(doc=>doc.id===params.candidateId);
          if(!candidate)throw new Error('候选响应不存在。');
          const recipe=validateRecipe(params.recipe),sample=mapped(recipe,candidate.data);
          const plan={recipe,source:survey.source,endpoint:candidate.url,method:candidate.method,engine,
            sampleTotal:sample.total,samplePreview:sample.records.slice(0,2).map(row=>row.map(cell=>typeof cell==='string'?cell.slice(0,80):cell))};
          const record={plan,digest:hash(plan),status:'pending'};
          store.appendCustomEntry(recipeKind,{...record});store.appendCustomEntry(resultKind,{status:'invalidated'});
          try {const ok=await ctx.ui.confirm('保存每日可运行的采集方案？',renderRecipe(record)+'\n需求确认不等于运行完成。下一步实际运行仍需授权选择页面。',{signal:combined,timeout:120000});combined.throwIfAborted();record.status=ok===true?'confirmed':'cancelled';}
          finally {if(record.status==='pending')record.status='cancelled';store.appendCustomEntry(recipeKind,{...record});}
          return record;
        }
        if(params.action!=='run')throw new Error('未知采集动作。');
        const record=currentRecipe(store);
        if(record?.status!=='confirmed'||record.plan.engine!==engine)throw new Error('需要先调查并确认当前引擎的采集方案。');
        store.appendCustomEntry(resultKind,{status:'pending',planDigest:record.digest});
        try {
          const data=await withSurveyPage(ctx,combined,async page=>{
            if(page.source!==record.plan.source)throw new Error('选择的页面与已保存方案来源不一致。');
            const recipe={...record.plan.recipe,endpoint:record.plan.endpoint,method:record.plan.method};
            const filter={url:recipe.endpoint,method:recipe.method};
            let observed=await page.observe('reload',filter);
            if(observed.snapshot.paging.current!==1)observed=await page.observe('first',filter);
            const state={pages:0,ids:new Set(),records:[],total:undefined,filters:undefined};
            while(true) {
              page.signal.throwIfAborted();
              const complete=appendRecipePage(state,recipe,observed);
              ctx.ui.setWorkingMessage?.(`正在核对商品：第${state.pages}页，${state.ids.size}/${state.total}条`);
              if(complete)break;
              observed=await page.observe('next',filter);
            }
            return {planDigest:record.digest,engine,source:page.source,capturedAt:new Date().toISOString(),columns:recipe.fields.map(field=>field.name),records:state.records,
              pages:state.pages,expectedTotal:state.total,uniqueCount:state.ids.size,scope:recipe.scope,filters:observed.snapshot.filters,
              warning:'仅针对本次选择页面和当前筛选，按已确认总数字段、连续页序、唯一ID及末页控件核对。不是全站或数据库一致性快照。当前识别到的筛选值：'+(observed.snapshot.filters.join('；')||'未识别，请在网页核对'),untrusted:true,allPagesVerified:true,filtersVerified:false};
          },connect);
          combined.throwIfAborted();if(currentRecipe(store)?.digest!==record.digest)throw new Error('执行期间方案变化，结果已丢弃。');
          const artifact={status:'ready',data,digest:hash(data)};store.appendCustomEntry(resultKind,artifact);
          return resultBrief(artifact);
        } catch(error) {store.appendCustomEntry(resultKind,{status:'failed',planDigest:record.digest});throw error;}
        finally {ctx.ui.setWorkingMessage?.('');}
      };
      active=execute();
      try {const result=await active;return {content:[{type:'text',text:JSON.stringify(result)}],details:result};}
      catch(error) {if(/释放未确认|断开未确认/.test(error.message))cleanupError=error;throw error;}
      finally {active=undefined;controller=undefined;}
    }};
  return {tool,async stop(){controller?.abort();await active?.catch(()=>{});survey=undefined;if(cleanupError)throw cleanupError;}};
}
