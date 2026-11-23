'use strict';
const assert=require('node:assert/strict');
const {createAudioInput,validateAudio}=require('../src/main/windows/audio-input');
const {args}=require('../src/main/windows/speech-output');
const input={mimeType:'audio/webm',bytes:new Uint8Array(300)};
(async()=>{
 assert.throws(()=>validateAudio({...input,mimeType:'video/webm'}));
 assert.throws(()=>validateAudio({...input,bytes:new Uint8Array(8)}));
 assert.throws(()=>validateAudio({...input,bytes:new Uint8Array(5*1024*1024)}));
 assert.throws(()=>validateAudio({...input,bytes:'abc'}));
 let calls=0;
 const ai={models:{async generateContent(options){calls++;assert.equal(options.contents[0].parts[1].inlineData.mimeType,'audio/webm');return {text:JSON.stringify({text:'open calculator'})};}}};
 const audio=createAudioInput({getBrain:()=>({ai,model:'test-model'}),isLocal:async()=>false});
 assert.deepEqual(await audio.transcribe(input),{text:'open calculator'});assert.equal(calls,1);
 const local=createAudioInput({getBrain:()=>({ai,model:'test-model'}),isLocal:async()=>true});
 await assert.rejects(()=>local.transcribe(input),/local mode/);assert.equal(calls,1);
 const silent=createAudioInput({getBrain:()=>({model:'test',ai:{models:{async generateContent(){return{text:'{"text":""}'};}}}}),isLocal:async()=>false});
 await assert.rejects(()=>silent.transcribe(input),/No clear speech/);
 let finish;
 const waiting=createAudioInput({getBrain:()=>({model:'test',ai:{models:{generateContent(){return new Promise(resolve=>{finish=resolve;});}}}}),isLocal:async()=>false});
 const pending=waiting.transcribe(input);await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(()=>waiting.transcribe(input),/already/);waiting.cancel();finish({text:'{"text":"do not use"}'});await assert.rejects(pending,/cancelled/);
 const quota=createAudioInput({getBrain:()=>({model:'test',ai:{models:{async generateContent(){throw Object.assign(Error('secret-should-not-leak'),{status:429});}}}}),isLocal:async()=>false});
 await assert.rejects(()=>quota.transcribe(input),/quota/);
 assert.equal(args.includes('-File'),false);assert.equal(args.includes('-ExecutionPolicy'),false);assert.equal(args[args.length-2],'-Command');
 console.log('Windows recovery tests passed: payload validation, transcript return, local mode, silence, cancellation, concurrency, quota and speech argument safety.');
})().catch(error=>{console.error(error);process.exitCode=1;});

// Exercise the actual window functions with a fake Electron window; no Windows UI is claimed.
{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
 const source=fs.readFileSync(path.join(__dirname,'../src/main/index.js'),'utf8');
 const start=source.indexOf('function createWindow({ hidden');
 const end=source.indexOf('if (!app.requestSingleInstanceLock())',start);
 class Window extends EventEmitter {
  constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.minimized=false;this.shown=0;}
  loadFile(){return Promise.resolve();} isDestroyed(){return false;} isMinimized(){return this.minimized;}
  restore(){this.minimized=false;this.restored=true;} show(){this.shown++;} focus(){this.focused=true;}
 }
 const context={BrowserWindow:Window,process:{platform:'win32'},path,__dirname:'C:/EDEN/src/main',mainWindow:null,mainWindowCreated:false,quitting:false,activeSpeech:null,activeRequest:null,interruptEverything(){},require(){return{dialog:{showErrorBox(){}}};}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 context.createWindow();assert.equal(context.mainWindow.options.show,true);
 context.mainWindow.minimized=true;context.showEden();assert.equal(context.mainWindow.restored,true);assert.equal(context.mainWindow.focused,true);
 let prevented=false;context.mainWindow.emit('close',{preventDefault(){prevented=true;}});assert.equal(prevented,false);
 console.log('Window recovery tests passed: visible launch, minimized restore and normal Windows close.');
}
