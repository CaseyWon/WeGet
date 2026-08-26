const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wegetDesktop', {
  parseArticle: url => ipcRenderer.invoke('article:parse', { url }),
  saveResource: resource => ipcRenderer.invoke('resource:save', resource),
  saveArchive: payload => ipcRenderer.invoke('resources:archive', payload),
  openSource: url => ipcRenderer.invoke('article:open-source', { url }),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  getPlatform: () => process.platform,
  onDownloadProgress: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('download:progress', listener);
    return () => ipcRenderer.removeListener('download:progress', listener);
  }
});
