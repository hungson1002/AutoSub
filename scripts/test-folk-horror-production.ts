import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { applyRecipeToBrief, filmRecipeById } from '../shared/filmRecipes';
import { run } from '../server/services/ffmpeg';
import type { CanvasStudioProject } from '../shared/canvasAnimationStudio';
import { renderCanvasAnimationProject } from '../server/services/animationRender';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';

const durationArg = process.argv.indexOf('--duration');
const durationSeconds = durationArg >= 0 ? Number(process.argv[durationArg + 1]) : 30;
if (![30, 60].includes(durationSeconds)) throw new Error('Supported test durations: 30 or 60 seconds');
const outputArg = process.argv.indexOf('--output');
const output = path.resolve(outputArg >= 0 ? process.argv[outputArg + 1]! : durationSeconds === 60 ? 'tmp/folk-horror-60s' : 'tmp/folk-horror-production');
const videoName = durationSeconds === 60 ? 'folk-horror-60s.mp4' : 'folk-horror-production.mp4';
const sheetLayout = durationSeconds === 60 ? '5x4' : '5x2';
const brief = durationSeconds === 60
  ? 'Tạo video đúng 60 giây tên Bóng trên cây, truyện ma dân gian 2D dọc 9:16. Kể một câu chuyện hoàn chỉnh bằng 195-210 từ tiếng Việt, giọng người kể, không có thoại nhân vật. Đúng 6 cảnh: 1 (9 giây) cây ven đồng lúc đêm, con ma tóc dài áo trắng ngồi trên cành; 2 (9 giây) người áo nâu mặt sọ đi ngang cùng cây, ma vẫn ngồi; 3 (18 giây) cùng một shot giữ cây và cả hai nhân vật, ma vươn hai dải dài quấn cổ người đi đường, kéo ngã rồi thu lại, đủ grab -> pull -> release theo speechCue chính xác, không chuyển cảnh giữa ba hành động; 4 (8 giây) người ấy vẫn nằm bất động trên đất sau khi được thả, không tự đứng lên, dùng pose và keyframe rotation/dy giữ trạng thái cuối cảnh trước; 5 (8 giây) cận khuôn mặt ma trừng mắt, không chạy hay bay; 6 (8 giây) cây và đường làng lúc sáng, kết lời kể rằng người làng tránh cây sau tối. Tổng chính xác 60 giây, khoảng 200 từ để tránh im lặng dài cuối cảnh. Giữ nhân vật, cây, bên đứng và màu áo nhất quán. Trong cảnh tương tác dùng appearance:long-limbed-spirit, perchedOn trỏ cây, focusTargetId trỏ đúng người. Nạn nhân mặc áo nâu, ma áo trắng tóc đen. Không dùng bóng đen prop:ghost thay nhân vật. Nền phẳng, ít chi tiết, phụ đề trắng phía trên. Trước khi quấn người phải đứng, sau khi kéo người phải nằm. Cảnh cận mặt phải thật sự phóng khuôn mặt, không chỉ đặt nguyên người ở giữa khung.'
  : 'Video 30 giây, đúng 3 cảnh truyện ma dân gian tên Bóng trên cây. Cảnh 1 giới thiệu con ma tóc dài áo trắng ngồi trên cây ven ruộng và người áo nâu đi ngang. Cảnh 2 giữ cùng cây và hai nhân vật, trong cùng một shot thấy con ma vươn hai dải dài, quấn vào cổ rồi kéo người đi đường ngã; phải đủ grab rồi pull, focusTargetId đúng nạn nhân, speechCue chính xác. Cảnh 3 là cận cảnh con ma, kết thúc lời kể; không kể thêm hành động khác. Nhân vật người dùng mặt sọ, không có thoại của nhân vật, chỉ người kể. Không dùng bóng đen prop:ghost thay con ma, không chuyển sang căn phòng hay nhà sàn. Mỗi cảnh khoảng 8-11 giây, lời kể khoảng 75-85 từ. Dọc 9:16.';
await mkdir(output,{recursive:true});
// Recheck an existing generated project without another model or TTS request.
if(process.argv.includes('--render-existing')){
  const retained=compileCanvasProjectLayout(JSON.parse(await readFile(path.join(output,'project.json'),'utf8')) as CanvasStudioProject);
  await writeFile(path.join(output,'project.json'),JSON.stringify(retained,null,2));
  const result=await renderCanvasAnimationProject(retained);
  const video=path.join(output,videoName);
  await copyFile(result.path,video);
  await run('ffmpeg',['-v','error','-i',video,'-f','null','-']);
  await run('ffmpeg',['-y','-i',video,'-vf',`fps=1/3,scale=270:480,tile=${sheetLayout}:padding=5:margin=5`,'-frames:v','1',path.join(output,'overview.jpg')]);
  console.log(JSON.stringify({video,size:result.size,cached:result.cached}));
  process.exit(0);
}
const db = new DatabaseSync(path.join(process.env.APPDATA!,'9router/db/data.sqlite'),{readOnly:true});
const credential = db.prepare('SELECT key FROM apiKeys WHERE isActive=1 LIMIT 1').get() as {key:string} | undefined;
db.close();
if(!credential)throw new Error('No configured local 9Router credential');
const post = async <T>(url:string,body:unknown):Promise<T> => {
  // A generation + independent QC can legitimately exceed fetch's default
  // five-minute headers limit. Match the existing 15-minute production budget.
  const payload=JSON.stringify(body);
  return new Promise<T>((resolve,reject)=>{
    const req=httpRequest(`http://127.0.0.1:8787${url}`,{method:'POST',headers:{
      'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),
    }},response=>{
      const chunks:Buffer[]=[];
      response.on('data',chunk=>chunks.push(Buffer.from(chunk)));
      response.on('error',reject);
      response.on('end',()=>{
        try{
          const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if(!response.statusCode||response.statusCode>=400)reject(new Error(result.error||`HTTP ${response.statusCode}`));
          else resolve(result as T);
        }catch(error){reject(error);}
      });
    });
    req.setTimeout(900000,()=>req.destroy(new Error('Production request timed out after 15 minutes; checkpoint retained')));
    req.on('error',reject);req.end(payload);
  });
};
console.log('Generating through the live Animation Studio endpoint');
const project = await post<CanvasStudioProject>('/api/canvas-animation-studio/generate',{
  brief:applyRecipeToBrief(brief,filmRecipeById('folk-horror')),
  width:720,height:1280,targetDurationSeconds:durationSeconds,visualMode:'procedural',
  provider:{id:'qa-router',name:'9Router',baseUrl:'http://127.0.0.1:20128/v1',enabled:true,models:[],providerType:'openai-compatible',authType:'bearer',apiKey:credential.key},
  model:'ag/gemini-3.8-flash-high',
  narration:{provider:{id:'edge-tts-local',name:'Edge TTS',baseUrl:'local://edge-tts',enabled:true,models:[],providerType:'edge-tts',authType:'none'},model:'edge-tts',voice:'vi-VN-NamMinhNeural',speed:1},
  audioProduction:{enabled:true,autoSound:false},
});
await writeFile(path.join(output,'project.json'),JSON.stringify(project,null,2));
console.log(`Generated ${project.scenes.length} scenes, ${Math.round(project.scenes.reduce((sum,s)=>sum+s.durationMs,0))}ms`);
const job = await post<{id:string}>(`/api/canvas-animation-studio/projects/${project.id}/render-jobs`,{project});
console.log(`Render job ${job.id}`);
for(let n=0;n<900;n++){
  await new Promise(resolve=>setTimeout(resolve,1000));
  const response=await fetch(`http://127.0.0.1:8787/api/animation-studio/render-jobs/${job.id}`);
  if(!response.ok)throw new Error(`Render status HTTP ${response.status}`);
  const status=await response.json();
  if(n%20===0)console.log(`${status.status} ${status.progress}%`);
  if(status.status==='failed')throw new Error(status.error);
  if(status.status!=='completed')continue;
  const video=path.join(output,videoName);
  await copyFile(status.result.path,video);
  await run('ffmpeg',['-v','error','-i',video,'-f','null','-']);
  await run('ffmpeg',['-y','-i',video,'-vf',`fps=1/3,scale=270:480,tile=${sheetLayout}:padding=5:margin=5`,'-frames:v','1',path.join(output,'overview.jpg')]);
  console.log(JSON.stringify({video,size:status.result.size}));
  process.exit(0);
}
throw new Error('Render pending; project and job retained');
