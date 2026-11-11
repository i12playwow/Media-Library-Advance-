'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserToolbar', {
  command: (action, value) => ipcRenderer.invoke('browser:command', action, value),
  onState: handler => ipcRenderer.on('browser:state', (_event, state) => handler(state)),
  onFocusAddress: handler => ipcRenderer.on('browser:focusAddress', () => handler())
});
