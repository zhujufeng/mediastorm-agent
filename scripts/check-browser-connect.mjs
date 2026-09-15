// Exercise the real default SDK entry; never replace its options or use a personal Chrome profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../',import.meta.url));
const home=mkdtempSync(join(tmpdir(),'storm-connect-entry-'));
try {
  const result=execFileSync(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {homedir} from 'node:os';
    import puppeteer from 'puppeteer-core';
    import {browserTool,browserConnectOptions} from './desktop/browser-tool.mjs';
    assert.equal(homedir(),process.env.HOME);
    const actual=puppeteer.connect.bind(puppeteer);
    let failure, received, confirmations=0;
    // Observe only. Keep the actual SDK call and options unchanged.
    puppeteer.connect=async options=>{received=options;try{return await actual(options);}catch(error){failure=error;throw error;}};
    await assert.rejects(browserTool().tool.execute('default-connect',{url:'https://example.test'},undefined,undefined,
      {hasUI:true,ui:{confirm:async()=>{confirmations++;return true;}}}),/Chrome连接失败/);
    assert.equal(failure?.cause?.code,'ENOENT','The SDK must reach isolated profile discovery, not fail while mutating frozen options');
    assert.notEqual(received,browserConnectOptions);
    assert.equal(Object.isFrozen(browserConnectOptions),true);
    assert.equal(Object.hasOwn(browserConnectOptions,'logger'),false);
    assert.equal(received.channel,'chrome');assert.equal(received.networkEnabled,false);assert.equal(received.issuesEnabled,false);
    assert.equal(confirmations,1,'No open/read confirmation or network access with a missing isolated profile');
    console.log('PASS: real default Puppeteer connect reaches isolated Chrome discovery; SDK option mutation cannot alter the frozen policy.');
  `],{cwd:root,env:{...process.env,HOME:home,USERPROFILE:home,LOCALAPPDATA:join(home,'local'),CHROME_CONFIG_HOME:join(home,'config'),XDG_CONFIG_HOME:join(home,'config')},encoding:'utf8',timeout:20000});
  assert.match(result,/PASS:/);console.log(result.trim());
} finally {rmSync(home,{recursive:true,force:true});}
