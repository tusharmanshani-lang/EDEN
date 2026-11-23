'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { commandFromTranscript } = require('../src/main/nativeSpeechAdapter');
let state = {active:false};
assert.equal(commandFromTranscript('open calculator',state),'');
assert.equal(commandFromTranscript('Hey Eden open calculator',state),'open calculator');
assert.equal(commandFromTranscript('go to sleep',state),'');
assert.equal(state.active,false);
const calls=[];
class Base { constructor(options){this.appPath=options.appPath;} validateText(value){return value;} }
const moduleMock={exports:{}};
const sandbox={URL,module:moduleMock,exports:moduleMock.exports,require(name){
 if(name==='../macControl')return Base;
 if(name==='electron')return {app:{getPath:key=>'C:/Users/Test/'+key},shell:{async openExternal(url){calls.push(url);},async openPath(){return '';}}};
 if(name==='../../core/interruption')return {guardAsyncMethods(){}};
 return require(name);
}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main/windows/control.js'),'utf8'),sandbox);
(async()=>{
 const controller=new moduleMock.exports({appPath:'C:/EDEN'});
 await controller.openWebsite('example.com');
 assert.equal(calls[0],'https://example.com/');
 for(const value of ['file:///C:/secret','https://user:pass@example.com','javascript://example.com']) await assert.rejects(()=>controller.openWebsite(value));
 await assert.rejects(()=>controller.openApp('cmd.exe /c anything'));
 await assert.rejects(()=>controller.controlSpotifyWeb('play'),/not implemented/);
 assert.equal(controller.getStatus().platform,'win32');
 assert.equal(controller.allowedRoots.length,7);
 console.log('Windows adapter and wake-command checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
