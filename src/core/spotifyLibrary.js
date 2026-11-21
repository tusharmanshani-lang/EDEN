'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const runFile = promisify(execFile);

const SPOTIFY_SCRIPT = [
  'on run argv',
  '  if application "Safari" is not running then return "missing"',
  '  tell application "Safari"',
  '    repeat with browserWindow in windows',
  '      repeat with browserTab in tabs of browserWindow',
  '        set tabURL to URL of browserTab',
  '        if tabURL is not missing value then',
  '          if tabURL is "https://open.spotify.com" or tabURL starts with "https://open.spotify.com/" then',
  '            return do JavaScript (item 1 of argv) in browserTab',
  '          end if',
  '        end if',
  '      end repeat',
  '    end repeat',
  '  end tell',
  '  return "missing"',
  'end run'
].join('\n');

function parseRequest(request) {
  const text = request
    .replace(/^open spotify(?: web)? and\s+/i, '')
    .replace(/\s+please$/i, '')
    .trim();

  const liked = text.match(
    /^(open|show|play)(?: me)?\s+(?:from\s+)?(?:(?:my|the)\s+)?liked\s+(?:songs|tracks)(?:\s+(?:list|playlist))?(?:\s+(?:on|in)\s+spotify)?$/i
  );

  if (liked) {
    return {
      action: liked[1].toLowerCase() === 'play'
        ? 'play-liked'
        : 'open-liked'
    };
  }

  if (
    /^(?:list|show|read)(?: me)?\s+(?:(?:my|the)\s+)?(?:spotify\s+)?playlists(?:\s+(?:on|in)\s+spotify)?$/i.test(text)
  ) {
    return { action: 'list-playlists' };
  }

  if (
    /^(?:what(?:'s| is)(?: the)?(?: song)? playing(?: on spotify)?|what song is (?:playing|this)(?: on spotify)?|(?:show|read)(?: me)? (?:the )?current spotify (?:song|track))$/i.test(text)
  ) {
    return { action: 'now-playing' };
  }

  const numberedTrack = text.match(
    /^play\s+(?:the\s+)?(first|second|third|fourth|fifth|\d+)(?:st|nd|rd|th)?\s+(?:song|track)\s+(?:from|in|on)\s+(?:(?:this|the|current)\s+)?(?:spotify\s+)?playlist$/i
  );

  if (numberedTrack) {
    const words = {
      first: 1,
      second: 2,
      third: 3,
      fourth: 4,
      fifth: 5
    };

    return {
      action: 'play-number',
      position: words[numberedTrack[1].toLowerCase()] ||
        Number(numberedTrack[1])
    };
  }

  const playlist = text.match(
    /^(open|play)\s+(?:(?:my|the)\s+)?playlist\s+(.+?)(?:\s+(?:on|in)\s+spotify)?$/i
  ) || text.match(
    /^(open|play)\s+(?:(?:my|the)\s+)?(.+?)\s+playlist(?:\s+(?:on|in)\s+spotify)?$/i
  );

  if (playlist) {
    return {
      action: playlist[1].toLowerCase() === 'play'
        ? 'play-playlist'
        : 'open-playlist',
      name: playlist[2].replace(/^["“']|["”']$/g, '').trim()
    };
  }

  return null;
}

// This function runs inside the existing Spotify Web tab.
function spotifyPage(operation) {
  const respond = result => JSON.stringify(result);
  const normalize = value => String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  if (location.origin !== 'https://open.spotify.com') {
    return respond({ status: 'waiting' });
  }

  const main = document.querySelector('main');
  const widget = document.querySelector(
    '[data-testid="now-playing-widget"]'
  );
  const footer =
    document.querySelector('[data-testid="now-playing-bar"]') ||
    widget?.closest('footer') ||
    document.querySelector('footer');

  if (operation.action === 'now-playing') {
    const root = widget || footer;
    const track = root?.querySelector('a[href*="/track/"]');
    const artists = root
      ? [...root.querySelectorAll('a[href*="/artist/"]')]
          .map(link => link.textContent.trim())
          .filter(Boolean)
      : [];

    const button = document.querySelector(
      '[data-testid="control-button-playpause"]'
    );
    const label = button?.getAttribute('aria-label') || '';

    if (!track?.textContent.trim()) {
      return respond({ status: 'no-current-track' });
    }

    return respond({
      status: 'current-track',
      title: track.textContent.trim(),
      artists: [...new Set(artists)].join(', '),
      playing: /^pause\b/i.test(label),
      paused: /^play\b/i.test(label)
    });
  }

  if (operation.action === 'navigate') {
    if (location.pathname !== operation.path) {
      location.assign('https://open.spotify.com' + operation.path);
    }

    return respond({ status: 'navigated' });
  }

  if (
    operation.action === 'list-playlists' ||
    operation.action === 'find-playlist'
  ) {
    const playlists = [];
    const seen = new Set();

    for (const link of document.querySelectorAll(
      'a[href*="/playlist/"]'
    )) {
      const url = new URL(link.href);
      if (
        url.origin !== location.origin ||
        !/^\/playlist\/[a-zA-Z0-9]+\/?$/.test(url.pathname) ||
        seen.has(url.pathname)
      ) {
        continue;
      }

      const name = (
        link.querySelector('[data-encore-id="text"]')?.textContent ||
        link.textContent ||
        link.getAttribute('aria-label') ||
        link.getAttribute('title') ||
        ''
      ).trim().replace(/\s+/g, ' ');

      if (!name) continue;
      seen.add(url.pathname);
      playlists.push({ name, path: url.pathname });
    }

    if (operation.action === 'list-playlists') {
      return respond({ status: 'playlists', playlists });
    }

    const matches = playlists.filter(
      playlist => normalize(playlist.name) === normalize(operation.name)
    );

    return respond({
      status: matches.length === 1 ? 'found' : 'playlist-not-unique',
      playlist: matches.length === 1 ? matches[0] : null,
      playlists
    });
  }

  if (!main || location.pathname !== operation.path) {
    return respond({ status: 'waiting' });
  }

  if (operation.action === 'play-number') {
    const rows = [
      ...main.querySelectorAll('[data-testid="tracklist-row"]')
    ];

    // Spotify exposes absolute row positions on some playlist pages.
    const rowsWithIndexes = rows.filter(row =>
      Number.isInteger(Number(row.getAttribute('aria-rowindex'))) &&
      row.hasAttribute('aria-rowindex')
    );

    let row;

    if (rowsWithIndexes.length) {
      // Spotify's header occupies row 1.
      row = rowsWithIndexes.find(item =>
        Number(item.getAttribute('aria-rowindex')) === operation.position + 1
      );
    } else {
      return respond({ status: 'row-number-unavailable' });
    }

    if (!row) {
      return respond({ status: 'row-not-loaded' });
    }

    const track = row.querySelector('a[href*="/track/"]');
    const button = [...row.querySelectorAll('button[aria-label]')]
      .find(item =>
        !item.disabled &&
        /^play\b/i.test(item.getAttribute('aria-label') || '')
      );

    if (!track || !button) {
      return respond({ status: 'waiting' });
    }

    const title = track.textContent.trim();
    button.click();

    return respond({ status: 'track-command', title });
  }

  // Play the collection using the button in its main action bar.
  const actionBar = main.querySelector(
    '[data-testid="action-bar-row"]'
  );
  const button = actionBar?.querySelector(
    'button[data-testid="play-button"]'
  ) || main.querySelector('button[data-testid="play-button"]');

  if (!button || button.disabled) {
    return respond({ status: 'waiting' });
  }

  const label = button.getAttribute('aria-label') || '';

  if (/^pause\b/i.test(label)) {
    return respond({ status: 'collection-playing' });
  }

  if (!/^play\b/i.test(label)) {
    return respond({ status: 'waiting' });
  }

  button.click();
  return respond({ status: 'collection-command' });
}

async function evaluate(operation) {
  const javascript =
    '(' + spotifyPage.toString() + ')(' +
    JSON.stringify(operation) + ')';

  let stdout;

  try {
    ({ stdout } = await runFile(
      '/usr/bin/osascript',
      ['-e', SPOTIFY_SCRIPT, javascript],
      { timeout: 5000, maxBuffer: 1024 * 1024 }
    ));
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;

    if (/JavaScript from Apple Events/i.test(detail)) {
      throw new Error(
        'Enable Allow JavaScript from Apple Events in Safari’s Develop menu.'
      );
    }

    throw new Error(detail);
  }

  if (stdout.trim() === 'missing') {
    return { status: 'missing' };
  }

  return JSON.parse(stdout.trim());
}

async function waitForPage(operation) {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    const result = await evaluate(operation);
    if (result.status !== 'waiting') return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return { status: 'timeout' };
}

module.exports = async function handleSpotifyLibrary({
  request,
  macControl,
  isLocal
}) {
  const operation = parseRequest(request);
  if (!operation) return null;

  if (await isLocal()) {
    return 'Switch to cloud mode before using Spotify Web controls.';
  }

  try {
    macControl.requireMac();

    // Open Spotify only when there is no existing Spotify tab.
    const current = await evaluate({ action: 'now-playing' });

    if (current.status === 'missing') {
      await macControl.openWebsite('https://open.spotify.com/', {
        browser: 'safari'
      });

      await waitForPage({ action: 'now-playing' });
    }

    if (operation.action === 'now-playing') {
      const result = await evaluate(operation);

      if (result.status !== 'current-track') {
        return 'Spotify hasn’t exposed a current song yet.';
      }

      const artist = result.artists ? ' by ' + result.artists : '';
      const state = result.playing
        ? 'Playing: '
        : result.paused
          ? 'Paused: '
          : 'Spotify’s current track: ';

      return state + result.title + artist + '.';
    }

    if (operation.action === 'list-playlists') {
      const result = await evaluate(operation);

      if (!result.playlists?.length) {
        return 'Expand Your Library in Spotify so I can read the loaded playlists.';
      }

      return 'These playlists are loaded in Spotify:\n' +
        result.playlists.slice(0, 20).map(
          (playlist, index) => `${index + 1}. ${playlist.name}`
        ).join('\n') +
        '\nSay “play my playlist” followed by its name.';
    }

    let targetPath;
    let collectionName;

    if (
      operation.action === 'open-liked' ||
      operation.action === 'play-liked'
    ) {
      targetPath = '/collection/tracks';
      collectionName = 'your Liked Songs';
    } else if (
      operation.action === 'open-playlist' ||
      operation.action === 'play-playlist'
    ) {
      const result = await evaluate({
        action: 'find-playlist',
        name: operation.name
      });

      if (result.status !== 'found') {
        return 'I couldn’t identify one loaded playlist named "' +
          operation.name +
          '". Expand Your Library and use its displayed name.';
      }

      targetPath = result.playlist.path;
      collectionName = result.playlist.name;
    } else {
      // Numbered track selection applies only to the open collection.
      const locationResult = await runFile(
        '/usr/bin/osascript',
        ['-e', SPOTIFY_SCRIPT,
          'JSON.stringify({path: location.pathname})'],
        { timeout: 5000 }
      );

      if (locationResult.stdout.trim() === 'missing') {
        return 'Open your Spotify playlist first.';
      }

      targetPath = JSON.parse(locationResult.stdout.trim()).path;

      if (
        targetPath !== '/collection/tracks' &&
        !/^\/playlist\/[a-zA-Z0-9]+\/?$/.test(targetPath)
      ) {
        return 'Open a Spotify playlist or Liked Songs first.';
      }
    }

    if (operation.action !== 'play-number') {
      await evaluate({ action: 'navigate', path: targetPath });

      if (
        operation.action === 'open-liked' ||
        operation.action === 'open-playlist'
      ) {
        return 'I sent Spotify the request to open ' + collectionName + '.';
      }
    }

    const result = await waitForPage({
      action: operation.action === 'play-number'
        ? 'play-number'
        : 'play-collection',
      path: targetPath,
      position: operation.position
    });

    if (result.status === 'collection-playing') {
      return 'Spotify shows ' + collectionName + ' as playing.';
    }

    if (result.status === 'collection-command') {
      return 'I sent Spotify the Play command for ' + collectionName + '.';
    }

    if (result.status === 'track-command') {
      return 'I sent Spotify the Play command for ' + result.title + '.';
    }

    if (result.status === 'row-not-loaded') {
      return 'That numbered track isn’t loaded. Scroll to it in Spotify and ask again.';
    }

    if (result.status === 'row-number-unavailable') {
      return 'Spotify isn’t exposing reliable track numbers on this page.';
    }

    return 'I couldn’t find an available Play button. Check that Spotify is signed in and the collection has loaded.';
  } catch (error) {
    console.error('EDEN Spotify library:', error.message);
    return 'I couldn’t control the Spotify library. ' + error.message;
  }
};