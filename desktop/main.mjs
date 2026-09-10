import { app, autoUpdater, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron';
import { fork, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { atomicWrite } from './store.mjs';
import { attachUpdates } from './updates.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
app.setName('MediaStorm Agent');
if (process.env.STORM_TEST_DATA && !app.isPackaged) app.setPath('userData', process.env.STORM_TEST_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window, child, running = false, operation = false, quitting = false, loggingIn = false;
  const requests = new Map(), questions = new Map(), authLinks = new Set();
  const send = event => { if (window && !window.isDestroyed()) window.webContents.send('storm:event', event); };
  const request = (action, data = {}) => new Promise((resolve, reject) => {
    if (!child?.connected) { reject(new Error('助手进程未启动，请退出应用后重新打开。')); return; }
    const id = randomUUID(); requests.set(id, { resolve, reject }); child.send({ id, action, data });
  });
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const updates = attachUpdates(autoUpdater, {
    version: app.getVersion(),
    unavailable: !app.isPackaged ? '当前是开发版本。应用内更新在正式安装版中提供。' :
      manifest.releaseChannel !== 'stable' ? '当前是本机试用包。请安装正式发布版以启用应用内更新。' :
      process.platform !== 'darwin' || process.arch !== 'arm64' ? '当前系统暂不支持应用内更新。' :
      !app.isInApplicationsFolder() ? '请先把应用移入 Applications，再重新打开以使用更新。' : '',
    publish: state => send({ type: 'update', state }),
    isBusy: () => operation || running || questions.size > 0 || quitting,
    restart: async () => {
      operation = true;
      try {
        const answer = await dialog.showMessageBox(window, { type: 'question', title: '重启并安装更新',
          message: '现在重启 MediaStorm Agent？', detail: '登录、项目和已保存的对话会保留。未发送的输入请先保存。',
          buttons: ['稍后', '重启并安装'], defaultId: 0, cancelId: 0 });
        if (answer.response !== 1) return false;
        if (child?.connected) {
          let timer;
          try { await Promise.race([request('close'), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('助手尚未安全退出，请稍后重试。')), 15000); })]); }
          finally { clearTimeout(timer); }
        }
        quitting = true;
        try { autoUpdater.quitAndInstall(); }
        catch (error) { quitting = false; throw error; }
        return true;
      } finally { operation = false; }
    },
  });
  const dataDir = app.getPath('userData'); mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const secretFile = join(dataDir, 'credentials.enc');
  const runtime = join(root, 'runtime');
  const env = { HOME: app.getPath('home'), TMPDIR: app.getPath('temp'), LANG: 'zh_CN.UTF-8',
    PATH: [join(runtime, 'bin'), join(runtime, 'node/bin'), join(runtime, 'python/bin'), join(root, 'node_modules/dugite/git/bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin', '/opt/homebrew/bin', '/usr/local/bin'].join(':'),
    GIT_EXEC_PATH: join(root, 'node_modules/dugite/git/libexec/git-core'),
    STORM_USER_DATA: dataDir, PI_CODING_AGENT_DIR: join(dataDir, 'pi'), NODE_USE_SYSTEM_CA: '1' };
  const node = join(runtime, 'node/bin/node');
  let bootError;
  const boot = new Promise((resolveBoot, rejectBoot) => {
    for (const [cmd, args] of [[node, ['--version']], ['python3', ['--version']], ['git', ['--version']], ['codegraph', ['--version']]]) {
      const check = spawnSync(cmd, args, { env, encoding: 'utf8', timeout: 15000 });
      if (check.status !== 0) { rejectBoot(new Error(`运行时不可用：${cmd}。请重新安装完整应用。${check.error?.message ?? check.stderr ?? ''}`)); return; }
    }
    child = fork(join(root, 'desktop/worker.mjs'), [], { execPath: node, cwd: dataDir, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let startupLog = '';
    child.stderr.on('data', bytes => { startupLog = (startupLog + bytes).slice(-3000); });
    child.stdout.on('data', () => {});
    child.on('message', async event => {
      if (event.type === 'ready') { resolveBoot(); return; }
      if (event.type === 'credentials') {
        try {
          if (event.action === 'read' && !existsSync(secretFile)) { child.send({ reply: event.id, value: {} }); return; }
          if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Mac 钥匙串暂不可用，无法保存登录信息。');
          if (event.action === 'write') {
            atomicWrite(secretFile, await safeStorage.encryptStringAsync(JSON.stringify(event.data)));
            child.send({ reply: event.id, value: true });
          } else {
            const result = existsSync(secretFile) ? await safeStorage.decryptStringAsync(readFileSync(secretFile)) : null;
            if (result?.shouldReEncrypt) atomicWrite(secretFile, await safeStorage.encryptStringAsync(result.result));
            child.send({ reply: event.id, value: result ? JSON.parse(result.result) : {} });
          }
        } catch { child?.connected && child.send({ reply: event.id, error: '无法读取或保存 Mac 钥匙串保护的登录信息，原文件已保留。请检查钥匙串权限。' }); }
        return;
      }
      if (event.type === 'response') {
        const pending = requests.get(event.id); requests.delete(event.id);
        event.error ? pending?.reject(new Error(event.error)) : pending?.resolve(event.value); return;
      }
      if (event.type === 'question') questions.set(event.id, event);
      if (event.type === 'dismiss') questions.delete(event.id);
      if (event.type === 'busy') running = event.busy;
      if (event.type === 'auth' && loggingIn) {
        const a = event.event;
        for (const url of [a.url, a.verificationUri, ...(a.links ?? []).map(l => l.url)].filter(Boolean)) {
          try { const parsed = new URL(url); if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) authLinks.add(url); } catch { /* Invalid links never leave the app. */ }
        }
        send(event);
        const url = a.type === 'auth_url' ? a.url : a.type === 'device_code' ? a.verificationUri : undefined;
        if (authLinks.has(url)) shell.openExternal(url).catch(() => send({ type: 'auth-browser-error', message: '浏览器未能自动打开，请点击“打开授权页面”重试。' }));
        return;
      }
      send(event);
    });
    child.on('error', error => rejectBoot(error));
    child.on('exit', code => {
      const error = new Error(`助手进程已退出（${code}）。${startupLog}`);
      rejectBoot(error);
      for (const r of requests.values()) r.reject(error); requests.clear(); questions.clear(); running = false;
      if (!quitting) send({ type: 'fatal', message: '助手进程已退出，请重新打开应用。项目文件与已保存记录仍在原目录。' });
    });
  }).catch(error => { bootError = error; });
  function createWindow() {
    window = new BrowserWindow({ width: 1240, height: 840, minWidth: 880, minHeight: 600, title: 'MediaStorm Agent',
      titleBarStyle: 'hiddenInset', backgroundColor: '#f8f9fb', show: false,
      webPreferences: { preload: join(root, 'desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(contents === window.webContents && permission === 'clipboard-sanitized-write'));
    window.webContents.session.setPermissionCheckHandler((contents, permission) => contents === window.webContents && permission === 'clipboard-sanitized-write');
    window.once('ready-to-show', () => window.show());
    window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
    window.loadFile(join(root, 'desktop/index.html'));
  }
  createWindow();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'MediaStorm Agent', submenu: [{ role: 'about' }, { label: '检查更新…', click: () => { window.show(); window.focus(); send({ type: 'open-updates' }); } }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
  ]));
  app.on('activate', () => { window?.show(); window?.focus(); });
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    const timer = setTimeout(() => { child?.kill('SIGTERM'); app.quit(); }, 5000);
    request('close').catch(() => {}).finally(() => { clearTimeout(timer); child?.kill('SIGTERM'); app.quit(); });
  });
  ipcMain.handle('storm:invoke', async (event, action, data = {}) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('非法调用来源。');
    if (action === 'updateStatus') return updates.snapshot();
    if (action === 'checkUpdate') return updates.check();
    if (action === 'installUpdate') return updates.install();
    if (action === 'releasePage') { await shell.openExternal('https://github.com/zhujufeng/mediastorm-agent/releases'); return true; }
    if (quitting) throw new Error('应用正在退出，请稍候。');
    await boot; if (bootError) throw bootError;
    if (action === 'answer') {
      const question = questions.get(data.id);
      if (!question) throw new Error('该确认已失效。');
      if (data.value !== undefined && (question.kind === 'confirm' ? typeof data.value !== 'boolean' :
        typeof data.value !== 'string' || data.value.length > 50000 || (question.kind === 'select' && !question.options.some(o => o.id === data.value)))) throw new Error('确认内容无效。');
      questions.delete(data.id);
      child.send({ reply: data.id, value: data.value }); return true;
    }
    if (action === 'external') {
      if (!authLinks.has(data.url)) throw new Error('只允许打开当前登录步骤提供的链接。');
      await shell.openExternal(data.url); return true;
    }
    if (action === 'stop') return request('stop');
    if (action === 'catalog' || action === 'diagnostics' || action === 'changes') return request(action);
    if (operation || running) throw new Error('当前操作仍在进行，请先停止。');
    operation = true;
    try {
      if (action === 'choose') {
        const result = await dialog.showOpenDialog(window, { title: '选择要交给助手的 Git 项目', properties: ['openDirectory'] });
        if (result.canceled) return null;
        return await request('open', { path: result.filePaths[0] });
      }
      if (action === 'open') {
        const catalog = await request('catalog');
        if (!catalog.recent.includes(data.path)) throw new Error('请通过文件夹选择器打开新项目。');
      }
      if (!['open', 'fresh', 'resume', 'profile', 'saveModel', 'login', 'logout', 'prompt', 'testModel'].includes(action)) throw new Error('不支持的操作。');
      if (action === 'login') { loggingIn = true; authLinks.clear(); }
      return await request(action, data);
    } finally { if (action === 'login') { loggingIn = false; authLinks.clear(); } operation = false; }
  });
  }).catch(error => { dialog.showErrorBox('启动失败', error.message); app.quit(); });
}
