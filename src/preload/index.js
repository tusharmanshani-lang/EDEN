
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eden', {
  // Account secrets are intentionally never exposed through this bridge.
  platform: process.platform,
  transcribeVoice: input => ipcRenderer.invoke('eden:transcribe-voice', input),
  cancelVoiceInput: () => ipcRenderer.invoke('eden:cancel-voice-input'),
  onBrainReady(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('eden:brain-ready', listener);
    return () => ipcRenderer.removeListener('eden:brain-ready', listener);
  },
    startupGreeting: recent =>
    ipcRenderer.invoke('eden:startup-greeting', recent),
  generateMotion: description => ipcRenderer.invoke('eden:generate-motion', description),
  openProjectLink: url => ipcRenderer.invoke('eden:project-link', url),
  openCodingReport: folder => ipcRenderer.invoke('eden:project-report', folder),
  onCodingResult(callback) {
    if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('eden:coder-result', listener);
    return () => ipcRenderer.removeListener('eden:coder-result', listener);
  },
  coder: (action, input = {}) => ipcRenderer.invoke('eden:coder', action, input),
    speakTara: text => ipcRenderer.invoke('eden:speak-tara', text),
    onTaraPlayback(callback) {
  const listener = (_event, playing) => callback(playing === true);
  ipcRenderer.on('eden:tara-playback', listener);
  return () => ipcRenderer.removeListener('eden:tara-playback', listener);
},
  interrupt: () => ipcRenderer.invoke('eden:interrupt'),

  onInterrupted(callback) {
    const listener = () => callback();
    ipcRenderer.on('eden:interrupted', listener);

    return () =>
      ipcRenderer.removeListener('eden:interrupted', listener);
  },

      stopSpeaking: () => ipcRenderer.invoke('eden:stop-speaking'),
  centre: (type, input) => ipcRenderer.invoke('eden:centre', type, input),
  getStatus: () => ipcRenderer.invoke('eden:get-status'),

  sendMessage: (message) =>
    ipcRenderer.invoke('eden:chat', message),

  mac: {
    getStatus: () =>
      ipcRenderer.invoke('eden:mac-status'),

    openApp: (name) =>
      ipcRenderer.invoke('eden:mac-open-app', name),

    openWebsite: (url) =>
      ipcRenderer.invoke('eden:mac-open-website', url),

    listFolder: (folderPath) =>
      ipcRenderer.invoke('eden:mac-list-folder', folderPath),

    searchFiles: (query, roots = []) =>
      ipcRenderer.invoke(
        'eden:mac-search-files',
        query,
        roots
      ),

        openFile: (filePath) =>
      ipcRenderer.invoke('eden:mac-open-file', filePath),
        readTextFile: (filePath) =>
  ipcRenderer.invoke('eden:mac-read-text-file', filePath),

    getLocations: () =>
      ipcRenderer.invoke('eden:mac-locations'),

    previewFile: (filePath) =>
      ipcRenderer.invoke('eden:mac-preview-file', filePath)
  },

  wakeWord: {
    onCommand: callback => {
      const listener = (_event, command) => callback(command);
      ipcRenderer.on('eden:voice-command', listener);
      return () => ipcRenderer.removeListener('eden:voice-command', listener);
    },

    getStatus: () =>
      ipcRenderer.invoke('eden:wake-status'),

    start: () =>
      ipcRenderer.invoke('eden:wake-start'),

    stop: () =>
      ipcRenderer.invoke('eden:wake-stop'),

    onDetected: (callback) => {
      if (typeof callback !== 'function') {
        throw new TypeError('Wake-word callback must be a function.');
      }

      const listener = (_event, data) => callback(data);
      ipcRenderer.on('eden:wake-detected', listener);

      return () => {
        ipcRenderer.removeListener('eden:wake-detected', listener);
      };
    },

    onStateChanged: (callback) => {
      if (typeof callback !== 'function') {
        throw new TypeError('Wake-word state callback must be a function.');
      }

      const listener = (_event, data) => callback(data);
      ipcRenderer.on('eden:wake-state', listener);

      return () => {
        ipcRenderer.removeListener('eden:wake-state', listener);
      };
    },

    onError: (callback) => {
      if (typeof callback !== 'function') {
        throw new TypeError('Wake-word error callback must be a function.');
      }

      const listener = (_event, data) => callback(data);
      ipcRenderer.on('eden:wake-error', listener);

      return () => {
        ipcRenderer.removeListener('eden:wake-error', listener);
      };
    }
  }
});
