import { rmSync } from 'node:fs';

// Only reproducible build output and download caches; never accounts or project history.
for (const path of ['dist/', '.local/desktop-downloads/']) {
  rmSync(new URL(`../${path}`, import.meta.url), { recursive: true, force: true });
}
console.log('已清理安装产物和下载缓存。');
