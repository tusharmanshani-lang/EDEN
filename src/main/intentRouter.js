'use strict';

function createIntentRouter({
  classify,
  isLocal,
  getApps
}) {
  let pending = null;

  const clean = value => String(value || '')
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  const key = value => clean(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

  const simplify = value => clean(value)
    .replace(
      /^(?:(?:hey|hi|hello)[,\s]+)?(?:eden|aiden|hayden)\b[,\s]*/i,
      ''
    )
    .replace(
      /^(?:(?:please|can you|could you|would you|will you)\s+)+/i,
      ''
    )
    .replace(/[,\s]+please[.!?]*$/i, '')
    .replace(/[.!?]+$/, '')
    .trim();

  // These describe available actions, not every possible sentence.
  const fixed = [
    ['human', 'avatar', 'show your human form',
      ['human form', 'become human', 'be human',
       'show yourself', 'avatar form', 'switch to human']],

    ['energy', 'avatar', 'show your energy form',
      ['energy form', 'core form', 'become energy',
       'switch to energy']],

    ['alfaaz', 'avatar', 'dance to alfaaz',
      ['dance alfaaz', 'dance alfaz', 'dance alphaz',
       'dance to alfaz', 'dance to alphaz']],

    ['varoon', 'avatar', 'dance to varoon',
      ['dance varoon', 'dance varun', 'dance warun',
       'dance to varun', 'dance on varun']],

    ['dance-stop', 'avatar', 'stop dancing',
      ['stop dance', 'stop the dance']],

    ['wave', 'avatar', 'wave hello', ['wave', 'greet me']],
    ['peace', 'avatar', 'show a peace sign', []],
    ['spin', 'avatar', 'spin around', []],
    ['pose', 'avatar', 'strike a pose', []],
    ['rest', 'avatar', 'stand normally', ['relax your arms']],
    ['smile', 'avatar', 'smile', ['show a smile']],
    ['angry', 'avatar', 'show your angry expression', []],
    ['sad', 'avatar', 'show your sad expression', []],
    ['surprised', 'avatar', 'look surprised', []],
    ['relaxed', 'avatar', 'look relaxed', []],
    ['neutral', 'avatar', 'show your neutral expression', []],
    ['jealous', 'avatar', 'look jealous', []],

    ['chat-show', 'view', 'show conversation',
      ['open chat', 'show chat', 'open conversation']],

    ['chat-hide', 'view', 'hide conversation',
      ['hide chat', 'close chat', 'close conversation']],

    ['volume-up', 'mac', 'volume up',
      ['raise volume', 'make it louder']],

    ['volume-down', 'mac', 'volume down',
      ['lower volume', 'make it quieter']],

    ['mute', 'mac', 'mute', ['mute sound']],
    ['unmute', 'mac', 'unmute', ['unmute sound']],
    ['volume-status', 'mac', 'check volume', []],

    ['pause', 'mac', 'pause spotify',
      ['pause music', 'pause the music']],

    ['resume', 'mac', 'resume spotify', ['resume music']],
    ['next', 'mac', 'next song', ['skip song', 'skip this song']],
    ['previous', 'mac', 'previous song', []],

    ['alarms', 'mac', 'list my alarms',
      ['show alarms', 'read my alarms']],

    ['alarm-on', 'mac', 'turn on my alarm', []],
    ['alarm-off', 'mac', 'turn off my alarm', []],
    ['alarm-delete', 'mac', 'delete my alarm', []],

    ['project-pick', 'project', 'choose coding project', []],

    ['project-preview', 'project', 'preview my website',
      ['preview website', 'run my website', 'show my website']],

    ['project-test', 'project', 'test my project',
      ['test my website']],

    ['project-setup', 'project', 'install project dependencies', []],
    ['project-hosting', 'project', 'connect publishing', []],
    ['project-link', 'project', 'link this project to vercel', []],

    ['project-publish', 'project', 'make my website live',
      ['publish my website', 'deploy my website']],

    ['project-stop', 'project', 'stop coding', []]
  ];

  const sites = [
    ['google', 'https://www.google.com/',
      ['google', 'google search']],

    ['youtube', 'https://www.youtube.com/',
      ['youtube', 'you tube', 'u tube']],

    ['gmail', 'https://mail.google.com/',
      ['gmail', 'g mail']],

    ['github', 'https://github.com/',
      ['github', 'git hub']],

    ['chatgpt', 'https://chatgpt.com/',
      ['chatgpt', 'chat gpt']],

    ['spotify', 'https://open.spotify.com/',
      ['spotify web', 'spotify website']]
  ];

  function distance(a, b) {
    let row = Array.from(
      { length: b.length + 1 },
      (_, index) => index
    );

    for (let i = 1; i <= a.length; i++) {
      const next = [i];

      for (let j = 1; j <= b.length; j++) {
        next[j] = Math.min(
          next[j - 1] + 1,
          row[j] + 1,
          row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }

      row = next;
    }

    return row[b.length];
  }

  function selection(options) {
    pending = {
      options,
      at: Date.now()
    };

    return {
      kind: 'clarify',
      question: 'Did you mean ' +
        options.map(option => option.label).join(' or ') +
        '?'
    };
  }

  function validate(action, value, input) {
    if (!action) return null;

    if (!action.parameter) {
      return {
        route: action.route,
        command: action.command
      };
    }

    const text = clean(value);

    if (
      !text ||
      text.length > 180 ||
      /[\x00-\x1f\x7f]/.test(text)
    ) {
      return null;
    }
    if (action.id === 'website-open') {
  const suffix = text.match(
    /\s+in\s+(safari|google chrome|chrome|firefox|microsoft edge|edge|brave|opera)$/i
  );

  const address = suffix
    ? text.slice(0, suffix.index)
    : text;

  let url;

  try {
    url = new URL(address);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();

  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes('.') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
  ) {
    return null;
  }

  return {
    route: 'mac',
    command:
      'open website ' +
      url.href +
      (suffix ? ' in ' + suffix[1] : '')
  };
}

    if (action.id === 'volume-set') {
      if (
        !/^\d{1,3}$/.test(text) ||
        Number(text) > 100
      ) {
        return null;
      }

      return {
        route: 'mac',
        command: 'set volume to ' + Number(text)
      };
    }

    if (action.id === 'alarm-set') {
      if (
        !/\b(?:[ap]\s*\.?\s*m|morning|afternoon|evening|tonight|noon|midnight)\b/i
          .test(input)
      ) {
        return null;
      }

      if (
        !/^(?:1[0-2]|[1-9])(?::[0-5]\d)?\s*[ap]m$/i
          .test(text)
      ) {
        return null;
      }

      return {
        route: 'mac',
        command: 'set an alarm for ' + text
      };
    }

    if (action.id === 'app-install') {
      if (!/\b(?:install|download|get)\b/i.test(input)) {
        return null;
      }

      return {
        route: 'mac',
        command: 'install ' + text + ' from App Store'
      };
    }

    const formats = {
      'web-search': value => 'search Google for ' + value,
      'song-play': value => 'play ' + value + ' on spotify',
      'song-search': value => 'search spotify for ' + value,
      'file-find': value => 'find ' + value,
      'file-open': value => 'open file ' + value
    };

    return formats[action.id]
      ? {
          route: 'mac',
          command: formats[action.id](text)
        }
      : null;
  }

  async function resolve(raw, history = []) {
    const input = clean(raw);
    const text = simplify(raw);

    if (
      !text ||
      input.length > 700 ||
      /[\r\n]/.test(String(raw))
    ) {
      return { kind: 'chat' };
    }

    if (pending && Date.now() - pending.at > 90000) {
      pending = null;
    }

    if (pending) {
      const saved = pending;
      pending = null;

      if (/^(?:no|cancel|never mind|nevermind)$/i.test(text)) {
        return {
          kind: 'clarify',
          question: 'Okay, cancelled.'
        };
      }

      const number = text.match(
        /^(?:option |number )?([1-3])$/i
      );

      const chosen =
        /^(?:yes|yes please|that's right|correct|do it)$/i
          .test(text) &&
        saved.options.length === 1
          ? saved.options[0]
          : number
            ? saved.options[Number(number[1]) - 1]
            : saved.options.find(
                option => key(option.label) === key(text)
              );

      if (chosen) {
        return validate(
          chosen,
          chosen.value,
          chosen.original || input
        );
      }

      if (
        saved.slot &&
        !/^(?:yes|no|thanks|thank you)$/i.test(text) &&
        !/^(?:open|launch|install|download|delete|remove|dance|show|switch|publish|deploy|find|search|build|create|set|stop)\b/i
          .test(text)
      ) {
        const value = validate(
          saved.slot,
          text,
          saved.original + ' ' + input
        );

        if (value) return value;
      }
    }

    // Do not turn explanations, quotations or negation into actions.
    if (
      /^(?:how|why|what|when|where|who|explain|tell me about|if)\b/i
        .test(text) ||
      /\b(?:don't|do not|never|not now|shouldn't|should not|can't|cannot|couldn't|could not)\b/i
        .test(text) ||
      /^["'`]/.test(text)
    ) {
      return { kind: 'chat' };
    }

    const actions = fixed.map(
      ([id, route, command, aliases]) => ({
        id,
        route,
        command,
        aliases,
        label: command
      })
    );

    const apps = [...new Set(await getApps())].filter(
      value =>
        typeof value === 'string' &&
        value.length < 100
    );

    const aliases = {
      googlechrome: ['chrome', 'krome', 'google chrome'],
      visualstudiocode: ['vs code', 'vscode', 'visual studio code'],
      systemsettings: ['settings', 'system settings'],
      spotify: ['spotify', 'spotifai'],
      safari: ['safari', 'safary'],
      clock: ['clock', 'clok'],
      calculator: ['calculator', 'calc']
    };

    apps.forEach((name, index) => {
      actions.push({
        id: 'app-' + index,
        route: 'mac',
        command: 'open app ' + name,
        label: name,
        aliases: aliases[key(name)] || [name],
        entity: 'app'
      });
    });

    sites.forEach(([id, url, names]) => {
      actions.push({
        id: 'site-' + id,
        route: 'mac',
        command: 'open website ' + url,
        label: id + ' website',
        aliases: names,
        entity: 'site'
      });
    });

    for (const action of actions.filter(item => !item.entity)) {
      if (
        [action.command, ...action.aliases].some(
          alias => key(alias) === key(text)
        )
      ) {
        return validate(action, '', input);
      }
    }
// Accept a public website address without requiring "open".
const domain = text.match(
  /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i
);

if (domain) {
  return validate(
    { id: 'website-open', parameter: true },
    /^https?:\/\//i.test(text)
      ? text
      : 'https://' + text,
    input
  ) || {
    kind: 'clarify',
    question: 'Please use a public website address.'
  };
}

// A website name alone is enough.
const bareSite = actions.find(action =>
  action.entity === 'site' &&
  action.aliases.some(alias => key(alias) === key(text))
);

if (bareSite) {
  return validate(bareSite, '', input);
}

// An installed app name alone is also enough.
const bareApps = actions.filter(action =>
  action.entity === 'app' &&
  [action.label, ...action.aliases].some(
    alias => key(alias) === key(text)
  )
);

if (bareApps.length === 1) {
  return validate(bareApps[0], '', input);
}
    const opening = text.match(
      /^(?:open|launch|start|bring up|visit|go to)\s+(?:(?:the|my)\s+)?(?:(app|application|website|site)\s+)?(.+)$/i
    );

    if (opening && !/[/.\\]/.test(opening[2])) {
      const name = key(opening[2]);

      const kind = /^(?:app|application)$/i
        .test(opening[1] || '')
          ? 'app'
          : opening[1]
            ? 'site'
            : null;

      const pool = actions.filter(
        action =>
          action.entity &&
          (!kind || action.entity === kind)
      );

      const exact = pool.filter(action =>
        [action.label, ...action.aliases].some(
          alias => key(alias) === name
        )
      );

const preferredWebsite = exact.find(
  action => action.entity === 'site'
);

if (preferredWebsite && !kind) {
  return validate(preferredWebsite, '', input);
}
      if (exact.length === 1) {
        return validate(exact[0], '', input);
      }

      if (exact.length > 1) {
        return selection(exact.slice(0, 3));
      }

      if (name.length >= 4) {
        const ranked = pool.map(action => ({
          action,
          score: Math.min(
            ...[action.label, ...action.aliases].map(alias =>
              distance(name, key(alias)) /
              Math.max(name.length, key(alias).length)
            )
          )
        }))
          .filter(result => result.score <= 0.3)
          .sort((a, b) => a.score - b.score);

        if (ranked.length) {
          return selection(
            ranked.slice(0, 2).map(result => result.action)
          );
        }
      }
    }

    if (await isLocal()) return null;

    const candidate =
      /\b(?:open|launch|start|show|bring|switch|change|become|transform|human|person|avatar|energy|core|dance|perform|smile|angry|sad|surpris\w*|jealous|relax\w*|wave|peace|spin|pose|chat|conversation|volume|loud\w*|quiet\w*|mute|pause|resume|music|song|track|skip|alarm|install|download|find|search|locate|file|folder|project|website|publish|deploy|live|test|coding)\b/i;

    const bareName =
  text.split(' ').length <= 3 &&
  /^[\p{L}\p{N}& .'-]+$/u.test(text) &&
  !/^(?:hi|hello|hey|thanks|thank you|okay|ok|yes|no|good morning|good night)$/i
    .test(text);

if (!candidate.test(text) && !bareName) {
  return null;
}

    actions.push(...[
      ['volume-set', 'volume percentage, 0–100'],
      ['alarm-set', 'explicit time, e.g. 7:30 AM; ask if AM/PM is missing'],
      [
  'website-open',
  'public HTTP/HTTPS website URL; optionally append in Safari, Chrome, Firefox, Edge, Brave or Opera'
],
      ['web-search', 'search query'],
      ['song-play', 'song name'],
      ['song-search', 'song name'],
      ['file-find', 'file or folder name'],
      ['file-open', 'file name'],
      ['app-install', 'app name; installation request only']
    ].map(([id, parameter]) => ({
      id,
      parameter,
      route: 'mac',
      label: id
    })));

    let parsed;

    try {
      parsed = await classify({
        input,
        context: history.slice(-4).map(turn => ({
          role: turn.role,
          text: (turn.parts || [])
            .map(part => part.text || '')
            .join(' ')
            .slice(0, 350)
        })),
        actions: actions.map(
          ({ id, label, parameter, aliases }) => ({
            id,
            label,
            parameter,
            aliases
          })
        )
      });
    } catch (error) {
      console.warn('EDEN intent resolver:', error.message);
      return null;
    }

    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.id === 'none') return { kind: 'chat' };

    const action = actions.find(
      item => item.id === parsed.id
    );

    if (!action) return null;

    const command = validate(
      action,
      parsed.value,
      input
    );

    if (!command) {
      if (action.parameter) {
        pending = {
          options: [],
          slot: action,
          original: input,
          at: Date.now()
        };
      }

      return {
        kind: 'clarify',
        question: action.id === 'alarm-set'
          ? 'What time, including AM or PM, should I set the alarm for?'
          : 'What exact name or value should I use?'
      };
    }

    if (
      typeof parsed.confidence !== 'number' ||
      parsed.confidence < 0.9
    ) {
      if (
        parsed.confidence < 0.6 ||
        !Number.isFinite(parsed.confidence)
      ) {
        return null;
      }

      return selection([{
        ...action,
        command: command.command,
        parameter: null,
        label: command.command,
        original: input
      }]);
    }

    if (
      action.id === 'project-publish' &&
      !/\b(?:publish|deploy|live)\b/i.test(input)
    ) {
      return null;
    }

    if (
      action.id === 'alarm-delete' &&
      !/\b(?:delete|remove|erase)\b/i.test(input)
    ) {
      return null;
    }

    return command;
  }

  return { resolve };
}

module.exports = { createIntentRouter };