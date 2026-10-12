import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { parsePlan } from '../server/services/canvasAnimationDirector';
import { renderCanvasAnimationProject } from '../server/services/animationRender';
import { run } from '../server/services/ffmpeg';
import { applyRecipeToBrief, filmRecipeById } from '../shared/filmRecipes';
import { prepareCanvasProjectAudio } from '../server/services/canvasAudioProduction';

const output = path.resolve('tmp/folk-horror-pilot');
await mkdir(output, { recursive: true });
const brief = applyRecipeToBrief('Ma tóc dài ngồi trên cây ven ruộng, quấn cổ rồi kéo người đi đường ngã. Video dọc.', filmRecipeById('folk-horror'));
let project = parsePlan(JSON.stringify({name:'Truyện ma dân gian — thử chuyển động',scenes:[{
  name:'Quấn và kéo ngã',stageId:'field-tree',durationMs:12000,template:'two-shot',background:'night',backgroundRef:'bg:folk-night-field',
  narration:'Con ma ngồi trên cây, buông hai dải dài xuống. Nó quấn vào cổ người đi đường rồi kéo ngã. Khi buông ra, người ấy vẫn nằm trên đất.',
  camera:{shot:'wide',motion:'none',zoom:1},
  objects:[
    {kind:'prop',label:'Cây ven ruộng',variant:'tree',assetRef:'prop:tree',slot:'mid-left',depth:'midground',sizeClass:'hero',role:'support',motion:'none'},
    {kind:'character',label:'Con ma',characterKey:'ghost',appearance:'long-limbed-spirit',perchedOn:'Cây ven ruộng',assetRef:'character:villager',slot:'hero-left',depth:'midground',sizeClass:'medium',role:'focal',motion:'none'},
    {kind:'character',label:'Người đi đường áo nâu',characterKey:'traveler',appearance:'human',assetRef:'character:villager',slot:'foreground-right',depth:'foreground',sizeClass:'small',role:'support',motion:'none',color:'#75634e',designNotes:'brown shirt'},
  ],
  animationBeats:[
    {action:'grab',targets:['ghost'],focusTargetId:'traveler',atMs:1800,durationMs:2600},
    {action:'pull',targets:['ghost'],focusTargetId:'traveler',atMs:4400,durationMs:2300},
    {action:'release',targets:['ghost'],focusTargetId:'traveler',atMs:8800,durationMs:1800},
  ],
}]}),brief,{width:720,height:1280});
project = await prepareCanvasProjectAudio({project,narration:{provider:{id:'edge-tts-local',name:'Edge TTS',baseUrl:'local://edge-tts',enabled:true,models:[],providerType:'edge-tts',authType:'none'},model:'edge-tts',voice:'vi-VN-NamMinhNeural',speed:1},autoSound:false});
await writeFile(path.join(output,'project.json'),JSON.stringify(project,null,2));
let last=-1;
const result=await renderCanvasAnimationProject(project,undefined,progress=>{
  const bucket=Math.floor(progress*10);if(bucket!==last){last=bucket;console.log(`Render ${bucket*10}%`);}
});
const video=path.join(output,'folk-horror-pilot.mp4');
await copyFile(result.path,video);
await run('ffmpeg',['-v','error','-i',video,'-f','null','-']);
await run('ffmpeg',['-y','-i',video,'-vf','fps=1/1.5,scale=270:480,tile=4x2:padding=5:margin=5','-frames:v','1',path.join(output,'overview.jpg')]);
console.log(JSON.stringify({video,size:result.size,cached:result.cached}));
