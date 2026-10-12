/** 4s low-memory smoke test of the production Canvas vector renderer.
 * No AI provider, audio generation, API restart, or 30fps large video export. */
import {mkdir,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {parseVectorPlan} from '../server/services/canvasVectorDirector';
import {renderCanvasFast} from '../server/services/canvasFastRender';
import {resolveBrowserExecutable} from '../server/services/animationBrowser';
import {vectorTrackTiming,evaluateVectorPart} from '../shared/canvasVectorScene';
import {vectorWorldMatrix,vectorPoint} from '../shared/canvasVectorTransform';
import {run} from '../server/services/ffmpeg';

const out=path.resolve('tmp/qa-folk-chibi-riverbank');await mkdir(out,{recursive:true});
const cast={rig:'simple-human',style:'folk-chibi-v2',outfit:'ao-dai',hair:'side-part',palette:{
  skin:'#e7cfb1',shirt:'#776858',pants:'#504941',hem:'#5a534a',hair:'#282929',accent:'#a67f61',trim:'#e6c5a6'}};
const input={name:'Smoke: bờ sông và chibi vận động',vectorAssets:{hero:cast},
  vectorStages:{shore:{template:'folk-riverbank',cast:{person:'hero'}}},
  scenes:[{name:'Bước đến bờ sông, giật mình',durationMs:4000,
    narration:'Người khách bước tới cọc gỗ, dừng lại khi nghe một tiếng động lạ.',
    vectorScene:{stage:'shore',shot:{target:'person',height:.49,include:['mooring-stake']},
      walks:[{actor:'person',to:'mooring-stake',gap:80,start:0,end:.54}],
      reactions:[{actor:'person',kind:'startle',toward:'mooring-stake',start:.6,end:.85}],
    }}]};
const project=parseVectorPlan(JSON.stringify(input),'Truyện kinh dị dân gian bờ sông',{width:720,height:1280},4);
project.fps=15;project.exportDurationMs=4000;
const scene=project.scenes[0]!;
assert.ok(scene.vectorScene!.tracks.some(t=>t.target==='person'&&t.frames.some(f=>f.dx!==undefined)));
assert.ok(scene.vectorScene!.tracks.some(t=>t.target.startsWith('person/leg-')&&t.frames.some(f=>f.rotation!==undefined)));
assert.ok(scene.vectorScene!.tracks.some(t=>t.target.startsWith('person/arm-')&&t.frames.some(f=>f.rotation!==undefined)));
const actor=scene.vectorScene!.nodes.find(n=>n.id==='person')!;
const poseSamples=[0,500,1000,1500,2000,2600,3200,3900].map(ms=>{
  const head=vectorPoint(vectorWorldMatrix('person/head-group',scene,ms,project.vectorAssets),0,0);
  const foot=vectorPoint(vectorWorldMatrix('person/foot-r',scene,ms,project.vectorAssets),0,0);
  return {ms,head,foot,root:evaluateVectorPart('person',scene,ms)};
});
await writeFile(path.join(out,'project.json'),JSON.stringify(project,null,2));
await writeFile(path.join(out,'poses.json'),JSON.stringify(poseSamples,null,2));
const browser=resolveBrowserExecutable();if(!browser)throw new Error('No browser available for production render');
console.log('Production renderer smoke: 4s, 15fps, one browser and one frame in flight; no narration/AI.');
const movie=path.join(out,'folk-chibi-riverbank-v3-4s.mp4');
await renderCanvasFast(project,movie,{signature:'folk-chibi-riverbank-v3',executable:browser,assetOrigin:'http://127.0.0.1:8787',preset:'ultrafast'});
await run('ffmpeg',['-v','error','-i',movie,'-f','null','-']);
const probe=JSON.parse((await run('ffprobe',['-v','error','-show_entries','format=duration,size:stream=width,height,nb_frames,codec_name','-of','json',movie])).stdout);
const grid=path.join(out,'overview.jpg');
await run('ffmpeg',['-v','error','-y','-i',movie,'-vf','fps=2,scale=216:384,tile=4x2:padding=4:margin=4','-frames:v','1',grid]);
const overviewBase64=(await sharp(grid).resize({width:650}).jpeg({quality:67}).toBuffer()).toString('base64');
await writeFile(path.join(out,'overview-small.b64'),overviewBase64);
console.log(JSON.stringify({video:movie,overview:grid,probe,actorRootMoved:poseSamples.at(-1)!.root.dx-poseSamples[0]!.root.dx,headShift:poseSamples.at(-1)!.head.x-poseSamples[0]!.head.x,overviewBase64Length:overviewBase64.length}));
