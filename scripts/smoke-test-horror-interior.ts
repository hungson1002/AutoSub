/** A separate location regression for hand-ink rural rooms, not a hard-coded film. */
import {mkdir,writeFile} from 'node:fs/promises';
import {parseVectorPlan} from '../server/services/canvasVectorDirector';
import {renderCanvasFast} from '../server/services/canvasFastRender';
import {resolveBrowserExecutable} from '../server/services/animationBrowser';
import {run} from '../server/services/ffmpeg';

const root='tmp/qa-horror-cutout';await mkdir(root,{recursive:true});
const ink={rig:'simple-puppet',finish:'handdrawn'};
const project=parseVectorPlan(JSON.stringify({
 name:'Illustrated rural interior test',
 vectorAssets:{
  hero:{...ink,hair:'side-part',outfit:'tunic',faceShape:'oval',palette:{skin:'#e8d3bd',hair:'#302a29',shirt:'#667b72',accent:'#c8a579'}},
  witness:{...ink,hair:'bun',outfit:'shawl',faceShape:'broad',eyeStyle:'tired',palette:{skin:'#dbc4b3',hair:'#96867b',shirt:'#8c6e68',accent:'#bb9b80'}},
 },
 vectorStages:{room:{template:'illustrated-place',place:'rural-interior',light:'night',finish:'handdrawn',seed:7,
  cast:{person:'hero'},extras:[{id:'witness',asset:'witness',x:710,footY:969,height:196}]}},
 scenes:[
  {durationMs:2000,narration:'Người khách bước vào căn nhà gỗ, thấy đèn vẫn cháy.',vectorScene:{stage:'room'}},
  {durationMs:2000,narration:'Một tiếng động làm người khách giật mình nhìn về phía cửa.',vectorScene:{stage:'room',
    shot:{target:'person',height:.43,include:['interior-door']},
    reactions:[{actor:'person',kind:'startle',toward:'interior-door',start:.05,end:.62}]}}
 ]}),'4s rural home renderer smoke',{width:1280,height:720},4);
project.fps=12;project.exportDurationMs=4000;
for(const scene of project.scenes)scene.narration='';
await writeFile(root+'/rural-interior-project.json',JSON.stringify(project));
const browser=resolveBrowserExecutable();if(!browser)throw new Error('No render browser');
const output=root+'/AutoSub_Horror_Illustrated_Interior_B4_Night_4s.mp4';
await renderCanvasFast(project,output,{signature:'rural-interior-handdrawn-render-20261011-b4',executable:browser,
 assetOrigin:'http://127.0.0.1:8787',preset:'ultrafast'});
await run('ffmpeg',['-v','error','-i',output,'-f','null','-']);
await run('ffmpeg',['-v','error','-y','-i',output,'-vf','fps=2,scale=400:225,tile=4x2:padding=3:margin=3','-frames:v','1',root+'/interior-contact-b4.jpg']);
console.log('INTERIOR_RENDER_OK '+output);
