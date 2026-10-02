import {readFile,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';
import {createCanvasObject} from '../shared/canvasAnimationStudio';

process.env.AUTOSUB_ANIMATION_RENDER_CONCURRENCY='1';
const {renderCanvasAnimationProject}=await import('../server/services/animationRender');
const directory=path.resolve('tmp/chiec-den-cuoi-ban-5p');
const source=path.join(directory,'project.json');
const project=JSON.parse(await readFile(source,'utf8')) as CanvasStudioProject;
// The nighttime rescue takes place on solid shore, not the water layer.
for(const index of [15,16,17,18,20]) {
  const scene=project.scenes[index]!;
  scene.background='night';scene.backgroundRef='bg:night-river-shoreline';
  for(const object of scene.objects) {
    if(object.kind==='character') {object.x=150;object.y=410;object.width=220;object.height=340;object.facing='right';
      if(object.characterKey==='duy')object.expression='sad';}
    if(object.id==='signal') {object.x=220;object.y=565;object.width=40;object.height=50;object.keyframes=undefined;}
  }
}
// Signal closeups retain the physical lamp; don't make the fixture vanish.
const signalScene=project.scenes[14]!;
const signalLamp=signalScene.objects.find(object=>object.id==='lamp');
if(signalLamp)signalLamp.keyframes=undefined;
for(const scene of project.scenes) {
  if(scene.camera&&scene.objects.every(object=>object.kind!=='character'))scene.camera.motion='push-in';
}
// Keep all spoken endings, trade a few silent frames for a proper ending hold.
if(!project.scenes.at(-1)!.objects.some(object=>object.id==='end-title')) {
  for(const [index,scene] of project.scenes.slice(0,-1).entries())scene.durationMs-=(index<16?2:1)/30*1000;
  const last=project.scenes.at(-1)!;last.durationMs+=1500;
  const end=(last.dialogue![0]!.atMs||0)+(last.dialogue![0]!.durationMs||0);
  last.objects.push(createCanvasObject('text',{id:'end-title',label:'Chiếc đèn cuối bản',text:'Chiếc đèn cuối bản',
    x:570,y:115,width:740,height:65,color:'#e6cfad',motion:'none',zIndex:80,
    keyframes:[{atMs:0,opacity:0},{atMs:end+200,opacity:0},{atMs:end+650,opacity:1}]}));
}
const first=project.scenes[0]!;
if(!first.objects.some(object=>object.id==='opening-title'))first.objects.push(createCanvasObject('text',{
  id:'opening-title',label:'Chiếc đèn cuối bản',text:'Chiếc đèn cuối bản',x:570,y:100,width:750,height:70,
  color:'#e6cfad',motion:'none',zIndex:80,keyframes:[{atMs:0,opacity:0},{atMs:400,opacity:1},{atMs:3000,opacity:1},{atMs:4000,opacity:0}],
}));
const frames=project.scenes.reduce((sum,scene)=>sum+Math.round(scene.durationMs/1000*30),0);
if(frames!==9000)throw new Error(`Unexpected duration: ${frames} frames`);
for(const scene of project.scenes)for(const line of scene.dialogue||[]) {
  if((line.atMs||0)+(line.durationMs||0)>scene.durationMs)throw new Error(`Speech ending cut: ${scene.name}`);
}
await writeFile(path.join(directory,'project-final.json'),JSON.stringify(project,null,2),'utf8');
let previous=-1;
const result=await renderCanvasAnimationProject(project,undefined,progress=>{const percent=Math.floor(progress*100);if(percent!==previous){previous=percent;console.log(`FINAL_RENDER ${percent}%`);}});
await copyFile(result.path,path.join(directory,'chiec-den-cuoi-ban-5-phut.mp4'));
console.log(`FINAL_VIDEO=${path.join(directory,'chiec-den-cuoi-ban-5-phut.mp4')}`);
process.exit(0);
