const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('storm', {
  invoke: (action, data) => ipcRenderer.invoke('storm:invoke', action, data),
  onEvent: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('storm:event', listener);
    return () => ipcRenderer.removeListener('storm:event', listener);
  },
});
