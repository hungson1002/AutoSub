import {mkdir,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {lowerSttPriority, stopSttProcess} from './sttProcess';
import {availableParallelism} from 'node:os';
import path from 'node:path';
import type {AIModel,SubtitleSegment,SubtitleWord} from '../types';
import {ProviderError} from '../adapters/errors';
import {run,temporaryRoot,workdir} from './ffmpeg';
import {withWhisperQueue} from './whisperCpp';
import {allowedLocalSttModels} from './localSttPolicy';

const root=path.join(workdir,'qwen3-asr','runtime');
const runtimeVenvName='.venv-py312';
const runtimePythonVersion='3.12';
const bridge=path.join(process.cwd(),'server/services/qwen3_asr_bridge.py');

export const QWEN3_ASR_MODELS:AIModel[]=[
  {id:'qwen3-asr-0.6b',name:'Qwen3-ASR 0.6B · Mặc định · ForcedAligner',capabilities:{stt:true},raw:{engine:'qwen3-asr',detail:'中文/方言 + 52 ngôn ngữ · nhẹ hơn · timestamp tự động'}},
  {id:'qwen3-asr-1.7b',name:'Qwen3-ASR 1.7B · Quality · ForcedAligner',capabilities:{stt:true},raw:{engine:'qwen3-asr',detail:'Chất lượng cao · GPU khuyên dùng · timestamp tự động'}},
];

export const isQwen3AsrModel=(model:string)=>QWEN3_ASR_MODELS.some(item=>item.id===model);

export function qwen3AsrThreads(){
  const configured=Number(process.env.AUTOSUB_QWEN3_ASR_THREADS);
  const detected=Math.min(4,Math.max(1,Math.floor(availableParallelism()/2)));
  return Math.max(1,Math.min(16,Math.round(Number.isFinite(configured)&&configured>0?configured:detected)));
}

function parseProgress(line:string){
  const match=/QWEN3_ASR_PROGRESS\s+(\d{1,3})/i.exec(line);
  if(!match)return undefined;
  return Math.max(0,Math.min(100,Number(match[1])));
}

function execute(command:string,args:string[],signal?:AbortSignal,onProgress?:(n:number)=>void){
  return new Promise<void>((resolve,reject)=>{
    if(signal?.aborted){reject(new ProviderError('Đã hủy Qwen3-ASR.',499));return;}
    const child=spawn(command,args,{windowsHide:true,env:{
      ...process.env,
      PYTHONUTF8:'1',
      PYTHONIOENCODING:'utf-8',
      HF_HOME:path.join(root,'cache','huggingface'),
      OMP_NUM_THREADS:String(qwen3AsrThreads()),
      TOKENIZERS_PARALLELISM:'false',
    }});
    let stderr='',pending='';
    lowerSttPriority(child);
    const abort=()=>{void stopSttProcess(child);};
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout?.resume();
    child.stderr?.on('data',chunk=>{
      const value=chunk.toString();
      stderr=(stderr+value).slice(-16000);
      pending+=value;
      const lines=pending.split(/\r?\n/);
      pending=lines.pop()||'';
      for(const line of lines){
        const progress=parseProgress(line);
        if(progress!==undefined)onProgress?.(progress);
      }
    });
    const clean=()=>signal?.removeEventListener('abort',abort);
    child.once('error',error=>{clean();reject(error);});
    child.once('close',code=>{
      clean();
      if(signal?.aborted)reject(new ProviderError('Đã hủy Qwen3-ASR.',499));
      else if(code===0)resolve();
      else reject(new ProviderError('Qwen3-ASR xử lý thất bại.',503,stderr));
    });
  });
}

let runtimePromise:Promise<string>|undefined;

export function ensureQwen3AsrRuntime(signal?:AbortSignal):Promise<string>{
  if (!allowedLocalSttModels(QWEN3_ASR_MODELS).length) return Promise.reject(new ProviderError('Qwen3-ASR đã được tắt trên máy này; không tự cài lại runtime.', 400));
  if(!runtimePromise)runtimePromise=(async()=>{
    const configured=process.env.AUTOSUB_QWEN3_ASR_PYTHON?.trim();
    const executable=configured||path.join(root,runtimeVenvName,process.platform==='win32'?'Scripts/python.exe':'bin/python');
    if(await stat(executable).then(item=>item.isFile()).catch(()=>false)){
      try{await execute(executable,[bridge,'--check'],signal);return executable;}
      catch(error){if(signal?.aborted||configured)throw error;}
    }
    if(configured)throw new ProviderError('Python Qwen3-ASR được cấu hình không hợp lệ.',503);
    const candidates=[
      process.env.AUTOSUB_UV_PATH,
      'uv',
      process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe/uv.exe'),
    ].filter((item):item is string=>Boolean(item));
    let uv:string|undefined;
    for(const candidate of candidates){
      try{await execute(candidate,['--version'],signal);uv=candidate;break;}
      catch(error){if(signal?.aborted)throw error;}
    }
    if(!uv)throw new ProviderError('Cần uv để AutoSub tự cài Qwen3-ASR Local.',503);
    await mkdir(root,{recursive:true});
    if(!await stat(executable).catch(()=>undefined))await execute(uv,['venv','--python',runtimePythonVersion,path.join(root,runtimeVenvName)],signal);
    // Default runtime is CPU-safe on Windows. For NVIDIA/CUDA, point
    // AUTOSUB_QWEN3_ASR_PYTHON to a separate CUDA-enabled Python env.
    await execute(uv,['pip','install','--python',executable,'torch==2.8.0','torchaudio==2.8.0','--index-url','https://download.pytorch.org/whl/cpu'],signal);
    await execute(uv,['pip','install','--python',executable,'--index-url','https://pypi.org/simple','qwen-asr==0.0.6','soundfile'],signal);
    await execute(executable,[bridge,'--check'],signal);
    return executable;
  })().catch(error=>{runtimePromise=undefined;throw error;});
  return runtimePromise;
}

const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

export function parseQwen3AsrJson(value:unknown):{text:string;segments:SubtitleSegment[]}{
  if(!value||typeof value!=='object'||!Array.isArray((value as any).segments))throw new ProviderError('Qwen3-ASR trả kết quả không hợp lệ.',502);
  const segments:SubtitleSegment[]=(value as {segments:unknown[]}).segments.flatMap((raw,index)=>{
    if(!raw||typeof raw!=='object')return [];
    const item=raw as Record<string,unknown>;
    if(typeof item.text!=='string'||!item.text.trim()||!finite(item.start)||!finite(item.end)||item.start<0||item.end<=item.start)return [];
    const words:SubtitleWord[]=Array.isArray(item.words)?item.words.flatMap(rawWord=>{
      if(!rawWord||typeof rawWord!=='object')return [];
      const word=rawWord as Record<string,unknown>;
      const token=typeof word.word==='string'?word.word:typeof word.text==='string'?word.text:'';
      if(!token.trim()||!finite(word.start)||!finite(word.end)||word.start<0||word.end<=word.start)return [];
      return [{word:token,start:word.start,end:word.end}];
    }):[];
    return [{
      id:`qwen3-${index+1}`,
      start:item.start,
      end:item.end,
      text:item.text.trim(),
      ...(words.length?{words}:{}),
    }];
  });
  const explicitText=typeof (value as any).text==='string'?(value as any).text.trim():'';
  return {text:explicitText||segments.map(segment=>segment.text||'').join(''),segments};
}

function normalizeLanguage(language:string){
  const value=(language||'').trim().toLowerCase();
  if(!value||value==='auto')return 'auto';
  if(/^(zh|zh-cn|zh-tw|cmn)|chinese|mandarin|中文|普通话/.test(value))return 'Chinese';
  if(/^(yue|zh-hk)|cantonese|粤/.test(value))return 'Cantonese';
  if(/^(en)|english/.test(value))return 'English';
  if(/^(vi)|vietnamese|tiếng việt/.test(value))return 'Vietnamese';
  if(/^(ja)|japanese|日本/.test(value))return 'Japanese';
  if(/^(ko)|korean|한국/.test(value))return 'Korean';
  if(/^(fr)|french/.test(value))return 'French';
  if(/^(de)|german/.test(value))return 'German';
  if(/^(es)|spanish/.test(value))return 'Spanish';
  if(/^(pt)|portuguese/.test(value))return 'Portuguese';
  if(/^(ru)|russian/.test(value))return 'Russian';
  return 'auto';
}

export async function qwen3AsrRuntimeStatus(signal?:AbortSignal){
  const executable=await ensureQwen3AsrRuntime(signal);
  return {executable,threads:qwen3AsrThreads(),device:process.env.AUTOSUB_QWEN3_ASR_DEVICE?.trim()||'auto',python:runtimePythonVersion};
}

export async function transcribeWithQwen3Asr(modelId:string,audio:Buffer|string,filename:string,language:string,signal?:AbortSignal,onProgress?:(n:number)=>void){
  if(!isQwen3AsrModel(modelId))throw new ProviderError('Model Qwen3-ASR không hợp lệ.',400);
  return withWhisperQueue(async()=>{
    onProgress?.(0);
    const executable=await ensureQwen3AsrRuntime(signal);
    const folder=path.join(temporaryRoot,'qwen3-asr');
    await mkdir(folder,{recursive:true});
    const dir=await mkdtemp(path.join(folder,'job-'));
    try{
      const source=typeof audio==='string'?audio:path.join(dir,'source'+(path.extname(filename)||'.bin'));
      if(Buffer.isBuffer(audio))await writeFile(source,audio);
      const input=path.join(dir,'input.wav');
      await run('ffmpeg',['-y','-i',source,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',input],signal);
      const output=path.join(dir,'result.json');
      await execute(executable,[
        bridge,
        '--audio',input,
        '--output',output,
        '--model',modelId,
        '--language',normalizeLanguage(language),
        '--threads',String(qwen3AsrThreads()),
        '--device',process.env.AUTOSUB_QWEN3_ASR_DEVICE?.trim()||'auto',
      ],signal,onProgress);
      return parseQwen3AsrJson(JSON.parse(await readFile(output,'utf8')));
    }finally{
      await rm(dir,{recursive:true,force:true});
    }
  },signal);
}
