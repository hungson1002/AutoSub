import { readFile,writeFile,copyFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import type { CanvasStudioProject } from '../shared/canvasAnimationStudio';
import { createVieneuLocalProvider } from '../src/lib/providers';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

const directory=path.resolve('tmp/ma-xo-pilot');
const saved=path.join(directory,'project-sound-design.json');
let project:CanvasStudioProject;
if(process.argv.includes('--reuse'))project=JSON.parse(await readFile(saved,'utf8'));
else {
  project=JSON.parse(await readFile(path.join(directory,'project-directed.json'),'utf8'));
  project.name='Ma Xó — giọng từng vai & sound design';
  const host=project.scenes.flatMap(scene=>scene.objects).find(o=>o.label==='Bà chủ')!;
  const hostKey=host.characterKey||host.label;
  project.castVoices={'Người kể':'preset:anh-khoi',[hostKey]:'preset:ngoc-huyen','Giọng dưới sàn':'preset:truc-ly'};
  for(const scene of project.scenes){
    scene.dialogue=[{id:`${scene.id}-narrator`,speaker:'Người kể',text:scene.narration||''}];
    for(const actor of scene.objects.filter(o=>o.kind==='character'&&o.pose==='talk'))actor.pose='idle';
  }
  const lines=(index:number,narrator:string,speaker:string,text:string,characterKey?:string,distant=false)=>{
    project.scenes[index]!.dialogue=[{id:`line-${index}-narrator`,speaker:'Người kể',text:narrator},
      {id:`line-${index}-character`,speaker,characterKey,text,delivery:distant?'distant':'natural'}];
  };
  lines(1,'Tối đầu tiên, bà chủ chỉ dặn một câu:','Bà chủ','Nửa đêm nghe tiếng gõ dưới gầm sàn thì tuyệt đối đừng cúi xuống nhìn.',hostKey);
  lines(7,'Rồi một giọng phụ nữ khàn khàn vang lên phía dưới:','Giọng dưới sàn','Cho xin... bát nước.',undefined,true);
  lines(10,'Rồi bà nói nhỏ:','Bà chủ','Đêm qua không ai thức. Và dưới gầm sàn này... chưa từng có ai sống cả.',hostKey);
  console.log('TTS: Anh Khôi / Ngọc Huyền / Trúc Ly; preparing voiced dialogue and Foley…');
  // Checkpoint each scene; cached clips survive interrupted CPU TTS runs.
  const checkpoint=path.join(directory,'project-sound-design.partial.json');
  try { const previous=JSON.parse(await readFile(checkpoint,'utf8')) as CanvasStudioProject;
    if(previous.id===project.id)for(const scene of project.scenes){const retained=previous.scenes.find(s=>s.id===scene.id&&s.audioMixKey);if(retained)Object.assign(scene,retained);}
  } catch { /* first run */ }
  const floor=project.scenes[4]!;
  const movingKnocks=[
    {id:`${floor.id}-knock-left`,preset:'knock' as const,atMs:700,durationMs:850,volume:.38,pan:-.7},
    {id:`${floor.id}-knock-right`,preset:'knock' as const,atMs:2700,durationMs:850,volume:.38,pan:.7},
  ];
  if(JSON.stringify(floor.soundEffects)!==JSON.stringify(movingKnocks)){
    floor.soundEffects=movingKnocks;floor.audioMixKey=undefined;
  }
  for(const [index,scene] of project.scenes.entries()){
    if(scene.audioMixKey)continue;
    console.log(`AUDIO ${index+1}/${project.scenes.length}: ${scene.name}`);
    const body=JSON.stringify({project:{...project,scenes:[scene]},narration:{provider:createVieneuLocalProvider(),model:'vieneu-v3-turbo',voice:'preset:anh-khoi',speed:.94},autoSound:true});
    const voiced=await new Promise<CanvasStudioProject>((resolve,reject)=>{
      const request=http.request('http://127.0.0.1:8787/api/canvas-animation-studio/audio',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},response=>{
        let data='';response.setEncoding('utf8');response.on('data',chunk=>data+=chunk);response.on('error',reject);
        response.on('end',()=>{try{if(response.statusCode!==200)throw new Error(data);resolve(JSON.parse(data));}catch(error){reject(error);}});
      });request.setTimeout(30*60*1000,()=>request.destroy(new Error('CPU TTS exceeded 30 minutes.')));request.on('error',reject);request.end(body);
    });
    project.scenes[index]=voiced.scenes[0]!;project.castVoices={...project.castVoices,...voiced.castVoices};
    await writeFile(checkpoint,JSON.stringify(project,null,2));
  }
  await writeFile(saved,JSON.stringify(project,null,2));
  console.log(`AUDIO READY: ${project.scenes.flatMap(s=>s.dialogue||[]).length} dialogue clips, ${project.scenes.flatMap(s=>s.soundEffects||[]).length} sound cues`);
}
if(!process.argv.includes('--audio-only')){
  let previous=-1;
  const result=await renderCanvasAnimationProject(project,undefined,p=>{const percent=Math.floor(p*10)*10;if(percent!==previous){previous=percent;console.log(`RENDER ${percent}%`);}});
  const output=path.join(directory,'ma-xo-sound-design.mp4');await copyFile(result.path,output);console.log(`VIDEO=${output}`);
}
