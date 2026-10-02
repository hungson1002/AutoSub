import type {
  CanvasDepthLayer,
  CanvasLayoutSlot,
  CanvasObjectKind,
  CanvasSceneTemplate,
  CanvasSizeClass,
  CanvasStudioObject,
  CanvasStudioProject,
  CanvasStudioScene,
} from './canvasAnimationStudio';
import { attachCanvasArchitecture } from './canvasEnvironment';
import {CANVAS_AUTHORED_BACKGROUNDS,defaultCanvasBackgroundRef} from './canvasAssetRegistry';
import {directCanvasScene,directCanvasProject} from './canvasCinematicDirection';

type Anchor = { x: number; y: number };

const BASE_ANCHORS: Record<CanvasLayoutSlot, Anchor> = {
  hero: { x: .5, y: .6 },
  'hero-left': { x: .29, y: .61 },
  'hero-right': { x: .71, y: .61 },
  'support-left': { x: .19, y: .61 },
  'support-right': { x: .81, y: .61 },
  'foreground-left': { x: .12, y: .72 },
  'foreground-right': { x: .88, y: .72 },
  'mid-left': { x: .34, y: .59 },
  'mid-center': { x: .5, y: .58 },
  'mid-right': { x: .66, y: .59 },
  'background-left': { x: .2, y: .52 },
  'background-center': { x: .5, y: .5 },
  'background-right': { x: .8, y: .52 },
  'caption-top': { x: .5, y: .14 },
  'caption-bottom': { x: .5, y: .86 },
  center: { x: .5, y: .5 },
};

const TEMPLATE_ANCHOR_OVERRIDES: Partial<Record<CanvasSceneTemplate, Partial<Record<CanvasLayoutSlot, Anchor>>>> = {
  'hero-left': {
    'hero-left': { x: .27, y: .61 },
    'support-right': { x: .73, y: .59 },
    'mid-right': { x: .69, y: .58 },
  },
  'hero-right': {
    'hero-right': { x: .73, y: .61 },
    'support-left': { x: .27, y: .59 },
    'mid-left': { x: .31, y: .58 },
  },
  'two-shot': {
    'hero-left': { x: .32, y: .62 },
    'hero-right': { x: .68, y: .62 },
  },
  'wide-establishing': {
    'mid-left': { x: .3, y: .59 },
    'mid-center': { x: .5, y: .58 },
    'mid-right': { x: .7, y: .59 },
    'background-left': { x: .18, y: .49 },
    'background-right': { x: .82, y: .49 },
  },
  'close-reaction': {
    hero: { x: .5, y: .63 },
    'support-right': { x: .82, y: .55 },
  },
  'prop-focus': {
    hero: { x: .56, y: .58 },
    'support-left': { x: .23, y: .62 },
  },
  'foreground-pov': {
    'foreground-left': { x: .1, y: .69 },
    'foreground-right': { x: .9, y: .69 },
    'mid-center': { x: .52, y: .57 },
  },
  'over-shoulder': {
    'foreground-left': { x: .12, y: .7 },
    'mid-right': { x: .65, y: .58 },
  },
  'diagram-clean': {
    hero: { x: .5, y: .56 },
    'mid-left': { x: .3, y: .57 },
    'mid-right': { x: .7, y: .57 },
  },
  'split-contrast': {
    'hero-left': { x: .27, y: .6 },
    'hero-right': { x: .73, y: .6 },
  },
};

function semanticObjects(scene: CanvasStudioScene) {
  return scene.objects.filter((object) => object.kind !== 'text' && object.kind !== 'shape');
}

function implicitDepth(slot: CanvasLayoutSlot): CanvasDepthLayer {
  if (slot.startsWith('foreground')) return 'foreground';
  if (slot.startsWith('background')) return 'background';
  return 'midground';
}

function implicitSize(
  object: CanvasStudioObject,
  template: CanvasSceneTemplate,
  depth: CanvasDepthLayer,
): CanvasSizeClass {
  if (object.sizeClass) return object.sizeClass;
  if (depth === 'background') return 'small';
  if (depth === 'foreground') return object.role === 'focal' ? 'hero' : 'large';
  if (object.role === 'focal') {
    if (template === 'wide-establishing') return 'large';
    if (template === 'close-reaction' || template === 'prop-focus') return 'hero';
    return 'large';
  }
  return 'medium';
}

function implicitSlot(
  scene: CanvasStudioScene,
  object: CanvasStudioObject,
  objectIndex: number,
): CanvasLayoutSlot {
  if (object.slot) return object.slot;
  if (object.kind === 'text') return object.role === 'focal' ? 'caption-top' : 'caption-top';

  const template = scene.template || 'wide-establishing';
  const semantics = semanticObjects(scene);
  const semanticIndex = semantics.findIndex((candidate) => candidate.id === object.id);
  const index = semanticIndex >= 0 ? semanticIndex : objectIndex;

  if (template === 'hero-left') {
    if (object.role === 'focal' || index === 0) return 'hero-left';
    return index % 2 ? 'support-right' : 'background-right';
  }
  if (template === 'hero-right') {
    if (object.role === 'focal' || index === 0) return 'hero-right';
    return index % 2 ? 'support-left' : 'background-left';
  }
  if (template === 'two-shot') {
    if (index === 0) return 'hero-left';
    if (index === 1) return 'hero-right';
    return index % 2 ? 'background-right' : 'background-left';
  }
  if (template === 'close-reaction') {
    if (object.role === 'focal' || index === 0) return 'hero';
    return index % 2 ? 'support-right' : 'background-left';
  }
  if (template === 'prop-focus') {
    if (object.role === 'focal' || index === 0) return 'hero';
    return index % 2 ? 'support-left' : 'background-right';
  }
  if (template === 'foreground-pov') {
    if (object.role === 'focal') return 'mid-center';
    if (index === 0) return 'foreground-left';
    if (index === 1) return 'mid-center';
    return index % 2 ? 'foreground-right' : 'background-right';
  }
  if (template === 'over-shoulder') {
    if (index === 0 && object.role !== 'focal') return 'foreground-left';
    if (object.role === 'focal' || index === 1) return 'mid-right';
    return 'background-right';
  }
  if (template === 'diagram-clean') {
    if (object.role === 'focal' || index === 0) return 'hero';
    return index % 2 ? 'mid-right' : 'mid-left';
  }
  if (template === 'split-contrast') {
    if (index === 0) return 'hero-left';
    if (index === 1) return 'hero-right';
    return index % 2 ? 'background-right' : 'background-left';
  }

  // wide-establishing
  if (object.role === 'focal') return 'mid-center';
  if (index === 0) return 'mid-left';
  if (index === 1) return 'mid-right';
  return index % 2 ? 'background-right' : 'background-left';
}

function dimensionFor(
  kind: CanvasObjectKind,
  size: CanvasSizeClass,
  width: number,
  height: number,
) {
  const portrait = {
    small: { w: width * .09, h: height * .31 },
    medium: { w: width * .12, h: height * .43 },
    large: { w: width * .145, h: height * .53 },
    hero: { w: width * .17, h: height * .62 },
  }[size];

  if (kind === 'character') return portrait;

  if (kind === 'ship') {
    return {
      small: { w: width * .22, h: height * .19 },
      medium: { w: width * .32, h: height * .27 },
      large: { w: width * .41, h: height * .34 },
      hero: { w: width * .5, h: height * .4 },
    }[size];
  }

  if (kind === 'stake') {
    return {
      small: { w: width * .055, h: height * .28 },
      medium: { w: width * .075, h: height * .38 },
      large: { w: width * .11, h: height * .48 },
      hero: { w: width * .16, h: height * .58 },
    }[size];
  }

  if (kind === 'text') {
    return {
      small: { w: width * .32, h: height * .075 },
      medium: { w: width * .42, h: height * .1 },
      large: { w: width * .52, h: height * .13 },
      hero: { w: width * .58, h: height * .15 },
    }[size];
  }

  if (kind === 'prop') {
    return {
      small: { w: width * .1, h: height * .17 },
      medium: { w: width * .15, h: height * .24 },
      large: { w: width * .21, h: height * .32 },
      hero: { w: width * .29, h: height * .42 },
    }[size];
  }

  return {
    small: { w: width * .1, h: height * .13 },
    medium: { w: width * .16, h: height * .2 },
    large: { w: width * .23, h: height * .28 },
    hero: { w: width * .31, h: height * .36 },
  }[size];
}

function anchorFor(template: CanvasSceneTemplate, slot: CanvasLayoutSlot) {
  return TEMPLATE_ANCHOR_OVERRIDES[template]?.[slot] || BASE_ANCHORS[slot];
}

function zFor(depth: CanvasDepthLayer, role: CanvasStudioObject['role'], index: number) {
  const layerBase = depth === 'foreground' ? 60 : depth === 'midground' ? 30 : 10;
  const roleBoost = role === 'focal' ? 8 : role === 'support' ? 4 : 0;
  return layerBase + roleBoost + Math.min(6, index);
}

function shouldCompile(scene: CanvasStudioScene) {
  return Boolean(
    scene.template
    || scene.objects.some((object) => object.slot || object.depth || object.sizeClass),
  );
}

function attachBoatPassengers(scene:CanvasStudioScene):CanvasStudioScene {
  if(!scene.objects.some(o=>o.onBoat||o.heldBy||o.pose==='sit')&&!scene.animationBeats?.some(b=>['reach','wipe','write','tie','aid','assist'].includes(b.action)))return scene;
  const objects=scene.objects.map(o=>({...o}));
  for(const prop of objects){
    if(prop.kind!=='prop')continue;
    if(prop.variant==='rope'&&!prop.tiedTo&&scene.animationBeats?.some(b=>b.action==='tie'&&b.focusTargetId===prop.id)){
      const trees=objects.filter(o=>o.variant==='tree');
      if(trees.length===1)prop.tiedTo=trees[0]!.id;
    }
    if(prop.variant==='phone'&&!prop.heldBy){
      const callers=objects.filter(o=>o.kind==='character'&&scene.animationBeats?.some(b=>b.targetIds.includes(o.id)&&/điện thoại|phone|call/iu.test(b.speechCue||'')));
      if(callers.length===1)prop.heldBy=callers[0]!.id;
    }
  }
  for(const actor of objects){
    if(actor.kind!=='character'||!actor.onBoat)continue;
    const boat=objects.find(o=>o.id===actor.onBoat&&o.kind==='ship');if(!boat)continue;
    const size=Math.min(actor.height,boat.width*.38);
    actor.height=size;actor.width=size*.64;if(!actor.pose||actor.pose==='idle')actor.pose='sit';
    actor.x=boat.x+Math.max(-.32,Math.min(.32,actor.boatSeat??0))*boat.width;
    actor.y=boat.y-size*.24-boat.height*.06;
    // Hull in front conceals lower legs inside the boat.
    boat.zIndex=Math.max(boat.zIndex,actor.zIndex+1);
  }
  for(const prop of objects){
    if(prop.kind!=='prop'||prop.variant!=='phone'||!prop.heldBy)continue;
    const holder=objects.find(o=>o.id===prop.heldBy&&o.kind==='character');if(!holder)continue;
    // Semantic prop slots otherwise turn a handheld phone into a giant panel.
    // Fit to the holder's anatomy, not to the background/foreground slot.
    const fit=Math.min(holder.width/68,holder.height/100);
    prop.width=fit*9;prop.height=fit*22;
  }
  const chairs=objects.filter(o=>o.kind==='prop'&&o.variant==='chair');
  for(const actor of objects.filter(o=>o.kind==='character'&&o.pose==='sit'&&o.sittingStyle!=='ground')){
    const chair=chairs.shift();if(!chair)continue;
    const fit=Math.min(actor.width/68,actor.height/100);
    chair.width=fit*50;chair.height=fit*70;
    chair.x=actor.x;chair.y=actor.y+fit*24-chair.height*.02;
    chair.zIndex=actor.zIndex-1;
  }
  const staged=new Set<string>();
  for(const beat of scene.animationBeats||[]){
    if(beat.action!=='assist'||!beat.focusTargetId)continue;
    const focus=objects.find(o=>o.id===beat.focusTargetId&&o.kind==='character');if(!focus)continue;
    for(const id of beat.targetIds){
      const actor=objects.find(o=>o.id===id&&o.kind==='character');if(!actor||actor.id===focus.id)continue;
      const patient=actor.legBandage&&!focus.legBandage?actor:focus;
      const helper=patient===actor?focus:actor;
      if(staged.has(helper.id))continue;
      const fit=Math.min(helper.width/68,helper.height/100),patientFit=Math.min(patient.width/68,patient.height/100);
      const side=helper.x<patient.x?-1:1;
      helper.x=patient.x+side*(patientFit*24+fit*28);helper.y=patient.y;
      for(const [person,facing] of [[helper,side>0?'left':'right'],[patient,side>0?'right':'left']] as const){
        person.facing=facing;
        if(person.keyframes)person.keyframes=person.keyframes.map(frame=>({...frame,...(frame.facing?{facing}:{} )}));
      }
      staged.add(helper.id);staged.add(patient.id);
    }
  }
  // The strongest physical interaction owns staging, even after an introductory reach.
  const contactBeats=[...(scene.animationBeats||[])].sort((a,b)=>Number(['aid','assist'].includes(b.action))-Number(['aid','assist'].includes(a.action)));
  for(const beat of contactBeats){
    if(!['reach','wipe','write','tie','aid','assist'].includes(beat.action)||!beat.focusTargetId)continue;
    const target=objects.find(o=>o.id===beat.focusTargetId);if(!target)continue;
    for(const id of beat.targetIds){
      const actor=objects.find(o=>o.id===id&&o.kind==='character');if(!actor||actor.id===target.id||staged.has(id))continue;
      const fit=Math.min(actor.width/68,actor.height/100),side=actor.facing==='left'?-1:1;
      if(target.kind==='prop'&&!target.heldBy){
        target.x=actor.x+side*fit*27;target.y=actor.y+fit*10;
        if(target.variant==='note'){target.width=fit*20;target.height=fit*6;}
        if(target.variant==='lantern'){target.width=fit*12;target.height=fit*22;}
        if(target.variant==='rope'){target.width=fit*24;target.height=fit*12;}
        const tree=target.tiedTo&&objects.find(o=>o.id===target.tiedTo&&o.variant==='tree');
        if(tree){
          tree.width=fit*150;tree.height=fit*350;
          tree.x=target.x;tree.y=actor.y+fit*56-tree.height*.43;
          tree.zIndex=actor.zIndex-2;target.zIndex=actor.zIndex+1;
        }
        const table=objects.find(o=>o.kind==='prop'&&o.variant==='table');
        if(table&&(target.variant==='note'||target.variant==='lantern')){
          table.width=fit*48;table.height=fit*80;
          table.x=target.x;table.y=target.y+fit*3+table.height*.14;
          table.zIndex=Math.min(actor.zIndex,target.zIndex)-1;
        }
      }else if(target.kind==='character'){
        if(beat.action==='aid'){
          // Close shots magnify the interaction through the camera, not one
          // participant's body while its partner stays at a different scale.
          const commonHeight=Math.min(actor.height,target.height)*1.12;
          for(const person of [actor,target])if(person.height>commonHeight){
            const ratio=commonHeight/person.height;person.height*=ratio;person.width*=ratio;
          }
        }
        const targetFit=Math.min(target.width/68,target.height/100);
        const facing=target.facing==='left'?-1:1;
        if(beat.action==='aid'){
          const legSide=(target.legBandage==='left'?-1:1)*facing;
          const targetX=target.x+legSide*18*targetFit;
          actor.facing=legSide>0?'left':'right';
          const actorFit=Math.min(actor.width/68,actor.height/100);
          actor.x=targetX+legSide*actorFit*30;
        }else if(beat.action==='assist'){
          // Attach from outside the patient's anatomical left shoulder.
          const helperSide=-facing;
          actor.facing=helperSide>0?'left':'right';
          actor.x=target.x+helperSide*(targetFit*24+fit*28);
        }else{
          const targetX=target.x-target.width*.22*facing;
          actor.x=targetX-side*fit*26;
        }
        actor.y=target.y;
      }
      staged.add(id);
    }
  }
  for(const actor of objects){
    if(actor.kind!=='character'||!scene.animationBeats?.some(b=>b.action==='assist'&&(b.targetIds.includes(actor.id)||b.focusTargetId===actor.id)))continue;
    const travel=actor.keyframes?.filter(k=>k.dx!==undefined)||[];
    const distance=(travel.at(-1)?.dx||0)-(travel[0]?.dx||0);
    if(Math.abs(distance)<actor.width*.1)continue;
    const facing=distance<0?'left':'right';
    actor.facing=facing;
    if(!actor.pose||actor.pose==='idle')actor.pose='assist';
    actor.keyframes=actor.keyframes?.map(k=>({...k,facing,...(k.pose==='idle'?{pose:'assist' as const}:{})}));
  }
  const focal=objects.find(o=>o.kind==='character'&&o.role==='focal');
  let camera=scene.camera&&focal?{...scene.camera,focusX:focal.x,focusY:focal.y}:scene.camera;
  if(camera&&['close-up','extreme-close-up'].includes(camera.shot)){
    const aid=scene.animationBeats?.find(b=>b.action==='aid');
    const patient=aid&&objects.find(o=>o.id===aid.focusTargetId&&o.kind==='character');
    if(patient){
      const fit=Math.min(patient.width/68,patient.height/100),side=(patient.legBandage==='left'?-1:1)*(patient.facing==='left'?-1:1);
      camera={...camera,focusX:patient.x+side*18*fit,focusY:patient.y+fit*32};
    }
  }
  return {...scene,objects,camera};
}

function compileCanvasBaseLayout(
  scene: CanvasStudioScene,
  width: number,
  height: number,
): CanvasStudioScene {
  const background=CANVAS_AUTHORED_BACKGROUNDS.find(asset=>asset.id===scene.backgroundRef);
  if(background?.background===scene.background&&!background.templates.includes(scene.template||'wide-establishing')){
    scene={...scene,backgroundRef:defaultCanvasBackgroundRef(scene)};
  }
  if (!shouldCompile(scene)) return attachBoatPassengers(attachCanvasArchitecture(scene, width, height));

  const template = scene.template || 'wide-establishing';
  let objects: CanvasStudioObject[] = scene.objects.map((object, index) => {
    const slot = implicitSlot(scene, object, index);
    const depth = object.depth || implicitDepth(slot);
    const sizeClass = implicitSize(object, template, depth);
    const anchor = anchorFor(template, slot);
    const baseDimensions = dimensionFor(object.kind, sizeClass, width, height);
    const shot = scene.camera?.shot || 'medium';
    const physicalShot=scene.animationBeats?.some(beat=>['run','row','brace','celebrate','aid','assist','reach','tie','wipe','write'].includes(beat.action));
    const portraitScale = !physicalShot && object.kind === 'character' && object.role === 'focal'
      ? shot === 'extreme-close-up' ? 1.52 : shot === 'close-up' ? 1.28 : 1
      : 1;
    const dimensions = {
      w: baseDimensions.w * portraitScale,
      h: baseDimensions.h * portraitScale,
    };

    // Caption slots are centered text; all other objects use authored anchor points.
    const x = anchor.x * width;
    const y = anchor.y * height;

    return {
      ...object,
      slot,
      depth,
      sizeClass,
      x,
      y,
      width: dimensions.w,
      height: dimensions.h,
      zIndex: zFor(depth, object.role, index),
    };
  });

  objects = attachCanvasArchitecture({ ...scene, objects }, width, height).objects;

  // A resting actor belongs on the mattress, not in an unrelated portrait slot.
  const bed = objects.find((object) => object.kind === 'prop' && (object.variant === 'bed' || object.assetRef === 'prop:bed'));
  if (bed) {
    for (const object of objects) {
      if (object.kind !== 'character' || (object.pose !== 'lie-down' && object.pose !== 'cover-face')) continue;
      object.x = bed.x;
      object.y = bed.y - bed.height * .2;
      object.width = bed.width * .82;
      object.height = object.width * .68;
      object.zIndex = bed.zIndex + 1;
    }
  }

  const focal = objects.find((object) => object.role === 'focal' && object.kind !== 'text')
    || objects.find((object) => object.kind !== 'text' && object.kind !== 'shape');

  return attachBoatPassengers({
    ...scene,
    template,
    camera: scene.camera
      ? {
          ...scene.camera,
          focusX: focal?.x ?? scene.camera.focusX,
          focusY: focal?.y ?? scene.camera.focusY,
        }
      : scene.camera,
    objects,
  });
}

export function compileCanvasSceneLayout(scene:CanvasStudioScene,width:number,height:number):CanvasStudioScene {
  return directCanvasScene(compileCanvasBaseLayout(scene,width,height),width,height);
}

export function compileCanvasProjectLayout(project: CanvasStudioProject): CanvasStudioProject {
  return directCanvasProject({
    ...project,
    scenes: project.scenes.map((scene) =>
      compileCanvasSceneLayout(scene, project.width, project.height),
    ),
  });
}

export function canvasLayoutFingerprint(scene: CanvasStudioScene) {
  const slots = scene.objects
    .filter((object) => object.kind !== 'text')
    .map((object) => object.slot || 'raw')
    .sort()
    .join(',');
  return `${scene.template || 'raw'}|${scene.background}|${scene.camera?.shot || 'wide'}|${slots}`;
}
