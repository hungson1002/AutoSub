import {vectorHumanRig,readableVectorHuman} from './canvasVectorHuman';
import {vectorPuppetRig,puppetBlinkTracks,vectorPuppetTurnTracks,puppetTurnOpacityParts,vectorPuppetFearTracks,withPuppetFearEffects} from './canvasVectorPuppet';
import {vectorReachTracks} from './canvasVectorReach';
import {vectorPigRig,readableVectorPig} from './canvasVectorPig';
import {vectorSubjectCamera,balanceGroundedActingFrame,directVectorShot} from './canvasVectorFraming';
import {groundVectorDrawing,vectorFootsteps,vectorWalkTracks,vectorReactionTracks,vectorLightTracks,vectorHingeTracks,vectorRowTracks,vectorStrikeTracks} from './canvasVectorPhysical';
import {VectorEnsembleDirector} from './canvasVectorEnsemble';
import {vectorLantern,vectorFootprintNodes,vectorCarryDrawing,vectorPropGrip,alignVectorEmitters,vectorRaisedLampHand} from './canvasVectorProps';
import {normalizeVectorLight,readableVectorNightAssets,readableVectorNightScene,type VectorLight} from './canvasVectorLight';
import {groundDirectedActing} from './canvasVectorActing';
import {continueVectorProps,continueCarriedJointPose,naturalVectorCarryPose,releaseVectorProps,rememberVectorProps,type VectorPropState} from './canvasVectorContinuity';
import type {CanvasStudioProject, CanvasStudioScene} from './canvasAnimationStudio';

export type VectorFrame = {
  t:number; dx?:number; dy?:number; rotation?:number; scaleX?:number; scaleY?:number;
  opacity?:number; fill?:string; d?:string; easing?:'linear'|'ease-in'|'ease-out'|'ease-in-out'|'smooth'|'hold';
};
export type VectorNode = {
  id:string; parent?:string; type:'group'|'path'|'ellipse'|'rect'|'line'|'instance';
  x?:number; y?:number; pivotX?:number; pivotY?:number; rotation?:number; scaleX?:number; scaleY?:number;
  pivotSpace?:'local'|'parent';
  opacity?:number; fill?:string; stroke?:string; strokeWidth?:number;
  light?:VectorLight;
  d?:string; rx?:number; ry?:number; width?:number; height?:number; x2?:number; y2?:number; asset?:string;
  /** Local rectangular clip, inherited by children (SVG clipPath equivalent). */
  clip?:{x:number;y:number;width:number;height:number};
  /** Scene object welded to an actual articulated asset part, in part-local units. */
  attachTo?:string;
  /** A suspended prop keeps its vertical axis while following the hand. */
  hang?:boolean;
  /** Dialogue identity for an actor instance; defaults to its stable node ID. */
  characterKey?:string;
  /** Local rotation limits for a projected 2D elbow/knee. */
  joint?:{min:number;max:number};
  groundAnchor?:{x:number;y:number};
  /** Local depth plane relative to ground.y; stable across shots/normalization. */
  groundOffsetY?:number;
  groundMark?:boolean;
};
export type VectorDrawing = {width:number; height:number; nodes:VectorNode[];ground?:{y:number;parent?:string};grip?:{x:number;y:number}};
export type VectorTrack = {target:string; start:number; end:number; cue?:string; cueOffsetMs?:number; frames:VectorFrame[]; ensemble?:true};
export type CanvasVectorScene = VectorDrawing & {tracks:VectorTrack[]};
export type VectorCameraFrame = {t:number;x:number;y:number;zoom:number;easing?:VectorFrame['easing']};

/** Frame the whole existing stage, including supports, attached props and water.
 * Compiles to ordinary group tracks understood by both Canvas and native SVG.
 * Captions remain outside the stage in the renderer. */
export function frameVectorScene(stage:CanvasVectorScene,camera:VectorCameraFrame[]):CanvasVectorScene {
  if(!Array.isArray(camera)||!camera.length||camera.length>32)throw new Error('Vector: camera needs 1-32 frames');
  if(stage.nodes.length>=160||stage.tracks.length>=80)throw new Error('Vector: no room for camera group/track');
  let target='camera-world',suffix=0;
  while(stage.nodes.some(n=>n.id===target))target=`camera-world-${++suffix}`;
  const frames=camera.map(f=>{
    const t=number(f.t,0,0,1),zoom=number(f.zoom,1,1,4);
    const x=Math.max(stage.width/(2*zoom),Math.min(stage.width-stage.width/(2*zoom),number(f.x,stage.width/2)));
    // A grounded world has a continuous floor beyond the original view. Do not
    // clamp a low acting cut upward merely because it sees more foreground.
    const y=stage.ground?number(f.y,stage.height/2,0,stage.height):Math.max(stage.height/(2*zoom),Math.min(stage.height-stage.height/(2*zoom),number(f.y,stage.height/2)));
    if(f.easing!==undefined&&!['linear','ease-in','ease-out','ease-in-out','smooth','hold'].includes(f.easing))throw new Error('Vector: invalid camera easing');
    return {t,dx:stage.width/2-x*zoom,dy:stage.height/2-y*zoom,scaleX:zoom,scaleY:zoom,easing:f.easing||'ease-in-out'} as VectorFrame;
  }).sort((a,b)=>a.t-b.t);
  if(frames.some((f,i)=>i>0&&f.t===frames[i-1]!.t))throw new Error('Vector: duplicate camera time');
  return {...normalizeVectorDrawing({...stage,ground:stage.ground?{...stage.ground,parent:stage.ground.parent??target}:undefined,
    nodes:[{id:target,type:'group'},...stage.nodes.map(n=>n.parent||n.attachTo?n:{...n,parent:target})]}),
    tracks:[...stage.tracks,{target,start:0,end:1,frames}]};
}

const number = (value:unknown, fallback:number, min=-10000, max=10000) => {
  if(value===undefined)return fallback;
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error('Vector: invalid numeric geometry');
  return value;
};
const id = (value:unknown) => {
  if(typeof value!=='string'||!value||value.length>100||['__proto__','constructor','prototype'].includes(value)||!/^[a-zA-Z0-9_-]+$/.test(value))throw new Error('Vector: invalid node/asset identity');
  return value;
};
function paint(value:unknown){
  if(value===undefined)return undefined;
  if(typeof value!=='string'||!(/^(?:none|transparent|#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%]+\))$/i).test(value))throw new Error('Vector: invalid paint');
  return value;
}
function path(value:unknown){
  // Models occasionally omit the first move command; numeric-leading geometry
  // has one unambiguous repair. Never accept markup or arbitrary SVG content.
  if(typeof value==='string'&&/^\s*[-+.0-9]/.test(value))value='M '+value;
  if(typeof value!=='string'||!value||value.length>8000||!/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(value)||!/^\s*[Mm]/.test(value))throw new Error('Vector: invalid SVG path');
  return value;
}
export function normalizeVectorDrawing(raw:unknown):VectorDrawing {
  if(!raw||typeof raw!=='object')throw new Error('Vector: missing drawing');
  const data=raw as Record<string,unknown>;
  if(!Array.isArray(data.nodes)||!data.nodes.length||data.nodes.length>160)throw new Error('Vector: drawing needs 1-160 nodes');
  const flattened:Record<string,unknown>[]=[];
  const flatten=(entries:unknown[],parent?:string,depth=0)=>{
    if(depth>32)throw new Error('Vector: excessive group nesting');
    for(const raw of entries){
      if(!raw||typeof raw!=='object')throw new Error('Vector: invalid node');
      const entry=raw as Record<string,unknown>;
      if(parent&&entry.parent!==undefined&&entry.parent!==parent)throw new Error('Vector: conflicting nested parent');
      if(flattened.length>=160)throw new Error('Vector: drawing needs 1-160 nodes');
      flattened.push({...entry,...(parent?{parent}:{})});
      const children=entry.nodes??entry.children;
      if(entry.nodes!==undefined&&entry.children!==undefined)throw new Error('Vector: conflicting nested children');
      if(children!==undefined){
        if(!['group','instance'].includes(String(entry.type))||!Array.isArray(children))throw new Error('Vector: invalid nested group');
        flatten(children,id(entry.id),depth+1);
      }
    }
  };
  flatten(data.nodes);
  const nodes=flattened.map((raw):VectorNode=>{
    if(!raw||typeof raw!=='object')throw new Error('Vector: invalid node');
    const n=raw as Record<string,unknown>;
    if(!['group','path','ellipse','rect','line','instance'].includes(String(n.type)))throw new Error('Vector: unsupported primitive');
    const node:VectorNode={id:id(n.id),type:n.type as VectorNode['type']};
    if(n.parent!==undefined)node.parent=id(n.parent);
    if(n.attachTo!==undefined){
      if(typeof n.attachTo!=='string'||n.attachTo.split('/').length!==2)throw new Error('Vector: attachment needs instance/part');
      n.attachTo.split('/').forEach(id);node.attachTo=n.attachTo;
      if(n.parent!==undefined)throw new Error('Vector: choose parent or attachment');
    }
    if(n.hang!==undefined){if(typeof n.hang!=='boolean'||!node.attachTo)throw new Error('Vector: hanging props require an attachment');node.hang=n.hang;}
    if(n.joint!==undefined){
      const j=n.joint as Record<string,unknown>;
      if(!j||typeof j!=='object'||node.type!=='group')throw new Error('Vector: joint limits require a group');
      node.joint={min:number(j.min,0,-180,180),max:number(j.max,0,-180,180)};
      if(node.joint.min>=node.joint.max)throw new Error('Vector: invalid joint limits');
    }
    if(n.groundAnchor!==undefined){
      const p=n.groundAnchor as Record<string,unknown>;
      if(!p||typeof p!=='object'||p.x===undefined||p.y===undefined)throw new Error('Vector: ground anchor needs x/y');
      node.groundAnchor={x:number(p.x,0),y:number(p.y,0)};
    }
    if(n.groundOffsetY!==undefined){
      if(!node.groundAnchor)throw new Error('Vector: depth offset needs a ground anchor');
      node.groundOffsetY=number(n.groundOffsetY,0,-1000,1000);
    }
    if(n.groundMark!==undefined){if(typeof n.groundMark!=='boolean')throw new Error('Vector: invalid ground mark');node.groundMark=n.groundMark;}
    for(const key of ['x','y','pivotX','pivotY','rotation','x2','y2'] as const)if(n[key]!==undefined)node[key]=number(n[key],0);
    if(n.pivotSpace!==undefined&&!['local','parent'].includes(String(n.pivotSpace)))throw new Error('Vector: invalid pivot coordinate space');
    if(n.pivotSpace==='parent'){
      node.pivotX=(node.pivotX??0)-(node.x??0);node.pivotY=(node.pivotY??0)-(node.y??0);
    }else if(n.pivotSpace===undefined&&node.type==='ellipse'&&node.x!==undefined&&node.y!==undefined
      &&node.pivotX===node.x&&node.pivotY===node.y){
      // SVG authors often repeat cx/cy as the transform origin. Our geometry
      // is already translated to that center; repeating it again makes an eye
      // orbit up into the captions during scaling. Canonicalize this exact case.
      node.pivotX=0;node.pivotY=0;
    }
    if(n.pivotSpace!==undefined||node.pivotX!==undefined||node.pivotY!==undefined)node.pivotSpace='local';
    for(const key of ['rx','ry','width','height','strokeWidth'] as const)if(n[key]!==undefined)node[key]=number(n[key],0,0,10000);
    for(const key of ['scaleX','scaleY'] as const)if(n[key]!==undefined)node[key]=number(n[key],1,-20,20);
    if(n.opacity!==undefined)node.opacity=number(n.opacity,1,0,1);
    if(n.clip!==undefined){
      if(!n.clip||typeof n.clip!=='object')throw new Error('Vector: invalid clip rectangle');
      const clip=n.clip as Record<string,unknown>;
      node.clip={x:number(clip.x,0),y:number(clip.y,0),width:number(clip.width,0,1,10000),height:number(clip.height,0,1,10000)};
      if(node.clip.width<=0||node.clip.height<=0)throw new Error('Vector: clip needs positive dimensions');
    }
    node.fill=paint(n.fill);node.stroke=paint(n.stroke);
    if(n.light!==undefined){
      if(!['group','ellipse','path'].includes(node.type))throw new Error('Vector: light must belong to its emitter');
      node.light=normalizeVectorLight(n.light);
    }
    if(node.type==='path')node.d=path(n.d);
    if(node.type==='instance'){
      node.asset=id(n.asset);
      if(n.characterKey!==undefined)node.characterKey=id(n.characterKey);
    }
    if(node.type==='ellipse'&&(!(node.rx!>0)||!(node.ry!>0)))throw new Error('Vector: ellipse needs positive radii');
    if(node.type==='rect'&&(!(node.width!>0)||!(node.height!>0)))throw new Error('Vector: rectangle needs positive dimensions');
    return node;
  });
  const byId=new Map(nodes.map(n=>[n.id,n]));
  if(byId.size!==nodes.length)throw new Error('Vector: duplicate node identity');
  for(const node of nodes){
    const seen=new Set([node.id]);let parent=node.parent;
    while(parent){
      const ancestor=byId.get(parent);
      if(!ancestor||!['group','instance'].includes(ancestor.type)||seen.has(parent))throw new Error('Vector: missing or cyclic group parent');
      seen.add(parent);parent=ancestor.parent;
    }
  }
  const ground=data.ground as Record<string,unknown>|undefined;
  if(ground!==undefined&&(!ground||typeof ground!=='object'||Array.isArray(ground)))throw new Error('Vector: invalid ground surface');
  const grip=data.grip as Record<string,unknown>|undefined;
  if(grip!==undefined&&(!grip||typeof grip!=='object'||grip.x===undefined||grip.y===undefined))throw new Error('Vector: asset grip needs x/y');
  return {width:number(data.width,720,1,4096),height:number(data.height,1280,1,4096),nodes,
    ...(grip?{grip:{x:number(grip.x,0,0,number(data.width,720,1,4096)),y:number(grip.y,0,0,number(data.height,1280,1,4096))}}:{}),
    ...(ground?{ground:{y:number(ground.y,0,0,4096),...(ground.parent!==undefined?{parent:id(ground.parent)}:{})}}:{})};
}
export function normalizeVectorAssets(raw:unknown):Record<string,VectorDrawing>{
  if(raw===undefined)return {};
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Vector: invalid asset collection');
  const entries=Object.entries(raw);
  if(entries.length>40)throw new Error('Vector: too many reusable assets');
  const assets=Object.fromEntries(entries.map(([key,value])=>{
    const config=value as Record<string,unknown>;
    if(config?.rig!==undefined&&!['simple-human','simple-puppet','simple-pig','lantern','wet-footprint'].includes(String(config.rig)))throw new Error('Vector: unknown anatomy rig');
    const drawing=config?.rig==='simple-human'?vectorHumanRig(config):config?.rig==='simple-puppet'?vectorPuppetRig(config):config?.rig==='simple-pig'?vectorPigRig(config):config?.rig==='lantern'?vectorLantern():
      config?.rig==='wet-footprint'?{width:20,height:36,nodes:vectorFootprintNodes('foot').map(n=>({...n,x:(n.x??0)+10,y:(n.y??0)+16}))}:value;
    const normalized=normalizeVectorDrawing(alignVectorEmitters(readableVectorHuman(readableVectorPig(normalizeVectorDrawing(drawing)))));
    // Legacy authored tools often already have a precise rectangular handle.
    // Reuse its center rather than guessing a grip from the object's bounds.
    const grip=vectorPropGrip(normalized);
    if(grip)normalized.grip=grip;
    // Older checkpoints contain expanded scaffold geometry, without rig tags.
    // Upgrade only the exact known chains, leaving custom anatomy untouched.
    if(normalized.width===240&&normalized.height===480&&normalized.nodes.some(n=>n.id==='upper-body')){
      for(const side of ['l','r'])for(const [name,parent,y,limits] of [
        ['forearm','arm',50,{min:-145,max:145}],
        ['knee','leg',55,{min:0,max:145}],
      ] as const){
        const part=normalized.nodes.find(n=>n.id===`${name}-${side}`&&n.parent===`${parent}-${side}`&&n.y===y);
        const oldElbow=part?.joint&&name==='forearm'
          &&normalized.nodes.some(n=>n.id==='arm-'+side&&n.x===(side==='l'?80:160)&&n.y===190)
          &&normalized.nodes.some(n=>n.id==='hand-'+side&&n.parent===part.id&&n.y===57)
          &&(side==='l'?part.joint.min===-145&&part.joint.max===0:part.joint.min===0&&part.joint.max===145);
        if(part&&(!part.joint||oldElbow))part.joint=limits;
      }
    }
    return [id(key),normalized];
  }));
  for(const asset of Object.values(assets))if(asset.nodes.some(n=>n.type==='instance'||n.attachTo))throw new Error('Vector: nested asset instances or attachments are unsupported');
  return assets;
}
export function vectorTargets(drawing:VectorDrawing,assets:Record<string,VectorDrawing>):Set<string>{
  const targets=new Set(drawing.nodes.map(n=>n.id));
  for(const node of drawing.nodes)if(node.type==='instance'){
    const asset=assets[node.asset!];if(!asset)throw new Error(`Vector: missing asset ${node.asset}`);
    for(const part of asset.nodes)targets.add(`${node.id}/${part.id}`);
  }
  return targets;
}
export function normalizeVectorScene(raw:unknown,assets:Record<string,VectorDrawing>,spoken=''):CanvasVectorScene{
  const data=raw as Record<string,unknown>;
  const grounded=groundVectorDrawing(normalizeVectorDrawing(raw),assets,data.ground);
  const footprints=vectorFootsteps(grounded,assets,data.footsteps);
  let drawing=normalizeVectorDrawing(vectorCarryDrawing(footprints.drawing,assets,data.carries));
  const targets=vectorTargets(drawing,assets);
  for(const n of drawing.nodes.filter(n=>n.groundMark))if(!drawing.ground||Math.abs((n.y??0)-drawing.ground.y)>24)throw new Error(`Vector: ground mark ${n.id} y=${n.y??0} must stay on its surface y=${drawing.ground?.y}`);
  // Native land clues need readable soles/toes at phone size, including after
  // a repair widens the camera to include architecture.
  for(const n of drawing.nodes.filter(n=>n.groundMark)){n.scaleX=Math.max(n.scaleX??1,drawing.width/720*48/36);n.scaleY=Math.max(n.scaleY??1,drawing.width/720*48/36);}
  // Upgrade only the old native outlined soles when resuming a saved film.
  // A filled joined sole plus one short glint reads as water, not wire circles.
  const replacements=new Map<string,VectorNode>();
  for(const mark of drawing.nodes.filter(n=>n.groundMark)){
    const sole=drawing.nodes.find(n=>n.id===mark.id+'-sole'&&n.parent===mark.id);
    if(sole?.type==='ellipse'&&['#87a99e','#36564c'].includes(sole.stroke||'')){
      for(const n of vectorFootprintNodes(mark.id,sole.fill))replacements.set(n.id,{...n,parent:mark.id});
    }
  }
  if(replacements.size)drawing=normalizeVectorDrawing({...drawing,nodes:drawing.nodes.map(n=>replacements.get(n.id)||n)});
  for(const n of drawing.nodes.filter(n=>n.attachTo)){
    const [instance,part]=n.attachTo!.split('/'),owner=drawing.nodes.find(n=>n.id===instance&&n.type==='instance');
    if(!owner||owner.attachTo||!assets[owner.asset!]?.nodes.some(n=>n.id===part))throw new Error('Vector: attachment target must be an existing independent instance part');
    const ancestors=new Set([owner.id]);let parent=owner.parent;
    while(parent){const ancestor=drawing.nodes.find(n=>n.id===parent);if(parent===n.id||ancestors.has(parent)||ancestor?.attachTo)throw new Error('Vector: cyclic attachment');ancestors.add(parent);parent=ancestor?.parent;}
  }
  if(data.tracks!==undefined&&!Array.isArray(data.tracks))throw new Error('Vector: invalid animation tracks');
  const locomotion=[...vectorWalkTracks(drawing,assets,data.walks),...vectorPuppetTurnTracks(drawing,assets,data.turns),...vectorReactionTracks(drawing,assets,data.reactions)];
  // Contact is solved AFTER the preceding travel, not at the resting actor's
  // original location. Cue order uses the same timing resolver as playback.
  const contactContext={durationMs:10000,dialogue:spoken?[{text:spoken,atMs:0,durationMs:10000}]:[],vectorScene:{...drawing,
    tracks:[...((data.tracks||[]) as VectorTrack[]).map(t=>({...t,start:t.start??0,end:t.end??1})),...locomotion]}} as unknown as CanvasStudioScene;
  const generated=[...vectorReachTracks(drawing,assets,data.reaches,contactContext),...vectorRevealTracks(data.reveals),
    ...footprints.tracks,...locomotion,...vectorLightTracks(drawing,assets,data.lights),...vectorHingeTracks(drawing,data.hinges),...vectorRowTracks(drawing,assets,data.rows),...vectorStrikeTracks(drawing,assets,data.strikes,contactContext)];
  // Semantic commands own their controlled channels. Retain unrelated authored
  // motion (e.g. a flame's size or a revealed clue's fall), without rejecting
  // the film for a duplicate handwritten command channel.
  const manual=((data.tracks||[]) as VectorTrack[]).flatMap(track=>{
    if(!track||!Array.isArray(track.frames))return [track];
    // A tap owns the target while being tapped, not for the rest of the shot.
    // Preserve a later authored action on that same object (e.g. the ring
    // moving on its own after the hand has withdrawn).
    const owned=new Set(generated.filter(t=>t.target===track.target&&
      (t.cue&&t.cue===track.cue||(track.start??0)<t.end&&t.start<(track.end??1)))
      .flatMap(t=>t.frames.flatMap(f=>Object.keys(f).filter(k=>!['t','easing'].includes(k)))));
    if(!owned.size)return [track];
    const frames=track.frames.map(f=>Object.fromEntries(Object.entries(f).filter(([key])=>!owned.has(key))) as VectorFrame);
    return frames.some(f=>Object.keys(f).some(k=>!['t','easing'].includes(k)))?[{...track,frames}]:[];
  });
  const source=[...manual,...generated];
  if(source.filter(t=>!t?.ensemble).length>80||source.length>192)throw new Error('Vector: too many animation tracks');
  const tracks=source.map((raw):VectorTrack=>{
    if(!raw||typeof raw!=='object')throw new Error('Vector: invalid track');
    const t=raw as Record<string,unknown>;
    let target=t.target;
    if(typeof target==='string'&&!targets.has(target)){
      const segments=target.split('/');
      const instance=drawing.nodes.find(n=>n.id===segments[0]&&n.type==='instance');
      const asset=instance?assets[instance.asset!]:undefined;
      if(asset&&segments.length===2&&segments[1]==='root')target=instance!.id;
      if(asset&&segments.length>2&&segments.length<=34){
        let part=asset.nodes.find(n=>n.id===segments.at(-1));
        let valid=Boolean(part);
        for(let index=segments.length-2;index>=1;index--){
          if(!part||part.parent!==segments[index]){valid=false;break;}
          part=asset.nodes.find(n=>n.id===segments[index]);
        }
        const direct=segments[0]+'/'+segments.at(-1);
        if(valid&&targets.has(direct))target=direct;
      }else if(!instance&&segments.length>1&&segments.length<=33){
        let part=drawing.nodes.find(n=>n.id===segments.at(-1));
        let valid=Boolean(part);
        for(let index=segments.length-2;index>=0;index--){
          if(!part||part.parent!==segments[index]){valid=false;break;}
          part=drawing.nodes.find(n=>n.id===segments[index]);
        }
        if(valid&&targets.has(segments.at(-1)!))target=segments.at(-1)!;
      }
    }
    if(typeof target!=='string'||!targets.has(target))throw new Error(`Vector: unknown animated part ${t.target}`);
    const start=number(t.start,0,0,1),end=number(t.end,1,0,1);
    if(end<=start)throw new Error('Vector: animation must have positive duration');
    if(!Array.isArray(t.frames)||!t.frames.length||t.frames.length>32)throw new Error('Vector: missing animation frames');
    const [ownerId,partId]=target.split('/');
    const owner=drawing.nodes.find(n=>n.id===ownerId&&n.type==='instance');
    const part=partId?assets[owner?.asset||'']?.nodes.find(n=>n.id===partId):undefined;
    const carried=Array.isArray(data.carries)&&data.carries.some(c=>(c as Record<string,unknown>).prop===target);
    const frames=t.frames.map((raw):VectorFrame=>{
      if(!raw||typeof raw!=='object')throw new Error('Vector: invalid animation frame');
      const f=raw as Record<string,unknown>,frame:VectorFrame={t:number(f.t,0,0,1)};
      for(const key of ['dx','dy','rotation'] as const)if(f[key]!==undefined)frame[key]=number(f[key],0);
      // A native puppet's head follows its torso. Root travel must never be
      // duplicated as a local head translation by an AI repair.
      if(partId==='head-group'&&assets[owner?.asset||'']?.nodes.some(n=>n.id==='puppet-root')){
        if(frame.dx!==undefined)frame.dx=Math.max(-4,Math.min(4,frame.dx));
        if(frame.dy!==undefined)frame.dy=Math.max(-3,Math.min(3,frame.dy));
      }
      if(carried){delete frame.dx;delete frame.dy;}
      if(part?.joint&&frame.rotation!==undefined){
        const {min,max}=part.joint,base=part.rotation??0,angle=base+frame.rotation;
        frame.rotation=Math.max(min,Math.min(max,min>=0?Math.abs(angle):max<=0?-Math.abs(angle):angle))-base;
      }
      if(frame.rotation===0)frame.rotation=0; // canonicalise negative zero across checkpoint reloads
      for(const key of ['scaleX','scaleY'] as const)if(f[key]!==undefined)frame[key]=number(f[key],1,-20,20);
      if(f.opacity!==undefined)frame.opacity=number(f.opacity,1,0,1);
      if(f.fill!==undefined)frame.fill=paint(f.fill);
      if(f.d!==undefined)frame.d=path(f.d);
      if(f.easing!==undefined){
        if(!['linear','ease-in','ease-out','ease-in-out','smooth','hold'].includes(String(f.easing)))throw new Error('Vector: invalid easing');
        frame.easing=f.easing as VectorFrame['easing'];
      }
      // Missing easing on intermediate keys used to create velocity corners,
      // even when only the final key said smooth. Preserve explicit cuts/holds.
      if(frame.easing===undefined&&['dx','dy','rotation','scaleX','scaleY'].some(k=>k in frame))frame.easing='smooth';
      return frame;
    }).sort((a,b)=>a.t-b.t);
    const floorTargets=new Set(drawing.nodes.filter(n=>n.groundMark).flatMap(n=>[n.id,n.parent!]).filter(Boolean));
    if(floorTargets.has(target)&&frames.some(f=>['dx','dy','rotation','scaleX','scaleY'].some(k=>k in f)))throw new Error('Vector: ground marks cannot move off their surface; change the grounded endpoints instead');
    const cue=typeof t.cue==='string'&&t.cue.trim()?t.cue.trim():undefined;
    if(cue&&spoken&&!spoken.includes(cue))throw new Error(`Vector: speech cue absent from narration: ${cue}`);
    const cueOffsetMs=t.cueOffsetMs===undefined?undefined:number(t.cueOffsetMs,0,0,60000);
    return {target,start,end,frames,...(cue?{cue}:{}),...(cueOffsetMs===undefined?{}:{cueOffsetMs}),...(t.ensemble===true?{ensemble:true as const}:{})};
  });
  for(let i=0;i<tracks.length;i++)for(let j=i+1;j<tracks.length;j++){
    const a=tracks[i]!,b=tracks[j]!;
    if(!a.ensemble&&!b.ensemble&&a.target===b.target&&a.start<b.end&&b.start<a.end){
      const channels=new Set(a.frames.flatMap(f=>Object.keys(f).filter(k=>!['t','easing'].includes(k))));
      if(b.frames.some(f=>Object.keys(f).some(k=>channels.has(k))))throw new Error(`Vector: overlapping tracks for ${a.target}`);
    }
  }
  for(const prop of drawing.nodes.filter(n=>n.attachTo)){
    const [actor,hand]=prop.attachTo!.split('/');
    if(!/^hand-[lr]$/.test(hand!))continue;
    const rest=vectorRaisedLampHand(drawing,assets,actor!,hand!.slice(-1));
    if(rest){
      const defaults=Object.fromEntries(Object.entries(rest).filter(([key])=>!tracks.some(t=>t.target===prop.attachTo&&t.frames.some(f=>f[key as 'dx'|'dy']!==undefined))));
      if(Object.keys(defaults).length)tracks.push({target:prop.attachTo!,start:0,end:1,frames:[{t:0,...defaults}]});
    }
  }
  const stage={...drawing,tracks};
  // Canonical data contains only normal nodes/tracks. A second compile must not
  // wrap or multiply the camera again.
  if(data.shot!==undefined){
    if(data.camera!==undefined)throw new Error('Vector: choose subject framing or explicit camera');
    return frameVectorScene(stage,vectorSubjectCamera(stage,assets,data.shot));
  }
  return data.camera===undefined?stage:frameVectorScene(stage,data.camera as VectorCameraFrame[]);
}
/** One measured speech anchor for an ordered reveal. Compiles once to the same
 * ordinary tracks used by Canvas and Remotion; no runtime/model timing guesses. */
function vectorRevealTracks(raw:unknown):VectorTrack[]{
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>16)throw new Error('Vector: invalid reveals');
  return raw.flatMap(value=>{
    if(!value||typeof value!=='object')throw new Error('Vector: invalid reveal');
    const r=value as Record<string,unknown>;
    if(!Array.isArray(r.targets)||!r.targets.length||r.targets.length>16||new Set(r.targets).size!==r.targets.length)throw new Error('Vector: reveal needs distinct ordered targets');
    if(r.cue!==undefined&&(typeof r.cue!=='string'||!r.cue.trim()))throw new Error('Vector: invalid reveal cue');
    const start=number(r.start,0,0,1),end=number(r.end,.015,0,1),stepMs=number(r.stepMs,350,0,4000);
    if(end<=start)throw new Error('Vector: reveal must have positive duration');
    if(r.grow!==undefined&&!['x','y'].includes(String(r.grow)))throw new Error('Vector: invalid reveal growth axis');
    return r.targets.map((target,index)=>{
      const growth=r.grow==='x'?'scaleX':r.grow==='y'?'scaleY':undefined;
      const frames:VectorFrame[]=growth?
        [{t:0,opacity:0,[growth]:.04},{t:.04,opacity:1},{t:1,[growth]:1,easing:'ease-in-out'}]:
        [{t:0,opacity:0},{t:1,opacity:1,easing:'ease-out'}];
      return {target:target as string,start,end,cue:r.cue as string|undefined,cueOffsetMs:index*stepMs,frames};
    });
  });
}
export function compileVectorProject(project:CanvasStudioProject):CanvasStudioProject {
  id(project.id);
  if(!Array.isArray(project.scenes)||!project.scenes.length||project.scenes.length>100)throw new Error('Vector: invalid shot collection');
  const sceneIds=project.scenes.map(scene=>id(scene.id));
  if(new Set(sceneIds).size!==sceneIds.length)throw new Error('Vector: duplicate shot identity');
  const assets=readableVectorNightAssets(normalizeVectorAssets(project.vectorAssets),project.sourcePrompt||'');
  for(const scene of project.scenes)for(const beat of scene.vectorDirection?.beats||[]){
    if(!beat.fear)continue;
    const actor=scene.vectorScene?.nodes.find(n=>n.id===beat.fear!.actor&&n.type==='instance');
    if(actor&&assets[actor.asset!])assets[actor.asset!]=normalizeVectorDrawing(withPuppetFearEffects(assets[actor.asset!]!));
  }
  if(project.scenes.some(s=>!s.vectorScene))throw new Error('Vector: every shot needs authored artwork; refusing a mixed fallback');
  const vectorStages=project.vectorStages?Object.fromEntries(Object.entries(project.vectorStages).map(([key,value])=>[id(key),normalizeVectorScene(value,assets)])):undefined;
  const previousTrails=new Map<string,{scene:CanvasStudioScene;nodes:VectorNode[]}>();
  const propStates=new Map<string,VectorPropState>();
  let previousShot:CanvasStudioScene|undefined;
  let elapsedMs=0;
  const ensemble=new VectorEnsembleDirector();
  return {...project,vectorAssets:assets,...(vectorStages?{vectorStages}:{}),scenes:project.scenes.map(scene=>{
    if(scene.vectorDirection?.continuity==='reset'){previousShot=undefined;previousTrails.clear();}
    // Rebuild derived ensemble animation on the measured clock, rather than
    // treating the preceding export's generated keys as new AI instructions.
    const authored={...scene.vectorScene!,tracks:scene.vectorScene!.tracks.filter(t=>!t.ensemble)};
    let drawing=readableVectorNightScene(normalizeVectorScene(authored,assets,scene.narration||scene.dialogue?.map(l=>l.text).join(' ')||''),project.sourcePrompt||'');
    if(drawing.width!==project.width||drawing.height!==project.height)throw new Error('Vector: shot frame orientation differs from the project');
    // The screenplay owns the intended view; illustration/repair cannot
    // replace a rear turn with a mirrored front or reset it before the cue.
    // Rebuild only these channels, retaining travel, acting and attachments.
    const spoken=scene.narration||scene.dialogue?.map(line=>line.text).join(' ')||'';
    const turns=scene.vectorDirection?.beats.flatMap(beat=>{
      if(!beat.turn)return [];
      const duration=Math.min(1,300/scene.durationMs);
      // Distinct cue onsets also need distinct fallback intervals for structural
      // validation. Actual playback still follows measured speech via cue.
      const start=Math.min(1-duration,Math.max(0,spoken.indexOf(beat.cue))/Math.max(1,spoken.length));
      return [{...beat.turn,cue:beat.cue,start,end:start+duration}];
    })||[];
    const fears=scene.vectorDirection?.beats.flatMap(beat=>{
      if(!beat.fear)return [];
      const duration=Math.min(1,2400/scene.durationMs),start=Math.min(1-duration,Math.max(0,spoken.indexOf(beat.cue))/Math.max(1,spoken.length));
      return [{...beat.fear,cue:beat.cue,start,end:start+duration}];
    })||[];
    if(turns.length||fears.length){
      const turnTracks=vectorPuppetTurnTracks(drawing,assets,turns),fearTracks=vectorPuppetFearTracks(drawing,assets,fears,scene.durationMs);
      const native=[...turnTracks,...fearTracks],controlled=new Map<string,Set<string>>();
      for(const track of turnTracks){
        const keys=controlled.get(track.target)||new Set<string>();
        for(const frame of track.frames)for(const key of Object.keys(frame))if(key!=='t'&&key!=='easing')keys.add(key);
        controlled.set(track.target,keys);
      }
      const retained=drawing.tracks.map(track=>{
        const keys=new Set(controlled.get(track.target)||[]);
        // Fear owns its brief interval, not an earlier walk/look on the same
        // body. Matching cues also remove a misplaced illustrator substitute.
        for(const fear of fearTracks)if(fear.target===track.target&&(fear.cue===track.cue||fear.start<track.end&&track.start<fear.end))
          for(const frame of fear.frames)for(const key of Object.keys(frame))if(key!=='t'&&key!=='easing')keys.add(key);
        return keys.size?{...track,frames:track.frames.map(frame=>Object.fromEntries(Object.entries(frame).filter(([key])=>!keys.has(key))) as VectorFrame)}:track;
      }).filter(track=>track.frames.some(frame=>Object.keys(frame).some(key=>key!=='t'&&key!=='easing')));
      drawing=normalizeVectorScene({...drawing,tracks:[...retained,...native]},assets,scene.narration||'');
    }
    // Establish the same camera parent before comparing poses across cuts.
    if(scene.vectorDirection&&drawing.nodes.some(n=>n.type==='instance'&&assets[n.asset!]?.nodes.some(p=>p.id==='puppet-root'))&&!drawing.nodes.some(n=>!n.parent&&/^camera-world(?:-\d+)?$/.test(n.id)))drawing=frameVectorScene(drawing,[{t:0,x:drawing.width/2,y:drawing.height/2,zoom:1}]);
    let compiled=continueCarriedJointPose(continueVectorProps({...scene,vectorAssetLibrary:assets,vectorScene:drawing},propStates,assets),propStates) as CanvasStudioScene&{vectorScene:CanvasVectorScene;vectorAssetLibrary:Record<string,VectorDrawing>};
    drawing=compiled.vectorScene;
    // Small root reactions are displacements from the held pose. Travel has
    // an absolute destination (e.g. a door), which must not be shifted.
    const continuedFrames=(track:VectorTrack,key:'dx'|'dy'|'rotation',value:number)=>{
      const first=track.frames.find(f=>f[key]!==undefined)!;
      const instance=drawing.nodes.find(n=>n.id===track.target&&n.type==='instance');
      const relative=key!=='rotation'&&first[key]===0&&assets[instance?.asset||'']?.nodes.some(n=>n.id==='puppet-root')
        &&scene.vectorDirection?.beats.some(b=>b.cue===track.cue&&b.kind==='motion'&&b.motionTargets.includes(track.target));
      const delta=value-first[key]!;
      if(Math.abs(delta)<1e-8)return track.frames;
      const last=track.frames.filter(f=>f[key]!==undefined).at(-1)!;
      // Rebase the WHOLE absolute route, preserving its destination. Changing
      // only the first key made a continued walk jump backwards at key two.
      if(!relative&&instance&&track.target===instance.id&&key!=='rotation'&&Math.abs(last[key]!-first[key]!)>1e-8){
        const scale=(last[key]!-value)/(last[key]!-first[key]!);
        return track.frames.map(f=>f[key]===undefined?f:{...f,[key]:f===last?last[key]!:value+(f[key]!-first[key]!)*scale});
      }
      return track.frames.map(f=>relative&&f[key]!==undefined?{...f,[key]:f[key]!+delta}:f===first?{...f,[key]:value}:f);
    };
    const blinks=puppetBlinkTracks(compiled,assets,elapsedMs);
    elapsedMs+=scene.durationMs;
    if(blinks.length)compiled={...compiled,vectorScene:{...drawing,tracks:[...drawing.tracks,...blinks]}};
    // A cast member revealed in a shared world stays present in the next cut.
    // Replacing its root pose must not restore the stage's hidden entrance
    // default. Explicit visibility animation and time/location changes win.
    if(previousShot&&scene.vectorStageId&&scene.vectorStageId===previousShot.vectorStageId){
      for(const node of drawing.nodes){
        if(node.type!=='instance'||node.opacity!==0||!assets[node.asset!]?.nodes.some(p=>p.id==='head-group')
          ||drawing.tracks.some(t=>t.target===node.id&&t.frames.some(f=>f.opacity!==undefined)))continue;
        const prior=previousShot.vectorScene!.nodes.find(n=>n.id===node.id);
        if(prior&&evaluateVectorPart(node.id,previousShot,previousShot.durationMs,prior.opacity??1).opacity>.8
          &&scene.vectorDirection?.beats.some(b=>b.kind!=='hide'&&b.targets.some(t=>t===node.id||t.startsWith(node.id+'/'))))node.opacity=1;
      }
    }
    // A held trail is the same physical clue, not a fresh drawing. Carry the
    // latest geometry through cuts, including repairs to count/size/colour.
    if(scene.vectorStageId&&drawing.ground){
      const roots=new Set(drawing.nodes.filter(n=>n.groundMark).map(n=>n.parent!));
      for(const root of roots){
        const owned=new Set([root]);let count=0;
        while(count!==owned.size){count=owned.size;for(const n of compiled.vectorScene.nodes)if(n.parent&&owned.has(n.parent))owned.add(n.id);}
        const marks=compiled.vectorScene.nodes.filter(n=>n.groundMark&&owned.has(n.id));
        const held=marks.every(n=>[0,scene.durationMs].every(t=>evaluateVectorPart(n.id,compiled,t,n.opacity??1).opacity===1))
          &&!compiled.vectorScene.tracks.some(t=>owned.has(t.target)&&t.frames.some(f=>f.opacity!==undefined&&f.opacity!==1));
        const key=scene.vectorStageId+'/'+root,previous=previousTrails.get(key);
        if(held&&previous&&previous.scene.vectorScene!.ground!.y===drawing.ground.y){
          const replacement=previous.nodes.map(n=>({...n,...(n.id===root?{parent:drawing.ground!.parent}:{}),...(n.groundMark?{opacity:1}:{})}));
          const nodes=compiled.vectorScene.nodes,at=nodes.findIndex(n=>n.id===root),remaining=nodes.filter(n=>!owned.has(n.id));
          remaining.splice(at,0,...replacement);
          compiled={...compiled,vectorScene:{...compiled.vectorScene,nodes:remaining,tracks:compiled.vectorScene.tracks.filter(t=>!owned.has(t.target))}};
        }
        const nodes=compiled.vectorScene.nodes,ids=new Set([root]);let size=0;
        while(size!==ids.size){size=ids.size;for(const n of nodes)if(n.parent&&ids.has(n.parent))ids.add(n.id);}
        if(nodes.filter(n=>n.groundMark&&ids.has(n.id)).every(n=>evaluateVectorPart(n.id,compiled,scene.durationMs,n.opacity??1).opacity===1))
          previousTrails.set(key,{scene:compiled,nodes:nodes.filter(n=>ids.has(n.id))});
        else previousTrails.delete(key);
      }
    }
    // A carried prop cannot jump to a different shoulder/elbow pose at a cut.
    // Start an authored transition from the preceding joint angle, retaining
    // its intended destination and timing. Deliberately held poses stay authored.
    if(scene.vectorStageId&&previousShot?.vectorStageId===scene.vectorStageId){
      const previous=previousShot,initial=new Map<VectorTrack,number>();
      // Newly directed films retain unmentioned actor poses through a cut.
      // Copy transforms only: clues/light visibility are explicit story events.
      if(scene.vectorDirection){
        const held:VectorTrack[]=[];
        const actors=drawing.nodes.filter(n=>n.type==='instance'&&previous.vectorScene!.nodes.some(old=>
          old.id===n.id&&old.asset===n.asset));
        for(const actor of actors){
          const oldActor=previous.vectorScene!.nodes.find(n=>n.id===actor.id)!;
          // Keep the actual facing/rear drawing through a camera cut. Root
          // position continuity alone would show a front face again next shot.
          const rig=assets[actor.asset!]!;
          if(rig.nodes.some(n=>n.id==='puppet-root')){
            const target=actor.id+'/upper-body',facing=evaluateVectorPart(target,previous,previous.durationMs).scaleX;
            const current=compiled.vectorScene.tracks.filter(t=>t.target===target&&t.frames.some(f=>f.scaleX!==undefined));
            const route=compiled.vectorScene.tracks.find(t=>t.target===actor.id&&t.frames.some(f=>f.dx!==undefined&&f.dx!==t.frames.find(k=>k.dx!==undefined)?.dx));
            const values=current.flatMap(t=>t.frames.filter(f=>f.scaleX!==undefined).map(f=>f.scaleX!));
            // A new forward route may reverse the held facing. Show the flip
            // at departure, rather than changing the silhouette at the cut.
            if(route&&values.length&&values.every(v=>v===values[0])&&Math.sign(values[0]!)!==Math.sign(facing)
              &&!scene.vectorDirection.beats.some(b=>b.turn?.actor===actor.id)){
              const retained=compiled.vectorScene.tracks.map(t=>current.includes(t)?{...t,frames:t.frames.map(({scaleX,...f})=>f)}:t)
                .filter(t=>t.frames.some(f=>Object.keys(f).some(k=>k!=='t'&&k!=='easing')));
              const flip:VectorTrack={target,start:route.start,end:Math.min(route.end,route.start+300/scene.durationMs),...(route.cue?{cue:route.cue}:{}),frames:[{t:0,scaleX:facing,easing:'hold'},{t:.5,scaleX:values[0]!,easing:'hold'},{t:1,scaleX:values[0]!,easing:'hold'}]};
              compiled={...compiled,vectorScene:{...compiled.vectorScene,tracks:[...retained,flip]}};
            }
            // A repeated constant facing from illustration is a held pose,
            // not permission to undo an ensemble interaction at the cut.
            if(!scene.vectorDirection.beats.some(b=>b.turn?.actor===actor.id)&&values.length){
              if(!route&&values.every(v=>v===values[0]))compiled={...compiled,vectorScene:{...compiled.vectorScene,tracks:compiled.vectorScene.tracks.map(t=>current.includes(t)?{...t,frames:t.frames.map(f=>f.scaleX===undefined?f:{...f,scaleX:facing})}:t)}};
              else if(route&&!values.every(v=>v===values[0])){
                const first=[...current].sort((a,b)=>a.start-b.start)[0]!;
                // A retained native departure flip may have been compiled
                // against the old crowd schedule. Rejoin its first pose,
                // keeping its authored destination and spoken departure.
                if(first.cue===route.cue&&first.frames[0]?.easing==='hold')compiled={...compiled,vectorScene:{...compiled.vectorScene,tracks:compiled.vectorScene.tracks.map(t=>t===first?{...t,frames:t.frames.map((f,i)=>i||f.scaleX===undefined?f:{...f,scaleX:facing})}:t)}};
              }
            }
            for(const part of ['upper-body',...puppetTurnOpacityParts]){
              if(!rig.nodes.some(n=>n.id===part))continue;
              const target=actor.id+'/'+part,key=part==='upper-body'?'scaleX':'opacity';
              if(!previous.vectorScene!.tracks.some(t=>t.target===target&&t.frames.some(f=>f[key]!==undefined))
                ||compiled.vectorScene.tracks.some(t=>t.target===target&&t.frames.some(f=>f[key]!==undefined)))continue;
              const value=evaluateVectorPart(target,previous,previous.durationMs,rig.nodes.find(n=>n.id===part)!.opacity??1)[key];
              held.push({target,start:0,end:1,frames:[{t:0,[key]:value}],...(previous.vectorScene!.tracks.some(t=>t.target===target&&t.ensemble)?{ensemble:true as const}:{})});
            }
          }
          const samePlacement=oldActor.x===actor.x&&oldActor.y===actor.y&&oldActor.parent===actor.parent;
          const parts=assets[actor.asset!]!.nodes.filter(n=>/^(body-pose|upper-body|head-group|eyes|(?:arm|forearm|hand|leg|knee|foot|hoof)-[a-z]+)$/.test(n.id));
          for(const target of [...(samePlacement?[actor.id]:[]),...parts.map(n=>actor.id+'/'+n.id)])for(const key of ['dx','dy','rotation'] as const){
            const value=evaluateVectorPart(target,previous,previous.durationMs)[key];
            const tracks=compiled.vectorScene.tracks.filter(t=>t.target===target&&t.frames.some(f=>f[key]!==undefined)).sort((a,b)=>a.start-b.start);
            if(!tracks.length&&Math.abs(value)>1e-8)held.push({target,start:0,end:1,frames:[{t:0,[key]:value}],...(previous.vectorScene!.tracks.some(t=>t.target===target&&t.ensemble)?{ensemble:true as const}:{})});
            const first=tracks[0];
            const moving=tracks.some(t=>t.frames.some(f=>f[key]!==undefined&&f[key]!==t.frames.find(f=>f[key]!==undefined)![key]));
            const mentioned=scene.vectorDirection.beats.some(b=>b.motionTargets.includes(target)||(target===actor.id+'/body-pose'&&b.targets.includes(actor.id)));
            if(first&&!moving&&!mentioned)compiled={...compiled,vectorScene:{...compiled.vectorScene,tracks:compiled.vectorScene.tracks.map(t=>tracks.includes(t)?{...t,frames:t.frames.map(f=>f[key]===undefined?f:{...f,[key]:value})}:t)}};
            if(first&&first.frames[0]!.t===0&&first.frames[0]![key]!==undefined&&first.frames.some(f=>f[key]!==undefined&&f[key]!==first.frames[0]![key]))
              compiled={...compiled,vectorScene:{...compiled.vectorScene,tracks:compiled.vectorScene.tracks.map(t=>t===first?{...t,frames:continuedFrames(t,key,value)}:t)}};
          }
        }
        if(held.length)compiled={...compiled,vectorScene:normalizeVectorScene({...compiled.vectorScene,tracks:[...compiled.vectorScene.tracks,...held]},assets,scene.narration||'')};
      }
      for(const prop of drawing.nodes.filter(n=>n.attachTo)){
        if(!previous.vectorScene!.nodes.some(n=>n.id===prop.id&&n.asset===prop.asset&&n.attachTo===prop.attachTo))continue;
        const [owner,hand]=prop.attachTo!.split('/'),instance=drawing.nodes.find(n=>n.id===owner);
        if(!instance?.asset||!previous.vectorScene!.nodes.some(n=>n.id===owner&&n.asset===instance.asset))continue;
        const rig=assets[instance.asset]!;
        let part=rig.nodes.find(n=>n.id===hand);
        while(part?.parent){
          part=rig.nodes.find(n=>n.id===part!.parent);if(!part)break;
          const target=owner+'/'+part.id;
          const first=compiled.vectorScene.tracks.filter(t=>t.target===target&&t.frames.some(f=>f.rotation!==undefined)).sort((a,b)=>a.start-b.start)[0];
          if(first&&first.frames[0]!.t===0&&first.frames[0]!.rotation!==undefined&&first.frames.some(f=>f.rotation!==undefined&&f.rotation!==first.frames[0]!.rotation))
            initial.set(first,evaluateVectorPart(target,previous,previous.durationMs).rotation);
        }
      }
      compiled={...compiled,vectorScene:{...compiled.vectorScene,tracks:compiled.vectorScene.tracks.map(track=>{
        const angle=initial.get(track);
        if(angle===undefined)return track;
        return {...track,frames:track.frames.map((f,i)=>i?f:{...f,rotation:angle})};
      })}};
    }
    // Multiple cue-linked gestures on the same joint must start where the
    // preceding gesture ended, rather than snapping back to a fresh zero pose.
    const continued=new Map<VectorTrack,VectorTrack>();
    const movingTargets=new Set(drawing.nodes.filter(n=>n.type==='instance').flatMap(n=>[
      n.id,...assets[n.asset!]!.nodes.filter(p=>p.type==='group').map(p=>n.id+'/'+p.id),
    ]));
    for(const target of movingTargets)for(const key of ['dx','dy','rotation'] as const){
      const ordered=compiled.vectorScene.tracks.filter(t=>t.target===target&&t.frames.some(f=>f[key]!==undefined))
        .sort((a,b)=>vectorTrackTiming(a,compiled).start-vectorTrackTiming(b,compiled).start);
      for(let i=1;i<ordered.length;i++){
        const prev=continued.get(ordered[i-1]!)||ordered[i-1]!,next=continued.get(ordered[i]!)||ordered[i]!;
        if(vectorTrackTiming(next,compiled).start<vectorTrackTiming(prev,compiled).end)continue;
        const first=next.frames.find(f=>f[key]!==undefined),last=prev.frames.filter(f=>f[key]!==undefined).at(-1)!;
        if(first?.t!==0||!next.frames.some(f=>f[key]!==undefined&&f[key]!==first[key]))continue;
        continued.set(ordered[i]!,{...next,frames:continuedFrames(next,key,last[key]!)});
      }
    }
    if(continued.size)compiled={...compiled,vectorScene:{...compiled.vectorScene,tracks:compiled.vectorScene.tracks.map(t=>continued.get(t)||t)}};
    const previousView=previousShot;
    previousShot=releaseVectorProps(naturalVectorCarryPose(groundDirectedActing(balanceGroundedActingFrame(compiled,assets),assets),assets),propStates,assets);
    previousShot=balanceGroundedActingFrame(previousShot,assets);
    // Viewpoint visibility is separate from hand inventory. An actor inside
    // the house must not respawn outside when cutting back to the yard.
    if(scene.vectorDirection?.visibleCast!==undefined){
      const visible=new Set(scene.vectorDirection.visibleCast);
      const actors=new Set(previousShot.vectorScene!.nodes.filter(n=>n.type==='instance'&&assets[n.asset!]?.nodes.some(p=>p.id==='head-group')).map(n=>n.id));
      const d=previousShot.vectorScene!;
      // Cropping a continuous market view does not make established shoppers
      // cease to exist. Let the camera crop them; keep explicit empty views,
      // departures and different locations authoritative.
      if(visible.size&&previousView&&previousView.vectorStageId===scene.vectorStageId&&scene.vectorStageId&&d.nodes.some(n=>n.id==='market-square')){
        for(const id of actors){
          const old=previousView.vectorScene?.nodes.find(n=>n.id===id);
          const hidden=scene.vectorDirection.beats.some(b=>b.kind==='hide'&&(b.targets.includes(id)||b.motionTargets.includes(id)));
          if(id!=='person'&&old&&!hidden&&evaluateVectorPart(id,previousView,previousView.durationMs,old.opacity??1).opacity>.5)visible.add(id);
        }
      }
      previousShot={...previousShot,vectorDirection:{...previousShot.vectorDirection!,visibleCast:[...visible]},vectorScene:{...d,nodes:d.nodes.map(n=>actors.has(n.id)?{...n,opacity:visible.has(n.id)?
        (d.tracks.some(t=>t.target===n.id&&t.frames.some(f=>f.opacity!==undefined))?n.opacity:1):0}:n),
        tracks:d.tracks.flatMap(t=>{
          if(!actors.has(t.target)||visible.has(t.target))return [t];
          const frames=t.frames.map(({opacity,...f})=>f);
          return frames.some(f=>Object.keys(f).some(k=>k!=='t'&&k!=='easing'))?[{...t,frames}]:[];
        })}};
    }
    previousShot=directVectorShot(previousShot,assets);
    previousShot=ensemble.direct(previousShot,assets);
    rememberVectorProps(previousShot,propStates,assets);
    return previousShot;
  })};
}
export function vectorTrackTiming(track:VectorTrack,scene:CanvasStudioScene){
  let start=track.start*scene.durationMs;
  if(track.cue){
    const line=scene.dialogue?.find(l=>l.text.includes(track.cue!)&&l.durationMs);
    if(line){
      const fraction=line.text.indexOf(track.cue)/Math.max(1,line.text.length);
      const windows=(line.speechWindows||[]).filter(w=>w.endMs>w.startMs&&w.startMs>=0&&w.endMs<=line.durationMs!);
      let remaining=fraction*(windows.length?windows.reduce((sum,w)=>sum+w.endMs-w.startMs,0):line.durationMs!);
      let offset=remaining;
      for(const window of windows){offset=window.startMs+Math.min(remaining,window.endMs-window.startMs);if(remaining<=window.endMs-window.startMs)break;remaining-=window.endMs-window.startMs;}
      start=(line.atMs||0)+offset;
    }
  }
  start+=track.cueOffsetMs||0;
  return {start,end:Math.min(scene.durationMs,start+(track.end-track.start)*scene.durationMs)};
}
/** Monotone cubic Hermite: velocity continues through intermediate keys,
 * rests at reversals/endpoints, and never overshoots bounded poses/opacity. */
function smoothVectorValue(frames:VectorFrame[],from:VectorFrame,to:VectorFrame,t:number,key:'dx'|'dy'|'rotation'|'scaleX'|'scaleY'|'opacity'){
  if(from===to)return Number(from[key]);
  const a=frames.indexOf(from),b=frames.indexOf(to),h=to.t-from.t;
  const tangent=(i:number)=>{
    if(i<=0||i>=frames.length-1)return 0;
    const prev=frames[i-1]!,current=frames[i]!,next=frames[i+1]!;
    if(current.easing==='hold'||next.easing==='hold')return 0;
    const h0=current.t-prev.t,h1=next.t-current.t;
    const d0=(Number(current[key])-Number(prev[key]))/h0,d1=(Number(next[key])-Number(current[key]))/h1;
    if(d0*d1<=0)return 0;
    const w0=2*h1+h0,w1=h1+2*h0;
    return (w0+w1)/(w0/d0+w1/d1);
  };
  const u=(t-from.t)/h,u2=u*u,u3=u2*u;
  return (2*u3-3*u2+1)*Number(from[key])+(u3-2*u2+u)*h*tangent(a)
    +(-2*u3+3*u2)*Number(to[key])+(u3-u2)*h*tangent(b);
}
export function evaluateVectorPart(target:string,scene:CanvasStudioScene,timeMs:number,restingOpacity=1){
  const result={dx:0,dy:0,rotation:0,scaleX:1,scaleY:1,opacity:restingOpacity,fill:undefined as string|undefined,d:undefined as string|undefined};
  const authored=new Set<string>();
  const tracks=(scene.vectorScene?.tracks||[]).filter(t=>t.target===target).map(track=>({track,...vectorTrackTiming(track,scene)})).sort((a,b)=>a.start-b.start);
  for(const {track,start,end} of tracks){
    if(timeMs<start){
      // Clamp each channel to its first authored state before the first track.
      // Otherwise delayed motion snaps from the resting pose at its start.
      // Later tracks must not erase a previously completed channel.
      for(const key of ['dx','dy','rotation','scaleX','scaleY','opacity','fill','d'] as const){
        const initial=track.frames.find(f=>f[key]!==undefined);
        if(!authored.has(key)&&initial?.t===0){
          if(key==='fill'||key==='d')result[key]=initial[key];
          else result[key]=initial[key]!;
          authored.add(key);
        }
      }
      continue;
    }
    const t=Math.min(1,Math.max(0,(timeMs-start)/Math.max(1,end-start)));
    for(const key of ['dx','dy','rotation','scaleX','scaleY','opacity'] as const){
      const frames=track.frames.filter(f=>f[key]!==undefined);
      if(!frames.length)continue;
      authored.add(key);
      if(frames[0]!.t>0)frames.unshift({t:0,[key]:result[key]});
      let from=frames[0]!,to=from;
      for(const frame of frames){if(frame.t<=t)from=frame;else{to=frame;break;}to=from;}
      let mix=to.t===from.t?1:(t-from.t)/(to.t-from.t);
      const easing=to.easing||from.easing;
      if(easing==='smooth'){
        result[key]=smoothVectorValue(frames,from,to,t,key);continue;
      }
      if(easing==='hold')mix=0;
      else if(easing==='ease-in')mix=mix**3;
      else if(easing==='ease-out')mix=1-(1-mix)**3;
      else if(easing==='ease-in-out')mix=mix<.5?4*mix**3:1-(-2*mix+2)**3/2;
      result[key]=Number(from[key])+(Number(to[key])-Number(from[key]))*mix;
    }
    for(const key of ['fill','d'] as const)for(const frame of track.frames)if(frame.t<=t&&frame[key]!==undefined){result[key]=frame[key];authored.add(key);}
  }
  return result;
}
