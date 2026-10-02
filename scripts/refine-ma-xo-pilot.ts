import { readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderStill } from '@remotion/renderer';
import { renderCanvasAnimationProject } from '../server/services/animationRender';
import type { CanvasStudioProject, CanvasStudioObject } from '../shared/canvasAnimationStudio';

// Re-stage the existing pilot without regenerating or changing its voiceover.
const directory = path.resolve('tmp/ma-xo-pilot');
const project: CanvasStudioProject = JSON.parse(await readFile(path.join(directory, 'project.json'), 'utf8'));
project.name = 'Ma Xó — bản dựng chỉnh cảnh';
const sourceBoy = project.scenes.flatMap(s => s.objects).find(o => o.label === 'Minh')!;
const sourceHost = project.scenes.flatMap(s => s.objects).find(o => o.label === 'Bà chủ')!;
const sourceProp = (variant: string) => project.scenes.flatMap(s => s.objects).find(o => o.variant === variant)!;
function manual(object: CanvasStudioObject, overrides: Partial<CanvasStudioObject>): CanvasStudioObject {
  const result = { ...structuredClone(object), keyframes: [], ...overrides };
  delete result.slot; delete result.depth; delete result.sizeClass;
  return result;
}
const boy = (overrides: Partial<CanvasStudioObject> = {}) => manual(sourceBoy, { x:740,y:410,width:230,height:360,zIndex:35,pose:'idle',expression:'neutral',...overrides });
const host = (overrides: Partial<CanvasStudioObject> = {}) => manual(sourceHost, { x:410,y:410,width:230,height:360,zIndex:35,pose:'idle',expression:'neutral',...overrides });
const prop = (variant: string, overrides: Partial<CanvasStudioObject> = {}) => manual(sourceProp(variant), { ...overrides });
const bed = () => prop('bed', { x:465,y:510,width:620,height:220,zIndex:30 });
const resting = (overrides: Partial<CanvasStudioObject> = {}) => boy({ x:465,y:452,width:430,height:292.4,pose:'lie-down',zIndex:31,...overrides });
const fire = () => prop('fire', { x:870,y:555,width:130,height:90,zIndex:25 });

project.scenes.forEach(scene => {
  delete scene.template;
  scene.objects = scene.objects.map(o => manual(o, {}));
  scene.camera = { shot:'medium',motion:'none',focusX:640,focusY:360,zoom:1,
    keyframes:[{atMs:0,zoom:1},{atMs:scene.durationMs,zoom:1.035,easing:'ease-in-out'}] };
  // Breathing and restraint come from the actor, without whole-person rocking.
  scene.animationBeats = [];
  scene.effects = scene.effects.filter(e => e.type === 'vignette' || e.type === 'smoke');
  scene.effects.forEach(e => { e.startMs=0; e.durationMs=scene.durationMs; if(e.type==='vignette')e.intensity=Math.min(.85,e.intensity); });
});
project.scenes[0].camera!.shot='wide';
project.scenes[0].objects = [prop('bamboo',{x:130,y:540,width:190,height:260,zIndex:50}),boy({x:1030,y:510,width:130,height:190,zIndex:30})];
project.scenes[1].objects=[host({pose:'talk',facing:'right'}),boy({x:650,facing:'left'}),fire()];
project.scenes[2].objects=[bed(),resting(),fire()];
project.scenes[3].objects=[bed(),resting({expression:'afraid'})];
project.scenes[3].camera={shot:'medium',motion:'none',focusX:330,focusY:405,zoom:1.35};
project.scenes[4].backgroundRef='bg:room-underfloor'; project.scenes[4].objects=[];
project.scenes[5].objects=[fire()];
project.scenes[5].objects[0].keyframes=[{atMs:0,opacity:1},{atMs:project.scenes[5].durationMs,opacity:.25}];
project.scenes[5].camera={shot:'medium',motion:'none',focusX:870,focusY:505,zoom:1.35};
project.scenes[6].backgroundRef='bg:room-floor-detail'; project.scenes[6].objects=[];
project.scenes[7].objects=[bed(),resting({expression:'afraid'})];
project.scenes[7].camera={shot:'medium',motion:'none',focusX:330,focusY:405,zoom:1.4};
project.scenes[8].objects=[bed(),resting({expression:'afraid',keyframes:[{atMs:0,pose:'lie-down'},{atMs:450,pose:'cover-face'}]})];
project.scenes[9].backgroundRef='bg:room-stilt-day';
project.scenes[9].objects=[host({facing:'right',expression:'sad'}),boy({facing:'left',expression:'sad'})];
project.scenes[9].effects=[];
project.scenes[10].backgroundRef='bg:room-underfloor'; project.scenes[10].objects=[];
await writeFile(path.join(directory,'project-directed.json'),JSON.stringify(project,null,2));

if (process.argv.includes('--stills')) {
  const serveUrl=await bundle({entryPoint:path.resolve('src/remotion/index.tsx'),rootDir:process.cwd(),publicDir:null});
  const browserExecutable='C:/Program Files/Google/Chrome/Application/chrome.exe';
  const inputProps={project,assetOrigin:'http://127.0.0.1:8787'};
  const composition=await selectComposition({serveUrl,id:'AutoSubCanvasAnimation',inputProps,browserExecutable});
  let frame=0;
  for(let i=0;i<project.scenes.length;i++) {
    const length=Math.round(project.scenes[i].durationMs*project.fps/1000);
    if([1,2,3,5,6,8,9].includes(i)) {
      await renderStill({serveUrl,composition,inputProps,browserExecutable,frame:frame+Math.floor(length*.65),output:path.join(directory,`directed-qa-${i}.png`)});
      console.log(`STILL ${i}`);
    }
    frame+=length;
  }
} else {
  let previous=-1;
  const result=await renderCanvasAnimationProject(project,undefined,p=>{
    const percent=Math.floor(p*10)*10;
    if(percent!==previous){previous=percent; console.log(`RENDER ${percent}%`);}
  });
  const target=path.join(directory,'ma-xo-directed.mp4');
  await copyFile(result.path,target);
  console.log(`VIDEO=${target}`);
}
