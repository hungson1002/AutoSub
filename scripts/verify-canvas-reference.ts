import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateCanvasAnimationVideo } from '../server/services/canvasAnimationDirector';
import { renderCanvasAnimationProject, validateAnimationOutput } from '../server/services/animationRender';
import { run, workdir } from '../server/services/ffmpeg';
import type { AIProvider } from '../server/types';
const dir=path.join(workdir,'reference-match-v1'); await mkdir(dir,{recursive:true});
const state=async(stage:string,extra:object={})=>{await writeFile(path.join(dir,'state.json'),JSON.stringify({stage,updatedAt:new Date().toISOString(),...extra},null,2));console.log(stage);};
const provider:AIProvider={id:'qa-router',name:'9Router QA',baseUrl:'http://127.0.0.1:20128/v1',enabled:true,models:[],providerType:'openai-compatible',authType:'none',capabilities:{translation:true}};
const narrationProvider:AIProvider={id:'edge-tts-local',name:'Edge TTS',baseUrl:'local://edge-tts',enabled:true,models:[],providerType:'edge-tts',authType:'none',capabilities:{tts:true}};
try {
 let project;
 try {project=JSON.parse(await readFile(path.join(dir,'project.json'),'utf8'));console.log('Reuse completed project');}
 catch {
 await state('generating');
 project=await generateCanvasAnimationVideo({provider,model:'ag/gemini-3.8-flash-high',targetDurationSeconds:30,visualMode:'ai-fallback',assetGeneration:{enabled:true,quality:'professional',generator:'flow-agent',model:'narwhal'},narration:{provider:narrationProvider,model:'edge-tts',voice:'vi-VN-NamMinhNeural',speed:1},
 brief:'Tạo phim hoạt hình lịch sử Bạch Đằng dài 30 giây, tiếng Việt. Phong cách chibi 2D đầu lớn thân ngắn, nét mực đậm hữu cơ, màu phẳng trầm đất, vui nhộn giống phim giải thích lịch sử. Người dẫn chuyện áo cam búi tóc cầm quạt; tướng râu đen giáp đen vàng áo choàng đỏ; thủy binh giản dị. Nhân vật lớn dễ đọc, chuyển động miệng tay mắt thực sự, không đứng lơ lửng giữa sông. Kể theo chuỗi: người dẫn đặt câu hỏi; tướng chỉ vào kế hoạch trên bờ; cọc gỗ được giấu dưới nước; thuyền tiến vào khi nước cao; thủy triều rút lộ cọc; thuyền va cọc nghiêng và bắn nước; binh sĩ phản ứng; kết với kế sách tận dụng con nước. Mỗi cảnh ngắn 2-4 giây, bố cục thay đổi, cảnh va chạm có nhiều lớp chuyển động. Một bản đồ ngắn, ít chữ; không dùng thẻ chữ thay cho hành động. Nội dung mô phỏng minh họa trận Bạch Đằng, không đặt câu thoại hư cấu vào lời trích dẫn lịch sử.'});
 await writeFile(path.join(dir,'project.json'),JSON.stringify(project,null,2));
 }
 await state('rendering',{projectId:project.id});
 const result=await renderCanvasAnimationProject(project);
 const metadata=await validateAnimationOutput(result.path);
 const sheet=path.join(dir,'contact.png');
 await run('ffmpeg',['-y','-i',result.path,'-vf','fps=1/2,scale=384:216,tile=4x4','-frames:v','1',sheet]);
 await state('completed',{result,metadata,sheet});
} catch(e) {await state('failed',{error:e instanceof Error?e.stack:String(e)});process.exitCode=1;}
