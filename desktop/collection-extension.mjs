import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectionEngineSource, requireCollectionDataPlan, serializeCollectionData } from './collection-data.mjs';
const hash = text => createHash('sha256').update(text).digest('hex');

// Trusted template only: no model-authored script or selectors are interpolated.
function popup() {
  const status = document.querySelector('#status'), run = document.querySelector('#run'), stop = document.querySelector('#stop');
  let epoch = 0, urls = [];
  const sha = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const clear = () => {
    urls.forEach(url=>URL.revokeObjectURL(url)); urls = [];
    document.querySelector('#preview').textContent = '';
    for (const format of ['csv','json']) {const link=document.querySelector('#'+format);link.hidden=true;link.removeAttribute('href');}
  };
  const bounded = promise => {
    let timer;
    return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('读取超时，未交付数据。')),10000);})]).finally(()=>clearTimeout(timer));
  };
  stop.onclick = () => {epoch++;clear();stop.disabled=true;status.textContent='已停止接收结果，等待本次读取结束；迟到结果不会用于导出。';};
  window.addEventListener('unload',clear);
  fetch('./plan.json').then(response=>response.json()).then(async config=>{
    const verification=await fetch('./verification.json').then(response=>response.json());
    if (await sha(JSON.stringify(config.plan)) !== config.digest || verification.planDigest !== config.digest || verification.files['engine.js'] !== config.engineDigest) throw new Error('changed plan');
    for (const name of ['manifest.json','engine.js','popup.js','popup.html','popup.css','plan.json','README.txt']) {
      if (await sha(await fetch('./'+name).then(response=>response.text())) !== verification.files[name]) throw new Error('changed file');
    }
    const expected = config.plan.source.url;
    document.querySelector('#scope').textContent = expected + '\n字段：' + config.plan.fields.map(field=>field.name).join('、');
    run.disabled = false;
    run.onclick = async () => {
      const stamp = ++epoch; clear(); run.disabled=true;stop.disabled=false;status.textContent='正在读取并核对当前页…';
      try {
        const [tab] = await bounded(chrome.tabs.query({active:true,currentWindow:true}));
        if (epoch !== stamp) return;
        if (!tab || tab.url !== expected || tab.pendingUrl) throw new Error('当前页不是方案中的准确网址，或正在导航。请先打开目标页，再点击工具栏插件。');
        let frame;
        try {
          [frame] = await bounded(chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',func:extractPage,args:[expected,true]}));
          if (epoch !== stamp) return;
          if (!frame?.documentId || !frame.result) throw new Error('no snapshot');
          const [still] = await bounded(chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[frame.documentId]},world:'ISOLATED',func:url=>location.href === url,args:[expected]}));
          if (epoch !== stamp) return;
          const after = await bounded(chrome.tabs.get(tab.id));
          if (epoch !== stamp) return;
          if (!still?.result || still.documentId !== frame.documentId || after.url !== expected || after.pendingUrl) throw new Error('page changed');
        } catch {throw new Error('未获当前页读取权限、页面已变化或读取失败。请重新点击工具栏插件；不读取其他标签页。');}
        const {columns,records} = collectionRows(config,sanitizeBrowserPage(frame.result,expected));
        const data = {version:1,untrusted:true,engineDigest:config.engineDigest,planDigest:config.digest,source:expected,capturedAt:new Date().toISOString(),columns,records,
          coverage:'single-visible-table-snapshot',sampleMatched:true,allPagesVerified:false,filtersVerified:false};
        const digest = await sha(JSON.stringify(data));
        if (epoch !== stamp) return;
        for (const [format,content] of [['json',JSON.stringify({...data,digest},null,2)+'\n'],['csv',collectionCSV(columns,records)]]) {
          const url=URL.createObjectURL(new Blob([content],{type:format==='csv'?'text/csv;charset=utf-8':'application/json'})); urls.push(url);
          const link=document.querySelector('#'+format);link.href=url;link.download='collection.'+format;link.hidden=false;
        }
        document.querySelector('#preview').textContent=records.slice(0,5).map(row=>row.map((cell,i)=>columns[i]+'='+JSON.stringify(cell)).join('；')).join('\n');
        status.textContent=records.length+'条当前页记录，表头和预期样例匹配。仅此刻快照，不代表分页、筛选范围或全站完整。';
      } catch(error) {if(epoch===stamp){clear();status.textContent=error.message;}}
      finally {run.disabled=false;stop.disabled=true;}
    };
  }).catch(()=>{status.textContent='插件配置或文件校验失败，请重新导出插件。';});
}

export function collectionExtension(plan, artifact) {
  requireCollectionDataPlan(plan);
  if (plan.plan.delivery.format !== 'chrome-extension' || artifact?.data?.planDigest !== plan.digest || artifact.data.source !== plan.plan.source.url) throw new Error('请先确认Chrome插件形式并重新运行当前页核验。');
  serializeCollectionData(artifact,'json'); // Same integrity gate as data export.
  const files = {
    'manifest.json':JSON.stringify({manifest_version:3,name:'MediaStorm 当前页采集器',version:'1.0.0',minimum_chrome_version:'106',permissions:['activeTab','scripting'],action:{default_popup:'popup.html'},content_security_policy:{extension_pages:"default-src 'self'; script-src 'self'; object-src 'none'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"}},null,2),
    'engine.js':collectionEngineSource(),
    'popup.js':"import {extractPage,sanitizeBrowserPage,collectionRows,collectionCSV} from './engine.js';\n("+popup.toString()+')();\n',
    'popup.html':'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>当前页采集器</title><link rel="stylesheet" href="popup.css"></head><body><h1>当前页采集器</h1><p id="scope"></p><p>点击后仅在本机读取此页可见表格，不发送模型。不翻页、不自动筛选；最多50条。预期样例变化时请回到工作台重新核对。</p><button id="run" disabled>读取并核对当前页</button> <button id="stop" disabled>停止</button><p id="status" role="status">正在加载配置…</p><pre id="preview"></pre><a id="csv" hidden>下载CSV</a> <a id="json" hidden>下载JSON</a><p>下载可能包含敏感业务数据。CSV将疑似公式转为文本；JSON保留原值。关闭弹窗即丢弃本次预览。</p><script type="module" src="popup.js"></script></body></html>',
    'popup.css':'body{width:400px;padding:20px;margin:0;font:14px/1.6 system-ui;color:#252823;background:#faf9f6}h1{font-size:21px;margin:0 0 12px}p,pre{white-space:pre-wrap;overflow-wrap:anywhere}pre{max-height:200px;overflow:auto;font:inherit}button,a{font:inherit;padding:8px 12px;border:1px solid #b9b8b0;border-radius:6px}button{cursor:pointer;background:white}button:disabled{opacity:.5;cursor:default}a{color:#a2462c;display:inline-block}a[hidden]{display:none}:focus-visible{outline:3px solid #a2462c;outline-offset:3px}',
    'plan.json':JSON.stringify({status:plan.status,digest:plan.digest,engineDigest:artifact.data.engineDigest,plan:plan.plan},null,2),
    'README.txt':'当前页标准表格采集器\n\n文件夹含来源、字段和预期业务样例，请勿公开分享。没有Cookie、登录目录或模型密钥。\n\n1. 按公司策略，在Chrome的chrome://extensions打开开发者模式，选择“加载已解压的扩展程序”，选择本文件夹。不要绕过管理员限制。\n2. 手动打开方案中的准确网址并正常登录。点击工具栏中的本插件，再点击“读取并核对当前页”。\n3. 预览后选择CSV或JSON，下载由Chrome管理。关闭弹窗不会保存预览。\n\n仅支持当前页标准HTML表格，最多50条、12列及6000字符表格快照，不点击、不翻页、不抓接口、不发送模型。完整预期样例必须仍存在；数据、字段或网址变化时回工作台重新确认并导出，不自动放宽校验。停止只放弃迟到结果，不保证中断已经进入页面的同步读取。\n\n桌面基线核验不是插件在你的真实后台已运行。首次安装后仍须人工核对结果与范围；时间筛选/全站完整性未验证。源码/配置修改后原文件摘要不再适用。重新导出不会自动更新或撤销已加载的旧插件，请移除旧版后手动加载新文件夹。卸载插件不会删除已下载文件。\n',
  };
  const hashes = Object.fromEntries(Object.entries(files).map(([name,text])=>[name,hash(text)]));
  files['verification.json']=JSON.stringify({version:1,planDigest:plan.digest,baselineDataDigest:artifact.digest,baselineEngineDigest:artifact.data.engineDigest,baselineCapturedAt:artifact.data.capturedAt,businessExtensionRunVerified:false,files:hashes},null,2);
  return {files,digest:hash(JSON.stringify(files)),baselineDigest:artifact.digest};
}

export function saveCollectionExtension(parent, bundle) {
  const names=['manifest.json','engine.js','popup.js','popup.html','popup.css','plan.json','README.txt','verification.json'];
  if (!bundle || hash(JSON.stringify(bundle.files)) !== bundle.digest || Object.keys(bundle.files).length !== names.length || !names.every(name=>Object.hasOwn(bundle.files,name) && typeof bundle.files[name]==='string' && bundle.files[name].length<=100000)) throw new Error('插件文件清单或摘要无效。');
  const directory=mkdtempSync(join(parent,'collection-extension-'));
  try {for (const name of names) writeFileSync(join(directory,name),bundle.files[name],{flag:'wx',mode:0o600});return directory;}
  catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
}
