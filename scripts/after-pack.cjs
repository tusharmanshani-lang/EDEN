'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
module.exports=async context=>{
 if(context.electronPlatformName!=='win32')return;
 const root=path.join(context.appOutDir,'resources','app');
 for(const name of ['src/voice/native','src/main/eden-screen','src/main/eden-screen.swift','src/main/scheduler-native.swift']) await fs.rm(path.join(root,name),{recursive:true,force:true});
 const canvas=path.join(root,'node_modules','@napi-rs','canvas-win32-x64-msvc');
 await fs.access(canvas).catch(()=>{throw Error('Windows PDF dependency is missing. Build on the Windows GitHub Actions runner; do not distribute this package.');});
 const nativeRoot=path.join(root,'node_modules','@napi-rs');
 for(const name of await fs.readdir(nativeRoot)) if(name.startsWith('canvas-') && name!=='canvas-win32-x64-msvc')await fs.rm(path.join(nativeRoot,name),{recursive:true,force:true});
};
