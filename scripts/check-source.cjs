'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
let count=0;
function check(root){for(const name of fs.readdirSync(root)){const file=path.join(root,name),stat=fs.statSync(file);if(stat.isDirectory())check(file);else if(/\.(?:js|cjs)$/.test(name)){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0)throw Error(file+'\n'+result.stderr);count++;}}}
check('src');check('scripts');check('tests');console.log('Syntax checked '+count+' JavaScript files.');
