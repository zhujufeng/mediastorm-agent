import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { stripVTControlCharacters, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { prepareProject, projectLaunch, readRecentProjects, rememberProject } from '../scripts/pi-project.mjs';
import { agents } from '../.pi/extensions/mediastorm/agents.mjs';
import { DesktopCredentials, readJSON, textInput, validateSettings, writeJSON } from './store.mjs';

// Python's standard-library bytecode must not modify the signed application bundle.
process.env.PYTHONDONTWRITEBYTECODE = '1';
const dataDir = process.env.STORM_USER_DATA;
const settingsFile = join(dataDir, 'model.json'), recentFile = join(dataDir, 'projects.json');
const emit = (type, data = {}) => process.send?.({ type, ...data });
const pending = new Map(), credentialRequests = new Set();
let session, runtime, project, busy = false, loginAbort, profile = 'project-takeover';
let config = existsSync(settingsFile) ? validateSettings(readJSON(settingsFile)) : null;
const clean = text => stripVTControlCharacters(String(text ?? ''));
const sessionDir = root => join(dataDir, 'sessions', createHash('sha256').update(realpathSync(root)).digest('hex'));
const projectSessions = () => project ? SessionManager.list(project, sessionDir(project)) : [];
const bridge = (kind, data, signal, timeout) => new Promise((resolve, reject) => {
  const id = randomUUID();
  let timer;
  const finish = (value, error) => {
    pending.delete(id); credentialRequests.delete(id); clearTimeout(timer); signal?.removeEventListener('abort', abort);
    emit('dismiss', { id }); error ? reject(new Error(error)) : resolve(value);
  };
  const abort = () => finish(undefined, '操作已取消');
  pending.set(id, finish); if (kind === 'credentials') credentialRequests.add(id);
  if (signal?.aborted) { abort(); return; }
  signal?.addEventListener('abort', abort, { once: true });
  if (timeout) timer = setTimeout(abort, timeout);
  emit(kind, { id, ...data });
});
const credentials = new DesktopCredentials(() => bridge('credentials', { action: 'read' }), data => bridge('credentials', { action: 'write', data }));
const displayMessage = message => ({
  role: message.role, toolName: message.toolName, isError: message.isError,
  text: clean(typeof message.content === 'string' ? message.content : (message.content ?? []).flatMap(c => c.type === 'text' ? [c.text] : []).join('\n')),
  error: message.errorMessage ? clean(message.errorMessage) : undefined,
});
const visibleMessage = message => ['user', 'assistant', 'toolResult'].includes(message.role);
const history = () => {
  const messages = (session?.messages ?? []).filter(visibleMessage);
  emit('history', { messages: messages.slice(-200).map(displayMessage), omitted: Math.max(0, messages.length - 200) });
};
function assertIdle() { if (busy || loginAbort) throw new Error('请先停止当前操作，再切换项目或修改设置。'); }
function registerProxy(value) {
  runtime.unregisterProvider('storm-proxy');
  if (value?.provider === 'storm-proxy') runtime.registerProvider('storm-proxy', {
    baseUrl: value.baseUrl, api: value.api,
    models: [{ id: value.model, name: value.model, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: value.reasoning, input: ['text'], contextWindow: value.contextWindow, maxTokens: value.maxTokens }],
  });
}
async function requireCredential() {
  if (!config) throw new Error('请先保存模型设置。');
  const account = await credentials.read(config.provider);
  if (!account) throw new Error('模型尚未登录或没有密钥，请打开模型设置。');
  if (config.provider === 'storm-proxy' && account.env?.STORM_PROXY_BASE_URL !== config.baseUrl) throw new Error('中转站密钥与当前地址不匹配，请重新填写密钥并保存。');
}
async function catalog() {
  const accounts = await runtime.listCredentials();
  const providers = runtime.getProviders().filter(p => p.auth?.oauth).map(p => ({ id: p.id, name: p.auth.oauth.name,
    connected: accounts.some(a => a.providerId === p.id), models: runtime.getModels(p.id).map(m => ({ id: m.id, name: m.name })) }));
  return { providers, config, hasProxyKey: accounts.some(a => a.providerId === 'storm-proxy'),
    agents: Object.entries(agents).map(([id, a]) => ({ id, name: a.name, description: a.description })),
    recent: readRecentProjects(recentFile).filter(p => existsSync(join(p, '.git'))), project, busy,
    sessions: (await projectSessions()).slice(0, 40).map(s => ({ id: s.id, title: clean(s.name || s.firstMessage || '新对话').slice(0, 100), modified: s.modified, active: s.path === session?.sessionFile })) };
}
const ui = {
  notify: (message, level) => emit('notice', { message: clean(message), level }),
  setStatus: (key, text) => emit('status', { key, text: clean(text) }),
  setWidget: (key, lines) => { if (!lines || Array.isArray(lines)) emit('widget', { key, lines: (lines ?? []).map(clean) }); },
  confirm: async (title, message, options = {}) => (await bridge('question', { kind: 'confirm', title, message }, options.signal, options.timeout)) === true,
  select: (title, options, settings = {}) => bridge('question', { kind: 'select', title, options: options.map(id => ({ id, label: id })) }, settings.signal, settings.timeout),
  input: (title, placeholder, options = {}) => bridge('question', { kind: 'text', title, placeholder }, options.signal, options.timeout),
  editor: (title, prefill) => bridge('question', { kind: 'text', title, value: prefill }),
  custom: async () => { throw new Error('此插件的终端专用界面尚未适配桌面，请使用自然语言工作流。'); },
  onTerminalInput: () => () => {}, setTitle: () => {}, setFooter: () => {}, setHeader: () => {},
  setWorkingMessage: text => emit('working', { text: clean(text) }), setWorkingVisible: () => {}, setWorkingIndicator: () => {}, setHiddenThinkingLabel: () => {},
  setEditorText: text => emit('editor', { text }), pasteToEditor: text => emit('editor', { text }), getEditorText: () => '',
};
async function openProject(path, fresh = false, savedSession) {
  assertIdle();
  const root = prepareProject(textInput(path, '项目目录', 4000));
  if (session) { await session.abort(); session.dispose(); session = undefined; }
  project = undefined;
  process.chdir(root);
  const dir = sessionDir(root);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const launch = projectLaunch(root);
  const paths = flag => launch.args.flatMap((arg, index) => arg === flag ? [launch.args[index + 1]] : []);
  const settingsManager = SettingsManager.inMemory({ defaultProvider: config?.provider, defaultModel: config?.model, enableSkillCommands: true });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(dataDir, 'pi'), settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: paths('-e'), additionalSkillPaths: paths('--skill'),
    appendSystemPrompt: paths('--append-system-prompt'),
    extensionFactories: [pi => pi.on('before_agent_start', () => ({
      // Existing active task owns its profile; this preference only guides new tasks.
      message: { customType: 'desktop-profile', content: `桌面选择的助手是 ${profile}（${agents[profile].name}）。新建任务时使用此 agent；已恢复任务仍遵守该任务保存的 agent。`, display: false },
    }))],
  });
  await loader.reload();
  const errors = loader.getExtensions().errors;
  if (errors.length) throw new Error(`插件加载失败：${errors.map(e => e.error).join('\n')}`);
  const result = await createAgentSession({ cwd: root, agentDir: join(dataDir, 'pi'), settingsManager, modelRuntime: runtime, resourceLoader: loader,
    model: config ? runtime.getModel(config.provider, config.model) : undefined,
    excludeTools: ['trellis_subagent'],
    sessionManager: savedSession ? SessionManager.open(savedSession, dir) : fresh ? SessionManager.create(root, dir) : SessionManager.continueRecent(root, dir) });
  session = result.session;
  emit('project', { path: root, name: basename(root), indexed: existsSync(join(root, '.codegraph')) });
  const startupErrors = [];
  await session.bindExtensions({ mode: 'interactive', uiContext: ui, onError: e => { startupErrors.push(e); emit('notice', { message: clean(e.message ?? e.error), level: 'error' }); } });
  if (startupErrors.length) { session.dispose(); session = undefined; throw new Error('插件启动失败，请查看上方错误。'); }
  session.subscribe(event => {
    if (event.type === 'message_update' && visibleMessage(event.message)) emit('stream', { message: displayMessage(event.message) });
    if (event.type === 'message_start' && visibleMessage(event.message)) emit('message', { message: displayMessage(event.message) });
    if (event.type === 'message_end' && visibleMessage(event.message)) emit('message-end', { message: displayMessage(event.message) });
    if (event.type === 'tool_execution_start') emit('tool', { name: event.toolName, state: 'running', args: clean(JSON.stringify(event.args)).slice(0, 2000) });
    if (event.type === 'tool_execution_end') emit('tool', { name: event.toolName, state: event.isError ? 'error' : 'done' });
    if (event.type === 'auto_compaction_start') emit('working', { text: '正在整理对话上下文…' });
    if (event.type === 'auto_compaction_end') emit('working', { text: event.errorMessage || '上下文已整理' });
  });
  project = root;
  rememberProject(root, recentFile);
  history();
  if (result.modelFallbackMessage) emit('notice', { message: result.modelFallbackMessage, level: 'warning' });
  return catalog();
}
const handlers = {
  catalog,
  open: data => openProject(data.path),
  fresh: () => { if (!project) throw new Error('请先打开项目。'); return openProject(project, true); },
  async resume(data) {
    assertIdle();
    const saved = (await projectSessions()).find(s => s.id === data.id);
    if (!saved || saved.cwd !== project || realpathSync(saved.path) !== join(sessionDir(project), basename(saved.path))) throw new Error('该对话不属于当前项目或已经移走。');
    return openProject(project, false, saved.path);
  },
  profile: data => { assertIdle(); if (!Object.hasOwn(agents, data.id)) throw new Error('未知助手。'); profile = data.id; return true; },
  async saveModel(data) {
    assertIdle();
    const next = validateSettings(data);
    if (next.provider !== 'storm-proxy' && !runtime.getProvider(next.provider)?.auth?.oauth) throw new Error('请选择列表中的登录服务。');
    if (next.provider === 'storm-proxy') {
      const existing = await credentials.read('storm-proxy');
      if (!data.key && (!existing || existing.env?.STORM_PROXY_BASE_URL !== next.baseUrl)) throw new Error('首次配置或更换中转站地址时，请填写密钥。');
      if (data.key) await credentials.modify('storm-proxy', async () => ({ type: 'api_key', key: textInput(data.key, '密钥', 20000), env: { STORM_PROXY_BASE_URL: next.baseUrl } }));
    }
    registerProxy(next);
    const model = runtime.getModel(next.provider, next.model);
    if (!model) { registerProxy(config); throw new Error('该服务没有这个模型，请重新选择。'); }
    writeJSON(settingsFile, next); config = next;
    await runtime.refresh({ providers: [next.provider] });
    return catalog();
  },
  async login(data) {
    assertIdle();
    if (!runtime.getProvider(data.provider)?.auth?.oauth) throw new Error('该服务不支持登录授权。');
    loginAbort = new AbortController();
    const signal = AbortSignal.any([loginAbort.signal, AbortSignal.timeout(15 * 60 * 1000)]);
    try {
      await runtime.login(data.provider, 'oauth', { signal,
        prompt: async p => {
          if (data.provider === 'openai-codex' && p.type === 'select' && p.options.some(o => o.id === 'browser') && p.options.some(o => o.id === 'device_code')) return data.method === 'device_code' ? 'device_code' : 'browser';
          const value = await bridge('question', { source: 'auth', promptType: p.type, kind: p.type === 'secret' ? 'secret' : p.type === 'select' ? 'select' : 'text', title: p.message, placeholder: p.placeholder, options: p.options }, p.signal ? AbortSignal.any([p.signal, signal]) : signal);
          if (typeof value !== 'string') throw new Error('登录已取消'); return value;
        },
        notify: event => emit('auth', { event }),
      });
      return catalog();
    } catch (error) {
      if (signal.aborted) throw new Error(loginAbort.signal.aborted ? '登录已取消，可以重新连接。' : '登录等待已超时，请重试。');
      throw error;
    } finally { loginAbort = undefined; }
  },
  async logout(data) { assertIdle(); if (!runtime.getProvider(data.provider)) throw new Error('未知服务。'); await runtime.logout(data.provider); return catalog(); },
  async prompt(data) {
    assertIdle();
    if (!session) throw new Error('请先选择一个项目。');
    if (!config) throw new Error('请先在“模型设置”中选择模型并登录，或配置中转站。');
    await requireCredential();
    const text = textInput(data.text, '消息', 50000);
    busy = true; emit('busy', { busy });
    try { await session.setModel(runtime.getModel(config.provider, config.model)); await session.prompt(text); }
    finally { busy = false; emit('busy', { busy }); history(); }
  },
  async testModel() {
    assertIdle(); await requireCredential();
    busy = true; emit('busy', { busy }); loginAbort = new AbortController();
    try {
      const result = await runtime.completeSimple(runtime.getModel(config.provider, config.model), { messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }] }, { maxTokens: 32, signal: AbortSignal.any([loginAbort.signal, AbortSignal.timeout(45000)]) });
      if (result.stopReason === 'error' || result.stopReason === 'aborted') throw new Error(result.errorMessage || '连接测试失败');
      return { message: '模型已实际响应，连接可用。' };
    } finally { busy = false; loginAbort = undefined; emit('busy', { busy }); }
  },
  async stop() {
    loginAbort?.abort();
    for (const [id, finish] of [...pending]) if (!credentialRequests.has(id)) finish(undefined, '操作已取消');
    await session?.abort(); return true;
  },
  async close() { await handlers.stop(); session?.dispose(); process.exitCode = 0; setTimeout(() => process.exit(), 50); },
  async changes() {
    if (!project) throw new Error('请先打开项目。');
    const git = async args => clean((await promisify(execFile)('git', args, { cwd: project, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 10000, maxBuffer: 2 * 1024 * 1024 })).stdout);
    const status = await git(['status', '--short']);
    const unstaged = await git(['diff', '--no-ext-diff', '--no-textconv', '--']);
    const staged = await git(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--']);
    return { text: `当前工作目录的改动（包括开始任务前已有的改动）\n未跟踪文件只列名称；此视图不代表检查已通过。\n\n${status || '没有文件改动。'}\n未暂存差异\n${unstaged || '无'}\n已暂存差异\n${staged || '无'}` };
  },
  diagnostics: () => ({ node: process.version, project, tools: session?.getActiveToolNames() ?? [], sessionFile: session?.sessionFile }),
};
process.on('message', async message => {
  if (message.reply) { pending.get(message.reply)?.(message.value, message.error); return; }
  const { id, action, data = {} } = message;
  try {
    if (!Object.hasOwn(handlers, action)) throw new Error('不支持的操作。');
    emit('response', { id, value: await handlers[action](data) });
  } catch (error) { emit('response', { id, error: clean(error.message) }); }
});
process.on('disconnect', () => { session?.abort().finally(() => process.exit()); if (!session) process.exit(); });
runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStorePath: join(dataDir, 'models-cache'), allowModelNetwork: false, refreshOnCreate: false });
registerProxy(config);
emit('ready');
