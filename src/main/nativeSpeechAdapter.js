'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const conversation = { active: false };

function commandFromTranscript(text, state) {
  const heard = text.trim();
  if (!heard) return '';

  const wake = /^(?:(?:hey|hi|hello)[,\s]+)?(?:eden|aiden|hayden)\b[\s,.!?]*/i;
  const hasWakeWord = wake.test(heard);
  const command = hasWakeWord ? heard.replace(wake, '').trim() : heard;

  if (hasWakeWord) state.active = true;
  if (!state.active || !command) return '';

  if (/^(?:stop listening|go to sleep|goodbye)[.!?]*$/i.test(command)) {
    state.active = false;
    return '';
  }

  return command;
}

function nativeSpeechAdapter(executable, { interceptTranscript } = {}) {
  let stopSession = () => {};

  return {
    start({ onKeyword, onError, onCommand, onMeter }) {
      const state = conversation;
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-voice-'));
      const output = path.join(directory, 'events.jsonl');
      const session = path.join(directory, 'active');
      const bundle = path.resolve(executable, '../../..');

      fs.writeFileSync(output, '', { mode: 0o600 });
      fs.writeFileSync(session, '', { mode: 0o600 });

      return new Promise((resolve, reject) => {
        let ready = false;
        let stopped = false;
        let offset = 0;
        let pending = Buffer.alloc(0);
        let polling;
        let timeout;

        function cleanup() {
          stopped = true;
          clearInterval(polling);
          clearTimeout(timeout);
          fs.rmSync(directory, { recursive: true, force: true });
        }

        function fail(error) {
          if (stopped) return;
          cleanup();
          if (ready) onError(error);
          else reject(error);
        }

        stopSession = () => {
          if (stopped) return;
          cleanup();
          if (!ready) reject(new Error('EDEN Voice startup was stopped.'));
        };

        function readEvents() {
          if (stopped) return;

          try {
            const chunk = Buffer.alloc(16384);
            const fd = fs.openSync(output, 'r');
            let length;
            try {
              length = fs.readSync(fd, chunk, 0, chunk.length, offset);
            } finally {
              fs.closeSync(fd);
            }
            offset += length;
            pending = Buffer.concat([pending, chunk.subarray(0, length)]);

            let newline;
            while (!stopped && (newline = pending.indexOf(10)) !== -1) {
              const line = pending.subarray(0, newline).toString('utf8');
              pending = pending.subarray(newline + 1);

              let event;
              try { event = JSON.parse(line); } catch { continue; }

              if (event.kind === 'ready') {
                ready = true;
                clearTimeout(timeout);
                resolve();
              } else if (event.kind === 'error') {
                fail(new Error(event.text));
              } else if (ready && event.kind === 'meter') {
                const level = Number(event.text);
                if (Number.isFinite(level)) onMeter?.(level);
              } else if (ready && event.kind === 'transcript' && typeof event.text === 'string') {
                                if (interceptTranscript?.(event.text)) continue;

                const command = commandFromTranscript(event.text, state);
                if (command) onCommand(command);
              else if (state.active) onKeyword('HEY EDEN');
              }
            }
          } catch (error) {
            fail(error);
          }
        }

        const launcher = spawn('/usr/bin/open', [
          '-n', '-g', '-W', '--stdout', output, '-a', bundle,
          '--args', session, String(process.pid)
        ], { stdio: 'ignore' });

        launcher.once('error', fail);
        launcher.once('close', (code, signal) => {
          readEvents();
          fail(new Error(`EDEN Voice exited (${signal ?? code}).`));
        });

        polling = setInterval(readEvents, 100);
        timeout = setTimeout(() => {
          fail(new Error('EDEN Voice did not start. Check macOS permission prompts.'));
        }, 90000);
      });
    },

    async stop() {
      stopSession();
    }
  };
}

module.exports = { nativeSpeechAdapter, commandFromTranscript };