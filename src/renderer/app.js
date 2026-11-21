
'use strict';

const statusElement = document.getElementById('status');
const messagesElement = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');

let wakeWordUnsubscribers = [];
let currentExplorerFolder = null;
let explorerHistory = [];
let explorerBusy = false;

function addMessage(role, text) {
  const message = document.createElement('div');

  message.className = role === 'user'
    ? 'message user-message'
    : 'message assistant-message';

  const heading = document.createElement('strong');
  heading.textContent = role === 'user' ? 'YOU' : 'EDEN';

  const paragraph = document.createElement('p');
  paragraph.textContent = text;

  message.append(heading, paragraph);
  messagesElement.appendChild(message);
  messagesElement.scrollTop = messagesElement.scrollHeight;

  return message;
}

function updateStatus(text) {
  if (statusElement) {
    statusElement.textContent = text;
  }
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;

  return element;
}

function formatFileSize(bytes) {
  if (typeof bytes !== 'number') return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleDateString();
}

function setControlFeedback(text) {
  const element = document.getElementById('eden-control-feedback');
  if (element) element.textContent = text;
}

function setExplorerFeedback(text) {
  const element = document.getElementById('eden-explorer-feedback');
  if (element) element.textContent = text;
}

function addControlStyles() {
  if (document.getElementById('eden-control-styles')) return;

  const style = document.createElement('style');
  style.id = 'eden-control-styles';

  style.textContent = `
    .eden-control-panel {
      margin: 18px 0;
      padding: 18px;
      border: 1px solid rgba(85,160,255,.24);
      border-radius: 18px;
      background: rgba(12,29,55,.78);
      color: #eaf4ff;
    }

    .eden-control-heading {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }

    .eden-control-heading h2 {
      margin: 0;
      font-size: 17px;
    }

    .eden-control-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit,minmax(125px,1fr));
      gap: 9px;
    }

    .eden-control-button {
      padding: 12px 10px;
      border: 1px solid rgba(100,170,255,.22);
      border-radius: 12px;
      background: rgba(45,91,150,.22);
      color: #eaf4ff;
      cursor: pointer;
      font-size: 13px;
      transition: background .2s,border-color .2s;
    }

    .eden-control-button:hover {
      background: rgba(55,130,220,.35);
      border-color: #63aaff;
    }

    .eden-control-button:disabled {
      opacity: .5;
      cursor: wait;
    }

    .eden-control-search {
      display: flex;
      gap: 8px;
      margin-top: 15px;
    }

    .eden-control-search input {
      flex: 1;
      min-width: 0;
      padding: 12px;
      border: 1px solid rgba(100,170,255,.3);
      border-radius: 10px;
      background: #09182b;
      color: white;
    }

    .eden-control-results {
      margin-top: 12px;
      display: grid;
      gap: 8px;
    }

    .eden-control-result {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 10px;
      border-radius: 10px;
      background: rgba(255,255,255,.05);
      overflow-wrap: anywhere;
    }

    .eden-control-result button {
      padding: 7px 12px;
      border: 0;
      border-radius: 8px;
      background: #1767bd;
      color: white;
      cursor: pointer;
      flex-shrink: 0;
    }

    .eden-control-feedback {
      margin: 12px 0 0;
      color: #9ecbff;
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .eden-explorer {
      margin-top: 18px;
      padding-top: 16px;
      border-top: 1px solid rgba(100,170,255,.2);
    }

    .eden-explorer-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 12px;
    }

    .eden-explorer-top h3 {
      margin: 0;
      font-size: 15px;
    }

    .eden-explorer-toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .eden-explorer-toolbar button,
    .eden-explorer-locations button {
      padding: 9px 11px;
      border: 1px solid rgba(100,170,255,.22);
      border-radius: 9px;
      background: rgba(45,91,150,.22);
      color: #eaf4ff;
      cursor: pointer;
    }

    .eden-explorer-locations {
      display: grid;
      grid-template-columns: repeat(auto-fit,minmax(105px,1fr));
      gap: 7px;
      margin-bottom: 12px;
    }

    .eden-explorer-locations button {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .eden-explorer-path {
      margin: 8px 0 12px;
      color: #9ecbff;
      font-size: 11px;
      overflow-wrap: anywhere;
    }

    .eden-explorer-list {
      display: grid;
      gap: 7px;
    }

    .eden-explorer-item {
      display: grid;
      grid-template-columns: minmax(0,1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 11px;
      border: 1px solid rgba(100,170,255,.12);
      border-radius: 10px;
      background: rgba(255,255,255,.035);
    }

    .eden-explorer-item-main {
      min-width: 0;
    }

    .eden-explorer-name {
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .eden-explorer-meta {
      margin-top: 5px;
      color: #91a9c8;
      font-size: 10px;
      overflow-wrap: anywhere;
    }

    .eden-explorer-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .eden-explorer-actions button {
      padding: 7px 9px;
      border: 0;
      border-radius: 7px;
      background: #1767bd;
      color: white;
      cursor: pointer;
      font-size: 11px;
    }

    .eden-explorer-actions button.preview {
      background: #275078;
    }

    .eden-explorer-empty {
      padding: 18px;
      text-align: center;
      color: #91a9c8;
      font-size: 12px;
    }

    .eden-preview-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
      background: rgba(0,0,0,.82);
    }

    .eden-preview-window {
      width: min(100%,1000px);
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(100,170,255,.35);
      border-radius: 16px;
      background: #071426;
      color: white;
    }

    .eden-preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 13px;
      border-bottom: 1px solid rgba(100,170,255,.2);
    }

    .eden-preview-title {
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: 13px;
    }

    .eden-preview-close {
      padding: 8px 12px;
      border: 0;
      border-radius: 8px;
      background: #1767bd;
      color: white;
      cursor: pointer;
    }

    .eden-preview-content {
      min-height: 180px;
      overflow: auto;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 12px;
    }

    .eden-preview-content img {
      display: block;
      max-width: 100%;
      max-height: 72vh;
      object-fit: contain;
    }

    .eden-preview-content iframe {
      width: 100%;
      height: 72vh;
      border: 0;
      background: white;
    }

    @media(max-width:600px) {
      .eden-explorer-item {
        grid-template-columns: 1fr;
      }

      .eden-explorer-actions {
        justify-content: flex-start;
      }
    }
  `;

  document.head.appendChild(style);
}

function createMacControlPanel() {
  if (document.getElementById('eden-mac-controls')) return;

  const panel = document.createElement('section');
  panel.id = 'eden-mac-controls';
  panel.className = 'eden-control-panel';

  panel.innerHTML = `
    <div class="eden-control-heading">
      <h2>EDEN · MAC CONTROL</h2>
      <span id="eden-mac-connection">Checking...</span>
    </div>

    <div class="eden-control-grid">
      <button class="eden-control-button" data-app="calculator">Calculator</button>
      <button class="eden-control-button" data-app="finder">Finder</button>
      <button class="eden-control-button" data-app="safari">Safari</button>
      <button class="eden-control-button" data-app="chrome">Chrome</button>
      <button class="eden-control-button" data-app="spotify">Spotify</button>
      <button class="eden-control-button" data-app="vscode">VS Code</button>
      <button class="eden-control-button" data-app="notes">Notes</button>
      <button class="eden-control-button" data-app="settings">Settings</button>
    </div>

    <div class="eden-control-search">
      <input id="eden-file-query" type="text"
        placeholder="Search files on your Mac..."
        autocomplete="off" />
      <button class="eden-control-button" id="eden-file-search-button">
        SEARCH
      </button>
    </div>

    <div class="eden-control-grid" style="margin-top:10px">
      <button class="eden-control-button" id="eden-google-button">
        Open Google
      </button>
    </div>

    <div class="eden-control-results" id="eden-file-results"></div>

    <div class="eden-explorer" id="eden-explorer">
      <div class="eden-explorer-top">
        <h3>FILE EXPLORER</h3>
        <span id="eden-explorer-count">Choose a location</span>
      </div>

      <div class="eden-explorer-toolbar">
        <button id="eden-explorer-parent">↑ Parent folder</button>
        <button id="eden-explorer-refresh">↻ Refresh</button>
      </div>

      <div class="eden-explorer-locations" id="eden-explorer-locations"></div>
      <div class="eden-explorer-path" id="eden-explorer-path"></div>
      <div class="eden-explorer-list" id="eden-explorer-list">
        <div class="eden-explorer-empty">Loading approved locations...</div>
      </div>
      <p class="eden-control-feedback" id="eden-explorer-feedback"
        aria-live="polite">File Explorer ready.</p>
    </div>

    <p class="eden-control-feedback" id="eden-control-feedback"
      aria-live="polite">Mac controls ready.</p>
  `;

  if (chatForm?.parentElement) {
    chatForm.parentElement.insertBefore(panel, chatForm);
  } else {
    document.body.appendChild(panel);
  }

  return panel;
}

function setControlFeedback(text) {
  const element = document.getElementById('eden-control-feedback');
  if (element) element.textContent = text;
}

function setExplorerFeedback(text) {
  const element = document.getElementById('eden-explorer-feedback');
  if (element) element.textContent = text;
}

async function runControlAction(button, action) {
  if (!button) return;

  button.disabled = true;
  setControlFeedback('EDEN is working...');

  try {
    await action();
  } catch (error) {
    console.error('EDEN Mac control:', error);
    setControlFeedback(error.message || 'Action failed.');
  } finally {
    button.disabled = false;
  }
}

function createExplorerButton(label, onClick, className = '') {
  const button = createElement(
    'button',
    className,
    label
  );

  button.type = 'button';
  button.addEventListener('click', onClick);

  return button;
}

async function loadExplorerLocations() {
  const mac = window.eden?.mac;
  const container = document.getElementById('eden-explorer-locations');

  if (!mac?.getLocations || !container) {
    setExplorerFeedback('File Explorer bridge unavailable.');
    return;
  }

  try {
    const result = await mac.getLocations();
    container.replaceChildren();

    for (const location of result.items || []) {
      const button = createExplorerButton(
        location.name,
        () => openExplorerFolder(location.path)
      );

      button.title = location.path;
      container.appendChild(button);
    }

    if (!result.items?.length) {
      setExplorerFeedback('No approved locations are available.');
    } else {
      setExplorerFeedback('Choose a location to browse.');
    }
  } catch (error) {
    console.error('EDEN locations:', error);
    setExplorerFeedback(error.message || 'Could not load locations.');
  }
}

async function openExplorerFolder(folderPath, remember = true) {
  const mac = window.eden?.mac;
  const list = document.getElementById('eden-explorer-list');

  if (!mac?.listFolder || explorerBusy) return;

  explorerBusy = true;

  if (list) {
    list.replaceChildren(
      createElement('div', 'eden-explorer-empty', 'Loading folder...')
    );
  }

  setExplorerFeedback('Opening folder...');

  try {
    const result = await mac.listFolder(folderPath);

    if (remember && currentExplorerFolder) {
      explorerHistory.push(currentExplorerFolder);
    }

    currentExplorerFolder = result.folder;

    renderExplorerItems(result.items || [], result);

    const pathLabel = document.getElementById('eden-explorer-path');
    const countLabel = document.getElementById('eden-explorer-count');
    const parentButton = document.getElementById('eden-explorer-parent');

    if (pathLabel) pathLabel.textContent = result.folder;
    if (countLabel) countLabel.textContent = `${result.count} items`;
    if (parentButton) parentButton.disabled = !result.parentPath;

    setExplorerFeedback(`Browsing ${result.folder}`);
  } catch (error) {
    console.error('EDEN folder navigation:', error);

    if (list) {
      list.replaceChildren(
        createElement(
          'div',
          'eden-explorer-empty',
          error.message || 'Could not open this folder.'
        )
      );
    }

    setExplorerFeedback(error.message || 'Folder could not be opened.');
  } finally {
    explorerBusy = false;
  }
}

function renderExplorerItems(items, folderResult) {
  const container = document.getElementById('eden-explorer-list');
  if (!container) return;

  container.replaceChildren();

  if (!items.length) {
    container.appendChild(
      createElement('div', 'eden-explorer-empty', 'This folder is empty.')
    );
    return;
  }

  for (const item of items) {
    const row = createElement('div', 'eden-explorer-item');
    const main = createElement('div', 'eden-explorer-item-main');

    const icon = item.type === 'folder' ? '📁' : '📄';
    const name = createElement(
      'div',
      'eden-explorer-name',
      `${icon} ${item.name}`
    );

    const details = [
      item.type,
      item.extension || '',
      item.type === 'file' ? formatFileSize(item.size) : '',
      formatDate(item.modifiedAt)
    ].filter(Boolean).join(' · ');

    const meta = createElement('div', 'eden-explorer-meta', details);

    main.append(name, meta);

    const actions = createElement('div', 'eden-explorer-actions');

    if (item.type === 'folder') {
      actions.appendChild(
        createExplorerButton('OPEN FOLDER', () =>
          openExplorerFolder(item.path)
        )
      );
    } else {
      actions.appendChild(
        createExplorerButton('OPEN', async () => {
          try {
            await window.eden.mac.openFile(item.path);
            setExplorerFeedback(`Opened ${item.name} in its Mac app.`);
          } catch (error) {
            setExplorerFeedback(error.message || 'Could not open file.');
          }
        })
      );

      const extension = (item.extension || '').toLowerCase();

      if (
        ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf'].includes(extension)
      ) {
        actions.appendChild(
          createExplorerButton(
            'PREVIEW',
            () => previewExplorerFile(item.path),
            'preview'
          )
        );
      }
    }

    row.append(main, actions);
    container.appendChild(row);
  }
}

async function previewExplorerFile(filePath) {
  const mac = window.eden?.mac;

  if (!mac?.previewFile) {
    setExplorerFeedback('Preview bridge unavailable.');
    return;
  }

  setExplorerFeedback('Preparing preview...');

  try {
    const result = await mac.previewFile(filePath);
    showPreviewWindow(result);
    setExplorerFeedback(`Previewing ${result.name}.`);
  } catch (error) {
    console.error('EDEN preview:', error);
    setExplorerFeedback(error.message || 'Preview could not be opened.');
  }
}

function showPreviewWindow(file) {
  closePreviewWindow();

  const overlay = createElement('div', 'eden-preview-overlay');
  overlay.id = 'eden-preview-overlay';

  const windowElement = createElement('div', 'eden-preview-window');

  const header = createElement('div', 'eden-preview-header');
  const title = createElement('div', 'eden-preview-title', file.name);

  const closeButton = createExplorerButton(
    'CLOSE',
    closePreviewWindow,
    'eden-preview-close'
  );

  header.append(title, closeButton);

  const content = createElement('div', 'eden-preview-content');

  if (file.mimeType.startsWith('image/')) {
    const image = document.createElement('img');
    image.alt = file.name;
    image.src = file.dataUrl;
    content.appendChild(image);
  } else if (file.mimeType === 'application/pdf') {
    const frame = document.createElement('iframe');
    frame.title = `PDF preview: ${file.name}`;
    frame.src = file.dataUrl;
    content.appendChild(frame);
  } else {
    content.appendChild(
      createElement('p', 'eden-explorer-empty', 'Preview not supported.')
    );
  }

  windowElement.append(header, content);
  overlay.appendChild(windowElement);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closePreviewWindow();
  });

  document.body.appendChild(overlay);
}

function closePreviewWindow() {
  document.getElementById('eden-preview-overlay')?.remove();
}

function connectMacControls() {
  const mac = window.eden?.mac;

  if (!mac) {
    setControlFeedback('Mac-control bridge unavailable.');
    return;
  }

  const connection = document.getElementById('eden-mac-connection');
  if (connection) connection.textContent = 'CONNECTED';

  document.querySelectorAll('[data-app]').forEach((button) => {
    button.addEventListener('click', () => {
      runControlAction(button, async () => {
        const result = await mac.openApp(button.dataset.app);

        setControlFeedback(result.message);
      });
    });
  });

  const googleButton = document.getElementById('eden-google-button');

  googleButton?.addEventListener('click', () => {
    runControlAction(googleButton, async () => {
      await mac.openWebsite('https://www.google.com');
      setControlFeedback('Google opened in your browser.');
    });
  });

  const searchButton = document.getElementById('eden-file-search-button');
  const searchInput = document.getElementById('eden-file-query');

  searchButton?.addEventListener('click', () => {
    runControlAction(searchButton, async () => {
      const query = searchInput.value.trim();

      if (!query) {
        setControlFeedback('Enter a file name to search.');
        return;
      }

      const result = await mac.searchFiles(query, []);
      displayFileResults(result.items || []);

      setControlFeedback(
        `${result.count || 0} matching item(s) found.`
      );
    });
  });

  searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchButton?.click();
    }
  });

  document.getElementById('eden-explorer-parent')?.addEventListener(
    'click',
    async () => {
      if (!currentExplorerFolder || !mac.getLocations) return;

      try {
        const locations = await mac.getLocations();
        const current = locations.items?.find((location) =>
          currentExplorerFolder === location.path
        );

        if (current) {
          setExplorerFeedback('You are already at the top of this location.');
          return;
        }

        const parent = currentExplorerFolder.replace(/\/[^/]+$/, '');

        await openExplorerFolder(parent, false);
      } catch (error) {
        setExplorerFeedback(error.message || 'Could not navigate upward.');
      }
    }
  );

  document.getElementById('eden-explorer-refresh')?.addEventListener(
    'click',
    () => {
      if (currentExplorerFolder) {
        openExplorerFolder(currentExplorerFolder, false);
      } else {
        loadExplorerLocations();
      }
    }
  );

  void loadExplorerLocations();
}

function displayFileResults(items) {
  const container = document.getElementById('eden-file-results');
  if (!container) return;

  container.replaceChildren();

  if (!items.length) {
    container.appendChild(
      createElement('p', 'eden-explorer-empty', 'No matching files found.')
    );
    return;
  }

  for (const item of items) {
    const row = createElement('div', 'eden-control-result');

    const label = createElement(
      'span',
      '',
      `${item.type === 'folder' ? '📁' : '📄'} ${item.name}`
    );

    row.appendChild(label);

    const openButton = createElement('button', '', 'OPEN');

    openButton.addEventListener('click', async () => {
      try {
        if (item.type === 'folder') {
          await openExplorerFolder(item.path);
        } else {
          await window.eden.mac.openFile(item.path);
          setControlFeedback(`${item.name} opened.`);
        }
      } catch (error) {
        setControlFeedback(error.message || 'Could not open item.');
      }
    });

    row.appendChild(openButton);
    container.appendChild(row);
  }
}
function displayChatFileResults(messageElement, items) {
  if (!messageElement || !Array.isArray(items)) return;

  const resultsContainer = createElement(
    'div',
    'eden-chat-file-results'
  );

  for (const item of items) {
    const card = createElement(
      'div',
      'eden-chat-file-card'
    );

    const info = createElement('div', 'eden-chat-file-info');

    const icon = createElement(
      'span',
      'eden-chat-file-icon',
      item.type === 'folder' ? '📁' : '📄'
    );

    const details = createElement('div');

    const name = createElement(
      'div',
      'eden-chat-file-name',
      item.name
    );

    const meta = createElement(
      'div',
      'eden-chat-file-meta',
      [
        item.type,
        item.extension || '',
        item.type === 'file' ? formatFileSize(item.size) : ''
      ].filter(Boolean).join(' · ')
    );

    details.append(name, meta);
    info.append(icon, details);

    const openButton = createExplorerButton(
      item.type === 'folder' ? 'OPEN FOLDER' : 'OPEN FILE',
      async () => {
        openButton.disabled = true;
        openButton.textContent = 'OPENING...';

        try {
          await window.eden.mac.openFile(item.path);

          openButton.textContent = 'OPENED ✓';
        } catch (error) {
          openButton.disabled = false;
          openButton.textContent = 'TRY AGAIN';

          console.error('EDEN chat file opening:', error);
          setControlFeedback(
            error.message || 'Could not open this item.'
          );
        }
      },
      'eden-chat-open-button'
    );

    card.append(info, openButton);
    resultsContainer.appendChild(card);
  }

  messageElement.appendChild(resultsContainer);
  messagesElement.scrollTop = messagesElement.scrollHeight;
}
function connectWakeWordEvents() {
  const wakeWord = window.eden?.wakeWord;
  if (!wakeWord) return;

  function subscribe(method, callback) {
    if (typeof wakeWord[method] !== 'function') return;
    const unsubscribe = wakeWord[method](callback);
    if (typeof unsubscribe === 'function') {
      wakeWordUnsubscribers.push(unsubscribe);
    }
  }

  subscribe('onMeter', level => window.edenStage?.meter?.(level));

  subscribe('onCommand', command => {
    if (isImmediateStop(command) || !sendButton.disabled) void sendChatMessage(command, true);
  });

  subscribe('onDetected', () => {
    window.edenStage?.activity?.('listening');
    updateStatus('WAKE WORD DETECTED');
  });

  subscribe('onStateChanged', data => {
    const state = typeof data === 'string' ? data : data?.state;
    if (state) updateStatus(`WAKE SYSTEM · ${state.toUpperCase()}`);
  });

  subscribe('onError', error => {
    console.error('EDEN wake-word error:', error);
    updateStatus('WAKE SYSTEM UNAVAILABLE');
  });
}
async function speakReply(text) {
  const message = text.trim().slice(0, 1200);
  if (!message) return false;

  try {
    window.edenStage?.activity?.('speaking');
    return (await window.eden.speakTara(message)) === true;
  } finally {
    window.edenStage?.activity?.('idle');
  }
}

async function greetOnStartup() {
  const generation = interruptionGeneration;
  const storageKey = 'eden-recent-greetings-v2';

  let recent = [];

  try {
    const saved = JSON.parse(
      localStorage.getItem(storageKey) || '[]'
    );

    if (Array.isArray(saved)) {
      recent = saved
        .filter(value => typeof value === 'string')
        .slice(-12);
    }
  } catch {}

  let greeting = null;

  try {
    greeting = await window.eden.startupGreeting(recent);
  } catch (error) {
    console.warn('EDEN greeting generation:', error.message);
  }

  // Do not speak a late greeting after the user presses Stop.
  if (generation !== interruptionGeneration) return;

  if (typeof greeting !== 'string' || !greeting.trim()) {
    const hour = new Date().getHours();

    const timeGreeting = hour < 12
      ? 'Morning, Tushar. What shall we get into today?'
      : hour < 17
        ? 'Hey Tushar. What’s on your mind this afternoon?'
        : 'Evening, Tushar. Where shall we begin?';

    const alternatives = [
      timeGreeting,
      'Hey Tushar. What are we making happen today?',
      'There you are, Tushar. What’s the plan?',
      'Hey, Tushar. You have my attention.',
      'Welcome back. Shall we pick something to work on?',
      'Hi Tushar. A little conversation, or straight into something?',
      'Hey Tushar. Ready whenever you are.',
      'Good to see you. What shall we tackle first?'
    ];

    const available = alternatives.filter(
      value => !recent.includes(value)
    );

    const choices = available.length
      ? available
      : alternatives.filter(value => value !== recent.at(-1));

    greeting = choices[Math.floor(Math.random() * choices.length)];
  }

  greeting = greeting.trim();

  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify([...recent, greeting].slice(-12))
    );
  } catch {}

  addMessage('assistant', greeting);

  try {
    await speakReply(greeting);
  } catch (error) {
    console.warn(
      'EDEN startup greeting playback failed:',
      error.message
    );
  }
}

async function initializeEDEN() {
  try {
    const result = await window.eden.getStatus();
    const platform = (result.platform || 'mac').toUpperCase();
    updateStatus(`CORE ONLINE · ${platform}`);
    connectWakeWordEvents();
    return true;
  } catch (error) {
    updateStatus('CORE CONNECTION ERROR');
    console.error('EDEN initialization:', error);
    return false;
  }
}
let interruptionGeneration = 0;

function isImmediateStop(value) {
  const text = String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.,!?;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return /^(?:(?:(?:hey|hi|hello) )?(?:eden|aiden|hayden) )?(?:please )?(?:stop|cancel|stop speaking|stop talking|stop searching|stop working|stop everything|cancel that|cancel the request|stop the task)(?: please)?$/.test(text);
}

function markInterrupted() {
  interruptionGeneration++;
  window.speechSynthesis?.cancel();
  window.edenStage?.activity?.('idle');
  updateStatus('INTERRUPTED');
}

async function interruptEDEN() {
  markInterrupted();

  try {
    await window.eden.interrupt();
  } catch (error) {
    updateStatus('COULD NOT INTERRUPT');
    console.error(error);
  }
}

window.eden.onInterrupted?.(markInterrupted);

const stopSpeakingButton = document.createElement('button');
stopSpeakingButton.type = 'button';
stopSpeakingButton.textContent = 'Stop speaking';

stopSpeakingButton.textContent = 'Stop';

stopSpeakingButton.addEventListener('click', () => {
  void interruptEDEN();
});

sendButton.after(stopSpeakingButton);

messageInput.addEventListener('keydown', event => {
  if (
    event.key === 'Enter' &&
    !event.shiftKey &&
    isImmediateStop(messageInput.value)
  ) {
    event.preventDefault();
    messageInput.value = '';
    void interruptEDEN();
  }
});

chatForm.addEventListener('submit', event => {
  event.preventDefault();

  const message = messageInput.value.trim();
  if (!message || (sendButton.disabled && !isImmediateStop(message))) return;

  messageInput.value = '';
  void sendChatMessage(message);
});
async function sendChatMessage(message, spoken = false) {
  if (isImmediateStop(message)) {
    await interruptEDEN();
    return;
  }

  const generation = interruptionGeneration;
  const interrupted = () => generation !== interruptionGeneration;
    window.edenAvatar?.reactToMessage?.(message);
    if (window.edenAvatar?.isFormCommand(message)) {
    if (sendButton.disabled) return;

    sendButton.disabled = true;
    sendButton.textContent = 'WAIT...';
    addMessage('user', message);

    try {
      const answer = await window.edenAvatar.handleCommand(message);
      if (typeof answer !== 'string' || !answer.trim()) {
        throw new Error('The avatar controller did not return an action result.');
      }
      if (interrupted()) return;
      addMessage('assistant', answer);

      try {
        await speakReply(answer);
      } catch (error) {
        console.warn('EDEN avatar reply playback:', error.message);
      }
    } catch (error) {
      console.error('EDEN local avatar action failed:', error);
      if (!interrupted()) {
        addMessage(
          'assistant',
          'I could not perform the avatar action. ' + error.message
        );
      }
    } finally {
      sendButton.disabled = false;
      sendButton.textContent = 'SEND';
      if (!spoken) messageInput.focus();
    }

    return;
  }

  if (window.edenCoder?.isCommand(message)) {
    if (sendButton.disabled) return;
    sendButton.disabled = true;
    sendButton.textContent = 'WAIT...';
    addMessage('user', message);
    try {
      const answer = await window.edenCoder.handle(message);
      if (interrupted()) return;
      addMessage('assistant', answer);
      try { await speakReply(answer); }
      catch (error) { console.warn('Coding reply speech:', error.message); }
    } catch (error) {
      if (!interrupted()) addMessage('assistant', error.message);
    } finally {
      sendButton.disabled = false;
      sendButton.textContent = 'SEND';
      if (!spoken) messageInput.focus();
    }
    return;
  }

  if (sendButton.disabled) return;
    const viewCommand = message.trim()
    .toLowerCase()
    .replace(/^(?:(?:hey|hi)\s+)?eden[,\s]+/, '')
    .replace(/[.!?]+$/, '');

  if (/^(?:show|open) (?:the )?(?:conversation|transcript|chat)$/.test(viewCommand)) {
    window.edenStage?.setConversation?.(true);
    return;
  }

  if (/^(?:hide|close) (?:the )?(?:conversation|transcript|chat)$/.test(viewCommand)) {
    window.edenStage?.setConversation?.(false);
    return;
  }

  window.edenStage?.showReply?.();
  window.edenStage?.activity?.('thinking');
  addMessage('user', message);
  sendButton.disabled = true;
  sendButton.textContent = 'WAIT...';

  const reply = addMessage('assistant', 'Thinking...');
  const paragraph = reply.querySelector('p');

  try {
    let result = await window.eden.sendMessage(message);

    if (interrupted() || result?.interrupted) {
      paragraph.hidden = false;
      paragraph.textContent = 'Interrupted.';
      return;
    }

if (result?.action === 'client-intent') {
  const intent = result.matches?.[0];

  if (
    !intent ||
    typeof intent.command !== 'string'
  ) {
    throw new Error('The intent reply was incomplete.');
  }

  if (intent.route === 'avatar') {
    if (
      !window.edenAvatar?.isFormCommand(intent.command)
    ) {
      throw new Error(
        'This avatar action is not connected in the current build.'
      );
    }

    const answer =
      await window.edenAvatar.handleCommand(
        intent.command
      );

    if (interrupted()) return;

    if (!answer) {
      throw new Error(
        'The avatar did not return an action result.'
      );
    }

    paragraph.textContent = answer;
    paragraph.hidden = false;

    try {
      await speakReply(answer);
    } catch (error) {
      console.warn(
        'EDEN avatar speech:',
        error.message
      );
    }

    return;
  }

  if (intent.route === 'view') {
    if (
      ![
        'show conversation',
        'hide conversation'
      ].includes(intent.command)
    ) {
      throw new Error('Unknown interface command.');
    }

    const open =
      intent.command === 'show conversation';

    window.edenStage?.setConversation?.(open);

    paragraph.textContent = open
      ? 'Conversation opened.'
      : 'Conversation hidden.';

    paragraph.hidden = false;
    return;
  }

  const projectCommands = [
    'choose coding project',
    'preview my website',
    'test my project',
    'install project dependencies',
    'connect publishing',
    'link this project to vercel',
    'make my website live',
    'stop coding'
  ];

  if (
    intent.route !== 'project' ||
    !projectCommands.includes(intent.command)
  ) {
    throw new Error('Unsupported routed command.');
  }

  // Keep the existing project workflow and approval dialogs.
  result = await window.eden.sendMessage(
    intent.command
  );

  if (interrupted() || result?.interrupted) return;

  if (result?.action === 'client-intent') {
    throw new Error(
      'The conversational project workflow is not connected to this command.'
    );
  }
}
    const answer = result?.reply?.trim();
    if (!answer) throw new Error(result?.error || 'EDEN returned an empty reply.');

    paragraph.textContent = result.speechError
      ? `${answer}\n\nTara playback failed: ${result.speechError}`
      : answer;
    paragraph.hidden = result.spoken === true && !result.speechError;

    if (result.action === 'file-search' && Array.isArray(result.matches)) {
      displayChatFileResults(reply, result.matches);
    }
  } catch (error) {
    paragraph.hidden = false;

    if (interrupted()) {
      paragraph.textContent = 'Interrupted.';
      return;
    }

    paragraph.textContent = `I couldn't complete that request. ${error.message}`;
  } finally {
    window.edenStage?.activity?.('idle');
    sendButton.disabled = false;
    sendButton.textContent = 'SEND';
    if (!spoken) messageInput.focus();
  }
}

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') closePreviewWindow();
});

window.addEventListener('beforeunload', () => {
  closePreviewWindow();

  for (const unsubscribe of wakeWordUnsubscribers) {
    try {
      unsubscribe();
    } catch (error) {
      console.warn('EDEN could not remove a wake-word listener:', error);
    }
  }

  wakeWordUnsubscribers = [];
});

void initializeEDEN().then(async ready => {
  if (!ready) return;

  sendButton.disabled = true;
  try {
    await greetOnStartup();
  } catch (error) {
    console.warn('EDEN startup greeting:', error.message);
  } finally {
    sendButton.disabled = false;
  }

  try {
    const voice = await window.eden.wakeWord?.start();
    if (voice?.lastError) updateStatus(voice.lastError);
  } catch (error) {
    console.error('EDEN wake-word startup:', error);
    updateStatus('WAKE SYSTEM UNAVAILABLE');
  }
});