import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {bundle} from '@remotion/bundler';
import {renderMedia,selectComposition} from '@remotion/renderer';
import {compileVectorProject} from '../shared/canvasVectorScene';
import {resolveBrowserExecutable} from '../server/services/animationBrowser';
import {getAnimationAssetFile} from '../server/services/animationAssets';
import {run} from '../server/services/ffmpeg';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';

const started=Date.now(),out=path.resolve('tmp/vector-test-30s');await mkdir(out,{recursive:true});
const original:CanvasStudioProject=JSON.parse(await readFile('tmp/quy-cau-remotion-svg-v2/project.json','utf8'));
const durations=[7500,7000,8000,7500];
const project=compileVectorProject({...original,id:randomUUID(),name:'Quỷ Cẩu — thử 30 giây',vectorReview:undefined,scenes:original.scenes.slice(0,4).map((scene,i)=>({...scene,durationMs:durations[i]!}))});
await writeFile(path.join(out,'project.json'),JSON.stringify(project,null,2));
// Render the production SVG composition without decoding TTS in Chromium.
// The existing retained audio is muxed at the exact scene boundaries below.
const visual={...project,scenes:project.scenes.map(scene=>({...scene,audioUrl:undefined}))};
console.log('Bundling current production Remotion composition');
const serveUrl=await bundle({entryPoint:path.resolve('src/remotion/index.tsx'),rootDir:path.resolve('.'),publicDir:null});
const inputProps={project:visual,assetOrigin:'http://127.0.0.1:8787'};
const browserExecutable=resolveBrowserExecutable();if(!browserExecutable)throw new Error('Production Chromium executable unavailable');
const composition=await selectComposition({serveUrl,id:'AutoSubCanvasAnimation',inputProps,browserExecutable,logLevel:'warn'});
if(composition.durationInFrames!==900)throw new Error(`Expected 900 frames, got ${composition.durationInFrames}`);
const common={serveUrl,composition,inputProps,browserExecutable,codec:'h264' as const,pixelFormat:'yuv420p' as const,crf:21,x264Preset:'ultrafast' as const,concurrency:1,logLevel:'warn' as const,muted:true,timeoutInMilliseconds:120000,overwrite:true};
console.log('Rendering 5s howl motion smoke test');
const smoke=path.join(out,'smoke-5s.mp4');
await renderMedia({...common,frameRange:[435,584],outputLocation:smoke});
await run('ffmpeg',['-v','error','-i',smoke,'-f','null','-']);
await run('ffmpeg',['-v','error','-y','-i',smoke,'-vf','fps=1,scale=216:384,tile=5x1','-frames:v','1',path.join(out,'smoke.jpg')]);
console.log(`5s smoke passed after ${Math.round((Date.now()-started)/1000)}s`);
const silent=path.join(out,'silent-30s.mp4');let last=-1;
await renderMedia({...common,outputLocation:silent,onProgress:({progress})=>{const step=Math.floor(progress*10);if(step!==last){last=step;console.log(`Remotion SVG ${Math.round(progress*100)}%`);}}});
const inputs:string[]=[],filters:string[]=[];
for(const [i,scene] of project.scenes.entries()){
 const id=scene.audioUrl?.match(/^\/api\/animation-studio\/assets\/([a-f0-9-]{36})\/file$/i)?.[1];if(!id)throw new Error('Missing retained local narration');
 inputs.push('-i',(await getAnimationAssetFile(id)).path);
 filters.push(`[${i+1}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${scene.durationMs/1000},asetpts=PTS-STARTPTS[a${i}]`);
}
filters.push('[a0][a1][a2][a3]concat=n=4:v=0:a=1[audio]');
const video=path.join(out,'AutoSub_QuyCau_Test_30s.mp4');
await run('ffmpeg',['-v','error','-y','-i',silent,...inputs,'-filter_complex',filters.join(';'),'-map','0:v','-map','[audio]','-c:v','copy','-c:a','aac','-b:a','192k','-t','30','-movflags','+faststart',video]);
await run('ffmpeg',['-v','error','-i',video,'-f','null','-']);
const probe=await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',video]);
await writeFile(path.join(out,'probe.json'),probe.stdout);
await run('ffmpeg',['-v','error','-y','-i',video,'-vf','fps=1/2,scale=216:384,tile=5x3:padding=4:margin=4','-frames:v','1',path.join(out,'overview.jpg')]);
const destination=path.join(process.env.USERPROFILE!,'Downloads','AutoSub_QuyCau_Test_30s.mp4');await copyFile(video,destination);
const result={video:destination,elapsedSeconds:Math.round((Date.now()-started)/1000),duration:30,frames:900,renderer:'native-remotion-svg',audio:'retained TTS muxed with FFmpeg',decode:'passed',scenes:4};
await writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
