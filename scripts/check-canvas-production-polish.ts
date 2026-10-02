import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {run} from '../server/services/ffmpeg';
const root=path.resolve('tmp/chiec-den-cuoi-ban-v3'),video=path.join(root,'kiem-tra-khau-hinh-chuyen-dong-do-go.mp4');
const project=JSON.parse(await readFile(path.join(root,'submitted-test.json'),'utf8'));
let time=0;const times:number[]=[];
for(const scene of project.scenes){times.push(time+scene.durationMs*.55/1000);time+=scene.durationMs/1000;}
const samples=[.4,1.72,...times];
const layers=[];
for(const [i,second] of samples.entries()){
  const file=path.join(root,`sample-${i}.png`);
  await run('ffmpeg',['-y','-ss',String(second),'-i',video,'-frames:v','1',file]);
  layers.push({input:await sharp(file).resize(640,360).toBuffer(),left:i%2*640,top:Math.floor(i/2)*360});
}
await sharp({create:{width:1280,height:1080,channels:3,background:'#172129'}}).composite(layers).jpeg({quality:95}).toFile(path.join(root,'kiem-tra-hinh.jpg'));
const probe=JSON.parse((await run('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,width,height,nb_frames','-of','json',video])).stdout);
await run('ffmpeg',['-v','error','-threads','1','-i',video,'-f','null','-']);
await writeFile(path.join(root,'verification.json'),JSON.stringify({probe,decoded:true,expectedSeconds:time,samples},null,2));
console.log(JSON.stringify({decoded:true,seconds:probe.format.duration,expectedSeconds:time}));
