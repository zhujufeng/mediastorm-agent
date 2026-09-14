import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify, stripVTControlCharacters } from 'node:util';

export const larkBinary = fileURLToPath(new URL('../../runtime/bin/lark-cli', import.meta.url));
const domains = new Set(['base', 'docs', 'drive', 'sheets', 'slides', 'markdown', 'wiki', 'im', 'contact', 'calendar', 'task', 'mail', 'meeting', 'minutes', 'vc', 'attendance', 'approval', 'okr', 'apps', 'whiteboard', 'schema']);

// Only exact offline forms bypass confirmation. Never classify a shell command by prefix.
export function offlineLark(args) {
  return args.length === 1 && ['--version', '--help'].includes(args[0]) ||
    args[0] === 'skills' && ['list', 'read'].includes(args[1]) && args.length <= 4 &&
      args.slice(2).every(x => /^(?:lark-[a-z-]+(?:\/[a-zA-Z0-9_./-]+)?|references\/[a-zA-Z0-9_./-]+|--json)$/.test(x) && !x.includes('..')) ||
    args.length >= 2 && args.at(-1) === '--help' &&
      ['auth', 'config', ...domains].includes(args[0]) && args.slice(1, -1).every(x => /^\+?[a-z][a-z0-9-]*$/.test(x));
}

export function validateLark(args) {
  if (!Array.isArray(args) || !args.length || args.length > 100 || args.some(x => typeof x !== 'string' || x.length > 20000 || /[\x00-\x1f\x7f]/.test(x))) throw new Error('请传入有限的 CLI 参数数组，不是 shell 命令；复杂数据使用 CLI 支持的相对文件。');
  if (offlineLark(args)) return;
  if (args[0] === 'auth' && args[1] === 'status' && args.slice(2).every(x => ['--json', '--verify'].includes(x))) return;
  if (!domains.has(args[0])) throw new Error('此入口只运行飞书业务命令、auth status 和离线帮助。配置、登录、升级或底层 api 请在原生终端操作，不通过 Bash 绕过确认。');
  if (!args.includes('--as') || !['user', 'bot'].includes(args[args.indexOf('--as') + 1])) throw new Error('业务调用必须显式指定 --as user 或 --as bot；权限失败不得自动切换身份。');
}

function publicOutput(text) {
  return stripVTControlCharacters(text)
    .replace(/("(?:app_?secret|client_secret|access_token|refresh_token|tenant_access_token|user_access_token)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]');
}

export default function larkPlugin(pi) {
  pi.registerTool({
    name: 'storm_lark', label: '飞书 CLI',
    description: '调用随包的官方飞书 CLI。先读飞书入口技能，再用 args=["skills","read","lark-base"] 等读取内嵌指南。联网/业务调用须用户单独确认。配置和登录在原生终端完成；不传密钥。',
    parameters: { type: 'object', properties: {
      args: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 },
      offset: { type: 'integer', minimum: 0, description: '仅离线帮助/技能输出的字符偏移，用于继续读取长文。业务请求不可用此参数重复执行。' },
    }, required: ['args'], additionalProperties: false },
    async execute(_id, { args, offset = 0 }, signal, _update, ctx) {
      validateLark(args);
      const offline = offlineLark(args);
      if (!Number.isSafeInteger(offset) || offset < 0 || (!offline && offset !== 0)) throw new Error('只有离线文档允许分页读取。');
      if (!existsSync(larkBinary)) throw new Error('缺少随包飞书 CLI。源码请运行 npm run desktop:runtime；安装版请重新安装完整应用。');
      if (!offline) {
        if (!ctx.hasUI) throw new Error('飞书调用需要可交互的用户确认界面。');
        const approved = await ctx.ui.confirm('飞书操作确认',
          `本次会使用 CLI 当前配置的账户，可能读取或修改飞书数据、发送消息或写入项目文件。代码方案批准不代表批准此操作。\n\n参数：${JSON.stringify(args)}\n\n确认仅适用于本次调用；不要在参数中填入密钥。`, { signal, timeout: 120000 });
        if (!approved) return { content: [{ type: 'text', text: '用户取消，未调用飞书 CLI。' }], details: { cancelled: true } };
      }
      if (signal?.aborted) throw new Error('操作已取消，未执行。');
      let stdout = '', stderr = '', code = 0;
      try {
        ({ stdout, stderr } = await promisify(execFile)(larkBinary, args, {
          cwd: ctx.cwd, signal, timeout: 120000, maxBuffer: 1024 * 1024,
          env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
        }));
      } catch (error) {
        if (!Number.isInteger(error.code)) throw new Error('CLI 被取消、超时、输出超限或启动失败；结果未知，不自动重试写入。');
        stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; code = error.code;
      }
      const output = publicOutput(`${stdout}${stderr ? '\n' + stderr : ''}`);
      const next = offset + 48000;
      const text = `退出码：${code}${code === 10 ? '（上游要求高风险确认；先说明影响，用户确认后才可按提示重试）' : ''}\n` +
        output.slice(offset, next) + (output.length > next ? offline ? `\n[输出截断；用相同args及offset=${next}继续读取]` : '\n[输出截断；请缩小查询，不要为读取输出而重复写入]' : '');
      // Pi marks execute() failures via thrown errors, not a result.isError property.
      if (code !== 0) throw new Error(text);
      return { content: [{ type: 'text', text }], details: { exitCode: code, truncated: output.length > next } };
    },
  });
}
