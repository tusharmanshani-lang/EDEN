'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { commandFromTranscript } = require('../nativeSpeechAdapter');
const conversation = { active: false };
const powershell = () => path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
function speechAdapter({ interceptTranscript = () => false } = {}) {
 let session = null;
 return {
  start({ onKeyword, onCommand, onError }) {
   if (session) return Promise.reject(new Error('Windows listener is already starting or running.'));
   return new Promise((resolve, reject) => {
    const child = spawn(powershell(), ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'listen.ps1')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const current = { child, ready:false, stopped:false, failed:false };
    session = current;
    const reader = readline.createInterface({ input: child.stdout });
    function fail(error) {
     if (current.failed || current.stopped) return;
     current.failed = true;
     clearTimeout(timer);
     if (current.ready) onError?.(error); else reject(error);
     child.kill();
    }
    const timer = setTimeout(() => fail(new Error('Windows speech startup timed out. Check microphone permissions.')), 20000);
    current.cancel = () => {
     if(current.stopped) return;
     current.stopped = true;
     clearTimeout(timer);
     reader.close();
     if(!current.ready && !current.failed) reject(new Error('Windows speech startup cancelled.'));
     child.kill();
    };
    child.stderr.resume();
    reader.on('line', line => {
     if (current.stopped || current.failed || session !== current) return;
     let event; try { event = JSON.parse(line); } catch { return; }
     if (event.kind === 'ready') { current.ready = true; clearTimeout(timer); resolve(); }
     else if (event.kind === 'error') fail(new Error(event.text));
     else if (current.ready && event.kind === 'transcript' && typeof event.text === 'string' && !interceptTranscript(event.text)) {
      const command = commandFromTranscript(event.text, conversation);
      if (command) onCommand(command); else if (conversation.active) onKeyword('HEY EDEN');
     }
    });
    child.once('error', fail);
    child.once('close', () => {
     clearTimeout(timer);
     reader.close();
     fail(new Error('Windows listener stopped. Check microphone, English speech support and PowerShell policy.'));
     if (session === current) session = null;
    });
   });
  },
  async stop() {
   const current = session;
   if(!current) return;
   session = null;
   current.cancel();
  }
 };
}
module.exports = { speechAdapter, powershell };
