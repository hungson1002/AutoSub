import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createCanvasObject,type CanvasStudioProject,type CanvasStudioScene,type CanvasSoundCue} from '../shared/canvasAnimationStudio';
import {resolveCanvasSpeech} from '../shared/canvasSpeech';
import {canvasEnvironmentDoorway} from '../shared/canvasEnvironment';
import {createVieneuLocalProvider} from '../src/lib/providers';

process.env.AUTOSUB_ANIMATION_RENDER_CONCURRENCY='1';
process.env.AUTOSUB_VIENEU_WORKERS='1';
const {prepareCanvasProjectAudio}=await import('../server/services/canvasAudioProduction');
const {renderCanvasAnimationProject}=await import('../server/services/animationRender');
const directory=path.resolve('tmp/new-acting-demo');
const original=JSON.parse(await readFile(path.join(directory,'project.json'),'utf8')) as CanvasStudioProject;
const dialogue=structuredClone(original.scenes.flatMap(scene=>scene.dialogue||[]));
let cursor=0;
for(const line of dialogue) {
  line.atMs=cursor;
  cursor+=(line.durationMs||0)+resolveCanvasSpeech(line,.94,true).pauseAfterMs;
}
const pointAt=dialogue[2]!.atMs!+120;
const reactAt=dialogue[3]!.atMs!+120;
const walkAt=dialogue[3]!.atMs!+1600;
const walkEnd=dialogue[3]!.atMs!+(dialogue[3]!.durationMs||3200)+300;
const closeAt=dialogue[4]!.atMs!;
const doorCloseAt=closeAt+(dialogue[4]!.durationMs||3400)*.52;
const objects=structuredClone(original.scenes[0]!.objects);
const minh=objects.find(object=>object.characterKey==='minh-main')!;
const host=objects.find(object=>object.characterKey==='ba-chu')!;
const lamp=objects.find(object=>object.variant==='lantern')!;
// The lamp hangs on the wall beside the jamb, outside the moving panel.
const opening=canvasEnvironmentDoorway(original.scenes[0]!.backgroundRef,original.width,original.height)!;
lamp.x=opening.x+opening.width+44;lamp.y=opening.y+50;
minh.keyframes=[{atMs:0,dx:0,facing:'left'},{atMs:pointAt,facing:'right'},
  {atMs:walkAt,dx:0},{atMs:walkEnd,dx:120,easing:'ease-in-out'},
  {atMs:cursor+500,dx:120}];
host.keyframes=[{atMs:0,facing:'right'}];
lamp.keyframes=[{atMs:0,rotation:0},{atMs:pointAt+1000,rotation:0},
  ...Array.from({length:8},(_,i)=>({atMs:pointAt+1300+i*300,rotation:i%2?-4:4,easing:'ease-in-out' as const})),
  {atMs:doorCloseAt-200,rotation:3},{atMs:doorCloseAt+350,rotation:0,easing:'ease-in-out'},{atMs:cursor+500,rotation:0}];
const door=createCanvasObject('prop',{label:'Cửa gỗ',variant:'door',assetRef:'prop:door',x:1060,y:395,width:150,height:300,zIndex:12,motion:'none',color:'#665244',
  doorOpen:.45,keyframes:[{atMs:0,doorOpen:.45},{atMs:reactAt,doorOpen:.45},{atMs:reactAt+100,doorOpen:.2},
    {atMs:reactAt+220,doorOpen:.5},{atMs:reactAt+450,doorOpen:.45},
    {atMs:doorCloseAt-100,doorOpen:.45},{atMs:doorCloseAt+650,doorOpen:0,easing:'ease-in-out'}]});
objects.push(door);
const soundEffects:CanvasSoundCue[]=[
  {id:'gust',preset:'wind',atMs:pointAt+1000,durationMs:doorCloseAt-pointAt-650,volume:.08,pan:.35},
  {id:'door',preset:'door-creak',atMs:reactAt,durationMs:650,volume:.18,pan:.45},
  ...[0,550,1100].map((offset,index)=>({id:`step-${index}`,preset:'footstep' as const,atMs:walkAt+offset,durationMs:160,volume:.14,pan:.25})),
  {id:'close-door',preset:'door-creak',atMs:doorCloseAt,durationMs:450,volume:.12,pan:.45},
];
const scene:CanvasStudioScene={...original.scenes[0]!,id:randomUUID(),name:'Chiếc đèn — hành động liên tục',
  durationMs:Math.ceil((dialogue.at(-1)!.atMs!+dialogue.at(-1)!.durationMs!+550)/1000*30)*1000/30,
  audioUrl:undefined,audioMixKey:undefined,sourceAudioUrl:undefined,lipSync:undefined,
  dialogue,objects,soundEffects,animationBeats:[
    {id:'point',action:'point',atMs:pointAt,durationMs:Math.max(900,(dialogue[2]!.durationMs||3200)-200),targetIds:[minh.id],intensity:.4,speechCue:'chiếc đèn',dialogueId:dialogue[2]!.id,focusTargetId:lamp.id},
    {id:'react',action:'react',atMs:reactAt,durationMs:700,targetIds:[minh.id],intensity:.18,speechCue:'giật mình',dialogueId:dialogue[3]!.id,focusTargetId:door.id},
    {id:'walk',action:'run',atMs:walkAt,durationMs:walkEnd-walkAt,targetIds:[minh.id],intensity:.3},
  ],camera:{shot:'medium',motion:'none',focusX:640,focusY:360,zoom:1,
    keyframes:[{atMs:0,zoom:1,dx:0,dy:0},{atMs:closeAt,zoom:1,dx:0,dy:0},
      {atMs:closeAt+1800,zoom:1.1,dx:-30,dy:-15,easing:'ease-in-out'}]},
};
let project:CanvasStudioProject={...original,id:randomUUID(),name:'Chiếc đèn — diễn xuất và nhịp dựng liên tục',
  sourcePrompt:'Illustrated horror-style mountain interior, continuous acting and synchronized dialogue.',scenes:[scene]};
project=await prepareCanvasProjectAudio({project,narration:{provider:createVieneuLocalProvider(),model:'vieneu-v3-turbo',voice:'preset:anh-khoi',speed:.94},autoSound:false});
await writeFile(path.join(directory,'project-door-fixed.json'),JSON.stringify(project,null,2));
let previous=-1;
const result=await renderCanvasAnimationProject(project,undefined,progress=>{const percent=Math.floor(progress*10)*10;if(percent!==previous){previous=percent;console.log(`RENDER ${percent}%`);}});
const video=path.join(directory,'chiec-den-cua-khop-khung.mp4');await copyFile(result.path,video);console.log(`VIDEO=${video}`);process.exit(0);
