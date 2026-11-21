'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const interruption = require('../core/interruption');
const { execFile } = interruption;
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { shell, screen } = require('electron');

const runFile = promisify(execFile);
const DOCUMENT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.csv', '.rtf', '.pdf', '.docx'
]);
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

const BROWSERS = {
  safari: 'Safari',
  chrome: 'Google Chrome',
  'google chrome': 'Google Chrome',
  firefox: 'Firefox',
  edge: 'Microsoft Edge',
  'microsoft edge': 'Microsoft Edge',
  brave: 'Brave Browser',
  opera: 'Opera',
  browser: 'your default browser',
  'default browser': 'your default browser'
};

const OPEN_SAFARI_TAB = [
  'on run argv',
  '  set targetURL to item 1 of argv',
  '  tell application "Safari"',
  '    activate',
  '    if (count of windows) is 0 then',
  '      make new document with properties {URL:targetURL}',
  '    else',
  '      tell front window',
  '        set newTab to make new tab at end of tabs with properties {URL:targetURL}',
  '        set current tab to newTab',
  '      end tell',
  '    end if',
  '  end tell',
  'end run'
].join('\n');

const CONTROL_SPOTIFY_TAB = [
  'on run argv',
  '  if application "Safari" is not running then return "missing"',
  '  tell application "Safari"',
  '    repeat with browserWindow in windows',
  '      repeat with browserTab in tabs of browserWindow',
  '        set tabURL to URL of browserTab',
  '        if tabURL is not missing value then',
  '          if tabURL is "https://open.spotify.com" or tabURL starts with "https://open.spotify.com/" then',
  '            return do JavaScript (item 1 of argv) in browserTab',
  '          end if',
  '        end if',
  '      end repeat',
  '    end repeat',
  '  end tell',
  '  return "missing"',
  'end run'
].join('\n');

async function runSafariScript(script, argument, secondArgumentOrTimeout, timeout) {
  const hasSecondArgument = typeof secondArgumentOrTimeout === 'string';
  const args = ['-e', script, argument];

  if (hasSecondArgument) {
    args.push(secondArgumentOrTimeout);
  }

  try {
    const { stdout } = await runFile('/usr/bin/osascript', args, {
      timeout: hasSecondArgument ? timeout : secondArgumentOrTimeout
    });
    return stdout.trim();
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;

    if (/-1743|not authorized to send apple events/i.test(detail)) {
      throw new Error('Allow EDEN to control Safari in System Settings under Privacy & Security → Automation.');
    }

    if (/JavaScript from Apple Events/i.test(detail)) {
      throw new Error('Enable Allow JavaScript from Apple Events in Safari’s Develop menu.');
    }

    throw new Error(detail);
  }
}

function extractDocumentText(filePath, extension, timeoutMs) {
  interruption.checkpoint();
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'documentReaderWorker.js'), {
      workerData: {
        filePath,
        extension,
        maxFileBytes: MAX_DOCUMENT_BYTES,
        maxTextBytes: MAX_TEXT_BYTES
      },
      resourceLimits: { maxOldGenerationSizeMb: 256 }
    });
    let settled = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      currentSignal?.removeEventListener('abort', abort);
      void worker.terminate().catch(() => {});
      if (error) reject(error);
      else resolve(result);
    };

    const currentSignal = interruption.signal();
    const abort = () => finish(currentSignal.reason);

    const timer = setTimeout(() => {
      finish(new Error('Document reading timed out. Try a smaller document.'));
    }, timeoutMs);

    currentSignal?.addEventListener('abort', abort, { once: true });
    if (currentSignal?.aborted) abort();

    worker.once('message', message => {
      finish(message.error ? new Error(message.error) : null, message.result);
    });
    worker.once('error', error => finish(error));
    worker.once('exit', () => {
      finish(new Error('The document reader stopped before returning text.'));
    });
  });
}

function convertRtfFileToText(filePath, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      '/usr/bin/textutil',
      ['-format', 'rtf', '-convert', 'txt', '-stdout', filePath],
      { shell: false, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let output = '';
    let errorOutput = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('RTF conversion timed out.'));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', chunk => {
      if (settled) return;
      output += chunk;

      if (Buffer.byteLength(output, 'utf8') > MAX_TEXT_BYTES) {
        settled = true;
        clearTimeout(timeout);
        child.kill();
        reject(new Error('Converted document is too large to read.'));
      }
    });

    child.stderr.on('data', chunk => {
      errorOutput += chunk;
    });

    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error('RTF conversion failed: ' + error.message));
    });

    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        reject(new Error(errorOutput.trim() || 'macOS could not convert this RTF document.'));
        return;
      }

      resolve(
        output
          .replace(/\r\n?/g, '\n')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      );
    });
  });
}

class MacControl {
  constructor({ appPath }) {
    this.appPath = appPath;

    this.allowedApps = {
      finder: 'Finder',
      safari: 'Safari',
      chrome: 'Google Chrome',
      firefox: 'Firefox',
      spotify: 'Spotify',
      vscode: 'Visual Studio Code',
      terminal: 'Terminal',
      notes: 'Notes',
      calendar: 'Calendar',
      mail: 'Mail',
      messages: 'Messages',
      photos: 'Photos',
      preview: 'Preview',
      settings: 'System Settings',
      activitymonitor: 'Activity Monitor',
      calculator: 'Calculator'
    };

    const home = os.homedir();
    this.allowedRoots = [
      path.join(home, 'Desktop'),
      path.join(home, 'Documents'),
      path.join(home, 'Downloads'),
      path.join(home, 'Pictures'),
      path.join(home, 'Movies'),
      path.join(home, 'Music'),
      this.appPath
    ];

    this.maxResults = 100;
    this.maxSearchDepth = 5;
    this.maxPreviewBytes = 15 * 1024 * 1024;
    this.reportsDirectory = path.join(home, 'Documents', 'EDEN Reports');

    this.previewTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf'
    };
  }

  getStatus() {
    return {
      available: process.platform === 'darwin',
      platform: process.platform,
      supportedActions: [
        'open-app',
        'open-website',
        'spotify-playback',
        'list-folders',
        'search-files',
        'open-file',
        'read-text-file',
        'search-document-contents',
        'save-research-report',
        'list-research-reports',
        'get-approved-locations',
        'preview-file'
      ],
      destructiveActionsEnabled: false,
      unrestrictedTerminalEnabled: false
    };
  }

  requireMac() {
    if (process.platform !== 'darwin') {
      throw new Error('These Mac controls require macOS.');
    }
  }

  validateText(value, label, maxLength = 500) {
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
      throw new Error('Invalid ' + label + '.');
    }
    return value.trim();
  }

  isInsideRoot(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === '' || (
      relative !== '..' &&
      !relative.startsWith('..' + path.sep) &&
      !path.isAbsolute(relative)
    );
  }

  isInsideApprovedRoots(candidate) {
    return this.allowedRoots.some(root =>
      this.isInsideRoot(candidate, path.resolve(root))
    );
  }

  async getApprovedRoot(requestedPath) {
    const value = this.validateText(requestedPath, 'folder path', 2000);
    const resolved = path.resolve(value);

    if (!this.isInsideApprovedRoots(resolved)) {
      throw new Error(
        'For security, EDEN can only access Desktop, Documents, Downloads, Pictures, Movies, Music and its own project folder.'
      );
    }

    let realPath;
    try {
      realPath = await fs.promises.realpath(resolved);
    } catch {
      throw new Error('That folder or file does not exist.');
    }

    if (!this.isInsideApprovedRoots(realPath)) {
      throw new Error('That location resolves outside EDEN’s approved folders.');
    }

    return realPath;
  }
  async controlVolume(action, level) {
    this.requireMac();

    const commands = {
      status: [],
      mute: ['set volume with output muted'],
      unmute: ['set volume without output muted'],
      up: [
        'set currentLevel to output volume of (get volume settings)',
        'set nextLevel to currentLevel + 10',
        'if nextLevel > 100 then set nextLevel to 100',
        'set volume output volume nextLevel',
        'set volume without output muted'
      ],
      down: [
        'set currentLevel to output volume of (get volume settings)',
        'set nextLevel to currentLevel - 10',
        'if nextLevel < 0 then set nextLevel to 0',
        'set volume output volume nextLevel'
      ]
    };

    let lines;
    if (action === 'set') {
      if (!Number.isInteger(level) || level < 0 || level > 100) {
        throw new Error('Choose a volume from 0 to 100 percent.');
      }
      lines = ['set volume output volume ' + level];
      if (level > 0) lines.push('set volume without output muted');
    } else {
      if (!Object.hasOwn(commands, action)) {
        throw new Error('Unsupported volume command.');
      }
      lines = commands[action];
    }

    const script = [
      ...lines,
      'set audioSettings to get volume settings',
      'return ((output volume of audioSettings) as text) & "," & ((output muted of audioSettings) as text)'
    ].join('\n');

    const { stdout } = await runFile('/usr/bin/osascript', ['-e', script], {
      timeout: 5000
    });

    const match = stdout.trim().match(/^(\d{1,3}),(true|false)$/);
    if (!match || Number(match[1]) > 100) {
      throw new Error('I couldn’t read the Mac’s output volume.');
    }

    const actual = Number(match[1]);
    const muted = match[2] === 'true';
    return 'Mac volume is ' + actual + ' percent' + (muted ? ' and muted.' : '.');
  }

  async openApp(appKey) {
    this.requireMac();

    const requestedName = this.validateText(appKey, 'application name', 80);
    if (/^[-~]|[/\\\x00-\x1f\x7f]/.test(requestedName)) {
      throw new Error('Use the app name as it appears in Finder.');
    }

    const normalize = name => name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = normalize(requestedName);
    const appName = Object.hasOwn(this.allowedApps, key)
      ? this.allowedApps[key]
      : Object.values(this.allowedApps).find(name => normalize(name) === key) || requestedName;

    try {
      await runFile('/usr/bin/open', ['-a', appName], { timeout: 10000 });
    } catch (error) {
      throw new Error(error.stderr?.trim() || 'macOS could not launch ' + appName + '.');
    }

    return {
      success: true,
      action: 'open-app',
      application: appName,
      message: 'I sent macOS the request to open ' + appName + '.'
    };
  }

  async openWebsite(rawUrl, { inSafari = true, browser } = {}) {
    this.requireMac();
    const value = this.validateText(rawUrl, 'website address', 2000);

    let url;
    try {
      const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
      url = new URL(hasScheme ? value : 'https://' + value);
    } catch {
      throw new Error('That website address is invalid.');
    }

    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('EDEN can only open HTTP or HTTPS websites.');
    }

    const key = browser || (inSafari ? 'safari' : 'default browser');
    if (!Object.hasOwn(BROWSERS, key)) {
      throw new Error('Unsupported browser.');
    }

    const name = BROWSERS[key];
    const address = url.toString();

    if (key === 'safari') {
           let reused = false;

      if (url.origin === 'https://www.youtube.com' && url.pathname === '/results') {
        const reuseYouTubeTab = [
          'on run argv',
          '  if application "Safari" is not running then return "missing"',
          '  set targetURL to item 1 of argv',
          '  tell application "Safari"',
          '    repeat with browserWindow in windows',
          '      set activeTab to current tab of browserWindow',
          '      set activeURL to URL of activeTab',
          '      if my isYouTubeURL(activeURL) then',
          '        set URL of activeTab to targetURL',
          '        set index of browserWindow to 1',
          '        activate',
          '        return "reused"',
          '      end if',
          '      repeat with browserTab in tabs of browserWindow',
          '        if my isYouTubeURL(URL of browserTab) then',
          '          set URL of browserTab to targetURL',
          '          set current tab of browserWindow to browserTab',
          '          set index of browserWindow to 1',
          '          activate',
          '          return "reused"',
          '        end if',
          '      end repeat',
          '    end repeat',
          '  end tell',
          '  return "missing"',
          'end run',
          '',
          'on isYouTubeURL(tabURL)',
          '  if tabURL is missing value then return false',
          '  return (tabURL is "https://www.youtube.com" or tabURL starts with "https://www.youtube.com/")',
          'end isYouTubeURL'
        ].join('\n');

        reused = (await runSafariScript(reuseYouTubeTab, address, 15000)) === 'reused';
      }

      if (!reused) {
        await runSafariScript(OPEN_SAFARI_TAB, address, 15000);
      }
    } else if (key === 'browser' || key === 'default browser') {
      await shell.openExternal(address);
    } else {
      try {
        await runFile('/usr/bin/open', ['-a', name, address], { timeout: 10000 });
      } catch {
        throw new Error('Check that ' + name + ' is installed and can open normally.');
      }
    }

    return {
      success: true,
      action: 'open-website',
      url: address,
      browser: name,
      message: 'I sent ' + url.hostname + ' to ' + name + '.'
    };
  }
    async controlBrowserWindow(action, browser) {
    this.requireMac();

    const apps = {
      Safari: ['com.apple.Safari', 'miniaturized'],
      'Google Chrome': ['com.google.Chrome', 'minimized'],
      'Microsoft Edge': ['com.microsoft.edgemac', 'minimized'],
      'Brave Browser': ['com.brave.Browser', 'minimized']
    };
    const requested = browser && Object.hasOwn(BROWSERS, browser) ? BROWSERS[browser] : null;
    if (browser && !requested) throw new Error('Unknown browser.');
   if (![
  'maximize', 'minimize', 'restore',
  'tile-left', 'tile-right', 'tile-top', 'tile-bottom',
  'tile-top-left', 'tile-top-right',
  'tile-bottom-left', 'tile-bottom-right'
].includes(action)) {
      throw new Error('Unsupported browser window action.');
    }

    let name = requested;
    if (!name) {
      const probe = [
        'ObjC.import("AppKit");',
        'ObjC.unwrap($.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier);'
      ].join('\n');
      const { stdout } = await runFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', probe], { timeout: 3000 });
      const frontId = stdout.trim();
      name = Object.keys(apps).find(item => apps[item][0] === frontId);
      if (!name) {
        return {
          verified: false,
          message: 'Which browser window? Say the browser name, such as “maximize Chrome.”'
        };
      }
    }

    if (!Object.hasOwn(apps, name)) {
      return { verified: false, message: 'Window resizing is not available for ' + name + '.' };
    }

    const [bundleId, minimizedProperty] = apps[name];
    const app = 'application id "' + bundleId + '"';
    const run = async lines => {
      try {
        const { stdout } = await runFile('/usr/bin/osascript', ['-e', [
          'if ' + app + ' is not running then return "closed"',
          'tell ' + app,
          'if (count of windows) is 0 then return "empty"',
          ...lines,
          'end tell'
        ].join('\n')], { timeout: 10000 });
        return stdout.trim();
      } catch (error) {
        const detail = error.stderr?.trim() || error.message;
        if (/-1743|not authorized to send apple events/i.test(detail)) {
          throw new Error('Allow EDEN to control ' + name + ' under Privacy & Security → Automation.');
        }
        throw new Error(detail);
      }
    };

    const pickWindow = action === 'restore'
      ? [
          'set chosenWindow to missing value',
          'repeat with candidate in windows',
          '  if ' + minimizedProperty + ' of candidate then',
          '    set chosenWindow to id of candidate',
          '    exit repeat',
          '  end if',
          'end repeat',
          'if chosenWindow is missing value then return "none"'
        ]
      : ['set chosenWindow to id of front window'];

    const initial = await run([
      ...pickWindow,
      'set oldBounds to bounds of window id chosenWindow',
      'set AppleScript\'s text item delimiters to ","',
      'return (chosenWindow as text) & "," & (oldBounds as text)'
    ]);
    if (initial === 'closed' || initial === 'empty' || initial === 'none') {
      return {
        verified: false,
        message: initial === 'none'
          ? 'I couldn’t find a minimized ' + name + ' window.'
          : 'There is no open ' + name + ' window.'
      };
    }

    const [id, left, top, right, bottom] = initial.split(',').map(Number);
    if (![id, left, top, right, bottom].every(Number.isInteger)) {
      throw new Error('Could not read the ' + name + ' window bounds.');
    }
    const windowRef = 'window id ' + id;
    const targetState = action === 'minimize';
    const lines = ['set ' + minimizedProperty + ' of ' + windowRef + ' to ' + targetState];
    let verify = 'return (' + minimizedProperty + ' of ' + windowRef + ' is ' + targetState + ') as text';
    if (action === 'maximize' || action.startsWith('tile-')) {
  const { workArea } = screen.getDisplayMatching({
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  });

  const x = Math.round(workArea.x);
  const y = Math.round(workArea.y);
  const width = Math.round(workArea.width);
  const height = Math.round(workArea.height);

  const halfWidth = Math.floor(width / 2);
  const halfHeight = Math.floor(height / 2);

  const layouts = {
    maximize: [x, y, x + width, y + height],

    'tile-left':
      [x, y, x + halfWidth, y + height],

    'tile-right':
      [x + halfWidth, y, x + width, y + height],

    'tile-top':
      [x, y, x + width, y + halfHeight],

    'tile-bottom':
      [x, y + halfHeight, x + width, y + height],

    'tile-top-left':
      [x, y, x + halfWidth, y + halfHeight],

    'tile-top-right':
      [x + halfWidth, y, x + width, y + halfHeight],

    'tile-bottom-left':
      [x, y + halfHeight, x + halfWidth, y + height],

    'tile-bottom-right':
      [x + halfWidth, y + halfHeight, x + width, y + height]
  };

  const bounds = layouts[action];

  lines.push(
    'set bounds of ' + windowRef +
      ' to {' + bounds.join(', ') + '}'
  );

  verify =
    'return ((bounds of ' + windowRef + ') is {' +
    bounds.join(', ') + '}) as text';
}
    if (!targetState) lines.push('set index of ' + windowRef + ' to 1', 'activate');
    const verified = await run([...lines, 'delay 0.3', verify]) === 'true';
    const past = {
  maximize: 'maximized',
  minimize: 'minimized',
  restore: 'restored',
  'tile-left': 'arranged on the left half',
  'tile-right': 'arranged on the right half',
  'tile-top': 'arranged on the top half',
  'tile-bottom': 'arranged on the bottom half',
  'tile-top-left': 'arranged in the top-left corner',
  'tile-top-right': 'arranged in the top-right corner',
  'tile-bottom-left': 'arranged in the bottom-left corner',
  'tile-bottom-right': 'arranged in the bottom-right corner'
};
    return {
      message: verified
  ? name + ' window: ' + past[action] + '.'
  : name + ' did not confirm the requested window change.'
    };
  }

  async controlSafariWindow(action) {
    this.requireMac();

    if (['maximize-window', 'minimize-window', 'restore-window'].includes(action)) {
      return (await this.controlBrowserWindow(action.split('-')[0], 'safari')).message;
    }

    if (action === 'reopen-tab') {
      return 'Use Shift-Command-T in Safari to reopen the last closed tab.';
    }

    const actions = {
      'new-window': [
        'make new document',
        'activate',
        'return "I opened a Safari window."'
      ],
      'new-tab': [
        'if (count of windows) is 0 then',
        '  make new document',
        'else',
        '  tell front window',
        '    set current tab to (make new tab at end of tabs)',
        '  end tell',
        'end if',
        'activate',
        'return "I opened a new Safari tab or window."'
      ],
      'close-tab': [
        'if (count of windows) is 0 then return "There is no open Safari window."',
        'close current tab of front window',
        'return "I closed the active Safari tab."'
      ],
      'close-window': [
        'if (count of windows) is 0 then return "There is no open Safari window."',
        'close front window',
        'return "I closed the front Safari window."'
      ],
            quit: [
        'quit',
        'return "I sent Safari the quit command."'
      ]
    };

    if (!Object.hasOwn(actions, action)) {
      throw new Error('Unsupported Safari window command.');
    }

    const canLaunchSafari = action === 'new-window' || action === 'new-tab';
    const script = [
      'on run argv',
      ...(canLaunchSafari
        ? []
        : ['if application "Safari" is not running then return "Safari is closed."']),
      'tell application "Safari"',
      ...actions[action],
      'end tell',
      'end run'
    ].join('\n');

    return runSafariScript(script, '', 10000);
  }
    async useYouTubeTheaterMode() {
    this.requireMac();

    const script = [
      'on run argv',
      '  if application "Safari" is not running then return "missing"',
      '  tell application "Safari"',
      '    if (count of windows) is 0 then return "missing"',
      '    set activeTab to current tab of front window',
      '    set tabURL to URL of activeTab',
      '    if tabURL is missing value then return "missing"',
      '    if tabURL does not start with "https://www.youtube.com/watch?" then return "missing"',
      '    return do JavaScript (item 1 of argv) in activeTab',
      '  end tell',
      'end run'
    ].join('\n');

    const inspect = function (click) {
      if (location.origin !== 'https://www.youtube.com' ||
          location.pathname !== '/watch') return 'missing';

      const layout = document.querySelector('ytd-watch-flexy');
      const player = document.querySelector('#movie_player');
      if (!layout || !player) return 'loading';
      if (layout.hasAttribute('theater') || player.classList.contains('ytp-large-mode')) return 'enabled';

      if (!click) return 'pending';
      const button = player.querySelector('button.ytp-size-button');
      if (!button || button.disabled || !button.getClientRects().length) return 'loading';
      button.click();
      return 'clicked';
    };

    let clicked = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const command = '(' + inspect.toString() + ')(' + JSON.stringify(!clicked) + ')';
      const result = await runSafariScript(script, command, 3000);
      if (result === 'enabled') return { verified: true, message: 'YouTube is in Theater mode.' };
      if (result === 'missing') {
        return { verified: false, message: 'Open a YouTube video in the active Safari tab first.' };
      }
      if (result === 'clicked') clicked = true;
      await new Promise(resolve => setTimeout(resolve, 350));
    }

    return {
      verified: false,
      message: clicked
        ? 'YouTube did not confirm Theater mode.'
        : 'I couldn’t find the Theater mode control on this video.'
    };
  }

  async useYouTubeResults(position = null) {
    this.requireMac();

    if (position !== null && (!Number.isInteger(position) || position < 1 || position > 5)) {
      throw new Error('Choose a video from one to five.');
    }

    const script = [
      'on run argv',
      '  if application "Safari" is not running then return "missing"',
      '  tell application "Safari"',
      '    if (count of windows) is 0 then return "missing"',
      '    set activeTab to current tab of front window',
      '    set tabURL to URL of activeTab',
      '    if tabURL is missing value then return "missing"',
      '    if tabURL does not start with "https://www.youtube.com/results?" then return "missing"',
      '    return do JavaScript (item 1 of argv) in activeTab',
      '  end tell',
      'end run'
    ].join('\n');

    const pageScript = '(' + function (position) {
      if (location.origin !== 'https://www.youtube.com' || location.pathname !== '/results') {
        return JSON.stringify({ status: 'missing' });
      }

      const videos = [];
      const seen = new Set();

      for (const row of document.querySelectorAll('ytd-video-renderer')) {
        const link = row.querySelector('a#video-title[href]');
        if (!link || !row.getClientRects().length) continue;

        const url = new URL(link.href);
        const videoId = url.searchParams.get('v');
        const title = (link.getAttribute('title') || link.textContent || '').trim();

        if (url.origin !== location.origin || url.pathname !== '/watch' ||
            !videoId || !title || seen.has(videoId)) continue;

        seen.add(videoId);
        videos.push({ title, url: url.href });
        if (videos.length === 5) break;
      }

      if (!videos.length) return JSON.stringify({ status: 'empty' });
      if (position === null) return JSON.stringify({ status: 'list', videos });

      const video = videos[position - 1];
      if (!video) return JSON.stringify({ status: 'out-of-range' });

      location.assign(video.url);
      return JSON.stringify({ status: 'opened', title: video.title });
    }.toString() + ')(' + JSON.stringify(position) + ')';

    const output = await runSafariScript(script, pageScript, 10000);
    const result = output === 'missing' ? { status: 'missing' } : JSON.parse(output);

    switch (result.status) {
      case 'list':
        return result.videos.map((video, index) => (index + 1) + '. ' + video.title).join('\n');
      case 'opened':
        return 'I opened "' + result.title + '" on YouTube.';
      case 'empty':
        return 'I couldn’t find any video results yet. Wait for YouTube to finish loading, then try again.';
      case 'out-of-range':
        return 'There aren’t that many video results on this page yet.';
      default:
        return 'Open your YouTube search results in Safari first.';
    }
  }

    async playSpotifyTrack(query) {
    this.requireMac();

    const track = this.validateText(query, 'song name', 160);
    const searchUrl =
      'https://open.spotify.com/search/' +
      encodeURIComponent(track) +
      '/tracks';

    const reuseSpotifyTab = [
      'on run argv',
      '  set targetURL to item 1 of argv',
      '  tell application "Safari"',
      '    repeat with browserWindow in windows',
      '      repeat with browserTab in tabs of browserWindow',
      '        set tabURL to URL of browserTab',
      '        if tabURL is not missing value then',
      '          if tabURL is "https://open.spotify.com" or tabURL starts with "https://open.spotify.com/" then',
      '            set URL of browserTab to targetURL',
      '            set current tab of browserWindow to browserTab',
      '            set index of browserWindow to 1',
      '            activate',
      '            return "reused"',
      '          end if',
      '        end if',
      '      end repeat',
      '    end repeat',
      '  end tell',
      '  return "missing"',
      'end run'
    ].join('\n');

    const navigation = await runSafariScript(
      reuseSpotifyTab,
      searchUrl,
      15000
    );

    if (navigation === 'missing') {
      await this.openWebsite(searchUrl, { browser: 'safari' });
    }

    // Locate the search tab instead of relying on the frontmost Safari tab.
    const script = [
      'on run argv',
      '  if application "Safari" is not running then return "waiting"',
      '  tell application "Safari"',
      '    repeat with browserWindow in windows',
      '      repeat with browserTab in tabs of browserWindow',
      '        set tabURL to URL of browserTab',
      '        if tabURL is not missing value then',
      '          if tabURL starts with (item 2 of argv) then',
      '            return do JavaScript (item 1 of argv) in browserTab',
      '          end if',
      '        end if',
      '      end repeat',
      '    end repeat',
      '  end tell',
      '  return "waiting"',
      'end run'
    ].join('\n');

    const selectTrack = '(' + function (query) {
      if (location.origin !== 'https://open.spotify.com') {
        return 'waiting';
      }

      const parts = location.pathname.split('/');
      const normalize = value =>
        String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

      if (
        parts[1] !== 'search' ||
        normalize(decodeURIComponent(parts[2] || '')) !== normalize(query)
      ) {
        return 'waiting';
      }

      for (const row of document.querySelectorAll(
        '[data-testid="tracklist-row"]'
      )) {
        const link = row.querySelector('a[href*="/track/"]');
        const title =
          link?.textContent?.trim() ||
          row.querySelector('[data-testid="internal-track-link"]')
            ?.textContent?.trim();

        const button = Array.from(
          row.querySelectorAll('button[aria-label]')
        ).find(item =>
          !item.disabled &&
          /^play\b/i.test(item.getAttribute('aria-label') || '')
        );

        if (title && button) {
          button.click();

          return JSON.stringify({
            title,
            href: link?.getAttribute('href') || ''
          });
        }
      }

      return 'waiting';
    }.toString() + ')(' + JSON.stringify(track) + ')';

    const wait = () =>
      new Promise(resolve => setTimeout(resolve, 500));

    const searchDeadline = Date.now() + 15000;
    let selected;

    while (Date.now() < searchDeadline) {
      const result = await runSafariScript(
        script,
        selectTrack,
        searchUrl,
        3000
      );

      if (result && result !== 'waiting') {
        selected = JSON.parse(result);
        break;
      }

      await wait();
    }

    if (!selected) {
      throw new Error(
        'I could not find a playable Spotify result. Check that you are signed in.'
      );
    }

    const verifyTrack = '(' + function (selected) {
      if (location.origin !== 'https://open.spotify.com') {
        return JSON.stringify({ playing: false, position: null });
      }

      const normalize = value =>
        String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

      const getTrackId = href =>
        href?.split('/track/')[1]?.split(/[/?#]/)[0];

      const widget = document.querySelector(
        '[data-testid="now-playing-widget"]'
      );

      const footer =
        document.querySelector('[data-testid="now-playing-bar"]') ||
        widget?.closest('footer') ||
        document.querySelector('footer');

      const player = widget || footer;
      const links = player
        ? Array.from(player.querySelectorAll('a[href*="/track/"]'))
        : [];

      const selectedId = getTrackId(selected.href);
      const idMatches = Boolean(selectedId) && links.some(link =>
        getTrackId(link.getAttribute('href')) === selectedId
      );

      const titleMatches = links.some(link =>
        normalize(link.textContent) === normalize(selected.title)
      );

      // Prefer track IDs when the player exposes them.
      const hasPlayerTrackId = links.some(link =>
        Boolean(getTrackId(link.getAttribute('href')))
      );

      const matches = selectedId && hasPlayerTrackId
        ? idMatches
        : titleMatches;

      const button = document.querySelector(
        '[data-testid="control-button-playpause"]'
      );

      const label =
        button?.getAttribute('aria-label') ||
        button?.getAttribute('title') ||
        '';

      const slider = document.querySelector(
        '[data-testid="playback-progressbar"] [role="slider"], ' +
        '[data-testid="playback-progressbar"][role="slider"]'
      );

      const rawPosition = slider?.getAttribute('aria-valuenow');
      const position = rawPosition === null || rawPosition === undefined
        ? null
        : Number(rawPosition);

      return JSON.stringify({
        matches,
        playing: matches && /^pause\b/i.test(label),
        position: matches && Number.isFinite(position) ? position : null
      });
    }.toString() + ')(' + JSON.stringify(selected) + ')';

    const playbackDeadline = Date.now() + 10000;
    let previousPosition = null;

    while (Date.now() < playbackDeadline) {
      try {
        const output = await runSafariScript(
          script,
          verifyTrack,
          searchUrl,
          3000
        );

        if (output && output !== 'waiting') {
          const status = JSON.parse(output);

          const progressAdvanced =
            status.matches &&
            previousPosition !== null &&
            status.position !== null &&
            status.position > previousPosition;

          if (status.playing || progressAdvanced) {
            return 'Spotify shows ' + selected.title + ' as playing.';
          }

          previousPosition = status.matches ? status.position : null;
        }
      } catch (error) {
        console.warn(
          'EDEN Spotify playback verification:',
          error.message
        );
        break;
      }

      await wait();
    }

    return 'I sent Spotify the Play command for ' + selected.title + '.';
  }

  async controlSpotifyWeb(action) {
    this.requireMac();

    const controls = {
      pause: ['control-button-playpause', 'pause'],
      resume: ['control-button-playpause', 'play'],
      next: ['control-button-skip-forward', ''],
      previous: ['control-button-skip-back', '']
    };

    if (!Object.hasOwn(controls, action)) {
      throw new Error('Unsupported Spotify playback command.');
    }

    const [testId, expectedLabel] = controls[action];
    const selector = 'button[data-testid="' + testId + '"]';
    const pageScript = '(' + function (selector, expected) {
      if (location.origin !== 'https://open.spotify.com') return 'wrong-page';

      const button = document.querySelector(selector);
      if (!button || button.disabled) return 'unavailable';

      const label = (button.getAttribute('aria-label') || '').trim().toLowerCase();

      if (expected && label !== expected) {
        const opposite = expected === 'play' ? 'pause' : 'play';
        return label === opposite ? 'already' : 'unavailable';
      }

      button.click();
      return 'clicked';
    }.toString() + ')(' + JSON.stringify(selector) + ', ' + JSON.stringify(expectedLabel) + ')';

    const result = await runSafariScript(CONTROL_SPOTIFY_TAB, pageScript, 10000);

    if (result === 'missing') {
      throw new Error('Open Spotify Web in Safari and sign in first.');
    }
    if (result === 'already') {
      return action === 'pause' ? 'Spotify is already paused.' : 'Spotify is already playing.';
    }
    if (result !== 'clicked') {
      throw new Error('Spotify’s playback control is unavailable. Start a track in Safari first.');
    }

    return 'I sent Spotify the ' + action + ' command.';
  }

  async getApprovedLocations() {
    this.requireMac();

    const labels = [
      'Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'EDEN Project'
    ];
    const locations = [];

    for (let index = 0; index < this.allowedRoots.length; index++) {
      const root = this.allowedRoots[index];
      try {
        const realPath = await fs.promises.realpath(root);
        const stat = await fs.promises.stat(realPath);
        if (stat.isDirectory() && this.isInsideApprovedRoots(realPath)) {
          locations.push({ name: labels[index], path: realPath });
        }
      } catch {
        // Skip unavailable folders.
      }
    }

    return {
      success: true,
      action: 'get-approved-locations',
      count: locations.length,
      items: locations
    };
  }

  async listFolder(folderPath) {
    this.requireMac();

    const directory = await this.getApprovedRoot(folderPath);
    const stat = await fs.promises.stat(directory);
    if (!stat.isDirectory()) {
      throw new Error('The selected location is not a folder.');
    }

    let entries;
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch (error) {
      throw new Error('Cannot read this folder: ' + error.message);
    }

    const results = [];

    for (const entry of entries.slice(0, this.maxResults)) {
      if (entry.name.endsWith('.photoslibrary') || entry.isSymbolicLink()) continue;

      try {
        const realPath = await fs.promises.realpath(path.join(directory, entry.name));
        if (!this.isInsideApprovedRoots(realPath)) continue;

        const itemStat = await fs.promises.stat(realPath);
        results.push({
          name: entry.name,
          path: realPath,
          type: itemStat.isDirectory() ? 'folder' : 'file',
          extension: itemStat.isFile() ? path.extname(entry.name).toLowerCase() : '',
          size: itemStat.isFile() ? itemStat.size : null,
          modifiedAt: itemStat.mtime.toISOString()
        });
      } catch {
        // Ignore inaccessible or disappearing entries.
      }
    }

    const root = this.allowedRoots.find(item =>
      this.isInsideRoot(directory, path.resolve(item))
    );
    const parentPath = root && directory !== path.resolve(root)
      ? await this.getApprovedRoot(path.dirname(directory))
      : null;

    return { folder: directory, parentPath, count: results.length, items: results };
  }

  async searchFiles(query, selectedRoots = []) {
    this.requireMac();

    const term = this.validateText(query, 'search query', 200).toLowerCase();
    if (!Array.isArray(selectedRoots)) {
      throw new Error('Search locations must be a list.');
    }

    const ignoredWords = new Set([
      'my', 'the', 'a', 'an', 'for', 'in', 'on', 'of',
      'folder', 'file', 'files', 'please', 'find', 'search'
    ]);

    const terms = term
      .split(/[\s._-]+/)
      .filter(word => word && !ignoredWords.has(word));

    if (!terms.length) {
      throw new Error('Please provide a more specific search term.');
    }

    const roots = selectedRoots.length ? selectedRoots : this.allowedRoots;
    const safeRoots = [];

    for (const root of roots) {
      try {
        const safeRoot = await this.getApprovedRoot(root);
        if (!safeRoots.includes(safeRoot)) safeRoots.push(safeRoot);
      } catch {
        // Skip unavailable approved locations.
      }
    }

    if (!safeRoots.length) {
      throw new Error('No approved searchable folders are available.');
    }

    const results = [];
    const seenPaths = new Set();

    const walk = async (directory, depth) => {
      if (depth > this.maxSearchDepth || results.length >= this.maxResults) return;

      let entries;
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= this.maxResults) break;
        if (entry.isSymbolicLink() || entry.name.endsWith('.photoslibrary')) continue;

        try {
          const realPath = await fs.promises.realpath(path.join(directory, entry.name));
          if (!this.isInsideApprovedRoots(realPath) || seenPaths.has(realPath)) continue;

          const stat = await fs.promises.stat(realPath);
          const searchableText = (entry.name + ' ' + realPath).toLowerCase();

          if (terms.every(word => searchableText.includes(word))) {
            seenPaths.add(realPath);
            results.push({
              name: entry.name,
              path: realPath,
              type: stat.isDirectory() ? 'folder' : 'file',
              extension: stat.isFile() ? path.extname(entry.name).toLowerCase() : '',
              size: stat.isFile() ? stat.size : null,
              modifiedAt: stat.mtime.toISOString()
            });
          }

          if (stat.isDirectory()) await walk(realPath, depth + 1);
        } catch {
          // Skip inaccessible entries.
        }
      }
    };

    for (const root of safeRoots) {
      await walk(root, 0);
      if (results.length >= this.maxResults) break;
    }

    return {
      success: true,
      action: 'search-files',
      query: term,
      count: results.length,
      items: results
    };
  }

  findDocumentPassages(document, query, maxPassages = 3) {
    const phrase = this.validateText(query, 'search query', 200);
    const pattern = new RegExp(
      phrase.split(/\s+/)
        .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s+'),
      'gi'
    );

    const segments = document.pages?.length
      ? document.pages
      : [{ number: null, start: 0, end: document.content.length }];
    const passages = [];

    for (const segment of segments) {
      const content = document.content.slice(segment.start, segment.end);
      let lineNumber = 1;
      let previousIndex = 0;
      let previousLineStart = -1;

      for (const match of content.matchAll(pattern)) {
        for (let offset = previousIndex; offset < match.index; offset++) {
          if (content[offset] === '\n') lineNumber++;
        }
        previousIndex = match.index;

        const lineStart = content.lastIndexOf('\n', match.index - 1) + 1;
        if (lineStart === previousLineStart) continue;
        previousLineStart = lineStart;

        const nextBreak = content.indexOf('\n', match.index + match[0].length);
        const lineEnd = nextBreak === -1 ? content.length : nextBreak;
        const start = match.index - lineStart > 160 ? match.index : lineStart;
        const end = Math.min(lineEnd, match.index + match[0].length + 200);
        const text = content.slice(start, end).trim().replace(/\s+/g, ' ');

        passages.push({
          page: segment.number,
          line: lineNumber,
          excerpt: (start > lineStart ? '… ' : '') + text + (end < lineEnd ? '…' : '')
        });

        if (passages.length >= maxPassages) return passages;
      }
    }

    return passages;
  }

  async searchDocumentContents(query, roots = this.allowedRoots) {
    this.requireMac();
    this.validateText(query, 'search query', 200);
    if (!Array.isArray(roots)) throw new Error('Search locations must be a list.');

    const items = [];
    const visitedDirectories = new Set();
    const visitedFiles = new Set();
    const warnings = [];
    const deadline = Date.now() + 30000;
    let scanned = 0;
    let skipped = 0;
    let depthLimited = false;

    const limitReached = () => {
      interruption.checkpoint();
      return items.length >= 8 ||
        scanned >= 500 ||
        Date.now() >= deadline;
    };
    const noteFailure = (name, error) => {
      skipped++;
      if (warnings.length < 5) warnings.push(name + ' — ' + error.message);
    };

    const walk = async (directory, depth) => {
      if (limitReached()) return;
      if (depth > this.maxSearchDepth) {
        depthLimited = true;
        return;
      }

      let entries;
      let safeDirectory;
      try {
        safeDirectory = await this.getApprovedRoot(directory);
        if (safeDirectory === path.resolve(this.reportsDirectory)) return;
        if (visitedDirectories.has(safeDirectory)) return;

        visitedDirectories.add(safeDirectory);
        entries = await fs.promises.readdir(safeDirectory, { withFileTypes: true });
      } catch (error) {
        noteFailure(path.basename(directory), error);
        return;
      }

      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (limitReached()) break;
        if (
          entry.isSymbolicLink() ||
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name.endsWith('.photoslibrary')
        ) continue;

        const filePath = path.join(safeDirectory, entry.name);
        if (entry.isDirectory()) {
          await walk(filePath, depth + 1);
          continue;
        }
        if (
          !entry.isFile() ||
          !DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ||
          visitedFiles.has(filePath)
        ) continue;

        visitedFiles.add(filePath);
        scanned++;
        try {
          const result = await this.readTextFile(filePath, {
            timeoutMs: Math.max(1, Math.min(15000, deadline - Date.now()))
          });

          for (const warning of result.warnings || []) {
            if (warnings.length < 5) warnings.push(result.name + ' — ' + warning);
          }

          const [match] = this.findDocumentPassages(result, query, 1);
          if (!match) continue;

          items.push({
            name: result.name,
            path: result.path,
            type: 'file',
            extension: result.extension,
            size: result.size,
            excerpt: match.excerpt,
            page: match.page,
            line: match.line
          });
        } catch (error) {
          noteFailure(entry.name, error);
        }
      }
    };

    for (const root of roots.length ? roots : this.allowedRoots) {
      if (limitReached()) break;
      await walk(root, 0);
    }

    return { items, scanned, skipped, warnings, limited: limitReached() || depthLimited };
  }

  async readTextFile(filePath, { timeoutMs = 15000 } = {}) {
    this.requireMac();

    const realPath = await this.getApprovedRoot(filePath);
    const stat = await fs.promises.stat(realPath);
    if (!stat.isFile()) throw new Error('Please select a normal document file.');

    const extension = path.extname(realPath).toLowerCase();
    if (!DOCUMENT_EXTENSIONS.has(extension)) {
      throw new Error('EDEN can read TXT, Markdown, JSON, CSV, RTF, PDF and DOCX files.');
    }

    const richDocument = extension === '.pdf' || extension === '.docx';
    const maxBytes = richDocument ? MAX_DOCUMENT_BYTES : 2 * 1024 * 1024;
    if (stat.size > maxBytes) {
      throw new Error('The file is too large. Maximum size is ' + maxBytes / (1024 * 1024) + ' MB.');
    }

    let document;
    if (richDocument) {
      document = await extractDocumentText(realPath, extension, timeoutMs);
    } else {
      const rawContent = await fs.promises.readFile(realPath, 'utf8');
      const isRtf = extension === '.rtf' || /^\s*\{\\rtf\d?/i.test(rawContent);
      const content = isRtf
        ? await convertRtfFileToText(realPath, timeoutMs)
        : rawContent.replace(/\r\n?/g, '\n').trim();
      document = { content, pages: [], warnings: [] };
    }

    return {
      success: true,
      action: 'read-text-file',
      name: path.basename(realPath),
      path: realPath,
      extension,
      size: stat.size,
      ...document
    };
  }

  async getReportsDirectory(create = false) {
    this.requireMac();

    const parent = await this.getApprovedRoot(path.dirname(this.reportsDirectory));
    const directory = path.join(parent, path.basename(this.reportsDirectory));

    if (create) {
      try {
        await fs.promises.mkdir(directory);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }

    try {
      await fs.promises.lstat(directory);
    } catch (error) {
      if (error.code === 'ENOENT' && !create) return null;
      throw error;
    }

    const safeDirectory = await this.getApprovedRoot(directory);
    if (!(await fs.promises.stat(safeDirectory)).isDirectory()) {
      throw new Error('The EDEN Reports location is already occupied by a file.');
    }
    return safeDirectory;
  }

  async saveResearchReport(report, requestedTitle) {
    this.requireMac();

    const title = this.validateText(requestedTitle, 'report title', 120)
      .replace(/[\r\n]+/g, ' ');
    const body = this.validateText(report?.markdown, 'report content', MAX_TEXT_BYTES);
    const directory = await this.getReportsDirectory(true);
    const savedAt = new Date().toISOString();
    const id = randomUUID();
    const titleCharacters = Array.from(
      title.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    );
    const safeTitle = titleCharacters.slice(0, 40).join('').trim() || 'Research report';
    const timestamp = savedAt.replace(/[:.]/g, '-');
    const filename = timestamp + '--' + safeTitle + '--' + id + '.md';
    const filePath = path.join(directory, filename);
    const temporaryPath = path.join(directory, '.' + id + '.tmp');
    const markdown = [
      '# ' + title,
      '',
      'Prepared ' + report.createdAt,
      '',
      'Saved ' + savedAt,
      '',
      body,
      ''
    ].join('\n');

    let handle;
    try {
      handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(markdown, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.promises.link(temporaryPath, filePath);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.unlink(temporaryPath).catch(() => {});
    }

    return {
      name: filename,
      path: filePath,
      type: 'file',
      extension: '.md',
      size: Buffer.byteLength(markdown, 'utf8'),
      modifiedAt: savedAt
    };
  }

  async listResearchReports() {
    const directory = await this.getReportsDirectory();
    if (!directory) return { count: 0, items: [] };

    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.endsWith('.md')) continue;
      try {
        const filePath = await this.getApprovedRoot(path.join(directory, entry.name));
        const stat = await fs.promises.stat(filePath);
        items.push({
          name: entry.name,
          path: filePath,
          type: 'file',
          extension: '.md',
          size: stat.size,
          modifiedAt: stat.mtime.toISOString()
        });
      } catch {
        // A report can disappear while its metadata is being read.
      }
    }

    items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || b.name.localeCompare(a.name));
    return { count: items.length, items: items.slice(0, this.maxResults) };
  }

  async openFile(filePath) {
    this.requireMac();

    const safePath = await this.getApprovedRoot(filePath);
    const stat = await fs.promises.stat(safePath);

    if (!stat.isFile() && !stat.isDirectory()) {
      throw new Error('Only normal files and folders can be opened.');
    }

    const result = await shell.openPath(safePath);
    if (result) throw new Error(result);

    return {
      success: true,
      action: 'open-file',
      path: safePath,
      message: 'Opened ' + path.basename(safePath) + '.'
    };
  }
}

interruption.guardAsyncMethods(MacControl);
module.exports = MacControl;