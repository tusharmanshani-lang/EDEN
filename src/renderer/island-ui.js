
'use strict';

const panel = document.querySelector('.island');
const title = document.getElementById('title');
const detail = document.getElementById('detail');

window.edenIsland.onState(state => {
  panel.dataset.mode = state.mode;

  const song = state.music?.title;
  const source = state.music?.source || '';

  const labels = {
    speaking: 'Speaking',
    thinking: 'Thinking',
    listening: 'Listening',
    idle: 'Ready'
  };

  if (state.mode === 'music') {
    title.textContent = song || state.title;
    detail.textContent = source || state.detail;
  } else {
    title.textContent = labels[state.mode] || 'Ready';
    detail.textContent = song
      ? '♫ ' + song
      : state.mode === 'speaking'
        ? 'Tap stop to interrupt'
        : state.mode === 'thinking'
          ? 'Working on your request'
          : state.mode === 'listening'
            ? 'Go ahead'
            : 'EDEN is here';
  }

  title.title = title.textContent;
  detail.title = song
    ? song + (source ? ' · ' + source : '')
    : detail.textContent;
});

document.getElementById('stop').addEventListener('click', () => {
  window.edenIsland.stop();
});

document.getElementById('open').addEventListener('click', () => {
  window.edenIsland.open();
});
