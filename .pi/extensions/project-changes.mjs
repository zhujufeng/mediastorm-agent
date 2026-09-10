import { execFile } from 'node:child_process';
import { promisify, stripVTControlCharacters } from 'node:util';

const labels = { staged: '已暂存', unstaged: '未暂存', untracked: '未跟踪' };
const limit = 1024 * 1024, fileLimit = 100;
// NUL records preserve tabs, newlines and quotes. Incomplete bounded records are never used as paths.
function changedNames(output, group) {
  const parts = output.split('\0'); parts.pop();
  const files = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++], first = parts[i++];
    if (!status || first === undefined) break;
    const renamed = /^[RC]/.test(status), path = renamed ? parts[i++] : first;
    if (path === undefined) break;
    files.push({ group, status, path, ...(renamed ? { oldPath: first } : {}) });
  }
  return files;
}

// Fixed read-only Git queries. No renderer/model-supplied executable, options or paths.
export async function projectChanges(project, signal) {
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  const git = async (args, maxBuffer = 2 * limit) => {
    try {
      const result = await promisify(execFile)('git', ['--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args], {
        cwd: project, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }, signal: boundedSignal, timeout: 10000, maxBuffer,
      });
      return { output: result.stdout, truncated: false };
    } catch (error) {
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { output: String(error.stdout ?? ''), truncated: true };
      throw error;
    }
  };
  const staged = await git(['diff', '--cached', '--name-status', '-z', '--no-ext-diff', '--no-textconv', '--find-renames', '--']);
  const unstaged = await git(['diff', '--name-status', '-z', '--no-ext-diff', '--no-textconv', '--find-renames', '--']);
  const untracked = await git(['ls-files', '--others', '--exclude-standard', '-z', '--']);
  const names = untracked.output.split('\0'); names.pop();
  const all = [...changedNames(staged.output, 'staged'), ...changedNames(unstaged.output, 'unstaged'),
    ...names.map(path => ({ path, group: 'untracked', status: '?' }))];
  let remaining = limit;
  const files = [];
  for (const file of all.slice(0, fileLimit)) {
    let patch = '', truncated = false;
    if (file.group !== 'untracked') {
      if (remaining <= 0) truncated = true;
      else {
        const result = await git(['diff', ...(file.group === 'staged' ? ['--cached'] : []), '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', '--', ...(file.oldPath ? [file.oldPath] : []), file.path], Math.min(remaining, 128 * 1024));
        patch = stripVTControlCharacters(result.output); truncated = result.truncated;
        remaining -= Buffer.byteLength(patch);
      }
    }
    files.push({ ...file, patch, binary: /^Binary files /m.test(patch), truncated });
  }
  const omitted = Math.max(0, all.length - files.length);
  const truncated = Boolean(omitted || staged.truncated || unstaged.truncated || untracked.truncated || files.some(f => f.truncated));
  const warning = truncated ? '\n显示已截断（最多 100 项、单文件 128 KiB、差异合计 1 MiB）；请在项目中查看完整 Git 差异。' : '';
  const text = `当前工作目录的改动（包括开始任务前已有的改动）\n未跟踪文件只列名称；此视图不代表检查已通过。${warning}\n\n` +
    (files.length ? files.map(f => `${labels[f.group]} · ${f.status} · ${JSON.stringify(f.path)}${f.oldPath ? ` ← ${JSON.stringify(f.oldPath)}` : ''}\n${f.patch}${f.truncated ? '\n…此文件差异已截断\n' : ''}`).join('\n') : '没有文件改动。');
  return { text, files, omitted, truncated };
}

export default function projectChangesPlugin(pi) {
  pi.registerTool({
    name: 'storm_changes', label: '查看项目改动',
    description: '只读查看当前项目 Git 状态、已暂存和未暂存差异。包含任务开始前已有改动；未跟踪文件仅列名称。最多 100 项、单文件 128 KiB、差异合计 1 MiB，截断会明确提示。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_id, _params, signal, _update, ctx) {
      const result = await projectChanges(ctx.cwd, signal);
      return { content: [{ type: 'text', text: result.text }], details: {} };
    },
  });
}
