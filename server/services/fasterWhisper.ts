import {mkdir,mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {lowerSttPriority, stopSttProcess} from './sttProcess';
import {availableParallelism} from 'node:os';
import path from 'node:path';
import type {AIModel,SubtitleSegment,SubtitleWord} from '../types';
import {ProviderError} from '../adapters/errors';
import {run,temporaryRoot,workdir} from './ffmpeg';
import {normalizeLanguage,parseWhisperProgress,withWhisperQueue} from './whisperCpp';

const root=path.join(workdir,'whisper','faster-runtime');
const bridge=path.join(process.cwd(),'server/services/faster_whisper_bridge.py');
export const FASTER_WHISPER_MODELS: AIModel[]=[
  {id:'faster-small-int8',name:'Faster Whisper Small INT8 · timestamp từng từ · khuyên dùng',capabilities:{stt:true},raw:{engine:'faster-whisper',detail:'CPU · VAD + stable-ts · tự tải lần đầu'}},
  {id:'faster-medium-int8',name:'Faster Whisper Medium INT8 · chính xác hơn · chậm hơn',capabilities:{stt:true},raw:{engine:'faster-whisper',detail:'CPU · cần nhiều RAM hơn Small'}},
];
export const isFasterWhisperModel=(model:string)=>FASTER_WHISPER_MODELS.some(m=>m.id===model);
export function fasterWhisperThreads(){
  const n=Number(process.env.AUTOSUB_WHISPER_THREADS)||Math.min(4,Math.max(1,Math.floor(availableParallelism()/2)));
  return Math.max(1,Math.min(4,Math.round(n)));
}
function execute(command:string,args:string[],signal?:AbortSignal,onProgress?:(n:number)=>void){
  return new Promise<void>((resolve,reject)=>{
    if(signal?.aborted){reject(new ProviderError('Đã hủy STT.',499));return;}
    const child=spawn(command,args,{windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HOME:path.join(root,'cache'),OMP_NUM_THREADS:String(fasterWhisperThreads()),HF_HUB_DISABLE_SYMLINKS_WARNING:'1'}});
    let stderr='',pending='';
    lowerSttPriority(child);
    const abort=()=>{void stopSttProcess(child);};signal?.addEventListener('abort',abort,{once:true});
    child.stdout?.resume();
    child.stderr?.on('data',chunk=>{
      const text=chunk.toString();stderr=(stderr+text).slice(-8000);pending+=text;
      const lines=pending.split(/\r?\n/);pending=lines.pop()||'';
      for(const line of lines){const n=parseWhisperProgress(line);if(n!==undefined)onProgress?.(n);}
    });
    const clean=()=>signal?.removeEventListener('abort',abort);
    child.once('error',error=>{clean();reject(error);});
    child.once('close',code=>{clean();if(signal?.aborted)reject(new ProviderError('Đã hủy STT.',499));else if(code===0)resolve();else reject(new ProviderError('Faster Whisper xử lý thất bại.',503,stderr));});
  });
}
let runtimePromise:Promise<string>|undefined;
export function ensureFasterWhisperRuntime(signal?:AbortSignal):Promise<string>{
  if(!runtimePromise)runtimePromise=(async()=>{
    const executable=process.env.AUTOSUB_FASTER_WHISPER_PYTHON?.trim()||path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
    if(await stat(executable).then(x=>x.isFile()).catch(()=>false)){
      try{await execute(executable,[bridge,'--check'],signal);return executable;}catch(error){if(signal?.aborted||process.env.AUTOSUB_FASTER_WHISPER_PYTHON)throw error;}
    }
    if(process.env.AUTOSUB_FASTER_WHISPER_PYTHON)throw new ProviderError('Python Faster Whisper được cấu hình không hợp lệ.',503);
    const candidates=[process.env.AUTOSUB_UV_PATH,'uv',process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe/uv.exe')].filter((x):x is string=>!!x);
    let uv:string|undefined;
    for(const candidate of candidates){try{await execute(candidate,['--version'],signal);uv=candidate;break;}catch(error){if(signal?.aborted)throw error;}}
    if(!uv)throw new ProviderError('Cần uv để cài Faster Whisper. Có thể dùng model Whisper Q5 hiện có.',503);
    await mkdir(root,{recursive:true});
    if(!await stat(executable).catch(()=>undefined))await execute(uv,['venv','--python','3.12',path.join(root,'.venv')],signal);
    // CPU wheels avoid installing CUDA dependencies on low-end computers.
    await execute(uv,['pip','install','--python',executable,'torch==2.8.0','torchaudio==2.8.0','--index-url','https://download.pytorch.org/whl/cpu'],signal);
    await execute(uv,['pip','install','--python',executable,'faster-whisper==1.2.1','stable-ts==2.19.1','av==16.1.0'],signal);
    await execute(executable,[bridge,'--check'],signal);return executable;
  })().catch(error=>{runtimePromise=undefined;throw error;});
  return runtimePromise;
}
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
export function parseFasterWhisperJson(value:unknown):{text:string;segments:SubtitleSegment[]}{
  if(!value||typeof value!=='object'||!Array.isArray((value as any).segments))throw new ProviderError('Faster Whisper trả kết quả không hợp lệ.',502);
  const segments:SubtitleSegment[]=(value as {segments:unknown[]}).segments.flatMap((raw,index)=>{
    if(!raw||typeof raw!=='object')return [];
    const item=raw as Record<string,unknown>;
    if(typeof item.text!=='string'||!item.text.trim()||!finite(item.start)||!finite(item.end)||item.start<0||item.end<=item.start)return [];
    const words:SubtitleWord[]=Array.isArray(item.words)?item.words.flatMap(w=>{
      if(!w||typeof w.word!=='string'||!finite(w.start)||!finite(w.end)||w.start<0||w.end<=w.start)return [];
      return [{word:w.word,start:w.start,end:w.end,...(finite(w.probability)?{probability:w.probability}:{})}];
    }):[];
    return [{id:`faster-${index+1}`,start:item.start,end:item.end,text:item.text.trim(),...(words.length?{words}:{}),
      ...(finite(item.avg_logprob)?{avg_logprob:item.avg_logprob}:{}),...(finite(item.no_speech_prob)?{no_speech_prob:item.no_speech_prob}:{}),...(finite(item.compression_ratio)?{compression_ratio:item.compression_ratio}:{})}];
  });
  return {text:segments.map(s=>s.text).join(' '),segments};
}
export async function transcribeWithFasterWhisper(modelId:string,audio:Buffer|string,filename:string,language:string,signal?:AbortSignal,onProgress?:(n:number)=>void){
  if(!isFasterWhisperModel(modelId))throw new ProviderError('Model Faster Whisper không hợp lệ.',400);
  return withWhisperQueue(async()=>{
    onProgress?.(0);const executable=await ensureFasterWhisperRuntime(signal);
    const folder=path.join(temporaryRoot,'whisper');await mkdir(folder,{recursive:true});const dir=await mkdtemp(path.join(folder,'faster-'));
    try{
      const source=typeof audio==='string'?audio:path.join(dir,'source'+(path.extname(filename)||'.bin'));
      if(Buffer.isBuffer(audio)){const {writeFile}=await import('node:fs/promises');await writeFile(source,audio);}
      const input=path.join(dir,'input.wav');await run('ffmpeg',['-y','-i',source,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',input],signal);
      const output=path.join(dir,'result.json');
      await execute(executable,[bridge,'--audio',input,'--output',output,'--model',modelId==='faster-medium-int8'?'medium':'small','--language',normalizeLanguage(language),'--threads',String(fasterWhisperThreads()),'--cache',path.join(root,'models')],signal,onProgress);
      return parseFasterWhisperJson(JSON.parse(await readFile(output,'utf8')));
    }finally{await rm(dir,{recursive:true,force:true});}
  },signal);
}
