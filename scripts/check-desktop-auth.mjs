import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Real Pi OAuth implementation + real local callback. Only token/device HTTP responses are replaced.
// No personal account, browser, or external model calls. Production code has no test-only auth path.
const root = process.argv[2] || fileURLToPath(new URL('../', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'storm-oauth-check-'));
const hook = join(dir, 'mock-auth.mjs');
writeFileSync(hook, `
const access = ['fixture', Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'test-only'}})).toString('base64url'), 'signature'].join('.');
globalThis.fetch = async (url, init) => {
  if (init?.signal?.aborted) throw new Error('cancelled');
  if (url === 'https://auth.openai.com/oauth/token') {
    const body = new URLSearchParams(init.body);
    if (body.get('code') === 'reject') return new Response('fixture denial', {status:400});
    return Response.json({access_token:access,refresh_token:'local-fixture-refresh',expires_in:3600});
  }
  if (url === 'https://auth.openai.com/api/accounts/deviceauth/usercode') return Response.json({device_auth_id:'fixture-device',user_code:'ABCD-1234',interval:'0'});
  if (url === 'https://auth.openai.com/api/accounts/deviceauth/token') return Response.json({authorization_code:'fixture-code',code_verifier:'fixture-verifier'});
  throw new Error('Unexpected network request blocked by auth regression');
};
`);
let child, records = {}, events = [], pending = new Map();
const request = (action, data = {}) => new Promise((resolve, reject) => {
  const id = randomUUID(), timer = setTimeout(() => reject(new Error('Timed out: ' + action)), 25000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  child.send({ id, action, data });
});
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { const result = events.find(predicate); if (result) return result; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Expected OAuth event missing');
}
async function startLogin() {
  events = [];
  const result = request('login', { provider: 'openai-codex' }); result.catch(() => {});
  const a = await until(e => e.type === 'auth' && e.event.type === 'auth_url');
  const q = await until(e => e.type === 'question');
  assert.equal(q.source, 'auth'); assert.equal(q.promptType, 'manual_code');
  const state = new URL(a.event.url).searchParams.get('state'); assert.ok(state);
  return { result, q, state };
}
try {
  await new Promise((resolve, reject) => {
    child = fork(join(root, 'desktop/worker.mjs'), [], { execPath: join(root, 'runtime/node/bin/node'), execArgv: ['--import', pathToFileURL(hook).href], cwd: dir,
      env: { HOME: dir, STORM_USER_DATA: dir, PI_CODING_AGENT_DIR: join(dir, 'pi'), PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    child.stderr.on('data', () => {}); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error('OAuth worker exited')); });
    child.on('message', e => {
      events.push(e);
      if (e.type === 'ready') resolve();
      if (e.type === 'credentials') { if (e.action === 'write') records = structuredClone(e.data); child.send({ reply: e.id, value: e.action === 'write' ? true : records }); }
      if (e.type === 'response') { const p = pending.get(e.id); pending.delete(e.id); e.error ? p?.reject(new Error(e.error)) : p?.resolve(e.value); }
    });
  });
  let flow = await startLogin();
  // Invalid state rejected by the actual SDK callback server; login stays pending.
  let response = await fetch('http://127.0.0.1:1455/auth/callback?code=fixture&state=wrong');
  assert.equal(response.status, 400); assert.equal(Object.keys(records).length, 0);
  response = await fetch(`http://127.0.0.1:1455/auth/callback?code=fixture&state=${flow.state}`);
  assert.equal(response.status, 200);
  assert.ok((await flow.result).providers.find(p => p.id === 'openai-codex').connected);
  assert.ok(events.some(e => e.type === 'dismiss' && e.id === flow.q.id));
  assert.equal(records['openai-codex'].type, 'oauth');
  await request('logout', { provider: 'openai-codex' });
  flow = await startLogin();
  child.send({ reply: flow.q.id, value: `http://localhost:1455/auth/callback?code=fixture&state=${flow.state}` });
  await flow.result;
  const saved = structuredClone(records);
  flow = await startLogin();
  child.send({ reply: flow.q.id, value: 'reject' });
  await assert.rejects(flow.result, /400/); assert.deepEqual(records, saved);
  flow = await startLogin();
  await request('stop'); await assert.rejects(flow.result, /取消/);
  assert.ok(events.some(e => e.type === 'dismiss' && e.id === flow.q.id)); assert.deepEqual(records, saved);
  flow = await startLogin();
  child.send({ reply: flow.q.id, value: 'fixture' }); await flow.result;
  events = [];
  await request('login', { provider: 'openai-codex', method: 'device_code' });
  assert.ok(events.some(e => e.type === 'auth' && e.event.type === 'device_code' && e.event.userCode === 'ABCD-1234'));
  console.log('PASS: real Pi OAuth browser callback, state validation, manual fallback, device code, cancellation/retry, prompt cleanup, and failed exchange preserves credentials. Token endpoints mocked; no real account validation.');
} finally {
  for (const p of pending.values()) p.reject(new Error('Test cleanup'));
  child?.kill(); rmSync(dir, { recursive: true, force: true });
}
