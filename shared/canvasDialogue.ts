import type { CanvasDialogueLine, CanvasStudioObject, CanvasStudioScene } from './canvasAnimationStudio';
import { CANVAS_SPEECH_STYLES } from './canvasSpeech';

export function canvasSpeakerKey(line:CanvasDialogueLine) { return line.characterKey || line.speaker; }
type SpeakerIdentity=Pick<CanvasStudioObject,'characterKey'|'label'>;
export function isCanvasDialogueSpeaker(object:SpeakerIdentity,line:CanvasDialogueLine) {
  return line.characterKey ? object.characterKey===line.characterKey
    : object.label.trim().toLocaleLowerCase()===line.speaker.trim().toLocaleLowerCase();
}
export function isCanvasActorSpeaking(scene:CanvasStudioScene,object:SpeakerIdentity,timeMs:number) {
  if(!scene.dialogue?.length)return undefined;
  return scene.dialogue.some(line=>isCanvasDialogueSpeaker(object,line)
    && timeMs>=(line.atMs??0) && timeMs<(line.atMs??0)+(line.durationMs??0)
    && (line.speechWindows===undefined||line.speechWindows.some(window=>timeMs-(line.atMs??0)>=window.startMs&&timeMs-(line.atMs??0)<window.endMs)));
}
/** Use the actor's own voice, never the mixed narration/foley track. */
export function canvasActorSpeechLevel(scene:CanvasStudioScene,object:SpeakerIdentity,timeMs:number):number|undefined {
  const line=scene.dialogue?.find(line=>isCanvasDialogueSpeaker(object,line)
    && timeMs>=(line.atMs??0) && timeMs<(line.atMs??0)+(line.durationMs??0));
  if(!line)return scene.dialogue?.length?0:undefined;
  if(isCanvasActorSpeaking(scene,object,timeMs)===false)return 0;
  const samples=line.speechEnvelope;
  if(!samples?.length)return undefined;
  const local=timeMs-(line.atMs??0);
  // Binary search keeps five-minute timelines cheap on low-end machines.
  let low=0,high=samples.length-1;
  while(low<high){const mid=Math.ceil((low+high)/2);if(samples[mid]!.atMs<=local)low=mid;else high=mid-1;}
  const a=samples[low]!,b=samples[Math.min(low+1,samples.length-1)]!;
  const t=b.atMs>a.atMs?Math.max(0,Math.min(1,(local-a.atMs)/(b.atMs-a.atMs))):0;
  return a.level+(b.level-a.level)*t;
}
export function normalizeCanvasDialogue(value:unknown):CanvasDialogueLine[] {
  if(!Array.isArray(value))return [];
  return value.slice(0,24).flatMap((line,index)=>{
    if(!line||typeof line!=='object'||!String(line.text||'').trim())return [];
    return [{id:String(line.id||`line-${index}`),speaker:String(line.speaker||'Người kể').slice(0,100),
      text:String(line.text).trim().slice(0,3000),
      ...(line.characterKey?{characterKey:String(line.characterKey).slice(0,100)}:{}),
      ...(line.voice?{voice:String(line.voice).slice(0,200)}:{}),
      ...(line.spokenText?{spokenText:String(line.spokenText).slice(0,3000)}:{}),
      ...(Object.hasOwn(CANVAS_SPEECH_STYLES,String(line.emotion))?{emotion:line.emotion as CanvasDialogueLine['emotion']}:{}),
      ...(['sigh','laugh','clear-throat'].includes(line.cue)?{cue:line.cue as CanvasDialogueLine['cue']}:{}),
      ...(line.atMs!==undefined?{atMs:Math.max(0,Math.min(300000,Number(line.atMs)||0))}:{}),
      delivery:line.delivery==='distant'?'distant' as const:'natural' as const}];
  });
}
