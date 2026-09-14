import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] || fileURLToPath(new URL('../', import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'storm-lark-check-'));
try {
  const binary = join(root, 'runtime/bin/lark-cli');
  const env = { HOME: temporary, TMPDIR: temporary, PATH: '/usr/bin:/bin', LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' };
  const run = args => execFileSync(binary, args, { cwd: temporary, env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(run(['--version']).trim(), 'lark-cli version 1.0.90');
  assert.ok(JSON.parse(run(['skills', 'list'])).skills.some(x => x.name === 'lark-base'));
  assert.match(run(['skills', 'read', 'lark-shared']), /auth login/);
  assert.match(run(['skills', 'read', 'lark-base', 'references/lark-base-record-query-and-analysis-sop.md']), /has_more/);
  assert.match(run(['config', 'init', '--help']), /--app-secret-stdin/);
  assert.match(readFileSync(join(root, 'runtime/lark/LICENSE'), 'utf8'), /MIT License/);

  // A copied extension with a fixture executable tests argv/confirmation without real credentials or network.
  const extensionPath = join(temporary, '.pi/extensions/lark-cli.mjs');
  mkdirSync(join(temporary, '.pi/extensions'), { recursive: true });
  cpSync(join(root, '.pi/extensions/lark-cli.mjs'), extensionPath);
  mkdirSync(join(temporary, 'runtime/bin'), { recursive: true });
  const fixtureBinary = join(temporary, 'runtime/bin/lark-cli');
  writeFileSync(fixtureBinary, '#!/bin/sh\nprintf invoked > invoked\nprintf \'%s\\n\' "$@"\nprintf \'{"access_token":"fixture-only","appSecret":"fixture-only"}\\n\'\ncase "$2" in +fail) exit 7;; +risk) exit 10;; esac\n', { mode: 0o700 });
  const { default: plugin, offlineLark, validateLark } = await import(pathToFileURL(extensionPath).href);
  let tool, confirms = 0, consent = false;
  plugin({ registerTool: value => { tool = value; } });
  const ctx = { cwd: temporary, hasUI: true, ui: { confirm: async () => { confirms++; return consent; } } };
  const call = (args, signal, offset) => tool.execute('test', { args, offset }, signal, undefined, ctx);
  assert.ok(offlineLark(['skills', 'read', 'lark-base', 'references/example.md']));
  assert.equal(offlineLark(['base', '+record-delete', '--help', '--yes']), false);
  for (const args of [[], ['config', 'init'], ['update'], ['api', 'GET', '/'], ['base', '+record-list'], ['skills', 'read', '../secret']]) assert.throws(() => validateLark(args));
  assert.equal((await call(['base', '+record-list', '--as', 'user'])).details.cancelled, true);
  assert.equal(existsSync(join(temporary, 'invoked')), false);
  ctx.hasUI = false;
  await assert.rejects(call(['auth', 'status']), /确认界面/);
  ctx.hasUI = true;
  await call(['--version']);
  assert.equal(confirms, 1, 'Offline commands do not ask for network authorization');
  consent = true;
  const literal = '$(touch shell-injection)';
  const result = await call(['base', '+record-search', '--as', 'user', '--query', literal]);
  assert.match(result.content[0].text, /\$\(touch shell-injection\)/);
  assert.doesNotMatch(result.content[0].text, /fixture-only/);
  assert.equal(existsSync(join(temporary, 'shell-injection')), false);
  await assert.rejects(call(['base', '+fail', '--as', 'user']), /退出码：7/);
  await assert.rejects(call(['base', '+risk', '--as', 'user']), /退出码：10.*高风险确认/);
  await assert.rejects(call(['base', '+record-list', '--as', 'user'], undefined, 1), /离线/);
  await assert.rejects(call(['--version'], AbortSignal.abort()), /取消/);
  rmSync(fixtureBinary);
  await assert.rejects(call(['--version']), /缺少/);
  console.log('PASS: portable pinned Lark CLI, embedded skills/license, literal argv, confirmation/cancel, no-UI, errors and missing-runtime handling; no live Feishu calls.');
} finally { rmSync(temporary, { recursive: true, force: true }); }
