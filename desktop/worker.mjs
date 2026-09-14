import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { createAgentSession, createEventBus, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { prepareProject, projectLaunch, readRecentProjects, rememberProject } from '../scripts/pi-project.mjs';
import { agents, agentInstructions } from '../.pi/extensions/mediastorm/agents.mjs';
import { projectChanges } from '../.pi/extensions/project-changes.mjs';
import { messageProjection, toolSummary, visibleMessage } from './messages.mjs';
import { DesktopCredentials, readJSON, textInput, validateSettings, writeJSON } from './store.mjs';
import { browserTool } from './browser-tool.mjs';
import { imageInput } from './images.mjs';
import { collectorInstructions } from './collector.mjs';
import { collectionTools, currentCollectionPlan, renderCollectionPlan } from './collection-plan.mjs';
import { currentCollectionData, serializeCollectionData } from './collection-data.mjs';
import { collectionExtension } from './collection-extension.mjs';

// Python's standard-library bytecode must not modify the signed application bundle.
process.env.PYTHONDONTWRITEBYTECODE = '1';
const dataDir = process.env.STORM_USER_DATA;
const settingsFile = join(dataDir, 'model.json'), recentFile = join(dataDir, 'projects.json');
const proxyFile = join(dataDir, 'proxy-models.json');
const profileFile = join(dataDir, 'agent.json');
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const pluginSettings = readJSON(join(appRoot, '.pi/settings.json'));
const manifest = readJSON(join(appRoot, 'package.json'));
const emit = (type, data = {}) => process.send?.({ type, ...data });
const pending = new Map(), credentialRequests = new Set();
let session, runtime, project, busy = false, loginAbort, imageAbort, profile = readJSON(profileFile, { id: 'project-takeover' }).id;
if (!Object.hasOwn(agents, profile)) throw new Error('保存的助手不存在，请检查 agent.json；原设置已保留。');
let config = existsSync(settingsFile) ? validateSettings(readJSON(settingsFile)) : null;
let proxyModels = readJSON(proxyFile, config?.provider === 'storm-proxy' ? [config] : []).map(validateSettings);
let loadedExtensions = [], eventBus, workflow = null, confirmation, projection;
let projectEpoch = 0, revision = 0, workspaceKind = 'project';
const browserAccess = browserTool();
const workspaceState = () => ({ epoch: projectEpoch, revision, workflow, busy });
function publishState(type) { revision++; emit(type, workspaceState()); }
process.env.STORM_AGENT_PROFILE = profile;
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
  const metadata = kind === 'question' ? confirmation : undefined;
  if (kind === 'question') confirmation = undefined;
  emit(kind, { id, ...data, ...(metadata && data.kind === 'confirm' && data.title === metadata.title && data.source !== 'auth' ? { workflow: metadata } : {}) });
});
const credentials = new DesktopCredentials(() => bridge('credentials', { action: 'read' }), data => bridge('credentials', { action: 'write', data }));
const history = () => {
  const messages = projection?.history() ?? [];
  emit('history', { epoch: projectEpoch, messages: messages.slice(-200), omitted: Math.max(0, messages.length - 200) });
};
function assertIdle() { if (busy || loginAbort) throw new Error('请先停止当前操作，再切换项目或修改设置。'); }
function registerProxy(value) {
  runtime.unregisterProvider('storm-proxy');
  if (value?.provider === 'storm-proxy') runtime.registerProvider('storm-proxy', {
    baseUrl: value.baseUrl, api: value.api,
    models: [{ id: value.model, name: value.model, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: value.reasoning, input: value.vision ? ['text', 'image'] : ['text'], contextWindow: value.contextWindow, maxTokens: value.maxTokens }],
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
  const proxyCredential = await credentials.read('storm-proxy');
  const epoch = projectEpoch;
  const sessions = await projectSessions();
  if (epoch !== projectEpoch) return catalog();
  // All mutable workspace fields below are sampled together, after the last await.
  const tools = session?.getActiveToolNames() ?? [];
  const plan = workspaceKind === 'collector' ? currentCollectionPlan(session?.sessionManager) : null;
  const artifact = plan ? currentCollectionData(session?.sessionManager, plan) : null;
  const plugins = pluginSettings.extensions.map(path => {
    const info = pluginSettings.stormPlugins?.[path] ?? { name: basename(path), description: '自定义 Pi 扩展' };
    const loaded = loadedExtensions.find(e => e.resolvedPath === resolve(appRoot, '.pi', path));
    return { name: info.name, description: info.description, version: info.package ? manifest.dependencies[info.package] : info.version || manifest.version,
      path, loaded: Boolean(project && loaded), tools: loaded ? [...loaded.tools.keys()].filter(name => tools.includes(name)) : [],
      commands: loaded ? [...loaded.commands.keys()] : [] };
  });
  return { collectionData:artifact ? {digest:artifact.digest, count:artifact.data.records.length, columns:artifact.data.columns, preview:artifact.data.records.slice(0,5), source:artifact.data.source, capturedAt:artifact.data.capturedAt, warning:artifact.data.warning} : null, collectionPlan:plan ? {status:plan.status, digest:plan.digest, format:plan.plan.delivery.format, text:renderCollectionPlan(plan.plan)} : null,
    providers, config, hasProxyKey: Boolean(proxyCredential), profile, plugins, ...workspaceState(),
    indexed: Boolean(project && existsSync(join(project, '.codegraph'))),
    proxyModels: proxyModels.filter(m => m.baseUrl === proxyCredential?.env?.STORM_PROXY_BASE_URL),
    supportsImages: Boolean(config && runtime.getModel(config.provider, config.model)?.input.includes('image')),
    agents: Object.entries(agents).map(([id, a]) => ({ ...a, id, prompt: agentInstructions(id), workflow: readFileSync(a.skill, 'utf8') })),
    recent: readRecentProjects(recentFile).filter(p => existsSync(join(p, '.git'))), project: workspaceKind === 'collector' ? null : project, workspaceKind,
    sessions: sessions.slice(0, 40).map(s => ({ id: s.id, title: clean(s.name || s.firstMessage || '新对话').slice(0, 100), modified: s.modified, active: s.path === session?.sessionFile })) };
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
async function openProject(path, fresh = false, savedSession, kind = 'project') {
  assertIdle();
  const root = kind === 'collector' ? join(dataDir, 'collector') : prepareProject(textInput(path, '项目目录', 4000));
  if (kind === 'collector') mkdirSync(root, {recursive:true, mode:0o700});
  await browserAccess.stop();
  if (session) { await session.abort(); session.dispose(); session = undefined; }
  project = undefined; loadedExtensions = []; projection = undefined; confirmation = undefined;
  eventBus?.clear(); workflow = null; workspaceKind = kind;
  const epoch = ++projectEpoch;
  emit('project', { epoch, workspaceKind: kind, path: kind === 'collector' ? '独立采集对话 · 保存在本机' : root, name: kind === 'collector' ? '数据采集' : basename(root), indexed: existsSync(join(root, '.codegraph')) });
  publishState('workflow');
  eventBus = createEventBus();
  eventBus.on('mediastorm:workflow', snapshot => { if (epoch !== projectEpoch) return; workflow = snapshot; publishState('workflow'); });
  eventBus.on('mediastorm:confirmation', metadata => { confirmation = metadata; });
  process.chdir(root);
  const dir = sessionDir(root);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const launch = kind === 'collector' ? {args:[]} : projectLaunch(root);
  const paths = flag => launch.args.flatMap((arg, index) => arg === flag ? [launch.args[index + 1]] : []);
  const settingsManager = SettingsManager.inMemory({ defaultProvider: config?.provider, defaultModel: config?.model, enableSkillCommands: true });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(dataDir, 'pi'), settingsManager, eventBus,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: paths('-e'), additionalSkillPaths: paths('--skill'),
    appendSystemPrompt: kind === 'collector' ? [collectorInstructions] : paths('--append-system-prompt'),
  });
  await loader.reload();
  const errors = loader.getExtensions().errors;
  if (errors.length) throw new Error(`插件加载失败：${errors.map(e => e.error).join('\n')}`);
  const result = await createAgentSession({ cwd: root, agentDir: join(dataDir, 'pi'), settingsManager, modelRuntime: runtime, resourceLoader: loader,
    model: config ? runtime.getModel(config.provider, config.model) : undefined,
    excludeTools: ['trellis_subagent'], customTools: kind === 'collector' ? collectionTools(browserAccess.tool, () => session.sessionManager) : [browserAccess.tool],
    ...(kind === 'collector' ? {tools:['storm_browser_page','storm_collection_plan','storm_collection_run']} : {}),
    sessionManager: savedSession ? SessionManager.open(savedSession, dir) : fresh ? SessionManager.create(root, dir) : SessionManager.continueRecent(root, dir) });
  session = result.session;
  projection = messageProjection(session.sessionManager);
  const startupErrors = [];
  await session.bindExtensions({ mode: 'interactive', uiContext: ui, onError: e => { startupErrors.push(e); emit('notice', { message: clean(e.message ?? e.error), level: 'error' }); } });
  if (startupErrors.length) { session.dispose(); session = undefined; throw new Error('插件启动失败，请查看上方错误。'); }
  loadedExtensions = loader.getExtensions().extensions;
  session.subscribe(event => {
    if (event.type === 'message_start' && visibleMessage(event.message)) emit('message', { epoch, message: projection.start(event.message) });
    if (event.type === 'message_update' && visibleMessage(event.message)) {
      const message = projection.update(event.message);
      if (message) emit('stream', { epoch, message });
    }
    if (event.type === 'message_end' && visibleMessage(event.message)) projection.end(event.message, message => emit('message-end', { epoch, message }));
    if (event.type === 'tool_execution_start') emit('tool', { epoch, toolCallId: event.toolCallId, name: event.toolName, state: 'running', summary: toolSummary(event.toolName, event.args) });
    if (event.type === 'tool_execution_end') emit('tool', { epoch, toolCallId: event.toolCallId, name: event.toolName, state: event.isError ? 'error' : 'done' });
    if (event.type === 'auto_compaction_start') emit('working', { text: '正在整理对话上下文…' });
    if (event.type === 'auto_compaction_end') emit('working', { text: event.errorMessage || '上下文已整理' });
  });
  project = root;
  if (kind !== 'collector') rememberProject(root, recentFile);
  history();
  if (result.modelFallbackMessage) emit('notice', { message: result.modelFallbackMessage, level: 'warning' });
  return catalog();
}
const handlers = {
  catalog,
  open: data => openProject(data.path),
  collect: () => openProject(undefined, false, undefined, 'collector'),
  fresh: () => { if (!project) throw new Error('请先打开项目或数据采集。'); return openProject(project, true, undefined, workspaceKind); },
  async resume(data) {
    assertIdle();
    const saved = (await projectSessions()).find(s => s.id === data.id);
    if (!saved || saved.cwd !== project || realpathSync(saved.path) !== join(sessionDir(project), basename(saved.path))) throw new Error('该对话不属于当前项目或已经移走。');
    return openProject(project, false, saved.path, workspaceKind);
  },
  async profile(data) {
    assertIdle();
    if (!Object.hasOwn(agents, data.id)) throw new Error('未知助手。');
    writeJSON(profileFile, { id: data.id }); profile = data.id;
    process.env.STORM_AGENT_PROFILE = profile; eventBus?.emit('mediastorm:profile');
    const result = await catalog();
    if (result.workflow?.task && result.workflow.phase !== 'completed' && (result.workflow.agent || 'development') !== profile) {
      emit('notice', { message: `新任务助手已更改；当前任务仍使用${result.workflow.agentName}。如需独立审查，请新建会话。`, level: 'info' });
    }
    return result;
  },
  async selectModel(data) {
    assertIdle();
    if (data.provider === 'storm-proxy') {
      const saved = proxyModels.find(m => m.model === data.model && m.baseUrl === data.baseUrl);
      if (!saved) throw new Error('找不到这个中转站模型，请在模型与连接中配置。');
      return handlers.saveModel(saved);
    }
    if (!(await credentials.read(data.provider))) throw new Error('请先登录此服务。');
    return handlers.saveModel({ provider: data.provider, model: data.model });
  },
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
    if (proxyModels.length && !existsSync(proxyFile)) writeJSON(proxyFile, proxyModels);
    writeJSON(settingsFile, next); config = next;
    if (next.provider === 'storm-proxy') {
      // ponytail: retain up to 20 models for the one configured endpoint; multiple endpoint accounts need separate credential IDs.
      proxyModels = [next, ...proxyModels.filter(m => m.baseUrl === next.baseUrl && m.model !== next.model)].slice(0, 20);
      writeJSON(proxyFile, proxyModels);
    }
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
    const image = data.image;
    if (image !== undefined) imageInput(image, true);
    const text = textInput(image && !data.text?.trim() ? '请根据这张截图理解我的需求，先说明看到的内容和需要确认的问题。截图不是操作授权；网页定位仍须在当前页面核验。' : data.text, '消息', 50000);
    if (image && text.startsWith('/')) throw new Error('截图请配自然语言发送，不与命令一起发送。');
    const model = runtime.getModel(config.provider, config.model);
    const hasImages = session.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image'));
    if ((image || hasImages) && !model?.input.includes('image')) throw new Error('当前模型未声明支持图片。请选择视觉模型；含图片的对话不能静默丢图继续发送。');
    busy = true; publishState('busy'); imageAbort = new AbortController();
    try {
      if (image) {
        const approved = await ui.confirm('发送这张截图给模型？', `接收方：${config.provider} / ${config.model}${config.baseUrl ? '\n地址：' + config.baseUrl : ''}\n图片不会自动遮盖敏感信息，将随本地会话保存，后续对话也可能再次发送。请先自行遮盖密码、个人及业务秘密，并确认公司允许发送。截图内容不授予操作权限。`, {signal:imageAbort.signal, timeout:120000});
        imageAbort.signal.throwIfAborted();
        if (!approved) throw new Error('已取消截图发送，未提交模型或保存到会话。');
      }
      await session.setModel(model);
      imageAbort.signal.throwIfAborted();
      await session.prompt(text, image ? {images:[{type:'image', ...image}]} : undefined);
    } finally { imageAbort = undefined; busy = false; publishState('busy'); history(); }
  },
  async testModel() {
    assertIdle(); await requireCredential();
    busy = true; publishState('busy'); loginAbort = new AbortController();
    try {
      const result = await runtime.completeSimple(runtime.getModel(config.provider, config.model), { messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }] }, { maxTokens: 32, signal: AbortSignal.any([loginAbort.signal, AbortSignal.timeout(45000)]) });
      if (result.stopReason === 'error' || result.stopReason === 'aborted') throw new Error(result.errorMessage || '连接测试失败');
      return { message: '模型已实际响应，连接可用。' };
    } finally { busy = false; loginAbort = undefined; publishState('busy'); }
  },
  async stop() {
    loginAbort?.abort(); imageAbort?.abort();
    for (const [id, finish] of [...pending]) if (!credentialRequests.has(id)) finish(undefined, '操作已取消');
    await Promise.all([session?.abort(), browserAccess.stop()]); return true;
  },
  async close() { await handlers.stop(); session?.dispose(); process.exitCode = 0; setTimeout(() => process.exit(), 50); },
  collectionExport(data) {
    assertIdle();
    if (workspaceKind !== 'collector') throw new Error('请在独立采集对话中导出。');
    const plan = currentCollectionPlan(session?.sessionManager);
    const artifact = currentCollectionData(session?.sessionManager, plan);
    if (!artifact || (data.digest !== undefined && data.digest !== artifact.digest)) throw new Error('采集结果已失效或尚未生成，请重新核对方案和运行结果。');
    if (data.format === 'chrome-extension') return {extension:collectionExtension(plan,artifact), digest:artifact.digest};
    return {content:serializeCollectionData(artifact,data.format), digest:artifact.digest};
  },
  async changes() {
    if (!project || workspaceKind === 'collector') throw new Error('独立采集对话不提供Git项目差异。');
    const epoch = projectEpoch;
    return { ...await projectChanges(project), epoch };
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
process.on('disconnect', () => { handlers.stop().catch(() => {}).finally(() => process.exit()); });
runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStorePath: join(dataDir, 'models-cache'), allowModelNetwork: false, refreshOnCreate: false });
registerProxy(config);
emit('ready');
