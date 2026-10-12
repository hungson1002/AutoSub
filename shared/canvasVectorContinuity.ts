import type {CanvasStudioScene,CanvasVectorDirection} from './canvasAnimationStudio';
import {evaluateVectorPart,vectorTrackTiming,type VectorDrawing,type VectorNode,type VectorTrack,type VectorFrame} from './canvasVectorScene';
import {vectorCarryDrawing,vectorPropGrip} from './canvasVectorProps';
import {vectorWorldMatrix,vectorPoint} from './canvasVectorTransform';
import {solveVectorArm} from './canvasVectorReach';

type Hand=NonNullable<CanvasVectorDirection['heldProps']>[number];
type Library=Record<string,VectorDrawing>;
export type VectorPropState={node:VectorNode;scene:CanvasStudioScene;held?:Hand;grip?:{x:number;y:number}};
const rounded=(v:number)=>Math.round(v*1e8)/1e8;
const channels=['dx','dy','rotation','scaleX','scaleY','opacity','fill'] as const;

/** Missing an item in a close-up's inventory is not a put-down. Old saved
 * plans can express release through an observable beat; new plans also have
 * an explicit event, anchored to an exact spoken phrase. */
export function vectorPropEvents(direction:CanvasVectorDirection,previous:Hand[]){
  const events=[...(direction.propEvents||[])];
  for(const held of previous){
    if(events.some(e=>e.prop===held.prop))continue;
    const beat=direction.beats.find(b=>b.targets.includes(held.prop)&&
      /buông|thả|vứt|treo|đặt.{0,35}(?:xuống|lên|vào)|release|drop|put down|hang /iu.test(b.cue+' '+b.after));
    if(beat)events.push({prop:held.prop,action:'release',cue:beat.cue});
  }
  return events;
}
export function continueVectorHandPlan(direction:CanvasVectorDirection,previous:Hand[]):CanvasVectorDirection {
  if(direction.continuity==='reset')previous=[];
  const events=vectorPropEvents(direction,previous),released=new Set(events.filter(e=>e.action==='release').map(e=>e.prop));
  const held=[...(direction.heldProps||[])].filter(h=>!released.has(h.prop));
  for(const prior of previous){
    const current=held.find(h=>h.prop===prior.prop);
    if(current&&(current.actor!==prior.actor||current.arm!==prior.arm)&&!released.has(prior.prop))
      throw new Error(`Vector: ${prior.prop} changes hands without a visible release/take event`);
    if(!current&&!released.has(prior.prop))held.push(prior);
  }
  if(new Set(held.map(h=>h.actor+'/'+h.arm)).size!==held.length)throw new Error('Vector: release the occupied hand before taking another prop');
  return {...direction,...(direction.heldProps!==undefined||held.length?{heldProps:held}:{}),...(events.length?{propEvents:events}:{})};
}
function stripChannels(track:VectorTrack,keys:readonly string[]){
  const frames=track.frames.map(f=>Object.fromEntries(Object.entries(f).filter(([k])=>!keys.includes(k))) as VectorFrame);
  return frames.some(f=>Object.keys(f).some(k=>k!=='t'&&k!=='easing'))?{...track,frames}:undefined;
}
function replaceChannels(tracks:VectorTrack[],target:string,keys:readonly string[],replacement:VectorTrack){
  let inserted=false;
  const result=tracks.flatMap(t=>{
    if(t.target!==target||!t.frames.some(f=>keys.some(k=>k in f)))return [t];
    const stripped=stripChannels(t,keys),items:VectorTrack[]=stripped?[stripped]:[];
    if(!inserted){items.push(replacement);inserted=true;}
    return items;
  });
  if(!inserted)result.push(replacement);
  return result;
}
/** Resolve logical ownership and stored prop placement before joint/camera
 * compilation. Uses IDs and stage identity, never a particular story. */
export function continueVectorProps(input:CanvasStudioScene,states:Map<string,VectorPropState>,assets:Library):CanvasStudioScene {
  if(!input.vectorDirection||!input.vectorScene)return input;
  if(input.vectorDirection.continuity==='reset')states.clear();
  const previous=[...states.values()].flatMap(s=>s.held?[s.held]:[]);
  const attached=input.vectorScene.nodes.flatMap(n=>{
    const match=n.attachTo?.match(/^([^/]+)\/hand-([lr])$/);
    // A reusable stage may still contain its original carry attachment after
    // a release. That stale attachment is not a new pickup.
    return match&&(!states.has(n.id)||states.get(n.id)!.held)&&!input.vectorDirection!.heldProps?.some(h=>h.prop===n.id)?[{actor:match[1]!,arm:match[2] as 'l'|'r',prop:n.id,hang:n.hang===true}]:[];
  });
  const direction=continueVectorHandPlan({...input.vectorDirection,...(attached.length?{heldProps:[...(input.vectorDirection.heldProps||[]),...attached]}:{})},previous);
  let drawing={...input.vectorScene,nodes:input.vectorScene.nodes.map(n=>({...n})),tracks:[...input.vectorScene.tracks]};
  const events=new Set(direction.propEvents?.map(e=>e.prop));
  for(const [id,state] of states){
    const index=drawing.nodes.findIndex(n=>n.id===id),current=drawing.nodes[index];
    if(state.held||events.has(id))continue;
    if(state.scene.vectorStageId!==input.vectorStageId||!input.vectorStageId){
      if(current&&!direction.beats.some(b=>b.kind!=='hold'&&b.motionTargets.includes(id))){
        drawing.nodes=drawing.nodes.filter(n=>n.id!==id);drawing.tracks=drawing.tracks.filter(t=>t.target!==id&&!t.target.startsWith(id+'/'));
      }
      continue;
    }
    if(direction.beats.some(b=>b.kind!=='hold'&&b.motionTargets.includes(id)))continue;
    if(!current)continue; // A framing cut need not add unused offstage objects.
    const parent=current.parent;
    drawing.nodes[index]={...state.node,...(parent?{parent}:{})};if(!parent)delete drawing.nodes[index]!.parent;
    const end=evaluateVectorPart(id,state.scene,state.scene.durationMs,state.node.opacity??1);
    drawing.tracks=replaceChannels(drawing.tracks,id,channels,{target:id,start:0,end:1,frames:[{t:0,...Object.fromEntries(channels.filter(k=>end[k]!==undefined).map(k=>[k,end[k]])),easing:'smooth'}]});
  }
  for(const held of direction.heldProps||[]){
    const actor=drawing.nodes.find(n=>n.id===held.actor&&n.type==='instance');
    if(!actor){drawing.nodes=drawing.nodes.filter(n=>n.id!==held.prop);drawing.tracks=drawing.tracks.filter(t=>t.target!==held.prop&&!t.target.startsWith(held.prop+'/'));continue;}
    const old=states.get(held.prop);
    if(!drawing.nodes.some(n=>n.id===held.prop)&&old)drawing.nodes.push({...old.node,parent:actor.parent});
    const prop=drawing.nodes.find(n=>n.id===held.prop);if(!prop)continue;
    const grip=prop.attachTo?vectorPropGrip(assets[prop.asset!],prop):old?.grip??vectorPropGrip(assets[prop.asset!]);
    drawing={...drawing,...vectorCarryDrawing(drawing,assets,[{...held,grip}])};
    drawing.tracks=drawing.tracks.flatMap(t=>t.target===held.prop?[stripChannels(t,['dx','dy'])].filter(Boolean) as VectorTrack[]:[t]);
  }
  return {...input,vectorDirection:direction,vectorScene:drawing};
}

export function continueCarriedJointPose(input:CanvasStudioScene,states:Map<string,VectorPropState>):CanvasStudioScene {
  let scene=input;
  for(const held of input.vectorDirection?.heldProps||[]){
    if(!scene.vectorScene?.nodes.some(n=>n.id===held.actor&&n.type==='instance'))continue;
    const prior=states.get(held.prop);if(!prior?.held||prior.held.actor!==held.actor||prior.held.arm!==held.arm)continue;
    const owner=scene.vectorScene.nodes.find(n=>n.id===held.actor);
    if(scene.vectorAssetLibrary?.[owner?.asset||'']?.nodes.some(n=>n.id==='puppet-root'))continue;
    const targets=['arm','forearm'].map(p=>held.actor+'/'+p+'-'+held.arm);
    for(const target of targets){
      const angle=evaluateVectorPart(target,prior.scene,prior.scene.durationMs).rotation;
      const tracks=scene.vectorScene!.tracks.filter(t=>t.target===target&&t.frames.some(f=>f.rotation!==undefined));
      const moving=tracks.some(t=>t.frames.some(f=>f.rotation!==undefined&&f.rotation!==t.frames.find(f=>f.rotation!==undefined)!.rotation));
      if(moving){
        const first=tracks.sort((a,b)=>vectorTrackTiming(a,scene).start-vectorTrackTiming(b,scene).start)[0]!;
        scene={...scene,vectorScene:{...scene.vectorScene!,tracks:scene.vectorScene!.tracks.map(t=>t===first?{...t,frames:t.frames.map((f,i)=>i?f:{...f,rotation:angle})}:t)}};
      }else{
        const replacement:VectorTrack={target,start:0,end:1,frames:[{t:0,rotation:angle,easing:'smooth'}]};
        const rest=replaceChannels(scene.vectorScene!.tracks,target,['rotation'],replacement);
        scene={...scene,vectorScene:{...scene.vectorScene!,tracks:rest}};
      }
    }
  }
  return scene;
}

function inversePoint(m:ReturnType<typeof vectorWorldMatrix>,p:{x:number;y:number}){
  const det=m.a*m.d-m.b*m.c;
  return {x:(m.d*(p.x-m.e)-m.c*(p.y-m.f))/det,y:(-m.b*(p.x-m.e)+m.a*(p.y-m.f))/det};
}
/** Same-side IK is a constraint on a carried hand, not a stock gesture. Retain
 * the intended height/timing while preventing the hand crossing the torso. */
export function naturalVectorCarryPose(input:CanvasStudioScene,assets:Library):CanvasStudioScene {
  if(!input.vectorScene||!input.vectorDirection)return input;
  let scene=input;
  for(const prop of input.vectorScene.nodes.filter(n=>/\/hand-[lr]$/.test(n.attachTo||''))){
    const [actor,part]=prop.attachTo!.split('/'),side=part!.slice(-1);
    const node=input.vectorScene.nodes.find(n=>n.id===actor),rig=assets[node?.asset||''];
    if(!rig||rig.width!==240||rig.height!==480)continue;
    if(Math.abs(evaluateVectorPart(actor+'/upper-body',scene,scene.durationMs).rotation)>35)continue;
    const handPoint=(ms:number)=>inversePoint(vectorWorldMatrix(actor+'/upper-body',scene,ms,assets),vectorPoint(vectorWorldMatrix(prop.attachTo!,scene,ms,assets),0,0));
    const badPose=(ms:number)=>{
      const p=handPoint(ms),elbow=inversePoint(vectorWorldMatrix(actor+'/upper-body',scene,ms,assets),vectorPoint(vectorWorldMatrix(actor+'/forearm-'+side,scene,ms,assets),0,0));
      return (side==='l'?p.x>72:p.x<168)||Math.abs(evaluateVectorPart(actor+'/forearm-'+side,scene,ms).rotation)>120+.001||(p.y>=175&&elbow.y<189);
    };
    if(!Array.from({length:33},(_,i)=>badPose(i/32*scene.durationMs)).some(Boolean))continue;
    const targets=[actor+'/arm-'+side,actor+'/forearm-'+side],old=scene.vectorScene!.tracks.filter(t=>targets.includes(t.target));
    const boundaries=[...new Set([0,scene.durationMs,...old.flatMap(t=>{const timing=vectorTrackTiming(t,scene);return [timing.start,timing.end];})])].filter(t=>t>=0&&t<=scene.durationMs).sort((a,b)=>a-b);
    if(boundaries.length>13)throw new Error('Vector: split an overloaded carried-hand performance into fewer gestures');
    const tracks:VectorTrack[]=[];
    for(let j=1;j<boundaries.length;j++){
      const from=boundaries[j-1]!,to=boundaries[j]!;if(to-from<.01)continue;
      const source=old.find(t=>{const w=vectorTrackTiming(t,scene);return t.cue&&w.start<=from+.01&&w.end>=to-.01;});
      const cue=source?.cue,base=cue?vectorTrackTiming({target:'',start:0,end:1,cue,frames:[]},scene).start:0;
      const timing={start:from/scene.durationMs,end:to/scene.durationMs,...(cue?{cue,cueOffsetMs:Math.max(0,from-base)}:{})};
      const frames:VectorFrame[][]=[[],[]];
      const keys=[...new Set([0,.25,.5,.75,1,...old.flatMap(t=>{const w=vectorTrackTiming(t,scene);return t.frames.map(f=>rounded((w.start+(w.end-w.start)*f.t-from)/(to-from)));}).filter(t=>t>0&&t<1)])].sort((a,b)=>a-b);
      for(const t of keys){
        const p=handPoint(from+(to-from)*t),ax=side==='l'?80:160;
        let x=(side==='l'?Math.min(p.x,55):Math.max(p.x,185))-ax,y=p.y-190;
        const radius=Math.hypot(x,y),factor=Math.max(55,Math.min(104,radius))/Math.max(.001,radius);x*=factor;y*=factor;
        const pose=solveVectorArm(x,y,50,57,{min:-120,max:120});
        let angle=pose.shoulder;
        const previous=frames[0]!.at(-1)?.rotation??tracks.filter(t=>t.target===targets[0]).at(-1)?.frames.at(-1)?.rotation;
        if(previous!==undefined)angle+=360*Math.round((previous-angle)/360);
        frames[0]!.push({t,rotation:rounded(angle),easing:'smooth'});frames[1]!.push({t,rotation:rounded(pose.elbow),easing:'smooth'});
      }
      tracks.push(...targets.map((target,k)=>({target,...timing,frames:frames[k]!})));
    }
    scene={...scene,vectorScene:{...scene.vectorScene!,tracks:[...scene.vectorScene!.tracks.filter(t=>!targets.includes(t.target)),...tracks]}};
  }
  return scene;
}

/** Compile a release into ordinary world tracks: follow the hand up to its
 * cue, then fall onto the existing support. Preview and export share it. */
export function releaseVectorProps(input:CanvasStudioScene,states:Map<string,VectorPropState>,assets:Library):CanvasStudioScene {
  let scene=input;if(!scene.vectorScene||!scene.vectorDirection)return scene;
  for(const event of scene.vectorDirection.propEvents||[]){
    const prior=states.get(event.prop);if(event.action!=='release'||!prior?.held)continue;
    const {actor,arm}=prior.held,owner=scene.vectorScene!.nodes.find(n=>n.id===actor&&n.type==='instance');if(!owner)continue;
    const source=scene.vectorScene!.nodes.find(n=>n.id===event.prop)||prior.node,asset=assets[source.asset!]!,grip=prior.grip??vectorPropGrip(asset,prior.node);if(!grip)continue;
    const at=Math.min(scene.durationMs-1,vectorTrackTiming({target:'',start:0,end:1,cue:event.cue,frames:[]},scene).start);
    const parent=owner.parent,stageMatrix=(ms:number)=>parent?vectorWorldMatrix(parent,scene,ms,assets):{a:1,b:0,c:0,d:1,e:0,f:0};
    const w=source.width??asset.width,h=source.height??asset.height,px=grip.x*w/asset.width,py=grip.y*h/asset.height;
    const carried=vectorCarryDrawing({...scene.vectorScene!,nodes:[...scene.vectorScene!.nodes.filter(n=>n.id!==event.prop),source]},assets,[{...prior.held,grip}]);
    const attached={...scene,vectorScene:{...carried,tracks:scene.vectorScene!.tracks.filter(t=>t.target!==event.prop)}};
    const sample=(ms:number)=>{
      const world=vectorWorldMatrix(event.prop,attached,ms,assets),stage=stageMatrix(ms),p=inversePoint(stage,vectorPoint(world,grip.x,grip.y));
      return {dx:p.x,dy:p.y,rotation:(Math.atan2(world.b,world.a)-Math.atan2(stage.b,stage.a))*180/Math.PI};
    };
    const first=sample(at),oldTracks=scene.vectorScene!.tracks.filter(t=>t.target===event.prop),endState=evaluateVectorPart(event.prop,scene,scene.durationMs);
    const stored=/treo|đặt|put down|hang /iu.test(event.cue);
    const angle=stored||oldTracks.some(t=>t.frames.some(f=>f.rotation!==undefined))?endState.rotation:65;
    const r=angle*Math.PI/180,bottom=Math.max(...[[0,0],[w,0],[0,h],[w,h]].map(([x,y])=>(x!-px)*Math.sin(r)+(y!-py)*Math.cos(r)));
    const authored=scene.vectorScene!.nodes.some(n=>n.id===event.prop)?inversePoint(stageMatrix(scene.durationMs),vectorPoint(vectorWorldMatrix(event.prop,scene,scene.durationMs,assets),grip.x,grip.y)):{x:first.dx,y:first.dy};
    const goalY=stored?authored.y:(scene.vectorScene!.ground?.y??first.dy+100)-bottom,goalX=stored?authored.x:Math.max(30,Math.min(scene.vectorScene!.width-30,first.dx+(arm==='l'?-30:30)));
    const finish=Math.min(scene.durationMs,at+650),frames:VectorFrame[]=[];
    for(let i=0;i<=12;i++){const ms=at*i/12;frames.push({t:ms/scene.durationMs,...sample(ms),easing:'linear'});if(at===0)break;}
    for(const f of [.25,.5,.75,1])frames.push({t:(at+(finish-at)*f)/scene.durationMs,dx:first.dx+(goalX-first.dx)*f,dy:first.dy+(goalY-first.dy)*f*f,rotation:first.rotation+(angle-first.rotation)*f,easing:'linear'});
    if(finish<scene.durationMs)frames.push({t:1,dx:goalX,dy:goalY,rotation:angle,easing:'hold'});
    const node:VectorNode={...source,parent,x:-px,y:-py,pivotX:px,pivotY:py,pivotSpace:'local',rotation:0,scaleX:1,scaleY:1};delete node.attachTo;delete node.hang;delete node.groundAnchor;
    const tracks=scene.vectorScene!.tracks.flatMap(t=>t.target===event.prop?[stripChannels(t,['dx','dy','rotation','scaleX','scaleY'])].filter(Boolean) as VectorTrack[]:[t]);
    scene={...scene,vectorScene:{...scene.vectorScene!,nodes:[...scene.vectorScene!.nodes.filter(n=>n.id!==event.prop),node],tracks:[...tracks,{target:event.prop,start:0,end:1,frames:frames.map(f=>({...f,dx:rounded(f.dx!),dy:rounded(f.dy!),rotation:rounded(f.rotation!)}))}]}};
  }
  return scene;
}
export function rememberVectorProps(scene:CanvasStudioScene,states:Map<string,VectorPropState>,assets:Library){
  for(const node of scene.vectorScene!.nodes.filter(n=>n.type==='instance')){
    const grip=vectorPropGrip(assets[node.asset!],node)??states.get(node.id)?.grip;if(!grip)continue;
    states.set(node.id,{node,scene,grip,held:scene.vectorDirection?.heldProps?.find(h=>h.prop===node.id)});
  }
}
