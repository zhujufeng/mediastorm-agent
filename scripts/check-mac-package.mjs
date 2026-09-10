import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const temporary = mkdtempSync('/private/tmp/mediastorm-package-check-');
try {
  execFileSync('/bin/cp',['-cR','dist/MediaStorm Agent-darwin-arm64/MediaStorm Agent.app',temporary]);
  const bundle = join(temporary,'MediaStorm Agent.app');
  const root = join(bundle,'Contents/Resources/app');
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
  execFileSync(process.execPath,['scripts/check-desktop-auth.mjs',root],{stdio:'inherit',timeout:90000});
  execFileSync(process.execPath,['scripts/check-desktop.mjs',root],{stdio:'inherit',timeout:90000});
  const fixture = join(temporary,'codegraph-project');
  execFileSync(join(root,'node_modules/dugite/git/bin/git'),['init','-q',fixture],{env:{...process.env,GIT_TEMPLATE_DIR:join(root,'node_modules/dugite/git/share/git-core/templates')}});
  writeFileSync(join(fixture,'sample.py'),'def greet(name):\n    return "hello " + name\n');
  execFileSync(join(root,'runtime/bin/codegraph'),['init','-i'],{cwd:fixture,stdio:'pipe',timeout:45000});
  assert.ok(existsSync(join(fixture,'.codegraph')));
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{stdio:'inherit'});
  execFileSync('/usr/bin/hdiutil',['verify','dist/MediaStorm-Agent-0.2.0-mac-arm64.dmg'],{stdio:'pipe',timeout:60000});
  console.log('PASS: independent Mac app, no external/broken links, package allowlist, portable runtimes, SDK workflow, CodeGraph indexing, signature structure and DMG integrity.');
} finally { rmSync(temporary,{recursive:true,force:true}); }
