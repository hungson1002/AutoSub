import {readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';
import {run} from '../server/services/ffmpeg';

const directory=path.resolve(process.argv[2]||'tmp/chiec-den-cuoi-ban-5p');
const video=path.join(directory,process.argv[3]||'chiec-den-cuoi-ban-5-phut.mp4');
const project=JSON.parse(await readFile(path.join(directory,process.argv[4]||'project-final.json'),'utf8')) as CanvasStudioProject;
const result=await run('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,width,height,r_frame_rate,nb_frames,sample_rate,channels','-of','json',video]);
const probe=JSON.parse(result.stdout);
const stream=probe.streams.find((stream:{codec_name:string})=>stream.codec_name==='h264');
if(!stream||stream.width!==1280||stream.height!==720||Math.abs(Number(probe.format.duration)-300)>.3)throw new Error('Video format/duration mismatch');
await run('ffmpeg',['-v','error','-threads','1','-i',video,'-f','null','-']);
const levels=await run('ffmpeg',['-hide_banner','-i',video,'-vn','-af','volumedetect','-f','null','-']);
const mean=levels.stderr.match(/mean_volume: ([\d.-]+) dB/)?.[1],peak=levels.stderr.match(/max_volume: ([\d.-]+) dB/)?.[1];
let cursor=0;
const middleFrames:number[]=[],starts:number[]=[];
for(const scene of project.scenes) {
  starts.push(cursor);const frames=Math.round(scene.durationMs*30/1000);
  middleFrames.push(cursor+Math.floor(frames*.55));cursor+=frames;
}
for(let group=0;group<Math.ceil(project.scenes.length/10);group++) {
  const expression=middleFrames.slice(group*10,group*10+10).map(frame=>`eq(n,${frame})`).join('+');
  await run('ffmpeg',['-y','-threads','1','-i',video,'-vf',`select='${expression}',scale=640:-1,tile=5x2`,
    '-fps_mode','vfr','-frames:v','1',path.join(directory,`storyboard-${group+1}.jpg`)]);
}
const cutIndices=project.scenes.length>30?[2,13,23,28,37,48]:[2,8,14,16,21,26];
const cutFrames=cutIndices.flatMap(index=>[starts[index]!-2,starts[index]!,starts[index]!+2]);
await run('ffmpeg',['-y','-threads','1','-i',video,'-vf',`select='${cutFrames.map(frame=>`eq(n,${frame})`).join('+')}',scale=426:-1,tile=3x6`,
  '-fps_mode','vfr','-frames:v','1',path.join(directory,'cut-check.jpg')]);
const shorelineIndex=project.scenes.findIndex(scene=>scene.name.includes('duy-speaks'));
for(const [name,second] of [['opening',2],['night-shore',(starts[shorelineIndex>=0?shorelineIndex:17]!+120)/30],['ending',299]] as Array<[string,number]>) {
  await run('ffmpeg',['-y','-ss',String(second),'-i',video,'-frames:v','1',path.join(directory,`${name}.jpg`)]);
}
await writeFile(path.join(directory,'verification.json'),JSON.stringify({
  probe,decoded:true,scenes:project.scenes.length,timelineFrames:cursor,bytes:(await stat(video)).size,
  audio:{meanDb:mean,peakDb:peak},speechNotCut:project.scenes.every(scene=>scene.dialogue?.every(line=>(line.atMs||0)+(line.durationMs||0)<=scene.durationMs)),
},null,2),'utf8');
console.log(JSON.stringify({seconds:probe.format.duration,scenes:project.scenes.length,frames:stream.nb_frames,decoded:true,meanDb:mean,peakDb:peak}));
