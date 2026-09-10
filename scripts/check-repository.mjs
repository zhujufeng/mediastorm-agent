import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: root, encoding: 'utf8',
}).split('\0').filter(file => file && existsSync(join(root, file))))];
const roots = new Set(['.agents', '.codex', '.github', '.pi', '.trellis', 'desktop', 'docs', 'scripts',
  '.editorconfig', '.gitignore', 'AGENTS.md', 'README.md', 'package.json', 'package-lock.json', '启动助手.command']);
const privatePath = /(?:^|\/)(?:node_modules|\.local|dist|runtime|\.codegraph|__pycache__|\.DS_Store|\.env(?:\..*)?|credentials\.enc|auth\.json|sessions)(?:\/|$)|\.(?:dmg|zip|pem|key|pyc|log)$/;

for (const file of files) {
  assert.ok(roots.has(file.split('/')[0]), `未登记的仓库入口，请先明确用途：${file}`);
  assert.ok(!privatePath.test(file) && !file.startsWith('.trellis/workspace/') &&
    (!file.startsWith('.trellis/tasks/') || file === '.trellis/tasks/.gitkeep'), `本机数据或生成物不应提交：${file}`);
  if (file.startsWith('.trellis/spec/') && file.endsWith('.md')) {
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /To be filled by the team|Replace with your actual structure/, `规范不能保留空模板：${file}`);
  }
  if (/\.(?:mjs|cjs|js)$/.test(file)) execFileSync(process.execPath, ['--check', file], { cwd: root, stdio: 'pipe' });
}
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
assert.equal(lock.version, manifest.version, '锁文件版本需要同步');
assert.equal(lock.packages[''].version, manifest.version, '锁文件根包版本需要同步');
for (const kind of ['dependencies', 'devDependencies']) {
  assert.deepEqual(lock.packages[''][kind], manifest[kind], `${kind} 与锁文件不一致`);
  for (const [name, version] of Object.entries(manifest[kind])) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `依赖必须固定版本：${name}`);
  }
}
console.log('PASS: repository boundaries, JavaScript syntax, pinned dependencies and lockfile consistency.');
