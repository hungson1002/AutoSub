import {mkdir,mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {lowerSttPriority, stopSttProcess} from './sttProcess';
import {availableParallelism} from 'node:os';
import path from 'node:path';
import type {AIModel,SubtitleSegment,SubtitleWord} from '../types';
import {ProviderError} from '../adapters/errors';
import {run,temporaryRoot,workdir} from './ffmpeg';
import {withWhisperQueue} from './whisperCpp';
import {allowedLocalSttModels} from './localSttPolicy';

const root=path.join(workdir,'funasr','runtime');
// FunASR 1.4.16 currently resolves transformers 4.12.2 -> tokenizers 0.10.3.
// On Windows that tokenizers release has no CPython 3.12 wheel and uv falls
// back to a Rust build. Keep FunASR in its own Python 3.9 runtime where the
// official binary wheel exists. Version the venv path so older broken 3.12
// installs are simply ignored instead of destructively rewritten.
const runtimeVenvName='.venv-py39';
const runtimePythonVersion='3.9';
const bridge=path.join(process.cwd(),'server/services/funasr_bridge.py');

export const FUNASR_MODELS: AIModel[]=[
  {id:'funasr-paraformer-zh',name:'FunASR Paraformer-zh · 中文推荐 · VAD + 标点 + 时间戳',capabilities:{stt:true},raw:{engine:'funasr',detail:'Mandarin · CPU/GPU · 220M · model tải lần đầu'}},
  {id:'funasr-sensevoice-small',name:'FunASR SenseVoiceSmall · 中文快速 · 234M',capabilities:{stt:true},raw:{engine:'funasr',detail:'中文/粤语/英/日/韩 · CPU/GPU · model tải lần đầu'}},
  {id:'funasr-nano-2512',name:'Fun-ASR-Nano-2512 · 中文高质量 · GPU khuyên dùng',capabilities:{stt:true},raw:{engine:'funasr',detail:'中文/方言/口音 · 800M · GPU khuyên dùng'}},
];

export const isFunAsrModel=(model:string)=>FUNASR_MODELS.some(item=>item.id===model);

export function funAsrThreads(){
  const configured=Number(process.env.AUTOSUB_FUNASR_THREADS);
  const detected=Math.min(4,Math.max(1,Math.floor(availableParallelism()/2)));
  return Math.max(1,Math.min(16,Math.round(Number.isFinite(configured)&&configured>0?configured:detected)));
}

function parseProgress(line:string){
  const match=/FUNASR_PROGRESS\s+(\d{1,3})/i.exec(line);
  if(!match)return undefined;
  return Math.max(0,Math.min(100,Number(match[1])));
}

function execute(command:string,args:string[],signal?:AbortSignal,onProgress?:(n:number)=>void){
  return new Promise<void>((resolve,reject)=>{
    if(signal?.aborted){reject(new ProviderError('Đã hủy FunASR.',499));return;}
    const child=spawn(command,args,{windowsHide:true,env:{
      ...process.env,
      PYTHONUTF8:'1',
      PYTHONIOENCODING:'utf-8',
      HF_HOME:path.join(root,'cache','huggingface'),
      MODELSCOPE_CACHE:path.join(root,'cache','modelscope'),
      OMP_NUM_THREADS:String(funAsrThreads()),
    }});
    let stderr='',pending='';
    lowerSttPriority(child);
    const abort=()=>{void stopSttProcess(child);};
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout?.resume();
    child.stderr?.on('data',chunk=>{
      const value=chunk.toString();
      stderr=(stderr+value).slice(-12000);
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
      if(signal?.aborted)reject(new ProviderError('Đã hủy FunASR.',499));
      else if(code===0)resolve();
      else reject(new ProviderError('FunASR xử lý thất bại.',503,stderr));
    });
  });
}

let runtimePromise:Promise<string>|undefined;

export function ensureFunAsrRuntime(signal?:AbortSignal):Promise<string>{
  if (!allowedLocalSttModels(FUNASR_MODELS).length) return Promise.reject(new ProviderError('FunASR đã được tắt trên máy này; không tự cài lại runtime.', 400));
  if(!runtimePromise)runtimePromise=(async()=>{
    const configured=process.env.AUTOSUB_FUNASR_PYTHON?.trim();
    const executable=configured||path.join(root,runtimeVenvName,process.platform==='win32'?'Scripts/python.exe':'bin/python');
    if(await stat(executable).then(item=>item.isFile()).catch(()=>false)){
      try{await execute(executable,[bridge,'--check'],signal);return executable;}
      catch(error){if(signal?.aborted||configured)throw error;}
    }
    if(configured)throw new ProviderError('Python FunASR được cấu hình không hợp lệ.',503);
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
    if(!uv)throw new ProviderError('Cần uv để AutoSub tự cài FunASR Local.',503);
    await mkdir(root,{recursive:true});
    if(!await stat(executable).catch(()=>undefined))await execute(uv,['venv','--python',runtimePythonVersion,path.join(root,runtimeVenvName)],signal);
    // Runtime mặc định ưu tiên tính tương thích trên Windows/CPU. Có thể trỏ
    // AUTOSUB_FUNASR_PYTHON tới môi trường PyTorch CUDA riêng để dùng GPU.
    await execute(uv,['pip','install','--python',executable,'torch==2.8.0','torchaudio==2.8.0','--index-url','https://download.pytorch.org/whl/cpu'],signal);
    // Pin the public index so machine-level uv mirror settings cannot silently
    // supply different dependency metadata for this legacy-compatible stack.
    await execute(uv,['pip','install','--python',executable,'--index-url','https://pypi.org/simple','funasr==1.4.16','modelscope','huggingface_hub','soundfile'],signal);
    // FunASR 1.4.16 declares the legacy transformers 4.12.2 stack, but
    // Fun-ASR-Nano-2512 embeds Qwen3 and requires the modern Qwen3 tokenizer.
    // 4.51.0 keeps Python 3.9/Windows wheels while remaining compatible with
    // Paraformer and SenseVoice code paths used by this bridge.
    await execute(uv,['pip','install','--python',executable,'--index-url','https://pypi.org/simple','transformers==4.51.0'],signal);
    await execute(executable,[bridge,'--check'],signal);
    return executable;
  })().catch(error=>{runtimePromise=undefined;throw error;});
  return runtimePromise;
}

const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

export function parseFunAsrJson(value:unknown):{text:string;segments:SubtitleSegment[]}{
  if(!value||typeof value!=='object'||!Array.isArray((value as any).segments))throw new ProviderError('FunASR trả kết quả không hợp lệ.',502);
  const segments:SubtitleSegment[]=(value as {segments:unknown[]}).segments.flatMap((raw,index)=>{
    if(!raw||typeof raw!=='object')return [];
    const item=raw as Record<string,unknown>;
    if(typeof item.text!=='string'||!item.text.trim()||!finite(item.start)||!finite(item.end)||item.start<0||item.end<=item.start)return [];
    const words:SubtitleWord[]=Array.isArray(item.words)?item.words.flatMap(rawWord=>{
      if(!rawWord||typeof rawWord!=='object')return [];
      const word=rawWord as Record<string,unknown>;
      const token=typeof word.word==='string'?word.word:typeof word.text==='string'?word.text:'';
      if(!token.trim()||!finite(word.start)||!finite(word.end)||word.start<0||word.end<=word.start)return [];
      return [{word:token,start:word.start,end:word.end,...(finite(word.confidence)?{confidence:word.confidence}:{})}];
    }):[];
    const speaker=typeof item.speaker_id==='string'?item.speaker_id:typeof item.speakerId==='string'?item.speakerId:undefined;
    return [{
      id:`funasr-${index+1}`,
      start:item.start,
      end:item.end,
      text:item.text.trim(),
      ...(words.length?{words}:{}),
      ...(speaker?{speaker_id:speaker}:{}),
    }];
  });
  const explicitText=typeof (value as any).text==='string'?(value as any).text.trim():'';
  return {text:explicitText||segments.map(segment=>segment.text||'').join(''),segments};
}

function normalizeLanguage(language:string){
  const value=(language||'').trim().toLowerCase();
  if(!value||value==='auto')return 'auto';
  if(/^(zh|zh-cn|zh-tw|cmn)|chinese|mandarin|中文|普通话/.test(value))return 'zh';
  if(/^(yue|zh-hk)|cantonese|粤/.test(value))return 'yue';
  if(/^(en)|english/.test(value))return 'en';
  if(/^(ja)|japanese|日本/.test(value))return 'ja';
  if(/^(ko)|korean|한국/.test(value))return 'ko';
  return 'auto';
}

export async function funAsrRuntimeStatus(signal?:AbortSignal){
  const executable=await ensureFunAsrRuntime(signal);
  return {executable,threads:funAsrThreads(),device:process.env.AUTOSUB_FUNASR_DEVICE?.trim()||'auto',python:runtimePythonVersion};
}

export async function transcribeWithFunAsr(modelId:string,audio:Buffer|string,filename:string,language:string,signal?:AbortSignal,onProgress?:(n:number)=>void){
  if(!isFunAsrModel(modelId))throw new ProviderError('Model FunASR không hợp lệ.',400);
  return withWhisperQueue(async()=>{
    onProgress?.(0);
    const executable=await ensureFunAsrRuntime(signal);
    const folder=path.join(temporaryRoot,'funasr');
    await mkdir(folder,{recursive:true});
    const dir=await mkdtemp(path.join(folder,'job-'));
    try{
      const source=typeof audio==='string'?audio:path.join(dir,'source'+(path.extname(filename)||'.bin'));
      if(Buffer.isBuffer(audio)){
        const {writeFile}=await import('node:fs/promises');
        await writeFile(source,audio);
      }
      const input=path.join(dir,'input.wav');
      await run('ffmpeg',['-y','-i',source,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',input],signal);
      const output=path.join(dir,'result.json');
      await execute(executable,[
        bridge,
        '--audio',input,
        '--output',output,
        '--model',modelId,
        '--language',normalizeLanguage(language),
        '--threads',String(funAsrThreads()),
        '--device',process.env.AUTOSUB_FUNASR_DEVICE?.trim()||'auto',
      ],signal,onProgress);
      return parseFunAsrJson(JSON.parse(await readFile(output,'utf8')));
    }finally{
      await rm(dir,{recursive:true,force:true});
    }
  },signal);
}
