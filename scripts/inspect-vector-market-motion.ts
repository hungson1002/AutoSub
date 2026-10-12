// Inspect actual Studio output; never author or replace its film content.
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {evaluateVectorPart,vectorTrackTiming} from '../shared/canvasVectorScene';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';
import {VectorSceneFrame} from '../src/remotion/VectorSceneFrame';
Object.assign(globalThis,{React});
const file=path.resolve(process.argv[2]!);
const data=JSON.parse(await readFile(file,'utf8'));
const p=(data.project||data) as CanvasStudioProject;
const out=process.argv[3]?path.resolve(process.argv[3]):path.dirname(file),turns=[],crowd=[];
const tiles:Buffer[]=[];
for(const scene of p.scenes){
  for(const beat of scene.vectorDirection?.beats||[]){
    if(!beat.turn)continue;
    const target=beat.turn.actor+'/upper-body';
    const track=scene.vectorScene!.tracks.find(t=>t.target===target&&t.cue===beat.cue);
    if(!track)throw new Error('Missing turn '+beat.cue);
    const {start,end}=vectorTrackTiming(track,scene);
    const before=evaluateVectorPart(target,scene,start).scaleX,after=evaluateVectorPart(target,scene,end).scaleX;
    turns.push({scene:scene.name,actor:beat.turn.actor,cue:beat.cue,start,end,before,after});
    if(beat.turn.from!=='back'&&beat.turn.to!=='back'&&Math.sign(before)===Math.sign(after))throw new Error('Invisible facing reversal '+beat.cue);
    if(beat.turn.actor==='person')for(const at of [Math.max(0,start-30),Math.min(scene.durationMs,end+30)]){
      const html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:at,width:p.width,height:p.height}));
      tiles.push(await sharp(Buffer.from(html.match(/<svg[\s\S]*?<\/svg>/)![0])).resize(640,360).png().toBuffer());
    }
  }
  const actors=scene.vectorScene!.nodes.filter(n=>n.type==='instance'&&n.id!=='person'&&p.vectorAssets?.[n.asset!]?.nodes.some(part=>part.id==='puppet-root'));
  const active=actors.map(actor=>{
    const values=Array.from({length:31},(_,i)=>evaluateVectorPart(actor.id,scene,i*scene.durationMs/30).dx);
    return {actor:actor.id,range:Math.max(...values)-Math.min(...values)};
  }).filter(a=>a.range>10);
  crowd.push({scene:scene.name,visibleCast:scene.vectorDirection?.visibleCast,passing:active});
}
await writeFile(path.join(out,'motion-evidence.json'),JSON.stringify({turns,crowd},null,2));
if(tiles.length)await sharp({create:{width:640*tiles.length,height:360,channels:3,background:'#111'}}).composite(tiles.map((input,i)=>({input,left:i*640,top:0}))).png().toFile(path.join(out,'turn-before-after.png'));
console.log(JSON.stringify({turns,crowd}));
