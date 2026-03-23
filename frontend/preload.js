const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
  ping: () => ipcRenderer.invoke('ping'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  startScreenCapture: () => ipcRenderer.invoke('start-screen-capture'),
  stopScreenCapture: () => ipcRenderer.invoke('stop-screen-capture'),
  onScreenFrame: (callback) => ipcRenderer.on('screen-frame', (event, data) => callback(data)),
  apiRequest: (options) => ipcRenderer.invoke('api-request', options),
  onApiReceived: (callback) => ipcRenderer.on('api-received', (event, value) => callback(value)),
});