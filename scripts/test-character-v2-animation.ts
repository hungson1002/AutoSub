import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCanvasObject, type CanvasStudioProject, type CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

const now=new Date().toISOString();
const id=randomUUID();

const actor=createCanvasObject('character',{
  label:'Minh',characterKey:'minh-main',archetype:'worker',hair:'short',
  role:'focal',slot:'hero',depth:'midground',sizeClass:'hero',
  x:640,y:430,width:280,height:520,scale:1,rotation:0,opacity:1,zIndex:30,motion:'none',
  expression:'neutral',pose:'idle',facing:'right',
  color:'#687074',secondaryColor:'#46535a',skinTone:'#d0a17e',
  designNotes:'young narrow face work shirt restrained horror actor',
  assetRef:'character:worker',
  keyframes:[
    {atMs:0,pose:'idle',expression:'neutral',dx:0,dy:0,rotation:0},
    {atMs:2300,pose:'talk',expression:'neutral',dx:0,dy:-2,rotation:-.4,easing:'ease-in-out'},
    {atMs:5000,pose:'point',expression:'neutral',dx:4,dy:0,rotation:.6,easing:'ease-in-out'},
    {atMs:7400,pose:'brace',expression:'surprised',dx:-3,dy:-3,rotation:-1.1,easing:'snappy'},
    {atMs:9700,pose:'idle',expression:'sad',dx:0,dy:2,rotation:-.7,easing:'ease-in-out'},
  ],
});

const fire=createCanvasObject('prop',{
  label:'Bếp lửa',variant:'fire',assetRef:'prop:fire',role:'support',
  slot:'foreground-left',depth:'foreground',sizeClass:'medium',
  x:350,y:550,width:150,height:150,scale:1,rotation:0,opacity:1,zIndex:50,motion:'none',
  color:'#ba7044',accent:'#2b2521',
});

const scene:CanvasStudioScene={
  id:randomUUID(),name:'Character V2 Rig Test',durationMs:12000,
  background:'room',backgroundRef:'bg:room-stilt-house',template:'close-reaction',
  visualBrief:'horror actor rig test with fire and local light',narration:'',
  camera:{
    shot:'close-up',motion:'none',focusX:640,focusY:360,zoom:1,
    keyframes:[
      {atMs:0,zoom:1},{atMs:6000,zoom:1.04,dx:-8,easing:'ease-in-out'},
      {atMs:9000,zoom:1.11,dx:5,dy:-4,easing:'ease-in-out'},
      {atMs:12000,zoom:1.08,dx:0,dy:0,easing:'ease-out'},
    ],
  },
  effects:[
    {id:randomUUID(),type:'vignette',x:640,y:360,scale:1,intensity:1.25,startMs:0,durationMs:12000,zIndex:90},
    {id:randomUUID(),type:'flashlight',x:430,y:390,scale:1.15,intensity:.48,startMs:0,durationMs:12000,zIndex:16},
  ],
  animationBeats:[
    {id:randomUUID(),atMs:2300,durationMs:2200,action:'talk',targetIds:[actor.id],intensity:.75},
    {id:randomUUID(),atMs:5000,durationMs:1500,action:'point',targetIds:[actor.id],intensity:.8},
    {id:randomUUID(),atMs:7400,durationMs:1600,action:'react',targetIds:[actor.id],intensity:.95},
  ],
  objects:[actor,fire],
};

const project:CanvasStudioProject={
  version:1,id,name:'Character V2 Animation Test',width:1280,height:720,fps:30,
  createdAt:now,updatedAt:now,sourcePrompt:'horror character animation rig test',scenes:[scene],
};

const outDir=path.resolve('tmp/character-v2-animation');
await mkdir(outDir,{recursive:true});
await writeFile(path.join(outDir,'project.json'),JSON.stringify(project,null,2),'utf8');
const result=await renderCanvasAnimationProject(project,undefined,()=>{});
const target=path.join(outDir,'character-v2-animation.mp4');
await copyFile(result.path,target);
console.log('ANIMATION_VIDEO='+target);
console.log('SOURCE_VIDEO='+result.path);
