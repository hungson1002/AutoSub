import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {bundle} from '@remotion/bundler';
import {renderMedia,selectComposition} from '@remotion/renderer';
import {chat} from '../server/adapters/openaiCompatible';
import {VECTOR_DIRECTOR_CONTRACT,applyVectorRepairs,vectorMotionEvidence} from '../server/services/canvasVectorDirector';
import {compileVectorProject} from '../shared/canvasVectorScene';
import {resolveBrowserExecutable} from '../server/services/animationBrowser';
import {getAnimationAssetFile} from '../server/services/animationAssets';
import {run} from '../server/services/ffmpeg';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';

const started=Date.now(),out=path.resolve('tmp/vector-acting-8s');await mkdir(out,{recursive:true});
const original:CanvasStudioProject=JSON.parse(await readFile('tmp/vector-test-30s/project.json','utf8'));
let project=compileVectorProject({...original,id:randomUUID(),name:'Thử diễn hoạt 8 giây',vectorReview:undefined,scenes:[{...original.scenes[0]!,durationMs:8000}]});
const scene=project.scenes[0]!;
// Fixture rig: keep the drawing, place hip pivots at its actual leg roots,
// and attach the existing lantern to the carrying arm before asking for acting.
const actor=structuredClone(project.vectorAssets!['peasant-brown']!);
for(const node of actor.nodes){
  if(node.id==='leg-l'||node.id==='leg-r'){node.pivotX=node.id==='leg-l'?87:153;node.pivotY=340;}
}
const lanternIds=new Set(['lantern','glow','cord','body']);
for(const node of scene.vectorScene!.nodes.filter(n=>lanternIds.has(n.id))){
  actor.nodes.push(node.id==='lantern'?{...node,parent:'arm-r',x:32,y:135}:node);
}
scene.vectorScene!.nodes=scene.vectorScene!.nodes.filter(n=>!lanternIds.has(n.id));
scene.vectorScene!.tracks=[];
project.vectorAssets={...project.vectorAssets,'peasant-brown':actor};
project=compileVectorProject(project);
let response:string|undefined;
  try{response=await readFile(path.join(out,'acting-tracks.txt'),'utf8');}catch{}
if(!response){
  const db=new DatabaseSync(path.join(process.env.APPDATA!,'9router/db/data.sqlite'),{readOnly:true});
  const credential=db.prepare('SELECT key FROM apiKeys WHERE isActive=1 LIMIT 1').get() as {key:string}|undefined;db.close();
  if(!credential)throw new Error('Configured router credential unavailable');
  console.log('Generating one 8s performance using the updated tool contract; retained art and voice');
  response=await chat({id:'qa-router',name:'9Router',baseUrl:'http://127.0.0.1:20128/v1',enabled:true,models:[],providerType:'openai-compatible',authType:'bearer',apiKey:credential.key},'ag/gemini-3.8-flash-high',[
    {role:'system',content:VECTOR_DIRECTOR_CONTRACT+'\nThis is a PERFORMANCE-ONLY test with an already rigged actor. Return ONLY {"visualBrief":"timed actions","tracks":[...]} for one 8s shot. Do not output geometry, assets, narration or scenes. Targets available: walker (body dx/dy), walker/leg-l and walker/leg-r (rotation around hip), walker/arm-l and walker/arm-r (shoulder rotation), walker/head-group (head rotation), walker/eye-l, walker/eye-r, walker/mouth (scaleY). The existing lantern is already attached under arm-r. Plan 0-4s alternating footsteps plus body travel and counter-swing arms, 4-5s decelerate and stop, 5-6.5s turn head to listen and raise free left hand, 6.5-8s look the other way and draw hand back. Keep body stable during listening. Use explicit full-shot multi-key tracks without cues. Max 20 frames per track. No background animation.'},
    {role:'user',content:'Make the simple character visibly act throughout all 8 seconds. Body travels dx=-80 to dx=50 only while walking; legs are 110 units long, hip pivot at their roots. Match gait speed to 130 units of travel. Arms face downward at rest. Keep movement restrained, joints connected, eyes and mouth attached.'},
  ],AbortSignal.timeout(60000),3000);
  await writeFile(path.join(out,'acting-tracks.txt'),response);
}
const acting=JSON.parse(response.slice(response.indexOf('{'),response.lastIndexOf('}')+1));
project=applyVectorRepairs(project,JSON.stringify({scenes:[{id:scene.id,visualBrief:acting.visualBrief,vectorScene:{...project.scenes[0]!.vectorScene,tracks:acting.tracks}}]}),new Set([scene.id]));
await writeFile(path.join(out,'project.json'),JSON.stringify(project,null,2));
await writeFile(path.join(out,'motion.json'),JSON.stringify(vectorMotionEvidence(project.scenes[0]!),null,2));
console.log('Rendering one native Remotion SVG clip, concurrency=1');
const visual={...project,scenes:project.scenes.map(s=>({...s,audioUrl:undefined}))};
const serveUrl=await bundle({entryPoint:path.resolve('src/remotion/index.tsx'),rootDir:path.resolve('.'),publicDir:null});
const inputProps={project:visual,assetOrigin:'http://127.0.0.1:8787'},browserExecutable=resolveBrowserExecutable();
if(!browserExecutable)throw new Error('Production Chromium unavailable');
const composition=await selectComposition({serveUrl,id:'AutoSubCanvasAnimation',inputProps,browserExecutable,logLevel:'warn'});
if(composition.durationInFrames!==240)throw new Error('Expected 240 frames');
const silent=path.join(out,'silent.mp4');
await renderMedia({serveUrl,composition,inputProps,browserExecutable,codec:'h264',pixelFormat:'yuv420p',crf:21,x264Preset:'ultrafast',concurrency:1,logLevel:'warn',muted:true,timeoutInMilliseconds:120000,overwrite:true,outputLocation:silent});
const id=scene.audioUrl?.match(/^\/api\/animation-studio\/assets\/([a-f0-9-]{36})\/file$/i)?.[1];
if(!id)throw new Error('Retained local narration unavailable');
const audio=await getAnimationAssetFile(id),video=path.join(out,'AutoSub_Action_Test_8s.mp4');
await run('ffmpeg',['-v','error','-y','-i',silent,'-i',audio.path,'-map','0:v','-map','1:a','-af','apad,atrim=duration=8','-c:v','copy','-c:a','aac','-t','8','-movflags','+faststart',video]);
await run('ffmpeg',['-v','error','-i',video,'-f','null','-']);
await run('ffmpeg',['-v','error','-y','-i',video,'-vf','fps=2,scale=216:384,tile=8x2:padding=4:margin=4','-frames:v','1',path.join(out,'overview.jpg')]);
const destination=path.join(process.env.USERPROFILE!,'Downloads','AutoSub_Action_Test_8s.mp4');await copyFile(video,destination);
console.log(JSON.stringify({video:destination,seconds:8,frames:240,decode:'passed',elapsedSeconds:Math.round((Date.now()-started)/1000)}));
