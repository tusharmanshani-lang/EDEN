'use strict';

(() => {
  if (!window.eden?.coder) return;
  const panel = document.createElement('section');
  panel.className = 'eden-coder-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'EDEN coding agent');
  panel.innerHTML = `
    <header><strong>EDEN · Coding agent</strong><button type="button" data-action="close">Close</button></header>
    <p data-project>Select the project EDEN should work on.</p>
    <div class="eden-coder-actions">
      <button type="button" data-action="select">Select project</button>
      <button type="button" data-action="folder">Open working copy</button>
    </div>
    <label for="eden-coder-task">Describe the coding task</label>
    <textarea id="eden-coder-task" maxlength="16000" rows="4" placeholder="Fix the bug, build a feature, write and test a program…"></textarea>
    <div class="eden-coder-actions">
      <button type="button" data-action="start">Start task</button>
      <button type="button" data-action="stop">Stop</button>
      <button type="button" data-action="preview">Review changes</button>
      <button type="button" data-action="apply">Apply changes</button>
      <button type="button" data-action="discard">Discard task</button>
    </div>
    <p role="status" data-state>Ready</p>
    <p role="alert" data-error></p>
    <pre data-log></pre>
    <details><summary>Changed files and review</summary><pre data-preview>No changes reviewed yet.</pre></details>
  `;
  document.body.append(panel);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = 'Coding agent';
  toggle.className = 'eden-coder-toggle';
  document.querySelector('.topbar')?.append(toggle);
  const task = panel.querySelector('textarea');
  const stateLabel = panel.querySelector('[data-state]');
  const preview = panel.querySelector('[data-preview]');
  let requesting = false, polling = false, lastID = null;
  function render(state) {
    panel.querySelector('[data-project]').textContent = state.project || 'Select a project folder.';
    const job = state.job;
    if (lastID !== job?.id) { preview.textContent = 'No changes reviewed yet.'; lastID = job?.id; }
    stateLabel.textContent = job ? job.state + (job.error ? ' · ' + job.error : '') : 'Ready';
    panel.querySelector('[data-log]').textContent = job?.log?.join('\n\n') || 'Work runs in a separate project copy. Review before applying.';
    for (const button of panel.querySelectorAll('[data-action]')) {
      const action = button.dataset.action;
      button.disabled = action === 'close' ? false : requesting || (
        action === 'stop' ? !state.busy :
        ['select', 'start', 'apply', 'discard', 'preview'].includes(action) && state.busy
      );
      if (action === 'apply') button.disabled ||= job?.state !== 'ready' || !job?.reviewed;
    }
    if (state.preview !== undefined) {
      preview.textContent = state.preview;
      panel.querySelector('details').open = true;
    }
  }
  async function invoke(action, input = {}) {
    if (requesting) throw new Error('Wait for the current coding request.');
    requesting = true;
    panel.querySelector('[data-error]').textContent = '';
    try {
      const result = await window.eden.coder(action, input);
      render(result);
      return result;
    } finally {
      requesting = false;
      void refresh();
    }
  }
  async function refresh() {
    if (polling || requesting || panel.hidden) return;
    polling = true;
    try { render(await window.eden.coder('status')); }
    catch (error) { panel.querySelector('[data-error]').textContent = error.message; }
    finally { polling = false; }
  }
  function show() { panel.hidden = false; void refresh(); }
  toggle.addEventListener('click', show);
  panel.addEventListener('click', async event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'close') { panel.hidden = true; return; }
    try { await invoke(action, action === 'start' ? { task: task.value } : {}); }
    catch (error) { panel.querySelector('[data-error]').textContent = error.message; }
  });
  const timer = setInterval(refresh, 1500);
  window.addEventListener('beforeunload', () => clearInterval(timer));
  const normalize = message => String(message || '').trim()
    .replace(/^(?:(?:hey|hi)\s+)?eden[,\s]+/i, '')
    .replace(/[.!?]+$/, '').trim();
  const actions = {
    'open coding agent': 'show', 'show coding agent': 'show',
    'select coding project': 'select', 'choose coding project': 'select',
    'coding status': 'status', 'stop coding': 'stop',
    'review coding changes': 'preview', 'apply coding changes': 'apply',
    'discard coding changes': 'discard'
  };
  window.edenCoder = {
    isCommand(message) {
      const text = normalize(message);
      return Object.hasOwn(actions, text.toLowerCase()) || /^code\s*:\s*\S/i.test(text);
    },
    async handle(message) {
      const text = normalize(message);
      show();
      const match = text.match(/^code\s*:\s*([\s\S]+)$/i);
      if (match) {
        task.value = match[1];
        const result = await invoke('start', { task: match[1] });
        return result.busy ? 'Coding started. You can follow progress in the coding panel.' : 'The coding task was not started.';
      }
      const action = actions[text.toLowerCase()];
      if (action === 'show') return 'The coding panel is open.';
      const result = await invoke(action);
      return result.job ? 'Coding task: ' + result.job.state + '.' : 'Coding panel ready. Selected project: ' + (result.project || 'none') + '.';
    }
  };
})();
