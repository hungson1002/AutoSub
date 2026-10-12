import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {request} from 'node:http';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';
import {run} from '../server/services/ffmpeg';

const outputIndex=process.argv.indexOf('--output-dir');
const output=path.resolve(outputIndex>=0?process.argv[outputIndex+1]!:'tmp/quy-cau-vector-60s');
await mkdir(output,{recursive:true});
async function post<T>(url:string,body:unknown):Promise<T>{
  const payload=JSON.stringify(body);
  return new Promise((resolve,reject)=>{
    const req=request('http://127.0.0.1:8787'+url,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{
      const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('error',reject);
      res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!res.statusCode||res.statusCode>=400)reject(new Error(value.error||`HTTP ${res.statusCode}`));else resolve(value);}catch(error){reject(error);}});
    });
    req.setTimeout(1800000,()=>req.destroy(new Error('Generation timeout; checkpoints retained')));req.on('error',reject);req.end(payload);
  });
}
let project:CanvasStudioProject;
if(process.argv.includes('--render-existing'))project=JSON.parse(await readFile(path.join(output,'project.json'),'utf8'));
else{
  const resumeIndex=process.argv.indexOf('--resume-project');
  const retained=resumeIndex>=0?JSON.parse(await readFile(path.resolve(process.argv[resumeIndex+1]!),'utf8')):undefined;
  const db=new DatabaseSync(path.join(process.env.APPDATA!,'9router/db/data.sqlite'),{readOnly:true});
  const credential=db.prepare('SELECT key FROM apiKeys WHERE isActive=1 LIMIT 1').get() as {key:string}|undefined;db.close();
  if(!credential)throw new Error('No configured 9Router credential');
  console.log('Live generation: code-vector story, reusable SVG parts, preview and visual repair');
  const referenceIndex=process.argv.indexOf('--reference-video'),referenceImages:string[]=[];
  if(referenceIndex>=0){
    for(const [index,second] of [8,20,37,48].entries()){
      const file=path.join(output,`reference-${index}.jpg`);
      await run('ffmpeg',['-y','-v','error','-ss',String(second),'-i',path.resolve(process.argv[referenceIndex+1]! ),'-frames:v','1','-vf','scale=480:-2',file]);
      referenceImages.push('data:image/jpeg;base64,'+(await readFile(file)).toString('base64'));
    }
  }
  project=await post<CanvasStudioProject>('/api/canvas-animation-studio/generate',{
    brief:'Tạo video đúng 60 giây tên Quỷ Cẩu, truyện ma dân gian hoạt hình 2D phẳng dọc 9:16, khoảng 150-160 từ tiếng Việt. Nhân vật người có mặt tròn trắng, mắt và miệng đen, áo nâu hoặc xanh; chó đen rõ hình chó, tai nhọn, mõm dài, mắt đỏ. Kể chuyện hoàn chỉnh gồm 7 cảnh: 1 người áo nâu đi trên đường làng đêm trăng, giới thiệu lời đồn; 2 con chó đen trên đồi; 3 trăng máu, chó ngẩng đầu há hàm tru ba tiếng, có nét sóng âm; 4 người nghe tiếng tru, hoảng hốt, lỡ đáp lại; 5 người về cổng nhà, hai mắt đỏ và đầu chó xuất hiện sau cổng; 6 sáng ra cổng mở và dấu chân chó rõ ràng trên lối đi, hai dân làng chỉ dấu chân; 7 kết lời cảnh báo không đáp tiếng tru lúc nửa đêm. Cần hành động cụ thể đọc được, hình đơn giản đẹp và nhất quán. Xen cảnh toàn, trung và cận đúng câu chuyện. Cảnh chó tru phải tách chuyển động đầu và hàm, thân đứng yên. Cảnh ban ngày không còn trăng đêm. Cảnh cuối có hình kết mạnh. Phụ đề lớn dễ đọc phía trên, giọng người kể NamMinh. Không dùng ảnh AI hay stock video.',
    width:720,height:1280,targetDurationSeconds:60,visualMode:'code-vector',
    ...(retained?{project:retained.project||retained}:{}),
    ...(referenceImages.length?{referenceImages}:{}),
    refineVisuals:process.argv.includes('--refine'),
    provider:{id:'qa-router',name:'9Router',baseUrl:'http://127.0.0.1:20128/v1',enabled:true,models:[],providerType:'openai-compatible',authType:'bearer',apiKey:credential.key},
    model:'ag/gemini-3.8-flash-high',
    narration:{provider:{id:'edge-tts-local',name:'Edge TTS',baseUrl:'local://edge-tts',enabled:true,models:[],providerType:'edge-tts',authType:'none'},model:'edge-tts',voice:'vi-VN-NamMinhNeural',speed:1},
    audioProduction:{enabled:true,autoSound:false},
  });
  await writeFile(path.join(output,'project.json'),JSON.stringify(project,null,2));
  console.log(JSON.stringify({scenes:project.scenes.length,durationMs:project.scenes.reduce((sum,s)=>sum+s.durationMs,0),review:project.vectorReview}));
}
const cacheKey=process.argv.includes('--fresh-render')?createHash('sha256').update(`live-validation-${Date.now()}`).digest('hex'):undefined;
const job=await post<{id:string}>(`/api/canvas-animation-studio/projects/${project.id}/render-jobs`,{project,...(cacheKey?{cacheKey}:{})});
await writeFile(path.join(output,'render-job.json'),JSON.stringify(job,null,2));
console.log(`Live export job ${job.id}`);
for(let n=0;n<1200;n++){
  await new Promise(resolve=>setTimeout(resolve,1000));
  const res=await fetch(`http://127.0.0.1:8787/api/animation-studio/render-jobs/${job.id}`);if(!res.ok)throw new Error(`Status HTTP ${res.status}`);
  const status=await res.json();if(n%20===0)console.log(`${status.status} ${status.progress}%`);
  if(status.status==='failed')throw new Error(status.error);
  if(status.status!=='completed')continue;
  await writeFile(path.join(output,'live-export.json'),JSON.stringify(status,null,2));
  const video=path.join(output,'quy-cau-vector-60s.mp4');
  const downloaded=await fetch(`http://127.0.0.1:8787/api/animation-studio/render-jobs/${job.id}/video`);if(!downloaded.ok)throw new Error('Completed video download failed');
  await writeFile(video,Buffer.from(await downloaded.arrayBuffer()));
  await run('ffmpeg',['-v','error','-i',video,'-f','null','-']);
  await run('ffmpeg',['-y','-i',video,'-vf','fps=1/3,scale=270:480,tile=5x4:padding=5:margin=5','-frames:v','1',path.join(output,'overview.jpg')]);
  if(project.vectorReview)await copyFile(path.join(project.vectorReview.previewDirectory,'samples.json'),path.join(output,'samples.json'));
  console.log(JSON.stringify({video,size:status.result.size,reviewed:project.vectorReview?.pass,cached:status.cached}));process.exit(0);
}
throw new Error('Export still pending; job and project retained');
