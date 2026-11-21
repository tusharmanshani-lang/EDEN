'use strict';

function createIntentRouter({
  classify,
  isLocal = async () => false,
  getApps = async () => []
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

    ['window-maximize', 'mac', 'maximize browser window',
  ['maximize the browser', 'maximize the screen',
    'make the browser bigger', 'expand the browser']],

['window-minimize', 'mac', 'minimize browser window',
  ['minimize the browser']],

['window-restore', 'mac', 'restore browser window',
  ['restore the browser', 'bring back the browser']],
  ];

  const sites = [
    ['google', 'https://www.google.com/',
      ['google', 'google search', 'browser', 'my browser', 'any browser']],

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

  const parameterActions = [
    ['volume-set', 'Volume percentage from 0 to 100'],

    ['alarm-set',
      'Explicit alarm time, such as 7:30 AM; ask when AM or PM is missing'],

    ['website-open',
      'Known public HTTP or HTTPS website URL; optionally append in Safari, Chrome, Firefox, Edge, Brave or Opera'],

    ['youtube-search',
      'Complete topic to search for on YouTube; preserve the search topic'],

    ['web-search', 'Complete Google search query'],
    ['song-play', 'Song name to play on Spotify'],
    ['song-search', 'Song name to search for on Spotify'],
    ['file-find', 'File or folder name'],
    ['file-open', 'File name'],
    ['app-install', 'App name; only for an explicit installation request']
  ].map(([id, parameter]) => ({
    id,
    parameter,
    route: 'mac',
    label: id
  }));

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
    pending = { options, at: Date.now() };

    return {
      kind: 'clarify',
      question: 'Did you mean ' +
        options.map(option => option.label).join(' or ') +
        '?'
    };
  }

  function askForValue(action, original) {
    pending = {
      options: [],
      slot: action,
      original,
      at: Date.now()
    };

    const questions = {
      'alarm-set': 'What time, including AM or PM, should I set the alarm for?',
      'youtube-search': 'What should I search for on YouTube?',
      'website-open': 'Which website should I open?',
      'web-search': 'What should I search Google for?'
    };

    return {
      kind: 'clarify',
      question: questions[action.id] ||
        'What exact name or value should I use?'
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

    if (/[\x00-\x1f\x7f]/.test(String(value || ''))) {
      return null;
    }

    const text = clean(value);

    if (!text || text.length > 700) return null;

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
        command: 'open website ' + url.href +
          (suffix ? ' in ' + suffix[1] : '')
      };
    }

    if (action.id === 'volume-set') {
      if (!/^\d{1,3}$/.test(text) || Number(text) > 100) {
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
          .test(input) ||
        !/^(?:1[0-2]|[1-9])(?::[0-5]\d)?\s*[ap]m$/i.test(text)
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
      'youtube-search': value => 'search YouTube for ' + value,
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
      /[\x00-\x1f\x7f]/.test(String(raw || ''))
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

      const number = text.match(/^(?:option |number )?([1-3])$/i);

      const chosen =
        /^(?:yes|yes please|that's right|correct|do it)$/i.test(text) &&
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
        const command = validate(
          saved.slot,
          text,
          saved.original + ' ' + input
        );

        if (command) return command;
      }
    }

    // Explanations, quotations and negative requests stay conversational.
    if (
      /^(?:how|why|what|when|where|who|explain|tell me about|if)\b/i
        .test(text) ||
      /\b(?:don't|do not|never|not now|shouldn't|should not|can't|cannot|couldn't|could not)\b/i
        .test(text) ||
      /^["'`]/.test(text)
    ) {
      return { kind: 'chat' };
    }

    // Send explicit browser window commands to the existing Mac handler.
const browserWindowRequest = text.match(
  /^(maximize|maximise|minimize|minimise|restore|unminimize|unminimise|enlarge|bring back)\s+(?:(?:the|this|current|my|active)\s+)*(?:(safari|google chrome|chrome|microsoft edge|edge|brave|firefox|opera)(?:\s+window)?|(?:browser(?:\s+window)?|window|screen)(?:\s+(?:in|on)\s+(safari|google chrome|chrome|microsoft edge|edge|brave|firefox|opera))?)$/i
);

if (browserWindowRequest) {
  const verb = browserWindowRequest[1].toLowerCase();

  const action = /^minimi/.test(verb)
    ? 'minimize'
    : /^(?:restore|unminimi|bring back)/.test(verb)
      ? 'restore'
      : 'maximize';

  const browser =
    browserWindowRequest[2] || browserWindowRequest[3];

  return {
    route: 'mac',
    command: action + ' ' +
      (browser ? browser + ' window' : 'browser window')
  };
}
const arrangeRequest = text.match(
  /^(?:open\s+and\s+)?(?:move|put|place|arrange|resize|tile|split|fill)\s+(?:(?:the|my|this|current)\s+)*(safari|google chrome|chrome|microsoft edge|edge|brave|browser|window)(?:\s+window)?(?:\s+(?:to|on|in|into))?\s*(?:(?:the|a)\s+)?(top left|top right|bottom left|bottom right|left|right|top|bottom|full|fill)?(?:\s+(?:half|side|corner|screen))?$/i
);

if (arrangeRequest) {
  const target = arrangeRequest[1].toLowerCase();
  const position = arrangeRequest[2]?.toLowerCase();

  if (!position && !/^fill\b/i.test(text)) {
    return {
      kind: 'clarify',
      question:
        'Which position? Say, for example, “move Safari to the left half” or “fill Safari”.'
    };
  }

  const action = !position || /^(?:full|fill)$/.test(position)
    ? 'maximize'
    : 'tile-' + position.replace(/\s+/g, '-');

  return {
    route: 'mac',
    command: action + ' ' +
      (['browser', 'window'].includes(target)
        ? 'browser window'
        : target + ' window')
  };
}
    // Search requests must be resolved before opening website homepages.
    const browserSuffix = text.match(
      /\s+(?:in|using|with)\s+(?:(?:the|my)\s+)?(safari|google chrome|chrome|firefox|microsoft edge|edge|brave|opera|default browser)$/i
    );

    const searchText = browserSuffix
      ? text.slice(0, browserSuffix.index).trim()
      : text;

    const youtubeSearch =
      searchText.match(
        /^(?:open\s+)?(?:you\s*tube|u\s+tube)\s+(?:and\s+)?(?:search|find|look\s+up)(?:\s+for)?\s+(.+)$/i
      ) ||
      searchText.match(
        /^(?:search|find|look\s+up)\s+(?:(?:on|in)\s+)?(?:you\s*tube|u\s+tube)\s+(?:for\s+)?(.+)$/i
      ) ||
      searchText.match(
        /^(?:search|find|look\s+up)\s+(?:for\s+)?(.+?)\s+(?:on|in)\s+(?:you\s*tube|u\s+tube)$/i
      );

    const youtubeAction = parameterActions.find(
      action => action.id === 'youtube-search'
    );

    if (youtubeSearch) {
      const query = clean(youtubeSearch[1]);

      if (!query || /^(?:for|something|anything)$/i.test(query)) {
        return askForValue(youtubeAction, input);
      }

      return {
        route: 'mac',
        command: 'search YouTube for ' + query +
          (browserSuffix
            ? ' in ' + browserSuffix[1]
            : '')
      };
    }

    if (
      /^(?:(?:open\s+)?(?:you\s*tube|u\s+tube)\s+(?:and\s+)?(?:search|find|look\s+up)(?:\s+for)?|(?:search|find|look\s+up)\s+(?:(?:on|in)\s+)?(?:you\s*tube|u\s+tube)(?:\s+for)?)$/i
        .test(searchText)
    ) {
      return askForValue(youtubeAction, input);
    }

   const actions = fixed
  .filter(item =>
    Array.isArray(item) &&
    item.length >= 3 &&
    item.slice(0, 3).every(value =>
      typeof value === 'string' && value.trim()
    )
  )
  .map(([id, route, command, aliases]) => ({
    id,
    route,
    command,
    aliases: Array.isArray(aliases) ? aliases : [],
    label: command
  }));

    let appNames = [];

    try {
      const result = await getApps();
      appNames = Array.isArray(result) ? result : [];
    } catch (error) {
      console.warn('EDEN app discovery:', error.message);
    }

    const apps = [...new Set(appNames)].filter(
      value =>
        typeof value === 'string' &&
        value.length > 0 &&
        value.length < 100
    );

    const appAliases = {
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
        aliases: appAliases[key(name)] || [name],
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

    // A website name alone, such as "ChatGPT".
    const bareSite = actions.find(action =>
      action.entity === 'site' &&
      action.aliases.some(alias => key(alias) === key(text))
    );

    if (bareSite) return validate(bareSite, '', input);

    // A public domain or URL alone.
    const addressText = text.replace(
      /^(?:open|visit|go to|navigate to)\s+(?:(?:the\s+)?(?:website|site)\s+)?/i,
      ''
    );

    if (
      /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i
        .test(addressText)
    ) {
      const websiteAction = parameterActions.find(
        action => action.id === 'website-open'
      );

      const address = /^https?:\/\//i.test(addressText)
        ? addressText
        : 'https://' + addressText;

      const command = validate(websiteAction, address, input);

      return command || askForValue(websiteAction, input);
    }

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

      const kind = /^(?:app|application)$/i.test(opening[1] || '')
        ? 'app'
        : opening[1]
          ? 'site'
          : null;

      const pool = actions.filter(action =>
        action.entity &&
        (!kind || action.entity === kind)
      );

      const exact = pool.filter(action =>
        [action.label, ...action.aliases].some(
          alias => key(alias) === name
        )
      );

      const preferredSite = exact.find(
        action => action.entity === 'site'
      );

      if (preferredSite && !kind) {
        return validate(preferredSite, '', input);
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

    const bareName =
      text.split(/\s+/).length <= 3 &&
      /^[\p{L}\p{N}&.' -]+$/u.test(text) &&
      !/^(?:hi|hello|hey|okay|ok|yes|no|thanks|thank you|good morning|good night)$/i
        .test(text);

    const candidate =
      /\b(?:open|launch|start|show|bring|switch|change|become|transform|human|person|avatar|energy|core|dance|perform|smile|angry|sad|surpris\w*|jealous|relax\w*|wave|peace|spin|pose|chat|conversation|volume|loud\w*|quiet\w*|mute|pause|resume|music|song|track|skip|alarm|install|download|find|search|locate|file|folder|project|website|publish|deploy|live|test|coding|youtube)\b/i;

    if (!candidate.test(text) && !bareName) return null;

    actions.push(...parameterActions);

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

    const action = actions.find(item => item.id === parsed.id);
    if (!action) return null;

    if (
      typeof parsed.confidence !== 'number' ||
      !Number.isFinite(parsed.confidence) ||
      parsed.confidence < 0.6
    ) {
      return null;
    }

    // Do not open the homepage when a search was requested.
    if (
      action.id === 'site-youtube' &&
      /\b(?:search|find|look\s+up|look\s+for)\b/i.test(text)
    ) {
      return askForValue(youtubeAction, input);
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

    const command = validate(action, parsed.value, input);

    if (!command) {
      return action.parameter
        ? askForValue(action, input)
        : null;
    }

    if (parsed.confidence < 0.9) {
      return selection([{
        ...action,
        command: command.command,
        parameter: null,
        label: command.command,
        original: input
      }]);
    }

    return command;
  }

  return { resolve };
}

module.exports = { createIntentRouter };