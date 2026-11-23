'use strict';
const Base = require('../macControl');
const { app, shell } = require('electron');
const interruption = require('../../core/interruption');
const { spawn } = require('node:child_process');
class WindowsControl extends Base {
 constructor(options) {
  super(options);
  this.allowedRoots = ['desktop','documents','downloads','pictures','videos','music'].map(key => app.getPath(key)).concat(this.appPath);
  this.allowedApps = Object.fromEntries(['calculator','notepad','notes','terminal','chrome','googlechrome','edge','microsoftedge','firefox','spotify','vscode','visualstudiocode','taskmanager','finder','explorer','fileexplorer','settings','systemsettings'].map(name => [name, name]));
  this.reportsDirectory = require('node:path').join(app.getPath('documents'), 'EDEN Reports');
 }
 requireMac() {}
 getStatus() { return { available:true, platform:'win32', supportedActions:['open-app','open-website','list-folders','search-files','open-file','read-text-file','search-document-contents','save-research-report','list-research-reports','get-approved-locations','preview-file'], destructiveActionsEnabled:false, unrestrictedTerminalEnabled:false }; }
 async openWebsite(rawUrl) {
  const value = this.validateText(rawUrl, 'website address', 2000);
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : 'https://' + value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS website.');
  await shell.openExternal(url.href);
  return { success:true, action:'open-website', url:url.href, message:'Opened ' + url.hostname + ' in your default browser.' };
 }
 async openApp(name) {
  const key = this.validateText(name, 'application name', 80).toLowerCase().replace(/[^a-z0-9]/g,'');
  if (['finder','explorer','fileexplorer'].includes(key)) { const result = await shell.openPath(app.getPath('home')); if(result) throw Error(result); }
  else if (['settings','systemsettings'].includes(key)) await shell.openExternal('ms-settings:');
  else {
   const allowed = { calculator:'calc.exe',notepad:'notepad.exe',notes:'notepad.exe',terminal:'wt.exe',chrome:'chrome.exe',googlechrome:'chrome.exe',edge:'msedge.exe',microsoftedge:'msedge.exe',firefox:'firefox.exe',spotify:'Spotify.exe',vscode:'Code.exe',visualstudiocode:'Code.exe',taskmanager:'Taskmgr.exe' };
   if (!Object.hasOwn(allowed,key)) throw Error('This Windows preview can open Calculator, Notepad, Explorer, Settings, Terminal, Task Manager and supported installed browsers, Spotify or VS Code.');
   await new Promise((resolve, reject) => {
    const child = spawn(allowed[key], [], { detached:true, stdio:'ignore', shell:false, windowsHide:false });
    child.once('error', () => reject(Error('Windows could not launch that app. Check it is installed and available on PATH.')));
    child.once('spawn', () => { child.unref(); resolve(); });
   });
  }
  return {success:true,action:'open-app',message:'Sent Windows the request to open '+name+'.'};
 }
}
for (const name of ['controlVolume','controlBrowserWindow','controlSafariWindow','useYouTubeTheaterMode','useYouTubeResults','playSpotifyTrack','controlSpotifyWeb']) {
 WindowsControl.prototype[name] = async function() { throw Error('This browser, playback or window control is not implemented in the Windows preview yet.'); };
}
interruption.guardAsyncMethods(WindowsControl);
module.exports = WindowsControl;
