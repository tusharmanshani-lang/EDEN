'use strict';

const { app, dialog, BrowserWindow } = require('electron');
const { promisify } = require('node:util');
const interruption = require('../core/interruption');

const run = promisify(interruption.execFile);

function normalize(input) {
  return String(input || '')
    .trim()
    .replace(
      /^(?:(?:hey|hi|hello)[,\s]+)?eden\b[,\s]*/i,
      ''
    )
    .replace(
      /^(?:(?:please|can you|could you|would you)\s+)+/i,
      ''
    )
    .replace(/\s+please[.!?]*$/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
}

async function confirm(options) {
  const parent = BrowserWindow.getFocusedWindow();

  const settings = {
    type: 'question',
    buttons: ['Cancel', options.button],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'EDEN',
    message: options.message,
    detail: options.detail
  };

  const result = parent
    ? await dialog.showMessageBox(parent, settings)
    : await dialog.showMessageBox(settings);

  interruption.checkpoint();
  return result.response === 1;
}

async function runJavaScript(script, args = []) {
  const { stdout } = await run(
    '/usr/bin/osascript',
    ['-l', 'JavaScript', '-e', script, ...args],
    { timeout: 15000 }
  );

  return JSON.parse(stdout.trim());
}

async function handleSystemAction(input) {
  const text = normalize(input);


  const isShutdown = value =>
    /^(?:shut\s*down|power\s*off|turn\s*off)(?:\s+(?:(?:my|the|this)\s+)?(?:mac|macbook|laptop|computer|system))?$/i
      .test(value.trim());

  const isQuitAll = value =>
    /^(?:quit|close|exit)\s+all(?:\s+(?:the|my|running|open))*\s+(?:apps|applications)(?:\s+(?:together|at once))?$/i
      .test(value.trim());

  const parts = text.split(
    /\s*(?:,\s*(?:and\s+)?then|,\s*and|\band\s+then\b|\band\b|\bthen\b|&)\s*/i
  ).filter(Boolean);

  const combined =
    parts.length === 2 &&
    (
      (isQuitAll(parts[0]) && isShutdown(parts[1])) ||
      (isShutdown(parts[0]) && isQuitAll(parts[1]))
    );

  const shutdown = combined || isShutdown(text);
  const quitAll = combined || isQuitAll(text);

  if (!shutdown && !quitAll) return null;

  const reply = (message, action, verified = false) => ({
    reply: message,
    model: 'EDEN-SYSTEM',
    action,
    verified
  });

  try {
    interruption.checkpoint();

    if (process.platform !== 'darwin') {
      throw new Error('This command requires macOS.');
    }

    if (shutdown) {
      const approved = await confirm({
        button: 'Shut Down',
        message: combined
          ? 'Quit apps and shut down this Mac?'
          : 'Shut down this Mac?',
        detail:
          'EDEN will request a normal macOS shutdown. ' +
          'Apps may ask you to save unfinished work.'
      });

      if (!approved) {
        return reply('Shutdown cancelled.', 'shutdown-cancelled');
      }

      interruption.checkpoint();

      await run(
        '/usr/bin/osascript',
        ['-e', 'tell application "System Events" to shut down'],
        { timeout: 15000 }
      );

      return reply(
        'I sent the shutdown request to macOS. ' +
        'Complete any save prompts that appear.',
        'shutdown-requested'
      );
    }

    // Preserve EDEN and the development apps hosting it.
    const protectedPIDs = [process.pid];

    if (!app.isPackaged) {
      let currentPID = process.pid;

      for (let depth = 0; depth < 20; depth++) {
        const { stdout } = await run(
          '/bin/ps',
          ['-p', String(currentPID), '-o', 'ppid='],
          { timeout: 3000 }
        );

        const parentPID = Number(stdout.trim());

        if (
          !Number.isInteger(parentPID) ||
          parentPID <= 1 ||
          protectedPIDs.includes(parentPID)
        ) break;

        protectedPIDs.push(parentPID);
        currentPID = parentPID;
      }
    }

    interruption.checkpoint();

    const applications = await runJavaScript(`
      ObjC.import('AppKit');

      function run(argv) {
        const protectedPIDs = JSON.parse(argv[0]);
        const development = argv[1] === 'true';
        const terminals = [
          'com.apple.Terminal',
          'com.googlecode.iterm2'
        ];

        return JSON.stringify(
          $.NSWorkspace.sharedWorkspace.runningApplications.js
            .filter(function (item) {
              const bundle = ObjC.unwrap(item.bundleIdentifier) || '';

              return Number(item.activationPolicy) === 0 &&
                protectedPIDs.indexOf(Number(item.processIdentifier)) === -1 &&
                bundle !== 'com.apple.finder' &&
                !(development && terminals.indexOf(bundle) !== -1);
            })
            .map(function (item) {
              return {
                pid: Number(item.processIdentifier),
                bundle: ObjC.unwrap(item.bundleIdentifier) || '',
                name: ObjC.unwrap(item.localizedName) || 'Application'
              };
            })
        );
      }
    `, [JSON.stringify(protectedPIDs), String(!app.isPackaged)]);

    if (!Array.isArray(applications)) {
      throw new Error('Could not read the running app list.');
    }

    if (!applications.length) {
      return reply(
        'There are no other running apps to quit.',
        'quit-all-empty',
        true
      );
    }

    const approved = await confirm({
      button: 'Quit Apps',
      message: `Quit ${applications.length} running apps?`,
      detail:
        applications.map(item => item.name).join(', ') +
        '\n\nApps may show save prompts. EDEN and Finder stay open.' +
        (!app.isPackaged
          ? ' Terminal and the development app hosting EDEN stay open.'
          : '')
    });

    if (!approved) {
      return reply('Quit-all cancelled.', 'quit-all-cancelled');
    }

    interruption.checkpoint();

    const result = await runJavaScript(`
      ObjC.import('AppKit');

      function run(argv) {
        const targets = JSON.parse(argv[0]);
        const requested = [];
        const refused = [];
        const running =
          $.NSWorkspace.sharedWorkspace.runningApplications.js;

        targets.forEach(function (target) {
          const item = running.find(function (candidate) {
            return Number(candidate.processIdentifier) === target.pid &&
              (ObjC.unwrap(candidate.bundleIdentifier) || '') ===
                target.bundle;
          });

          if (!item) return;

          if (item.terminate) {
            requested.push(target.name);
          } else {
            refused.push(target.name);
          }
        });

        return JSON.stringify({ requested, refused });
      }
    `, [JSON.stringify(applications)]);

    return reply(
      (
        result.requested.length
          ? 'I sent normal quit requests to: ' +
            result.requested.join(', ') + '.'
          : 'No additional quit requests were accepted.'
      ) +
      (
        result.refused.length
          ? ' These apps did not accept the request: ' +
            result.refused.join(', ') + '.'
          : ''
      ) +
      ' Apps may remain open until you finish their save prompts.',
      'quit-all-requested'
    );
  } catch (error) {
    if (interruption.signal()?.aborted) throw error;

    console.error('EDEN SYSTEM ACTION FAILURE:', error);

    const detail = String(error.stderr || error.message || error);

    return reply(
      /-1743|not authorized to send apple events/i.test(detail)
        ? 'Allow EDEN to control System Events in System Settings → ' +
          'Privacy & Security → Automation, then try again.'
        : 'I couldn’t complete that system command. ' + detail.trim(),
      'system-action-failed'
    );
  }
}

module.exports = { handleSystemAction };