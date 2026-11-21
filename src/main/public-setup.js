'use strict';
const { BrowserWindow, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GoogleGenAI } = require('@google/genai');
const { selectModel } = require('./model-selection');

function validate(input) {
  const name = String(input?.name || '').trim();
  const key = String(input?.key || '').trim();
  const model = String(input?.model || '').trim();
  if (!name || name.length > 60 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Enter a name of 1–60 characters.');
  if (key.length < 20 || key.length > 300 || /\s|[\x00-\x1f]/.test(key)) throw new Error('Enter a valid API key.');
  if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('Enter the Gemini model ID shown in AI Studio.');
  return { name, key, model };
}

async function ensurePublicSetup(app) {
  if (process.platform !== 'darwin') throw new Error('This release setup supports macOS only.');
  const file = path.join(app.getPath('userData'), 'account.enc');
  async function encrypt(value) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS secure storage is unavailable. Unlock your Keychain and try again.');
    return safeStorage.encryptString(JSON.stringify(value));
  }
  function activate(account) {
    process.env.GEMINI_API_KEY = account.key;
    process.env.GEMINI_MODEL = account.model;
    process.env.GEMINI_FALLBACK_MODEL = '';
    return { name: account.name, model: account.model };
  }
  let notice = '';
  try {
    const bytes = await fs.readFile(file);
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage unavailable.');
    const account = validate(JSON.parse(safeStorage.decryptString(bytes)));
    if (!account.model) throw new Error('Saved account has no model.');
    return activate(account);
  } catch (error) {
    if (error.code !== 'ENOENT') notice = 'Saved setup could not be opened. Re-enter your details to replace it.';
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let busy = false;
    const win = new BrowserWindow({ width: 570, height: 760, resizable: false, title: 'Set up EDEN', backgroundColor: '#090f1a', webPreferences: { preload: path.join(__dirname, 'setup-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    function trusted(event) {
      if (win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unknown setup requester.');
    }
    const channel = 'eden-public:save-setup';
    ipcMain.handle(channel, async (event, input) => {
      trusted(event);
      if (busy) return { ok: false, message: 'A connection test is already running.' };
      busy = true;
      try {
        const account = validate(input);
        // Fail before any network call if secure local storage is unavailable.
        if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS secure storage is unavailable. Unlock your Keychain and try again.');
        const ai = new GoogleGenAI({ apiKey: account.key, httpOptions: { timeout: 15000 } });
        account.model = await selectModel(ai, { manual: account.model, isCancelled: () => win.isDestroyed() });
        const encrypted = await encrypt(account);
        if (win.isDestroyed()) return { ok: false, message: 'Setup closed.' };
        await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        const temporary = file + '.tmp';
        await fs.writeFile(temporary, encrypted, { mode: 0o600 });
        await fs.chmod(temporary, 0o600);
        await fs.rename(temporary, file);
        settled = true;
        const profile = activate(account);
        resolve(profile);
        setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 150);
        return { ok: true };
      } catch (error) {
        // Never return SDK errors: they may include request details.
        const detail = String(error?.message || '');
        const status = Number(error?.status || error?.code || 0);
        const message = /Enter a|secure storage|Keychain|^No compatible Gemini chat model/.test(detail) ? detail
          : status === 429 || /RESOURCE_EXHAUSTED/.test(detail) ? 'Google reports a quota limit. Check your project quota or try another available model.'
          : [400, 401, 403].includes(status) ? 'Google rejected the key or model access. Check them in AI Studio.'
          : status === 404 ? 'That model was not found. Copy an available Gemini model ID from AI Studio.'
          : 'Could not finish the connection test or save setup. Check your connection and model, then try again.';
        return { ok: false, message };
      } finally { busy = false; }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.once('closed', () => { ipcMain.removeHandler(channel); if (!settled) resolve(null); });
    win.loadFile(path.join(__dirname, '../renderer/setup.html'), { query: { notice } }).catch(error => { reject(new Error('Could not open setup.')); win.destroy(); });
  });
}
module.exports = { ensurePublicSetup, validate };
