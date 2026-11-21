
'use strict';

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

function createDynamicIsland({ getMainWindow, onStop, onOpen }) {
  let win = null;
  let ready = false;
  let disposed = false;
  let speaking = false;
  let thinking = false;
  let listeningUntil = 0;
  let music = null;
  let polling = false;

  function mainIsHidden() {
    const main = getMainWindow();

    return !main ||
      main.isDestroyed() ||
      main.isMinimized() ||
      !main.isVisible();
  }

  function getState() {
    if (speaking) {
      return {
        mode: 'speaking',
        title: 'EDEN',
        detail: 'Speaking',
        active: true
      };
    }

    if (thinking) {
      return {
        mode: 'thinking',
        title: 'EDEN',
        detail: 'Working on your request',
        active: true
      };
    }

    if (Date.now() < listeningUntil) {
      return {
        mode: 'listening',
        title: 'EDEN',
        detail: 'Listening to you',
        active: true
      };
    }

    if (music) {
      return {
        mode: 'music',
        title: music.title,
        detail: music.source,
        active: true
      };
    }

    return {
      mode: 'idle',
      title: 'EDEN',
      detail: 'Ready',
      active: false
    };
  }

  function position() {
    if (!win || win.isDestroyed()) return;

    const { workArea } = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint()
    );

    const width = Math.min(250, workArea.width - 24);

    win.setBounds({
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: workArea.y + 10,
      width,
      height: 52
    });
  }

  function render() {
    if (disposed || !ready || !win || win.isDestroyed()) return;

    const state = getState();
    win.webContents.send('eden:island-state', { ...state, music });

    if (mainIsHidden() && state.active) {
      if (!win.isVisible()) {
        position();
        win.showInactive();
      }
    } else {
      win.hide();
    }
  }

  function validSender(event) {
    return win &&
      !win.isDestroyed() &&
      event.sender === win.webContents;
  }

  const stop = event => {
    if (validSender(event)) onStop();
  };

  const open = event => {
    if (validSender(event)) onOpen();
  };

  ipcMain.on('eden:island-stop', stop);
  ipcMain.on('eden:island-open', open);

  win = new BrowserWindow({
    width: 250,
    height: 52,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    
    visualEffectState: 'active',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/island.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true
  });

  win.webContents.setWindowOpenHandler(() => ({
    action: 'deny'
  }));

  win.webContents.on('will-navigate', event => {
    event.preventDefault();
  });

  win.once('ready-to-show', () => {
    ready = true;
    render();
  });

  win.loadFile(
    path.join(__dirname, '../renderer/island.html')
  ).catch(error => {
    console.warn('EDEN island:', error.message);
  });

  // Read playback without activating Safari or changing tabs.
  const inspect = String(function () {
    if (location.hostname === 'open.spotify.com') {
      const button = document.querySelector(
        '[data-testid="control-button-playpause"]'
      );

      const widget = document.querySelector(
        '[data-testid="now-playing-widget"]'
      );

      const track = widget?.querySelector('a[href*="/track/"]');

      if (
        /^pause\b/i.test(button?.getAttribute('aria-label') || '') &&
        track?.textContent.trim()
      ) {
        return JSON.stringify({
          title: track.textContent.trim(),
          source: 'Spotify · Playing'
        });
      }
    }

    if (/(^|\.)youtube\.com$/.test(location.hostname)) {
      const video = document.querySelector('video');

      if (video && !video.paused && !video.ended) {
        const title =
          document.querySelector('h1.ytd-watch-metadata')
            ?.textContent.trim() ||
          document.title.replace(/ - YouTube$/, '');

        return JSON.stringify({
          title,
          source: 'YouTube · Playing'
        });
      }
    }

    return '';
  });

  const script = [
    'on run argv',
    'if application "Safari" is not running then return ""',
    'tell application "Safari"',
    'repeat with browserWindow in windows',
    'repeat with browserTab in tabs of browserWindow',
    'try',
    'set address to URL of browserTab',
    'if address starts with "https://open.spotify.com/" or address starts with "https://www.youtube.com/" or address starts with "https://youtube.com/" then',
    'set resultText to do JavaScript (item 1 of argv) in browserTab',
    'if resultText is not "" then return resultText',
    'end if',
    'end try',
    'end repeat',
    'end repeat',
    'end tell',
    'return ""',
    'end run'
  ].join('\n');

  async function pollMusic() {
    if (
      disposed ||
      polling ||
      !mainIsHidden() ||
      process.platform !== 'darwin'
    ) return;

    polling = true;

    try {
      const { stdout } = await run(
        '/usr/bin/osascript',
        ['-e', script, '(' + inspect + ')()'],
        { timeout: 3500 }
      );

      const result = stdout.trim()
        ? JSON.parse(stdout.trim())
        : null;

      music =
        result &&
        typeof result.title === 'string' &&
        typeof result.source === 'string'
          ? {
              title: result.title.slice(0, 180),
              source: result.source.slice(0, 80)
            }
          : null;
    } catch {
      music = null;
    } finally {
      polling = false;
      render();
    }
  }

  const refresh = setInterval(render, 300);
  const playback = setInterval(pollMusic, 5000);

  refresh.unref();
  playback.unref();

  const displayChanged = () => {
    position();
    render();
  };

  screen.on('display-metrics-changed', displayChanged);

  return {
    setSpeaking(value) {
      speaking = Boolean(value);
      render();
    },

    setThinking(value) {
      thinking = Boolean(value);
      listeningUntil = 0;
      render();
    },

    listen() {
      listeningUntil = Date.now() + 6000;
      render();
    },

    stopped() {
      speaking = false;
      thinking = false;
      listeningUntil = 0;
      render();
    },

    dispose() {
      disposed = true;
      clearInterval(refresh);
      clearInterval(playback);
      screen.removeListener('display-metrics-changed', displayChanged);
      ipcMain.removeListener('eden:island-stop', stop);
      ipcMain.removeListener('eden:island-open', open);

      if (win && !win.isDestroyed()) win.destroy();
    }
  };
}

module.exports = { createDynamicIsland };
