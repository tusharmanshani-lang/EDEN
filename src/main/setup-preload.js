'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('edenSetup', {
  save: input => ipcRenderer.invoke('eden-public:save-setup', input)
});
