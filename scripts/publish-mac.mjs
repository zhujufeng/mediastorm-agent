import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => execFileSync(cmd, args, {cwd:root,encoding:'utf8'}).trim();
const pkg = JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const notes = process.argv[2];
assert.ok(notes && process.argv.length === 3, '用法：npm run desktop:publish -- <版本说明.md>');
assert.ok(readFileSync(resolve(notes),'utf8').trim(), '版本说明不能为空');
assert.match(pkg.version,/^\d+\.\d+\.\d+$/);
assert.equal(run('git',['status','--porcelain']), '', '请先提交源码再发布');
const app = join(root,'dist/MediaStorm Agent-darwin-arm64/MediaStorm Agent.app');
const built = JSON.parse(readFileSync(join(app,'Contents/Resources/app/package.json'),'utf8'));
assert.equal(built.releaseChannel,'stable','本机试用包不能发布到稳定更新通道；请先完成正式签名和公证。');
assert.equal(built.version,pkg.version,'安装包版本与源码不一致');
assert.equal(built.sourceCommit,run('git',['rev-parse','HEAD']),'安装包不是当前提交构建的');
for (const script of ['check','check:desktop','check:mac-package']) execFileSync('npm',['run',script],{cwd:root,stdio:'inherit'});
// spctl and stapler are the trust checks; the ad-hoc flag cannot bypass them.
run('/usr/sbin/spctl',['--assess','--type','execute',app]);
const repo = 'zhujufeng/mediastorm-agent';
assert.equal(run('gh',['api',`repos/${repo}/commits/${built.sourceCommit}`,'--jq','.sha']),built.sourceCommit,'先把对应源码提交推送到 GitHub');
const artifacts = ['dmg','zip'].map(ext=>join(root,`dist/MediaStorm-Agent-${pkg.version}-mac-arm64.${ext}`));
console.log(run('gh',['release','create',`v${pkg.version}`,...artifacts,'--repo',repo,'--target',built.sourceCommit,'--draft','--title',`MediaStorm Agent ${pkg.version}`,'--notes-file',resolve(notes)]));
console.log('已生成 Release 草稿。请在另一台 Mac 验证安装和升级后，在 GitHub 发布该草稿；同事随后可在应用内更新。');
