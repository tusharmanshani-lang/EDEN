'use strict';

const path = require('node:path');
const EventEmitter = require('node:events');

/**
 * Local wake-word service. The speech adapter is loaded lazily so EDEN
 * can still start when the optional native listener is unavailable.
 */
class LocalWakeWordService extends EventEmitter {
  constructor({ appPath, adapterFactory } = {}) {
    super();
    this.appPath = appPath || process.cwd();
    this.adapterFactory = adapterFactory || null;
    this.adapter = null;
    this.session = 0;
    this.state = 'stopped';
    this.lastError = null;
    this.keywords = ['HEY EDEN', 'HI EDEN'];
  }

  getStatus() {
    return {
      available: Boolean(this.adapterFactory),
      state: this.state,
      keywords: [...this.keywords],
      localProcessing: true,
      lastError: this.lastError,
    };
  }

  async start() {
    if (this.state === 'running') return this.getStatus();

    if (!this.adapterFactory) {
      this.state = 'unavailable';
      this.lastError = 'Native listener is missing. Run bash src/voice/native/compile.sh and restart EDEN.';
      this.emit('state', this.getStatus());
      return this.getStatus();
    }

    try {
      this.state = 'starting';
      const session = ++this.session;
      const isCurrent = () => session === this.session;

      this.emit('state', this.getStatus());

      this.adapter = await this.adapterFactory({
        modelDirectory: path.join(this.appPath, 'resources', 'models', 'eden-kws'),
        keywordsFile: path.join(this.appPath, 'resources', 'keywords.txt'),
        keywords: this.keywords,
      });

      await this.adapter.start({
        onError: error => {
          if (!isCurrent()) return;
          this.state = 'error';
          this.lastError = error?.message || String(error);
          this.emit('state', this.getStatus());
        },
        onKeyword: (keyword) => {
          const normalized = String(keyword || '').trim().toUpperCase();
          if (!this.keywords.includes(normalized)) return;
          this.emit('wake', { keyword: normalized, at: Date.now(), local: true });
        },
        onCommand: (command) => {
          if (isCurrent() && this.state === 'running') {
            this.emit('command', command);
          }
        },
        onMeter: (level) => {
          if (isCurrent() && this.state === 'running' && Number.isFinite(level)) {
            this.emit('meter', level);
          }
        },
      });

      this.state = 'running';
      this.lastError = null;
    } catch (error) {
      this.state = 'error';
      this.lastError = error?.message || String(error);

      try {
        await this.adapter?.stop?.();
      } catch (_) {}

      this.adapter = null;
    }

    this.emit('state', this.getStatus());
    return this.getStatus();
  }

  async stop() {
    try {
      await this.adapter?.stop?.();
    } catch (error) {
      this.lastError = error?.message || String(error);
    }

    this.session++;
    this.adapter = null;
    this.state = 'stopped';
    this.emit('state', this.getStatus());
    return this.getStatus();
  }
}

module.exports = LocalWakeWordService;