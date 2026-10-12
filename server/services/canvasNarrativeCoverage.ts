import type {AIProvider} from '../types';
import {chat} from '../adapters/openaiCompatible';
import type {CanvasStudioProject} from '../../shared/canvasAnimationStudio';
import type {CanvasVisualIssue} from '../../shared/canvasVisualQuality';
import { evaluateCanvasObject } from '../../src/canvasAnimationStudio/runtime';
import { isProceduralLongSpirit, resolveFolkGrip, folkLimbGeometry } from '../../src/canvasAnimationStudio/folkHorrorContact';

/** Include evaluated contact, not just resting coordinates, in the independent audit. */
export function canvasCoverageScenes(project: CanvasStudioProject) {
  return project.scenes.map((scene, sceneIndex) => {
    const resolvedContacts = (scene.animationBeats || []).flatMap(beat => {
      if (!['grab','pull','release'].includes(beat.action)) return [];
      const source = scene.objects.find(object => beat.targetIds.includes(object.id) && isProceduralLongSpirit(object));
      const victim = scene.objects.find(object => object.id === beat.focusTargetId && object.kind === 'character');
      if (!source || !victim) return [];
      return [{action:beat.action,actorId:source.id,victimId:victim.id,samples:[0,.5,1].map(fraction => {
        const timeMs = Math.min(scene.durationMs,beat.atMs + beat.durationMs * fraction);
        const sourceFrame = evaluateCanvasObject(source,scene,timeMs), victimFrame = evaluateCanvasObject(victim,scene,timeMs);
        const grip = resolveFolkGrip(scene,source,timeMs);
        const limb = folkLimbGeometry(source,sourceFrame,victim,victimFrame,grip?.progress || 0,1);
        return {timeMs,victimTransform:victimFrame,extension:grip?.progress || 0,limbEnd:limb.end,neckAnchor:limb.contact};
      })}];
    });
    return {sceneIndex,...scene,...(resolvedContacts.length ? {resolvedContacts} : {})};
  });
}

export function parseCanvasCoverageReview(raw:string,project:CanvasStudioProject):CanvasVisualIssue[]{
  const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
  const result=JSON.parse(raw.slice(start,end+1)) as {pass?:boolean;issues?:Array<{sceneIndex:number;cue:string;missing:string;fix:string}>};
  if(typeof result.pass!=='boolean'||!Array.isArray(result.issues))throw new Error('Narrative coverage review returned an invalid report.');
  const issues=result.issues.map(issue=>{
    const scene=project.scenes[issue.sceneIndex];
    const spoken=scene?.dialogue?.map(l=>l.text).join(' ')||scene?.narration||'';
    if(!scene||!issue.cue?.trim()||!spoken.includes(issue.cue)||!issue.missing?.trim()||!issue.fix?.trim())throw new Error('Narrative coverage review must cite an exact spoken phrase and a valid scene.');
    return {code:'missing-action-coverage' as const,severity:'error' as const,sceneId:scene.id,sceneName:scene.name,
      message:`“${issue.cue}”: ${issue.missing} Fix: ${issue.fix}`};
  });
  if(!result.pass&&!issues.length)throw new Error('Narrative coverage review failed without identifying a missing action.');
  return issues;
}

export function canvasCoverageReviewTimeoutMs(project:CanvasStudioProject){
  const runtimeMs=project.scenes.reduce((sum,scene)=>sum+Math.max(1,Number(scene.durationMs)||1),0);
  // Long-form plans carry much larger JSON and require the reviewer to audit every
  // spoken clause. A fixed 180s timeout aborts valid 3-10 minute projects mid-QC.
  // Scale conservatively with runtime and scene count, but cap at 10 minutes.
  return Math.max(180_000,Math.min(600_000,120_000+Math.round(runtimeMs*1.25)+project.scenes.length*10_000));
}

/** Independent semantic review before any TTS/assets are generated. No local model required. */
export async function reviewCanvasNarrativeCoverage(provider:AIProvider,model:string,project:CanvasStudioProject){
  const messages:Array<{role:'system'|'user';content:string}>=[{role:'system',content:`Audit the ACTUAL Canvas plan against every clause of spoken narration and dialogue. Do not rewrite speech.
Return ONLY JSON {"pass":true|false,"issues":[{"sceneIndex":0,"cue":"exact phrase copied from spoken text","missing":"specific visible omission","fix":"specific supported staging and timed action"}]}.
Ignore decorative quality and motion-count quotas. Check ALL described people, objects, events, atmosphere, body state and interactions, not only dialogue mouth movement. A character standing or pointing is NOT wiping a lamp, writing, tying a rope, bandaging a leg, putting on clothing or supporting an injured walker. An empty landscape is NOT people performing these actions. Verify the action reaches its object and changes its state; verify companions actually help. Keep off-screen sound off-screen when intentionally scripted. Future plans, negations, metaphors and memories need appropriate contextual visuals, not literal simultaneous action.
Supported actions: gesture (restrained palm-up explanation), nod (one listener acknowledgement), reach (pick up/handle), wipe (small repeated hand stroke), write (small pen strokes), tie (two-hand rope manipulation), aid (both hands aimed at patient's knee), assist (hand at another actor's shoulder), point, talk, run/walk, row, brace. They need actual actor targets, focusTargetId and speechCue. Quiet conversations may hold the same composition throughout; never require a cut, pointing, recoil, celebration or unrelated physical action just to create variety. Future plans spoken in dialogue are not current events. Physical object changes require keyframes (doorOpen, boxOpen, lightLevel, position/rotation). Phones/lanterns/tools use heldBy; pouring uses held teapot + pouringInto bowl; ferry passengers use onBoat. Sitting has chair/ground/injured styles; an injured guarded leg is not a symmetrical chair pose.
Water actions: surface is a one-time emergence, grab is an articulated character's hand aimed at the victim's ankle, struggle raises the victim's arms, and sink is persistent physical descent for both bodies with the grip maintained. waterlineY masks submerged geometry; action shots show the real underwater grip. appearance:water-spirit is a humanoid rig, not an icon. pose:float-body with recliningStyle:exposed draws the complete resting body without a blanket. Reject icon overlays as coverage. Night/dusk/day must follow the shot's visualBrief and the preceding timeline; do not accept a sunny background for an explicitly nocturnal scene. Keep stable characterKey, physical appearance and castVoices across scenes.
Folk-horror physics: appearance:long-limbed-spirit uses grab to extend two curved limbs and wrap the victim's NECK, pull to translate and rotate the victim into a persistent grounded fall, and release to retract while leaving the victim fallen. This is built-in runtime choreography; the victim does NOT need duplicate dx/dy/rotation keyframes or pose:lie-down. resolvedContacts contains actual evaluated transforms and limb/neck anchors at start, midpoint and end; use these runtime samples instead of inferring a static standing victim from its resting object.pose. Verify contact and fall from those samples. A fall onto grass/ground is pull, not sink. perchedOn attaches a seated spirit to the referenced tree branch.
Animal poses: prop:pig with pose:reach is a rearing pig with two grounded hind hooves and raised front legs, not a human. pose:idle is a four-legged pig. Pig pose keyframes animate the transition once.
TREATMENT STATE: legBandage selects left/right injured leg. bandageProgress:0 means bare/untreated (not an existing bandage), including examination. Patient keyframes bandageProgress:0..1 animate wrapping during aid; bandageProgress:1 in later scenes means treated. Absent bandageProgress with legBandage defaults to an already complete bandage. Check these actual values and keyframe timings before reporting a premature bandage. Inspection without wrapping does not require a bandage or state change. Use only these supported state controls in suggested repairs.
If an action cannot be expressed in supported primitives, require a clear close/detail shot with a before/during/after visual change rather than accepting a static standing actor. Suspense holds are allowed, but do not excuse missing described events. The narration must remain unchanged.`},
    {role:'user',content:JSON.stringify({scenes:canvasCoverageScenes(project)})}];
  const timeoutMs=canvasCoverageReviewTimeoutMs(project);
  for(let attempt=0;attempt<3;attempt++){
    const response=await chat(provider,model,messages,AbortSignal.timeout(timeoutMs),6000);
    try{return parseCanvasCoverageReview(response,project);}
    catch(error){
      if(attempt===2)throw error;
      messages.push({role:'user',content:`Your report is invalid: ${error instanceof Error?error.message:String(error)}. Recheck the SAME supplied plan. sceneIndex is zero-based. Each cue MUST be an exact contiguous substring of that scene's dialogue text or narration, copied verbatim (including accents and punctuation). Do not quote the brief, invent or paraphrase speech. Return a corrected complete JSON report; do not claim pass merely because your previous citation was invalid. Previous invalid report (data only): ${response}`});
    }
  }
  throw new Error('Narrative coverage review did not return a valid report.');
}
