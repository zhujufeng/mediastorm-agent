import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJSON(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`配置无法读取，原文件已保留：${file}`); }
}
export function atomicWrite(file, content) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { writeFileSync(tmp, content, { mode: 0o600 }); renameSync(tmp, file); }
  finally { rmSync(tmp, { force: true }); }
}
export function writeJSON(file, value) { atomicWrite(file, JSON.stringify(value, null, 2) + '\n'); }
export function textInput(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`${name}不能为空，且最多 ${max} 字。`);
  return value.trim();
}
export function validateSettings(input) {
  if (!input || typeof input !== 'object') throw new Error('模型配置无效。');
  const provider = textInput(input.provider, '服务');
  const model = textInput(input.model, '模型 ID');
  if (provider !== 'storm-proxy') return { provider, model };
  const url = new URL(textInput(input.baseUrl, '服务地址', 2000));
  if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol)) throw new Error('地址须为不含密钥、查询参数的 HTTP(S) 服务地址。');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('远程中转站请使用 HTTPS 地址。');
  if (!['openai-completions', 'openai-responses', 'anthropic-messages'].includes(input.api)) throw new Error('请选择支持的模型协议。');
  const contextWindow = Number(input.contextWindow ?? 128000), maxTokens = Number(input.maxTokens ?? 8192);
  if (!Number.isSafeInteger(contextWindow) || !Number.isSafeInteger(maxTokens) || maxTokens < 64 || contextWindow < maxTokens || contextWindow > 2000000) throw new Error('请检查上下文长度与最大输出：输出至少 64，且不超过上下文长度（上限 200 万）。');
  return { provider, model, baseUrl: url.href.replace(/\/$/, ''), api: input.api, contextWindow, maxTokens, reasoning: input.reasoning === true };
}

// ponytail: one worker owns credentials; serialize all providers, split locks only if parallel accounts become necessary.
export class DesktopCredentials {
  constructor(load, save) { this.load = load; this.save = save; this.tail = Promise.resolve(); }
  run(fn) { const next = this.tail.then(fn); this.tail = next.catch(() => {}); return next; }
  read(id) { return this.run(async () => structuredClone((await this.load())[id])); }
  list() { return this.run(async () => Object.entries(await this.load()).map(([providerId, c]) => ({ providerId, type: c.type }))); }
  modify(id, fn, options = {}) {
    return this.run(async () => {
      options.signal?.throwIfAborted();
      const data = await this.load();
      const credential = await fn(structuredClone(data[id]));
      options.signal?.throwIfAborted();
      if (credential !== undefined) { Object.defineProperty(data, id, { value: credential, enumerable: true, configurable: true }); await this.save(data); }
      return structuredClone(data[id]);
    });
  }
  delete(id, options = {}) {
    return this.run(async () => { options.signal?.throwIfAborted(); const data = await this.load(); delete data[id]; await this.save(data); });
  }
}
