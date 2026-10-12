import { compileCanvasFolkHorror } from './canvasFolkHorror';
import {compileVectorProject} from './canvasVectorScene';
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
import {canvasConversationKey} from './canvasDialogueDirection';
import {resolveCanvasSpatialRelations,fitCanvasHandProp,resolveCanvasVoyageContinuity,stageCanvasShore} from './canvasSpatialRelations';
import {stabilizeCanvasSceneContinuity} from './canvasContinuity';
import {compileCanvasProceduralAssetForge} from './canvasProceduralAssetForge';
import {compileCanvasProfessionalDirection} from './canvasProfessionalDirection';
import {compileCanvasMotionDirection} from './canvasMotionDirector';

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
  const isPortrait=height>width;
  if(isPortrait){
    if(kind==='character'){
      const h=({small:.42,medium:.58,large:.70,hero:.82} as const)[size]*width;
      return {w:h*.38,h};
    }
    if(kind==='ship'){
      const w=({small:.42,medium:.56,large:.70,hero:.82} as const)[size]*width;
      return {w,h:w*.38};
    }
    if(kind==='stake'){
      const h=({small:.24,medium:.32,large:.40,hero:.50} as const)[size]*height;
      return {w:h*.22,h};
    }
    if(kind==='text'){
      return {
        small:{w:width*.70,h:height*.055},medium:{w:width*.78,h:height*.07},
        large:{w:width*.84,h:height*.085},hero:{w:width*.90,h:height*.10},
      }[size];
    }
    if(kind==='prop'){
      const side=({small:.17,medium:.24,large:.34,hero:.46} as const)[size]*width;
      return {w:side,h:side*.82};
    }
    const side=({small:.18,medium:.26,large:.36,hero:.48} as const)[size]*width;
    return {w:side,h:side*.76};
  }
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

function attachBoatPassengers(scene:CanvasStudioScene,width=1280,height=720):CanvasStudioScene {
  if(!scene.objects.some(o=>o.onBoat||o.heldBy||o.pose==='sit')&&!scene.animationBeats?.some(b=>['reach','wipe','write','tie','aid','assist'].includes(b.action)))return scene;
  const objects=scene.objects.map(o=>({...o}));
  const occupiedBoats=objects.filter(o=>o.kind==='ship'&&objects.some(actor=>actor.onBoat===o.id));
  if(scene.template)for(const [index,boat] of occupiedBoats.entries()){
    if(occupiedBoats.length===1)boat.x=width*.53;
    else {
      const cell=width/occupiedBoats.length;
      boat.width=Math.min(boat.width,cell*.88);
      boat.x=cell*(index+.5);
    }
    boat.y=height*.65;boat.height=boat.width*.30;
  }
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
    if(prop.kind!=='prop')continue;
    const boat=prop.onBoat&&objects.find(o=>o.id===prop.onBoat&&o.kind==='ship');
    if(boat&&!prop.heldBy){
      prop.width=boat.width*.075;prop.height=prop.variant==='lantern'?boat.width*.13:boat.width*.04;
      prop.x=boat.x+(prop.boatSeat??.36)*boat.width;
      prop.y=boat.y+(prop.variant==='sandals'?boat.height*.09:-boat.height*.08)-(prop.variant==='lantern'?prop.height*.50:0);
      prop.zIndex=boat.zIndex+1;
    }
    const holder=prop.heldBy&&objects.find(o=>o.id===prop.heldBy&&o.kind==='character');
    if(holder)fitCanvasHandProp(prop,holder);
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
      if(helper.onBoat&&helper.onBoat===patient.onBoat){
        const boat=objects.find(o=>o.id===helper.onBoat&&o.kind==='ship');
        if(boat)helper.boatSeat=Math.max(-.26,Math.min(.26,(helper.x-boat.x)/boat.width));
      }
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
      if(target.environmentAnchor==='doorway'){
        // A fixed door belongs to its jamb. Move the actor to its hinge-side
        // contact point; never pull an architectural panel into a portrait slot.
        actor.x=target.x-target.width*.30-side*fit*27;
        actor.y=height*.75-fit*60;
      }else if(target.kind==='prop'&&!target.heldBy&&!target.onBoat&&!target.handling){
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
      }else if(target.kind==='character'&&!actor.onBoat&&!target.onBoat){
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
          const nearSide=actor.x<target.x?-1:1;
          const targetX=target.x+nearSide*targetFit*24;
          actor.x=targetX+nearSide*fit*26;
          actor.facing=nearSide>0?'left':'right';
          actor.keyframes=actor.keyframes?.map(frame=>({...frame,facing:actor.facing}));
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
  if(scene.dialogueLayout&&scene.template==='two-shot'&&canvasConversationKey(scene))return scene;
  if(scene.dialogueLayout)scene={...scene,dialogueLayout:undefined};
  const background=CANVAS_AUTHORED_BACKGROUNDS.find(asset=>asset.id===scene.backgroundRef);
  if(background?.background===scene.background&&!background.templates.includes(scene.template||'wide-establishing')){
    scene={...scene,backgroundRef:defaultCanvasBackgroundRef(scene)};
  }
  if (!shouldCompile(scene)) return attachBoatPassengers(attachCanvasArchitecture(scene, width, height),width,height);

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
    const actors = objects.filter(object => object.kind === 'character');
    const description = `${scene.visualBrief || ''} ${scene.narration || ''}`.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (actors.length === 1 && ['idle', 'talk'].includes(actors[0]!.pose || 'idle')
      && /nam ngu|nam tren giuong|nam co ro|keo chan|trum chan|lying (?:on|in)|asleep/.test(description)
      && !scene.animationBeats?.some(beat => ['run', 'row', 'assist', 'aid', 'reach'].includes(beat.action))) {
      actors[0]!.pose = 'lie-down';
      actors[0]!.keyframes = actors[0]!.keyframes?.map(frame => frame.pose === 'idle' || frame.pose === 'talk' ? {...frame, pose: 'lie-down'} : frame);
    }
    const reclining = objects.some(object => object.kind === 'character'
      && (object.pose === 'lie-down' || object.pose === 'cover-face'));
    if (reclining && scene.background === 'room') {
      bed.width = width * .34; bed.height = height * .36;
      bed.x = Math.max(bed.width / 2 + 24, Math.min(width - bed.width / 2 - 24, bed.x));
      bed.y = height * .74; bed.depth = 'midground'; bed.zIndex = 32;
    }
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
  },width,height);
}

export function compileCanvasSceneLayout(scene:CanvasStudioScene,width:number,height:number):CanvasStudioScene {
  const related=resolveCanvasSpatialRelations(scene);
  // Direction may resize/stage subjects. Resolve attachments last so its shore
  // defaults cannot detach a passenger or resize a handheld prop afterwards.
  return stageCanvasShore(attachBoatPassengers(directCanvasScene(compileCanvasBaseLayout(related,width,height),width,height),width,height),width,height);
}

function separatePassiveSubjects(scene:CanvasStudioScene,width:number,height:number):CanvasStudioScene {
  scene={...scene,objects:scene.objects.map(object=>({...object}))};
  const actors=scene.objects.filter(o=>o.kind==='character');
  const ratio=(a:CanvasStudioObject,b:CanvasStudioObject)=>
    Math.max(0,Math.min(a.x+a.width/2,b.x+b.width/2)-Math.max(a.x-a.width/2,b.x-b.width/2))
    *Math.max(0,Math.min(a.y+a.height/2,b.y+b.height/2)-Math.max(a.y-a.height/2,b.y-b.height/2))
    /Math.max(1,Math.min(a.width*a.height,b.width*b.height));
  for(const object of scene.objects){
    const backgroundBoat=object.kind==='ship'&&actors.some(o=>o.onBoat)&&!actors.some(o=>o.onBoat===object.id);
    const groundProp=object.kind==='prop'&&['pig','chair'].includes(object.variant||'');
    if((!groundProp&&!backgroundBoat)||object.role==='focal'||object.heldBy||object.onBoat)continue;
    if(object.keyframes?.some(k=>Math.abs(k.dx||0)+Math.abs(k.dy||0)>5))continue;
    if(scene.animationBeats?.some(b=>b.focusTargetId===object.id&&['reach','wipe','write','tie'].includes(b.action)))continue;
    if(object.variant==='chair'&&actors.some(o=>o.pose==='sit'||o.keyframes?.some(k=>k.pose==='sit')))continue;
    if(!actors.some(actor=>ratio(object,actor)>.58))continue;
    const originalX=object.x;
    if(groundProp){
      const standing=actors.filter(o=>!o.onBoat);
      if(standing.length)object.y=Math.min(height-object.height*.5-16,Math.max(...standing.map(o=>o.y+o.height*.5))-object.height*.43);
    }
    const candidates=[originalX,width*.5,object.width*.5+16,width-object.width*.5-16,
      ...actors.flatMap(o=>[-1,1].map(side=>o.x+side*((o.width+object.width)*.5+24)))];
    const rank=(x:number)=>Math.max(0,...actors.map(o=>ratio({...object,x},o)));
    const positions=candidates.filter(x=>x>=object.width*.5+16&&x<=width-object.width*.5-16);
    positions.sort((a,b)=>rank(a)-rank(b)||Math.abs(a-originalX)-Math.abs(b-originalX));
    if(positions.length)object.x=positions[0]!;
  }
  return scene;
}

function enforceCanvasSupportRelations(scene:CanvasStudioScene,width:number,height:number):CanvasStudioScene {
  scene={...scene,objects:scene.objects.map(object=>({...object}))};
  const plain=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/g,'d');
  const description=plain(`${scene.name||''} ${scene.visualBrief||''} ${scene.narration||''}`);
  const backgroundOwnsHouse=['bg:night-stilt-house','bg:room-stilt-house','bg:room-stilt-day','bg:room-underfloor','bg:room-floor-detail'].includes(scene.backgroundRef||'');
  if(backgroundOwnsHouse){
    scene.objects=scene.objects.filter(object=>!(object.kind==='prop'&&object.variant==='house'
      &&!scene.animationBeats?.some(beat=>beat.focusTargetId===object.id)));
  }

  const table=scene.objects.find(object=>object.kind==='prop'&&object.variant==='table'&&!object.heldBy&&!object.onBoat);
  if(table){
    table.x=width*.5;
    table.y=height*(height>width?.66:.69);
    table.width=height>width?width*.52:width*.24;
    table.height=height>width?height*.17:height*.25;
    table.depth='midground';table.role='support';table.zIndex=23;table.motion='none';
    const tabletopVariants=new Set(['lantern','teapot','bowl','note','pipe','phone','book']);
    const tabletop=scene.objects.filter(object=>object.kind==='prop'&&tabletopVariants.has(object.variant||'')
      &&!object.heldBy&&!object.onBoat&&!object.handling
      &&!scene.animationBeats?.some(beat=>beat.focusTargetId===object.id&&['reach','wipe','write','grab'].includes(beat.action)));
    const staticTabletop=tabletop.filter(object=>{
      const notes=plain(object.designNotes||'');
      // Interior support props sharing the table slot are assumed to rest on
      // the table; explicit "floor/wall/hanging" notes override that relation.
      if(/san|floor|tuong|wall|treo|hang|hien|eave/.test(notes))return false;
      return /(ban|table)/.test(notes)||scene.background==='room'||object.slot===table.slot||object.slot==='mid-center';
    });
    staticTabletop.forEach((prop,index)=>{
      const spread=staticTabletop.length<=1?0:(index/(staticTabletop.length-1)-.5)*table.width*.48;
      prop.x=table.x+spread;
      const isLamp=prop.variant==='lantern';
      prop.width=isLamp?(height>width?width*.11:width*.055):Math.min(prop.width,height>width?width*.18:width*.085);
      prop.height=isLamp?(height>width?height*.085:height*.145):Math.min(prop.height,height>width?height*.11:height*.16);
      prop.y=table.y-table.height*.19-prop.height*.30;
      prop.depth='midground';prop.role=prop.role==='focal'?'focal':'support';prop.zIndex=table.zIndex+2;prop.motion='none';
    });
  }

  const door=scene.objects.find(object=>object.kind==='prop'&&object.variant==='door');
  if(door&&scene.background==='room'&&door.role!=='focal'&&!door.heldBy&&!door.handling){
    // A support door is architecture, not a postcard-sized prop. Keep one
    // stable doorway scale and a real floor contact across medium/close shots.
    const doorHeight=height*(height>width?.40:.50);
    const doorWidth=doorHeight*.43;
    door.width=doorWidth;
    door.height=doorHeight;
    door.x=width*(height>width?.76:.82);
    door.y=height*.76-doorHeight*.5;
    door.slot='background-right';
    door.depth='background';
    door.sizeClass='large';
    door.environmentAnchor='doorway';
    door.zIndex=18;
    door.motion='none';
  }
  const floorCue=/(khe (?:duoi )?cua|duoi cua|sat chan cua|tren san|mat san|floor|under (?:the )?door|door gap)/.test(description);
  if(floorCue){
    const floorProps=scene.objects.filter(object=>object.kind==='prop'&&!object.heldBy&&!object.onBoat
      &&['note','sandals','phone','book','pipe'].includes(object.variant||''));
    floorProps.forEach((prop,index)=>{
      const focalInsert=scene.template==='prop-focus'&&prop.role==='focal';
      const baseX=door?.x??width*.58;
      if(focalInsert){
        // Physical grounding may not downgrade an approved close insert. Keep
        // the clue large and centered enough to read while still presenting it
        // as an object lying near the doorway/floor plane.
        const minWidth=width*.28;
        if(prop.width<minWidth){
          const aspect=Math.max(.25,Math.min(4,prop.width/Math.max(1,prop.height)));
          prop.width=minWidth;prop.height=Math.min(height*.52,minWidth/aspect);
        }
        prop.x=Math.max(width*.30,Math.min(width*.70,prop.x));
        prop.y=Math.max(height*.43,Math.min(height*.63,prop.y));
      }else{
        prop.x=Math.max(width*.18,Math.min(width*.82,baseX+(index-.5)*width*.035));
        prop.y=height*(height>width?.76:.735);
      }
      if(prop.variant==='note'){
        if(!focalInsert){
          prop.width=Math.min(prop.width,height>width?width*.38:width*.18);
          prop.height=prop.width*.68;
        }
        prop.rotation=Math.max(-7,Math.min(7,prop.rotation||-3.5));
      }else if(!focalInsert){
        prop.width=Math.min(prop.width,height>width?width*.24:width*.11);
        prop.height=Math.min(prop.height,prop.width*.85);
      }
      prop.depth='foreground';prop.zIndex=Math.max(prop.zIndex,34);prop.motion='none';
    });
  }

  const bed=scene.objects.find(object=>object.kind==='prop'&&object.variant==='bed'&&!object.heldBy&&!object.onBoat);
  if(bed){
    const lyingCue=/(nam ngu|nam tren|nam co ro|nam im|giuong|chong|mattress|bed|lying|asleep)/.test(description);
    const candidates=scene.objects.filter(object=>object.kind==='character');
    const sleeper=candidates.length===1&&lyingCue?candidates[0]:candidates.find(object=>['lie-down','cover-face'].includes(object.pose||''));
    if(sleeper){
      sleeper.pose=sleeper.pose==='cover-face'?'cover-face':'lie-down';
      bed.width=height>width?width*.72:width*.38;
      bed.height=height>width?height*.20:height*.30;
      bed.x=width*(height>width?.52:.57);
      bed.y=height*(height>width?.70:.74);
      bed.depth='midground';bed.zIndex=31;
      sleeper.x=bed.x;sleeper.y=bed.y-bed.height*.20;
      sleeper.width=bed.width*.82;sleeper.height=sleeper.width*.68;sleeper.zIndex=bed.zIndex+1;
      if(scene.camera){scene.camera.focusX=sleeper.x;scene.camera.focusY=sleeper.y;}
    }
  }

  for(const actor of scene.objects.filter(object=>object.kind==='character')){
    const notes=plain(actor.designNotes||'');
    if(actor.pose==='sit'&&actor.sittingStyle==='ground'||/(ngoi bet|ngoi co ro|ngoi thu lu|sit on the ground|sitting on the ground)/.test(notes)){
      actor.pose='sit';actor.sittingStyle='ground';
      actor.y=Math.min(height-actor.height*.44,height*.78);
    }
  }

  const roofCue=/(noc nha|mai nha|mai tranh|roof|rooftop)/.test(description);
  if(scene.backgroundRef==='bg:night-stilt-house'){
    for(const threat of scene.objects.filter(object=>object.kind==='prop'&&(object.variant==='demon-dog'||object.variant==='ghost'))){
      const threatRoof=roofCue||/(noc nha|mai nha|mai tranh|don noc|roof|rooftop)/.test(plain(threat.designNotes||''));
      if(!threatRoof)continue;
      const animal=threat.variant==='demon-dog';
      threat.x=animal?width*.55:width*.50;threat.y=animal?height*.27:height*.29;
      threat.width=animal?(height>width?width*.34:width*.17):(height>width?width*.22:width*.11);
      threat.height=animal?(height>width?height*.28:height*.42):(height>width?height*.16:height*.24);
      threat.role=animal?'focal':'support';threat.depth='midground';threat.zIndex=animal?34:20;threat.motion='none';
      if(!animal)threat.opacity=Math.min(threat.opacity??.5,.48);
    }
    for(const lamp of scene.objects.filter(object=>object.kind==='prop'&&object.variant==='lantern'&&!object.heldBy&&!object.onBoat&&/(treo|hien|mai|eave|hang)/.test(plain(object.designNotes||'')))){
      lamp.x=width*.57;lamp.y=height*.49;
      lamp.width=height>width?width*.10:width*.055;lamp.height=height>width?height*.075:height*.13;
      lamp.zIndex=24;lamp.motion='none';
    }
  }
  return scene;
}

function retainCanvasSetAnchors(project: CanvasStudioProject): CanvasStudioProject {
  const furnishings = new Set(['bed', 'table', 'chair', 'box', 'window', 'door', 'lantern', 'fire', 'basket', 'stairs', 'barrel']);
  const staticProp = (object: CanvasStudioObject) => object.kind === 'prop' && furnishings.has(object.variant || '')
    && !object.heldBy && !object.handling && !object.onBoat && object.motion === 'none'
    && !object.keyframes?.some(k => (k.dx || 0) !== 0 || (k.dy || 0) !== 0 || (k.rotation || 0) !== 0);
  const persistentAnchors=new Map<string,Map<string,CanvasStudioObject>>();
  let environment = '';
  let elapsed = 0;
  let castAnchors = new Map<string, CanvasStudioObject>();
  for (const scene of project.scenes) {
    if (!scene.template) { castAnchors.clear(); environment = ''; elapsed = 0; continue; }
    const key = scene.stageId
      ? `stage:${scene.stageId}`
      : `${scene.backgroundRef || scene.background}${scene.backgroundSpec ? ':' + JSON.stringify(scene.backgroundSpec) : ''}|${scene.backgroundImageUrl || ''}|${scene.atmosphere?.timeOfDay || ''}`;
    if (key !== environment) { castAnchors = new Map(); elapsed = 0; }
    environment = key;
    const anchors=persistentAnchors.get(key)||new Map<string,CanvasStudioObject>();
    persistentAnchors.set(key,anchors);
    scene.atmosphere = {...scene.atmosphere, timeOffsetMs: elapsed};
    elapsed += scene.durationMs;
    const actors = scene.objects.filter(o => o.kind === 'character' && o.characterKey);
    const quiet = new Set(actors.map(o => o.characterKey)).size === actors.length
      && actors.every(o => o.motion === 'none' && !o.onBoat && o.waterlineY === undefined
      && ['idle', 'talk', 'gesture', 'nod', 'point'].includes(o.pose || 'idle')
      && !o.keyframes?.some(k => Math.abs(k.dx || 0) > 1 || Math.abs(k.dy || 0) > 1
        || (k.pose && !['idle', 'talk', 'gesture', 'nod', 'point'].includes(k.pose))))
      && !scene.animationBeats?.some(b => !['talk', 'gesture', 'nod', 'point', 'react'].includes(b.action));
    if (quiet) for (const actor of actors) {
      const identity = `${scene.template}|${scene.camera?.shot}|${actors.map(o => o.characterKey).sort().join(',')}|${actor.characterKey}`;
      const anchor = castAnchors.get(identity);
      if (anchor) for (const field of ['x', 'y', 'width', 'height', 'scale', 'rotation'] as const) actor[field] = anchor[field];
      else castAnchors.set(identity, {...actor});
    }
    else castAnchors = new Map();
    const cleanInsert=['prop-focus','foreground-pov','over-shoulder'].includes(scene.template||'')
      || /underfloor|floor-detail/.test(scene.backgroundRef||'');
    const props = cleanInsert ? [] : scene.objects.filter(staticProp);
    const propIdentity = (prop: CanvasStudioObject) => prop.assetKey || (scene.objects.filter(o => o.kind === 'prop' && o.variant === prop.variant).length === 1
      ? prop.variant! : `${prop.variant}|${prop.label}`);
    for (const prop of props) {
      const identity = propIdentity(prop);
      if (props.filter(other => propIdentity(other) === identity).length !== 1) continue;
      if (scene.animationBeats?.some(beat => beat.focusTargetId === prop.id
        && ['reach', 'wipe', 'write', 'tie', 'aid', 'grab'].includes(beat.action))) continue;
      const anchor = anchors.get(identity);
      if (anchor) {
        for (const field of ['x', 'y', 'width', 'height', 'scale', 'rotation', 'zIndex'] as const) prop[field] = anchor[field];
        prop.slot = anchor.slot; prop.depth = anchor.depth; prop.sizeClass = anchor.sizeClass;
      } else anchors.set(identity, {...prop});
    }
    const bed = props.find(o => o.variant === 'bed');
    if (bed) for (const actor of scene.objects) {
      if (actor.kind !== 'character' || !['lie-down', 'cover-face'].includes(actor.pose || '')) continue;
      actor.x = bed.x; actor.y = bed.y - bed.height * .2;
      actor.width = bed.width * .82; actor.height = actor.width * .68; actor.zIndex = bed.zIndex + 1;
      if (scene.camera && scene.objects.filter(o => o.kind === 'character').length === 1) {
        scene.camera.focusX = actor.x; scene.camera.focusY = actor.y;
      }
    }
  }
  return project;
}

function finalizeInteriorCharacterPerspective(scene:CanvasStudioScene,width:number,height:number):CanvasStudioScene{
  const floorHorizon:Record<string,number>={
    'bg:room-simple-night':.76,
    'bg:room-study':.79,
  };
  const horizon=floorHorizon[scene.backgroundRef||''];
  if(horizon===undefined)return scene;
  if(['close-up','extreme-close-up'].includes(scene.camera?.shot||''))return scene;
  if(['prop-focus','foreground-pov','over-shoulder'].includes(scene.template||''))return scene;
  const depthProgress:Record<CanvasDepthLayer,number>={background:.13,midground:.30,foreground:.48};
  const floorY=height*horizon;
  return {
    ...scene,
    objects:scene.objects.map(object=>{
      if(object.kind!=='character'||object.onBoat||object.waterlineY!==undefined||object.sittingStyle
        ||['sit','lie-down','cover-face','float-body'].includes(object.pose||''))return object;
      const scale=Math.min(object.width/68,object.height/100);
      const localFootY=46.8;
      const progress=depthProgress[object.depth||'midground'];
      const targetFootY=floorY+(height-floorY)*progress;
      return {...object,y:targetFootY-localFootY*scale};
    }),
  };
}

export function compileCanvasProjectLayout(project: CanvasStudioProject): CanvasStudioProject {
  if(project.scenes.some(scene=>scene.vectorScene))return compileVectorProject(project);
  project=compileCanvasProceduralAssetForge(project);
  const anatomy=(value:string)=>{
    const plain=value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
    if(/(?:5|nam|five)[ -]*(?:mong|toed|toes)/.test(plain))return 5 as const;
    if(/(?:4|bon|four)[ -]*(?:mong|toed|toes)/.test(plain))return 4 as const;
  };
  const storyHooves=anatomy(`${project.name} ${project.sourcePrompt||''}`);
  project={...project,scenes:project.scenes.map(scene=>({...scene,objects:scene.objects.map(object=>{
    if(!['pig','pig-hoof'].includes(object.variant||'')||object.hoofCount)return object;
    const hoofCount=anatomy(object.designNotes||'')||storyHooves;
    return hoofCount?{...object,hoofCount}:object;
  })}))};
  project=resolveCanvasVoyageContinuity(project);
  const directed=compileCanvasProfessionalDirection(compileCanvasMotionDirection(directCanvasProject({
    ...project,
    scenes: project.scenes.map((scene) =>
      compileCanvasSceneLayout(scene, project.width, project.height),
    ),
  })));
  const stabilized=stabilizeCanvasSceneContinuity(directed);
  const retained=retainCanvasSetAnchors({...stabilized,scenes:stabilized.scenes.map(scene=>separatePassiveSubjects(stageCanvasShore(attachBoatPassengers(scene,project.width,project.height),project.width,project.height),project.width,project.height))});
  return compileCanvasFolkHorror({...retained,scenes:retained.scenes.map(scene=>finalizeInteriorCharacterPerspective(
    enforceCanvasSupportRelations(scene,retained.width,retained.height),
    retained.width,
    retained.height,
  ))});
}

export function canvasLayoutFingerprint(scene: CanvasStudioScene) {
  const slots = scene.objects
    .filter((object) => object.kind !== 'text')
    .map((object) => object.slot || 'raw')
    .sort()
    .join(',');
  return `${scene.template || 'raw'}|${scene.background}|${scene.camera?.shot || 'wide'}|${slots}`;
}
