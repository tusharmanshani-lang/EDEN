'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const children=[];
function spawn(){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;};children.push(child);return child;}
const mod={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main/windows/voice.js'),'utf8'),{
 module:mod,process:{env:{SystemRoot:'C:\\Windows'}},__dirname:'C:/EDEN/windows',setTimeout,clearTimeout,
 require(name){if(name==='node:child_process')return {spawn};if(name==='../nativeSpeechAdapter')return require('../src/main/nativeSpeechAdapter');return require(name);}
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const emit=(child,value)=>child.stdout.write(JSON.stringify(value)+'\n');
(async()=>{
 const commands=[],errors=[],adapter=mod.exports.speechAdapter();
 const handlers={onKeyword(){},onCommand:text=>commands.push(text),onError:error=>errors.push(error.message)};
 const starting=adapter.start(handlers);emit(children[0],{kind:'ready'});await starting;
 emit(children[0],{kind:'transcript',text:'Hey Eden open calculator'});await tick();assert.equal(commands[0],'open calculator');
 await adapter.stop();emit(children[0],{kind:'transcript',text:'open chrome'});await tick();assert.equal(commands.length,1);
 children[0].emit('close');assert.equal(errors.length,0);
 const second=adapter.start(handlers);emit(children[1],{kind:'ready'});await second;children[1].emit('close');assert.equal(errors.length,1);
 const third=adapter.start(handlers);const rejected=assert.rejects(third,/cancelled/);await adapter.stop();await rejected;children[2].emit('close');
 const fourth=adapter.start(handlers);const failed=assert.rejects(fourth,/permission/);emit(children[3],{kind:'error',text:'permission denied'});await failed;children[3].emit('close');
 assert.match(mod.exports.powershell(),/^C:\\Windows\\System32\\WindowsPowerShell/);
 console.log('Voice lifecycle checks passed: startup, command, stop, restart, cancellation and failure.');
})().catch(error=>{console.error(error);process.exitCode=1;});
