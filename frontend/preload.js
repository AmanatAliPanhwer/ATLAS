const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
  ping: () => ipcRenderer.invoke('ping'),
  apiRequest: (options) => ipcRenderer.invoke('api-request', options),
  onApiReceived: (callback) => ipcRenderer.on('api-received', (event, value) => callback(value)),
});
