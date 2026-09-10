import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const temporary = mkdtempSync('/private/tmp/mediastorm-package-check-');
const version = JSON.parse(readFileSync('package.json','utf8')).version;
try {
  execFileSync('/bin/cp',['-cR','dist/MediaStorm Agent-darwin-arm64/MediaStorm Agent.app',temporary]);
  const bundle = join(temporary,'MediaStorm Agent.app');
  const root = join(bundle,'Contents/Resources/app');
  const manifest = JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  assert.equal(manifest.version,version);
  function checkLinks(path) {
    for (const item of readdirSync(path,{withFileTypes:true})) {
      const file = join(path,item.name);
      if (item.isSymbolicLink()) assert.ok(realpathSync(file).startsWith(bundle+'/'),`Link escapes app: ${file}`);
      else if (item.isDirectory()) checkLinks(file);
    }
  }
  checkLinks(bundle);
  for (const path of ['.local','.git','.trellis/tasks','.trellis/workspace','.pi/auth.json','.pi/sessions']) assert.equal(existsSync(join(root,path)),false,path);
  execFileSync(process.execPath,['scripts/check-desktop-render.mjs',root],{stdio:'inherit',timeout:15000});
  execFileSync(process.execPath,['scripts/check-updates.mjs',root],{stdio:'inherit',timeout:15000});
  execFileSync(process.execPath,['scripts/check-desktop-auth.mjs',root],{stdio:'inherit',timeout:90000});
  execFileSync(process.execPath,['scripts/check-desktop.mjs',root],{stdio:'inherit',timeout:90000});
  const fixture = join(temporary,'codegraph-project');
  execFileSync(join(root,'node_modules/dugite/git/bin/git'),['init','-q',fixture],{env:{...process.env,GIT_TEMPLATE_DIR:join(root,'node_modules/dugite/git/share/git-core/templates')}});
  writeFileSync(join(fixture,'sample.py'),'def greet(name):\n    return "hello " + name\n');
  execFileSync(join(root,'runtime/bin/codegraph'),['init','-i'],{cwd:fixture,stdio:'pipe',timeout:45000});
  assert.ok(existsSync(join(fixture,'.codegraph')));
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{stdio:'inherit'});
  execFileSync('/usr/bin/hdiutil',['verify',`dist/MediaStorm-Agent-${version}-mac-arm64.dmg`],{stdio:'pipe',timeout:60000});
  const extracted = join(temporary,'update-zip');
  execFileSync('/usr/bin/ditto',['-x','-k',`dist/MediaStorm-Agent-${version}-mac-arm64.zip`,extracted],{timeout:120000});
  const zipBundle = join(extracted,'MediaStorm Agent.app');
  const zipManifest = JSON.parse(readFileSync(join(zipBundle,'Contents/Resources/app/package.json'),'utf8'));
  assert.deepEqual(zipManifest,manifest);
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',zipBundle],{stdio:'inherit'});
  if (manifest.releaseChannel === 'stable') {
    for (const target of [bundle,zipBundle,`dist/MediaStorm-Agent-${version}-mac-arm64.dmg`]) execFileSync('/usr/bin/xcrun',['stapler','validate',target],{stdio:'inherit'});
    execFileSync('/usr/sbin/spctl',['--assess','--type','execute',bundle],{stdio:'inherit'});
  }
  console.log('PASS: independent Mac app, no external/broken links, package allowlist, portable runtimes, SDK workflow, CodeGraph indexing, signature structure and DMG integrity.');
} finally { rmSync(temporary,{recursive:true,force:true}); }
