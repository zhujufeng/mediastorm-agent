// Electron owns download, signature verification and replacement of the application.
export function attachUpdates(updater, { version, unavailable = '', publish, isBusy, restart }) {
  let state = { version, phase: unavailable ? 'unavailable' : 'idle', message: unavailable || '可以检查是否有新版本。', release: '', notes: '' };
  const snapshot = () => ({ ...state, canCheck: ['idle', 'current', 'error'].includes(state.phase), canInstall: state.phase === 'downloaded' });
  const change = (phase, message, extra = {}) => { state = { ...state, phase, message, ...extra }; publish(snapshot()); };
  if (!unavailable) {
    updater.on('error', () => change('error', '更新未能完成，请检查网络后重试。当前版本仍可使用。'));
    updater.on('checking-for-update', () => change('checking', '正在检查新版本…', { release: '', notes: '' }));
    updater.on('update-available', () => change('downloading', '发现新版本，正在下载。你可以继续工作，下载后由你决定是否重启。'));
    updater.on('update-not-available', () => change('current', '你已经在使用最新版本。'));
    updater.on('update-downloaded', (_event, notes, name) => change('downloaded', '新版已准备好，重启应用即可安装。', {
      release: typeof name === 'string' ? name.slice(0, 120) : '', notes: typeof notes === 'string' ? notes.slice(0, 8000) : '',
    }));
    updater.setFeedURL({ url: `https://update.electronjs.org/zhujufeng/mediastorm-agent/darwin-arm64/${encodeURIComponent(version)}` });
  }
  return {
    snapshot,
    check() {
      if (!snapshot().canCheck) return snapshot();
      change('checking', '正在检查新版本…', { release: '', notes: '' });
      try { updater.checkForUpdates(); }
      catch { change('error', '无法开始检查更新，请稍后重试。当前版本仍可使用。'); }
      return snapshot();
    },
    async install() {
      if (!snapshot().canInstall) throw new Error('请先下载新版本。');
      if (isBusy()) throw new Error('助手仍在执行或等待确认。请完成或停止当前操作后再安装。');
      change('installing', '正在准备重启…');
      try {
        if (!await restart()) change('downloaded', '新版已保留，你可以稍后重启安装。');
      } catch (error) { change('downloaded', error.message); }
      return snapshot();
    },
  };
}
