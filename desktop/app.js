import { renderMarkdown } from './markdown.mjs';
const $ = id => document.getElementById(id);
const api = window.storm, welcome = $('welcome');
const w = id => welcome.querySelector(`#${id}`);
let catalog, busy = false, modelMode = 'account', activeQuestion, localBusy = false, lastMessage, authQuestion, loggingIn = false, testing = false, stickToBottom = true;
const questionQueue = [], widgets = new Map(), statuses = new Map();
const call = (action, data) => api.invoke(action, data).catch(error => { throw new Error(error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); });
const connected = () => catalog?.config && (catalog.config.provider === 'storm-proxy' ? catalog.hasProxyKey : catalog.providers.some(p => p.id === catalog.config.provider && p.connected));
let updateState;
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
  if ($('prompt').value.trim()) { $('update-message').textContent = '输入框里还有未发送的内容，请先发送或保存，再重启安装。'; return; }
  try { renderUpdate(await call('installUpdate')); } catch (error) { $('update-message').textContent = error.message; }
};
$('release-page').onclick = () => call('releasePage').catch(error => { $('update-message').textContent = error.message; });
function notice(message) { $('notice-text').textContent = message; $('notice').hidden = !message; }
function feedback(message, tone = 'error') { $('model-feedback').textContent = message; $('model-feedback').dataset.tone = tone; $('model-feedback').hidden = !message; }
function setBusy(value) {
  busy = value; const working = value || localBusy;
  document.querySelectorAll('.idle-only').forEach(control => control.disabled = working);
  $('stop').hidden = !working || loggingIn || testing; $('send').hidden = working;
  $('cancel-test').hidden = !testing;
  $('fresh').disabled = working || !catalog?.project; $('changes-open').disabled = working || !catalog?.project;
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
function updateWelcome() {
  const ready = connected(), project = catalog?.project;
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
function updateCatalog(value) {
  if (!value) return;
  const first = !catalog, currentAgent = $('agent').value, previousProvider = $('provider').value, previousModel = $('account-model').value;
  catalog = value;
  $('agent').replaceChildren(...value.agents.map(a => option(a.id, a.id === 'project-takeover' ? '项目接手与优化' : '需求开发')));
  if (currentAgent) $('agent').value = currentAgent;
  $('agent').title = value.agents.find(a => a.id === $('agent').value)?.description ?? '';
  $('recent').replaceChildren();
  for (const path of value.recent) {
    const b = document.createElement('button'), name = document.createElement('span'); b.className = 'idle-only';
    b.title = path; name.textContent = path.split('/').at(-1); b.append(icon('folder'), name); b.classList.toggle('selected', path === value.project);
    b.onclick = () => run(async () => updateCatalog(await call('open', { path }))); $('recent').append(b);
  }
  if (!value.recent.length) { const b = document.createElement('button'); b.className = 'idle-only quiet'; b.append(icon('folder'), '打开第一个项目'); b.onclick = choose; $('recent').append(b); }
  $('sessions').replaceChildren();
  for (const session of value.sessions ?? []) {
    const b = document.createElement('button'), name = document.createElement('span'); b.className = 'idle-only'; name.textContent = session.title;
    b.title = `${session.title}\n${new Date(session.modified).toLocaleString('zh-CN')}`; b.classList.toggle('selected', session.active); b.append(name);
    b.onclick = () => run(async () => updateCatalog(await call('resume', { id: session.id }))); $('sessions').append(b);
  }
  if (!$('sessions').children.length) { const p = document.createElement('p'); p.className = 'sidebar-empty'; p.textContent = value.project ? '从右侧开始，对话会自动保留。' : '选好项目，就可以开始对话。'; $('sessions').append(p); }
  $('provider').replaceChildren(...value.providers.filter(p => p.models.length).map(p => option(p.id, p.name)));
  $('provider').value = first && value.config?.provider !== 'storm-proxy' && value.config?.provider ? value.config.provider : previousProvider || 'openai-codex';
  if (!$('provider').value) $('provider').selectedIndex = 0;
  updateAccountModels(previousModel);
  $('model-label').textContent = value.config?.model ?? '连接模型';
  if (value.project) { $('project-name').textContent = value.project.split('/').at(-1); $('project-path').textContent = value.project; $('project-path').title = value.project; }
  updateWelcome(); setBusy(value.busy);
}
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
  resetAuth();
  if (config?.provider === 'storm-proxy') {
    $('base-url').value = config.baseUrl; $('api').value = config.api; $('proxy-model').value = config.model;
    $('context-window').value = config.contextWindow; $('max-tokens').value = config.maxTokens; $('reasoning').checked = config.reasoning;
  } else if (config) { $('provider').value = config.provider; updateAccountModels(config.model); }
  $('key').value = ''; $('key').placeholder = catalog?.hasProxyKey ? '已保存；留空保留同地址的密钥' : '粘贴 API 密钥';
  mode(config?.provider === 'storm-proxy' ? 'proxy' : 'account'); $('settings').showModal();
}
async function settingsClose() {
  if (loggingIn || testing) await call('stop').catch(error => notice(error.message));
  $('key').value = ''; resetAuth(); $('settings').close();
}
$('settings-open').onclick = settingsOpen; $('composer-model').onclick = settingsOpen; w('welcome-setup').onclick = settingsOpen;
$('settings-close').onclick = settingsClose;
$('settings').addEventListener('cancel', e => { e.preventDefault(); settingsClose(); });
$('account-tab').onclick = () => mode('account'); $('proxy-tab').onclick = () => mode('proxy');
$('provider').onchange = () => { resetAuth(); feedback(''); updateAccountModels(); };
function modelData() {
  return modelMode === 'account' ? { provider: $('provider').value, model: $('account-model').value } : {
    provider: 'storm-proxy', model: $('proxy-model').value, baseUrl: $('base-url').value, api: $('api').value, key: $('key').value,
    contextWindow: $('context-window').value, maxTokens: $('max-tokens').value, reasoning: $('reasoning').checked,
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
const stop = () => call('stop').catch(error => notice(error.message));
$('stop').onclick = stop; $('cancel-operation').onclick = stop; $('cancel-test').onclick = stop;
function choose() { return run(async () => updateCatalog(await call('choose'))); }
$('choose').onclick = choose; w('welcome-project').onclick = choose;
$('agent').onchange = () => run(async () => { await call('profile', { id: $('agent').value }); $('agent').title = catalog.agents.find(a => a.id === $('agent').value).description; });
$('changes-open').onclick = () => run(async () => { $('changes-body').textContent = (await call('changes')).text; $('changes').showModal(); });
$('changes-close').onclick = () => $('changes').close();
function toggleProgress(open) { $('progress-panel').hidden = !open; $('progress-toggle').setAttribute('aria-expanded', String(open)); }
$('progress-toggle').onclick = () => toggleProgress($('progress-panel').hidden); $('progress-close').onclick = () => toggleProgress(false);
$('notice-close').onclick = () => notice('');
$('fresh').onclick = () => run(async () => { updateCatalog(await call('fresh')); $('prompt').focus(); });
$('composer').onsubmit = event => {
  event.preventDefault(); if (busy || localBusy) return;
  const text = $('prompt').value.trim(); if (!text) return;
  if (!connected()) { settingsOpen(); return; }
  if (!catalog?.project) { notice('先打开要协作的项目。你的消息会保留，选好项目后即可发送。'); choose(); return; }
  notice(''); $('activity').textContent = '正在发送…'; stickToBottom = true;
  run(async () => {
    $('prompt').value = '';
    try { await call('prompt', { text }); }
    catch (error) { if (!$('prompt').value) $('prompt').value = text; throw error; }
    finally { updateCatalog(await call('catalog')); }
  });
};
$('prompt').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('composer').requestSubmit(); } });
document.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.isComposing) return;
  if (event.key === ',' && !$('question').open) { event.preventDefault(); settingsOpen(); }
  if (event.key.toLowerCase() === 'n' && !document.querySelector('dialog[open]') && !$('fresh').disabled) { event.preventDefault(); $('fresh').click(); }
});
welcome.querySelectorAll('[data-prompt]').forEach(button => button.onclick = () => { $('prompt').value = button.dataset.prompt; $('prompt').focus(); });
function appendMessage(message) {
  welcome.remove();
  const div = document.createElement('article'); div.className = `message ${message.role}`;
  if (message.role === 'toolResult') {
    const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
    summary.textContent = `${message.isError ? '执行遇到问题' : '执行完成'} · ${message.toolName}`;
    pre.textContent = message.text.length > 8000 ? `${message.text.slice(0, 8000)}\n…界面省略后续输出，完整结果保留在会话记录。` : message.text;
    details.append(summary, pre); div.append(details);
  } else {
    const speaker = document.createElement('div'); speaker.className = 'speaker'; speaker.textContent = message.role === 'user' ? '你' : 'MediaStorm';
    const text = document.createElement('div'); text.className = `text ${message.role === 'assistant' ? 'markdown' : ''}`;
    if (message.role === 'assistant') renderMarkdown(text, message.text); else text.textContent = message.text;
    const error = document.createElement('div'); error.className = 'error'; error.textContent = message.error ?? '';
    div.append(speaker, text, error);
  }
  $('messages').append(div); lastMessage = div; return div;
}
$('messages').onscroll = () => { const el = $('messages'); stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90; };
function scrollToLatest() { if (stickToBottom) $('messages').scrollTop = $('messages').scrollHeight; }
function renderHistory(event) {
  const oldScroll = $('messages').scrollTop;
  $('messages').replaceChildren(); lastMessage = undefined;
  if (!event.messages.length) { $('messages').append(welcome); updateWelcome(); return; }
  if (event.omitted) { const note = document.createElement('p'); note.className = 'small muted'; note.textContent = `显示最近 200 条消息，更早的 ${event.omitted} 条仍保留在本机会话文件。`; $('messages').append(note); }
  event.messages.filter(m => m.text || m.error).forEach(appendMessage);
  if (stickToBottom) scrollToLatest(); else $('messages').scrollTop = oldScroll;
}
function showQuestion() {
  if (activeQuestion || !questionQueue.length) return;
  activeQuestion = questionQueue.shift(); const q = activeQuestion;
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
  activeQuestion = undefined; $('question-value').value = ''; $('question').close();
  call('answer', { id: q.id, value }).catch(error => notice(error.message)); showQuestion();
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
  const lines = widgets.get('mediastorm') ?? [];
  $('task-title').textContent = lines.find(l => l.startsWith('任务：'))?.slice(3) ?? '从一个具体目标开始';
  $('progress-summary').textContent = lines.find(l => l.startsWith('当前工作：'))?.slice(5) ?? '助手会先了解项目，再与你确认本轮目标。';
  $('progress-next').textContent = lines.find(l => l.startsWith('下一步：'))?.slice(4) ?? '描述你想改善的地方。';
  const phase = lines.find(l => l.startsWith('阶段：')) ?? '';
  const index = phase.includes('澄清') ? 0 : phase.includes('方案') || phase.includes('批准') ? 1 : phase.includes('实现') || phase.includes('检查') ? 2 : phase.includes('验收') || phase.includes('完成') ? 3 : -1;
  [...$('phases').children].forEach((li, i) => { li.classList.toggle('active', i === index); li.classList.toggle('done', i < index || phase.includes('完成')); });
  $('phase-label').textContent = phase.includes('完成') ? '任务已完成' : index < 0 ? '任务进度' : ['理解与澄清', '等待确认方案', '实现与检查', '交付与验收'][index];
  $('plugin-status').textContent = [...statuses.values()].filter(Boolean).join('\n') || '暂无额外状态';
}
api.onEvent(event => {
  if (event.type === 'update') renderUpdate(event.state);
  if (event.type === 'open-updates') updatesOpen();
  if (event.type === 'project') {
    widgets.clear(); statuses.clear(); updateProgress(); stickToBottom = true;
    $('messages').replaceChildren(welcome); lastMessage = undefined;
    $('project-name').textContent = event.name; $('project-path').textContent = event.path; $('project-path').title = event.path;
    notice(''); $('activity').textContent = '项目已打开，准备就绪';
  }
  if (event.type === 'history') renderHistory(event);
  if (event.type === 'message') { appendMessage(event.message); scrollToLatest(); }
  if (event.type === 'stream' || event.type === 'message-end') {
    if (lastMessage?.classList.contains(event.message.role) && event.message.role === 'assistant') {
      renderMarkdown(lastMessage.querySelector('.text'), event.message.text); lastMessage.querySelector('.error').textContent = event.message.error ?? ''; scrollToLatest();
    }
  }
  if (event.type === 'busy') { setBusy(event.busy); $('activity').textContent = event.busy ? '助手正在工作…' : '本轮回复已完成'; }
  if (event.type === 'working') $('activity').textContent = event.text;
  if (event.type === 'tool') $('activity').textContent = `${event.state === 'running' ? '正在执行' : event.state === 'error' ? '执行遇到问题' : '已完成'} · ${event.name}`;
  if (event.type === 'notice' && event.level === 'info') { statuses.set('notification', event.message); updateProgress(); }
  else if (event.type === 'notice' || event.type === 'fatal') notice(event.message);
  if (event.type === 'editor') { $('prompt').value = event.text; $('prompt').focus(); }
  if (event.type === 'widget') { widgets.set(event.key, event.lines); updateProgress(); }
  if (event.type === 'status') { statuses.set(event.key, event.text); updateProgress(); }
  if (event.type === 'question') { if (event.source === 'auth') authPrompt(event); else { questionQueue.push(event); showQuestion(); } }
  if (event.type === 'dismiss') {
    if (authQuestion?.id === event.id) { authQuestion = undefined; $('auth-value').value = ''; $('auth-manual').hidden = true; $('auth-title').textContent = '正在验证授权结果'; }
    const i = questionQueue.findIndex(q => q.id === event.id); if (i >= 0) questionQueue.splice(i, 1);
    if (activeQuestion?.id === event.id) { activeQuestion = undefined; $('question-value').value = ''; $('question').close(); showQuestion(); }
  }
  if (event.type === 'auth') authEvent(event.event);
  if (event.type === 'auth-browser-error') feedback(event.message);
});
await call('updateStatus').then(renderUpdate).catch(error => notice(error.message));
await run(async () => updateCatalog(await call('catalog')));
