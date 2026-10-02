import type { CanvasStudioScene } from './canvasAnimationStudio';
import {isCanvasDialogueSpeaker} from './canvasDialogue';
import {canvasShipStyle} from './canvasAssetRegistry';

const normalized = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();

/** Approximate phrase alignment using measured voiced time, never silent gaps.
 * Existing authored timing and audio assets remain authoritative without a cue.
 */
export function synchronizeCanvasPerformance(scene: CanvasStudioScene): void {
  // Rebuild only derived speech beats. Authored physical actions remain intact.
  if(scene.dialogue?.some(line=>line.durationMs)) {
    scene.animationBeats=(scene.animationBeats||[]).filter(beat=>!beat.id.startsWith('voice-'));
    for(const line of scene.dialogue){
      const actor=scene.objects.find(o=>o.kind==='character'&&isCanvasDialogueSpeaker(o,line));
      if(actor&&line.durationMs)scene.animationBeats.push({id:`voice-${line.id}`,action:'talk',atMs:line.atMs||0,durationMs:line.durationMs,targetIds:[actor.id],intensity:.35});
    }
  }
  for(const object of scene.objects) {
    if(object.kind==='ship'&&!object.imageUrl&&canvasShipStyle(object)==='ferry')object.assetRef='ship:wooden-ferry';
  }
  scene.animationBeats = (scene.animationBeats || []).map(beat => {
    if (!beat.speechCue?.trim()) return beat;
    const cue = normalized(beat.speechCue);
    if (!cue) return beat;
    const line = scene.dialogue?.find(line => (!beat.dialogueId || line.id === beat.dialogueId)
      && (` ${normalized(line.text)} `).includes(` ${cue} `));
    if (!line || !line.durationMs) return beat;
    const text = normalized(line.text);
    const index = (` ${text} `).indexOf(` ${cue} `);
    const fraction = index / Math.max(1, text.length);
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
    const atMs = Math.min(Math.max(0, scene.durationMs - 120), Math.round((line.atMs || 0) + localMs));
    return { ...beat, atMs, durationMs: Math.max(120, Math.min(beat.durationMs, scene.durationMs - atMs, (line.atMs || 0) + line.durationMs - atMs)) };
  });
}
