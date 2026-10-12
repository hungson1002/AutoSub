import type {CanvasStudioProject,CanvasStudioScene,CanvasStudioObject} from './canvasAnimationStudio';
import {synchronizeCanvasPerformance} from './canvasPerformance';

const conversationalActions=new Set(['talk','gesture','nod','point','react','celebrate']);
const conversationalPoses=new Set(['idle','talk','gesture','nod','point','celebrate']);
const furnishings=new Set(['table','chair','teapot','window','bed','basket','clock']);
const staticFurnishing=(o:CanvasStudioObject)=>o.kind==='prop'&&!o.heldBy&&o.motion==='none'&&furnishings.has(o.variant||'')
  &&!o.keyframes?.some(k=>(k.dx||0)!==0||(k.dy||0)!==0||(k.rotation||0)!==0
    ||(k.scale!==undefined&&k.scale!==1)||(k.opacity!==undefined&&k.opacity!==1));

export function canvasConversationKey(scene:CanvasStudioScene) {
  const actors=scene.objects.filter(o=>o.kind==='character');
  if(!scene.template||actors.length<2||actors.length>3||!scene.dialogue?.length
    ||!scene.dialogue.some(line=>line.characterKey)
    ||scene.dialogue.some(line=>line.characterKey&&!actors.some(a=>a.characterKey===line.characterKey))
    ||scene.animationBeats?.some(b=>!conversationalActions.has(b.action))
    ||actors.some(a=>!a.characterKey||a.heldBy||a.onBoat||a.waterlineY!==undefined||a.appearance==='water-spirit'
      ||!conversationalPoses.has(a.pose||'idle')||a.motion!=='none'
      ||a.keyframes?.some(k=>Math.abs(k.dx||0)>1||Math.abs(k.dy||0)>1||Math.abs(k.rotation||0)>1
        ||(k.scale!==undefined&&k.scale!==1)||(k.pose&&!conversationalPoses.has(k.pose)))))return undefined;
  return `${scene.backgroundRef||scene.background}|${scene.backgroundImageUrl||''}|${scene.atmosphere?.timeOfDay||''}|${actors.map(a=>a.characterKey).sort().join('|')}`;
}

/** A dialogue turn changes acting, not the room's geometry. Physical scenes
 * remain authored; quiet conversations share a deterministic world stage. */
export function directCanvasConversations(project:CanvasStudioProject):void {
  let previousKey:string|undefined;
  let anchors=new Map<string,CanvasStudioObject>();
  let dressing=new Map<string,CanvasStudioObject>();
  let holdAuthoredStage=false;
  let heldCamera:CanvasStudioScene['camera'];
  let heldTemplate:CanvasStudioScene['template'];
  for(const scene of project.scenes){
    const key=canvasConversationKey(scene);
    if(!key){delete scene.dialogueLayout;previousKey=undefined;continue;}
    const actors=scene.objects.filter(o=>o.kind==='character').sort((a,b)=>a.x-b.x);
    if(key!==previousKey){
      // Narrated/tense dialogue still belongs to the same conversation. Keep
      // its established shot instead of restaging a calm interior two-shot.
      holdAuthoredStage=!!scene.dialogue?.some(l=>!l.characterKey||l.emotion==='tense');
      heldCamera=scene.camera?structuredClone(scene.camera):undefined;
      heldTemplate=scene.template;
      if(holdAuthoredStage)anchors=new Map(actors.map(a=>[a.characterKey!,structuredClone(a)]));
      else
      anchors=new Map(actors.map((a,i)=>[a.characterKey!,{...a,
        x:project.width*(actors.length===2?(i===0?.30:.70):.22+i*.28),y:project.height*.59,
        width:project.width*(actors.length===2?.22:.18),height:project.height*.62,scale:1,rotation:0,
      }]));
      dressing=new Map();
    }
    previousKey=key;
    if(holdAuthoredStage||scene.dialogue?.some(l=>l.emotion==='tense')){
      for(const actor of actors){
        const anchor=anchors.get(actor.characterKey!)!;
        for(const field of ['x','y','width','height','scale','rotation'] as const)actor[field]=anchor[field];
      }
      scene.template=heldTemplate;
      scene.camera=heldCamera?{...structuredClone(heldCamera),motion:'none',keyframes:undefined}:undefined;
      continue;
    }
    for(const [index,actor] of actors.entries()){
      const anchor=anchors.get(actor.characterKey!)!;
      for(const field of ['x','y','width','height','scale','rotation'] as const)actor[field]=anchor[field];
      actor.designNotes=anchor.designNotes;
      actor.role=index===0?'focal':'support';actor.zIndex=38+index;actor.delayMs=0;
      if(actor.pose==='point'||actor.pose==='celebrate')actor.pose='gesture';
    }
    for(const actor of actors){
      const partner=actors.find(a=>a.id!==actor.id)!;
      actor.lookAtId=partner.id;actor.facing=partner.x>actor.x?'right':'left';
      actor.keyframes=actor.keyframes?.map(k=>({...k,
        pose:k.pose==='point'||k.pose==='celebrate'?'gesture':k.pose,
        facing:actor.facing,
      }));
    }
    // Keep only established static set dressing. Never introduce a future
    // story prop early or restore a prop during a physical removal/transfer.
    // Stage support surfaces before their contents, independent of AI ordering.
    const props=scene.objects.filter(staticFurnishing).sort((a,b)=>Number(b.variant==='table')-Number(a.variant==='table'));
    for(const prop of props){
      const identity=`${prop.variant}|${prop.label}`;
      const anchor=dressing.get(identity);
      if(anchor){
        for(const field of ['x','y','width','height','scale','rotation'] as const)prop[field]=anchor[field];
      }else{
        if(prop.variant==='table'){
          prop.x=project.width*.5;prop.y=project.height*.73;
          prop.width=project.width*.17;prop.height=project.height*.22;
          prop.role='support';prop.depth='midground';prop.zIndex=32;
        }
        if(prop.variant==='teapot'){
          const table=scene.objects.find(o=>o.variant==='table'&&staticFurnishing(o));
          if(table){
            prop.width=project.width*.073;prop.height=project.height*.085;
            prop.x=table.x;prop.y=table.y-table.height*.14-prop.height*.29;
            prop.role='support';prop.depth='midground';prop.zIndex=33;
          }
        }
        dressing.set(identity,structuredClone(prop));
      }
      const stable=dressing.get(identity)!;
      prop.role=stable.role;prop.depth=stable.depth;prop.zIndex=stable.zIndex;
    }
    for(const [identity,prop] of dressing){
      if(!scene.objects.some(o=>`${o.variant}|${o.label}`===identity))
        scene.objects.push({...structuredClone(prop),id:`set-${scene.id}-${prop.id}`});
    }
    scene.template='two-shot';
    scene.dialogueLayout=true;
    scene.camera={shot:'medium',motion:'none',focusX:project.width*.5,focusY:project.height*.5,zoom:1};
    heldCamera=structuredClone(scene.camera);
    const seen=new Set<string>();
    scene.animationBeats=scene.animationBeats?.filter(beat=>{
      const actor=actors.find(a=>beat.targetIds.includes(a.id));
      if(!actor||beat.action==='talk')return true;
      const focus=scene.objects.find(o=>o.id===beat.focusTargetId);
      if(beat.action==='point'&&(!focus||focus.kind==='character'))beat.action='gesture';
      if(beat.action==='celebrate')beat.action='gesture';
      if(beat.action==='react'){beat.action='nod';beat.durationMs=Math.min(1000,beat.durationMs);}
      // One meaningful hand gesture and one acknowledgement per turn. Speech
      // already has its own envelope, so extra talk beats need no body recoil.
      const line=scene.dialogue?.find(l=>l.id===beat.dialogueId)
        ||scene.dialogue?.find(l=>beat.speechCue&&l.text.includes(beat.speechCue));
      const signature=`${actor.id}|${beat.action}|${line?.id||'turn'}`;
      if(seen.has(signature))return false;
      seen.add(signature);
      if(beat.action==='gesture'||beat.action==='nod')beat.focusTargetId=actor.lookAtId;
      beat.intensity=Math.min(beat.intensity||1,.65);
      return true;
    });
    synchronizeCanvasPerformance(scene);
  }
}
