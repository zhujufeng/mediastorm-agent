import { packager } from '@electron/packager';
import { cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, readdirSync, lstatSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePackage = JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const version = sourcePackage.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('版本必须是 package.json 中的 x.y.z。');
const release = process.argv.includes('--release');
if (process.argv.slice(2).some(arg => arg !== '--release')) throw new Error('仅支持 --release 正式发布模式。');
const identity = process.env.STORM_SIGN_IDENTITY, profile = process.env.STORM_NOTARY_PROFILE;
if (release && (!identity?.startsWith('Developer ID Application: ') || !profile)) throw new Error('正式发布需要 STORM_SIGN_IDENTITY（Developer ID Application）和 STORM_NOTARY_PROFILE（notarytool 钥匙串配置名）。');
const sourceCommit = execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if (release && execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()) throw new Error('正式发布前请先提交源码，保证安装包对应可追溯的 Git 提交。');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('本轮只打包已验证的 Mac arm64 运行时。');
if (!existsSync(join(root,'runtime/sources.json'))) throw new Error('请先运行 npm run desktop:runtime。');
const stage = join(root, '.local/mac-package-stage'), out = join(root, 'dist');
rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true });
const copy = path => { mkdirSync(dirname(join(stage,path)), {recursive:true}); cpSync(join(root,path), join(stage,path), {recursive:true, verbatimSymlinks:true, filter:p=>!p.endsWith('.pyc') && !p.includes('/__pycache__') && (!/\/@esbuild\/[^/]+$/.test(p) || p.endsWith('/@esbuild/darwin-arm64'))}); };
// Allowlist: never ship the source checkout, colleague projects, tasks, journals, or personal Pi state.
for (const path of ['desktop','.pi/settings.json','.pi/extensions','.pi/skills','.trellis/scripts','.trellis/workflow.md','.trellis/LICENSE','scripts/pi-project.mjs','runtime']) copy(path);
writeFileSync(join(stage,'package.json'), JSON.stringify({name:sourcePackage.name,version,sourceCommit,releaseChannel:release?'stable':'local',description:sourcePackage.description,type:'module',main:'desktop/main.mjs',dependencies:sourcePackage.dependencies},null,2));
const paths = execFileSync('npm',['ls','--omit=dev','--all','--parseable'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(p=>p!==root.replace(/\/$/,''));
for (const path of paths) if (!paths.some(other => other !== path && path.startsWith(other + '/'))) copy(relative(root,path));
writeFileSync(join(stage,'THIRD_PARTY_NOTICES.txt'), 'MediaStorm Agent 内部预览版\n\nElectron、Node.js、Python、Git、Pi、Trellis、Ponytail、CodeGraph 与各依赖的许可证保留在对应运行时与 node_modules 包中。\nTrellis 0.6.6（AGPL-3.0-only）许可：.trellis/LICENSE；项目 https://github.com/mindfold-ai/Trellis 。其分发脚本与扩展源码就在 .trellis/scripts 和 .pi/extensions/trellis。\nPython/Node 下载来源与 SHA-256：runtime/sources.json。\n本产品未由这些上游项目背书。\n');
mkdirSync(out,{recursive:true});
const [bundleDir] = await packager({dir:stage,out,name:'MediaStorm Agent',appBundleId:'studio.mediastorm.agent',appVersion:version,platform:'darwin',arch:'arm64',electronVersion:sourcePackage.devDependencies.electron,overwrite:true,derefSymlinks:false,prune:false,asar:false,osxSign:false,extendInfo:{LSMinimumSystemVersion:'13.5'}});
const app = join(bundleDir,'MediaStorm Agent.app');
// Packager 20 uses fs.cp without verbatimSymlinks: even with dereference off,
// relative links become absolute links back to staging. Restore only in-bundle targets.
const installed = join(app,'Contents/Resources/app');
function restoreLinks(path) {
  for (const entry of readdirSync(path,{withFileTypes:true})) {
    const source = join(path,entry.name);
    if (entry.isSymbolicLink()) {
      const destination = join(installed,relative(stage,source));
      if (!lstatSync(destination,{throwIfNoEntry:false})) continue; // Packager omits npm .bin shims.
      const target = resolve(dirname(source),readlinkSync(source));
      if (!target.startsWith(stage+'/') || !existsSync(target)) throw new Error(`Invalid packaged link: ${source}`);
      rmSync(destination); symlinkSync(relative(dirname(destination),join(installed,relative(stage,target))),destination);
    } else if (entry.isDirectory()) restoreLinks(source);
  }
}
restoreLinks(stage);
if (release) {
  // Reuse packager's pinned signing library after restoring links; signing earlier invalidates the signature.
  const require = createRequire(import.meta.resolve('@electron/packager'));
  const { sign } = await import(pathToFileURL(require.resolve('@electron/osx-sign')).href);
  await sign({app,identity,platform:'darwin',type:'distribution',version:sourcePackage.devDependencies.electron,
    optionsForFile:()=>({hardenedRuntime:true,entitlements:['com.apple.security.cs.allow-jit']})});
} else {
  execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
}
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
const zip = join(out,`MediaStorm-Agent-${version}-mac-arm64.zip`);
const archive = () => { rmSync(zip,{force:true}); execFileSync('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,zip]); };
if (release) {
  archive();
  const result = JSON.parse(execFileSync('/usr/bin/xcrun',['notarytool','submit',zip,'--keychain-profile',profile,'--wait','--output-format','json'],{encoding:'utf8',timeout:1800000}));
  if (result.status !== 'Accepted') throw new Error(`Apple 公证未通过，停止发布。提交 ID：${result.id}`);
  execFileSync('/usr/bin/xcrun',['stapler','staple',app],{stdio:'inherit'});
  execFileSync('/usr/bin/xcrun',['stapler','validate',app],{stdio:'inherit'});
  execFileSync('/usr/sbin/spctl',['--assess','--type','execute','--verbose=2',app],{stdio:'inherit'});
}
archive(); // Include the notarization ticket in the ZIP used for updates.
const imageSource = join(out,'dmg-source'); rmSync(imageSource,{recursive:true,force:true}); mkdirSync(imageSource);
cpSync(app,join(imageSource,'MediaStorm Agent.app'),{recursive:true,verbatimSymlinks:true}); symlinkSync('/Applications',join(imageSource,'Applications'));
writeFileSync(join(imageSource,'安装说明.txt'),'将 MediaStorm Agent 拖入 Applications，然后从启动台打开。\n\n适用：Apple Silicon（M 系列）Mac，macOS 13.5 及以上。\n打开应用 → 模型设置 → 登录订阅或配置中转站 → 打开本地 Git 项目 → 自然语言描述目标。\n\n'+(release?'后续点击软件左下角“软件更新”，下载完成后选择重启安装。\n':'本机试用包未完成 Developer ID 签名与 Apple 公证，不启用应用内安装更新。\n'));
const dmg = join(out,`MediaStorm-Agent-${version}-mac-arm64.dmg`); rmSync(dmg,{force:true});
execFileSync('/usr/bin/hdiutil',['create','-volname','MediaStorm Agent','-srcfolder',imageSource,'-ov','-format','UDZO',dmg],{stdio:'inherit'});
rmSync(imageSource,{recursive:true});
if (release) {
  execFileSync('/usr/bin/codesign',['--force','--sign',identity,'--timestamp',dmg],{stdio:'inherit'});
  const result = JSON.parse(execFileSync('/usr/bin/xcrun',['notarytool','submit',dmg,'--keychain-profile',profile,'--wait','--output-format','json'],{encoding:'utf8',timeout:1800000}));
  if (result.status !== 'Accepted') throw new Error(`安装镜像公证未通过，停止发布。提交 ID：${result.id}`);
  execFileSync('/usr/bin/xcrun',['stapler','staple',dmg],{stdio:'inherit'});
  execFileSync('/usr/bin/xcrun',['stapler','validate',dmg],{stdio:'inherit'});
}
console.log(`Mac 应用：${app}\n安装镜像：${dmg}\n更新归档：${zip}\n类型：${release?'签名公证版':'本机试用版（不启用原地更新）'}`);
