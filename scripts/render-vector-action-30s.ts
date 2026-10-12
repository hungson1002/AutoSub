import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {bundle} from '@remotion/bundler';
import {renderMedia,selectComposition,renderStill} from '@remotion/renderer';
import {compileVectorProject,evaluateVectorPart,type VectorNode,type VectorTrack,type VectorFrame} from '../shared/canvasVectorScene';
import {vectorMotionEvidence} from '../server/services/canvasVectorDirector';
import {resolveBrowserExecutable} from '../server/services/animationBrowser';
import {getAnimationAssetFile,registerAnimationAsset} from '../server/services/animationAssets';
import {synthesizeCanvasFoley} from '../server/services/canvasFoley';
import {canvasAudioFilter} from '../server/services/canvasAudioProduction';
import {run} from '../server/services/ffmpeg';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';

const started=Date.now(),out=path.resolve('tmp/vector-action-30s-v4');await mkdir(out,{recursive:true});
const original:CanvasStudioProject=JSON.parse(await readFile('tmp/quy-cau-remotion-svg-v2/project.json','utf8'));
const p:CanvasStudioProject=structuredClone({...original,id:randomUUID(),name:'Quỷ Cẩu — diễn hoạt mới 30 giây',vectorReview:undefined,scenes:[original.scenes[0]!,original.scenes[2]!,original.scenes[3]!,{...original.scenes[5]!,narration:original.scenes[6]!.narration,dialogue:original.scenes[6]!.dialogue,audioUrl:original.scenes[6]!.audioUrl}]});
const durations=[7500,8000,7500,7000];p.scenes.forEach((s,i)=>{s.durationMs=durations[i]!;s.vectorScene!.tracks=[];});
const track=(target:string,frames:VectorFrame[]):VectorTrack=>({target,start:0,end:1,frames:frames.map(f=>({...f,easing:f.easing==='hold'?'hold':'smooth'}))});
const rot=(target:string,values:Array<[number,number]>)=>track(target,values.map(([t,rotation])=>({t,rotation,easing:'ease-in-out'})));
const part=(id:string,type:VectorNode['type'],props:Partial<VectorNode>):VectorNode=>({id,type,...props});

// Keep the existing flat character; replace rigid legs with hip/knee chains.
for(const key of ['peasant-brown','peasant-blue']){
  const a=p.vectorAssets![key]!;
  a.nodes=a.nodes.filter(n=>!['leg-l','leg-r','topknot'].includes(n.id));
  for(const side of ['l','r']){
    const shoulder=a.nodes.find(n=>n.id===`arm-${side}`)!;
    Object.assign(shoulder,{x:side==='l'?80:160,y:190,pivotX:0,pivotY:0});
    const sleeve=a.nodes.find(n=>n.id===`sleeve-${side}`)!;
    sleeve.d='M -10 0 Q -10 -10 0 -10 Q 10 -10 10 0 L 10 96 Q 0 106 -10 96 Z';
    Object.assign(a.nodes.find(n=>n.id===`hand-${side}`)!,{x:0,y:110});
  }
  const legs:VectorNode[]=[];
  for(const [side,x,color] of [['l',87,'#382c26'],['r',153,'#49372c']] as const){
    legs.push(part(`leg-${side}`,'group',{x,y:340}),
      part(`thigh-${side}`,'path',{parent:`leg-${side}`,fill:color,d:'M -9 -4 Q 0 -8 9 -4 L 10 55 Q 0 62 -10 55 Z'}),
      part(`knee-${side}`,'group',{parent:`leg-${side}`,y:55}),
      part(`shin-${side}`,'path',{parent:`knee-${side}`,fill:color,d:'M -9 -2 L 9 -2 L 8 54 Q 0 60 -8 54 Z'}),
      part(`shoe-${side}`,'ellipse',{parent:`knee-${side}`,x:6,y:55,rx:18,ry:7,fill:'#15191e'}));
  }
  a.nodes.splice(1,0,...legs);
}
const walk=p.scenes[0]!,wv=walk.vectorScene!;
const lanternIds=new Set(['lantern','glow','cord','body']);
const walker=structuredClone(p.vectorAssets!['peasant-brown']!);
for(const n of wv.nodes.filter(n=>lanternIds.has(n.id)))walker.nodes.push(n.id==='lantern'?{...n,parent:'arm-r',x:-10,y:130}:n);
p.vectorAssets!['peasant-walking']=walker;
wv.nodes=wv.nodes.filter(n=>!lanternIds.has(n.id)&&n.id!=='fog-foreground');
Object.assign(wv.nodes.find(n=>n.id==='walker')!,{asset:'peasant-walking',x:180,y:490,width:270,height:540});
walk.visualBrief='0–4.2s đi bốn nhịp chân, tay đối nhịp và đèn gắn vào tay; 4.2–5s giảm tốc dừng; 5–7.5s giữ tư thế nhìn sang phía tiếng động. Vạt áo đung đưa nhẹ; đèn còn lắc do quán tính rồi tắt dần.';
const gaitL:VectorFrame[]=[],gaitR:VectorFrame[]=[],kneeL:VectorFrame[]=[],kneeR:VectorFrame[]=[],armL:VectorFrame[]=[],armR:VectorFrame[]=[];
for(let i=0;i<=16;i++){
  const t=i/16*.56,phase=i/4*Math.PI*2;
  gaitL.push({t,rotation:Math.sin(phase)*13,easing:'linear'});gaitR.push({t,rotation:-Math.sin(phase)*13,easing:'linear'});
  kneeL.push({t,rotation:Math.max(0,-Math.cos(phase))*24,easing:'linear'});kneeR.push({t,rotation:Math.max(0,Math.cos(phase))*24,easing:'linear'});
  armL.push({t,rotation:-Math.sin(phase)*10,easing:'linear'});armR.push({t,rotation:Math.sin(phase)*7,easing:'linear'});
}
for(const frames of [gaitL,gaitR,kneeL,kneeR,armL,armR])frames.push({t:.65,rotation:0,easing:'ease-out'});
armL.push({t:.73,rotation:-2},{t:.83,rotation:1},{t:1,rotation:0});
wv.tracks=[track('walker',[{t:0,dx:-80},{t:.56,dx:60,easing:'linear'},{t:.65,dx:65,easing:'ease-out'},{t:1,dx:65}]),
  track('walker/leg-l',gaitL),track('walker/leg-r',gaitR),track('walker/knee-l',kneeL),track('walker/knee-r',kneeR),track('walker/arm-l',armL),track('walker/arm-r',armR),
  rot('walker/head-group',[[0,0],[.56,0],[.72,-6],[.88,-6],[1,-4]]),
  track('walker/eye-l',[{t:0,scaleY:1},{t:.67,scaleY:1},{t:.69,scaleY:.1},{t:.72,scaleY:1},{t:1,scaleY:1}])];

// Short connected neck; same canine body with independent head, jaw and ears.
const dog=structuredClone(p.vectorAssets!['demon-dog']!);
Object.assign(dog.nodes.find(n=>n.id==='neck-chest')!,{d:'M 280 195 C 293 175 298 161 305 151 Q 329 159 333 187 Q 335 218 315 241 Z'});
Object.assign(dog.nodes.find(n=>n.id==='head-pivot-group')!,{x:313,y:158});
Object.assign(dog.nodes.find(n=>n.id==='head-cranium')!,{d:'M -22 14 C -28 -10 -10 -28 16 -25 C 35 -22 43 -5 52 4 L 92 10 Q 105 16 94 28 L 43 34 C 12 42 -16 29 -22 14 Z'});
Object.assign(dog.nodes.find(n=>n.id==='upper-snout')!,{d:'M 35 7 Q 60 7 95 13 L 94 28 Q 70 34 42 30 Z'});
Object.assign(dog.nodes.find(n=>n.id==='ear-front')!,{d:'M 10 -20 L 22 -55 Q 35 -42 40 -18 Z',pivotX:25,pivotY:-20});
Object.assign(dog.nodes.find(n=>n.id==='ear-back')!,{pivotX:0,pivotY:-15});
Object.assign(dog.nodes.find(n=>n.id==='ear-back')!,{d:'M -14 -12 L -9 -43 Q 8 -32 12 -18 Z',pivotX:0,pivotY:-15});
Object.assign(dog.nodes.find(n=>n.id==='jaw-group')!,{x:35,y:30});
Object.assign(dog.nodes.find(n=>n.id==='jaw-base')!,{d:'M 0 0 L 58 -2 Q 68 8 54 15 L 10 12 Z'});
Object.assign(dog.nodes.find(n=>n.id==='fangs-upper')!,{d:'M 74 30 L 78 39 L 82 30 Z'});
Object.assign(dog.nodes.find(n=>n.id==='fang-lower')!,{d:'M 41 2 L 45 -6 L 49 2 Z'});
Object.assign(dog.nodes.find(n=>n.id==='tail')!,{pivotX:110,pivotY:215,d:'M 120 195 C 82 167 44 166 15 235 Q 52 216 120 238 Z'});
dog.nodes.push(part('nose','ellipse',{parent:'head-pivot-group',x:94,y:16,rx:7,ry:6,fill:'#0b1016'}));
for(let i=0;i<3;i++)dog.nodes.push(part(`sound-${i}`,'path',{parent:'head-pivot-group',x:112+i*16,y:18,opacity:0,fill:'none',stroke:'#efb7a2',strokeWidth:3,d:'M 0 -18 Q 16 0 0 18'}));
p.vectorAssets!['dog-short-neck']=dog;
const howl=p.scenes[1]!,hv=howl.vectorScene!;
Object.assign(hv.nodes.find(n=>n.id==='howling-dog')!,{asset:'dog-short-neck',x:38,y:470,width:600,height:496});
hv.nodes=hv.nodes.filter(n=>n.id!=='foreground-darkness');
hv.nodes.push(part('hill-ground','path',{fill:'#18212a',d:'M 0 1010 Q 360 900 720 970 L 720 1280 L 0 1280 Z'}));
// Ground behind the actor, preserving the black-on-red silhouette.
const ground=hv.nodes.pop()!;hv.nodes.splice(hv.nodes.findIndex(n=>n.id==='howling-dog'),0,ground);
howl.visualBrief='0–1.5s đánh hơi và vểnh tai, 1.5–2.5s ngẩng đầu, 2.5–6.6s há/khép hàm ba tiếng tru, 6.6–8s hạ đầu nhìn về làng; thân và bốn chân đứng vững.';
hv.tracks=[rot('howling-dog/head-pivot-group',[[0,8],[.12,14],[.2,0],[.32,-43],[.8,-43],[.92,-14],[1,0]]),
  rot('howling-dog/jaw-group',[[0,0],[.32,0],[.38,35],[.45,2],[.5,0],[.56,35],[.63,2],[.67,0],[.73,35],[.81,0],[1,0]]),
  rot('howling-dog/ear-front',[[0,-8],[.12,8],[.22,-4],[.32,0],[.83,0],[.9,9],[1,0]]),
  rot('howling-dog/tail',[[0,-8],[.15,6],[.3,-4],[.82,-4],[.92,8],[1,-4]])];
for(let i=0;i<3;i++){
  const frames:VectorFrame[]=[{t:0,opacity:0,dx:0,scaleX:1,scaleY:1}];
  for(const t of [.32,.5,.67]){
    const a=t+i*.012;
    frames.push({t:a,opacity:0,dx:0,scaleX:1,scaleY:1},{t:a+.035,opacity:.8},{t:a+.105,opacity:0,dx:15,scaleX:1.15,scaleY:1.15});
  }
  frames.push({t:1,opacity:0});hv.tracks.push(track(`howling-dog/sound-${i}`,frames));
}

const react=p.scenes[2]!,rv=react.vectorScene!;
rv.nodes=rv.nodes.filter(n=>n.id!=='vignette');
Object.assign(rv.nodes.find(n=>n.id==='man-bust')!,{x:170,y:380,width:380,height:760});
react.visualBrief='Giật mình co người rồi đứng vững, quay đầu tìm tiếng tru, đưa tay ra hỏi, miệng nói từng nhịp, nghe lại rồi rụt tay và lùi nửa bước.';
rv.tracks=[track('man-bust',[{t:0,dx:0,dy:0},{t:.07,dx:-12,dy:-8,easing:'ease-out'},{t:.17,dx:-4,dy:0},{t:.75,dx:-4},{t:.9,dx:-24,easing:'ease-in-out'},{t:1,dx:-24}]),
  rot('man-bust/head-group',[[0,0],[.14,-8],[.32,-12],[.6,-12],[.82,-5],[1,-5]]),
  rot('man-bust/arm-l',[[0,0],[.14,35],[.32,25],[.65,25],[.9,12],[1,12]]),
  rot('man-bust/arm-r',[[0,0],[.15,-22],[.32,-6],[1,-6]]),
  track('man-bust/mouth',[{t:0,scaleY:1},{t:.12,scaleY:2.4},{t:.32,scaleY:1},{t:.52,scaleY:1},{t:.57,scaleY:2.8},{t:.62,scaleY:.8},{t:.67,scaleY:2.6},{t:.72,scaleY:.8},{t:.8,scaleY:2},{t:.9,scaleY:.8},{t:1,scaleY:.8}]),
  track('man-bust/eye-l',[{t:0,scaleY:1,dx:0},{t:.12,scaleY:1.4,dx:-3},{t:.45,scaleY:1.4,dx:-3},{t:.48,scaleY:.15},{t:.51,scaleY:1.2},{t:1,scaleY:1.2,dx:-2}]),
  track('man-bust/eye-r',[{t:0,dx:0},{t:.12,dx:-3},{t:.29,dx:3},{t:.45,dx:-2},{t:.77,dx:3},{t:1,dx:-3}])];

const end=p.scenes[3]!,ev=end.vectorScene!;
end.name='Dấu chân và lời cảnh báo';end.visualBrief='Hai người nhìn xuống dấu chân, người áo nâu chỉ xuống đất; người áo xanh nhìn sang bạn và giơ tay cảnh báo. Giữ tư thế để lời cảnh báo rõ; vạt áo và nhịp thở vẫn nhẹ nhàng, chân đứng yên.';
for(const [id,x] of [['villager-brown',35],['villager-blue',465]] as const)Object.assign(ev.nodes.find(n=>n.id===id)!,{x,y:660,width:220,height:440});
ev.tracks=[rot('villager-brown/head-group',[[0,0],[.2,10],[.55,10],[.8,-4],[1,-4]]),
  rot('villager-brown/arm-r',[[0,0],[.25,-32],[.55,-32],[.85,-8],[1,0]]),
  rot('villager-blue/head-group',[[0,0],[.28,-10],[.48,8],[1,8]]),
  rot('villager-blue/arm-l',[[0,0],[.35,0],[.53,70],[.73,70],[.9,25],[1,10]]),
  rot('villager-blue/arm-r',[[0,0],[.25,-10],[.48,-28],[.68,-28],[1,0]])];

// Gate leaves open in yaw about attached vertical hinges. No diagonal 2D spin.
const oldGate=new Set(['gate-post-left','gate-post-right','open-gate-door-l','open-gate-door-r','door-frame-l','door-frame-r','slats-l','slats-r']);
ev.nodes=ev.nodes.filter(n=>!oldGate.has(n.id));
const gate:VectorNode[]=[
  part('wall-left','rect',{x:0,y:610,width:122,height:320,fill:'#9f8e70'}),part('wall-right','rect',{x:598,y:610,width:122,height:320,fill:'#9f8e70'}),
  part('gate-post-left','rect',{x:120,y:490,width:36,height:450,fill:'#69503a',stroke:'#3e3027',strokeWidth:4}),
  part('gate-post-right','rect',{x:564,y:490,width:36,height:450,fill:'#69503a',stroke:'#3e3027',strokeWidth:4}),
  part('gate-lintel','rect',{x:108,y:480,width:504,height:38,fill:'#775a3c',stroke:'#3e3027',strokeWidth:4})];
for(const side of ['l','r']){
  const id=`gate-leaf-${side}`,left=side==='l';
  gate.push(part(id,'group',{x:left?156:564,y:554,scaleX:.65}),
    part(`${id}-frame`,'rect',{parent:id,x:left?0:-204,y:0,width:204,height:350,fill:'none',stroke:'#523923',strokeWidth:9}));
  for(let i=0;i<6;i++)gate.push(part(`${id}-picket-${i}`,'rect',{parent:id,x:(left?0:-204)+12+i*32,y:0,width:19,height:350,fill:'#96734e',stroke:'#65472b',strokeWidth:2}));
  for(const y of [65,260])gate.push(part(`${id}-rail-${y}`,'rect',{parent:id,x:left?0:-204,y,width:204,height:16,fill:'#624329'}));
  gate.push(part(`${id}-brace`,'line',{parent:id,x:left?0:-204,y:330,x2:204,y2:-300,stroke:'#624329',strokeWidth:8}));
  for(const y of [65,270])gate.push(part(`${id}-hinge-${y}`,'rect',{x:left?146:553,y:554+y,width:21,height:14,fill:'#292b2d'}));
  ev.tracks.push(track(id,[{t:0,scaleX:1},{t:.24,scaleX:.46,easing:'ease-in-out'},{t:1,scaleX:.46}]));
}
ev.nodes.splice(ev.nodes.findIndex(n=>n.id==='paw-1'),0,...gate);

// Matching eyelid tracks for both eyes, including gaze changes already authored.
for(const s of p.scenes)for(const actor of s.vectorScene!.nodes.filter(n=>n.type==='instance'&&n.asset?.startsWith('peasant'))){
  const tracks=s.vectorScene!.tracks,left=tracks.find(t=>t.target===`${actor.id}/eye-l`);
  const frames=left?.frames||[{t:0,scaleY:1},{t:.23,scaleY:1},{t:.25,scaleY:.08},{t:.28,scaleY:1},{t:.73,scaleY:1},{t:.75,scaleY:.08},{t:.78,scaleY:1},{t:1,scaleY:1}];
  s.vectorScene!.tracks=tracks.filter(t=>t.target!==`${actor.id}/eye-l`&&t.target!==`${actor.id}/eye-r`);
  s.vectorScene!.tracks.push(track(`${actor.id}/eye-l`,structuredClone(frames)),track(`${actor.id}/eye-r`,structuredClone(frames)));
}

// Secondary motion belongs to loose material; rigid feet/architecture stay fixed.
const sway=(target:string,channel:'rotation'|'dy',durationMs:number,periodMs:number,amplitude:number,phase=0)=>{
  const segments=Math.min(31,Math.ceil(durationMs/periodMs*8));
  return track(target,Array.from({length:segments+1},(_,i)=>({t:i/segments,[channel]:amplitude*Math.sin(2*Math.PI*(i/segments*durationMs/periodMs)+phase)})));
};
for(const key of ['peasant-brown','peasant-blue','peasant-walking']){
  const a=p.vectorAssets![key]!;
  for(const n of a.nodes)if(!n.parent&&n.id!=='shadow'&&!n.id.startsWith('leg-'))n.parent='upper-body';
  a.nodes.push(part('upper-body','group',{pivotX:120,pivotY:340}));
  let hem=a.nodes.find(n=>n.id==='tunic-hem');
  if(!hem){hem=part('tunic-hem','path',{parent:'upper-body',fill:'#233544',d:'M 62 345 Q 120 358 178 345 L 175 365 Q 120 378 65 365 Z'});a.nodes.push(hem);}
  hem.pivotX=120;hem.pivotY=345;
}
for(const s of p.scenes)for(const actor of s.vectorScene!.nodes.filter(n=>n.type==='instance'&&n.asset?.startsWith('peasant'))){
  const phase=actor.id.includes('blue')?.9:.2;
  s.vectorScene!.tracks.push(sway(`${actor.id}/upper-body`,'dy',s.durationMs,3400,.65,phase),sway(`${actor.id}/tunic-hem`,'rotation',s.durationMs,2800,1.4,phase+.6));
}
wv.tracks.push(track('walker/lantern',Array.from({length:32},(_,i)=>{
  const t=i/31,seconds=t*walk.durationMs/1000;
  const amplitude=seconds<4.2?5:5*Math.exp(-(seconds-4.2)*2.4);
  return {t,rotation:amplitude*Math.sin(seconds*2*Math.PI/1.05-.7)+.65*Math.sin(seconds*2*Math.PI/2.8)};
})));
hv.tracks=hv.tracks.filter(t=>t.target!=='howling-dog/tail');
hv.tracks.push(sway('howling-dog/tail','rotation',howl.durationMs,2900,2.8,.6),sway('howling-dog/ear-back','rotation',howl.durationMs,3100,2.2,1.1));

walk.soundEffects=Array.from({length:8},(_,i)=>({id:`step-${i}`,preset:'footstep' as const,atMs:260+i*525,durationMs:160,volume:.65,pan:-.15+i*.04}));
walk.soundEffects.push({id:'night-wind',preset:'wind',atMs:0,durationMs:7500,volume:.55,pan:0});
howl.soundEffects=[{id:'hill-wind',preset:'wind',atMs:0,durationMs:8000,volume:.45},...[.33,.51,.68].map((t,i)=>({id:`howl-${i}`,preset:'dog-howl' as const,atMs:Math.round(t*8000),durationMs:960,volume:.82,pan:.1}))];
react.soundEffects=[{id:'startle-cloth',preset:'cloth',atMs:100,durationMs:650,volume:.6},{id:'turn-cloth',preset:'cloth',atMs:1700,durationMs:600,volume:.4},{id:'back-step',preset:'footstep',atMs:6500,durationMs:170,volume:.55}];
end.soundEffects=[{id:'gate-creak',preset:'door-creak',atMs:0,durationMs:1680,volume:.45},{id:'warning-cloth',preset:'cloth',atMs:2500,durationMs:1000,volume:.3}];

const project=compileVectorProject(p);
if(project.scenes.reduce((sum,s)=>sum+s.durationMs,0)!==30000)throw new Error('Expected exactly 30 seconds');
for(const s of project.scenes)for(const actor of s.vectorScene!.nodes.filter(n=>n.type==='instance'&&n.asset?.startsWith('peasant'))){
  const asset=project.vectorAssets![actor.asset!]!;
  assert.ok(!asset.nodes.some(n=>n.id==='topknot'));
  for(const [side,x] of [['l',80],['r',160]] as const){const arm=asset.nodes.find(n=>n.id===`arm-${side}`)!;assert.equal(arm.x,x);assert.equal(arm.y,190);assert.equal(arm.pivotX,0);assert.equal(arm.pivotY,0);}
  for(let t=0;t<s.durationMs;t+=1000/project.fps)assert.equal(evaluateVectorPart(`${actor.id}/eye-l`,s,t).scaleY,evaluateVectorPart(`${actor.id}/eye-r`,s,t).scaleY);
}
await writeFile(path.join(out,'project.json'),JSON.stringify(project,null,2));
await writeFile(path.join(out,'motion.json'),JSON.stringify(project.scenes.map(s=>({name:s.name,...vectorMotionEvidence(s)})),null,2));
console.log('New authored actions, retained local voice; bundle native Remotion SVG');
const visual={...project,scenes:project.scenes.map(s=>({...s,audioUrl:undefined}))};
const serveUrl=await bundle({entryPoint:path.resolve('src/remotion/index.tsx'),rootDir:path.resolve('.'),publicDir:null});
const inputProps={project:visual,assetOrigin:'http://127.0.0.1:8787'},browserExecutable=resolveBrowserExecutable();
if(!browserExecutable)throw new Error('Production renderer unavailable');
const composition=await selectComposition({serveUrl,id:'AutoSubCanvasAnimation',inputProps,browserExecutable,logLevel:'warn'});
if(composition.durationInFrames!==900)throw new Error('Expected 900 frames');
// Three stills let us catch disconnected joints before spending time on the full export.
for(const [name,frame] of [['walk',90],['howl',330],['reaction',530],['gate',750],['blink',155]] as const){
  await renderStill({serveUrl,composition,inputProps,browserExecutable,frame,imageFormat:'png',output:path.join(out,`${name}.png`),logLevel:'warn'});
}
console.log('Preflight stills ready');
if(process.argv.includes('--stills-only'))process.exit(0);
let last=-1;const silent=path.join(out,'silent.mp4');
await renderMedia({serveUrl,composition,inputProps,browserExecutable,codec:'h264',pixelFormat:'yuv420p',crf:21,x264Preset:'ultrafast',concurrency:1,logLevel:'warn',muted:true,timeoutInMilliseconds:120000,overwrite:true,outputLocation:silent,onProgress:({progress})=>{const step=Math.floor(progress*10);if(step!==last){last=step;console.log(`Render ${Math.round(progress*100)}%`);}}});
const inputs:string[]=[],filters:string[]=[];
for(const [i,s] of project.scenes.entries()){
  const id=s.audioUrl?.match(/^\/api\/animation-studio\/assets\/([a-f0-9-]{36})\/file$/i)?.[1];if(!id)throw new Error('Missing retained audio');
  const source=(await getAnimationAssetFile(id)).path,files=[source];
  const tracks:Array<{file:string;atMs:number;durationMs:number;volume:number;pan?:number;duck?:boolean}>=[{file:source,atMs:0,durationMs:s.durationMs,volume:1}];
  for(const [j,cue] of (s.soundEffects||[]).entries()){
    const file=path.join(out,`fx-${i}-${j}.wav`);await writeFile(file,synthesizeCanvasFoley(cue.preset,cue.durationMs,i*100+j+1));files.push(file);
    tracks.push({file,atMs:cue.atMs,durationMs:cue.durationMs,volume:cue.volume,pan:cue.pan,duck:cue.preset!=='dog-howl'});
  }
  const audioId=randomUUID(),mixed=path.resolve('workdir/animation-assets/files',`${audioId}.wav`);await mkdir(path.dirname(mixed),{recursive:true});
  await run('ffmpeg',['-v','error','-y',...files.flatMap(f=>['-i',f]),'-filter_complex',canvasAudioFilter(tracks,[{startMs:0,endMs:s.dialogue?.[0]?.durationMs||s.durationMs}],s.durationMs),'-map','[mix]','-ar','48000','-c:a','pcm_s16le',mixed]);
  const asset=await registerAnimationAsset({id:audioId,type:'audio',name:`Sound design · ${s.name}`,uri:`/api/animation-studio/assets/${audioId}/file`,tags:['canvas','sound-design','test-v3'],createdAt:new Date().toISOString(),source:'generated'});
  s.audioUrl=asset.uri;
  inputs.push('-i',mixed);
  filters.push(`[${i+1}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${s.durationMs/1000},asetpts=PTS-STARTPTS[a${i}]`);
}
filters.push('[a0][a1][a2][a3]concat=n=4:v=0:a=1[audio]');
await writeFile(path.join(out,'project.json'),JSON.stringify(project,null,2));
const video=path.join(out,'AutoSub_QuyCau_Action_30s_v4.mp4');
await run('ffmpeg',['-v','error','-y','-i',silent,...inputs,'-filter_complex',filters.join(';'),'-map','0:v','-map','[audio]','-c:v','copy','-c:a','aac','-b:a','192k','-t','30','-movflags','+faststart',video]);
await run('ffmpeg',['-v','error','-i',video,'-f','null','-']);
await writeFile(path.join(out,'probe.json'),(await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',video])).stdout);
await run('ffmpeg',['-v','error','-y','-i',video,'-vf','fps=1,scale=180:320,tile=10x3:padding=4:margin=4','-frames:v','1',path.join(out,'overview.jpg')]);
const destination=path.join(process.env.USERPROFILE!,'Downloads','AutoSub_QuyCau_Action_30s_v4.mp4');await copyFile(video,destination);
await writeFile(path.join(out,'result.json'),JSON.stringify({video:destination,duration:30,frames:900,renderer:'native Remotion SVG',actions:'smooth monotone cubic motion, fewer gestures, cloth sway, hanging lantern follow-through, subtle breathing, canine ear/tail sway',audio:'retained narration + synchronized synthesized footsteps/howls/cloth/wind/gate creak',decode:'passed',elapsedSeconds:Math.round((Date.now()-started)/1000)},null,2));
console.log(await readFile(path.join(out,'result.json'),'utf8'));
