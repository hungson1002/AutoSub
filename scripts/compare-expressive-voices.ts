import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../server/services/ffmpeg';
import type { AIProvider } from '../server/types';

// Uses the installed CPU/ONNX engine. Keep every completed take when interrupted.
process.env.AUTOSUB_VIENEU_WORKERS='1';
process.env.AUTOSUB_VIENEU_IDLE_TIMEOUT_MS='60000';
const { synthesize }=await import('../server/adapters');
const directory=path.resolve('tmp/voice-performance');
await mkdir(directory,{recursive:true});
const provider:AIProvider={id:'vieneu-local',name:'VieNeu Local',baseUrl:'local://vieneu',providerType:'vieneu-local',authType:'none',enabled:true,models:[],capabilities:{tts:true}};
const script='Đêm ấy, tôi nghe tiếng gõ dưới sàn.\n\nTôi nín thở… [pause 500ms] Ai đang ở đó?';
const takes=[
  {file:'anh-khoi-story.wav',voice:'preset:anh-khoi',text:script},
  {file:'ngoc-linh-story.wav',voice:'preset:ngoc-linh',text:script},
  {file:'ngoc-huyen-dialogue.wav',voice:'preset:ngoc-huyen',text:'Cháu ơi, đừng nhìn xuống… [pause 350ms] Nhớ lời cô dặn nhé!'},
];
for(const take of takes) {
  const file=path.join(directory,take.file);
  const existing=await readFile(file).catch(()=>undefined);
  const started=performance.now();
  if(!existing)await writeFile(file,await synthesize(provider,'vieneu-v3-turbo',take.voice,take.text,{speed:1,format:'wav',signal:AbortSignal.timeout(180000)}));
  const probe=await run('ffprobe',['-v','error','-show_entries','format=duration:stream=sample_rate,channels','-of','json',file]);
  await run('ffmpeg',['-v','error','-i',file,'-f','null','-']);
  const report={voice:take.voice,text:take.text,reused:!!existing,elapsedMs:Math.round(performance.now()-started),probe:JSON.parse(probe.stdout)};
  await writeFile(file+'.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({file:take.file,elapsedMs:report.elapsedMs,reused:report.reused}));
}
console.log(`Completed: ${directory}`);
// The CLI owns its worker; the runtime's exit hook releases it after all files are saved.
process.exit(0);
