import { createThread } from './thread.mjs';
import { createInspector } from './inspector.mjs';
const $ = id => document.getElementById(id);
const api = window.storm, welcome = $('welcome');
const w = id => welcome.querySelector(`#${id}`);
let catalog, busy = false, modelMode = 'account', activeQuestion, localBusy = false, authQuestion, loggingIn = false, testing = false, stickToBottom = true, projectEpoch = 0, projectionRevision = -1, disconnected = false;
const questionQueue = [], statuses = new Map();
const thread = createThread($('messages'), welcome);
const inspector = createInspector({ answer: finishQuestion, revise: text => {
  $('prompt').value = [$('prompt').value, text].filter(Boolean).join('\n'); $('prompt').focus();
}, changes: async () => {
  const epoch = projectEpoch, result = await call('changes');
  if (epoch !== projectEpoch || result.epoch !== projectEpoch) throw new Error('项目已切换，请重新查看。');
  return result;
} });
const call = (action, data) => api.invoke(action, data).catch(error => { throw new Error(error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); });
const connected = () => catalog?.config && (catalog.config.provider === 'storm-proxy' ? catalog.hasProxyKey : catalog.providers.some(p => p.id === catalog.config.provider && p.connected));
let updateState, draftImage, imageEpoch = 0, loadingImage = false;
function setImage(value) {
  draftImage = value; $('image-draft').hidden = !value;
  if (value) $('image-preview').src = `data:${value.mimeType};base64,${value.data}`;
  else $('image-preview').removeAttribute('src');
}
async function attachImage(file) {
  if (!file || busy || localBusy || loadingImage) return;
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 4 * 1024 * 1024) { notice('请选择4MiB以内的PNG或JPEG截图。'); return; }
  const epoch = ++imageEpoch; loadingImage = true;
  try {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('截图读取失败。')); reader.readAsDataURL(file);
    });
    if (epoch !== imageEpoch || busy || localBusy) return;
    const prepared = await call('prepareImage', {mimeType:file.type, data});
    if (epoch === imageEpoch && !busy && !localBusy) { setImage(prepared); notice('截图仅在本地预览；发送前请检查是否包含敏感信息。'); }
  } catch (error) { if (epoch === imageEpoch) notice(error.message); }
  finally { loadingImage = false; }
}
$('image-add').onclick = () => $('image-file').click();
$('image-file').onchange = () => { attachImage($('image-file').files[0]); $('image-file').value = ''; };
$('image-remove').onclick = () => { imageEpoch++; setImage(undefined); };
$('prompt').addEventListener('paste', event => {
  const file = [...(event.clipboardData?.files ?? [])][0];
  if (file) { event.preventDefault(); attachImage(file); }
});
function renderUpdate(state) {
  updateState = state;
  $('app-version').textContent = state.version;
  $('update-version').textContent = `当前版本 ${state.version}`;
  $('update-message').textContent = state.message;
  $('update-release').textContent = state.release ? `新版本 ${state.release}` : '';
  $('update-release').hidden = !state.release;
  $('update-notes').textContent = state.notes;
  $('update-notes').hidden = !state.notes;
  $('update-check').disabled = !state.canCheck;
  $('update-install').hidden = !state.canInstall && state.phase !== 'installing';
  $('update-install').disabled = !state.canInstall || busy || localBusy || Boolean(activeQuestion);
  $('updates-open').classList.toggle('update-ready', state.canInstall);
  $('updates-open').title = state.canInstall ? '新版已准备好，点击查看' : '查看版本与软件更新';
}
async function updatesOpen() {
  if ($('updates').open) return;
  if (document.querySelector('dialog[open]')) { notice('请先完成当前弹窗，再打开左下角的软件更新。'); return; }
  try { renderUpdate(await call('updateStatus')); $('updates').showModal(); }
  catch (error) { notice(error.message); }
}
$('updates-open').onclick = updatesOpen;
$('updates-close').onclick = () => $('updates').close();
$('update-check').onclick = async () => { try { renderUpdate(await call('checkUpdate')); } catch (error) { $('update-message').textContent = error.message; } };
$('update-install').onclick = async () => {
  if ($('prompt').value.trim() || draftImage || loadingImage) { $('update-message').textContent = '输入框里还有未发送的内容，请先发送或保存，再重启安装。'; return; }
  try { renderUpdate(await call('installUpdate')); } catch (error) { $('update-message').textContent = error.message; }
};
$('release-page').onclick = () => call('releasePage').catch(error => { $('update-message').textContent = error.message; });
function notice(message) { $('notice-text').textContent = message; $('notice').hidden = !message; }
function feedback(message, tone = 'error') { $('model-feedback').textContent = message; $('model-feedback').dataset.tone = tone; $('model-feedback').hidden = !message; }
function setBusy(value) {
  busy = value; const working = value || localBusy || disconnected;
  document.querySelectorAll('.idle-only').forEach(control => control.disabled = working);
  $('stop').hidden = !working || loggingIn || testing || disconnected; $('send').hidden = working && !disconnected;
  $('cancel-test').hidden = !testing;
  $('collection-rerun').hidden = !catalog?.collectionRecipe;
  $('collection-rerun').disabled = working || catalog?.collectionRecipe?.status !== 'confirmed';
  $('collection-csv').disabled = $('collection-json').disabled = working || !catalog?.collectionData;
  $('collection-extension').hidden = catalog?.collectionPlan?.format !== 'chrome-extension';
  $('collection-extension').disabled = working || !catalog?.collectionData || $('collection-extension').hidden;
  $('fresh').disabled = working || (!catalog?.project && catalog?.workspaceKind !== 'collector'); $('changes-open').disabled = !catalog?.project;
  const accountReady = catalog?.providers.some(p => p.id === $('provider').value && p.connected);
  $('save-model').disabled = working || (modelMode === 'account' && !accountReady);
  $('test-model').disabled = working || (modelMode === 'account' && !accountReady);
  if (updateState) renderUpdate(updateState);
}
async function run(action, onError = notice) {
  if (localBusy) return;
  localBusy = true; setBusy(busy);
  try { return await action(); } catch (error) { onError(error.message); }
  finally { localBusy = false; setBusy(busy); }
}
function option(value, label) { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; }
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  svg.setAttribute('aria-hidden', 'true'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
}
function element(tag, text, className) {
  const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node;
}
function renderModelPicker() {
  const query = $('model-search').value.trim().toLowerCase(), list = $('model-options'); list.replaceChildren();
  const groups = (catalog?.providers ?? []).filter(p => p.connected).map(p => ({ name: p.name, models: p.models.map(m => ({ ...m, provider: p.id })) }));
  if (catalog?.proxyModels.length) groups.unshift({ name: '中转站 · 已保存', models: catalog.proxyModels.map(m => ({ ...m, id: m.model, name: m.model })) });
  for (const group of groups) {
    const matches = group.models.filter(m => `${group.name} ${m.name} ${m.id}`.toLowerCase().includes(query));
    if (!matches.length) continue;
    list.append(element('p', group.name, 'model-group'));
    for (const model of matches) {
      const selected = catalog.config?.provider === model.provider && catalog.config?.model === model.id;
      const button = element('button', '', 'model-choice idle-only'), label = element('span'); button.type = 'button';
      label.append(element('strong', model.name), element('small', model.baseUrl ? new URL(model.baseUrl).host : model.id));
      button.append(label, selected ? icon('check') : element('span')); button.setAttribute('aria-pressed', String(selected));
      button.onclick = () => run(async () => {
        updateCatalog(await call('selectModel', { provider: model.provider, model: model.id, baseUrl: model.baseUrl }));
        $('model-picker').hidePopover(); $('prompt').focus();
      }, message => { $('picker-feedback').textContent = message; });
      list.append(button);
    }
  }
  if (!list.children.length) list.append(element('p', query ? '没有匹配的模型。可在下方添加中转站模型。' : '先连接一个订阅账户或中转站，模型就会出现在这里。', 'picker-empty'));
  setBusy(busy);
}
$('composer-model').onclick = () => {
  if (busy || localBusy) return;
  if ($('model-picker').matches(':popover-open')) { $('model-picker').hidePopover(); return; }
  $('model-search').value = ''; $('picker-feedback').textContent = '选择后用于下一条消息，模型权限以实际请求为准。';
  renderModelPicker(); $('model-picker').showPopover(); $('model-search').focus();
};
$('model-search').oninput = renderModelPicker;
$('model-picker').onkeydown = event => {
  const buttons = [...$('model-options').querySelectorAll('button:not(:disabled)')];
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); const index = buttons.indexOf(document.activeElement), direction = event.key === 'ArrowDown' ? 1 : -1;
    buttons[(index + direction + buttons.length) % buttons.length]?.focus();
  } else if (event.key === 'Enter' && document.activeElement === $('model-search')) { event.preventDefault(); buttons[0]?.click(); }
};
$('picker-settings').onclick = settingsOpen;
let libraryTab = 'agents', detailAgent;
function renderLibrary() {
  if (!catalog) return;
  $('agents-tab').setAttribute('aria-pressed', libraryTab === 'agents'); $('plugins-tab').setAttribute('aria-pressed', libraryTab === 'plugins');
  $('agents-view').hidden = libraryTab !== 'agents'; $('plugins-view').hidden = libraryTab !== 'plugins';
  $('agent-cards').replaceChildren();
  const selected = catalog.agents.find(a => a.id === detailAgent) || catalog.agents.find(a => a.id === catalog.profile);
  for (const agent of catalog.agents) {
    const button = element('button', '', 'agent-card'), label = element('span');
    label.append(element('strong', agent.shortName), element('small', agent.description)); button.append(icon(agent.icon), label);
    button.setAttribute('aria-pressed', agent.id === selected.id); button.onclick = () => { detailAgent = agent.id; renderLibrary(); };
    $('agent-cards').append(button);
  }
  const detail = $('agent-detail'); detail.replaceChildren(element('span', '内置 Agent', 'detail-eyebrow'), element('h3', selected.name), element('p', selected.description, 'muted'));
  const steps = element('ol', '', 'agent-steps'); selected.steps.forEach(step => steps.append(element('li', step))); detail.append(steps);
  detail.append(element('h4', '交付给你'), element('p', selected.deliverables));
  const use = element('button', selected.id === catalog.profile ? '已设为新任务助手' : '使用这个助手', 'primary idle-only');
  use.onclick = () => run(async () => { updateCatalog(await call('profile', { id: selected.id })); $('library').close(); $('prompt').focus(); });
  detail.append(use, element('p', '选择用于新任务；继续已有任务时，沿用该任务确认过的助手与范围。', 'field-hint'));
  for (const [title, text] of [['查看角色提示词', selected.prompt], ['查看工作流全文', selected.workflow]]) {
    const section = element('details', '', 'prompt-details'), copy = element('button', '复制', 'text-button');
    copy.onclick = async () => { try { await navigator.clipboard.writeText(text); copy.textContent = '已复制'; } catch { copy.textContent = '请选中文字复制'; } };
    section.append(element('summary', title), copy, element('pre', text)); detail.append(section);
  }
  $('plugin-list').replaceChildren();
  for (const plugin of catalog.plugins) {
    const row = element('section', '', 'plugin-row'), heading = element('div', '', 'plugin-row-heading');
    heading.append(element('strong', plugin.name), element('span', plugin.version, 'plugin-version'), element('span', plugin.loaded ? '已加载' : '打开项目后加载', plugin.loaded ? 'plugin-loaded' : 'muted'));
    row.append(heading, element('p', plugin.description));
    if (plugin.loaded) {
      const tools = element('div', '', 'tool-chips');
      if (plugin.tools.length) plugin.tools.forEach(tool => tools.append(element('code', tool)));
      else tools.append(element('span', '通过上下文或事件生效，没有当前可调用的工具。', 'field-hint'));
      row.append(tools);
    }
    const source = element('details', '', 'plugin-source'); source.append(element('summary', '开发入口'), element('code', plugin.path)); row.append(source);
    $('plugin-list').append(row);
  }
  $('index-status').textContent = !catalog.project ? '打开项目后，可以查看插件与代码索引状态。' : catalog.indexed ? '当前项目存在 CodeGraph 索引；索引健康与覆盖范围可在对话中让助手检查。' : '当前项目尚无 CodeGraph 索引。可以告诉助手“为这个项目建立代码索引”。';
  setBusy(busy);
}
async function libraryOpen(tab) {
  libraryTab = tab; detailAgent = catalog?.profile;
  try { updateCatalog(await call('catalog')); renderLibrary(); if (!$('library').open) $('library').showModal(); } catch (error) { notice(error.message); }
}
$('library-open').onclick = () => libraryOpen('agents'); $('composer-plugins').onclick = () => libraryOpen('plugins');
$('library-close').onclick = () => $('library').close();
$('agents-tab').onclick = () => { libraryTab = 'agents'; renderLibrary(); }; $('plugins-tab').onclick = () => { libraryTab = 'plugins'; renderLibrary(); };

function updateWelcome() {
  const ready = connected(), project = catalog?.project;
  welcome.querySelector('.suggestions').hidden = catalog?.workspaceKind === 'collector';
  w('collector-examples').hidden = catalog?.workspaceKind !== 'collector';
  if (catalog?.workspaceKind === 'collector') {
    w('welcome-title').textContent = '你想采集什么数据？';
    w('welcome-description').textContent = '描述目标、提供网址或截图。先核对字段和样例，再决定交付数据、插件或代码。';
    w('setup-steps').hidden = true;
    $('connection-label').textContent = ready ? catalog.config.model : '尚未连接';
    $('connection-dot').classList.toggle('connected', Boolean(ready));
    return;
  }
  w('welcome-title').textContent = ready && project ? '今天想推进什么？' : '把想法交给助手，把决定留给你。';
  w('welcome-description').textContent = project ? `${project.split('/').at(-1)} 已准备好。描述目标，助手会先理解，再与你确认。` : '从接手一个项目开始，一起把它变得更好。';
  w('setup-steps').hidden = Boolean(ready && project);
  w('welcome-setup').classList.toggle('complete', Boolean(ready));
  w('welcome-project').classList.toggle('complete', Boolean(project));
  w('setup-model-detail').textContent = ready ? catalog.config.model : '使用订阅账户或中转站';
  w('setup-project-detail').textContent = project ? project.split('/').at(-1) : '选择电脑上的项目文件夹';
  $('connection-label').textContent = ready ? catalog.config.model : '尚未连接';
  $('connection-dot').classList.toggle('connected', Boolean(ready));
}
function applyProjection(value) {
  if (disconnected || !value || value.epoch < projectEpoch ||
      (value.epoch === projectEpoch && value.revision < projectionRevision)) return false;
  projectEpoch = value.epoch; projectionRevision = value.revision;
  if (catalog) Object.assign(catalog, { workflow: value.workflow, busy: value.busy, epoch: value.epoch, revision: value.revision });
  inspector.update(value.workflow); setBusy(value.busy);
  return true;
}
function updateCatalog(value) {
  if (!applyProjection(value)) return;
  const first = !catalog, previousProvider = $('provider').value, previousModel = $('account-model').value;
  catalog = value;
  $('agent').replaceChildren(...value.agents.map(a => option(a.id, a.shortName)));
  $('agent').value = value.profile;
  $('agent').hidden = value.workspaceKind === 'collector';
  $('collector-role').hidden = value.workspaceKind !== 'collector';
  $('history-heading').textContent = value.workspaceKind === 'collector' ? '采集对话' : '当前项目的对话';
  $('composer-plugins').hidden = value.workspaceKind === 'collector';
  $('progress-toggle').hidden = value.workspaceKind === 'collector';
  $('collection-plan-open').hidden = value.workspaceKind !== 'collector';
  $('changes-open').hidden = value.workspaceKind === 'collector';
  $('session-search').placeholder = value.workspaceKind === 'collector' ? '搜索采集对话' : '搜索当前项目的对话';
  $('session-search').setAttribute('aria-label', $('session-search').placeholder);
  $('agent-description').textContent = value.workspaceKind === 'collector' ? '先核对样例，再选择交付形式；访问网页仍需确认。' : '关键节点由你确认，经验保留在项目。';
  $('agent-count').textContent = value.agents.length;
  $('composer-plugins').textContent = `${value.plugins.filter(p => p.loaded).length}/${value.plugins.length} 插件已加载`;
  if ($('library').open) renderLibrary();
  $('agent').title = value.agents.find(a => a.id === $('agent').value)?.description ?? '';
  $('recent').replaceChildren();
  for (const path of value.recent) {
    const b = document.createElement('button'), name = document.createElement('span'); b.className = 'idle-only';
    b.title = path; name.textContent = path.split('/').at(-1); b.append(icon('folder'), name); b.classList.toggle('selected', path === value.project);
    b.onclick = () => run(async () => updateCatalog(await call('open', { path }))); $('recent').append(b);
  }
  if (!value.recent.length) { const b = document.createElement('button'); b.className = 'idle-only quiet'; b.append(icon('folder'), '打开第一个项目'); b.onclick = choose; $('recent').append(b); }
  renderSessions();
  $('provider').replaceChildren(...value.providers.filter(p => p.models.length).map(p => option(p.id, p.name)));
  $('provider').value = first && value.config?.provider !== 'storm-proxy' && value.config?.provider ? value.config.provider : previousProvider || 'openai-codex';
  if (!$('provider').value) $('provider').selectedIndex = 0;
  updateAccountModels(previousModel);
  $('model-label').textContent = value.config?.model ?? '连接模型';
  if (value.project) { $('project-name').textContent = value.project.split('/').at(-1); $('project-path').textContent = value.project; $('project-path').title = value.project; }
  updateWelcome(); setBusy(value.busy);
}
function renderSessions() {
  $('sessions').replaceChildren();
  const query = $('session-search').value.trim().toLocaleLowerCase();
  for (const session of (catalog?.sessions ?? []).filter(s => s.title.toLocaleLowerCase().includes(query))) {
    const b = document.createElement('button'), name = document.createElement('span'); b.className = 'idle-only'; name.textContent = session.title;
    b.title = `${session.title}\n${new Date(session.modified).toLocaleString('zh-CN')}`; b.classList.toggle('selected', session.active); b.append(name);
    b.onclick = () => run(async () => updateCatalog(await call('resume', { id: session.id }))); $('sessions').append(b);
  }
  if (!$('sessions').children.length) { const p = document.createElement('p'); p.className = 'sidebar-empty'; p.textContent = query ? '没有匹配的对话。' : (catalog?.project || catalog?.workspaceKind === 'collector') ? '从右侧开始，对话会自动保留。' : '选好项目，就可以开始对话。'; $('sessions').append(p); }
  $('sessions').querySelectorAll('button').forEach(button => { button.disabled = busy || localBusy || disconnected; });
}
$('session-search').oninput = renderSessions;
function updateAccountModels(preferred) {
  const p = catalog?.providers.find(p => p.id === $('provider').value);
  $('account-model').replaceChildren(...(p?.models ?? []).map(m => option(m.id, m.name)));
  const saved = preferred || (catalog?.config?.provider === p?.id ? catalog.config.model : null);
  if (saved && p?.models.some(m => m.id === saved)) $('account-model').value = saved;
  $('account-status').textContent = p?.connected ? '已登录 · 可测试模型权限' : '尚未登录';
  $('logout').hidden = !p?.connected;
  $('login-label').textContent = p?.connected ? '重新登录' : '在浏览器中登录';
  $('login-method-row').hidden = p?.id !== 'openai-codex';
  setBusy(busy);
}
function mode(value) {
  modelMode = value; feedback('');
  $('account-fields').hidden = value !== 'account'; $('proxy-fields').hidden = value !== 'proxy';
  $('account-tab').setAttribute('aria-pressed', value === 'account'); $('proxy-tab').setAttribute('aria-pressed', value === 'proxy');
  $('connection-title').textContent = value === 'account' ? '连接你的订阅账户' : '连接中转站或 API';
  $('connection-description').textContent = value === 'account' ? '在浏览器登录，完成后回到这里。' : '使用服务提供的地址、模型名称和密钥。';
  setBusy(busy);
}
function resetAuth() {
  authQuestion = undefined; $('auth-value').value = ''; $('auth-code').textContent = ''; $('auth-code').hidden = true;
  $('auth-links').replaceChildren(); $('auth-manual').hidden = true; $('auth-manual').open = false; $('auth-progress').hidden = true;
}
function settingsOpen() {
  if (busy || localBusy) return;
  const config = catalog?.config;
  const proxy = config?.provider === 'storm-proxy' ? config : catalog?.proxyModels[0];
  if ($('model-picker').matches(':popover-open')) $('model-picker').hidePopover();
  resetAuth();
  if (proxy) {
    $('base-url').value = proxy.baseUrl; $('api').value = proxy.api; $('proxy-model').value = proxy.model;
    $('context-window').value = proxy.contextWindow; $('max-tokens').value = proxy.maxTokens; $('reasoning').checked = proxy.reasoning; $('vision').checked = proxy.vision === true;
  }
  if (config && config.provider !== 'storm-proxy') { $('provider').value = config.provider; updateAccountModels(config.model); }
  $('key').value = ''; $('key').placeholder = catalog?.hasProxyKey ? '已保存；留空保留同地址的密钥' : '粘贴 API 密钥';
  mode(config?.provider === 'storm-proxy' ? 'proxy' : 'account'); $('settings').showModal();
}
async function settingsClose() {
  if (loggingIn || testing) await call('stop').catch(error => notice(error.message));
  $('key').value = ''; resetAuth(); $('settings').close();
}
$('settings-open').onclick = settingsOpen; w('welcome-setup').onclick = settingsOpen;
$('settings-close').onclick = settingsClose;
$('settings').addEventListener('cancel', e => { e.preventDefault(); settingsClose(); });
$('account-tab').onclick = () => mode('account'); $('proxy-tab').onclick = () => mode('proxy');
$('provider').onchange = () => { resetAuth(); feedback(''); updateAccountModels(); };
function modelData() {
  return modelMode === 'account' ? { provider: $('provider').value, model: $('account-model').value } : {
    provider: 'storm-proxy', model: $('proxy-model').value, baseUrl: $('base-url').value, api: $('api').value, key: $('key').value,
    contextWindow: $('context-window').value, maxTokens: $('max-tokens').value, reasoning: $('reasoning').checked, vision: $('vision').checked,
  };
}
async function saveModel() { updateCatalog(await call('saveModel', modelData())); $('key').value = ''; }
$('model-form').onsubmit = event => {
  event.preventDefault(); if (loggingIn || testing) return;
  run(async () => { await saveModel(); $('settings').close(); $('prompt').focus(); }, feedback);
};
$('login').onclick = () => run(async () => {
  const provider = $('provider').value, model = $('account-model').value, method = $('login-method').value;
  loggingIn = true; feedback(''); resetAuth(); setBusy(busy);
  $('auth-progress').hidden = false; $('auth-title').textContent = '正在打开登录'; $('auth-description').textContent = '即将打开系统浏览器，请在浏览器中完成授权。';
  try {
    updateCatalog(await call('login', { provider, method }));
    updateCatalog(await call('saveModel', { provider, model }));
    feedback('登录成功，已使用所选模型。可以关闭设置开始工作。', 'success');
  } finally { loggingIn = false; resetAuth(); setBusy(busy); }
}, feedback);
$('logout').onclick = () => run(async () => { updateCatalog(await call('logout', { provider: $('provider').value })); feedback('已退出此账户。', 'info'); }, feedback);
$('test-model').onclick = () => run(async () => {
  testing = true; setBusy(busy);
  try { await saveModel(); feedback('正在发送简短测试请求…', 'info'); feedback((await call('testModel')).message, 'success'); }
  finally { testing = false; setBusy(busy); }
}, feedback);
const stop = () => { if (activeQuestion) finishQuestion(undefined); return call('stop').catch(error => notice(error.message)); };
$('stop').onclick = stop; $('cancel-operation').onclick = stop; $('cancel-test').onclick = stop;
function choose() { return run(async () => updateCatalog(await call('choose'))); }
$('choose').onclick = choose; w('welcome-project').onclick = choose;
$('collect').onclick = () => run(async () => { updateCatalog(await call('collect')); $('prompt').focus(); });
$('collection-plan-open').onclick = () => run(async () => {
  const value = await call('catalog'); updateCatalog(value);
  if (!value.collectionPlan) { notice('尚无采集方案，请让助手整理字段、样例和交付方向。'); return; }
  $('collection-plan-title').textContent = value.collectionData ? value.collectionRecipe ? '已核对当前范围全部页 · 非全站快照' : '已采集当前页 · 不代表全站完整' : value.collectionPlan.status === 'confirmed' ? '已确认需求 · 数据尚未验证' : '未确认的采集方案';
  $('collection-plan-text').textContent = '需求确认记录（不是运行结论）：\n' + value.collectionPlan.text;
  const result = value.collectionData;
  $('collection-plan-view').dataset.digest = result?.digest || '';
  $('collection-result').textContent = result ? `${result.count}条${value.collectionRecipe ? '范围内' : '当前页'}记录 · ${result.capturedAt}\n${value.collectionRecipe ? '' : '表头与已确认样例匹配。'}${result.warning}\n前5条预览：\n` + result.preview.map(row=>row.map((cell,i)=>`${result.columns[i]}=${JSON.stringify(cell)}`).join('；')).join('\n') : '尚无与当前方案匹配的采集结果。';
  if (value.collectionPlan.format === 'chrome-extension') $('collection-result').textContent += '\n插件含来源、字段和业务样例，请勿公开分享。这里只核验了桌面数据，插件仍需在你的Chrome中手动加载、运行并核对；不会自动安装。';
  $('collection-plan-view').showModal();
});
$('collection-plan-close').onclick = () => $('collection-plan-view').close();
$('collection-rerun').onclick = () => run(async () => {
  if ($('prompt').value.trim() || draftImage || loadingImage) throw new Error('请先处理未发送的文字或截图，原草稿已保留。');
  $('collection-plan-view').close();
  try { await call('prompt', {text:'请实际运行已保存的全量采集方案，使用storm_collection_autonomous的run。不要复用旧结果或再次询问已有字段；日期沿用本次页面当前筛选并明确展示。'}); }
  finally { updateCatalog(await call('catalog')); }
});
for (const format of ['csv','json','extension']) $('collection-' + format).onclick = () => run(async () => {
  const result = await call('collectionExport', {format:format === 'extension' ? 'chrome-extension' : format, digest:$('collection-plan-view').dataset.digest});
  $('collection-result').textContent = result.saved ? `已导出${result.fileName}。` + (format === 'extension' ? '请按文件夹内README加载插件并实际核对；含业务样例，勿公开分享。未自动安装。' : catalog?.collectionRecipe ? '仅覆盖已确认页面和本次筛选，详见结果中的核对说明。' : '仅当前页快照，不代表全站完整性。') : '已取消导出，未写入文件。';
}, message => { $('collection-result').textContent = message; });
$('agent').onchange = () => run(async () => updateCatalog(await call('profile', { id: $('agent').value })), message => { $('agent').value = catalog.profile; notice(message); });
$('notice-close').onclick = () => notice('');
$('fresh').onclick = () => run(async () => { updateCatalog(await call('fresh')); $('prompt').focus(); });
$('composer').onsubmit = event => {
  event.preventDefault(); if (busy || localBusy) return;
  const text = $('prompt').value.trim(), image = draftImage;
  if (loadingImage) { notice('请等待截图预览完成再发送。'); return; }
  if (!text && !image) return;
  if (image && !catalog?.supportsImages) { notice('当前模型未声明支持图片，请选择视觉模型或在中转站设置中核对图片能力。'); return; }
  if (!connected()) { settingsOpen(); return; }
  if (!catalog?.project && catalog?.workspaceKind !== 'collector') { notice(image ? '请先打开项目；文字会保留，选好后请重新添加截图。' : '先打开要协作的项目。你的消息会保留，选好项目后即可发送。'); choose(); return; }
  notice(''); $('activity').textContent = '正在发送…'; stickToBottom = true;
  run(async () => {
    $('prompt').value = '';
    try { await call('prompt', { text, ...(image ? {image} : {}) }); if (draftImage === image) setImage(undefined); }
    catch (error) { if (!$('prompt').value) $('prompt').value = text; throw error; }
    finally { updateCatalog(await call('catalog')); }
  });
};
$('prompt').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('composer').requestSubmit(); } });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.isComposing && activeQuestion?.workflow && !document.querySelector('dialog[open], :popover-open')) { event.preventDefault(); finishQuestion(undefined); return; }
  if (!(event.metaKey || event.ctrlKey) || event.isComposing) return;
  if (event.key === ',' && !$('question').open) { event.preventDefault(); settingsOpen(); }
  if (event.key.toLowerCase() === 'n' && !document.querySelector('dialog[open]') && !$('fresh').disabled) { event.preventDefault(); $('fresh').click(); }
});
welcome.querySelectorAll('[data-prompt]').forEach(button => button.onclick = () => { $('prompt').value = button.dataset.prompt; $('prompt').focus(); });
$('messages').onscroll = () => { const el = $('messages'); stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90; };
function scrollToLatest() { if (stickToBottom) $('messages').scrollTop = $('messages').scrollHeight; }
function renderHistory(event) {
  const oldScroll = $('messages').scrollTop;
  thread.history(event);
  if (!event.messages.length) updateWelcome();
  if (stickToBottom) scrollToLatest(); else $('messages').scrollTop = oldScroll;
}
function showQuestion() {
  if (activeQuestion || !questionQueue.length) return;
  activeQuestion = questionQueue.shift(); const q = activeQuestion;
  if (q.workflow) { inspector.question(q); return; }
  $('question-title').textContent = q.title; $('question-body').textContent = q.message ?? '';
  $('question-value').hidden = !['text', 'secret'].includes(q.kind); $('question-options').hidden = q.kind !== 'select';
  $('question-value').type = q.kind === 'secret' ? 'password' : 'text'; $('question-value').value = q.value ?? ''; $('question-value').placeholder = q.placeholder ?? '';
  $('question-options').replaceChildren(...(q.options ?? []).map(o => option(o.id, o.label)));
  $('question-submit').textContent = q.kind === 'confirm' ? '确认并继续' : '提交';
  $('question').showModal();
  (q.kind === 'confirm' ? $('question-cancel') : q.kind === 'select' ? $('question-options') : $('question-value')).focus();
}
function finishQuestion(value) {
  const q = activeQuestion; if (!q) return;
  activeQuestion = undefined; inspector.question(null); $('question-value').value = ''; $('question').close();
  call('answer', { id: q.id, value }).catch(error => notice(error.message));
  if (q.workflow) $('prompt').focus();
  showQuestion();
}
$('question-form').onsubmit = e => { e.preventDefault(); const q = activeQuestion; if (q) finishQuestion(q.kind === 'confirm' ? true : q.kind === 'select' ? $('question-options').value : $('question-value').value); };
$('question-cancel').onclick = () => finishQuestion(undefined);
$('question').addEventListener('cancel', e => { e.preventDefault(); finishQuestion(undefined); });
function authPrompt(q) {
  authQuestion = q; const manual = q.promptType === 'manual_code';
  $('auth-progress').hidden = false; $('auth-manual').hidden = false; $('auth-manual').open = !manual;
  $('auth-manual-summary').textContent = manual ? '浏览器已完成，但这里没有反应？' : '完成服务要求的这一步';
  $('auth-help').textContent = manual ? '复制浏览器完成授权后的完整地址（通常以 http://localhost 开头），粘贴到下方。正常登录无需填写。' : q.title;
  $('auth-title').textContent = manual ? '等待浏览器完成授权' : '登录还需要一些信息';
  $('auth-description').textContent = manual ? '完成浏览器授权后会自动继续。你不需要自己填写 URL。' : '请完成下方步骤，随后继续登录。';
  $('auth-value').type = q.kind === 'secret' ? 'password' : 'text'; $('auth-value').value = ''; $('auth-value').placeholder = q.placeholder || '填写服务要求的信息';
  $('auth-value').hidden = q.kind === 'select'; $('auth-options').hidden = q.kind !== 'select';
  $('auth-input-label').htmlFor = q.kind === 'select' ? 'auth-options' : 'auth-value';
  $('auth-input-label').textContent = manual ? '回调地址或授权码' : '你的回答';
  $('auth-options').replaceChildren(...(q.options ?? []).map(o => option(o.id, o.label)));
  $('auth-submit').textContent = manual ? '提交授权结果' : '继续登录';
}
async function submitAuth() {
  const q = authQuestion; if (!q) return;
  const value = q.kind === 'select' ? $('auth-options').value : $('auth-value').value.trim();
  if (!value) { feedback('请先填写授权结果，或继续在浏览器完成登录。'); return; }
  try { await call('answer', { id: q.id, value }); $('auth-value').value = ''; feedback(''); }
  catch (error) { feedback(error.message); }
}
$('auth-submit').onclick = submitAuth;
$('auth-value').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submitAuth(); } };
function authEvent(a) {
  $('auth-progress').hidden = false;
  if (a.type === 'device_code') {
    $('auth-title').textContent = '在浏览器输入设备码'; $('auth-description').textContent = `请在授权页面输入下方代码，应用会自动等待结果。${a.expiresInSeconds ? `有效期约 ${Math.ceil(a.expiresInSeconds / 60)} 分钟。` : ''}`;
    $('auth-code').textContent = a.userCode; $('auth-code').hidden = false;
  } else if (a.type === 'auth_url') {
    $('auth-title').textContent = '等待浏览器完成授权'; $('auth-description').textContent = '正在打开系统浏览器。完成授权后会自动返回，无需填写 URL。';
  } else if (a.message) $('auth-description').textContent = a.message;
  const urls = [a.url, a.verificationUri, ...(a.links ?? []).map(l => l.url)].filter(Boolean);
  for (const url of urls) {
    const b = document.createElement('button'); b.type = 'button'; b.append('打开授权页面', icon('link'));
    b.onclick = () => call('external', { url }).catch(error => feedback(error.message)); $('auth-links').append(b);
  }
}
function updateProgress() {
  $('plugin-status').textContent = [...statuses.values()].filter(Boolean).join('\n') || '暂无额外状态';
}
api.onEvent(event => {
  if (disconnected && !['update', 'open-updates', 'fatal'].includes(event.type)) return;
  if (event.epoch !== undefined && event.epoch < projectEpoch) return;
  if (['workflow', 'busy'].includes(event.type) && !applyProjection(event)) return;
  if (event.type === 'update') renderUpdate(event.state);
  if (event.type === 'open-updates') updatesOpen();
  if (event.type === 'project') {
    imageEpoch++; setImage(undefined);
    $('collection-plan-view').close(); delete $('collection-plan-view').dataset.digest; $('collection-plan-text').textContent = ''; $('collection-result').textContent = '';
    projectEpoch = event.epoch; projectionRevision = -1; statuses.clear(); inspector.reset(); updateProgress(); stickToBottom = true;
    questionQueue.length = 0; activeQuestion = undefined; $('question').close(); $('question-value').value = '';
    $('session-search').value = ''; thread.reset();
    $('project-name').textContent = event.name; $('project-path').textContent = event.path; $('project-path').title = event.path;
    notice(''); $('activity').textContent = event.workspaceKind === 'collector' ? '采集对话已准备好，请描述目标' : '项目已打开，准备就绪';
  }
  if (event.type === 'history') renderHistory(event);
  if (['message', 'stream', 'message-end'].includes(event.type)) { thread.upsert(event.message); scrollToLatest(); }
  if (event.type === 'busy') { setBusy(event.busy); if (!event.busy) thread.settle(); $('activity').textContent = event.busy ? '助手正在工作…' : '本轮处理已结束，请结合结果与检查判断'; }
  if (event.type === 'working') $('activity').textContent = event.text;
  if (event.type === 'tool') { thread.tool(event); $('activity').textContent = `${event.state === 'running' ? '正在执行' : event.state === 'error' ? '执行遇到问题' : '已完成'} · ${event.name}`; }
  if (event.type === 'notice' && event.level === 'info') { statuses.set('notification', event.message); updateProgress(); }
  else if (event.type === 'notice' || event.type === 'fatal') {
    notice(event.message);
    if (event.type === 'fatal') { disconnected = true; if (catalog) { catalog.workflow = { error: event.message }; catalog.busy = false; } questionQueue.length = 0; activeQuestion = undefined; $('question').close(); inspector.question(null); inspector.update({ error: event.message }); setBusy(false); thread.settle(); }
  }
  if (event.type === 'editor') { $('prompt').value = event.text; $('prompt').focus(); }
  if (event.type === 'widget' && event.key !== 'mediastorm') { statuses.set(event.key, event.lines.join('\n')); updateProgress(); }
  if (event.type === 'status') { statuses.set(event.key, event.text); updateProgress(); }
  if (event.type === 'question') { if (event.source === 'auth') authPrompt(event); else { questionQueue.push(event); showQuestion(); } }
  if (event.type === 'dismiss') {
    if (authQuestion?.id === event.id) { authQuestion = undefined; $('auth-value').value = ''; $('auth-manual').hidden = true; $('auth-title').textContent = '正在验证授权结果'; }
    const i = questionQueue.findIndex(q => q.id === event.id); if (i >= 0) questionQueue.splice(i, 1);
    if (activeQuestion?.id === event.id) { const workflow = activeQuestion.workflow; activeQuestion = undefined; inspector.question(null); $('question-value').value = ''; $('question').close(); if (workflow) $('prompt').focus(); showQuestion(); }
  }
  if (event.type === 'auth') authEvent(event.event);
  if (event.type === 'auth-browser-error') feedback(event.message);
});
await call('updateStatus').then(renderUpdate).catch(error => notice(error.message));
await run(async () => updateCatalog(await call('catalog')));
