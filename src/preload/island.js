
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('edenIsland', {
  stop: () => ipcRenderer.send('eden:island-stop'),

  open: () => ipcRenderer.send('eden:island-open'),

  onState(callback) {
    ipcRenderer.on('eden:island-state', (_event, state) => {
      callback(state);
    });
  }
});
