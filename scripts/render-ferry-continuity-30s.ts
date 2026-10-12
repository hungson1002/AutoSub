import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {bundle} from '@remotion/bundler';
import {renderMedia,selectComposition,renderStill} from '@remotion/renderer';
import {compileVectorProject} from '../shared/canvasVectorScene';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';
import {repairFerryContinuity} from './horror-ferry-continuity';
import {resolveBrowserExecutable} from '../server/services/animationBrowser';
import {getAnimationAssetFile} from '../server/services/animationAssets';
import {synthesizeCanvasFoley} from '../server/services/canvasFoley';
import {run} from '../server/services/ffmpeg';

const out=path.resolve('tmp/ferry-light-cut-30s');await mkdir(out,{recursive:true});
const original:CanvasStudioProject=JSON.parse(await readFile('tmp/horror-ferry-5min/project.json','utf8'));
const full=compileVectorProject(repairFerryContinuity(original));
await writeFile(path.join(out,'full-project.json'),JSON.stringify(full,null,2));
const project={...full,id:'ferry-continuity-preview',name:'Bến đò · Camera và minh họa lời kể',scenes:[3,4,5].map(i=>structuredClone(full.scenes[i]!))};
project.scenes[2]!.durationMs+=30000-project.scenes.reduce((sum,s)=>sum+s.durationMs,0);
assert.equal(project.scenes.reduce((sum,s)=>sum+Math.round(s.durationMs/1000*30),0),900);
for(const s of project.scenes)assert.ok(s.vectorScene!.nodes.some(n=>n.id==='hull'),'every view retains the actual boat');
await writeFile(path.join(out,'project.json'),JSON.stringify(project,null,2));
const visual={...project,scenes:project.scenes.map(s=>({...s,audioUrl:undefined}))};
const browserExecutable=resolveBrowserExecutable();if(!browserExecutable)throw new Error('Missing production browser');
const serveUrl=await bundle({entryPoint:path.resolve('src/remotion/index.tsx'),rootDir:path.resolve('.'),publicDir:null});
const inputProps={project:visual,assetOrigin:'http://127.0.0.1:8787'};
const composition=await selectComposition({serveUrl,id:'AutoSubCanvasAnimation',inputProps,browserExecutable,logLevel:'warn'});
for(const [name,frame] of [['wide',240],['close',440],['footprints',850]] as const)
  await renderStill({serveUrl,composition,inputProps,browserExecutable,frame,imageFormat:'png',output:path.join(out,`${name}.png`),logLevel:'warn'});
// Also inspect corrected late-story interactions without re-exporting five minutes.
const stillProject={...full,scenes:[11,15,18,19].map(i=>({...full.scenes[i]!,audioUrl:undefined}))};
const stillProps={project:stillProject,assetOrigin:'http://127.0.0.1:8787'};
const stillComposition=await selectComposition({serveUrl,id:'AutoSubCanvasAnimation',inputProps:stillProps,browserExecutable,logLevel:'warn'});
let frameOffset=0;
for(const [i,s] of stillProject.scenes.entries()){
  await renderStill({serveUrl,composition:stillComposition,inputProps:stillProps,browserExecutable,frame:frameOffset+Math.round(s.durationMs/1000*30*.86),imageFormat:'png',output:path.join(out,`${['grip','brace','payment','bell'][i]}.png`),logLevel:'warn'});
  frameOffset+=Math.round(s.durationMs/1000*30);
}
console.log('Continuity preflight ready');
if(process.argv.includes('--stills-only'))process.exit(0);
let last=-1;
await renderMedia({serveUrl,composition,inputProps,browserExecutable,codec:'h264',pixelFormat:'yuv420p',crf:21,x264Preset:'ultrafast',concurrency:2,logLevel:'warn',muted:true,timeoutInMilliseconds:120000,outputLocation:path.join(out,'silent.mp4'),onProgress:({progress})=>{const step=Math.floor(progress*10);if(step!==last){last=step;console.log(`Render ${Math.round(progress*100)}%`);}}});
const inputs:string[]=[],filters:string[]=[];
for(const [i,s] of project.scenes.entries()){
  const id=s.audioUrl?.match(/assets\/([a-f0-9-]{36})\/file/i)?.[1];assert.ok(id);
  inputs.push('-i',(await getAnimationAssetFile(id)).path);
  filters.push(`[${i+1}:a]apad,atrim=duration=${s.durationMs/1000},asetpts=PTS-STARTPTS[a${i}]`);
}
await writeFile(path.join(out,'plank-creak.wav'),synthesizeCanvasFoley('door-creak',800,47));
inputs.push('-i',path.join(out,'plank-creak.wav'));
filters.push('[a0][a1][a2]concat=n=3:v=0:a=1[bed]','[4:a]volume=0.15,adelay=14500|14500[creak]','[bed][creak]amix=inputs=2:normalize=0,alimiter=limit=0.94:level=0:latency=1,apad,atrim=duration=30[audio]');
const video=path.join(out,'AutoSub_BenDo_CatCan_AnhDen_30s.mp4');
await run('ffmpeg',['-v','error','-y','-i',path.join(out,'silent.mp4'),...inputs,'-filter_complex',filters.join(';'),'-map','0:v','-map','[audio]','-c:v','copy','-c:a','aac','-b:a','192k','-t','30','-movflags','+faststart',video]);
await run('ffmpeg',['-v','error','-i',video,'-f','null','-']);
await writeFile(path.join(out,'probe.json'),(await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',video])).stdout);
const destination=path.join(process.env.USERPROFILE!,'Downloads',path.basename(video));await copyFile(video,destination);console.log(destination);
