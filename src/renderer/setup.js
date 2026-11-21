'use strict';
const form = document.querySelector('#setup');
const button = document.querySelector('#save');
const status = document.querySelector('#status');
status.textContent = new URLSearchParams(location.search).get('notice') || '';
form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = 'Finding and testing a Gemini chat model…';
  try {
    const result = await window.edenSetup.save({ name: document.querySelector('#name').value, key: document.querySelector('#key').value, model: document.querySelector('#model').value });
    status.textContent = result.ok ? 'Connected. Opening EDEN…' : result.message;
    if (result.ok) document.querySelector('#key').value = '';
  } catch { status.textContent = 'Setup could not complete. Try again.'; }
  finally { button.disabled = false; }
});
