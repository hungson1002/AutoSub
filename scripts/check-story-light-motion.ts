import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {run} from '../server/services/ffmpeg';
import {canvasLampLight} from '../shared/canvasAtmosphere';
import {evaluateCanvasCamera} from '../src/canvasAnimationStudio/runtime';
import {compileCanvasSceneLayout} from '../shared/canvasLayoutCompiler';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';
const root=path.resolve(process.argv[2]||'tmp/chiec-den-cuoi-ban-v2');
const video=path.join(root,process.argv[3]||'chiec-den-cuoi-ban-5-phut-v2.mp4');
const project=JSON.parse(await readFile(path.join(root,'project.json'),'utf8')) as CanvasStudioProject;
const index=project.scenes.findIndex(scene=>scene.name.endsWith('signal-detail')),scene=compileCanvasSceneLayout(project.scenes[index]!,1280,720);
const lamp=scene.objects.find(object=>object.id==='signal')!;
const start=project.scenes.slice(0,index).reduce((sum,scene)=>sum+Math.round(scene.durationMs*30/1000),0);
const states:Array<{timeMs:number;light:number}>=[];
for(let frame=6;frame<Math.round(scene.durationMs*30/1000)-6;frame+=3) {
  const timeMs=frame/30*1000,light=canvasLampLight(lamp,timeMs);
  if(!states.some(state=>state.light===light))states.push({timeMs,light});
  if(states.length===2)break;
}
if(states.length!==2)throw new Error('No visible on/off cycle within the signal shot');
const measured=[];
for(const [number,state] of states.entries()) {
  const file=path.join(root,`signal-${state.light?'on':'off'}.png`);
  await run('ffmpeg',['-y','-ss',String((start+Math.round(state.timeMs*30/1000))/30),'-i',video,'-frames:v','1',file]);
  const camera=evaluateCanvasCamera(scene,state.timeMs,1280,720);
  const x=camera.offsetX+camera.focusX+(lamp.x-camera.focusX)*camera.scale;
  const y=camera.offsetY+camera.focusY+(lamp.y-camera.focusY)*camera.scale;
  const size=Math.max(8,Math.round(lamp.width*.25*camera.scale));
  const crop=await sharp(file).extract({left:Math.round(x-size/2),top:Math.round(y-size/2),width:size,height:size}).toBuffer();
  const stats=await sharp(crop).stats();
  measured.push({frame:start+Math.round(state.timeMs*30/1000),light:state.light,warmMean:stats.channels[0]!.mean});
}
const on=measured.find(state=>state.light===1)!,off=measured.find(state=>state.light===0)!;
if(on.warmMean-off.warmMean<30)throw new Error(`Light does not visibly change in encoded video: ${JSON.stringify(measured)}`);
const images=await Promise.all(['on','off'].map(async state=>({input:await sharp(path.join(root,`signal-${state}.png`)).resize(640,360).toBuffer(),left:state==='on'?0:640,top:0})));
await sharp({create:{width:1280,height:360,channels:3,background:'#172129'}}).composite(images).jpeg().toFile(path.join(root,'signal-on-off.jpg'));
const waterFrames=[];
for(const timeMs of [1000,2000]) {
  const file=path.join(root,`water-${timeMs}.png`);
  await run('ffmpeg',['-y','-ss',String((start+timeMs*30/1000)/30),'-i',video,'-frames:v','1',file]);
  const camera=evaluateCanvasCamera(scene,timeMs,1280,720);
  // Compare the same world-space channel, compensating the gentle camera push.
  const left=Math.round(camera.offsetX+camera.focusX+(512-camera.focusX)*camera.scale);
  const top=Math.round(camera.offsetY+camera.focusY+(510-camera.focusY)*camera.scale);
  const data=await sharp(file).extract({left,top,width:Math.round(130*camera.scale),height:Math.round(45*camera.scale)}).resize(130,45).removeAlpha().raw().toBuffer();
  waterFrames.push(data);
}
const waterDifference=waterFrames[0]!.reduce((sum,value,index)=>sum+Math.abs(value-waterFrames[1]![index]!),0)/waterFrames[0]!.length;
if(waterDifference<.4)throw new Error(`Encoded water is static: ${waterDifference}`);
await writeFile(path.join(root,'motion-verification.json'),JSON.stringify({encodedLampStates:measured,warmDifference:on.warmMean-off.warmMean,waterDifference},null,2),'utf8');
console.log(JSON.stringify({lightChangesInMP4:true,warmDifference:on.warmMean-off.warmMean,waterChangesInMP4:true,waterDifference}));
