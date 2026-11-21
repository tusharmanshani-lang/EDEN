'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const categories = new Set(['appointment', 'task', 'reminder', 'project', 'priority', 'inventory', 'inquiry', 'marketing', 'follow-up', 'email draft']);
const permissions = ['read', 'open', 'edit', 'external'];

class CommandCentre {
  constructor(directory) {
    this.file = path.join(directory, 'command-centre.json');
    this.queue = Promise.resolve();
  }

  run(operation) {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }

  async load() {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { local: false, permissions: { read: true, open: true, edit: true, external: false }, entries: [], actions: [], history: [] };
    }
  }

  async save(state) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await fs.rename(temporary, this.file);
  }

  record(state, action, target, outcome) {
    state.history.unshift({ at: new Date().toISOString(), action, target, outcome });
    state.history.length = Math.min(250, state.history.length);
  }

  async guard(level, action, target, perform) {
    const state = await this.run(() => this.load());
    let outcome = 'blocked';
    try {
      if (!state.permissions[level]) throw new Error('Permission disabled for ' + level + '.');
      outcome = 'failed';
      const result = await perform();
      outcome = 'succeeded';
      return result;
    } finally {
      await this.run(async () => {
        const latest = await this.load();
        this.record(latest, action, target, outcome);
        await this.save(latest);
      });
    }
  }

  async request(type, input, mac) {
    return this.run(async () => {
      const state = await this.load();
      if (type === 'snapshot') {
        return { ...state, actions: state.actions.map(({ before, after, ...action }) => action) };
      }

      let result;
      if (type === 'settings') {
        state.local = input.local === true;
        for (const key of permissions) state.permissions[key] = input.permissions?.[key] === true;
      } else if (type === 'add') {
        if (!categories.has(input.category)) throw new Error('Choose a supported category.');
        const title = mac.validateText(input.title, 'title', 180);
        state.entries.unshift({ id: randomUUID(), category: input.category, title, date: String(input.date || '').slice(0, 24), notes: String(input.notes || '').slice(0, 10000), done: false });
      } else if (type === 'toggle') {
        const entry = state.entries.find(item => item.id === input.id);
        if (!entry) throw new Error('Item unavailable.');
        entry.done = !entry.done;
      } else if (type === 'propose') {
        if (!state.permissions.read || !state.permissions.edit) throw new Error('Enable read and edit permissions first.');
        const target = await mac.getApprovedRoot(input.target);
        if (!['.txt', '.md', '.csv', '.json'].includes(path.extname(target).toLowerCase())) throw new Error('Choose a TXT, Markdown, CSV or JSON file.');
        const stat = await fs.stat(target);
        if (!stat.isFile() || stat.size > 64000) throw new Error('Choose a text file under 64 KB.');
        if (typeof input.after !== 'string' || Buffer.byteLength(input.after) > 64000) throw new Error('Replacement must be under 64 KB.');
        const before = await fs.readFile(target, 'utf8');
        state.actions.unshift({ id: randomUUID(), target, before, after: input.after, status: 'pending' });
        this.record(state, type, target, 'pending review');
      } else if (['review', 'approve', 'reject', 'rollback'].includes(type)) {
        const action = state.actions.find(item => item.id === input.id);
        if (!action) throw new Error('Action unavailable.');
        if (type === 'review') {
          if (!state.permissions.read) throw new Error('Enable read permission first.');
          return { before: action.before, after: action.after };
        }
        if (type === 'reject' && action.status === 'pending') action.status = 'rejected';
        else {
          const rollback = type === 'rollback';
          if (!['approve', 'rollback'].includes(type) || action.status !== (rollback ? 'applied' : 'pending')) throw new Error('Action is no longer eligible.');
          if (!state.permissions.edit || !state.permissions.read) throw new Error('Enable read and edit permissions first.');
          const target = await mac.getApprovedRoot(action.target);
          if (target !== action.target) throw new Error('The file path changed.');
          const expected = rollback ? action.after : action.before;
          const replacement = rollback ? action.before : action.after;
          const current = await fs.readFile(target, 'utf8');
          if (current !== expected && current !== replacement) throw new Error('The file changed since review. Review its current version before editing.');
          if (current !== replacement) {
            const temporary = path.join(path.dirname(target), '.' + randomUUID() + '.tmp');
            try {
              await fs.writeFile(temporary, replacement, { flag: 'wx', mode: (await fs.stat(target)).mode & 0o777 });
              await fs.rename(temporary, target);
            } finally {
              await fs.rm(temporary, { force: true });
            }
          }
          action.status = rollback ? 'restored' : 'applied';
        }
        this.record(state, type, action.target, action.status);
      } else if (type === 'analytics') {
        if (!state.permissions.read) throw new Error('Enable read permission first.');
        const document = await mac.readTextFile(input.target);
        const rows = JSON.parse(document.content);
        if (!Array.isArray(rows) || !rows.length) throw new Error('Use a JSON array of sales records.');
        const products = new Map();
        for (const row of rows) {
          if (!row || typeof row.product !== 'string' || !row.product.trim() || !Number.isFinite(row.quantity) || !Number.isFinite(row.revenue)) {
            throw new Error('Every row must include product, numeric quantity and numeric revenue.');
          }
          const name = row.product.trim();
          const totals = products.get(name) || { product: name, quantity: 0, revenue: 0 };
          totals.quantity += row.quantity;
          totals.revenue += row.revenue;
          products.set(name, totals);
        }
        result = [...products.values()].sort((a, b) => b.revenue - a.revenue);
        this.record(state, 'sales analysis', document.path, 'succeeded');
      } else {
        throw new Error('Unknown command centre request.');
      }

      await this.save(state);
      return result ?? true;
    });
  }
}

module.exports = CommandCentre;
