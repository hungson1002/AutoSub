import type {CanvasStudioProject,CanvasStudioScene,CanvasDialogueLine} from '../../shared/canvasAnimationStudio';
import type {AIProvider} from '../types';
import {chat} from '../adapters/openaiCompatible';

type SceneEdit={id:string;dialogue:Array<{id:string;text:string}>};

function requiredCues(scene:CanvasStudioScene,line:CanvasDialogueLine){
  return [...new Set([
    ...(scene.animationBeats||[]).filter(b=>!b.dialogueId||b.dialogueId===line.id).map(b=>b.speechCue),
    ...(scene.vectorBeats||[]).map(b=>b.cue),...(scene.vectorScene?.tracks||[]).map(t=>t.cue),
    ...(scene.vectorDirection?.beats||[]).map(b=>b.cue),...(scene.vectorDirection?.propEvents||[]).map(e=>e.cue),
  ].filter((cue):cue is string=>Boolean(cue&&line.text.includes(cue))))];
}

/** Edit speech, never accelerate or crop it. Keep all shot and speaker identities. */
export function applyCanvasDurationScript(project:CanvasStudioProject,edits:SceneEdit[],targetMs:number):CanvasStudioProject {
  if(!Array.isArray(edits)||edits.length!==project.scenes.length||new Set(edits.map(s=>s.id)).size!==edits.length)
    throw new Error('Duration edit must preserve every scene, including the ending.');
  const total=project.scenes.reduce((sum,s)=>sum+s.durationMs,0),frame=1000/project.fps;
  const result=structuredClone(project);let allocated=0;
  for(const scene of result.scenes){
    const edit=edits.find(s=>s.id===scene.id),lines=scene.dialogue||[];
    if(!edit||!lines.length||!Array.isArray(edit.dialogue)||edit.dialogue.length!==lines.length||new Set(edit.dialogue.map(l=>l.id)).size!==lines.length)
      throw new Error('Duration edit must preserve all dialogue identities.');
    const previous=scene.durationMs;
    scene.durationMs=Math.max(frame,Math.round(previous*targetMs/total/frame)*frame);allocated+=scene.durationMs;
    const scale=scene.durationMs/previous;
    const time=(value:number)=>Math.min(scene.durationMs,Math.max(0,Math.round(value*scale)));
    for(const line of lines){
      const replacement=edit.dialogue.find(l=>l.id===line.id);
      if(!replacement||typeof replacement.text!=='string'||!replacement.text.trim())throw new Error('Duration edit omitted spoken content.');
      for(const cue of requiredCues(scene,line))if(!replacement.text.includes(cue))
        throw new Error(`Duration edit removed the action cue: ${cue}`);
      if(replacement.text!==line.text){
        line.text=replacement.text.trim();line.spokenText=undefined;line.audioUrl=undefined;line.audioKey=undefined;
        line.durationMs=undefined;line.speechWindows=undefined;line.speechEnvelope=undefined;
      }
      line.atMs=undefined;
    }
    scene.narration=lines.map(l=>l.text).join(' ');
    scene.audioUrl=undefined;scene.sourceAudioUrl=undefined;scene.audioMixKey=undefined;scene.lipSync=undefined;scene.captionTrack=undefined;
    scene.animationBeats=scene.animationBeats?.filter(b=>!b.id.startsWith('voice-')).map(b=>({...b,atMs:time(b.atMs),durationMs:Math.max(120,time(b.durationMs))}));
    for(const object of scene.objects){
      object.keyframes=object.keyframes?.map(k=>({...k,atMs:time(k.atMs)}));
      if(object.motionDurationMs)object.motionDurationMs=time(object.motionDurationMs);
      if(object.handling)object.handling={...object.handling,atMs:time(object.handling.atMs),durationMs:time(object.handling.durationMs)};
    }
    if(scene.camera?.keyframes)scene.camera.keyframes=scene.camera.keyframes.map(k=>({...k,atMs:time(k.atMs)}));
    scene.effects=scene.effects?.map(e=>({...e,startMs:time(e.startMs||0),durationMs:e.durationMs===undefined?undefined:time(e.durationMs)}));
    scene.soundEffects=scene.soundEffects?.map(c=>({...c,atMs:time(c.atMs),durationMs:Math.max(1,time(c.durationMs))}));
  }
  result.scenes.at(-1)!.durationMs+=targetMs-allocated;
  return result;
}

export async function shortenCanvasScript(provider:AIProvider,model:string,project:CanvasStudioProject,targetMs:number){
  const speech=project.scenes.flatMap(s=>s.dialogue||[]);
  if(!speech.length||project.scenes.some(s=>!s.dialogue?.length))throw new Error('Duration revision requires a complete dialogue script; original project preserved.');
  const measured=speech.reduce((sum,l)=>sum+(l.durationMs||0),0);
  const vector=project.scenes.every(s=>s.vectorScene);
  const ratio=Math.min(vector ? .95 : .9,targetMs*(vector ? .97 : .87)/Math.max(1,measured));
  const payload=project.scenes.map(s=>({id:s.id,name:s.name,visualBrief:s.visualBrief,
    dialogue:s.dialogue!.map(l=>({id:l.id,speaker:l.speaker,text:l.text,maxWords:Math.max(4,Math.floor(l.text.split(/\s+/u).length*ratio)),
      requiredCues:requiredCues(s,l)}))}));
  const messages:Array<{role:'system'|'user';content:string}>=[{role:'system',content:
    'You are the production script editor. Real TTS exceeded the requested runtime. Shorten every line to its maxWords budget while preserving the complete plot, discovery, conflict, rescue, resolution and ending. Keep all scene ids and dialogue ids, order and speakers. Keep requiredCues verbatim inside their own line so existing animation stays aligned. Remove verbose adjectives and repeated explanations; never add events or actions absent from the supplied visualBrief. Preserve natural Vietnamese storytelling and character conversation. No blank padding, no repeated speech, no speed changes. Return ONLY JSON {"scenes":[{"id":"same scene id","dialogue":[{"id":"same line id","text":"shortened Vietnamese speech"}]}]}. Return ALL scenes including the final ending.'},
    {role:'user',content:JSON.stringify({targetMs,measuredSpeechMs:measured,scenes:payload})}];
  for(let attempt=0;attempt<2;attempt++){
    const raw=await chat(provider,model,messages,AbortSignal.timeout(300000),24000);
    try{return applyCanvasDurationScript(project,JSON.parse(raw).scenes,targetMs);}
    catch(error){if(attempt===1)throw error;messages.push({role:'user',content:`Invalid edit: ${String(error)}. Return the complete corrected JSON, preserving the supplied ids and required cues.`});}
  }
  throw new Error('Duration revision failed; original assets preserved.');
}
