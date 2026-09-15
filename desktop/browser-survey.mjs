// Collector-only borrowed-tab investigation. Never closes a tab or changes browser settings.
import puppeteer from 'puppeteer-core';
import {createHash} from 'node:crypto';
import { browserConnectOptions } from './browser-tool.mjs';
import { browserPageUrl, redactBrowserText, secretKey } from './browser-page.mjs';

const bytesLimit = 512 * 1024;
const sensitive = key => secretKey.test(key) || /cookie|csrf|credential|signature/i.test(key) || ['__proto__','prototype','constructor'].includes(key);
// Preserve numeric response literals, especially 64-bit product IDs and decimal amounts.
export function parseResponse(body) {
  return JSON.parse(body, (_key,value,context)=>{
    if(typeof value!=='number')return value;
    if(typeof context?.source==='string')return context.source;
    if(Number.isSafeInteger(value))return String(value);
    throw new Error('当前运行时无法精确保留接口数值。');
  });
}
export function publicResponse(value, depth = 0, budget = {left:20000}) {
  if (--budget.left < 0 || depth > 12) throw new Error('响应结构超出调查上限。');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (value.length > 4000) return '[字段超过4000字符，已省略]';
    return redactBrowserText(value).replace(/https?:\/\/[^\s"<>]+/g, text => {
      try { const url = new URL(text); return url.username||url.password||url.hash||[...url.searchParams.keys()].some(sensitive)?'[含敏感参数或片段的链接，已省略]':text; } catch { return '[链接已省略]'; }
    });
  }
  if (Array.isArray(value)) return value.map(item => publicResponse(item,depth+1,budget));
  if (!value || typeof value !== 'object') throw new Error('响应不是JSON数据。');
  return Object.fromEntries(Object.entries(value).filter(([key])=>!sensitive(key)).map(([key,item])=>[key,publicResponse(item,depth+1,budget)]));
}
export function responsePreview(value, depth = 0) {
  if (depth > 6) return '[结构过深]';
  if (Array.isArray(value)) return {arrayLength:value.length, samples:value.slice(0,3).map(item=>responsePreview(item,depth+1))};
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0,40).map(([key,item])=>[key,responsePreview(item,depth+1)]));
  return typeof value === 'string' ? value.slice(0,300) : value;
}
export function connectionDiagnostic(error) {
  const known = ['ENOENT','EACCES','EPERM','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','EAI_AGAIN'];
  for (let item=error,i=0; item && i<6; item=item.cause??item.error,i++) {
    if (known.includes(item.code)) return item.code;
    if (/^Unexpected server response: (401|403)$/.test(item.message??'')) return 'HANDSHAKE_DENIED';
    if (/^Invalid (DevToolsActivePort|port)/.test(item.message??'')) return 'INVALID_ENTRY';
  }
  return 'UNKNOWN';
}
function wait(promise,signal,milliseconds=10000) {
  let timer, abort;
  return new Promise((resolve,reject)=>{
    abort=()=>reject(new Error('调查已取消。'));
    signal?.addEventListener('abort',abort,{once:true});
    if (signal?.aborted) abort();
    timer=setTimeout(()=>reject(new Error('调查步骤超时。')),milliseconds);
    Promise.resolve(promise).then(resolve,reject);
  }).finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);});
}
const delay = milliseconds => new Promise(resolve=>setTimeout(resolve,milliseconds));
function pageScope(value) {
  const url=browserPageUrl(value);
  for(const key of ['page','pageNo','pageNum','page_num','current','currentPage','pageIndex'])url.searchParams.delete(key);
  url.searchParams.sort();return url.href;
}

// Fixed function evaluated in an isolated world, not supplied by a model.
export function surveyDOM(action='inspect') {
  const visible = element => element && element.getClientRects().length && getComputedStyle(element).visibility!=='hidden' && getComputedStyle(element).display!=='none';
  const regions=[...document.querySelectorAll('.ant-pagination,.el-pagination,.arco-pagination,.pagination,[role="navigation"][aria-label*="分页"],[role="navigation"][aria-label*="pagination" i]')].filter(visible);
  const unique=regions.filter(element=>!regions.some(parent=>parent!==element&&parent.contains(element)));
  const region=unique.length===1?unique[0]:null;
  const disabled=element=>!element || element.matches(':disabled,[aria-disabled="true"],.disabled,.ant-pagination-disabled,.is-disabled') || Boolean(element.querySelector(':disabled,[aria-disabled="true"]'));
  const next=region?.querySelector('.ant-pagination-next,.btn-next,[aria-label="下一页"],[title="下一页"],[aria-label="Next page"],[title="Next Page"],[rel="next"]');
  const current=region?.querySelector('[aria-current="page"],.ant-pagination-item-active,.number.is-active,.active');
  const page=Number(current?.textContent?.trim());
  const first=region && [...region.querySelectorAll('button,a,li')].find(element=>visible(element)&&element.textContent.trim()==='1'&&!disabled(element));
  const filterNodes=[...document.querySelectorAll('input,select')].filter(element=>visible(element)&&!region?.contains(element)&&!['password','hidden','email','tel'].includes(element.type)&&!element.closest('form')?.querySelector('input[type="password"]')&&!/password|token|cookie|csrf|secret|authorization|username|credential|login|one-time-code|邮箱|手机号|验证码|密码/i.test([element.name,element.id,element.autocomplete,element.getAttribute('aria-label'),element.getAttribute('placeholder')].join(' ')));
  const filters=filterNodes.slice(0,30).map(element=>String(element.value).slice(0,200));
  const bodyText=document.body?.innerText||'';
  const result={title:document.title.slice(0,200), text:bodyText.slice(0,3000),textTruncated:bodyText.length>3000, filters,
    paging:{regions:unique.length,current:Number.isSafeInteger(page)&&page>0?page:null,hasNext:Boolean(next),nextDisabled:disabled(next),hasFirst:Boolean(first)}};
  if (action==='inspect') return result;
  if (!region || !Number.isSafeInteger(page) || page<1) throw new Error('没有可核对的唯一分页组件。');
  const target=action==='first'?first:action==='next'?next:null;
  if (!target || disabled(target) || !visible(target)) throw new Error('分页控件不可操作。');
  target.scrollIntoView({block:'center',inline:'nearest'});
  const rect=target.getBoundingClientRect(), hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
  if (!hit || !(target===hit || target.contains(hit))) throw new Error('分页控件被遮挡，未执行。');
  target.click();
  return result;
}

export async function withSurveyPage(ctx, signal, work, connect=()=>puppeteer.connect({...browserConnectOptions})) {
  if (!ctx.hasUI) throw new Error('网页调查需要桌面真实授权。');
  signal?.throwIfAborted();
  const settings={signal,timeout:120000};
  if (await ctx.ui.confirm('选择要调查的Chrome页面？','只连接正在运行的Chrome，标签页标题和站点仅用于让你选择；不会读取其他标签页正文。Chrome可能另行请求授权。',settings)!==true) throw new Error('已取消网页调查。');
  signal?.throwIfAborted();
  let browser,root,page,stage='连接Chrome', failure;
  const listeners=[];
  const on=(name,callback)=>{page.on(name,callback);listeners.push([name,callback]);};
  const connectingSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)]);
  const connecting=Promise.resolve().then(connect).then(async result=>{
    if (connectingSignal.aborted) {await result.disconnect();throw new Error('连接已过期。');}
    return result;
  });
  try {
    browser=await wait(connecting,connectingSignal,16000);
    stage='选择页面';
    root=await wait(browser.target().createCDPSession(),signal);
    const {targetInfos}=await wait(root.send('Target.getTargets'),signal);
    const choices=targetInfos.filter(info=>info.type==='page').flatMap(info=>{
      try {const url=browserPageUrl(info.url);return [{id:info.targetId,url,label:`${redactBrowserText(info.title).slice(0,100)} · ${url.origin}${url.pathname}`}];} catch {return [];}
    }).slice(0,30);
    if (!choices.length) throw new Error('没有可选择的HTTPS业务页面，请在Chrome打开并登录目标后台。');
    const labels=choices.map((choice,index)=>`${index+1}. ${choice.label}`);
    const selected=await ctx.ui.select('选择已登录的商品页面',labels,settings);
    signal?.throwIfAborted();
    const choice=choices[labels.indexOf(selected)];
    if (!choice) throw new Error('已取消页面选择。');
    if (await ctx.ui.confirm('授权本次页面调查与只读分页？',`${choice.label}\n允许刷新此页、操作已识别的商品分页并读取该页加载的有限JSON响应。必要字段和样例会发送给当前模型并保存在本机会话。页面正常加载可能发送POST或跨域请求；不是网络沙箱。不读取Cookie或请求头，不修改商品，不操作其他页。停止或本次操作结束即断开，不关闭你的标签页。`,settings)!==true) throw new Error('已取消调查授权。');
    signal?.throwIfAborted();
    stage='绑定页面';
    let receive;
    const attached=new Promise(resolve=>{receive=resolve;});
    root.once('sessionattached',receive);
    try {
      const {sessionId}=await wait(root.send('Target.attachToTarget',{targetId:choice.id,flatten:true}),signal);
      page=await wait(attached,signal);
      if (page.id()!==sessionId) throw new Error('页面会话绑定不一致。');
    } finally {root.off('sessionattached',receive);}
    const operationSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(600000)]);
    const send=(method,params)=>{operationSignal.throwIfAborted();return wait(page.send(method,params),operationSignal);};
    let revoked=false,mainFrameId;
    const allowedScope=pageScope(choice.url.href);
    const checkScope=url=>{try{if(pageScope(url)!==allowedScope)revoked=true;}catch{revoked=true;}};
    on('Page.frameNavigated',event=>{if(!event.frame.parentId){mainFrameId=event.frame.id;checkScope(event.frame.url);}});
    on('Page.navigatedWithinDocument',event=>{if(event.frameId===mainFrameId)checkScope(event.url);});
    await send('Page.enable');
    const guard=async()=>{
      if(revoked)throw new Error('页面或网址筛选已离开授权范围；即使返回原页也需重新授权。');
      const frame=(await send('Page.getFrameTree')).frameTree.frame;
      mainFrameId=frame.id;checkScope(frame.url);
      if(revoked)throw new Error('页面或网址筛选已离开授权范围；即使返回原页也需重新授权。');
      return frame;
    };
    await guard();
    const dom=async(action='inspect')=>{
      const frame=await guard();
      const {executionContextId}=await send('Page.createIsolatedWorld',{frameId:frame.id,worldName:'mediastorm-collection',grantUniveralAccess:false});
      const result=await send('Runtime.evaluate',{contextId:executionContextId,expression:`(${surveyDOM.toString()})(${JSON.stringify(action)})`,returnByValue:true});
      if (result.exceptionDetails) throw new Error('页面观察或分页控件核验失败，未确认操作结果。');
      const after=await guard();
      if (action==='inspect' && after.loaderId!==frame.loaderId) throw new Error('页面文档在观察期间变化。');
      const scopeUrl=pageScope(after.url);
      const snapshot=publicResponse(result.result.value);
      snapshot.documentId=after.loaderId;
      snapshot.scopeFingerprint=createHash('sha256').update(JSON.stringify([scopeUrl,result.result.value.filters])).digest('hex');
      return snapshot;
    };
    let generation=0, capturing=false, responseFilter, requests=new Map(), documents=[], pending=new Set(), issues=[];
    const issue=message=>{if(issues.length<12&&!issues.includes(message))issues.push(message);};
    const started=event=>{
      if (!capturing || !['XHR','Fetch'].includes(event.type) || !['GET','POST'].includes(event.request.method)) return;
      if(event.redirectResponse){const previous=requests.get(event.requestId);requests.delete(event.requestId);if(previous||!responseFilter)issue('接口发生重定向，未读取重定向正文');return;}
      if(requests.size>=100){issue('请求候选超过调查上限');return;}
      try {const url=browserPageUrl(event.request.url);const source=url.origin+url.pathname;if(responseFilter&&(source!==responseFilter.url||event.request.method!==responseFilter.method))return;requests.set(event.requestId,{generation,frameId:event.frameId,loaderId:event.loaderId,url:source,method:event.request.method});} catch { /* Credentials in a URL disqualify the candidate. */ }
    };
    const responded=event=>{
      const item=requests.get(event.requestId);
      if (item) {item.status=event.response.status;item.json=/json/i.test(event.response.mimeType);}
    };
    const finished=event=>{
      const item=requests.get(event.requestId);
      if (!capturing || !item || item.generation!==generation || !item.json) return;
      if (item.status!==200) {issue(`HTTP ${item.status}`);return;}
      if (documents.length+pending.size>=12 || event.encodedDataLength>bytesLimit) {issue('响应数量或大小超过调查上限');return;}
      const ticket=generation;
      const promise=(async()=>{
        try {
          const frame=await guard();
          if (item.frameId!==frame.id||item.loaderId!==frame.loaderId) return;
          const result=await send('Network.getResponseBody',{requestId:event.requestId});
          const body=result.base64Encoded?Buffer.from(result.body,'base64').toString('utf8'):result.body;
          if (Buffer.byteLength(body)>bytesLimit) throw new Error('响应过大');
          const data=publicResponse(parseResponse(body));
          const after=await guard();
          if (capturing && generation===ticket&&after.id===item.frameId&&after.loaderId===item.loaderId) documents.push({id:`response-${documents.length+1}`,url:item.url,method:item.method,documentId:item.loaderId,data});
        } catch {if (generation===ticket) issue('响应读取或结构核验失败');}
      })();
      pending.add(promise);promise.finally(()=>pending.delete(promise));
    };
    const failed=event=>{const item=requests.get(event.requestId);if(capturing&&item?.generation===generation)issue('接口网络请求失败'+(/^net::ERR_[A-Z_]+$/.test(event.errorText||'')?'：'+event.errorText:''));};
    on('Network.requestWillBeSent',started);on('Network.responseReceived',responded);on('Network.loadingFinished',finished);on('Network.loadingFailed',failed);
    await send('Network.enable',{maxTotalBufferSize:bytesLimit*12,maxResourceBufferSize:bytesLimit});
    const observe=async(action='reload',filter)=>{
      if (!['reload','first','next'].includes(action)) throw new Error('未知调查动作。');
      await guard();generation++;responseFilter=filter;requests=new Map();documents=[];issues=[];capturing=true;
      try {
        if (action==='reload') await send('Page.reload',{ignoreCache:false});
        else await dom(action);
        const deadline=Date.now()+5000;
        while(Date.now()<deadline) {operationSignal.throwIfAborted();await wait(delay(100),operationSignal);await guard();}
        await wait(Promise.all([...pending]),operationSignal);
        if(filter&&issues.length)throw new Error('响应调查未完整完成：'+issues.join('；'));
        const snapshot=await dom();
        return {source:choice.url.origin+choice.url.pathname,snapshot,documents:documents.filter(document=>document.documentId===snapshot.documentId),issues:[...new Set(issues)],untrusted:true};
      } finally {capturing=false;generation++;}
    };
    stage='调查';
    try {return await work({observe,dom,source:choice.url.origin+choice.url.pathname,signal:operationSignal});}
    finally {capturing=false;page.off('Network.requestWillBeSent',started);page.off('Network.responseReceived',responded);page.off('Network.loadingFinished',finished);}
  } catch(error) {
    connecting.then(value=>{if(!browser)return value.disconnect();}).catch(()=>{});
    if(signal?.aborted)throw new Error('调查已取消。');
    if (stage==='连接Chrome') {
      const code=connectingSignal.aborted?'CONNECT_TIMEOUT':connectionDiagnostic(error);
      const reason={ENOENT:'未找到Chrome调试入口，请确认Chrome正在运行且已允许远程调试',ECONNREFUSED:'Chrome调试端口拒绝连接；可先保存网页工作，再完全退出Chrome并重开',EACCES:'系统拒绝访问Chrome调试入口',EPERM:'系统拒绝访问Chrome调试入口',CONNECT_TIMEOUT:'等待Chrome连接超时',HANDSHAKE_DENIED:'Chrome拒绝调试握手'}[code]||'Chrome连接没有完成';
      throw new Error(`${reason} [${code}]。尚未开始页面调查；不会自动重连。`);
    }
    throw error;
  } finally {
    for(const [name,callback] of listeners)page?.off(name,callback);
    try {if(page)await wait(root.send('Target.detachFromTarget',{sessionId:page.id()}),undefined,5000);}catch{failure=new Error('调查连接释放未确认，请退出应用后检查；不会关闭你的页面。');}
    try {if(root)await wait(root.detach(),undefined,5000);}catch{failure??=new Error('调查根连接释放未确认。');}
    try {if(browser)await wait(Promise.resolve().then(()=>browser.disconnect()),undefined,5000);}catch{failure??=new Error('Chrome连接断开未确认。');}
    if(failure)throw failure;
  }
}
