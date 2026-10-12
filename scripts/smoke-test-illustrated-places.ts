/** Low-impact real-render quality smoke: 2 different environments, SAME
 * user-style compact 2D cast, 1 browser and 1 FFmpeg frame in flight.
 * Never calls AI/TTS, restarts server, or renders a long film. */
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parseVectorPlan} from '../server/services/canvasVectorDirector';
import {renderCanvasFast} from '../server/services/canvasFastRender';
import {resolveBrowserExecutable} from '../server/services/animationBrowser';
import {run} from '../server/services/ffmpeg';

const root=path.resolve('tmp/qa-illustrated-place');
await mkdir(root,{recursive:true});
const person={rig:'simple-puppet',outfit:'tunic',hair:'side-part',palette:{
  skin:'#efd7bd',hair:'#322b29',shirt:'#62717c',accent:'#b79a79',trim:'#d5bf9d',inner:'#e5dbc6'}};
const project=parseVectorPlan(JSON.stringify({
  name:'Art quality / location smoke',
  vectorAssets:{hero:person},
  vectorStages:{
    village:{template:'illustrated-place',place:'village',light:'dusk',seed:11,cast:{person:'hero'}},
    corridor:{template:'illustrated-place',place:'corridor',light:'night',seed:17,cast:{person:'hero'}},
  },
  scenes:[
    {name:'Vào làng',durationMs:2000,narration:'Người khách nhìn quanh ngôi làng lúc chiều muộn.',
      vectorScene:{stage:'village',shot:{target:'person',height:.42},
        reactions:[{actor:'person',kind:'look',toward:'house-mid',start:.2,end:.65}]}},
    {name:'Hành lang vắng',durationMs:2000,narration:'Trong hành lang, người khách giật mình khi nghe tiếng động.',
      vectorScene:{stage:'corridor',shot:{target:'person',height:.42},
        reactions:[{actor:'person',kind:'startle',toward:'door-panel-1',start:.2,end:.65}]}},
  ]
}),'Cảnh hoạt hình kinh dị ở hai địa điểm khác nhau',{width:720,height:1280},4);
project.fps=12;project.exportDurationMs=4000;
for(const s of project.scenes){
 const id=s.vectorScene!.nodes.find(n=>n.id==='person')!.asset!;
 assert.equal(id,'hero','do not redesign one cast on a location change');
 assert.ok(!project.vectorAssets!.hero!.nodes.some(n=>n.id==='leg-l'),'no forced long doll legs');
}
await writeFile(path.join(root,'project.json'),JSON.stringify(project));
const executable=resolveBrowserExecutable();
if(!executable)throw new Error('No Chrome available');
const output=path.join(root,'illustrated-place-two-worlds-fixed-4s.mp4');
console.log('RENDER START: 4 s at 12fps, 1 Chromium, 1 FFmpeg thread, two reusable location stages.');
await renderCanvasFast(project,output,{signature:'illustrated-place-scene-quality-v2',executable,assetOrigin:'http://127.0.0.1:8787',preset:'ultrafast'});
await run('ffmpeg',['-hide_banner','-loglevel','error','-i',output,'-f','null','-']);
const sheet=path.join(root,'contact-fixed.jpg');
await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',output,'-vf','fps=2,scale=216:384,tile=4x2:padding=4:margin=4','-frames:v','1',sheet]);
console.log('RENDER_DONE '+JSON.stringify({output,sheet,cast:'unchanged compact folk cartoon',duration:4}));
