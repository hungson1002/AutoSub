import type {
  CanvasObjectKeyframe,
  CanvasStudioObject,
  CanvasStudioProject,
  CanvasStudioScene,
  CanvasVisualBeat,
} from './canvasAnimationStudio';

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

function scalePreservingAspect(object:CanvasStudioObject,targetWidth:number,targetHeight:number){
  const aspect=Math.max(.18,Math.min(5,object.width/Math.max(1,object.height)));
  let width=targetWidth,height=width/aspect;
  if(height>targetHeight){height=targetHeight;width=height*aspect;}
  return {width,height};
}

function focalOf(scene:CanvasStudioScene){
  return scene.objects.find(object=>object.role==='focal'&&object.kind!=='text')
    ||scene.objects.find(object=>object.kind==='character')
    ||scene.objects.find(object=>object.kind==='prop');
}

function ensureKeyframe(
  object:CanvasStudioObject,
  frame:CanvasObjectKeyframe,
  match:(candidate:CanvasObjectKeyframe)=>boolean,
){
  const keyframes=[...(object.keyframes||[])];
  const index=keyframes.findIndex(match);
  if(index>=0)keyframes[index]={...keyframes[index]!,...frame};
  else keyframes.push(frame);
  keyframes.sort((a,b)=>a.atMs-b.atMs);
  return {...object,keyframes};
}

function directExpressionBeat(scene:CanvasStudioScene,beat:CanvasVisualBeat){
  if(beat.action!=='expression-change'||!beat.expression||beat.atMs<450)return scene;
  const targets=new Set(beat.targetIds);
  return {
    ...scene,
    objects:scene.objects.map(object=>{
      if(object.kind!=='character'||!targets.has(object.id))return object;
      // If the actor already starts in the destination expression, the authored
      // beat has zero visual delta. Start neutral and let the keyframe perform
      // the intended reaction.
      return object.expression===beat.expression?{...object,expression:'neutral' as const}:object;
    }),
  };
}

function revealTargetReadable(
  object:CanvasStudioObject,
  scene:CanvasStudioScene,
  beat:CanvasVisualBeat,
  width:number,
  height:number,
){
  const supernatural=object.variant==='ghost'||object.variant==='demon-dog';
  const background=object.depth==='background'||object.role==='background';
  const minHeight=supernatural
    ? height*(object.variant==='demon-dog'?.28:background?.22:.26)
    : height*(background?.18:.22);
  let next=object;
  if(object.height<minHeight){
    const ratio=minHeight/Math.max(1,object.height);
    next={...next,height:minHeight,width:object.width*ratio};
  }
  // Reveals belong inside the readable 72% center of the frame. Extreme edge
  // staging is atmospheric but too easy to miss on phone-size playback.
  next={...next,x:clamp(next.x,width*.14,width*.86),y:clamp(next.y,height*.22,height*.76)};
  const endOpacity=Math.max(supernatural?.72:.68,beat.opacity??1);
  const endAt=clamp(beat.atMs+Math.max(1,beat.durationMs),0,scene.durationMs);
  next=ensureKeyframe(next,{atMs:beat.atMs,opacity:0,visualBeatId:beat.id,visualBeatPhase:'start',easing:'hold'},
    frame=>frame.visualBeatId===beat.id&&frame.visualBeatPhase==='start');
  next=ensureKeyframe(next,{atMs:endAt,opacity:endOpacity,visualBeatId:beat.id,visualBeatPhase:'end',easing:'ease-out'},
    frame=>frame.visualBeatId===beat.id&&frame.visualBeatPhase==='end');
  return next;
}

function directRevealBeat(scene:CanvasStudioScene,beat:CanvasVisualBeat,width:number,height:number){
  if(beat.action!=='reveal-layer')return scene;
  const targets=new Set(beat.targetIds);
  return {
    ...scene,
    objects:scene.objects.map(object=>targets.has(object.id)
      ?revealTargetReadable(object,scene,beat,width,height)
      :object),
  };
}

function directDrawOnBeat(scene:CanvasStudioScene,beat:CanvasVisualBeat,width:number,height:number){
  if(beat.action!=='draw-on')return scene;
  const targets=new Set(beat.targetIds);
  return {
    ...scene,
    objects:scene.objects.map(object=>{
      if(!targets.has(object.id)||object.kind!=='prop')return object;
      const targetWidth=scene.template==='prop-focus'?width*.30:width*.18;
      if(object.width>=targetWidth)return object;
      const size=scalePreservingAspect(object,targetWidth,height*.48);
      return {...object,...size,role:scene.template==='prop-focus'?'focal':object.role,sizeClass:scene.template==='prop-focus'?'hero':object.sizeClass};
    }),
  };
}

function directLightBeat(scene:CanvasStudioScene,beat:CanvasVisualBeat){
  if(beat.action!=='light-change'||beat.lightLevel===undefined)return scene;
  const requestedLight=beat.lightLevel;
  const targets=new Set(beat.targetIds);
  return {
    ...scene,
    objects:scene.objects.map(object=>{
      if(!targets.has(object.id))return object;
      const start=object.lightLevel??1;
      let end=clamp(requestedLight,0,1);
      // A practical-light beat needs a visible exposure delta. 0.12 on a tiny
      // local glow reads as metadata, not direction.
      if(Math.abs(start-end)<.34)end=end<=start?Math.max(0,start-.4):Math.min(1,start+.4);
      let next=ensureKeyframe(object,{atMs:beat.atMs,lightLevel:start,visualBeatId:beat.id,visualBeatPhase:'start',easing:'hold'},
        frame=>frame.visualBeatId===beat.id&&frame.visualBeatPhase==='start');
      next=ensureKeyframe(next,{atMs:clamp(beat.atMs+beat.durationMs,0,scene.durationMs),lightLevel:end,visualBeatId:beat.id,visualBeatPhase:'end',easing:'ease-in-out'},
        frame=>frame.visualBeatId===beat.id&&frame.visualBeatPhase==='end');
      return next;
    }),
  };
}

function directPerformanceReadability(scene:CanvasStudioScene,width:number,height:number){
  const performanceActions=new Set(['nod','react','brace','gesture','point']);
  const beat=scene.animationBeats?.find(item=>performanceActions.has(item.action));
  if(!beat)return scene;
  const targetIds=new Set(beat.targetIds);
  const actor=scene.objects.find(object=>object.kind==='character'&&targetIds.has(object.id));
  if(!actor)return scene;
  const minRatio=scene.template==='wide-establishing'?.32
    :scene.template==='close-reaction'?.46
      :.40;
  const targetHeight=Math.max(actor.height,height*minRatio);
  const ratio=targetHeight/Math.max(1,actor.height);
  const slot=actor.x<width*.5?'hero-left':'hero-right';
  const objects=scene.objects.map(object=>object.id===actor.id?{
    ...object,
    role:'focal' as const,
    slot:slot as typeof object.slot,
    depth:object.depth==='background'?'midground' as const:object.depth,
    sizeClass:targetHeight>=height*.46?'hero' as const:'large' as const,
    height:targetHeight,
    width:object.width*ratio,
  }:object);
  const updated=objects.find(object=>object.id===actor.id)!;
  const focusY=updated.y-updated.height*.16;
  return {
    ...scene,
    objects,
    camera:scene.camera?{
      ...scene.camera,
      focusX:clamp(updated.x,width*.16,width*.84),
      focusY:clamp(focusY,height*.16,height*.82),
    }:scene.camera,
  };
}

function directShotReadability(scene:CanvasStudioScene,width:number,height:number){
  const focal=focalOf(scene);
  if(!focal)return scene;
  let objects=scene.objects;
  if(scene.template==='close-reaction'&&focal.kind==='character'){
    const minHeight=height*.46,maxHeight=height*.68;
    const target=clamp(focal.height,minHeight,maxHeight);
    if(Math.abs(target-focal.height)>.5){
      const ratio=target/Math.max(1,focal.height);
      objects=objects.map(object=>object.id===focal.id?{...object,height:target,width:object.width*ratio,sizeClass:'hero' as const}:object);
    }
  }else if(scene.template==='prop-focus'&&focal.kind==='prop'){
    const minWidth=width*.28;
    if(focal.width<minWidth){
      const size=scalePreservingAspect(focal,minWidth,height*.52);
      objects=objects.map(object=>object.id===focal.id?{...object,...size,sizeClass:'hero' as const,depth:'foreground' as const}:object);
    }
  }else if((scene.template==='hero-left'||scene.template==='hero-right')&&focal.kind==='character'){
    const minHeight=height*.34;
    if(focal.height<minHeight){
      const ratio=minHeight/Math.max(1,focal.height);
      objects=objects.map(object=>object.id===focal.id?{...object,height:minHeight,width:object.width*ratio,sizeClass:'large' as const}:object);
    }
  }
  const updated=objects.find(object=>object.id===focal.id)||focal;
  const close=scene.template==='close-reaction'||scene.template==='prop-focus';
  const focusY=updated.kind==='character'?updated.y-updated.height*.20:updated.y;
  return {
    ...scene,
    objects,
    camera:scene.camera&&close?{
      ...scene.camera,
      focusX:clamp(updated.x,width*.16,width*.84),
      focusY:clamp(focusY,height*.16,height*.82),
    }:scene.camera,
  };
}

/**
 * Deterministic senior-director pass. It never rewrites narration or changes a
 * physical stage. It converts authored intent into minimum on-screen readability
 * so QC can reason about what a viewer actually sees, not merely that a beat
 * exists in JSON.
 */
export function compileCanvasProfessionalDirection(project:CanvasStudioProject):CanvasStudioProject{
  return {
    ...project,
    scenes:project.scenes.map(original=>{
      let scene=directPerformanceReadability(original,project.width,project.height);
      scene=directShotReadability(scene,project.width,project.height);
      for(const beat of scene.visualBeats||[]){
        scene=directExpressionBeat(scene,beat);
        scene=directRevealBeat(scene,beat,project.width,project.height);
        scene=directDrawOnBeat(scene,beat,project.width,project.height);
        scene=directLightBeat(scene,beat);
      }
      return scene;
    }),
  };
}
