'use strict';

(() => {
  const byId = id => document.getElementById('centre-' + id);
  const request = (type, input) => window.eden.centre(type, input);
  const element = (tag, text) => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };

  async function perform(operation) {
    byId('feedback').textContent = '';
    try {
      await operation();
    } catch (error) {
      byId('feedback').textContent = error.message;
    }
  }

  function button(label, operation) {
    const node = element('button', label);
    node.type = 'button';
    node.onclick = () => perform(operation);
    return node;
  }

  async function refresh() {
    const state = await request('snapshot');
    byId('mode').textContent = state.local ? 'Local mode · Gemini requests blocked' : 'Cloud mode · EDEN can use Gemini';
    const settings = byId('settings').elements;
    settings.local.checked = state.local;
    for (const key of ['read', 'open', 'edit']) settings[key].checked = state.permissions[key];
    byId('entries').replaceChildren(...state.entries.map(item => {
      const overdue = item.date && !item.done && Date.parse(item.date) < Date.now();
      const row = element('li', [item.category, item.title, item.date, overdue ? 'due' : '', item.notes].filter(Boolean).join(' · '));
      row.append(button(item.done ? 'Reopen' : 'Done', async () => {
        await request('toggle', { id: item.id });
        await refresh();
      }));
      return row;
    }));
    byId('history').replaceChildren(...state.history.map(event =>
      element('li', [new Date(event.at).toLocaleString(), event.action, event.target, event.outcome].filter(Boolean).join(' · '))
    ));
    byId('actions').replaceChildren(...state.actions.map(action => {
      const row = element('section', action.status + ' · ' + action.target);
      const review = element('pre', '');
      row.append(button('Review versions', async () => {
        const versions = await request('review', { id: action.id });
        review.textContent = 'CURRENT AT PROPOSAL\n' + versions.before + '\n\nPROPOSED\n' + versions.after;
        if (action.status === 'pending' && !row.querySelector('.approve-edit')) {
          const approval = button('Approve edit', () => updateAction('approve', action.id));
          approval.className = 'approve-edit';
          row.append(approval);
        }
      }), review);
      if (action.status === 'pending') row.append(button('Reject', () => updateAction('reject', action.id)));
      if (action.status === 'applied') row.append(button('Restore previous version', () => updateAction('rollback', action.id)));
      return row;
    }));
  }

  async function updateAction(type, id) {
    await request(type, { id });
    await refresh();
  }

  function form(id, operation) {
    const node = byId(id);
    node.onsubmit = event => {
      event.preventDefault();
      void perform(() => operation(Object.fromEntries(new FormData(node)), node));
    };
  }

  for (const type of ['add', 'propose']) {
    form(type, async (values, node) => {
      await request(type, values);
      node.reset();
      await refresh();
    });
  }

  form('settings', async values => {
    await request('settings', {
      local: values.local === 'on',
      permissions: Object.fromEntries(['read', 'open', 'edit'].map(key => [key, values[key] === 'on']))
    });
    await refresh();
  });

  form('analytics', async values => {
    const result = await request('analytics', values);
    byId('sales').textContent = result.map(row => row.product + ' · ' + row.quantity + ' units · ' + row.revenue.toLocaleString()).join('\n');
  });

  byId('refresh').onclick = () => perform(refresh);
  byId('health').onclick = () => perform(async () => {
    byId('health-result').textContent = JSON.stringify(await request('health'), null, 2);
  });
  byId('gemini').onclick = () => perform(async () => {
    byId('health-result').textContent = await request('gemini-check');
  });
  document.getElementById('centre').addEventListener('toggle', event => {
    if (event.target.open) void perform(refresh);
  });
})();
