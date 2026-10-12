import {vectorTrackTiming,type VectorDrawing,type VectorTrack} from './canvasVectorScene';
import type {CanvasStudioScene} from './canvasAnimationStudio';
import {vectorPoint,vectorWorldMatrix} from './canvasVectorTransform';
import {vectorRaisedLampHand} from './canvasVectorProps';

/** Both 2D IK branches reach the same point. Prefer the relaxed elbow below
 * the shoulder; a fixed left/right sign can instead fold it up into the neck. */
export function solveVectorArm(dx:number,dy:number,a:number,b:number,limits?:{min:number;max:number}){
  const bend=Math.acos(Math.max(-1,Math.min(1,(dx*dx+dy*dy-a*a-b*b)/(2*a*b))));
  const degrees=(rad:number)=>((rad*180/Math.PI+540)%360)-180;
  const choices=[bend,-bend].map(q=>({elbow:degrees(q),shoulder:degrees(Math.atan2(dy,dx)-Math.atan2(b*Math.sin(q),a+b*Math.cos(q))-Math.PI/2)}))
    .filter(p=>!limits||p.elbow>=limits.min-1e-6&&p.elbow<=limits.max+1e-6)
    .sort((p,q)=>Math.cos(q.shoulder*Math.PI/180)-Math.cos(p.shoulder*Math.PI/180));
  if(!choices.length)throw new Error('Vector: reach needs an over-folded elbow; move the endpoint farther from the shoulder');
  return choices[0]!;
}

/** Compile a physical hand endpoint into existing shoulder/elbow rotations.
 * Points are in the actor asset's coordinates; the same instance/world/camera
 * transform then moves hand and target together. No renderer-specific motion. */
export function vectorReachTracks(drawing:VectorDrawing,assets:Record<string,VectorDrawing>,raw:unknown,context?:CanvasStudioScene):VectorTrack[]{
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>16)throw new Error('Vector: invalid reaches');
  return raw.flatMap((value):VectorTrack[]=>{
    if(!value||typeof value!=='object')throw new Error('Vector: invalid reach');
    const r=value as Record<string,unknown>,instance=drawing.nodes.find(n=>n.id===r.actor&&n.type==='instance');
    const asset=instance?assets[instance.asset!]:undefined;
    if(!instance||!asset||!['l','r'].includes(String(r.arm)))throw new Error('Vector: reach needs an actor and left/right arm');
    const start=r.start??0,end=r.end??.35;
    if(typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>1||end<=start)throw new Error('Vector: invalid reach timing');
    if(r.hold!==undefined&&typeof r.hold!=='boolean')throw new Error('Vector: invalid reach hold');
    if(r.hold&&r.cue!==undefined)throw new Error('Vector: held reach cannot have a new spoken cue');
    if(r.withdraw!==undefined&&typeof r.withdraw!=='boolean'||r.hold&&r.withdraw)throw new Error('Vector: invalid reach withdrawal');
    const puppet=asset.nodes.some(n=>n.id==='puppet-root');
    let point=r.point as Record<string,unknown>|undefined;
    if(r.target!==undefined){
      const target=drawing.nodes.find(n=>n.id===r.target);
      if(!target||target.attachTo||target.id===instance.id)throw new Error('Vector: reach target must be a separate fixed object');
      const targetAsset=target.type==='instance'?assets[target.asset!]:undefined;
      const contact=point??targetAsset?.grip??{x:targetAsset?targetAsset.width/2:target.type==='ellipse'?0:(target.width??0)/2,y:targetAsset?targetAsset.height/2:target.type==='ellipse'?0:(target.height??0)/2};
      if(typeof contact.x!=='number'||typeof contact.y!=='number'||!Number.isFinite(contact.x)||!Number.isFinite(contact.y))throw new Error('Vector: reach needs a finite object-local point');
      const scene=context??{durationMs:1000,vectorScene:{...drawing,tracks:[]}} as unknown as CanvasStudioScene;
      const timing=vectorTrackTiming({target:'',start,end,cue:r.cue as string|undefined,frames:[]},scene);
      const at=timing.start+(timing.end-timing.start)*(r.withdraw?.55:.8);
      const p=vectorPoint(vectorWorldMatrix(target.id,scene,at,assets),contact.x,contact.y);
      const m=vectorWorldMatrix(instance.id+(puppet?'/upper-body':''),scene,at,assets),det=m.a*m.d-m.b*m.c;
      if(Math.abs(det)<1e-9)throw new Error('Vector: invalid reach transform');
      point={x:(m.d*(p.x-m.e)-m.c*(p.y-m.f))/det,y:(-m.b*(p.x-m.e)+m.a*(p.y-m.f))/det};
    }
    if(!point||typeof point.x!=='number'||typeof point.y!=='number'||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new Error('Vector: reach needs a finite actor-local point');
    if(puppet){
      const hand=asset.nodes.find(n=>n.id===`hand-${r.arm}`)!;
      const dx=point.x-(hand.x??0),dy=point.y-(hand.y??0);
      if(Math.hypot(dx,dy)>145)throw new Error('Vector: puppet contact is out of reach; move the actor beside the object');
      const resting=vectorRaisedLampHand(drawing,assets,instance.id,String(r.arm));
      const restDx=resting?.dx??0,restDy=resting?.dy??0;
      // Lowering a light to inspect something is a temporary gesture. A
      // deliberate held pose (hold:true or withdraw:false) still wins.
      const withdraw=r.withdraw===true||(r.withdraw===undefined&&resting!==undefined&&dy>restDy&&!r.hold);
      const destination={dx,dy,opacity:1};
      return [{target:`${instance.id}/${hand.id}`,start,end,...(r.cue!==undefined?{cue:r.cue as string}:{}),frames:r.hold?
        [{t:0,...destination}]:[
          {t:0,dx:restDx,dy:restDy,opacity:resting?1:0,easing:'smooth'},
          {t:.12,dx:restDx-(dx-restDx)*.06,dy:restDy+4,opacity:1,easing:'smooth'},
          {t:withdraw ? .55 : .8,...destination,easing:'smooth'},
          ...(withdraw?[{t:.66,...destination,easing:'smooth' as const},{t:1,dx:restDx,dy:restDy,opacity:resting?1:0,easing:'smooth' as const}]:[{t:1,...destination,easing:'smooth' as const}]),
        ]}];
    }
    const arm=asset.nodes.find(n=>n.id===`arm-${r.arm}`),forearm=asset.nodes.find(n=>n.id===`forearm-${r.arm}`),hand=asset.nodes.find(n=>n.id===`hand-${r.arm}`);
    const parent=asset.nodes.find(n=>n.id===arm?.parent);
    // The standard rig uses a local zero-pivot shoulder and vertical links.
    if(!arm||!forearm||!hand||forearm.parent!==arm.id||hand.parent!==forearm.id
      ||[arm,forearm,parent].some(n=>n&&((n.rotation??0)!==0||(n.scaleX??1)!==1||(n.scaleY??1)!==1))
      ||(forearm.x??0)!==0||(hand.x??0)!==0||(arm.pivotX??0)!==0||(arm.pivotY??0)!==0
      ||(forearm.pivotX??0)!==0||(forearm.pivotY??0)!==0||parent?.parent)throw new Error('Vector: reach requires the standard articulated human rig');
    const dx=point.x-(parent?.x??0)-(arm.x??0),dy=point.y-(parent?.y??0)-(arm.y??0);
    const a=forearm.y??0,b=hand.y??0,d=Math.hypot(dx,dy);
    if(a<=0||b<=0||d<Math.abs(a-b)-1e-6||d>a+b+1e-6)throw new Error('Vector: reach point is outside arm length; move the actor/prop within reach');
    const {elbow,shoulder}=solveVectorArm(dx,dy,a,b,forearm.joint);
    return [[arm.id,shoulder],[forearm.id,elbow]].map(([part,rotation])=>({
      target:`${instance.id}/${part}`,start,end,...(r.cue!==undefined?{cue:r.cue as string}:{}),
      frames:r.hold?[{t:0,rotation:rotation as number}]:r.withdraw?[
        {t:0,rotation:0},{t:.55,rotation:rotation as number,easing:'smooth' as const},
        {t:.66,rotation:rotation as number,easing:'smooth' as const},{t:1,rotation:0,easing:'smooth' as const},
      ]:[{t:0,rotation:0},{t:1,rotation:rotation as number,easing:'smooth' as const}],
    }));
  });
}
