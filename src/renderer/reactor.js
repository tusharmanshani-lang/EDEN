'use strict';

(() => {
  const canvas = document.getElementById('reactor');
  const ctx = canvas.getContext('2d');
  const wave = document.getElementById('voice-wave');
  const waveCtx = wave.getContext('2d');
  const chat = document.getElementById('reactor-chat');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('message-input');
  const send = document.getElementById('send-button');
  const trigger = document.getElementById('show-command');
  const close = document.getElementById('hide-command');
  const centre = document.getElementById('centre');
  const centreButton = document.getElementById('toggle-centre');
  const activity = document.getElementById('eden-activity');
  const clock = document.getElementById('eden-clock');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const nagpur = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  function updateClock() {
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.textContent = nagpur.format(now);
  }

  updateClock();
  setInterval(updateClock, 1000);

  function setConversation(open) {
    chat.hidden = !open;
    trigger.textContent = open ? 'Hide conversation' : 'Show conversation';
    trigger.setAttribute('aria-expanded', String(open));
  }

  function setCentre(open) {
    centre.hidden = !open;
    centre.open = open;
    centreButton.setAttribute('aria-expanded', String(open));
    if (open) centre.querySelector('summary').focus();
    else centreButton.focus();
  }

  trigger.addEventListener('click', () => setConversation(chat.hidden));
  close.addEventListener('click', () => {
    setConversation(false);
    trigger.focus();
  });

  centreButton.addEventListener('click', () => setCentre(centre.hidden));

  window.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;

    if (event.key === 'Escape') {
      if (!centre.hidden) setCentre(false);
      else if (!chat.hidden) {
        setConversation(false);
        trigger.focus();
      }
    } else if (
      event.key === '/' &&
      !event.metaKey && !event.ctrlKey && !event.altKey &&
      !event.target.closest?.('input, textarea, select, [contenteditable]')
    ) {
      event.preventDefault();
      input.focus();
    } else if (
      event.key.toLowerCase() === 'k' && event.shiftKey &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      setCentre(centre.hidden);
    }
  });

  document.getElementById('quick-actions').addEventListener('click', event => {
    const command = event.target.closest('button')?.dataset.command;
    if (!command || send.disabled) return;

    if (input.value.trim()) {
      input.focus();
      return;
    }

    input.value = command;
    form.requestSubmit(send);
  });

  const labels = {
    idle: 'Ready',
    listening: 'Listening',
    thinking: 'Thinking',
    speaking: 'Speaking'
  };

  let state = 'idle';
  let taraPlaying = false;

window.eden?.onTaraPlayback?.(playing => {
  taraPlaying = playing;

  if (playing) setActivity('speaking');
  else if (state === 'speaking') setActivity('idle');
});
  let stateSince = performance.now();
  let listeningTimeout;
  let meter = 0;
  let meterAt = 0;
  let width = 0;
  let height = 0;
  let scale = 1;
  let orbitTime = 0;
  let lastFrame = performance.now();

  function setActivity(next) {
    if (!Object.hasOwn(labels, next)) return;

    clearTimeout(listeningTimeout);
    if (state !== next) {
      state = next;
      stateSince = performance.now();
      activity.textContent = labels[state];
    }

    if (state === 'listening') {
      listeningTimeout = setTimeout(() => setActivity('idle'), 8000);
    }
  }

  window.edenStage = {
    showReply() { setConversation(true); },
    closeChat() { setConversation(false); },
    setConversation,
    activity: setActivity,
    meter(level) {
      if (!Number.isFinite(level)) return;
      meter = Math.max(0, Math.min(1, level));
      meterAt = performance.now();
    }
  };

  const artwork = new Image();
  artwork.addEventListener('error', () => {
    document.getElementById('core-error').hidden = false;
  });
  artwork.src = './eden-core.png';

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
  }

  const orbits = [
    { tilt: -0.48, flatten: 0.33, radius: 1.33, speed: 0.72, phase: 0.4 },
    { tilt: 0.36, flatten: 0.46, radius: 1.48, speed: -0.54, phase: 3.4 },
    { tilt: -0.93, flatten: 0.58, radius: 1.20, speed: 0.88, phase: 2.1 }
  ];

  function traceOrbit(orbit, radius, angle, x, y) {
    const rx = radius * orbit.radius;
    const ry = rx * orbit.flatten;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(orbit.tilt);

    ctx.lineWidth = 0.7;
    ctx.strokeStyle = '#469eff34';
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    const direction = Math.sign(orbit.speed);
    const segments = 15;
    for (let index = 0; index < segments; index++) {
      const strength = (index + 1) / segments;
      const from = angle - direction * 0.72 * (1 - index / segments);
      const to = from + direction * 0.72 / segments;
      ctx.strokeStyle = 'rgba(107, 220, 255, ' + strength * 0.88 + ')';
      ctx.lineWidth = 0.6 + strength * 1.8;
      ctx.shadowColor = '#268fff';
      ctx.shadowBlur = strength * 10;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, from, to, direction < 0);
      ctx.stroke();
    }

    ctx.fillStyle = '#eaffff';
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * rx, Math.sin(angle) * ry, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawWave(heard, time, moving) {
    if (!waveCtx || chat.hidden) return;

    waveCtx.clearRect(0, 0, wave.width, wave.height);
    const strength = taraPlaying || state === 'speaking'
  ? 0.55
  : state === 'listening'
    ? Math.max(0.12, heard)
    : 0;
    const bars = 29;
    const step = wave.width / (bars + 1);

    waveCtx.lineWidth = 3;
    waveCtx.lineCap = 'round';
    waveCtx.strokeStyle = strength > 0.02 ? '#72cbff' : '#426389';
    waveCtx.beginPath();

    for (let index = 1; index <= bars; index++) {
      const envelope = Math.sin(Math.PI * index / (bars + 1));
      const oscillation = 0.35 + 0.65 * Math.abs(Math.sin(time * 13 + index * 0.93));
      const amplitude = 2 + 31 * strength * envelope * oscillation;
      const x = index * step;
      const middle = wave.height / 2;
      waveCtx.moveTo(x, middle - amplitude);
      waveCtx.lineTo(x, middle + amplitude);
    }

    waveCtx.stroke();
  }
function drawHolographicCore(
  x,
  y,
  size,
  time,
  heard,
  speech
) {
  const radius = size * 0.41;
  const pulse = 1 + heard * 0.06 + speech * 0.025;
  const tau = Math.PI * 2;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pulse, pulse);
  ctx.globalCompositeOperation = 'lighter';

  // Deep blue spherical atmosphere.
  const atmosphere = ctx.createRadialGradient(
    -radius * 0.18,
    -radius * 0.2,
    0,
    0,
    0,
    radius * 1.35
  );

  atmosphere.addColorStop(0, '#238ce844');
  atmosphere.addColorStop(0.55, '#124ead28');
  atmosphere.addColorStop(1, '#04152b00');

  ctx.fillStyle = atmosphere;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.35, 0, tau);
  ctx.fill();

  // Intersecting wireframe shells.
  for (let shell = 0; shell < 8; shell++) {
    ctx.save();

    ctx.rotate(
      shell * 0.49 +
      time * (shell % 2 ? -0.09 : 0.12)
    );

    const r = radius * (0.72 + shell * 0.035);
    const flatten = 0.2 + shell * 0.075;

    ctx.lineWidth = shell % 3 === 0 ? 1 : 0.55;
    ctx.strokeStyle = shell % 3 === 0
      ? '#6bd7ff85'
      : '#368bdf48';

    ctx.beginPath();
    ctx.ellipse(
      0,
      0,
      r,
      r * flatten,
      0,
      0,
      tau
    );
    ctx.stroke();

    ctx.restore();
  }

  // Broken circuitry bands rotating independently.
  for (let band = 0; band < 5; band++) {
    const r = radius * (0.49 + band * 0.14);
    const direction = band % 2 ? -1 : 1;

    const rotation =
      time * direction * (0.12 + band * 0.025);

    for (let segment = 0; segment < 40; segment++) {
      if ((segment + band * 7) % 9 < 2) continue;

      const angle =
        segment / 40 * tau + rotation;

      ctx.lineWidth =
        segment % 7 === 0 ? 2 : 0.8;

      ctx.strokeStyle = segment % 7 === 0
        ? '#b5f4ffc0'
        : '#409eff75';

      ctx.beginPath();
      ctx.arc(
        0,
        0,
        r,
        angle,
        angle + tau / 40 * 0.62
      );
      ctx.stroke();
    }
  }

  // Small orbiting energy nodes.
  for (let node = 0; node < 18; node++) {
    const angle =
      node / 18 * tau + time * 0.22;

    const r = radius *
      (0.67 + 0.3 * Math.sin(node * 2.4));

    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r * 0.7;

    ctx.fillStyle = node % 4 === 0
      ? '#e2fbff'
      : '#67ceff';

    ctx.beginPath();
    ctx.arc(
      px,
      py,
      node % 4 === 0 ? 1.8 : 0.85,
      0,
      tau
    );
    ctx.fill();
  }

  // Compact luminous nucleus.
  const nucleus = ctx.createRadialGradient(
    0, 0, 0,
    0, 0, radius * 0.3
  );

  nucleus.addColorStop(0, '#e6fcff');
  nucleus.addColorStop(0.12, '#9ce9ffdd');
  nucleus.addColorStop(0.42, '#218cdd70');
  nucleus.addColorStop(1, '#1066cc00');

  ctx.fillStyle = nucleus;

  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.3, 0, tau);
  ctx.fill();

  ctx.restore();
}

  function draw(now) {
    const moving = !reducedMotion.matches;
    const elapsed = (now - stateSince) / 1000;
    const heard = state === 'listening' ? meter * Math.exp(-(now - meterAt) / 240) : 0;
    const velocity = state === 'thinking' ? 1.6 : state === 'speaking' ? 1.85 : 1 + heard;
    if (moving) orbitTime += Math.min((now - lastFrame) / 1000, 0.05) * velocity;
    lastFrame = now;

    drawWave(heard, moving ? orbitTime : 0, moving);

    if (ctx && width && height) {
      const x = width / 2;
      const y = height / 2;
      const size = Math.min(240, width * 0.67, height * 0.67);
      const wake = moving && state === 'listening' ? Math.exp(-elapsed * 4) : 0;
      const speech = moving && state === 'speaking' ? (1 + Math.sin(orbitTime * 5)) / 2 : 0;
      const radius = size * 0.49 * (1 + wake * 0.12 + heard * 0.07);

      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const halo = ctx.createRadialGradient(x, y, 0, x, y, size * 0.74);
      halo.addColorStop(0, '#237cec42');
      halo.addColorStop(1, 'transparent');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);

      const angleFor = orbit => orbit.phase + (moving ? orbitTime * orbit.speed : 0);
      for (const orbit of orbits.slice(0, 2)) {
        traceOrbit(orbit, radius, angleFor(orbit), x, y);
      }

      drawHolographicCore(
  x,
  y,
  size,
  orbitTime,
  heard,
  speech
);

      traceOrbit(orbits[2], radius, angleFor(orbits[2]), x, y);

      if (wake > 0.025) {
        ctx.strokeStyle = 'rgba(126, 216, 255, ' + wake * 0.62 + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, size * (0.38 + elapsed * 0.37), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    requestAnimationFrame(draw);
  }

  new ResizeObserver(resize).observe(canvas);
  resize();
  requestAnimationFrame(draw);
})();