import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectionExtension, saveCollectionExtension } from '../desktop/collection-extension.mjs';
import { validateCollectionPlan } from '../desktop/collection-plan.mjs';
import { buildCollectionData } from '../desktop/collection-data.mjs';
const root = fileURLToPath(new URL('../',import.meta.url));
const unit = process.argv.includes('--unit');
const temporary=mkdtempSync(join(tmpdir(),'storm-generated-extension-'));
const hash=text=>createHash('sha256').update(text).digest('hex');
let browser, server;
const report={passed:false,cleanup:false,realBusinessTested:false,triggerAction:'CDP only in temporary test Chrome'};
try {
  let source='https://example.test/orders';
  if (!unit) {
    server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><link rel="icon" href="data:,"><h1>合成订单</h1><table><tr><th>订单号</th><th>金额</th></tr><tr><td>A-1</td><td>10</td></tr><tr><td>A-2</td><td>20</td></tr></table>');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));source=`http://127.0.0.1:${server.address().port}/orders`;
  }
  const body=validateCollectionPlan({goal:'采集当前页订单',capture:'current-page-table',source:{basis:'description',url:source},fields:[{name:'订单号',meaning:'编号'},{name:'金额',meaning:'原文金额'}],samples:[['A-1','10']],missing:[],scope:'仅当前页快照',maxRecords:10,delivery:{format:'chrome-extension',reason:'需要重复使用'}});
  const plan={status:'confirmed',plan:body,digest:hash(JSON.stringify(body))};
  const data=buildCollectionData(plan,{pageUrl:source,tables:[{headers:['订单号','金额'],rows:[['A-1','10'],['A-2','20']],issue:''}]});
  const bundle=collectionExtension(plan,data), directory=saveCollectionExtension(temporary,bundle);
  assert.deepEqual(JSON.parse(bundle.files['manifest.json']).permissions,['activeTab','scripting']);
  assert.equal(JSON.parse(bundle.files['manifest.json']).host_permissions,undefined);
  assert.equal(JSON.parse(bundle.files['verification.json']).businessExtensionRunVerified,false);
  const engine=await import(pathToFileURL(join(directory,'engine.js')).href);
  const snapshot={title:'fixture',text:'body',tablesTruncated:false,tables:[{headers:['订单号','金额'],rows:[['A-1','10'],['A-2','20']],issue:''}]};
  const actual=engine.collectionRows(plan,engine.sanitizeBrowserPage(snapshot,source));assert.deepEqual(actual.records,data.data.records);
  assert.match(engine.collectionCSV(actual.columns,actual.records),/"A-1","10"/);
  for(const [name,digest] of Object.entries(JSON.parse(bundle.files['verification.json']).files)) assert.equal(hash(readFileSync(join(directory,name))),digest);
  assert.throws(()=>collectionExtension({...plan,status:'pending'},data));
  assert.throws(()=>collectionExtension({...plan,digest:'stale'},data));
  const outdated={...data,data:{...data.data,engineDigest:'old'}};outdated.digest=hash(JSON.stringify(outdated.data));
  assert.throws(()=>collectionExtension(plan,outdated),'Changing the engine requires a new desktop baseline');
  assert.throws(()=>saveCollectionExtension(temporary,{...bundle,files:{'../escape':'no'}}));
  const second=saveCollectionExtension(temporary,bundle);assert.notEqual(second,directory);assert.equal(readdirSync(directory).length,8);
  console.log('PASS: deterministic trusted MV3 files, minimal permissions, stale-plan/integrity checks, unique directory export and explicit business-run limitation.');
  if (!unit) {
    process.env.PLAYWRIGHT_BROWSERS_PATH=join(root,'.local/desktop-downloads/playwright');
    const {chromium}=await import('playwright');const puppeteer=(await import('puppeteer-core')).default;
    assert.ok(existsSync(chromium.executablePath()),'Prepare the pinned test Chrome explicitly before this check.');
    browser=await puppeteer.launch({executablePath:chromium.executablePath(),headless:false,userDataDir:join(temporary,'profile'),ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--enable-extensions']});
    const cdp=await browser.target().createCDPSession();
    const {id}=await cdp.send('Extensions.loadUnpacked',{path:directory});
    const page=await browser.newPage();await page.goto(source);
    for(const other of await browser.pages()) if(other!==page && other.url()==='about:blank') await other.close();
    const popupURL=`chrome-extension://${id}/popup.html`;
    const ungranted=await browser.newPage();await ungranted.goto(popupURL);
    assert.equal(await ungranted.evaluate(async()=>{const tabs=await chrome.tabs.query({});const target=tabs.find(tab=>!tab.active);try{await chrome.scripting.executeScript({target:{tabId:target.id},func:()=>document.title});return true;}catch{return false;}}),false,'Opening a popup URL must not grant activeTab');
    await ungranted.close();await page.bringToFront();
    const {targetInfos}=await cdp.send('Target.getTargets',{filter:[{type:'tab'}]});
    const tabTarget=targetInfos.find(target=>target.url===source);assert.ok(tabTarget,'Owned synthetic tab target must be discoverable');
    const open = async () => {
      await page.bringToFront();
      const appeared=browser.waitForTarget(target=>target.url()===popupURL,{timeout:10000});
      try {await cdp.send('Extensions.triggerAction',{id,targetId:tabTarget.targetId});}
      catch(error){await browser.close();await appeared.catch(()=>{});throw error;}
      const popup=await (await appeared).asPage();await popup.waitForSelector('#run:not([disabled])',{timeout:10000});return popup;
    };
    const downloads=join(temporary,'downloads');mkdirSync(downloads);
    await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
    for(const format of ['json','csv']) {
      const popup=await open();await popup.click('#run');
      await popup.waitForFunction(()=>document.querySelector('#status').textContent.includes('2条当前页记录'),{timeout:15000});
      assert.match(await popup.$eval('#preview',node=>node.textContent),/A-2/);
      if(format==='json'){mkdirSync(join(root,'dist/collection-extension'),{recursive:true});await popup.screenshot({path:join(root,'dist/collection-extension/popup.png')});}
      let timer,complete;
      const finished=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Download timed out')),10000);complete=event=>{if(event.state==='completed')resolve();};cdp.on('Browser.downloadProgress',complete);});
      try{await popup.click('#'+format);await finished;}finally{clearTimeout(timer);cdp.off('Browser.downloadProgress',complete);}
      const content=readFileSync(join(downloads,'collection.'+format),'utf8');
      if(format==='json'){const {digest,...actual}=JSON.parse(content);assert.deepEqual(actual.records,[['A-1','10'],['A-2','20']]);assert.equal(actual.planDigest,plan.digest);assert.equal(hash(JSON.stringify(actual)),digest);}
      else assert.match(content,/"A-2","20"/);
      if(!popup.isClosed())await popup.close();
    }
    let popup=await open();
    await popup.evaluate(()=>{const original=chrome.scripting.executeScript.bind(chrome.scripting);let first=true;chrome.scripting.executeScript=async(...args)=>{if(first){first=false;await new Promise(resolve=>{window.releaseRead=resolve;});}window.readCalls=(window.readCalls||0)+1;return original(...args);};});
    await popup.click('#run');await popup.waitForFunction(()=>typeof window.releaseRead==='function');
    await popup.click('#stop');await popup.evaluate(()=>window.releaseRead());
    await popup.waitForSelector('#run:not([disabled])');assert.equal(await popup.$eval('#json',node=>node.hidden),true);assert.match(await popup.$eval('#status',node=>node.textContent),/已停止/);assert.equal(await popup.evaluate(()=>window.readCalls),1,'Stop must not dispatch the second probe');
    await popup.click('#run');await popup.waitForFunction(()=>document.querySelector('#status').textContent.includes('2条当前页记录'));
    await page.evaluate(()=>{document.querySelectorAll('table tr')[1].cells[1].textContent='99';});
    await popup.click('#run');await popup.waitForFunction(()=>document.querySelector('#status').textContent.includes('不一致'),{timeout:15000});
    assert.equal(await popup.$eval('#json',node=>node.hidden),true);await popup.close();
    await page.goto(source.replace('/orders','/other'));
    popup=await open();await popup.click('#run');await popup.waitForFunction(()=>document.querySelector('#status').textContent.includes('准确网址'),{timeout:15000});assert.equal(await popup.$eval('#csv',node=>node.hidden),true);await popup.close();
    writeFileSync(join(directory,'popup.css'),bundle.files['popup.css']+'\n/* changed fixture */');
    await cdp.send('Extensions.uninstall',{id});assert.equal((await cdp.send('Extensions.loadUnpacked',{path:directory})).id,id);
    await page.goto(source);await page.bringToFront();
    const rejected=browser.waitForTarget(target=>target.url()===popupURL,{timeout:10000});
    await cdp.send('Extensions.triggerAction',{id,targetId:tabTarget.targetId});
    popup=await(await rejected).asPage();await popup.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('校验失败'),{timeout:15000});
    assert.equal(await popup.$eval('#run',node=>node.disabled),true);await popup.close();
    Object.assign(report,{passed:true,runtimeIntegrityRejected:true,browser:await browser.version(),bundleDigest:bundle.digest,files:JSON.parse(bundle.files['verification.json']).files});
    console.log('PASS: actual generated MV3 activeTab denial/grant, real popup read, repeat JSON/CSV downloads matched truth, changed samples and wrong page refused.');
  }
} finally {
  try {await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}rmSync(temporary,{recursive:true,force:true});report.cleanup=true;}
  finally {if(!unit){mkdirSync(join(root,'dist/collection-extension'),{recursive:true});writeFileSync(join(root,'dist/collection-extension/result.json'),JSON.stringify(report,null,2));}}
}
