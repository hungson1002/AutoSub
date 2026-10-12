/** Renderer acceptance fixture, not an AI-generated story or finished film. */
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {parseVectorPlan} from '../server/services/canvasVectorDirector';
import {renderCanvasFast} from '../server/services/canvasFastRender';
import {animationRenderSourceSignature} from '../server/services/animationRenderSource';
import {resolveBrowserExecutable} from '../server/services/animationBrowser';
import {run} from '../server/services/ffmpeg';
const root='tmp/vector-crowd-check';await mkdir(root,{recursive:true});
const project=parseVectorPlan(JSON.stringify({name:'Crowd and cutout motion acceptance',vectorAssets:{
 hero:{rig:'simple-puppet',hair:'side-part',outfit:'robe',palette:{shirt:'#526a80'}},
 vendor:{rig:'simple-puppet',hair:'none',headwear:'conical',outfit:'vest',faceShape:'broad',palette:{shirt:'#6c7251',accent:'#bca36c'}},
 elder:{rig:'simple-puppet',hair:'tied',facialHair:'beard',outfit:'shawl',faceShape:'oval',eyeStyle:'tired',palette:{hair:'#c5c4bb',shirt:'#697568'}},
 woman:{rig:'simple-puppet',hair:'bun',outfit:'ao-dai',headwear:'headscarf',palette:{shirt:'#8a617c',accent:'#ab8da0'}},
 },vectorStages:{village:{template:'illustrated-place',place:'village',light:'dusk',seed:11,cast:{person:'hero'},extras:[
 {id:'seller',asset:'vendor',x:470,footY:925,height:180},
 {id:'elder',asset:'elder',x:95,footY:925,height:175},
 {id:'passer',asset:'woman',x:320,footY:865,height:130},
 ]}},scenes:[
 {durationMs:4000,narration:'Kiểm tra người đi ngang.',vectorScene:{stage:'village',walks:[{actor:'passer',to:'seller',gap:45,start:.05,end:.9}]}},
 {durationMs:4000,narration:'Kiểm tra tư thế dừng.',vectorScene:{stage:'village',walks:[{actor:'passer',to:'seller',gap:45,hold:true}]}},
 ]}),'Neutral renderer fixture',{width:1280,height:720});
project.fps=24;project.exportDurationMs=8000;
for(const scene of project.scenes)scene.narration='';
await writeFile(root+'/project.json',JSON.stringify(project,null,2));
const executable=resolveBrowserExecutable();if(!executable)throw new Error('No render browser');
const file=root+'/AutoSub_Test_QuanChung_8s.mp4';
await renderCanvasFast(project,file,{signature:await animationRenderSourceSignature(process.cwd()),executable,assetOrigin:'http://127.0.0.1:8787',preset:'ultrafast'});
await run('ffmpeg',['-v','error','-i',file,'-f','null','-']);
await run('ffmpeg',['-v','error','-y','-i',file,'-vf','fps=1,scale=480:270,tile=4x2:padding=4:margin=4','-frames:v','1',root+'/overview.jpg']);
await copyFile(file,process.env.USERPROFILE+'/Downloads/AutoSub_Test_QuanChung_8s.mp4');
console.log('RENDERED '+file);
