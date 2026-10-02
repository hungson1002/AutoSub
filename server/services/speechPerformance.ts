import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SpeechPart } from '../../shared/speech';
import { run, temporaryRoot } from './ffmpeg';

export async function renderSpeechPerformance(parts:SpeechPart[],generate:(text:string)=>Promise<Buffer>,signal?:AbortSignal,format='wav') {
  if(parts.length===1&&'text' in parts[0]!)return generate(parts[0].text);
  const codecs:Record<string,string>={wav:'pcm_s16le',mp3:'libmp3lame',flac:'flac',opus:'libopus'};
  if(!Object.hasOwn(codecs,format))throw new Error('Đọc có khoảng nghỉ hỗ trợ WAV, MP3, FLAC hoặc Opus.');
  await mkdir(temporaryRoot,{recursive:true});
  const directory=await mkdtemp(path.join(temporaryRoot,'speech-performance-'));
  try {
    const args=['-y','-nostdin','-v','error','-threads','1'],filters:string[]=[],labels:string[]=[];
    let inputIndex=0;
    for(const [index,part] of parts.entries()) {
      signal?.throwIfAborted();
      const label=`part${index}`;labels.push(`[${label}]`);
      if('pauseMs' in part)filters.push(`anullsrc=r=48000:cl=stereo:d=${part.pauseMs/1000}[${label}]`);
      else {
        const file=path.join(directory,`${inputIndex}.audio`);
        await writeFile(file,await generate(part.text));
        args.push('-i',file);
        filters.push(`[${inputIndex++}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[${label}]`);
      }
    }
    filters.push(`${labels.join('')}concat=n=${parts.length}:v=0:a=1[out]`);
    const output=path.join(directory,`performance.${format}`);
    const timeout=AbortSignal.timeout(120000);
    await run('ffmpeg',[...args,'-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map','[out]','-c:a',codecs[format]!,output],signal?AbortSignal.any([signal,timeout]):timeout);
    return await readFile(output);
  } finally {await rm(directory,{recursive:true,force:true});}
}
