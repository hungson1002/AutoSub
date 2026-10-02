import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { CanvasStudioProject, CanvasStudioScene, CanvasDialogueLine } from '../../shared/canvasAnimationStudio';
import { defaultTransform, type AnimationProject } from '../../shared/animationStudio';
import { canvasSpeakerKey, isCanvasDialogueSpeaker } from '../../shared/canvasDialogue';
import { normalizeCanvasSoundCues, planCanvasSoundCues } from '../../shared/canvasSoundDesign';
import { synthesizeCanvasFoley } from './canvasFoley';
import { resolveCanvasSpeech } from '../../shared/canvasSpeech';
import { canvasSpeechActivity, canvasSpeechEnvelope } from './canvasSpeechActivity';
import { synchronizeCanvasPerformance } from '../../shared/canvasPerformance';
import { generateAnimationNarration, findCachedAnimationAsset, getAnimationAssetFile, registerAnimationAsset } from './animationAssets';
import { listVoices } from '../adapters';
import type { AIProvider, AIVoice } from '../types';
import { run, workdir } from './ffmpeg';

export type CanvasAudioInput={project:CanvasStudioProject; narration:{provider:AIProvider;model:string;voice:string;speed?:number};autoSound?:boolean};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function selectCanvasRoleVoice(line:CanvasDialogueLine,project:CanvasStudioProject,voices:AIVoice[],fallback:string) {
  const key=canvasSpeakerKey(line);
  const explicit=project.castVoices&&Object.hasOwn(project.castVoices,key)?project.castVoices[key]:line.voice;
  if(explicit)return explicit;
  if(/^(người kể|người dẫn chuyện|narrator)$/iu.test(line.speaker.trim()))return fallback;
  const person=project.scenes.flatMap(scene=>scene.objects).find(object=>isCanvasDialogueSpeaker(object,line));
  const female=person?.voiceGender==='female'||(!person?.voiceGender&&/\bwoman\b|\bfemale\b|(?:^|\s)(?:bà|cô|mẹ|nữ)(?:\s|$)/iu.test(`${line.speaker} ${person?.designNotes||''}`));
  const male=person?.voiceGender==='male'||(!female&&(/\bmale\b|\bman\b|(?:^|\s)(?:minh|ông|anh|nam|bác duy)(?:\s|$)/iu.test(`${line.speaker} ${person?.designNotes||''}`)));
  if(!female&&!male)return fallback;
  const choices=voices.filter(voice=>!voice.language||/^vi\b|vi-/i.test(voice.language));
  const matches=choices.filter(voice=>female ? /nữ|female|hoài my|hoaimy/iu.test(`${voice.name} ${voice.description} ${voice.id}`)
    : /\bnam\b|\bmale\b|namminh/iu.test(`${voice.name} ${voice.description} ${voice.id}`));
  const used=new Set(Object.values(project.castVoices||{}));
  return matches.find(v=>!used.has(v.id))?.id||matches[0]?.id||fallback;
}

function deliveryFor(line:CanvasDialogueLine,input:CanvasAudioInput){return resolveCanvasSpeech(line,input.narration.speed??1,input.narration.provider.providerType==='vieneu-local');}
function speechKey(line:CanvasDialogueLine,input:CanvasAudioInput,voice:string){
  const delivery=deliveryFor(line,input);
  const legacy=digest({text:delivery.text,voice,provider:input.narration.provider.id,model:input.narration.model,speed:delivery.speed,prosody:'natural-pauses-v1'});
  if(line.audioKey===legacy)return legacy;
  return digest({text:delivery.text,voice,provider:input.narration.provider.id,endpoint:input.narration.provider.baseUrl,model:input.narration.model,speed:delivery.speed,prosody:'natural-pauses-v2'});
}

/** Small bounded queue: remote speech can overlap, local models remain serial. */
export async function canvasAudioQueue(tasks:Array<()=>Promise<void>>,concurrency:number){
  let cursor=0;
  let failure:unknown;
  await Promise.all(Array.from({length:Math.min(tasks.length,Math.max(1,concurrency))},async()=>{
    while(cursor<tasks.length&&!failure){const task=tasks[cursor++]!;try{await task();}catch(error){failure=error;}}
  }));
  if(failure)throw failure;
}

async function localAudioFile(url:string) {
  const id=url.match(/^\/api\/animation-studio\/assets\/([a-f0-9-]{36})\/file$/i)?.[1];
  if(!id)throw new Error('Âm thanh phải là asset trong thư viện AutoSub.');
  return (await getAnimationAssetFile(id)).path;
}

async function speech(scene:CanvasStudioScene,text:string,input:CanvasAudioInput,voice:string,speed=input.narration.speed) {
  const source:AnimationProject={schemaVersion:1,id:input.project.id,name:input.project.name,width:input.project.width,height:input.project.height,fps:input.project.fps,
    createdAt:'',updatedAt:'',assets:[],scenes:[{id:scene.id,name:scene.name,order:0,durationMs:scene.durationMs,narration:text,
      renderMode:'composite',backgroundColor:'#000000',layers:[],commands:[],camera:{transform:defaultTransform(),commands:[]}}]};
  const voiced=await generateAnimationNarration({project:source,...input.narration,voice,speed,preservePlannedDuration:false,includeSubtitles:false,preserveSpeechPauses:true});
  const first=voiced.scenes[0]!;
  if(first.renderMode!=='composite')throw new Error('TTS không trả về cảnh audio.');
  const asset=voiced.assets.find(a=>a.id===first.layers.find(layer=>layer.type==='audio'&&layer.assetId)?.assetId);
  if(!asset)throw new Error('TTS chưa tạo được audio.');
  return {url:asset.uri,durationMs:first.durationMs};
}

type Track={url?:string;file?:string;atMs:number;durationMs:number;volume:number;pan?:number;distant?:boolean;duck?:boolean};
export function canvasAudioFilter(tracks:Track[],speechWindows:Array<{startMs:number;endMs:number}>,durationMs:number) {
  const filters=tracks.map((track,index)=>{
    const pan=Math.max(-1,Math.min(1,track.pan||0));
    const l=Math.sqrt((1-pan)/2),r=Math.sqrt((1+pan)/2);
    const duck=track.duck&&speechWindows.length?`,volume='if(${speechWindows.map(w=>`between(t,${w.startMs/1000},${w.endMs/1000})`).join('+')},0.38,1)':eval=frame`:'';
    return `[${index}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${track.durationMs/1000},asetpts=PTS-STARTPTS`
      +(track.distant?',highpass=f=180,lowpass=f=2800,aecho=0.8:0.7:95|175:0.13|0.08':'')
      +`,volume=${track.volume},pan=stereo|c0=${l}*c0|c1=${r}*c1,adelay=${Math.round(track.atMs)}|${Math.round(track.atMs)}`+duck+`[track${index}]`;
  });
  filters.push(`${tracks.map((_,index)=>`[track${index}]`).join('')}amix=inputs=${tracks.length}:normalize=0:dropout_transition=0,alimiter=limit=0.94:level=0:latency=1,apad=whole_dur=${durationMs/1000},atrim=duration=${durationMs/1000}[mix]`);
  return filters.join(';');
}

const pending=new Map<string,Promise<CanvasStudioProject>>();
export function prepareCanvasProjectAudio(input:CanvasAudioInput) {
  const key=digest({project:input.project,narration:{...input.narration,provider:{id:input.narration?.provider?.id}},autoSound:input.autoSound});
  const existing=pending.get(key);if(existing)return existing;
  const task=prepare(input).finally(()=>pending.delete(key));pending.set(key,task);return task;
}

async function prepare(input:CanvasAudioInput):Promise<CanvasStudioProject> {
  if(!input.project?.scenes?.length||input.project.scenes.length>100)throw new Error('Project cần từ 1 đến 100 cảnh.');
  if(!input.narration?.provider?.baseUrl||!input.narration.voice)throw new Error('Chưa chọn TTS và giọng kể.');
  const project=structuredClone(input.project);
  project.castVoices=Object.assign(Object.create(null) as Record<string,string>,project.castVoices);
  const voices=await listVoices(input.narration.provider);
  // Resolve the entire cast in script order BEFORE parallelizing any speech.
  const tasks:Array<()=>Promise<void>>=[];
  const clips=new Map<string,Promise<{url:string;durationMs:number}>>();
  for(const scene of project.scenes){
    if(!Number.isFinite(scene.durationMs)||scene.durationMs<100||scene.durationMs>300000)throw new Error('Thời lượng cảnh audio không hợp lệ.');
    if(scene.dialogue&& (scene.dialogue.length>24||scene.dialogue.some(l=>typeof l.text!=='string'||l.text.length>3000)))throw new Error('Lời thoại vượt giới hạn của cảnh.');
  }
  for(const scene of project.scenes)for(const line of scene.dialogue||[]){
    if(!line.text?.trim())continue;
    const voice=selectCanvasRoleVoice(line,project,voices,input.narration.voice);
    if(voices.length&&!voices.some(v=>v.id===voice))throw new Error(`Giọng của ${line.speaker} không có trong TTS đang chọn.`);
    project.castVoices[canvasSpeakerKey(line)]=voice;
    const key=speechKey(line,input,voice);
    if(line.audioUrl&&line.audioKey===key&&line.durationMs)continue;
    tasks.push(async()=>{
      let clip=clips.get(key);
      if(!clip){const delivery=deliveryFor(line,input);clip=speech(scene,delivery.text,input,voice,delivery.speed);clips.set(key,clip);}
      const result=await clip;
      line.audioUrl=result.url;line.durationMs=result.durationMs;line.audioKey=key;line.speechWindows=undefined;line.speechEnvelope=undefined;
    });
  }
  await canvasAudioQueue(tasks,input.narration.provider.providerType==='edge-tts'?2:1);
  for(const scene of project.scenes){
    if(!Number.isFinite(scene.durationMs)||scene.durationMs<100||scene.durationMs>300000)throw new Error('Thời lượng cảnh audio không hợp lệ.');
    const tracks:Track[]=[],windows:Array<{startMs:number;endMs:number}>=[];
    if(scene.dialogue?.length){
      if(scene.dialogue.length>24||scene.dialogue.some(line=>typeof line.text!=='string'||line.text.length>3000))throw new Error('Lời thoại vượt giới hạn của cảnh.');
      let cursor=0;
      scene.animationBeats=(scene.animationBeats||[]).filter(beat=>!beat.id.startsWith('voice-'));
      for(const line of scene.dialogue){
        if(!line.text?.trim())continue;
        const voice=selectCanvasRoleVoice(line,project,voices,input.narration.voice);
        if(voices.length&&!voices.some(v=>v.id===voice))throw new Error(`Giọng của ${line.speaker} không có trong TTS đang chọn.`);
        project.castVoices[canvasSpeakerKey(line)]=voice;
        const delivery=deliveryFor(line,input);
        const audioKey=speechKey(line,input,voice);
        if(!line.audioUrl||line.audioKey!==audioKey||!line.durationMs){
          const clip=await speech(scene,delivery.text,input,voice,delivery.speed);
          line.audioUrl=clip.url;line.durationMs=clip.durationMs;line.audioKey=audioKey;line.speechWindows=undefined;line.speechEnvelope=undefined;
        }
        if(line.speechWindows===undefined||line.speechEnvelope===undefined){
          const wav=await readFile(await localAudioFile(line.audioUrl!));
          if(line.speechWindows===undefined)line.speechWindows=canvasSpeechActivity(wav);
          if(line.speechEnvelope===undefined)line.speechEnvelope=canvasSpeechEnvelope(wav);
        }
        line.voice=voice;line.atMs=line.atMs??cursor;
        if(!Number.isFinite(line.atMs)||line.atMs<0||line.atMs>300000)throw new Error('Mốc lời thoại không hợp lệ.');
        line.atMs=Math.max(cursor,line.atMs);
        cursor=Math.max(cursor,line.atMs+line.durationMs+delivery.pauseAfterMs);
        tracks.push({url:line.audioUrl,atMs:line.atMs,durationMs:line.durationMs,volume:1,distant:line.delivery==='distant',pan:line.delivery==='distant'?-.15:0});
        windows.push({startMs:line.atMs,endMs:line.atMs+line.durationMs});
        const actor=scene.objects.find(o=>isCanvasDialogueSpeaker(o,line));
        if(actor)scene.animationBeats.push({id:`voice-${line.id}`,action:'talk',atMs:line.atMs,durationMs:line.durationMs,targetIds:[actor.id],intensity:.6});
      }
      scene.durationMs=Math.max(scene.durationMs,Math.ceil((cursor+250)*project.fps/1000)*1000/project.fps);
      scene.lipSync=windows;
      synchronizeCanvasPerformance(scene);
    } else {
      if(!scene.sourceAudioUrl)scene.sourceAudioUrl=scene.audioUrl;
      if(!scene.sourceAudioUrl&&scene.narration?.trim()){
        const clip=await speech(scene,scene.narration,input,input.narration.voice);
        scene.sourceAudioUrl=clip.url;scene.durationMs=Math.max(scene.durationMs,clip.durationMs);
      }
      if(scene.sourceAudioUrl){tracks.push({url:scene.sourceAudioUrl,atMs:0,durationMs:scene.durationMs,volume:1});windows.push({startMs:0,endMs:scene.durationMs});}
    }
    if(scene.soundEffects===undefined&&input.autoSound!==false)scene.soundEffects=planCanvasSoundCues(scene);
    scene.soundEffects=normalizeCanvasSoundCues(scene.soundEffects,scene.durationMs);
    const mixKey=digest({engine:'canvas-audio-v2',tracks,cues:scene.soundEffects,durationMs:scene.durationMs});
    const cached=await findCachedAnimationAsset(mixKey);
    if(cached){scene.audioUrl=cached.uri;scene.audioMixKey=mixKey;continue;}
    if(!scene.soundEffects.length&&tracks.length===1&&!tracks[0]!.distant&&tracks[0]!.atMs===0){scene.audioUrl=tracks[0]!.url;scene.audioMixKey=mixKey;continue;}
    if(!tracks.length&&!scene.soundEffects.length){scene.audioUrl=undefined;continue;}
    const directory=path.join(workdir,'canvas-audio-temp',randomUUID());await mkdir(directory,{recursive:true});
    try {
      for(const [index,cue] of scene.soundEffects.entries()){
        const target=path.join(directory,`foley-${index}.wav`);
        await writeFile(target,synthesizeCanvasFoley(cue.preset,cue.durationMs,Number.parseInt(digest(cue.id).slice(0,8),16)));
        tracks.push({file:target,atMs:cue.atMs,durationMs:cue.durationMs,volume:cue.volume,pan:cue.pan,duck:cue.preset==='wind'||cue.preset==='fire'});
      }
      const files=await Promise.all(tracks.map(track=>track.file?Promise.resolve(track.file):localAudioFile(track.url!)));
      const id=randomUUID(),target=path.join(workdir,'animation-assets','files',`${id}.wav`);await mkdir(path.dirname(target),{recursive:true});
      try {
        await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',...files.flatMap(file=>['-i',file]),'-filter_complex',canvasAudioFilter(tracks,windows,scene.durationMs),'-map','[mix]','-t',String(scene.durationMs/1000),'-ar','48000','-c:a','pcm_s16le',target],AbortSignal.timeout(120_000));
      } catch(error) {await rm(target,{force:true});throw error;}
      const asset=await registerAnimationAsset({id,type:'audio',name:`Sound design · ${scene.name}`,uri:`/api/animation-studio/assets/${id}/file`,tags:['canvas','sound-design','mixed-audio'],createdAt:new Date().toISOString(),source:'generated',cacheKey:mixKey});
      scene.audioUrl=asset.uri;scene.audioMixKey=mixKey;
    } finally {await rm(directory,{recursive:true,force:true});}
  }
  return {...project,updatedAt:new Date().toISOString()};
}
