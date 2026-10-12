import type {CanvasStudioScene,CanvasStudioObject,CanvasStudioProject} from './canvasAnimationStudio';
import {canvasShipStyle} from './canvasAssetRegistry';

const plain=(text:string)=>text.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/g,'d');

const FLOOR_PROP_BOTTOM_RATIO:Partial<Record<NonNullable<CanvasStudioObject['variant']>,number>>={
  table:.44,chair:.43,box:.22,barrel:.45,basket:.41,bed:.44,
  lantern:.40,bowl:.34,teapot:.40,
};
const SUPPORT_SURFACE_RATIO:Partial<Record<NonNullable<CanvasStudioObject['variant']>,number>>={
  table:-.10,chair:.02,box:-.18,barrel:-.39,bed:-.18,
};

export function canvasPropBottomRatio(object:CanvasStudioObject){
  return object.kind==='prop'&&object.variant?FLOOR_PROP_BOTTOM_RATIO[object.variant]:undefined;
}
export function canvasFloorPropBottomRatio(object:CanvasStudioObject){
  if(object.kind!=='prop'||!object.variant)return undefined;
  if(!['table','chair','box','barrel','basket','bed'].includes(object.variant))return undefined;
  return FLOOR_PROP_BOTTOM_RATIO[object.variant];
}
export function canvasPropSupportSurfaceRatio(object:CanvasStudioObject){
  return object.kind==='prop'&&object.variant?SUPPORT_SURFACE_RATIO[object.variant]:undefined;
}

export function canvasLampMountedOnPost(object:CanvasStudioObject):boolean{
  return object.variant==='lantern'&&!object.heldBy&&!object.onBoat
    &&/coc den|(?:gan|dat|mounted|fixed)[^.!?;]{0,80}(?:coc|post)/.test(plain(`${object.label} ${object.designNotes||''}`));
}
export function canvasLanternUsesHandlePivot(object:CanvasStudioObject):boolean{
  if(object.variant!=='lantern'||object.imageUrl||object.restingOn)return false;
  if(object.heldBy||canvasLampMountedOnPost(object))return true;
  return /treo|hanging|hang|mai hien|eave/.test(plain(`${object.label} ${object.designNotes||''}`));
}

export function canvasContactRelease(beat:{speechCue?:string}):boolean{
  const cue=plain(beat.speechCue||'');
  const action='(?:buong|tha tay|release|let go|leave)';
  return new RegExp(action).test(cue)
    &&!new RegExp(`(?:khong|dung|chua|never|don't|do not)\\b[^.!?;]{0,35}${action}`).test(cue);
}

/** Restore occupants/equipment only within consecutive full shots of one voyage.
 * Inserts, explicit departures, different places and a new day break inheritance. */
export function resolveCanvasVoyageContinuity(project:CanvasStudioProject):CanvasStudioProject {
  const result=structuredClone(project);
  let previous:CanvasStudioScene|undefined;
  for(const scene of result.scenes){
    const boat=scene.objects.find(o=>o.kind==='ship'&&canvasShipStyle(o)==='ferry'&&o.depth!=='background'&&o.role!=='background');
    const priorBoat=previous?.objects.find(o=>o.kind==='ship'&&o.role!=='background'&&o.depth!=='background');
    const text=plain(`${scene.name} ${scene.narration||''} ${scene.visualBrief||''}`);
    const continuous=boat&&priorBoat&&previous&&scene.background===previous.background
      &&(boat.assetKey&&boat.assetKey===priorBoat.assetKey||plain(boat.label)===plain(priorBoat.label))
      &&scene.atmosphere?.timeOfDay===previous.atmosphere?.timeOfDay
      // A mislabeled POV/close-up can still show the full boat. Only a
      // described detail insert permits omissions, not the camera enum alone.
      &&scene.camera?.shot!=='diagram'&&!/can canh chi|chi thay|detail insert|close detail/.test(text)
      &&scene.background!=='underwater'&&!/roi do|len bo|xuong do|sang hom|next morning|disembark/.test(text);
    if(continuous&&previous&&boat&&priorBoat){
      // Contact is a persistent state, not a disposable shot decoration.
      // Restore anyone still gripping the same vessel, regardless of cast,
      // appearance or passenger status. An explicit exit/sink ends it.
      for(const actor of previous.objects.filter(o=>o.kind==='character'&&o.characterKey)){
        const events=(previous.animationBeats||[]).filter(b=>b.targetIds.includes(actor.id)).sort((a,b)=>a.atMs-b.atMs);
        const grip=events.filter(b=>b.action==='grab'&&b.focusTargetId===priorBoat.id).at(-1);
        if(!grip||events.some(b=>b.atMs>=grip.atMs&&(b.action==='sink'||canvasContactRelease(b))))continue;
        let occupant=scene.objects.find(o=>o.kind==='character'&&o.characterKey===actor.characterKey);
        if(!occupant){
          occupant={...actor,id:`contact-${scene.id}-${actor.characterKey}`,onBoat:undefined,pose:'reach',lookAtId:boat.id,
            keyframes:undefined,motion:'none',rotation:0,scale:1,opacity:1};
          scene.objects.push(occupant);
        }
        const currentEvents=(scene.animationBeats||[]).filter(b=>b.targetIds.includes(occupant!.id));
        if(!currentEvents.some(b=>b.action==='grab')){
          const end=currentEvents.find(b=>b.action==='sink'||canvasContactRelease(b));
          (scene.animationBeats??=[]).push({...grip,id:`contact-${scene.id}-${actor.characterKey}`,targetIds:[occupant.id],
            focusTargetId:boat.id,atMs:0,durationMs:Math.max(1,end?.atMs??scene.durationMs),speechCue:undefined,dialogueId:undefined});
        }
      }
      for(const actor of previous.objects.filter(o=>o.kind==='character'&&o.onBoat===priorBoat.id&&o.appearance!=='water-spirit'&&o.characterKey)){
        if(scene.objects.some(o=>o.characterKey===actor.characterKey)||/o lai|roi di|leaves|stays behind/.test(text))continue;
        scene.objects.push({...actor,id:`continuity-${scene.id}-${actor.characterKey}`,onBoat:boat.id,
          pose:'sit',expression:scene.objects.some(o=>o.appearance==='water-spirit')?'afraid':'neutral',
          keyframes:undefined,lookAtId:undefined,motion:'none',rotation:0,scale:1,opacity:1,
          role:'support',slot:actor.boatSeat!<0?'mid-left':'mid-right',designNotes:'Passenger remains aboard throughout this voyage.'});
      }
      for(const prop of previous.objects.filter(o=>o.kind==='prop'&&o.onBoat===priorBoat.id&&!o.heldBy)){
        if(scene.objects.some(o=>o.variant===prop.variant)||/bo lai|nem|drop|discard/.test(text))continue;
        const copy={...prop,id:`continuity-${scene.id}-${prop.variant}`,onBoat:boat.id,keyframes:undefined,motion:'none' as const};
        scene.objects.push(copy);
        for(const light of previous.effects||[])if(light.sourceObjectId===prop.id){
          (scene.effects??=[]).push({...light,id:`continuity-${scene.id}-${light.id}`,sourceObjectId:copy.id});
        }
      }
    }
    const related=resolveCanvasSpatialRelations(scene);
    Object.assign(scene,related);previous=scene;
  }
  return result;
}

/** Ground anchors match the authored shoreline's visible foreground bank. */
export function stageCanvasShore(scene:CanvasStudioScene,width:number,height:number):CanvasStudioScene {
  for(const lamp of scene.objects.filter(canvasLampMountedOnPost)){
    lamp.width=width*.045;lamp.height=height*.10;lamp.motion='none';lamp.keyframes=undefined;
  }
  if(scene.backgroundImageUrl||!['river','night'].includes(scene.background)||!scene.backgroundRef?.includes('river'))return scene;
  const text=plain(`${scene.name} ${scene.visualBrief||''} ${scene.narration||''}`);
  const people=scene.objects.filter(o=>o.kind==='character'&&!o.onBoat&&o.appearance!=='water-spirit'&&o.depth!=='background'
    &&o.role!=='background'&&o.waterlineY===undefined&&/bo dat|tren bo|ben bo|nen bo|shore|bank/.test(plain(`${o.designNotes||''} ${text}`)));
  if(people.length){
    scene.backgroundRef=scene.background==='night'?'bg:night-river-shoreline':'bg:river-shoreline';
    people.forEach((actor,index)=>{
      const fit=Math.min(actor.width/68,actor.height/100);
      actor.x=width*(people.length===1?.25:.36+index*.28);actor.y=height*.94-fit*60;
      actor.keyframes=actor.keyframes?.map(({dx,dy,...frame})=>frame);
      for(const prop of scene.objects.filter(o=>o.handling?.actorId===actor.id&&o.handling.kind==='pick-up')){
        prop.x=actor.x+fit*12*(actor.facing==='left'?-1:1);prop.y=height*.94-fit*4;fitCanvasHandProp(prop,actor);
      }
    });
    if(scene.camera){scene.camera.focusX=width*.5;scene.camera.focusY=height*.65;}
  }
  const tree=scene.objects.find(o=>o.variant==='tree'&&o.role!=='background');
  if(tree&&/goc cay|under.*tree/.test(text)){
    tree.x=width*.18;tree.height=height*.40;tree.width=width*.23;tree.y=height*.84-tree.height*.43;
    for(const prop of scene.objects.filter(o=>o.variant==='sandals'&&!o.heldBy&&!o.onBoat)){
      prop.x=tree.x+width*.035;prop.y=height*.855;prop.rotation=0;prop.motion='none';
      prop.keyframes=undefined;prop.width=width*.065;prop.height=height*.03;
    }
    scene.backgroundRef=scene.background==='night'?'bg:night-river-shoreline':'bg:river-shoreline';
  }
  return scene;
}

/** Recover unambiguous physical relationships in generated and retained plans.
 * Background boats and explicitly staged shore witnesses are not passengers. */
export function resolveCanvasSpatialRelations(source:CanvasStudioScene):CanvasStudioScene {
  const scene=structuredClone(source);
  for(const object of scene.objects)if(object.onBoat){
    const boat=scene.objects.find(o=>o.kind==='ship'&&[o.id,o.label].includes(object.onBoat!));
    if(boat)object.onBoat=boat.id;
  }
  const ferries=scene.objects.filter(o=>o.kind==='ship'&&canvasShipStyle(o)==='ferry'&&o.depth!=='background'&&o.role!=='background');
  const boat=ferries.length===1?ferries[0]:undefined;
  const context=plain(`${scene.name} ${scene.visualBrief||''} ${scene.narration||''} ${(scene.dialogue||[]).map(l=>l.text).join(' ')} ${scene.objects.filter(o=>o.kind==='character').map(o=>o.designNotes||'').join(' ')}`);
  const aboard=boat&&(/(?:tren|trong|mui|man|day|mep) (?:(?:con|long) )?do\b|cheo|giua dong|aboard|on board|gunwale|rowing/.test(context)
    ||scene.objects.some(o=>o.onBoat===boat.id||o.pose==='row')||scene.animationBeats?.some(b=>b.action==='row'));
  const passengers=scene.objects.filter(o=>o.kind==='character'&&o.appearance!=='water-spirit'&&o.depth!=='background'&&o.role!=='background'
    &&!/(?:dung|o|tren) (?:ben |tren )?bo\b|bo xa|shore witness|on (?:the )?bank|swimmer|boi|duoi nuoc/.test(plain(o.designNotes||'')));
  if(aboard&&boat)for(const [index,actor] of [...passengers].sort((a,b)=>(a.characterKey||a.label).localeCompare(b.characterKey||b.label)).entries()){
    if(actor.onBoat)continue;
    actor.onBoat=boat.id;actor.boatSeat=passengers.length===1?0:(index-(passengers.length-1)/2)*.32;
    actor.motion='none';actor.scale=1;actor.rotation=0;
    actor.keyframes=actor.keyframes?.map(({dx,dy,scale,rotation,...frame})=>frame);
  }
  if(boat){
    const seated=passengers.filter(o=>o.onBoat===boat.id).sort((a,b)=>(a.characterKey||a.label).localeCompare(b.characterKey||b.label));
    if(seated.length>1&&new Set(seated.map(o=>o.boatSeat??0)).size<seated.length){
      seated.forEach((actor,index)=>actor.boatSeat=(index-(seated.length-1)/2)*Math.min(.32,.56/(seated.length-1)));
    }
  }
  const rowers=passengers.filter(o=>o.onBoat&& (o.pose==='row'||scene.animationBeats?.some(b=>b.action==='row'&&b.targetIds.includes(o.id))));
  for(const actor of rowers){
    const start=scene.animationBeats?.find(b=>b.action==='row'&&b.targetIds.includes(actor.id))?.atMs??0;
    actor.pose='row';
    actor.keyframes=actor.keyframes?.map(frame=>frame.atMs>=start&&['idle','talk'].includes(frame.pose||'')?{...frame,pose:'row'}:frame);
  }
  for(const prop of scene.objects.filter(o=>o.kind==='prop')){
    const handling=scene.animationBeats?.find(b=>['reach','grab'].includes(b.action)&&b.focusTargetId===prop.id
      &&/nhat|nhac|pick up|dat.*(?:dep|vat)|place|put down/.test(plain(b.speechCue||'')));
    const handler=handling&&scene.objects.find(o=>handling.targetIds.includes(o.id)&&o.kind==='character');
    if(handling&&handler&&prop.variant==='sandals'){
      prop.handling={actorId:handler.id,kind:/nhat|nhac|pick up/.test(plain(handling.speechCue||''))?'pick-up':'place',atMs:handling.atMs,durationMs:handling.durationMs};
      prop.heldBy=undefined;prop.motion='none';prop.keyframes=undefined;
      // Cue timing owns the handling pose. AI's pre-TTS pose/travel keys
      // otherwise start a second reach earlier than the measured sentence.
      handler.keyframes=handler.keyframes?.map(({dx,dy,rotation,pose,...frame})=>({...frame,...(pose&&pose!=='reach'?{pose}:{})}));
      scene.animationBeats=scene.animationBeats?.filter(b=>!(b.action==='grab'&&b.focusTargetId===prop.id&&!b.speechCue&&b.atMs>handling.atMs));
    }
    if(prop.heldBy){
      const holder=scene.objects.find(o=>o.kind==='character'&&[o.id,o.label,o.characterKey].includes(prop.heldBy));
      if(holder)prop.heldBy=holder.id;
    }
    if(!prop.heldBy&&prop.variant==='oar'&&rowers.length===1)prop.heldBy=rowers[0]!.id;
    const lampNotes=plain(`${prop.label} ${prop.designNotes||''}`);
    const fixedLamp=prop.variant==='lantern'&&/(?:gan|dat|treo|co dinh|mounted|fixed|placed)[^.!?;]{0,80}(?:coc|ban|tuong|vach|post|table|wall)|coc den/.test(lampNotes);
    if(fixedLamp&&!prop.handling)prop.heldBy=undefined;
    if(!prop.heldBy&&!fixedLamp&&prop.variant==='lantern'&&prop.depth!=='background'&&prop.role!=='background'
      &&!/mui do|man do|bow|gunwale|phia xa|ngoai ben|treo (?:tuong|vach)/.test(lampNotes)){
      const named=scene.objects.filter(o=>o.kind==='character'&&[o.characterKey,o.label].filter(Boolean)
        .some(name=>plain(prop.designNotes||'').includes(`tay ${plain(name!)}`)));
      const carrying=scene.objects.filter(o=>o.kind==='character'&&o.appearance!=='water-spirit'
        &&/\b(?:cam|giu)\s+(?:(?:chiec|cai|mot|chat)\s+){0,2}den\b|\b(?:holding|carrying)\s+(?:(?:a|the)\s+)?(?:lantern|lamp)\b/.test(plain(o.designNotes||''))
        &&!/(?:khong|chua|never|not)\s+(?:cam|giu|holding|carrying)/.test(plain(o.designNotes||'')));
      if(named.length===1)prop.heldBy=named[0]!.id;
      else if(carrying.length===1)prop.heldBy=carrying[0]!.id;
    }
    if(!prop.heldBy&&prop.variant==='rope'){
      const grips=scene.animationBeats?.filter(b=>['grab','brace'].includes(b.action)&&b.focusTargetId===prop.id)
        .flatMap(b=>b.targetIds).filter(id=>scene.objects.some(o=>o.id===id&&o.kind==='character'))||[];
      const owners=[...new Set(grips)];if(owners.length===1)prop.heldBy=owners[0];
      if(!prop.heldBy){
        const note=plain(prop.designNotes||'');
        const named=scene.objects.filter(o=>o.kind==='character'&&/co tay|gi[uư] vung|cam|nam/.test(note)
          &&[o.characterKey,o.label].filter(Boolean).some(name=>note.includes(plain(name!))));
        if(named.length===1)prop.heldBy=named[0]!.id;
      }
    }
    if(prop.heldBy&&prop.variant==='lantern'&&!prop.heldHand){
      const holder=scene.objects.find(o=>o.id===prop.heldBy);if(!holder)continue;
      if(/tay trai|left hand/.test(plain(holder.designNotes||''))||scene.objects.some(o=>o.id!==prop.id&&o.heldBy===holder.id)
        ||scene.animationBeats?.some(b=>b.targetIds.includes(holder.id)&&['reach','tie','grab'].includes(b.action)&&b.focusTargetId!==prop.id))prop.heldHand='left';
    }
    if(aboard&&boat&&!prop.heldBy&&['lantern','sandals'].includes(prop.variant||'')&&/mui do|man do|mep do|bow|gunwale/.test(plain(`${prop.label} ${prop.designNotes||''}`))){
      const placing=scene.animationBeats?.find(b=>['reach','tie'].includes(b.action)&&b.focusTargetId===prop.id);
      const actor=placing&&scene.objects.find(o=>placing.targetIds.includes(o.id)&&o.onBoat===boat.id);
      prop.onBoat=boat.id;prop.boatSeat=actor?Math.max(-.36,Math.min(.36,(actor.boatSeat??0)+(actor.facing==='left'?-.07:.07))):.36;prop.motion='none';prop.scale=1;
      prop.keyframes=prop.keyframes?.map(({dx,dy,scale,...frame})=>frame);
    }
  }
  return scene;
}

/** Structural QC supplements authored-asset coverage. A valid asset alone
 * cannot prove that its owner or vessel actually exists in this shot. */
export function canvasSpatialIssues(scene:CanvasStudioScene):string[]{
  const issues:string[]=[];
  for(const object of scene.objects){
    if(object.handling&&!scene.objects.some(o=>o.id===object.handling!.actorId&&o.kind==='character'))issues.push(`${object.label}: handling does not reference an actor in this scene.`);
    if(object.onBoat&&!scene.objects.some(o=>o.id===object.onBoat&&o.kind==='ship'))issues.push(`${object.label}: onBoat does not reference a ship in this scene.`);
    if(object.heldBy&&!scene.objects.some(o=>o.id===object.heldBy&&o.kind==='character'))issues.push(`${object.label}: heldBy does not reference an actor in this scene.`);
    if(object.heldBy){
      const actor=scene.objects.find(o=>o.id===object.heldBy);
      if(actor&&['lantern','phone','rope','sandals'].includes(object.variant||'')&&object.height>actor.height*.5)
        issues.push(`${object.label}: handheld equipment is larger than half its holder's body.`);
    }
  }
  return issues;
}

/** A boat grip is above water. Only an authored underwater shot or an ankle
 * grip on a submerged swimmer may use the underwater insert. */
export function canvasUnderwaterInsert(scene:CanvasStudioScene,timeMs:number):boolean {
  if(scene.background==='underwater')return true;
  return Boolean(scene.animationBeats?.some(beat=>{
    if(beat.action!=='grab'||timeMs<beat.atMs-250||timeMs>beat.atMs+beat.durationMs)return false;
    const target=scene.objects.find(o=>o.id===beat.focusTargetId);
    return target?.kind==='character'&&target.waterlineY!==undefined&&!target.onBoat;
  }));
}

export function fitCanvasHandProp(prop:CanvasStudioObject,holder:CanvasStudioObject){
  const fit=Math.min(holder.width/68,holder.height/100);
  const size:Record<string,[number,number]>={phone:[9,22],lantern:[14,25],rope:[22,12],sandals:[18,9],oar:[78,18]};
  const dimensions=size[prop.variant||''];if(!dimensions)return;
  prop.width=fit*dimensions[0];prop.height=fit*dimensions[1];prop.scale=1;
  prop.keyframes=prop.keyframes?.map(frame=>({...frame,scale:1}));
}
