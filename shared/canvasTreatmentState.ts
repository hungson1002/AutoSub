import type {CanvasStudioProject,CanvasStudioObject,CanvasObjectKeyframe} from './canvasAnimationStudio';

const plain=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
const key=(actor:CanvasStudioObject)=>actor.characterKey||actor.id;
function wrapping(text:string){
  const value=plain(text);
  return /\b(bang (chan|bo|vet|vai)|(?:quan|cuon)\b.{0,35}\bbang|nep (chan|co dinh))\b/.test(value)
    && !/\b(khong|chua|se|du kien|hay|dung|dinh bang)\b/.test(value);
}

/** Compile an actual aid/wrapping event into before/during/after patient state.
 * Never infer treatment from inspection alone, plans or dialogue commands. */
export function compileCanvasTreatmentState(project:CanvasStudioProject):CanvasStudioProject{
  const treatments=project.scenes.flatMap((scene,sceneIndex)=>(scene.animationBeats||[]).flatMap(beat=>{
    if(beat.action!=='aid'||!beat.focusTargetId||!wrapping(beat.speechCue||''))return [];
    const patient=scene.objects.find(o=>o.id===beat.focusTargetId&&o.kind==='character');
    if(!patient)return [];
    const context=plain(project.scenes.filter(s=>s.objects.some(o=>o.kind==='character'&&key(o)===key(patient)))
      .map(s=>[s.narration,...s.objects.filter(o=>key(o)===key(patient)).map(o=>o.designNotes||'')].join(' ')).join(' '));
    const side=patient.legBandage||(/\bchan (?:ben )?phai\b|\bright leg\b/.test(context)?'right':/\bchan (?:ben )?trai\b|\bleft leg\b/.test(context)?'left':undefined);
    if(!side)return [];
    return [{sceneIndex,patientKey:key(patient),side,start:beat.atMs,end:Math.min(scene.durationMs,beat.atMs+beat.durationMs)}];
  }));
  if(!treatments.length)return project;
  return {...project,scenes:project.scenes.map((scene,index)=>({...scene,objects:scene.objects.map(actor=>{
    if(actor.kind!=='character')return actor;
    const events=treatments.filter(event=>event.patientKey===key(actor));
    if(!events.length)return actor;
    const current=events.filter(event=>event.sceneIndex===index).sort((a,b)=>a.start-b.start);
    const earlier=events.some(event=>event.sceneIndex<index);
    // An explicitly narrated pre-existing dressing is not a planning mistake.
    const spoken=plain(scene.dialogue?.map(line=>line.text).join(' ')||scene.narration||'');
    if(!earlier&&!current.length&&/\b(da bang|bang cu|nep cu)\b/.test(spoken))return actor;
    const state=earlier?1:0;
    const frames=(actor.keyframes||[]).map(({bandageProgress:_,...frame})=>frame);
    const byTime=new Map<number,CanvasObjectKeyframe>(frames.map(frame=>[frame.atMs,frame]));
    const setState=(atMs:number,bandageProgress:number)=>byTime.set(atMs,{...byTime.get(atMs),atMs,bandageProgress});
    if(current.length){
      setState(0,state);
      for(const event of current){setState(event.start,state);setState(Math.max(event.start+1,event.end),1);}
    }
    return {...actor,legBandage:events[0]!.side,bandageProgress:state,
      ...(actor.pose==='sit'?{sittingStyle:'injured' as const}:{}),
      ...(current.length?{keyframes:[...byTime.values()].sort((a,b)=>a.atMs-b.atMs)}:actor.keyframes?.some(f=>f.bandageProgress!==undefined)?{keyframes:frames}:{}),
    };
  })}))};
}
