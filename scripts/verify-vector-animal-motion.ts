// Re-run the actual AI-authored film through the production parser/compiler.
// Keep its screenplay, drawing choices and measured audio; no scene patches.
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import sharp from 'sharp';
import {parseVectorPlan,applySelectedHorrorFinish} from '../server/services/canvasVectorDirector';
import {compileVectorProject,evaluateVectorPart,vectorTrackTiming} from '../shared/canvasVectorScene';
import {VectorSceneFrame} from '../src/remotion/VectorSceneFrame';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';
Object.assign(globalThis,{React});
const out=process.argv[2]||'tmp/vector-animal-motion-fix';await mkdir(out,{recursive:true});
const dir='workdir/canvas-vector-plans/99388c8fb5052967fc2117b3057c87d2cf268e62144bec86a9d3b8c3c063bbae';
const original:CanvasStudioProject=JSON.parse(await readFile('tmp/pig-tool-1min-new/project.json','utf8'));
const cp=JSON.parse(await readFile(dir+'/checkpoint.json','utf8'));
const text=await readFile(dir+'/response.txt','utf8'),raw=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));
raw.scenes.forEach((s:any,i:number)=>{s.narration=original.scenes[i]!.narration;s.durationMs=original.scenes[i]!.durationMs;});
const parsed=parseVectorPlan(applySelectedHorrorFinish(JSON.stringify(raw),original.sourcePrompt||''),original.sourcePrompt||'',{width:720,height:1280},60,cp.story);
parsed.scenes=parsed.scenes.map((s,i)=>({...s,id:original.scenes[i]!.id,durationMs:original.scenes[i]!.durationMs,dialogue:original.scenes[i]!.dialogue,
  audioUrl:original.scenes[i]!.audioUrl,soundEffects:original.scenes[i]!.soundEffects}));
const project=compileVectorProject({...parsed,name:'Heo năm móng — sửa lớp chân và phản ứng sợ',exportDurationMs:60000,
  vectorReview:undefined});
await writeFile(out+'/project.json',JSON.stringify(project,null,2));
const routes=project.scenes.flatMap(s=>s.vectorScene!.tracks.filter(t=>t.target==='person'&&t.frames.some(f=>f.dx!==t.frames[0]!.dx)).map(t=>{
  const timing=vectorTrackTiming(t,s),before=evaluateVectorPart('person',s,timing.start).dx,end=evaluateVectorPart('person',s,timing.end).dx,sign=Math.sign(end-before);let last=before,backwards=0;
  for(let ms=timing.start;ms<=timing.end;ms+=1000/30){const x=evaluateVectorPart('person',s,ms).dx;if((x-last)*sign<-.01)backwards++;last=x;}
  return {scene:s.name,before,end,backwards};
}));
await writeFile(out+'/route-evidence.json',JSON.stringify(routes,null,2));
if(routes.some(r=>r.backwards))throw new Error('A generated route still reverses unexpectedly');
const samples=[{scene:1,time:1600,label:'Travel'}, {scene:3,time:1800,label:'Same pig, corrected leg depth'},
  {scene:4,time:1200,label:'Fear: trembling mouth and forehead stress'}, {scene:5,time:1800,label:'Retreat'}];
const images=await Promise.all(samples.map(async (sample,i)=>{
  const html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene:project.scenes[sample.scene]!,timeMs:sample.time,width:720,height:1280}));
  const png=await sharp(Buffer.from(html.match(/<svg[\s\S]*?<\/svg>/)![0])).png().toBuffer();
  await writeFile(out+`/frame-${i}.png`,png);return sharp(png).resize(360,640).png().toBuffer();
}));
await sharp({create:{width:1440,height:640,channels:4,background:'#ffffff'}}).composite(images.map((input,i)=>({input,left:i*360,top:0}))).png().toFile(out+'/native-frames.png');
console.log(JSON.stringify({project:out+'/project.json',routes,sourceMs:project.scenes.reduce((n,s)=>n+s.durationMs,0),exportMs:project.exportDurationMs}));
