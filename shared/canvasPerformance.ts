import type { CanvasStudioScene } from './canvasAnimationStudio';
import {isCanvasDialogueSpeaker} from './canvasDialogue';
import {canvasShipStyle} from './canvasAssetRegistry';

const normalized = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();

function alignedCueTiming(
  scene: CanvasStudioScene,
  speechCue: string | undefined,
  dialogueId: string | undefined,
  authoredAtMs: number,
  authoredDurationMs: number,
) {
  if (!speechCue?.trim()) return undefined;
  const cue = normalized(speechCue);
  if (!cue) return undefined;
  const line = scene.dialogue?.find(line => (!dialogueId || line.id === dialogueId)
    && (` ${normalized(line.text)} `).includes(` ${cue} `));
  if (!line || !line.durationMs) return undefined;
  const lineText = normalized(line.text);
  const index = (` ${lineText} `).indexOf(` ${cue} `);
  if(index<0)return undefined;
  const fraction = index / Math.max(1, lineText.length);
  const windows = (line.speechWindows || []).filter(w => Number.isFinite(w.startMs) && Number.isFinite(w.endMs)
    && w.startMs >= 0 && w.endMs <= line.durationMs! && w.endMs > w.startMs);
  const voiced = windows.length ? windows : [{ startMs: 0, endMs: line.durationMs }];
  let remaining = fraction * voiced.reduce((sum, w) => sum + w.endMs - w.startMs, 0);
  let localMs = voiced.at(-1)!.endMs;
  for (const window of voiced) {
    const duration = window.endMs - window.startMs;
    if (remaining < duration) { localMs = window.startMs + remaining; break; }
    remaining -= duration;
  }
  const sentences=line.text.split(/[.!?…]+/).map(normalized).filter(Boolean);
  const groups:typeof voiced=[];
  for(const window of voiced){
    const last=groups.at(-1);
    if(last&&window.startMs-last.endMs<400)last.endMs=window.endMs;
    else groups.push({...window});
  }
  if(sentences.length>1&&sentences.length===groups.length){
    let prefix=0;
    for(let i=0;i<sentences.length;i++){
      const sentence=sentences[i]!,group=groups[i]!;
      if(index>=prefix&&index<prefix+sentence.length){
        localMs=group.startMs+(index-prefix)/Math.max(1,sentence.length)*(group.endMs-group.startMs);break;
      }
      prefix+=sentence.length+1;
    }
  }
  const atMs = Math.min(Math.max(0, scene.durationMs - 120), Math.round((line.atMs || 0) + localMs));
  const durationMs = Math.max(120, Math.min(
    authoredDurationMs,
    scene.durationMs - atMs,
    (line.atMs || 0) + line.durationMs - atMs,
  ));
  return {atMs,durationMs};
}

/** Approximate phrase alignment using measured voiced time, never silent gaps.
 * Existing authored timing and audio assets remain authoritative without a cue.
 */
export function synchronizeCanvasPerformance(scene: CanvasStudioScene): void {
  // Rebuild only derived speech beats. Authored physical actions remain intact.
  // QC runs before TTS, so dialogue without measured duration still needs a
  // provisional talk beat. Audio production later replaces these voice-* beats
  // with the measured atMs/durationMs and never crops the spoken performance.
  if(scene.dialogue?.length) {
    scene.animationBeats=(scene.animationBeats||[]).filter(beat=>!beat.id.startsWith('voice-'));
    const lines=scene.dialogue;
    const weights=lines.map(line=>Math.max(1,(line.spokenText||line.text).trim().length));
    const totalWeight=weights.reduce((sum,value)=>sum+value,0)||1;
    let cursor=0;
    for(let index=0;index<lines.length;index++){
      const line=lines[index]!;
      const measured=Number(line.durationMs);
      const planned=Math.max(240,Math.round(scene.durationMs*weights[index]!/totalWeight));
      const nextExplicit=lines.slice(index+1).find(next=>next.atMs!==undefined)?.atMs;
      const atMs=Math.max(0,Math.min(scene.durationMs-1,line.atMs??cursor));
      const available=Math.max(120,(nextExplicit===undefined?scene.durationMs:nextExplicit)-atMs);
      const durationMs=Math.max(120,Math.min(
        Number.isFinite(measured)&&measured>0?measured:planned,
        scene.durationMs-atMs,
        available,
      ));
      const actor=scene.objects.find(o=>o.kind==='character'&&isCanvasDialogueSpeaker(o,line));
      if(actor)scene.animationBeats.push({
        id:`voice-${line.id}`,
        action:'talk',
        atMs,
        durationMs,
        targetIds:[actor.id],
        intensity:.35,
        dialogueId:line.id,
        speechCue:line.text.slice(0,140).trim(),
      });
      cursor=Math.max(cursor,atMs+durationMs);
    }
  }
  if(scene.dialogueLayout&&scene.dialogue?.every(line=>line.durationMs)){
    // Remove legacy generated acknowledgements; preserve authored actions.
    // A listener does not have to nod after every line of dialogue.
    scene.animationBeats=(scene.animationBeats||[]).filter(b=>!b.id.startsWith('listen-'));
  }
  for(const object of scene.objects) {
    if(object.kind==='ship'&&!object.imageUrl&&canvasShipStyle(object)==='ferry')object.assetRef='ship:wooden-ferry';
  }
  scene.animationBeats = (scene.animationBeats || []).map(beat => {
    const aligned=alignedCueTiming(scene,beat.speechCue,beat.dialogueId,beat.atMs,beat.durationMs);
    return aligned?{...beat,...aligned}:beat;
  });

  // Visual changes are authored before TTS but must land on measured speech
  // after production. Retiming the declarative beat plus only the derived
  // keyframes keeps the stage geometry untouched.
  scene.visualBeats=(scene.visualBeats||[]).map(beat=>{
    const aligned=alignedCueTiming(scene,beat.speechCue,undefined,beat.atMs,beat.durationMs);
    return aligned?{...beat,...aligned}:beat;
  });
  const visualById=new Map((scene.visualBeats||[]).map(beat=>[beat.id,beat]));
  for(const object of scene.objects){
    if(!object.keyframes?.some(frame=>frame.visualBeatId))continue;
    object.keyframes=object.keyframes.map(frame=>{
      const beat=frame.visualBeatId&&visualById.get(frame.visualBeatId);
      if(!beat)return frame;
      const atMs=frame.visualBeatPhase==='end'?Math.min(scene.durationMs,beat.atMs+beat.durationMs):beat.atMs;
      return {...frame,atMs};
    }).sort((a,b)=>a.atMs-b.atMs);
  }
  if(scene.camera?.keyframes?.some(frame=>frame.visualBeatId)){
    scene.camera.keyframes=scene.camera.keyframes.map(frame=>{
      const beat=frame.visualBeatId&&visualById.get(frame.visualBeatId);
      if(!beat)return frame;
      const atMs=frame.visualBeatPhase==='end'?Math.min(scene.durationMs,beat.atMs+beat.durationMs):beat.atMs;
      return {...frame,atMs};
    }).sort((a,b)=>a.atMs-b.atMs);
  }
  for(const prop of scene.objects)if(prop.handling){
    const beat=scene.animationBeats?.find(b=>b.focusTargetId===prop.id&&b.targetIds.includes(prop.handling!.actorId)&&b.action==='reach'&&b.speechCue);
    if(beat)prop.handling={...prop.handling,atMs:beat.atMs,durationMs:beat.durationMs};
  }
}
