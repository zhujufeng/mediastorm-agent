import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('本轮运行时只验证 Mac Apple Silicon（arm64）。');
const downloads = join(root, '.local/desktop-downloads'), runtime = join(root, 'runtime');
mkdirSync(downloads, { recursive: true }); mkdirSync(runtime, { recursive: true });
const sources = [
  { name: 'node', file: 'node-v24.14.1-darwin-arm64.tar.gz', url: 'https://nodejs.org/dist/v24.14.1/node-v24.14.1-darwin-arm64.tar.gz', sha256: '25495ff85bd89e2d8a24d88566d7e2f827c6b0d3d872b2cebf75371f93fcb1fe', folder: 'node-v24.14.1-darwin-arm64' },
  { name: 'python', file: 'cpython-3.12.14+20260901-aarch64-apple-darwin-install_only_stripped.tar.gz', url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14%2B20260901-aarch64-apple-darwin-install_only_stripped.tar.gz', sha256: '81a359f1cfadd4da11766534c5913791cea55f26e1bb902cacd2a531bb1e4b2b', folder: 'python' },
];
for (const source of sources) {
  const archive = join(downloads, source.file);
  if (!existsSync(archive)) {
    console.log(`下载 ${source.name} 运行时…`);
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`下载失败：${response.status}`);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  }
  if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== source.sha256) throw new Error(`校验不通过，请删除后重试：${archive}`);
  const target = join(runtime, source.name);
  if (!existsSync(target)) {
    const extraction = join(downloads, `${source.name}-extract`); mkdirSync(extraction, { recursive: true });
    execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', extraction]);
    cpSync(join(extraction, source.folder), target, { recursive: true, verbatimSymlinks: true });
    rmSync(extraction, { recursive: true });
  }
}
mkdirSync(join(runtime, 'bin'), { recursive: true });
// Native CodeGraph already contains its own runtime; no global npm/node lookup.
const graph = join(root, 'node_modules/@colbymchenry/codegraph-darwin-arm64/bin/codegraph');
if (!existsSync(graph)) throw new Error(`缺少 CodeGraph 运行时：${graph}`);
const link = join(runtime, 'bin/codegraph');
if (!existsSync(link)) symlinkSync('../../node_modules/@colbymchenry/codegraph-darwin-arm64/bin/codegraph', link);
writeFileSync(join(runtime, 'sources.json'), JSON.stringify(sources, null, 2) + '\n');
console.log('Mac 运行时已准备：Node、Python、Git、CodeGraph。');
