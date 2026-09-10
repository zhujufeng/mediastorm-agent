import { packager } from '@electron/packager';
import { cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, readdirSync, lstatSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('本轮只打包已验证的 Mac arm64 运行时。');
if (!existsSync(join(root,'runtime/sources.json'))) throw new Error('请先运行 npm run desktop:runtime。');
const stage = join(root, '.local/mac-package-stage'), out = join(root, 'dist');
rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true });
const copy = path => { mkdirSync(dirname(join(stage,path)), {recursive:true}); cpSync(join(root,path), join(stage,path), {recursive:true, verbatimSymlinks:true, filter:p=>!p.endsWith('.pyc') && !p.includes('/__pycache__') && (!/\/@esbuild\/[^/]+$/.test(p) || p.endsWith('/@esbuild/darwin-arm64'))}); };
// Allowlist: never ship the source checkout, colleague projects, tasks, journals, or personal Pi state.
for (const path of ['desktop','.pi/settings.json','.pi/extensions','.pi/skills','.trellis/scripts','.trellis/workflow.md','.trellis/LICENSE','scripts/pi-project.mjs','runtime']) copy(path);
const sourcePackage = JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
writeFileSync(join(stage,'package.json'), JSON.stringify({name:sourcePackage.name,version:'0.2.0',description:sourcePackage.description,type:'module',main:'desktop/main.mjs',dependencies:sourcePackage.dependencies},null,2));
const paths = execFileSync('npm',['ls','--omit=dev','--all','--parseable'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(p=>p!==root.replace(/\/$/,''));
for (const path of paths) if (!paths.some(other => other !== path && path.startsWith(other + '/'))) copy(relative(root,path));
writeFileSync(join(stage,'THIRD_PARTY_NOTICES.txt'), 'MediaStorm Agent 内部预览版\n\nElectron、Node.js、Python、Git、Pi、Trellis、Ponytail、CodeGraph 与各依赖的许可证保留在对应运行时与 node_modules 包中。\nTrellis 0.6.6（AGPL-3.0-only）许可：.trellis/LICENSE；项目 https://github.com/mindfold-ai/Trellis 。其分发脚本与扩展源码就在 .trellis/scripts 和 .pi/extensions/trellis。\nPython/Node 下载来源与 SHA-256：runtime/sources.json。\n本产品未由这些上游项目背书。\n');
mkdirSync(out,{recursive:true});
const [bundleDir] = await packager({dir:stage,out,name:'MediaStorm Agent',appBundleId:'studio.mediastorm.agent',appVersion:'0.2.0',platform:'darwin',arch:'arm64',electronVersion:'44.3.0',overwrite:true,derefSymlinks:false,prune:false,asar:false,osxSign:false,extendInfo:{LSMinimumSystemVersion:'13.5'}});
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
// Local ad-hoc signing makes the modified app bundle runnable; this is not Developer ID signing or notarization.
execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
const imageSource = join(out,'dmg-source'); rmSync(imageSource,{recursive:true,force:true}); mkdirSync(imageSource);
cpSync(app,join(imageSource,'MediaStorm Agent.app'),{recursive:true,verbatimSymlinks:true}); symlinkSync('/Applications',join(imageSource,'Applications'));
writeFileSync(join(imageSource,'安装说明.txt'),'将 MediaStorm Agent 拖入 Applications，然后从启动台打开。\n\n适用：Apple Silicon（M 系列）Mac，macOS 13.5 及以上。\n打开应用 → 模型设置 → 登录订阅或配置中转站 → 打开本地 Git 项目 → 自然语言描述目标。\n\n内部预览包仅作本机 ad-hoc 签名，尚未完成 Developer ID 签名和 Apple 公证。正式分发前需要完成签名、公证与另一台 Mac 验证。\n');
const dmg = join(out,'MediaStorm-Agent-0.2.0-mac-arm64.dmg'); rmSync(dmg,{force:true});
execFileSync('/usr/bin/hdiutil',['create','-volname','MediaStorm Agent','-srcfolder',imageSource,'-ov','-format','UDZO',dmg],{stdio:'inherit'});
rmSync(imageSource,{recursive:true});
console.log(`Mac 应用：${app}\n安装镜像：${dmg}`);
