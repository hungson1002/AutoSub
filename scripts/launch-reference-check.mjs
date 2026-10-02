import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
const mode=process.argv.includes('--cached')?'cached':'pilot';
const script=mode==='cached'?'scripts/render-reference-cached.ts':'scripts/render-reference-pilot.ts';
const dir=path.resolve(mode==='cached'?'workdir/reference-cached-v2':'workdir/reference-pilot');fs.mkdirSync(dir,{recursive:true});
const marker=path.join(dir,'pid.json');if(fs.existsSync(marker)){const {pid}=JSON.parse(fs.readFileSync(marker,'utf8'));try{process.kill(pid,0);console.log(JSON.stringify({status:'already-running',pid}));process.exit(0);}catch{}}
const log=fs.openSync(path.join(dir,'run.log'),'a');const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs',script],{cwd:process.cwd(),detached:true,stdio:['ignore',log,log]});fs.writeFileSync(marker,JSON.stringify({pid:child.pid,startedAt:new Date().toISOString()}));child.unref();console.log(JSON.stringify({status:'started',pid:child.pid}));
