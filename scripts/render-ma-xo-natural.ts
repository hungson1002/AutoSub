import {readFile,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';
import {prepareCanvasProjectAudio} from '../server/services/canvasAudioProduction';
import {renderCanvasAnimationProject} from '../server/services/animationRender';
import {createVieneuLocalProvider} from '../src/lib/providers';

const directory=path.resolve('tmp/ma-xo-pilot'),checkpoint=path.join(directory,'project-natural.partial.json');
let project=JSON.parse(await readFile(path.join(directory,'project-sound-design.json'),'utf8')) as CanvasStudioProject;
project.name='Ma Xó — diễn xuất tự nhiên & lời thoại có nhịp';
for(const [index,scene] of project.scenes.entries())for(const line of scene.dialogue||[]){
  line.emotion=line.speaker==='Người kể'?'storytelling':index===1?'tense':line.delivery==='distant'?'tense':'gentle';
  line.atMs=undefined;
}
try {const saved=JSON.parse(await readFile(checkpoint,'utf8')) as CanvasStudioProject;
  if(saved.id===project.id)project=saved;
} catch { /* first run */ }
const narration={provider:createVieneuLocalProvider(),model:'vieneu-v3-turbo',voice:'preset:anh-khoi',speed:.94};
for(const [index,scene] of project.scenes.entries()){
  console.log(`AUDIO ${index+1}/${project.scenes.length}: ${scene.name}`);
  const start=performance.now();
  const result=await prepareCanvasProjectAudio({project:{...project,scenes:[scene]},narration,autoSound:true});
  project.scenes[index]=result.scenes[0]!;
  await writeFile(checkpoint,JSON.stringify(project,null,2));
  console.log(`READY ${Math.round(performance.now()-start)} ms · ${result.scenes[0]!.dialogue?.reduce((n,l)=>n+(l.speechWindows?.length||0),0)} speech windows`);
}
await writeFile(path.join(directory,'project-natural.json'),JSON.stringify(project,null,2));
if(!process.argv.includes('--audio-only')){
  let previous=-1;
  const result=await renderCanvasAnimationProject(project,undefined,p=>{const n=Math.floor(p*10)*10;if(n!==previous){previous=n;console.log(`RENDER ${n}%`);}});
  const target=path.join(directory,'ma-xo-natural.mp4');await copyFile(result.path,target);console.log(`VIDEO=${target}`);
}
