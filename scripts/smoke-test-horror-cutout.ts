/** Reference-driven QA. Short, low-memory native render of compact handdrawn
 * assets and an action/settle cycle; no AI/TTS, no server restart. */
import {mkdir,writeFile} from 'node:fs/promises';
import {parseVectorPlan} from '../server/services/canvasVectorDirector';
import {renderCanvasFast} from '../server/services/canvasFastRender';
import {resolveBrowserExecutable} from '../server/services/animationBrowser';
import {run} from '../server/services/ffmpeg';

const root='tmp/qa-horror-cutout';await mkdir(root,{recursive:true});
const common={finish:'handdrawn',rig:'simple-puppet'};
const project=parseVectorPlan(JSON.stringify({name:'Horror cutout hand-ink acceptance',
 vectorAssets:{
   hero:{...common,hair:'side-part',outfit:'tunic',faceShape:'oval',palette:{skin:'#ecd5ba',shirt:'#526d7c',hair:'#292525',trim:'#d4b796',accent:'#9c7b59'}},
   vendor:{...common,hair:'none',headwear:'conical',outfit:'vest',faceShape:'broad',palette:{skin:'#edcfb0',shirt:'#748061',hair:'#514131',accent:'#c0a36f'}},
   elder:{...common,hair:'bun',facialHair:'beard',outfit:'shawl',eyeStyle:'tired',palette:{skin:'#e0c7ac',shirt:'#70675e',hair:'#a5a39a',accent:'#a99c7c'}},
   woman:{...common,hair:'long',outfit:'ao-dai',faceShape:'round',palette:{skin:'#e6c5af',shirt:'#956a70',hair:'#292628',accent:'#bca187'}},
   child:{...common,hair:'short',outfit:'tunic',eyeStyle:'wide',palette:{skin:'#ecd4b9',shirt:'#718665',hair:'#403431',accent:'#e1c496'}}, 
 },
 vectorStages:{village:{template:'illustrated-place',place:'village',light:'day',finish:'handdrawn',setting:'market',seed:11,
   cast:{person:'hero'},extras:[
    {id:'vendor',asset:'vendor',x:650,footY:925,height:175},
    {id:'elder',asset:'elder',x:110,footY:928,height:162},
    {id:'woman',asset:'woman',x:-98,footY:908,height:150},
    {id:'child',asset:'child',x:822,footY:887,height:121},
   ]}},
 scenes:[
  {durationMs:3300,narration:'Người khách bước qua khu chợ lúc ban ngày.',
   vectorScene:{stage:'village',
    nodes:[{id:'waypoint',type:'group',parent:'illustrated-world',x:610,y:980,groundAnchor:{x:0,y:0}}],
    walks:[{actor:'person',to:'waypoint',gap:80,start:0,end:.67}]}},
  {durationMs:2700,narration:'Bỗng nghe tiếng động, anh khựng lại nhìn về phía người lạ.',
   vectorScene:{stage:'village',
    nodes:[{id:'waypoint',type:'group',parent:'illustrated-world',x:610,y:980,groundAnchor:{x:0,y:0}}],
    walks:[{actor:'person',to:'waypoint',gap:80,hold:true}],
    shot:{target:'person',height:.43,include:['vendor']},
    reactions:[{actor:'person',kind:'startle',toward:'vendor',start:.08,end:.46}]}}
 ]}),'Test nét vẽ và cutout movement',{width:1280,height:720},6);
project.fps=15;project.exportDurationMs=6000;
for(const s of project.scenes)s.narration='';
await writeFile(root+'/project.json',JSON.stringify(project,null,2));
const browser=resolveBrowserExecutable();if(!browser)throw Error('No supported render browser');
const movie=root+'/AutoSub_Horror_Cutout_Handdrawn_B11_Directed_6s.mp4';
console.log('Start 6-second 15fps, one browser native render.');
await renderCanvasFast(project,movie,{signature:'horror-cutout-handdrawn-qa-20261011-b11',executable:browser,assetOrigin:'http://127.0.0.1:8787',preset:'ultrafast'});
await run('ffmpeg',['-v','error','-i',movie,'-f','null','-']);
await run('ffmpeg',['-v','error','-y','-i',movie,'-vf','fps=1,scale=480:270,tile=3x2:padding=4:margin=4','-frames:v','1',root+'/contact-b11.jpg']);
console.log('RENDER_OK '+movie);
