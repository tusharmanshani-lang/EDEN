'use strict';

/** Merge these handlers into the existing main/index.js after creating the
 * LocalWakeWordService instance. Do not replace your current IPC handlers. */
function registerWakeWordIpc({ ipcMain, wakeWordService }) {
  ipcMain.handle('eden:wake-status', () => wakeWordService.getStatus());
  ipcMain.handle('eden:wake-start', () => wakeWordService.start());
  ipcMain.handle('eden:wake-stop', () => wakeWordService.stop());

  const forward = (channel, payload) => {
    for (const win of require('electron').BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  };
  wakeWordService.on('command', (command) => forward('eden:voice-command', command));
  wakeWordService.on('wake', (event) => forward('eden:wake-detected', event));
  wakeWordService.on('state', (state) => forward('eden:wake-state', state));
  wakeWordService.on('error-safe', (message) => forward('eden:wake-error', { message }));
}

module.exports = { registerWakeWordIpc };
