'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eden-files-check-'));
 const original=Module._load;
 try {
  for(const key of ['desktop','documents','downloads','pictures','videos','music','home'])await fs.mkdir(path.join(root,key));
  const electron={app:{getPath:key=>path.join(root,key)},shell:{openPath:async()=>'',openExternal:async()=>{}},screen:{}};
  Module._load=function(name,...args){return name==='electron'?electron:original.call(this,name,...args);};
  const Windows=require('../src/main/windows/control');
  const controller=new Windows({appPath:path.join(root,'project')});
  Module._load=original;
  const inside=path.join(root,'documents','hello.txt');await fs.writeFile(inside,'EDEN document test.');
  const result=await controller.readTextFile(inside);assert.equal(result.content,'EDEN document test.');
  await assert.rejects(()=>controller.readTextFile(path.join(root,'outside.txt')),/only access|approved|security/i);
  await fs.writeFile(path.join(root,'outside.txt'),'Private');
  try { await fs.symlink(path.join(root,'outside.txt'),path.join(root,'documents','escape.txt'));await assert.rejects(()=>controller.readTextFile(path.join(root,'documents','escape.txt')),/outside|approved/i); } catch(error) { if(!['EPERM','EACCES'].includes(error.code))throw error; }
  console.log('File checks passed: real TXT reading, outside-root refusal and symlink boundary.');
 } finally {Module._load=original;await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
