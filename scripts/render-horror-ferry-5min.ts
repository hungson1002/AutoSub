import {readFile,writeFile,mkdir,copyFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {bundle} from '@remotion/bundler';
import {renderMedia,selectComposition,renderStill} from '@remotion/renderer';
import {compileVectorProject,type VectorNode,type VectorFrame,type VectorTrack,type VectorDrawing} from '../shared/canvasVectorScene';
import type {CanvasStudioProject,CanvasStudioScene,CanvasSoundPreset} from '../shared/canvasAnimationStudio';
import {resolveBrowserExecutable} from '../server/services/animationBrowser';
import {synthesize} from '../server/adapters/edgeTts';
import {normalizeNarrationAudio,registerAnimationAsset} from '../server/services/animationAssets';
import {synthesizeCanvasFoley} from '../server/services/canvasFoley';
import {canvasAudioFilter} from '../server/services/canvasAudioProduction';
import {canvasSpeechActivity} from '../server/services/canvasSpeechActivity';
import {run} from '../server/services/ffmpeg';
import {ferryStory} from './horror-ferry-story';
import {repairFerryContinuity} from './horror-ferry-continuity';

const out=path.resolve('tmp/horror-ferry-5min-v2'),voiceCache=path.resolve('tmp/horror-ferry-5min'),started=Date.now();
await mkdir(out,{recursive:true});
const exists=async(file:string)=>!!await stat(file).catch(()=>null);
const hash=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,16);
const provider={id:'edge-tts-local',name:'Edge TTS',baseUrl:'local://edge-tts',enabled:true,models:[],providerType:'edge-tts',authType:'none'} as const;
const voices:Array<{file:string;durationMs:number}>=[];
for(const [i,beat] of ferryStory.entries()){
  const voiceName=`voice-${i}-${hash(beat[2]+'NamMinh-1.0')}.wav`;
  const file=await exists(path.join(voiceCache,voiceName))?path.join(voiceCache,voiceName):path.join(out,voiceName);
  if(process.argv.includes('--draft-stills')){voices.push({file,durationMs:beat[2].split(/\s+/).length/3.3*1000});continue;}
  if(!await exists(file)){
    console.log(`Voice ${i+1}/${ferryStory.length}: ${beat[0]}`);
    let audio:Buffer|undefined;
    for(let attempt=0;attempt<3;attempt++){
      try{audio=await synthesize(provider as never,'edge-tts','vi-VN-NamMinhNeural',beat[2],{speed:1,signal:AbortSignal.timeout(90000)});break;}
      catch(error){if(attempt===2)throw error;console.log(`Voice ${i+1}: retry ${attempt+1}, no audio saved`);await new Promise(resolve=>setTimeout(resolve,2200));}
    }
    assert.ok(audio);
    await writeFile(file,await normalizeNarrationAudio(audio,true));
  }
  const probe=JSON.parse((await run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',file])).stdout);
  const activity=canvasSpeechActivity(await readFile(file));
  const durationMs=Math.min(Math.round(Number(probe.format.duration)*1000),(activity?.at(-1)?.endMs??Infinity)+180);
  voices.push({file,durationMs});
}
await writeFile(path.join(out,'voices.json'),JSON.stringify(voices,null,2));
const totalVoice=voices.reduce((s,v)=>s+v.durationMs,0);
console.log(`Narration ${(totalVoice/1000).toFixed(1)}s; ${ferryStory.map(b=>b[2]).join(' ').split(/\s+/).length} words`);
if(process.argv.includes('--audio-only'))process.exit(0);

// Preserve all speech, with a modest pitch-preserving fit and a quiet breath between beats.
const speechBudget=282000,tempo=Math.max(.85,totalVoice/speechBudget);
assert.ok(tempo<=1.3,`Script too long: tempo ${tempo}`);
const spoken=voices.map(v=>v.durationMs/tempo);
const speechWindows=await Promise.all(voices.map(async v=>process.argv.includes('--draft-stills')?[]:(canvasSpeechActivity(await readFile(v.file))||[]).map(w=>({startMs:w.startMs/tempo,endMs:w.endMs/tempo}))));
const pause=(300000-spoken.reduce((a,b)=>a+b,0))/ferryStory.length;
let usedFrames=0;
const lengths=spoken.map((ms,i)=>{
  const frames=i===spoken.length-1?9000-usedFrames:Math.round((ms+pause)/1000*30);
  usedFrames+=frames;return frames/30*1000;
});

const n=(id:string,type:VectorNode['type'],p:Partial<VectorNode>={}):VectorNode=>({id,type,...p});
const tr=(target:string,frames:VectorFrame[]):VectorTrack=>({target,start:0,end:1,frames:frames.map(f=>({...f,easing:f.easing||'smooth'}))});
const pose=(target:string,values:Array<[number,number]>)=>tr(target,values.map(([t,rotation])=>({t,rotation})));
const oscillate=(target:string,key:'dx'|'dy'|'rotation'|'opacity'|'scaleX'|'scaleY',ms:number,period:number,amplitude:number,phase=0,base=0)=>{
  const segments=Math.min(31,Math.ceil(ms/period*8));
  return tr(target,Array.from({length:segments+1},(_,i)=>({t:i/segments,[key]:base+amplitude*Math.sin(i/segments*ms/period*Math.PI*2+phase)})));
};
const retained:CanvasStudioProject=JSON.parse(await readFile('tmp/vector-action-30s-v4/project.json','utf8'));
const assets:Record<string,VectorDrawing>={};
for(const [key,coat] of [['traveler','#554a3b'],['ferryman','#566367']] as const){
  const a=structuredClone(retained.vectorAssets!['peasant-brown']!);
  for(const node of a.nodes){
    if(['torso','sleeve-l','sleeve-r'].includes(node.id)){node.fill=coat;node.stroke='#252d2c';}
    if(node.id==='tunic-hem')node.fill=key==='ferryman'?'#3c4b4e':'#40382d';
    if(['head-base','neck','hand-l','hand-r'].includes(node.id))node.fill=key==='ferryman'?'#bbc6bb':'#cfc8ac';
  }
  if(key==='ferryman'){
    a.nodes.push(n('oar','group',{parent:'arm-r',x:0,y:110,pivotX:0,pivotY:0}),
      n('oar-shaft','line',{parent:'oar',x:0,y:-55,x2:100,y2:245,stroke:'#9b8460',strokeWidth:7}),
      n('oar-blade','path',{parent:'oar',fill:'#726044',stroke:'#b19a6c',strokeWidth:2,d:'M 82 145 L 104 137 L 128 200 Q 122 219 109 211 Z'}),
      n('brow-wrinkle','path',{parent:'head-group',d:'M -24 -30 Q 0 -36 24 -30 M -27 14 L -14 18 M 14 18 L 27 14',stroke:'#727d72',strokeWidth:2}));
  }else{
    a.nodes.push(n('unlit-lantern','group',{parent:'arm-l',x:-10,y:130,pivotX:10,pivotY:-20}),
      n('unlit-cord','line',{parent:'unlit-lantern',x:10,y:-20,x2:0,y2:20,stroke:'#817953',strokeWidth:2}),
      n('unlit-case','rect',{parent:'unlit-lantern',width:20,height:30,fill:'#202923',stroke:'#817953',strokeWidth:3}));
  }
  assets[key]=a;
}
assets.ghost={width:220,height:480,nodes:[
  n('robe','path',{fill:'#abbdb1',stroke:'#667b73',strokeWidth:3,d:'M 73 166 Q 110 151 147 166 C 165 240 161 326 183 434 Q 140 463 104 441 Q 61 463 39 439 C 61 345 55 246 73 166 Z'}),
  n('hem','path',{pivotX:110,pivotY:360,fill:'#8caaa0',d:'M 49 357 Q 111 380 169 357 L 183 434 Q 140 463 104 441 Q 61 463 39 439 Z'}),
  n('arm-l','group',{x:73,y:180}),n('sleeve-l','path',{parent:'arm-l',fill:'#9aafa5',d:'M -11 0 L 12 0 L 9 100 Q 0 110 -9 100 Z'}),
  n('hand-l','ellipse',{parent:'arm-l',x:0,y:113,rx:8,ry:15,fill:'#b4cbc0'}),
  n('arm-r','group',{x:147,y:180}),n('sleeve-r','path',{parent:'arm-r',fill:'#9aafa5',d:'M -11 0 L 12 0 L 9 100 Q 0 110 -9 100 Z'}),
  n('hand-r','ellipse',{parent:'arm-r',x:0,y:113,rx:8,ry:15,fill:'#b4cbc0'}),
  n('bracelet','ellipse',{parent:'arm-r',x:0,y:102,rx:11,ry:4,fill:'none',stroke:'#bc9752',strokeWidth:4}),
  n('head','group',{x:110,y:112,pivotX:0,pivotY:45}),
  n('void','ellipse',{parent:'head',x:0,y:10,rx:40,ry:55,fill:'#03080a',stroke:'#687b73',strokeWidth:2}),
  n('hair-l','path',{parent:'head',pivotX:-26,pivotY:-35,fill:'#0a1419',stroke:'#263b3b',strokeWidth:2,d:'M -2 -45 C -57 -48 -57 9 -52 71 Q -46 122 -67 174 C -22 158 -24 69 -12 10 Z'}),
  n('hair-r','path',{parent:'head',pivotX:26,pivotY:-35,fill:'#0a1419',stroke:'#263b3b',strokeWidth:2,d:'M -2 -45 C 54 -48 62 9 53 78 Q 47 130 68 181 C 20 167 23 69 10 10 Z'}),
  n('veil','path',{parent:'head',fill:'#0a1419',d:'M -26 -40 Q 0 -53 26 -40 L 22 71 Q 0 98 -22 71 Z'}),
]};
assets.lantern={width:100,height:180,nodes:[
  n('aura','ellipse',{x:50,y:104,rx:90,ry:110,fill:'#be873b',opacity:.09}),
  n('halo','ellipse',{x:50,y:104,rx:57,ry:69,fill:'#d5a04a',opacity:.13}),
  n('ring','path',{d:'M 34 37 L 34 20 Q 50 -2 66 20 L 66 37',stroke:'#96815c',strokeWidth:5}),
  n('frame','rect',{x:20,y:42,width:60,height:100,fill:'#3d3a24',stroke:'#a08c5c',strokeWidth:5}),
  n('glass','rect',{x:27,y:49,width:46,height:84,fill:'#b97727'}),
  n('flame','path',{fill:'#f2cf73',pivotX:50,pivotY:121,d:'M 50 68 Q 66 89 57 107 Q 70 117 52 124 Q 30 118 41 100 Q 47 89 50 68 Z'}),
  n('bar','line',{x:50,y:44,x2:0,y2:95,stroke:'#4c442a',strokeWidth:4}),
  n('cap','path',{fill:'#5f5538',stroke:'#a08c5c',strokeWidth:3,d:'M 12 42 L 26 29 L 74 29 L 88 42 Z M 15 142 L 85 142 L 79 153 L 21 153 Z'}),
]};
assets.bell={width:140,height:180,nodes:[
  n('hook','line',{x:70,y:0,x2:0,y2:35,stroke:'#aa8f50',strokeWidth:5}),
  n('body','path',{fill:'#7e754c',stroke:'#b2a16a',strokeWidth:4,d:'M 28 116 Q 43 80 40 55 Q 70 22 100 55 Q 97 80 112 116 L 122 132 Q 70 154 18 132 Z'}),
  n('patina','path',{fill:'none',stroke:'#41695e',strokeWidth:8,d:'M 47 75 L 43 110 M 91 58 L 93 88 M 62 125 L 82 125'}),
  n('clapper','group',{x:70,y:95}),n('rod','line',{parent:'clapper',x2:0,y2:45,stroke:'#372f23',strokeWidth:5}),
  n('knob','ellipse',{parent:'clapper',y:49,rx:10,ry:8,fill:'#ad9658'}),
]};

function scenery(type:string,index:number,duration:number){
  const nodes:VectorNode[]=[n('sky','rect',{width:720,height:1280,fill:type==='memory'?'#151d20':'#080f16'}),
    n('haze','ellipse',{x:455,y:355,rx:460,ry:280,fill:'#203134',opacity:.1}),
    n('moon','ellipse',{x:562,y:255,rx:37,ry:37,fill:'#aeb6a0',opacity:.3}),
    n('moon-cloud','path',{d:'M 442 249 Q 520 219 638 252 T 780 245 L 780 278 Q 567 268 445 281 Z',fill:'#101d23',opacity:.85}),
    n('far-bank','path',{fill:'#0c1b20',d:'M 0 555 Q 122 500 236 539 Q 415 488 720 548 L 720 700 L 0 700 Z'}),
    n('river','path',{fill:'#14292e',d:'M 0 620 Q 340 599 720 626 L 720 1280 L 0 1280 Z'})];
  const tracks:VectorTrack[]=[oscillate('moon-cloud','dx',duration,14000,12,index*.5)];
  for(let i=0;i<12;i++){
    const y=678+i*45,x=(i*137+index*23)%640;
    nodes.push(n(`ripple-${i}`,'path',{d:`M ${x-45} ${y} Q ${x+20} ${y-9} ${x+94} ${y}`,stroke:i%3===0?'#345257':'#233f44',strokeWidth:i>7?3:2,opacity:.65}));
    tracks.push(oscillate(`ripple-${i}`,'dx',duration,5200+i*270,9,i*.72));
  }
  for(let i=0;i<7;i++){
    const x=i*122-10;
    nodes.push(n(`tree-${i}`,'path',{fill:'#071014',d:`M ${x} 551 L ${x+8} 399 L ${x-14} 365 L ${x+13} 387 L ${x+31} 321 L ${x+24} 416 L ${x+50} 390 L ${x+31} 437 L ${x+26} 551 Z`}));
  }
  return {nodes,tracks};
}
function filmScene(index:number):CanvasStudioScene{
  const [name,type,text]=ferryStory[index]!,durationMs=lengths[index]!;
  const {nodes,tracks}=scenery(type,index,durationMs);
  const add=(...parts:VectorNode[])=>nodes.push(...parts);
  const animate=(...authored:VectorTrack[])=>{
    for(const next of authored){
      const channels=new Set(next.frames.flatMap(f=>Object.keys(f).filter(k=>!['t','easing'].includes(k))));
      for(let i=tracks.length-1;i>=0;i--){
        const old=tracks[i]!;if(old.target!==next.target)continue;
        old.frames=old.frames.map(f=>Object.fromEntries(Object.entries(f).filter(([k])=>!channels.has(k))) as VectorFrame);
        if(!old.frames.some(f=>Object.keys(f).some(k=>!['t','easing'].includes(k))))tracks.splice(i,1);
      }
      tracks.push(next);
    }
  };
  const actor=(id:string,asset:string,x:number,y:number,width:number,height=width*2,parent?:string)=>{
    add(n(id,'instance',{asset,x,y,width,height,parent}));
    if(asset!=='ghost'){
      animate(oscillate(`${id}/upper-body`,'dy',durationMs,3600,.65,index*.4),oscillate(`${id}/tunic-hem`,'rotation',durationMs,3200,1.3,index*.4+.8));
      if(asset==='traveler')animate(oscillate(`${id}/unlit-lantern`,'rotation',durationMs,3700,2,index*.4+.7));
      const frames:VectorFrame[]=[{t:0,scaleY:1},{t:.24,scaleY:1},{t:.255,scaleY:.08},{t:.27,scaleY:1},{t:.72,scaleY:1},{t:.735,scaleY:.08},{t:.75,scaleY:1},{t:1,scaleY:1}];
      animate(tr(`${id}/eye-l`,frames),tr(`${id}/eye-r`,frames));
    }else{
      animate(oscillate(`${id}/hair-l`,'rotation',durationMs,3300,3.4,index*.4),oscillate(`${id}/hair-r`,'rotation',durationMs,3900,2.8,index*.4+.8),oscillate(`${id}/hem`,'rotation',durationMs,4100,2,index*.4+1.4));
    }
  };
  const light=(id:string,x:number,y:number,size:number,parent?:string)=>{
    add(n(id,'instance',{asset:'lantern',x,y,width:size,height:size*1.8,parent,pivotX:size/2,pivotY:0}));
    animate(oscillate(id,'rotation',durationMs,3200,2.5,index*.4),oscillate(`${id}/flame`,'scaleY',durationMs,1800,.08,0,1));
  };
  const quay=()=>{
    add(n('bank','path',{fill:'#1e2927',d:'M 0 845 Q 202 810 340 905 L 270 1280 L 0 1280 Z'}),
      n('dock','path',{fill:'#4b4938',stroke:'#7c7760',strokeWidth:3,d:'M 0 889 L 395 865 L 455 925 L 0 985 Z'}),
      n('post-1','rect',{x:45,y:915,width:24,height:179,fill:'#323d36',stroke:'#5e6c59',strokeWidth:3}),
      n('post-2','rect',{x:351,y:885,width:22,height:161,fill:'#323d36',stroke:'#5e6c59',strokeWidth:3}));
    for(let i=0;i<7;i++)add(n(`plank-${i}`,'line',{x:i*61,y:889-i*3,x2:46,y2:66,stroke:'#222e29',strokeWidth:4}));
  };
  const vessel=(passenger=false,x=45,y=830,scale=1,travel=false)=>{
    add(n('boat-world','group',{x:x-310*(1-scale),y:y-80*(1-scale),scaleX:scale,scaleY:scale,pivotX:310,pivotY:80}));
    animate(oscillate('boat-world','dy',durationMs,4300,3,index*.6),oscillate('boat-world','rotation',durationMs,5100,.65,index*.6+.5));
    if(!['jetty','two-jetty','shore','last-boat','final'].includes(type))actor('lam','traveler',110,-265,180,360,'boat-world');
    if(passenger)actor('visitor','ghost',295,-255,155,340,'boat-world');
    actor('old','ferryman',435,-240,160,320,'boat-world');
    add(n('lamp-post','path',{parent:'boat-world',d:'M 8 65 L 8 -211 L 46 -211 M 8 -126 L 93 -126',stroke:'#817953',strokeWidth:6}),
      n('lamp-hook','line',{parent:'boat-world',x:46,y:-211,x2:0,y2:31,stroke:'#a08c5c',strokeWidth:3}),
      n('bell-hook','line',{parent:'boat-world',x:93,y:-126,x2:0,y2:16,stroke:'#a08c5c',strokeWidth:2}));
    light('lamp',20,-180,51,'boat-world');
    add(n('bell','instance',{parent:'boat-world',asset:'bell',x:72,y:-110,width:42,height:54}));
    add(n('hull','path',{parent:'boat-world',fill:'#3e3b2c',stroke:'#837c57',strokeWidth:4,d:'M 0 50 Q 100 92 320 74 Q 507 61 630 26 L 574 154 Q 362 216 75 159 Z'}),
      n('gunwale','path',{parent:'boat-world',d:'M 0 50 Q 100 92 320 74 Q 507 61 630 26',stroke:'#afa17a',strokeWidth:7}),
      n('hull-line','path',{parent:'boat-world',d:'M 55 105 Q 313 164 594 86 M 86 137 Q 330 185 579 122',stroke:'#635e43',strokeWidth:3}));
    if(travel)animate(tr('boat-world',[{t:0,dx:-35},{t:1,dx:25}]));
    if(['boat','ghost-boat','last-boat','two-boat'].includes(type)){
      animate(oscillate('old/arm-r','rotation',durationMs,3000,9,index*.5,-16),oscillate('old/oar','rotation',durationMs,3000,6,index*.5+.35));
    }
  };
  const shrine=()=>{
    add(n('temple-island','path',{fill:'#202f2a',stroke:'#415448',strokeWidth:3,d:'M 0 1082 Q 50 951 162 946 Q 356 888 571 956 Q 681 984 720 1111 L 720 1280 L 0 1280 Z'}),
      n('temple-shadow','ellipse',{x:360,y:997,rx:290,ry:70,fill:'#061014'}),
      n('steps','path',{fill:'#3c4943',stroke:'#677165',strokeWidth:3,d:'M 135 935 L 585 935 L 620 999 L 100 999 Z M 100 999 L 620 999 L 650 1050 L 70 1050 Z'}),
      n('shrine-wall','rect',{x:170,y:570,width:380,height:365,fill:'#444b3d',stroke:'#6a7059',strokeWidth:4}),
      n('door','rect',{x:230,y:620,width:260,height:315,fill:'#101a19'}),
      n('roof','path',{fill:'#35433d',stroke:'#7a7960',strokeWidth:5,d:'M 105 586 Q 220 562 250 485 L 470 485 Q 500 562 615 586 Q 360 632 105 586 Z'}),
      n('altar','rect',{x:245,y:853,width:230,height:40,fill:'#5c4f38'}),
      n('portrait-frame','rect',{x:298,y:660,width:125,height:167,fill:'#a3946c',stroke:'#3b3c2c',strokeWidth:8}),
      n('portrait-bg','rect',{x:308,y:670,width:105,height:147,fill:'#303c36'}));
    actor('portrait','ferryman',305,653,110,220);
    Object.assign(nodes.find(n=>n.id==='portrait')!,{clip:{x:0,y:8,width:110,height:156}});
    // Portrait is a still photograph, not a living actor.
    for(let i=tracks.length-1;i>=0;i--)if(tracks[i]!.target.startsWith('portrait/'))tracks.splice(i,1);
    add(n('picture-cover','rect',{x:298,y:817,width:125,height:36,fill:'#444b3d'}),
      n('altar-bell','instance',{asset:'bell',x:427,y:787,width:50,height:64}));
    light('candle',250,790,28);
  };
  if(type==='jetty'){
    quay();vessel(false,300,750,.58);
    actor('lam','traveler',48,475,225);
    animate(tr('lam',[{t:0,dx:-30},{t:.5,dx:15},{t:1,dx:15}]));
    for(const side of ['l','r'])animate(tr(`lam/leg-${side}`,Array.from({length:9},(_,i)=>({t:i/8*.5,rotation:Math.sin(i/8*4*Math.PI)*(side==='l'?9:-9)})).concat([{t:1,rotation:0}])));
  }else if(type==='two-jetty'){
    quay();vessel(false,280,770,.61);actor('shore-lam','traveler',42,485,225);
    animate(pose('old/head-group',[[0,0],[.3,-6],[1,-6]]),pose('shore-lam/head-group',[[0,0],[.35,-8],[1,-8]]));
    if(index===23)animate(tr('boat-world',[{t:0,dx:0,opacity:1},{t:.25,dx:0,opacity:1},{t:1,dx:240,opacity:.12}]));
  }else if(type==='ferryman'){
    actor('old','ferryman',130,310,420);light('lamp',30,650,90);
    animate(pose('old/head-group',[[0,0],[.25,-7],[.6,-7],[.85,0],[1,0]]),pose('old/arm-l',[[0,0],[.25,30],[.75,30],[1,20]]));
  }else if(type==='traveler'||type==='traveler-shore'){
    if(type==='traveler-shore')quay();
    actor('lam','traveler',110,305,450);light('lamp',560,715,60);
    animate(pose('lam/head-group',[[0,0],[.3,index===11?-11:8],[.75,index===11?-11:8],[1,2]]));
    if(index===11){
      animate(tr('lam/mouth',[{t:0,scaleY:.6},{t:.45,scaleY:.6},{t:.62,scaleY:2.1},{t:.75,scaleY:.8},{t:1,scaleY:.8}]));
      add(n('grip','group',{x:600,y:661}),
        n('grip-sleeve','path',{parent:'grip',fill:'#566367',stroke:'#252d2c',strokeWidth:3,d:'M 130 -16 L -161 -16 Q -177 0 -161 16 L 130 16 Z'}),
        n('grip-hand','ellipse',{parent:'grip',x:-185,y:0,rx:27,ry:17,fill:'#bbc6bb'}));
      animate(tr('grip',[{t:0,dx:380},{t:.64,dx:380},{t:.76,dx:0},{t:1,dx:0}]));
    }
  }else if(type==='ghost-close'){
    actor('visitor','ghost',130,300,420,900);
    if(index===16)animate(tr('visitor/veil',[{t:0,opacity:1},{t:.3,opacity:1},{t:.65,opacity:0},{t:1,opacity:0}]),pose('visitor/hair-l',[[0,0],[.4,0],[.8,13],[1,13]]),pose('visitor/hair-r',[[0,0],[.4,0],[.8,-13],[1,-13]]));
    light('lamp',20,800,60);
  }else if(['boat','ghost-boat','wet-boat','two-boat'].includes(type)){
    vessel(type==='ghost-boat'||type==='two-boat',35,850,1,true);
    if(index===6){tracks.splice(tracks.findIndex(t=>t.target==='old/arm-r'),1);animate(pose('old/arm-r',[[0,-22],[.3,0],[1,0]]));}
    if(type==='wet-boat'){
      add(n('wet','path',{parent:'boat-world',d:'M 375 77 Q 343 53 308 67 T 228 76',stroke:'#73958a',strokeWidth:7,opacity:0}));
      animate(tr('wet',[{t:0,opacity:0},{t:.35,opacity:.4},{t:1,opacity:.8,dx:-25}]));
    }
    if(index===7)animate(tr('visitor',[{t:0,opacity:0,dx:75,dy:-70},{t:.45,opacity:.8,dx:50,dy:-50},{t:1,opacity:1,dx:0,dy:0}]));
    if(index===9)animate(tr('boat-world',[{t:0,rotation:0},{t:.15,rotation:2},{t:.32,rotation:-.4},{t:.5,rotation:.2},{t:1,rotation:0}]));
    if(index===17)animate(pose('old/arm-l',[[0,0],[.35,55],[.8,55],[1,55]]),pose('lam/arm-r',[[0,0],[.5,-35],[1,-35]]));
  }else if(type==='reflection'){
    // Reflections are below the surface, distorted by a moving ripple mask.
    actor('reflection','traveler',62,1100,190,380);Object.assign(nodes.find(n=>n.id==='reflection')!,{scaleY:-1});light('reflected-lamp',358,875,46);
    Object.assign(nodes.find(n=>n.id==='reflected-lamp')!,{scaleY:-1});
    add(n('surface','rect',{x:0,y:700,width:720,height:580,fill:'#17363a',opacity:.65}),
      n('empty-reflection','ellipse',{x:540,y:846,rx:110,ry:22,fill:'none',stroke:'#658a80',strokeWidth:3}));
    animate(oscillate('empty-reflection','scaleX',durationMs,4000,.12,.3,1));
  }else if(type==='hands'){
    add(n('close-hull','path',{fill:'#514a33',stroke:'#9a8b61',strokeWidth:6,d:'M 20 450 Q 350 520 740 443 L 740 790 Q 350 900 20 766 Z'}));
    for(let i=0;i<6;i++){
      const id=`hand-${i}`,x=80+i*112;
      add(n(id,'group',{x,y:780,pivotX:0,pivotY:130}),n(`${id}-skin`,'path',{parent:id,fill:'#a0b9a9',stroke:'#536e65',strokeWidth:3,d:'M -17 140 L -17 39 L -31 20 Q -37 7 -29 1 L -14 14 L -15 -30 Q -10 -43 -4 -30 L 0 7 L 2 -40 Q 10 -52 15 -38 L 15 8 L 19 -24 Q 27 -34 31 -22 L 28 20 Q 42 5 45 16 L 30 48 L 21 140 Z'}));
      animate(tr(id,[{t:0,dy:140,opacity:0},{t:.18+i*.045,dy:140,opacity:0},{t:.42+i*.045,dy:-45,opacity:1},{t:1,dy:-55,opacity:1}]));
    }
    add(n('front-water','path',{fill:'#14292e',d:'M 0 864 Q 200 845 370 865 T 720 860 L 720 1280 L 0 1280 Z'}),
      n('hand-waterline','path',{d:'M 33 866 Q 120 850 188 868 M 236 863 Q 354 847 425 864 M 486 866 Q 600 849 703 866',stroke:'#476e68',strokeWidth:3}));
  }else if(type==='lantern'){
    add(n('bow','path',{fill:'#3c3b2c',stroke:'#7b7754',strokeWidth:4,d:'M 0 950 L 360 715 L 720 950 L 720 1280 L 0 1280 Z'}));
    light('lamp',220,370,280);
    if(index===15)animate(tr('lamp/glass',[{t:0,opacity:1},{t:.3,opacity:.7},{t:.6,opacity:.22},{t:1,opacity:.18}]),tr('lamp/flame',[{t:0,scaleY:1},{t:.4,scaleY:.65},{t:.7,scaleY:.2},{t:1,scaleY:.15}]));
    else animate(tr('lamp/flame',[{t:0,scaleY:.25},{t:.3,scaleY:1},{t:1,scaleY:1}]),tr('lamp/halo',[{t:0,opacity:.05},{t:.4,opacity:.25},{t:1,opacity:.25}]));
  }else if(type==='coin'){
    add(n('coin','group',{x:360,y:650,pivotX:0,pivotY:0}),
      n('coin-edge','ellipse',{parent:'coin',rx:127,ry:127,fill:'#83764b',stroke:'#c2ae67',strokeWidth:7}),
      n('coin-inner','ellipse',{parent:'coin',rx:103,ry:103,fill:'none',stroke:'#b29a54',strokeWidth:4}),
      n('hole','rect',{parent:'coin',x:-27,y:-27,width:54,height:54,fill:'#10202a'}),
      n('cracks','path',{parent:'coin',d:'M -82 -76 L -48 -34 L -56 -9 M 70 89 L 47 42 L 58 20',stroke:'#d39145',strokeWidth:4}),
      n('thread','path',{parent:'coin',d:'M 0 10 C -55 35 -11 131 28 168 Q 50 210 15 254 M 10 12 Q 46 70 21 131',stroke:'#a84935',strokeWidth:8}));
    animate(oscillate('coin','rotation',durationMs,6000,3),oscillate('cracks','opacity',durationMs,4000,.3,0,.65));
  }else if(type==='bell'){
    light('lamp',30,480,110);add(n('bell','instance',{asset:'bell',x:245,y:400,width:270,height:347,pivotX:135,pivotY:0}));
    animate(tr('bell',[{t:0,rotation:0},{t:.25,rotation:0},{t:.32,rotation:12},{t:.4,rotation:-9},{t:.5,rotation:5},{t:.65,rotation:-2},{t:1,rotation:0}]),oscillate('bell/clapper','rotation',durationMs,1100,10));
    for(let i=0;i<3;i++){
      add(n(`bell-wave-${i}`,'ellipse',{x:380,y:960,rx:90+i*45,ry:18+i*10,stroke:'#8f9b78',strokeWidth:3,opacity:0}));
      animate(tr(`bell-wave-${i}`,[{t:0,opacity:0,scaleX:.5},{t:.3+i*.08,opacity:0,scaleX:.5},{t:.48+i*.08,opacity:.6,scaleX:1},{t:.75+i*.06,opacity:0,scaleX:2},{t:1,opacity:0}]));
    }
  }else if(type==='ghost-away'){
    actor('visitor','ghost',260,465,200,440);vessel(false,-100,940,.65,true);
    animate(tr('visitor',[{t:0,opacity:1},{t:.45,dy:15,opacity:.9},{t:1,dy:150,opacity:0}]),tr('boat-world',[{t:0,dx:0},{t:1,dx:340}]));
  }else if(type==='shore'){
    quay();vessel(false,280,790,.65);actor('shore-lam','traveler',140,532,190);
    animate(tr('shore-lam',[{t:0,dx:90,dy:30},{t:.65,dx:-5,dy:0},{t:1,dx:-5,dy:0}]));
  }else if(type==='shrine'||type==='memory'){
    shrine();
    if(index===24)actor('lam','traveler',0,720,160);
    if(index===25){vessel(false,58,1050,.9);animate(tr('boat-world',[{t:0,rotation:-3,dy:0},{t:.55,rotation:12,dy:80},{t:1,rotation:22,dy:190,opacity:0}]));}
    if(index===27){add(n('red-thread','path',{d:'M 310 1007 Q 285 1025 320 1033 Q 352 1051 373 1020 Q 399 1013 410 1045',stroke:'#a84935',strokeWidth:6}));}
  }else if(type==='last-boat'||type==='final'){
    if(type==='final')quay();vessel(false,280,680,.4,true);
    animate(tr('boat-world',[{t:0,opacity:.85},{t:1,opacity:.45,dx:45}]));
  }
  // Foreground mist travels across the river; feet and architectural anchors remain fixed.
  add(n('mist','path',{d:'M -100 1040 Q 40 1009 212 1039 T 480 1034 T 820 1024 L 820 1097 Q 529 1063 278 1090 T -100 1090 Z',fill:'#607b74',opacity:.12}));
  animate(oscillate('mist','dx',durationMs,14000,25,index*.4));
  if(index===0||index===29){
    add(n('fade','rect',{width:720,height:1280,fill:'#03080c'}));
    animate(tr('fade',index===0?[{t:0,opacity:1},{t:.13,opacity:0},{t:1,opacity:0}]:[{t:0,opacity:0},{t:.8,opacity:0},{t:1,opacity:1}]));
  }
  const fx:CanvasStudioScene['soundEffects']=[{id:'river',preset:'water',atMs:0,durationMs,volume:.6,pan:0},{id:'wind',preset:'wind',atMs:0,durationMs,volume:.5,pan:-.2}];
  const cue=(preset:CanvasSoundPreset,at:number,len:number,volume:number)=>fx.push({id:`${preset}-${fx.length}`,preset,atMs:Math.round(at*durationMs),durationMs:len,volume,pan:.12});
  if(['boat','ghost-boat','two-boat'].includes(type))for(const t of [.12,.42,.72])cue('splash',t,650,.18);
  if(['wet-boat','hands','ghost-away'].includes(type))cue('scratch',.42,2400,.26);
  if(['two-jetty','shore','jetty'].includes(type)){cue('door-creak',.2,1100,.18);cue('footstep',.35,180,.45);cue('footstep',.5,180,.45);}
  if(type==='traveler')cue('cloth',.25,650,.28);
  return {id:`ferry-${index}`,name,durationMs,narration:text,dialogue:[{id:`line-${index}`,speaker:'Người kể',text,delivery:'natural',emotion:'storytelling',voice:'vi-VN-NamMinhNeural',atMs:220,durationMs:spoken[index],speechWindows:speechWindows[index]}],background:'night',template:'wide-establishing',objects:[],animationBeats:[],visualBeats:[],soundEffects:fx,vectorScene:{width:720,height:1280,nodes,tracks}} as CanvasStudioScene;
}

const raw:CanvasStudioProject={version:1,id:'ferry-horror-five-minutes',name:'Chuyến đò cuối qua bến vắng',width:720,height:1280,fps:30,createdAt:'2026-10-08T00:00:00.000Z',updatedAt:'2026-10-08T00:00:00.000Z',sourcePrompt:'Phim kinh dị dân gian 5 phút; xanh đen âm u; hành động có mục đích, tóc/vạt áo/đèn chuyển động phụ mượt; giọng kể, nhạc nền và tiếng nước/chèo/chuông.',vectorAssets:assets,scenes:ferryStory.map((_,i)=>filmScene(i))};
for(const s of raw.scenes)assert.equal(new Set(s.vectorScene!.nodes.map(n=>n.id)).size,s.vectorScene!.nodes.length,`Duplicate nodes in ${s.name}`);
const project=compileVectorProject(repairFerryContinuity(raw));
assert.equal(project.scenes.reduce((s,b)=>s+Math.round(b.durationMs/1000*30),0),9000);
await writeFile(path.join(out,'project.json'),JSON.stringify(project,null,2));
await writeFile(path.join(out,'story.txt'),ferryStory.map((s,i)=>`${i+1}. ${s[0]}\n${s[2]}`).join('\n\n'));
if(process.argv.includes('--project-only'))process.exit(0);
const browserExecutable=resolveBrowserExecutable();if(!browserExecutable)throw new Error('Missing renderer browser');
console.log('Bundle native SVG composition');
const serveUrl=await bundle({entryPoint:path.resolve('src/remotion/index.tsx'),rootDir:path.resolve('.'),publicDir:null});
const inputProps={project,assetOrigin:'http://127.0.0.1:8787'};
const composition=await selectComposition({serveUrl,id:'AutoSubCanvasAnimation',inputProps,browserExecutable,logLevel:'warn'});
assert.equal(composition.durationInFrames,9000);
let cursor=0;
for(const [i,s] of project.scenes.entries()){
  if(!process.argv.includes('--resume')&&[0,3,7,10,14,16,18,19,24,29].includes(i))await renderStill({serveUrl,composition,inputProps,browserExecutable,frame:cursor+Math.round(s.durationMs/1000*30*.57),imageFormat:'png',output:path.join(out,`shot-${i}.png`),logLevel:'warn'});
  cursor+=Math.round(s.durationMs/1000*30);
}
console.log('Preflight stills ready');
if(process.argv.includes('--stills-only')||process.argv.includes('--draft-stills'))process.exit(0);

// Serial chapters are resume checkpoints; never render more than one at once.
const fingerprint=hash(JSON.stringify(project));
const chunks:string[]=[];
const renderThreads=Math.max(1,Math.min(2,Number(process.env.AUTOSUB_TEST_RENDER_THREADS)||1));
for(let chapter=0;chapter<5;chapter++){
  const file=path.join(out,`chapter-${chapter}-${fingerprint}.mp4`);chunks.push(file);
  if(await exists(file)){
    const check=JSON.parse((await run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',file])).stdout);
    if(Math.abs(Number(check.format.duration)-60)<.1){console.log(`Reuse chapter ${chapter+1}/5`);continue;}
  }
  let last=-1;console.log(`Render chapter ${chapter+1}/5`);
  await renderMedia({serveUrl,composition,inputProps,browserExecutable,codec:'h264',pixelFormat:'yuv420p',crf:21,x264Preset:'ultrafast',concurrency:renderThreads,logLevel:'warn',muted:true,timeoutInMilliseconds:120000,overwrite:true,frameRange:[chapter*1800,(chapter+1)*1800-1],outputLocation:file,onProgress:({progress})=>{const step=Math.floor(progress*10);if(step!==last){last=step;console.log(`Chapter ${chapter+1}/5 ${Math.round(progress*100)}%`);}}});
}
await writeFile(path.join(out,'chapters.txt'),chunks.map(f=>`file '${f.replace(/\\/g,'/')}'`).join('\n'));
await run('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i',path.join(out,'chapters.txt'),'-c','copy',path.join(out,'silent.mp4')]);

console.log('Mix narration, original horror score and synchronized foley');
const mixedScenes:string[]=[];
for(const [i,s] of project.scenes.entries()){
  const voice=path.join(out,`fitted-${i}.wav`);
  await run('ffmpeg',['-v','error','-y','-i',voices[i]!.file,'-af',`atrim=duration=${voices[i]!.durationMs/1000},asetpts=PTS-STARTPTS,atempo=${tempo.toFixed(7)}`,'-ar','48000','-c:a','pcm_s16le',voice]);
  const files=[voice],tracks:Array<{file:string;atMs:number;durationMs:number;volume:number;pan?:number;duck?:boolean}>=[{file:voice,atMs:220,durationMs:spoken[i]!,volume:1.15}];
  for(const [j,c] of (s.soundEffects||[]).entries()){
    const file=path.join(out,`fx-${i}-${j}.wav`);await writeFile(file,synthesizeCanvasFoley(c.preset,c.durationMs,i*41+j));files.push(file);
    tracks.push({file,atMs:c.atMs,durationMs:c.durationMs,volume:c.volume,pan:c.pan,duck:true});
  }
  const mixed=path.join(out,`scene-${i}.wav`);
  await run('ffmpeg',['-v','error','-y',...files.flatMap(file=>['-i',file]),'-filter_complex',canvasAudioFilter(tracks,[{startMs:220,endMs:220+spoken[i]!}],s.durationMs),'-map','[mix]','-ar','48000','-c:a','pcm_s16le',mixed]);
  mixedScenes.push(mixed);
}
await writeFile(path.join(out,'audio-scenes.txt'),mixedScenes.map(f=>`file '${f.replace(/\\/g,'/')}'`).join('\n'));
await run('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i',path.join(out,'audio-scenes.txt'),'-c','copy',path.join(out,'narration-foley.wav')]);

// Original ambient score: low fifths, detuned dissonant strings and sparse metallic bells.
const sampleRate=24000,samples=300*sampleRate,pcm=Buffer.alloc(samples*2+44);
pcm.write('RIFF',0);pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(sampleRate,24);pcm.writeUInt32LE(sampleRate*2,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(samples*2,40);
const sceneStarts:number[]=[];let ms=0;for(const s of project.scenes){sceneStarts.push(ms/1000);ms+=s.durationMs;}
const bellTime=sceneStarts[19]!+project.scenes[19]!.durationMs/1000*.31;
let random=19351,noise=0;
for(let i=0;i<samples;i++){
  const t=i/sampleRate,fade=Math.min(1,t/4,(300-t)/5),tension=t>sceneStarts[7]!&&t<sceneStarts[22]!?1.15:.7;
  random=(Math.imul(random,1664525)+1013904223)>>>0;noise=noise*.975+((random/4294967296)*2-1)*.025;
  const pulse=.58+.42*Math.sin(t*Math.PI*2/17)**2;
  let value=(Math.sin(t*2*Math.PI*55)*.027+Math.sin(t*2*Math.PI*82.41)*.014+Math.sin(t*2*Math.PI*110.3)*.01)*pulse*tension;
  value+=Math.sin(t*2*Math.PI*164.81+.4*Math.sin(t*.16))*.008*(.5+.5*Math.sin(t*.19));
  value+=Math.sin(t*2*Math.PI*155.56)*.005*tension+noise*.035;
  const chime=t%23;if(chime<6)value+=(Math.sin(chime*2*Math.PI*523.25)+.4*Math.sin(chime*2*Math.PI*733.1))*.012*Math.exp(-chime*.8)*Math.min(1,chime*35);
  const dt=t-bellTime;if(dt>0&&dt<11)value+=(Math.sin(dt*2*Math.PI*220)+.6*Math.sin(dt*2*Math.PI*523)+.3*Math.sin(dt*2*Math.PI*811))*.17*Math.exp(-dt*.58)*Math.min(1,dt*100);
  pcm.writeInt16LE(Math.round(Math.max(-1,Math.min(1,value*fade))*32767),44+i*2);
}
await writeFile(path.join(out,'original-horror-score.wav'),pcm);
const video=path.join(out,'AutoSub_ChuyenDoCuoi_5phut_v2.mp4');
await run('ffmpeg',['-v','error','-y','-i',path.join(out,'silent.mp4'),'-i',path.join(out,'narration-foley.wav'),'-i',path.join(out,'original-horror-score.wav'),'-filter_complex','[1:a]asplit=2[voice][key];[2:a]aformat=channel_layouts=stereo,volume=1.4,asplit=2[score][reverb];[reverb]aecho=0.6:0.4:220|433:0.22|0.13[tail];[score][tail]amix=inputs=2:normalize=0[music];[music][key]sidechaincompress=threshold=0.035:ratio=3:attack=80:release=650[ducked];[voice][ducked]amix=inputs=2:normalize=0,alimiter=limit=0.94:level=0:latency=1,apad,atrim=duration=300[audio]','-map','0:v','-map','[audio]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t','300','-movflags','+faststart',video]);
await run('ffmpeg',['-v','error','-i',video,'-f','null','-']);
const probe=JSON.parse((await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',video])).stdout);
assert.ok(Math.abs(Number(probe.format.duration)-300)<.05);assert.equal(probe.streams.find((s:any)=>s.codec_type==='video')?.nb_frames,'9000');
await writeFile(path.join(out,'probe.json'),JSON.stringify(probe,null,2));
// Keep the editable project playable with exactly the same finished soundtrack.
const audioManifest=path.join(out,`registered-audio-${fingerprint}.json`);
const registered:Array<{id:string;uri:string}>=await exists(audioManifest)?JSON.parse(await readFile(audioManifest,'utf8')):[];
let audioOffset=0;
for(const [i,s] of project.scenes.entries()){
  if(!registered[i]){
    const id=randomUUID(),file=path.resolve('workdir/animation-assets/files',`${id}.wav`);await mkdir(path.dirname(file),{recursive:true});
    await run('ffmpeg',['-v','error','-y','-ss',String(audioOffset/1000),'-i',video,'-t',String(s.durationMs/1000),'-vn','-ar','48000','-c:a','pcm_s16le',file]);
    const asset=await registerAnimationAsset({id,type:'audio',name:`Chuyến đò cuối · ${s.name}`,uri:`/api/animation-studio/assets/${id}/file`,tags:['canvas','horror-ferry-5min','mastered'],createdAt:new Date().toISOString(),source:'generated'});
    registered[i]={id,uri:asset.uri};await writeFile(audioManifest,JSON.stringify(registered,null,2));
  }
  s.audioUrl=registered[i]!.uri;audioOffset+=s.durationMs;
}
await writeFile(path.join(out,'project.json'),JSON.stringify(project,null,2));
await run('ffmpeg',['-v','error','-y','-i',video,'-vf','fps=1/10,scale=144:256,tile=10x3:padding=3:margin=3','-frames:v','1',path.join(out,'overview.jpg')]);
const destination=path.join(process.env.USERPROFILE!,'Downloads','AutoSub_ChuyenDoCuoi_5phut_v2.mp4');await copyFile(video,destination);
const result={video:destination,duration:300,frames:9000,shots:30,resolution:'720x1280',renderer:'AutoSub native Remotion SVG',narration:'Nam Minh, new original Vietnamese story',audio:'original ambient horror score + ducked narration + water/wind/oar/wood/bell foley',tempo,decode:'passed',elapsedSeconds:Math.round((Date.now()-started)/1000)};
await writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
