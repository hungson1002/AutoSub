import type {CanvasStudioObject,CanvasStudioProject,CanvasStudioScene} from './canvasAnimationStudio';
import {CANVAS_AUTHORED_BACKGROUNDS} from './canvasAssetRegistry';

const INSERT_TEMPLATES=new Set(['prop-focus','close-reaction','foreground-pov']);
const INSERT_SHOTS=new Set(['close-up','extreme-close-up','pov']);
const TRAVEL_ACTIONS=new Set(['run','walk','walk-left','walk-right','row','assist','aid','reach','grab','tie','wipe','write']);
const norm=(value:string|undefined)=>(value||'').normalize('NFD').replace(/\p{M}/gu,'').trim().toLowerCase().replace(/đ/g,'d');

const PERSISTENT_STAGE_PROP_VARIANTS=new Set([
  'table','chair','bed','lantern','door','window','fire','basket','stairs','barrel','box','bamboo',
]);
const CLEAN_INSERT_TEMPLATES=new Set(['prop-focus','foreground-pov','over-shoulder']);

function isPersistentStageProp(object:CanvasStudioObject){
  return object.kind==='prop'
    && !!object.variant
    && PERSISTENT_STAGE_PROP_VARIANTS.has(object.variant)
    && object.role!=='focal'
    && !object.heldBy
    && !object.onBoat
    && !object.handling;
}
function persistentStagePropKey(object:CanvasStudioObject){
  return `${object.variant||'prop'}:${norm(object.label)}`;
}
function staticStageProp(object:CanvasStudioObject):CanvasStudioObject{
  return {...object,
    keyframes:undefined,
    motion:'none',
    delayMs:0,
    handling:undefined,
    heldBy:undefined,
    heldHand:undefined,
    onBoat:undefined,
  };
}

function uniqueSemanticKey(object:CanvasStudioObject,scene:CanvasStudioScene){
  if(object.characterKey)return `character:${object.characterKey}`;
  if(object.assetKey)return `asset:${object.assetKey}`;
  // Recurring furniture/props are usually regenerated with a fresh object id on
  // every AI shot. Prefer their semantic variant+label when unambiguous so the
  // physical set can stay pixel-stable across cuts.
  if(object.kind==='prop'&&object.variant){
    const label=norm(object.label);
    const peers=scene.objects.filter(candidate=>candidate.kind==='prop'&&candidate.variant===object.variant&&norm(candidate.label)===label);
    if(peers.length===1)return `prop:${object.variant}:${label}`;
  }
  if(object.id&&scene.objects.filter(candidate=>candidate.id===object.id).length===1)return `id:${object.id}`;
  return undefined;
}

function sceneIdentityMap(scene:CanvasStudioScene){
  const map=new Map<string,CanvasStudioObject>();
  for(const object of scene.objects){
    const key=uniqueSemanticKey(object,scene);
    if(key)map.set(key,object);
  }
  return map;
}

function locationKey(scene:CanvasStudioScene){
  if(scene.stageId)return `stage:${scene.stageId}`;
  if(scene.backgroundImageUrl)return `image:${scene.backgroundImageUrl}`;
  if(scene.backgroundAssetId)return `asset:${scene.backgroundAssetId}`;
  if(scene.backgroundRef==='bg:composed'&&scene.backgroundSpec)return `composed:${JSON.stringify(scene.backgroundSpec)}`;
  return `${scene.backgroundRef||''}|${scene.background}`;
}

const slotSide=(slot:string|undefined)=>slot?.includes('left')?-1:slot?.includes('right')?1:0;
const swapSlotSide=(slot:any):any=>{
  if(!slot)return slot;
  if(slot.includes('left'))return slot.replace('left','right');
  if(slot.includes('right'))return slot.replace('right','left');
  return slot;
};

function hasTravel(scene:CanvasStudioScene,object:CanvasStudioObject){
  if(object.onBoat||object.heldBy||object.environmentAnchor==='doorway')return true;
  if(['walk-left','walk-right'].includes(object.motion))return true;
  if(object.keyframes?.some(frame=>Math.abs(frame.dx||0)>8||Math.abs(frame.dy||0)>8))return true;
  return !!scene.animationBeats?.some(beat=>beat.targetIds.includes(object.id)&&TRAVEL_ACTIONS.has(beat.action));
}

function intentionalInsert(previous:CanvasStudioScene,current:CanvasStudioScene,previousMap:Map<string,CanvasStudioObject>,currentMap:Map<string,CanvasStudioObject>){
  const changedTemplate=current.template!==previous.template;
  const changedShot=current.camera?.shot!==previous.camera?.shot;
  if(!changedTemplate&&!changedShot)return false;
  const insertTemplate=INSERT_TEMPLATES.has(current.template||'');
  const insertShot=INSERT_SHOTS.has(current.camera?.shot||'');
  if(!insertTemplate&&!insertShot)return false;
  // Close reaction / POV / prop inserts are real editorial cuts even when the
  // focal actor persists. They are fundamentally different viewpoints, not a
  // layout side effect from adding support assets.
  if(insertTemplate||insertShot)return true;
  const focals=current.objects.filter(object=>object.role==='focal'&&object.kind!=='text');
  if(!focals.length)return true;
  return focals.some(focal=>{
    const focalKey=uniqueSemanticKey(focal,current);
    return !focalKey||!previousMap.has(focalKey)||!currentMap.has(focalKey);
  });
}

function continuityPair(previous:CanvasStudioScene,current:CanvasStudioScene,allowEditorialInsert=false){
  // Raw/manual stages intentionally own their pixel coordinates. Semantic
  // continuity only participates once layout metadata exists.
  if(!previous.template&&!current.template)return false;
  const explicitSameStage=Boolean(previous.stageId&&current.stageId&&previous.stageId===current.stageId);
  if(previous.stageId&&current.stageId&&previous.stageId!==current.stageId)return false;
  if(!explicitSameStage&&locationKey(previous)!==locationKey(current))return false;
  const previousMap=sceneIdentityMap(previous),currentMap=sceneIdentityMap(current);
  const previousActors=[...previousMap].filter(([,object])=>object.kind==='character').map(([key])=>key);
  const currentActors=new Set([...currentMap].filter(([,object])=>object.kind==='character').map(([key])=>key));
  const sharedActors=previousActors.filter(key=>currentActors.has(key));
  const previousPrimary=[...previousMap].filter(([,object])=>object.kind==='character'||object.role==='focal').map(([key])=>key);
  const sharedPrimary=previousPrimary.filter(key=>currentMap.has(key));
  if(!explicitSameStage&& !sharedActors.length&&sharedPrimary.length<1)return false;
  // A recurring character in the same environment is a stronger continuity
  // signal than the number of props around them. A Director-authored stageId
  // is an even stronger physical-set contract and may span empty inserts.
  if(!explicitSameStage&&!sharedActors.length){
    const ratio=sharedPrimary.length/Math.max(1,previousPrimary.length);
    if(ratio<.5)return false;
  }
  if(!allowEditorialInsert&&intentionalInsert(previous,current,previousMap,currentMap))return false;
  return true;
}

export function stabilizeCanvasSceneContinuity(project:CanvasStudioProject):CanvasStudioProject{
  const scenes=project.scenes.map(scene=>({...scene,objects:scene.objects.map(object=>({...object}))}));
  // Physical stages can recur after intervening cuts. Remember the first
  // authored set for every stageId across the whole project, not just adjacent
  // scenes, and reuse it whenever that set supports the new framing.
  const stageSets=new Map<string,Pick<CanvasStudioScene,'background'|'backgroundRef'|'backgroundSpec'|'backgroundImageUrl'|'backgroundAssetId'>>();
  const stageProps=new Map<string,CanvasStudioObject[]>();
  for(const scene of scenes){
    if(!scene.stageId)continue;
    const remembered=stageSets.get(scene.stageId);
    if(!remembered){
      stageSets.set(scene.stageId,{background:scene.background,backgroundRef:scene.backgroundRef,backgroundSpec:scene.backgroundSpec,backgroundImageUrl:scene.backgroundImageUrl,backgroundAssetId:scene.backgroundAssetId});
    }else{
      const definition=CANVAS_AUTHORED_BACKGROUNDS.find(item=>item.id===remembered.backgroundRef);
      const dedicatedDetail=/underfloor|floor-detail/.test(scene.backgroundRef||'');
      if(definition?.templates.includes(scene.template!)&&!dedicatedDetail){
        scene.background=remembered.background;
        scene.backgroundRef=remembered.backgroundRef;
        scene.backgroundSpec=remembered.backgroundSpec;
        scene.backgroundImageUrl=remembered.backgroundImageUrl;
        scene.backgroundAssetId=remembered.backgroundAssetId;
      }
    }

    const rememberedProps=stageProps.get(scene.stageId)||[];
    const dedicatedDetail=/underfloor|floor-detail/.test(scene.backgroundRef||'');
    if(rememberedProps.length&&!dedicatedDetail&&!CLEAN_INSERT_TEMPLATES.has(scene.template||'')){
      const present=new Set(scene.objects.filter(isPersistentStageProp).map(persistentStagePropKey));
      for(const prop of rememberedProps){
        const key=persistentStagePropKey(prop);
        if(present.has(key))continue;
        scene.objects.push(staticStageProp(prop));
        present.add(key);
      }
    }
    // Editorial inserts may contain a temporary support door/table purely for
    // composition. They must not redefine the physical set remembered for the
    // next normal shot.
    if(!dedicatedDetail&&!CLEAN_INSERT_TEMPLATES.has(scene.template||'')){
      const merged=new Map((stageProps.get(scene.stageId)||[]).map(prop=>[persistentStagePropKey(prop),prop]));
      for(const prop of scene.objects.filter(isPersistentStageProp))merged.set(persistentStagePropKey(prop),staticStageProp(prop));
      stageProps.set(scene.stageId,[...merged.values()]);
    }
  }
  for(let index=1;index<scenes.length;index+=1){
    const previous=scenes[index-1]!,current=scenes[index]!;
    if(!continuityPair(previous,current,true))continue;
    const previousMap=sceneIdentityMap(previous),currentMap=sceneIdentityMap(current);
    const editorialCut=intentionalInsert(previous,current,previousMap,currentMap);
    const explicitSameStage=Boolean(previous.stageId&&current.stageId&&previous.stageId===current.stageId);
    if(explicitSameStage&&previous.backgroundRef&&current.backgroundRef!==previous.backgroundRef){
      const previousSet=CANVAS_AUTHORED_BACKGROUNDS.find(item=>item.id===previous.backgroundRef);
      const dedicatedDetail=/underfloor|floor-detail/.test(current.backgroundRef||'');
      // A stageId is a physical-set contract. Reuse the same authored set when
      // it can render the new framing; only a truly dedicated detail/crawlspace
      // insert may swap to another authored background.
      if(previousSet?.templates.includes(current.template!)&&!dedicatedDetail){
        current.background=previous.background;
        current.backgroundRef=previous.backgroundRef;
        current.backgroundSpec=previous.backgroundSpec;
        current.backgroundImageUrl=previous.backgroundImageUrl;
        current.backgroundAssetId=previous.backgroundAssetId;
      }
    }
    // Ambient systems (rain, fire, authored background motion) must not restart
    // at zero when an editor/AI splits one continuous place into another scene.
    const previousOffset=previous.atmosphere?.timeOffsetMs||0;
    current.atmosphere={...current.atmosphere,timeOffsetMs:previousOffset+previous.durationMs};
    const currentCharacterKeys=new Set(current.objects.filter(object=>object.kind==='character'&&object.characterKey).map(object=>object.characterKey!));
    const previousCameraKeys=(previous.continuityCameraCharacterKeys?.length
      ? previous.continuityCameraCharacterKeys
      : previous.objects.filter(object=>object.kind==='character'&&object.characterKey&&object.role!=='background'&&object.depth!=='background').map(object=>object.characterKey!))
      .filter(key=>currentCharacterKeys.has(key));
    if(previousCameraKeys.length)current.continuityCameraCharacterKeys=[...new Set(previousCameraKeys)];
    for(const [key,object] of currentMap){
      const anchor=previousMap.get(key);
      if(!anchor||hasTravel(current,object))continue;
      if(!editorialCut){
        for(const field of ['x','y','width','height','scale','rotation','slot','depth','sizeClass'] as const)
          (object as any)[field]=(anchor as any)[field];
        if(!current.animationBeats?.some(beat=>beat.targetIds.includes(object.id)||beat.focusTargetId===object.id))
          object.zIndex=anchor.zIndex;
      }else if(object.kind==='character'){
        // Real inserts may reframe/resize, but they still obey screen direction.
        // Keep recurring actors on the same side unless choreography explicitly
        // travels them across the frame, and preserve facing unless authored.
        const priorSide=anchor.x<project.width*.45?-1:anchor.x>project.width*.55?1:slotSide(anchor.slot);
        const currentSide=object.x<project.width*.45?-1:object.x>project.width*.55?1:slotSide(object.slot);
        if(priorSide&&currentSide&&priorSide!==currentSide){
          object.x=project.width-object.x;
          object.slot=swapSlotSide(object.slot);
        }
        const authoredFacing=object.keyframes?.some(frame=>frame.facing!==undefined)
          || current.animationBeats?.some(beat=>beat.targetIds.includes(object.id)&&TRAVEL_ACTIONS.has(beat.action));
        if(!authoredFacing&&anchor.facing)object.facing=anchor.facing;
      }
    }

    const previousKeys=new Set(previousMap.keys());
    for(const [key,object] of currentMap){
      // Persistent furniture belongs to the physical stage and may simply have
      // been outside the previous insert's crop. Never animate it as a new
      // arrival when the same stage returns.
      if((current.stageId&&isPersistentStageProp(object))||previousKeys.has(key)||(editorialCut&&object.role==='focal')||object.keyframes?.length||object.motion!=='none'||object.heldBy||object.onBoat||object.environmentAnchor==='doorway')continue;
      if(current.animationBeats?.some(beat=>beat.targetIds.includes(object.id)||beat.focusTargetId===object.id))continue;
      const enterMs=Math.min(360,Math.max(240,Math.round(current.durationMs*.085)));
      if(object.kind==='character'){
        const fromRight=object.x>=project.width*.5;
        object.keyframes=[
          {atMs:0,opacity:0,dx:fromRight?16:-16},
          {atMs:enterMs,opacity:1,dx:0,easing:'ease-out'},
        ];
      }else{
        object.keyframes=[
          {atMs:0,opacity:0,scale:.96},
          {atMs:enterMs,opacity:1,scale:1,easing:'ease-out'},
        ];
      }
    }
    const persistentCurrent=[...currentMap.keys()].filter(key=>previousKeys.has(key));
    const addedEntries=[...currentMap].filter(([key])=>!previousKeys.has(key));
    const removedEntries=[...previousMap].filter(([key])=>!currentMap.has(key));
    const editorialCloseShot=['close-up','extreme-close-up','pov'].includes(current.camera?.shot||'')
      || ['prop-focus','close-reaction','foreground-pov','over-shoulder'].includes(current.template||'');
    const disruptiveEntry=(object:CanvasStudioObject)=>object.kind==='ship'
      || object.environmentAnchor==='doorway'
      || !!object.onBoat
      || !!object.heldBy
      || !!object.handling
      // A newly added focal person/prop must not recenter an established wide
      // or medium stage. It becomes disruptive only when the shot itself is an
      // authored insert/reaction/POV that intentionally isolates that subject.
      || (object.role==='focal'&&editorialCloseShot);
    const sameFramingIntent=current.template===previous.template
      && current.camera?.shot===previous.camera?.shot;
    // Same-place continuity must not depend on how many decorative/supporting
    // objects the planner happens to add or remove. Preserve the established
    // stage whenever recurring subjects remain and all churn is non-focal.
    // A true focal/vehicle/architectural change is still free to reframe.
    const additiveContinuation=!editorialCut&&persistentCurrent.length>0
      && (sameFramingIntent
        || (addedEntries.every(([,object])=>!disruptiveEntry(object))
          && removedEntries.every(([,object])=>!disruptiveEntry(object))));
    if(additiveContinuation){
      current.template=previous.template;
      if(previous.camera&&current.camera){
        const lastChannel=(frames:any[]|undefined,key:'dx'|'dy'|'zoom'|'rotation',fallback:number)=>{
          let value=fallback;
          for(const frame of [...(frames||[])].sort((a,b)=>a.atMs-b.atMs)){
            if(frame.atMs>previous.durationMs)break;
            if(frame[key]!==undefined&&Number.isFinite(Number(frame[key])))value=Number(frame[key]);
          }
          return value;
        };
        const startChannel=(frames:any[]|undefined,key:'dx'|'dy'|'zoom'|'rotation',fallback:number)=>{
          const frame=[...(frames||[])].sort((a,b)=>a.atMs-b.atMs).find(item=>item[key]!==undefined&&Number.isFinite(Number(item[key])));
          return frame&&frame.atMs<=0?Number(frame[key]):fallback;
        };
        const previousEnd={
          dx:lastChannel(previous.camera.keyframes,'dx',0),
          dy:lastChannel(previous.camera.keyframes,'dy',0),
          zoom:lastChannel(previous.camera.keyframes,'zoom',previous.camera.zoom||1),
          rotation:lastChannel(previous.camera.keyframes,'rotation',0),
        };
        const frames=[...(current.camera.keyframes||[])].sort((a,b)=>a.atMs-b.atMs);
        if(frames.length){
          const starts={
            dx:startChannel(frames,'dx',0),
            dy:startChannel(frames,'dy',0),
            zoom:startChannel(frames,'zoom',current.camera.zoom||1),
            rotation:startChannel(frames,'rotation',0),
          };
          const shifted=frames.map(frame=>({...frame,
            dx:frame.dx===undefined?undefined:frame.dx+(previousEnd.dx-starts.dx),
            dy:frame.dy===undefined?undefined:frame.dy+(previousEnd.dy-starts.dy),
            zoom:frame.zoom===undefined?undefined:Math.max(.05,frame.zoom+(previousEnd.zoom-starts.zoom)),
            rotation:frame.rotation===undefined?undefined:frame.rotation+(previousEnd.rotation-starts.rotation),
          }));
          // Numeric keyframe channels are independent. Seed every channel at t=0
          // with the exact previous final camera state so a scene boundary can
          // never fall back to the runtime defaults for one frame.
          const first=shifted[0];
          if(first?.atMs===0)Object.assign(first,{dx:previousEnd.dx,dy:previousEnd.dy,zoom:previousEnd.zoom,rotation:previousEnd.rotation});
          else shifted.unshift({atMs:0,...previousEnd,easing:'linear'} as any);
          current.camera={...current.camera,shot:previous.camera.shot,focusX:previous.camera.focusX,focusY:previous.camera.focusY,zoom:previousEnd.zoom,keyframes:shifted};
        }else{
          current.camera={...current.camera,shot:previous.camera.shot,focusX:previous.camera.focusX,focusY:previous.camera.focusY,zoom:previousEnd.zoom,motion:'none',keyframes:undefined};
        }
      }
    }
  }
  return {...project,scenes};
}

export function canvasScenesShareStage(previous:CanvasStudioScene|undefined,current:CanvasStudioScene){
  return !!previous&&continuityPair(previous,current);
}
