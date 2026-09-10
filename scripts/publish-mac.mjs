import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => execFileSync(cmd, args, {cwd:root,encoding:'utf8'}).trim();
const pkg = JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const preview = process.argv.includes('--preview');
const args = process.argv.slice(2).filter(arg => arg !== '--preview');
const notes = args[0];
assert.ok(notes && args.length === 1 && !notes.startsWith('--'), '用法：npm run desktop:publish -- [--preview] <版本说明.md>');
assert.ok(readFileSync(resolve(notes),'utf8').trim(), '版本说明不能为空');
assert.match(pkg.version,/^\d+\.\d+\.\d+$/);
assert.equal(run('git',['status','--porcelain']), '', '请先提交源码再发布');
const app = join(root,'dist/MediaStorm Agent-darwin-arm64/MediaStorm Agent.app');
const built = JSON.parse(readFileSync(join(app,'Contents/Resources/app/package.json'),'utf8'));
assert.equal(built.releaseChannel,preview?'local':'stable','预览发布使用本机试用包；稳定发布必须使用正式签名公证包。');
assert.equal(built.version,pkg.version,'安装包版本与源码不一致');
assert.equal(built.sourceCommit,run('git',['rev-parse','HEAD']),'安装包不是当前提交构建的');
for (const script of ['check','check:desktop','check:mac-package']) execFileSync('npm',['run',script],{cwd:root,stdio:'inherit'});
// spctl and stapler are the trust checks; the ad-hoc flag cannot bypass them.
if (!preview) run('/usr/sbin/spctl',['--assess','--type','execute',app]);
const repo = 'zhujufeng/mediastorm-agent';
assert.equal(run('gh',['api',`repos/${repo}/commits/${built.sourceCommit}`,'--jq','.sha']),built.sourceCommit,'先把对应源码提交推送到 GitHub');
const artifacts = (preview ? ['dmg'] : ['dmg','zip']).map(ext=>join(root,`dist/MediaStorm-Agent-${pkg.version}-mac-arm64.${ext}`));
const sums = [];
for (const artifact of artifacts) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(artifact)) hash.update(chunk);
  sums.push(`${hash.digest('hex')}  ${artifact.split('/').at(-1)}`);
}
const checksum = join(root,`dist/SHA256SUMS-${pkg.version}.txt`);
writeFileSync(checksum,sums.join('\n')+'\n');
const releaseNotes = join(root,`dist/release-notes-${pkg.version}.md`);
writeFileSync(releaseNotes,(preview ? '**Mac 预览版：ad-hoc 签名，未完成 Apple 公证。支持手动安装，不启用应用内自动安装更新。**\n\n' : '')+readFileSync(resolve(notes),'utf8'));
console.log(run('gh',['release','create',`v${pkg.version}`,...artifacts,checksum,'--repo',repo,'--target',built.sourceCommit,'--draft',...(preview?['--prerelease']:[]),'--title',`MediaStorm Agent ${pkg.version}${preview?' · Mac 试用版':''}`,'--notes-file',releaseNotes]));
if (preview) {
  console.log(run('gh',['release','edit',`v${pkg.version}`,'--repo',repo,'--draft=false','--prerelease']));
  console.log(`公开试用版：https://github.com/${repo}/releases/tag/v${pkg.version}`);
} else console.log('已生成正式 Release 草稿。请在另一台 Mac 验证安装和升级后，在 GitHub 发布该草稿；同事随后可在应用内更新。');
