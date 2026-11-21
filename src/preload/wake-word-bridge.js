'use strict';

/** Merge these methods into the existing contextBridge exposeInMainWorld
 * object. Keep your current getStatus/sendMessage methods unchanged. */
function createWakeWordBridge(ipcRenderer) {
  return {
    getWakeStatus: () => ipcRenderer.invoke('eden:wake-status'),
    startWakeWord: () => ipcRenderer.invoke('eden:wake-start'),
    stopWakeWord: () => ipcRenderer.invoke('eden:wake-stop'),
    onWakeDetected: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('eden:wake-detected', listener);
      return () => ipcRenderer.removeListener('eden:wake-detected', listener);
    },
    onWakeState: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('eden:wake-state', listener);
      return () => ipcRenderer.removeListener('eden:wake-state', listener);
    },
    onWakeError: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('eden:wake-error', listener);
      return () => ipcRenderer.removeListener('eden:wake-error', listener);
    },
  };
}

module.exports = { createWakeWordBridge };
