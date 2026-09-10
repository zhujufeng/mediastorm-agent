import { execFile } from 'node:child_process';
import { promisify, stripVTControlCharacters } from 'node:util';

// Fixed, read-only commands: no model-supplied Git arguments, paths or executable hooks.
export async function projectChanges(project, signal) {
  const git = async args => stripVTControlCharacters((await promisify(execFile)('git', args, {
    cwd: project, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, signal, timeout: 10000, maxBuffer: 2 * 1024 * 1024,
  })).stdout);
  const status = await git(['status', '--short']);
  const unstaged = await git(['diff', '--no-ext-diff', '--no-textconv', '--']);
  const staged = await git(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--']);
  return { text: `当前工作目录的改动（包括开始任务前已有的改动）\n未跟踪文件只列名称；此视图不代表检查已通过。\n\n${status || '没有文件改动。'}\n未暂存差异\n${unstaged || '无'}\n已暂存差异\n${staged || '无'}` };
}

export default function projectChangesPlugin(pi) {
  pi.registerTool({
    name: 'storm_changes', label: '查看项目改动',
    description: '只读查看当前项目 Git 状态、已暂存和未暂存差异。包含任务开始前已有改动；未跟踪文件仅列名称。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_id, _params, _signal, _update, ctx) {
      const result = await projectChanges(ctx.cwd, _signal);
      return { content: [{ type: 'text', text: result.text }], details: {} };
    },
  });
}
