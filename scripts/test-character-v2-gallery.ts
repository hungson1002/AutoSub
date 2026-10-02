import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCanvasObject, type CanvasStudioProject, type CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

const now=new Date().toISOString();
const id=randomUUID();

function char(label:string,key:string,x:number,y:number,width:number,height:number,overrides:any={}) {
  return createCanvasObject('character',{
    label,characterKey:key,archetype:overrides.archetype||'worker',hair:overrides.hair||'short',
    x,y,width,height,scale:1,rotation:0,opacity:1,zIndex:20,motion:'none',
    role:'focal',expression:overrides.expression||'neutral',pose:overrides.pose||'idle',
    facing:overrides.facing||'right',color:overrides.color||'#6d6760',secondaryColor:overrides.secondaryColor||'#505e64',
    skinTone:overrides.skinTone||'#d1a17d',designNotes:overrides.designNotes||'',assetRef:'character:'+(overrides.archetype||'worker'),
  });
}

function text(label:string,value:string,x:number,y:number) {
  return createCanvasObject('text',{label,text:value,x,y,width:220,height:40,scale:1,rotation:0,opacity:1,color:'#f5efe6',accent:'#171614',zIndex:80,motion:'none',role:'support'});
}

const mediumObjects=[
  char('Minh','minh',150,410,155,255,{archetype:'worker',hair:'short',designNotes:'young narrow face work shirt'}),
  char('Bà chủ','ba-chu',350,410,155,255,{archetype:'villager',hair:'bun',designNotes:'older woman khắc khổ angular face'}),
  char('Người bản','villager-a',550,410,155,255,{archetype:'villager',hair:'messy',designNotes:'round face'}),
  char('Thợ phụ','worker-b',750,410,155,255,{archetype:'worker',hair:'crop',designNotes:'angular face jacket'}),
  char('Ông già','elder',950,410,155,255,{archetype:'scholar',hair:'bald',designNotes:'elder long face robe'}),
  char('Người lạ','stranger',1150,410,155,255,{archetype:'merchant',hair:'hat',designNotes:'narrow face jacket'}),
];

const closeObjects=[
  char('Minh','minh',170,390,230,370,{archetype:'worker',hair:'short',expression:'neutral',designNotes:'young narrow face work shirt'}),
  char('Minh sợ','minh',475,390,230,370,{archetype:'worker',hair:'short',expression:'surprised',designNotes:'young narrow face work shirt'}),
  char('Bà chủ','ba-chu',780,390,230,370,{archetype:'villager',hair:'bun',expression:'sad',designNotes:'older woman khắc khổ angular face'}),
  char('Người lạ','stranger',1085,390,230,370,{archetype:'merchant',hair:'hat',expression:'neutral',designNotes:'narrow face jacket'}),
];

const scenes:CanvasStudioScene[]=[
  {
    id:randomUUID(),name:'Character V2 Medium Gallery',durationMs:1800,background:'room',backgroundRef:'bg:room-stilt-house',
    visualBrief:'horror character gallery',narration:'',
    camera:{shot:'medium',motion:'none',focusX:640,focusY:360,zoom:1},effects:[],animationBeats:[],
    objects:[...mediumObjects,text('title','CHARACTER V2 · MEDIUM',640,70)],
  },
  {
    id:randomUUID(),name:'Character V2 Close Gallery',durationMs:1800,background:'room',backgroundRef:'bg:room-stilt-house',
    visualBrief:'horror character close-up gallery',narration:'',
    camera:{shot:'close-up',motion:'none',focusX:640,focusY:360,zoom:1},effects:[],animationBeats:[],
    objects:[...closeObjects,text('title','CHARACTER V2 · CLOSE',640,70)],
  }
];

const project:CanvasStudioProject={version:1,id,name:'Character V2 Gallery',width:1280,height:720,fps:30,createdAt:now,updatedAt:now,sourcePrompt:'horror character gallery',scenes};
const outDir=path.resolve('tmp/character-v2-gallery');
await mkdir(outDir,{recursive:true});
await writeFile(path.join(outDir,'project.json'),JSON.stringify(project,null,2),'utf8');
const result=await renderCanvasAnimationProject(project,undefined,()=>{});
const target=path.join(outDir,'character-v2-gallery.mp4');
await copyFile(result.path,target);
console.log('GALLERY_VIDEO='+target);
console.log('SOURCE_VIDEO='+result.path);
