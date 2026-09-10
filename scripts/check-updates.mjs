import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const { attachUpdates } = await import(process.argv[2] ? pathToFileURL(join(process.argv[2], 'desktop/updates.mjs')).href : '../desktop/updates.mjs');
if (!process.argv[2]) {
  const require = createRequire(import.meta.resolve('@electron/packager'));
  assert.equal(typeof (await import(pathToFileURL(require.resolve('@electron/osx-sign')).href)).sign, 'function', 'Pinned signing API');
}

const native = new EventEmitter();
let feed, checks = 0, busy = false, restarts = 0, confirm = false, failClose = false, last;
native.setFeedURL = value => { feed = value.url; };
native.checkForUpdates = () => { checks++; };
const updates = attachUpdates(native, { version: '0.3.0', publish: state => { last = state; }, isBusy: () => busy,
  restart: async () => { if (failClose) throw new Error('助手尚未安全退出'); if (confirm) restarts++; return confirm; },
});
assert.equal(feed, 'https://update.electronjs.org/zhujufeng/mediastorm-agent/darwin-arm64/0.3.0');
await assert.rejects(updates.install(), /先下载/);
updates.check(); updates.check(); assert.equal(checks, 1);
native.emit('update-available'); assert.equal(last.phase, 'downloading');
updates.check(); assert.equal(checks, 1);
native.emit('error', new Error('network failed')); assert.equal(last.canCheck, true);
updates.check(); assert.equal(checks, 2);
native.emit('update-not-available'); assert.equal(last.phase, 'current');
updates.check(); native.emit('update-downloaded', {}, '<script>inert release notes</script>', '0.4.0');
assert.equal(last.canInstall, true); assert.equal(last.release, '0.4.0');
busy = true; await assert.rejects(updates.install(), /仍在执行/); assert.equal(restarts, 0); assert.equal(updates.snapshot().phase, 'downloaded');
busy = false; await updates.install(); assert.equal(restarts, 0); assert.equal(last.phase, 'downloaded');
failClose = true; await updates.install(); assert.equal(last.phase, 'downloaded'); assert.match(last.message, /安全退出/);
failClose = false; confirm = true; await updates.install(); assert.equal(restarts, 1); assert.equal(last.phase, 'installing');
await assert.rejects(updates.install(), /先下载/);
const disabled = attachUpdates({}, {version:'0.3.0',unavailable:'本机试用包',publish:()=>{},isBusy:()=>false,restart:()=>{throw new Error('must not restart');}});
assert.equal(disabled.check().canCheck,false); await assert.rejects(disabled.install(),/先下载/);
native.checkForUpdates = () => { throw new Error('native failure'); };
native.emit('error', new Error('reset')); updates.check(); assert.equal(last.phase,'error');
console.log('PASS: update lifecycle, fixed feed, repeat-check guard, error retry, unavailable build, busy guard, cancellation and safe shutdown failure. Native download/install is simulated.');
