import {vectorTrackTiming,type VectorDrawing,type VectorNode,type VectorTrack,type VectorFrame} from './canvasVectorScene';
import {vectorFootprintNodes} from './canvasVectorProps';
import {vectorReachTracks} from './canvasVectorReach';
import {vectorPigWalkTracks} from './canvasVectorPig';
import {vectorPuppetTravelTracks,vectorPuppetFearTracks} from './canvasVectorPuppet';
import {vectorWorldMatrix,vectorPoint} from './canvasVectorTransform';
import type {CanvasStudioScene} from './canvasAnimationStudio';

type Library=Record<string,VectorDrawing>;
const numeric=(v:unknown,fallback:number,min=-10000,max=10000)=>{
  if(v===undefined)return fallback;
  if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error('Vector: invalid physical motion value');
  return v;
};
const entries=(raw:unknown,label:string):Record<string,unknown>[]=>{
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>16||raw.some(v=>!v||typeof v!=='object'||Array.isArray(v)))throw new Error(`Vector: invalid ${label}`);
  return raw;
};
function point(raw:unknown){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Vector: physical anchor needs x/y');
  const p=raw as Record<string,unknown>;
  if(p.x===undefined||p.y===undefined)throw new Error('Vector: physical anchor needs x/y');
  return {x:numeric(p.x,0),y:numeric(p.y,0)};
}

/** The oar stays on the existing hand chain; feet stay planted during strokes. */
export function vectorRowTracks(d:VectorDrawing,assets:Library,raw:unknown):VectorTrack[]{
  return entries(raw,'rows').flatMap(r=>{
    const {node,asset}=actor(d,assets,r.actor),arm=r.arm??'r';
    if(!['l','r'].includes(String(arm))||typeof r.prop!=='string'||!r.prop.startsWith(node.id+'/'))throw new Error('Vector: rowing needs an attached oar and arm');
    let part=asset.nodes.find(n=>n.id===String(r.prop).slice(node.id.length+1));
    const seen=new Set<string>();
    while(part&&part.id!==`forearm-${arm}`&&!seen.has(part.id)){seen.add(part.id);part=asset.nodes.find(n=>n.id===part!.parent);}
    if(part?.id!==`forearm-${arm}`)throw new Error('Vector: rowing oar must follow the selected hand chain');
    const start=numeric(r.start,0,0,1),end=numeric(r.end,.9,0,1),cycles=numeric(r.cycles,2,1,6);
    if(end<=start||!Number.isInteger(cycles))throw new Error('Vector: invalid rowing timing');
    // One continuous stroke, not four separately eased poses. The torso drives
    // the pull; elbow, head and loose hem trail it while both feet stay fixed.
    const steps=cycles*Math.min(8,Math.floor(28/cycles)),sign=arm==='r'?1:-1;
    const parts=['arm-'+arm,'forearm-'+arm,'upper-body','head-group','tunic-hem'];
    return parts.filter(part=>asset.nodes.some(n=>n.id===part)).map(part=>{
      const frames:VectorFrame[]=[];
      for(let i=0;i<=steps;i++){
        const t=i/steps,phase=2*Math.PI*cycles*t;
        const envelope=Math.min(1,t/.12,(1-t)/.12);
        const lag=(delay:number)=>Math.sin(phase-delay)*envelope;
        const rotation=sign*(part.startsWith('arm-')?26*lag(0):part.startsWith('forearm-')?20-19*lag(.55):
          part==='upper-body'?4.5*lag(.1):part==='head-group'?-2.5*lag(.6):3.5*lag(.95));
        frames.push({t,rotation,easing:'smooth',...(part==='upper-body'?{dy:0,dx:0,scaleX:1,scaleY:1}:{})});
      }
      return {target:`${node.id}/${part}`,start,end,...(r.cue!==undefined?{cue:r.cue as string}:{}),frames};
    });
  });
}

/** Solve hand contact, withdraw, and settle the struck object in the same world. */
export function vectorStrikeTracks(d:VectorDrawing,assets:Library,raw:unknown,context?:CanvasStudioScene):VectorTrack[]{
  return entries(raw,'strikes').flatMap(r=>{
    const {node,asset:rig}=actor(d,assets,r.actor),target=d.nodes.find(n=>n.id===r.target),arm=r.arm??'l';
    if(!target||!['l','r'].includes(String(arm))||target.attachTo)throw new Error('Vector: strike needs a fixed target and actor arm');
    const asset=target.type==='instance'?assets[target.asset!]:undefined;
    const contact=r.point===undefined?{x:asset?asset.width/2:(target.width??0)/2,y:asset?asset.height*.55:(target.height??0)*.55}:point(r.point);
    const start=numeric(r.start,0,0,1),end=numeric(r.end,.7,0,1);
    if(end<=start)throw new Error('Vector: invalid strike timing');
    const scene=context??{durationMs:1000,vectorScene:{...d,tracks:[]}} as unknown as CanvasStudioScene;
    const contactTiming=vectorTrackTiming({target:'',start,end,cue:r.cue as string|undefined,frames:[]},scene),at=contactTiming.start+(contactTiming.end-contactTiming.start)*.38;
    const p=vectorPoint(vectorWorldMatrix(target.id,scene,at,assets),contact.x,contact.y),m=vectorWorldMatrix(node.id,scene,at,assets),det=m.a*m.d-m.b*m.c;
    if(Math.abs(det)<1e-9)throw new Error('Vector: invalid strike transform');
    const local={x:(m.d*(p.x-m.e)-m.c*(p.y-m.f))/det,y:(-m.b*(p.x-m.e)+m.a*(p.y-m.f))/det};
    const solved=vectorReachTracks(d,assets,[{actor:node.id,arm,point:local,start,end}]);
    const joints=solved.map(track=>{
      if(rig.nodes.some(n=>n.id==='puppet-root')){
        const {dx=0,dy=0}=track.frames.at(-1)!;
        return {...track,...(r.cue!==undefined?{cue:r.cue as string}:{}),frames:[
          {t:0,dx:0,dy:0,opacity:0,easing:'smooth' as const},
          {t:.18,dx:-dx*.12,dy:4,opacity:1,easing:'smooth' as const},
          {t:.38,dx,dy,opacity:1,easing:'smooth' as const},
          {t:.44,dx:dx*.96,dy:dy*.96,opacity:1,easing:'smooth' as const},
          {t:.7,dx:dx*.2,dy:dy*.2,opacity:1,easing:'smooth' as const},
          {t:1,dx:0,dy:0,opacity:0,easing:'smooth' as const}]} as VectorTrack;
      }
      const angle=track.frames.at(-1)!.rotation!;
      return {...track,...(r.cue!==undefined?{cue:r.cue as string}:{}),frames:[
        {t:0,rotation:0},{t:.18,rotation:angle*(track.target.includes('/forearm-')?.12:-.12),easing:'smooth' as const},
        {t:.38,rotation:angle,easing:'ease-in' as const},{t:.44,rotation:angle*.96,easing:'ease-out' as const},
        {t:.62,rotation:angle*.35,easing:'smooth' as const},{t:1,rotation:0,easing:'smooth' as const}]};
    });
    const timing={start,end,...(r.cue!==undefined?{cue:r.cue as string}:{})},sign=arm==='l'?-1:1;
    const follow=(part:string,values:Array<[number,number]>):VectorTrack=>({target:`${node.id}/${part}`,...timing,
      frames:values.map(([t,rotation])=>({t,rotation,easing:'smooth',...(part==='upper-body'?{dx:0,dy:0,scaleX:1,scaleY:1}:{})}))});
    return [...joints,
      // Return to the exact solved torso transform at contact. Motion before
      // and after contact must never turn an IK hit into a near miss.
      follow('upper-body',[[0,0],[.18,-sign*3],[.38,0],[.49,sign*2],[.7,-sign*.7],[1,0]]),
      ...[rig.nodes.some(n=>n.id==='head-group')?follow('head-group',[[0,0],[.23,-sign*2],[.42,sign*2],[.7,-sign*.6],[1,0]]):undefined,
        rig.nodes.some(n=>n.id==='tunic-hem')?follow('tunic-hem',[[0,0],[.23,-sign*2],[.53,sign*4],[.76,-sign*1.5],[1,0]]):undefined].filter((t):t is VectorTrack=>Boolean(t)),
      {target:target.id,start,end,...(r.cue!==undefined?{cue:r.cue as string}:{}),frames:[
      {t:0,rotation:0},{t:.38,rotation:0},{t:.48,rotation:-18,easing:'ease-out' as const},
      {t:.65,rotation:10,easing:'smooth' as const},{t:.82,rotation:-4,easing:'smooth' as const},{t:1,rotation:0,easing:'smooth' as const}]}];
  });
}
function actor(d:VectorDrawing,assets:Library,name:unknown){
  const node=d.nodes.find(n=>n.id===name&&n.type==='instance'),asset=node?assets[node.asset!]:undefined;
  if(!node||!asset||!asset.nodes.some(n=>n.id==='puppet-root')&&!['leg-l','knee-l','foot-l','leg-r','knee-r','foot-r','upper-body'].every(id=>asset.nodes.some(n=>n.id===id)))throw new Error('Vector: physical action needs the articulated human rig');
  if(node.attachTo||node.rotation||(node.scaleX??1)<=0||(node.scaleY??1)<=0)throw new Error('Vector: walking actor must be upright');
  return {node,asset};
}
function anchorPosition(d:VectorDrawing,assets:Library,name:unknown,implicitParent?:{id?:string}){
  const n=d.nodes.find(n=>n.id===name);
  const asset=n?.type==='instance'?assets[n.asset!]:undefined;
  // Reuse native feet and existing geometry when an SVG world has no explicit
  // ground metadata. A walk must still share its destination's world parent.
  const a=n?.groundAnchor??(implicitParent&&n&&!n.attachTo?(asset?{x:asset.width/2,y:asset.nodes.some(p=>p.id==='foot-r')?457:asset.height}:
    n.type==='rect'?{x:(n.width??0)/2,y:n.height??0}:undefined):undefined);
  if(!n||!a||n.parent!==(implicitParent?implicitParent.id:d.ground?.parent))throw new Error(`Vector: ${String(name)} needs a grounded anchor on the same surface`);
  const x=a.x*(asset?(n.width??asset.width)/asset.width:1),y=a.y*(asset?(n.height??asset.height)/asset.height:1);
  const px=n.pivotX??0,py=n.pivotY??0,r=(n.rotation??0)*Math.PI/180;
  const dx=(x-px)*(n.scaleX??1),dy=(y-py)*(n.scaleY??1);
  return {x:(n.x??0)+px+dx*Math.cos(r)-dy*Math.sin(r),y:(n.y??0)+py+dx*Math.sin(r)+dy*Math.cos(r)};
}

/** Ground declarations compile to real geometry/anchors, retained across cuts.
 * Targets share one horizontal surface; no story-name/ID heuristics. */
export function groundVectorDrawing(d:VectorDrawing,assets:Library,raw:unknown):VectorDrawing{
  if(raw===undefined)return d;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Vector: invalid ground surface');
  const g=raw as Record<string,unknown>;
  // A transformed world's local baseline may exceed the output-frame height.
  const y=numeric(g.y,d.height*.78,g.parent===undefined?0:-10000,g.parent===undefined?d.height-30:10000);
  if(g.parent!==undefined&&(typeof g.parent!=='string'||!d.nodes.some(n=>n.id===g.parent&&n.type==='group')))throw new Error('Vector: ground parent must be a stage group');
  const parent=g.parent as string|undefined,nodes=d.nodes.map(n=>({...n}));
  const drawing={...d,nodes,ground:{y,...(parent?{parent}:{})}};
  const seen=new Set<string>();
  for(const item of entries(g.targets,'grounded targets')){
    const n=nodes.find(n=>n.id===item.target);
    if(!n||n.parent!==parent||n.attachTo||seen.has(n.id))throw new Error('Vector: grounded targets must be distinct children of the surface parent');
    seen.add(n.id);
    if(item.anchor!==undefined)n.groundAnchor=point(item.anchor);
    else if(n.groundAnchor===undefined){
      const asset=n.type==='instance'?assets[n.asset!]:undefined;
      n.groundAnchor=asset?{x:asset.width/2,y:asset.nodes.some(p=>p.id==='foot-r')?457:asset.nodes.some(p=>p.id==='hoof-fl')?214:asset.height}:
        n.type==='rect'?{x:(n.width??0)/2,y:n.height??0}:undefined;
    }
    if(!n.groundAnchor)throw new Error(`Vector: group ${n.id} needs an explicit local ground anchor`);
    const delta=y+(n.groundOffsetY??0)-anchorPosition(drawing,assets,n.id).y;
    if(Math.abs(delta)>1e-8)n.y=(n.y??0)+delta;
  }
  // Canonical anchors keep their support relation when a later repair/cut
  // changes geometry. The model cannot lift a grounded object by changing y.
  for(const n of nodes)if(n.groundAnchor&&n.parent===parent&&!seen.has(n.id)){
    const delta=y+(n.groundOffsetY??0)-anchorPosition(drawing,assets,n.id).y;
    if(Math.abs(delta)>1e-8)n.y=(n.y??0)+delta;
  }
  const fallbackFloor=!nodes.some(n=>n.id==='physical-ground-plane');
  if(fallbackFloor){
    // A fallback support must be BEHIND architecture, vegetation and soil
    // details. Inserting it just before the first grounded ACTOR (often the
    // last node) painted over the whole designed foreground during export.
    // Keep any full-frame background underneath; everything else in front.
    const backdrop=nodes.findIndex(n=>n.type==='rect'&&(n.x??0)===0&&(n.y??0)===0
      &&(n.width??0)>=d.width&&(n.height??0)>=d.height);
    const insertAt=backdrop>=0?backdrop+1:0;
    const floor:VectorNode[]=[{id:'physical-ground-plane',type:'rect',parent,x:0,y,width:d.width,height:d.height*1.5-y,fill:'#293930'},
      {id:'physical-ground-edge',type:'line',parent,x:0,y,x2:d.width,y2:0,stroke:'#34433c',strokeWidth:2}];
    nodes.splice(insertAt,0,...floor);
  }
  // Continue the foreground when the camera frames a low action. Contact
  // baseline and sparse soil contours make this a visible support surface.
  const floor=nodes.find(n=>n.id==='physical-ground-plane')!;floor.y=y;floor.height=Math.max(d.height*1.5-y,d.height);
  if(floor.fill==='#192522')floor.fill='#293930';
  const edge=nodes.find(n=>n.id==='physical-ground-edge');if(edge)edge.y=y;
  // Decorate only a newly synthesized fallback. Authored floors (including
  // interiors) and saved removals must not acquire automatic dirt on resume.
  if(fallbackFloor&&!nodes.some(n=>n.id==='physical-soil-0')){
    const details:VectorNode[]=Array.from({length:4},(_,i)=>({id:'physical-soil-'+i,type:'path',parent,
      d:`M ${i%2?d.width*.35:0} ${y+90+i*150} Q ${d.width*.55} ${y+55+i*150} ${i%2?d.width:d.width*.7} ${y+90+i*150}`,
      fill:'none',stroke:'#2c4035',strokeWidth:3,opacity:.55}));
    nodes.splice(nodes.findIndex(n=>n.id==='physical-ground-plane')+1,0,...details);
  }
  return drawing;
}

export function vectorFootsteps(d:VectorDrawing,assets:Library,raw:unknown){
  const nodes:VectorNode[]=[],tracks:VectorTrack[]=[];
  for(const s of entries(raw,'footstep trails')){
    if(!d.ground)throw new Error('Vector: footprints require a ground surface');
    if(typeof s.id!=='string'||!s.id||!/^[a-zA-Z0-9_-]+$/.test(s.id))throw new Error('Vector: footprint trail needs an identity');
    const from=anchorPosition(d,assets,s.from),to=anchorPosition(d,assets,s.to);
    const count=numeric(s.count,5,2,10);
    if(!Number.isInteger(count)||Math.abs(to.x-from.x)<50)throw new Error('Vector: footprint trail needs distinct ground endpoints');
    const size=numeric(s.size,32,24,48),stepMs=numeric(s.stepMs,450,200,1200),start=numeric(s.start,0,0,1),end=numeric(s.end,start+.02,0,1);
    if(s.color!==undefined&&(typeof s.color!=='string'||!/^#[0-9a-f]{6}$/i.test(s.color)))throw new Error('Vector: invalid footprint color');
    if(end<=start||end>1||s.hold!==undefined&&typeof s.hold!=='boolean')throw new Error('Vector: invalid footprint timing');
    if(s.hold&&s.cue!==undefined)throw new Error('Vector: held footprints cannot have a new speech cue');
    const layer=s.id+'-floor';
    nodes.push({id:layer,type:'group',parent:d.ground.parent,clip:{x:0,y:d.ground.y-24,width:d.width,height:d.height-d.ground.y+24}});
    for(let i=0;i<count;i++){
      const id=s.id+'-'+(i+1),fraction=i/(count-1);
      nodes.push({id,type:'group',parent:layer,x:from.x+(to.x-from.x)*fraction,y:d.ground.y+6+(i%2?7:-7),
        rotation:to.x<from.x?-90:90,scaleX:size/36,scaleY:size/36,opacity:s.hold?1:0,groundMark:true},
        ...vectorFootprintNodes(id,s.color as string|undefined).map(n=>({...n,parent:id})));
      if(!s.hold)tracks.push({target:id,start,end,cue:s.cue as string|undefined,cueOffsetMs:i*stepMs,frames:[{t:0,opacity:0},{t:1,opacity:1,easing:'ease-out'}]});
    }
  }
  if(!nodes.length)return {drawing:d,tracks};
  const existing=new Set(d.nodes.map(n=>n.id));
  if(nodes.some(n=>existing.has(n.id)))throw new Error('Vector: footprint IDs already exist; patch their tracks or reuse held trails in a new shot');
  const ordered=[...d.nodes],first=ordered.findIndex(n=>n.groundAnchor&&n.parent===d.ground?.parent);
  ordered.splice(first<0?ordered.length:first,0,...nodes);
  return {drawing:{...d,nodes:ordered},tracks};
}

/** IK keeps stance feet at fixed world positions while the pelvis travels.
 * A small preparatory knee bend provides reach; no body translation pretending
 * to be walking. One cycle advances each foot once and ends in a planted pose. */
export function vectorWalkTracks(d:VectorDrawing,assets:Library,raw:unknown):VectorTrack[]{
  return entries(raw,'walks').flatMap((w):VectorTrack[]=>{
    const pig=d.nodes.find(n=>n.id===w.actor&&n.type==='instance'),pigAsset=assets[pig?.asset||''];
    if(pig&&pigAsset?.nodes.some(n=>n.id==='hoof-fl')){
      const here=anchorPosition(d,assets,pig.id),there=anchorPosition(d,assets,w.to),offset=numeric(w.offsetX,0),gap=numeric(w.gap,70,30,d.width/2);
      const toward=Math.sign(there.x-here.x-offset)||1;
      const dx=w.backstep===undefined?there.x-here.x-offset-toward*gap:-toward*numeric(w.backstep,40,20,100);
      return vectorPigWalkTracks(pig,pigAsset,dx,w);
    }
    if(pig&&pigAsset?.nodes.some(n=>n.id==='puppet-root')){
      actor(d,assets,w.actor);
      const implicit=!d.ground?{id:pig.parent}:undefined;
      const here=anchorPosition(d,assets,pig.id,implicit),there=anchorPosition(d,assets,w.to,implicit);
      const offset=numeric(w.offsetX,0),gap=numeric(w.gap,70,20,d.width/2),toward=Math.sign(there.x-here.x-offset)||1;
      const dx=w.backstep===undefined?there.x-here.x-offset-toward*gap:-toward*numeric(w.backstep,40,20,100);
      const start=numeric(w.start,0,0,1),end=numeric(w.end,.4,0,1);
      if(w.followDepth!==undefined&&typeof w.followDepth!=='boolean')throw new Error('Vector: followDepth must be boolean');
      const dy=w.followDepth&&w.backstep===undefined?there.y-here.y:0;
      if(end<=start||Math.abs(dx)<5||w.backstep===undefined&&Math.sign(dx)!==toward||w.hold!==undefined&&typeof w.hold!=='boolean'||w.hold&&w.cue!==undefined)throw new Error('Vector: invalid puppet travel');
      const timing={start,end,...(w.cue!==undefined?{cue:w.cue as string}:{})};
      const handdrawn=pigAsset.nodes.some(n=>n.id==='handdrawn-finish');
      const rootFrames:VectorFrame[]=w.hold?[{t:0,dx:offset+dx,...(w.followDepth?{dy}:{})}]:
        handdrawn?[
          {t:0,dx:offset,...(w.followDepth?{dy:0}:{})},
          {t:.08,dx:offset+dx*.025,...(w.followDepth?{dy:dy*.025}:{}),easing:'ease-in'},
          {t:.92,dx:offset+dx*.975,...(w.followDepth?{dy:dy*.975}:{}),easing:'linear'},
          {t:1,dx:offset+dx,...(w.followDepth?{dy}:{}),easing:'ease-out'},
        ]:[{t:0,dx:offset,...(w.followDepth?{dy:0}:{})},{t:1,dx:offset+dx,...(w.followDepth?{dy}:{}),easing:'smooth'}];
      const travel=w.hold?[]:vectorPuppetTravelTracks(pig.id,pigAsset,Math.sign(dx)*Math.hypot(dx,dy)/((pig.width??pigAsset.width)/pigAsset.width),timing);
      // A forward-moving cutout faces its route, rather than moonwalking.
      // Backsteps intentionally keep the established facing and held prop.
      if(w.backstep===undefined)travel.forEach(t=>{if(t.target===pig.id+'/upper-body')t.frames=t.frames.map(f=>({...f,scaleX:Math.sign(dx)}));});
      return [{target:pig.id,...timing,frames:rootFrames},...travel];
    }
    const {node,asset}=actor(d,assets,w.actor);
    // Existing decks already have their support artwork. A short retreat away
    // from another planted actor on that same parent does not need a land floor.
    const deckAnchor=(name:unknown)=>{
      const other=actor(d,assets,name);
      if(other.node.parent!==node.parent||!node.parent)throw new Error('Vector: deck retreat actors must share their existing surface parent');
      return {x:(other.node.x??0)+other.asset.width/2*(other.node.width??other.asset.width)/other.asset.width,
        y:(other.node.y??0)+457*(other.node.height??other.asset.height)/other.asset.height};
    };
    const target=d.nodes.find(n=>n.id===w.to&&n.type==='instance');
    const onDeck=!d.ground&&w.backstep!==undefined&&assets[target?.asset||'']?.nodes.some(n=>n.id==='foot-r');
    const implicit=!d.ground?{id:node.parent}:undefined;
    const here=onDeck?deckAnchor(node.id):anchorPosition(d,assets,node.id,implicit),there=onDeck?deckAnchor(w.to):anchorPosition(d,assets,w.to,implicit);
    if(onDeck&&Math.abs(here.y-there.y)>24)throw new Error('Vector: deck retreat actors must stand on the same support level');
    const offsetX=numeric(w.offsetX,0),gap=numeric(w.gap,80,20,d.width/2);
    const toward=Math.sign(there.x-here.x-offsetX)||1;
    const backstep=w.backstep===undefined?undefined:numeric(w.backstep,50,20,100);
    const dx=backstep===undefined?there.x-here.x-offsetX-toward*gap:-toward*backstep;
    const direction=Math.sign(dx);
    if((backstep===undefined&&direction!==toward)||Math.abs(dx)<5)throw new Error(`Vector: walk ${node.id} to ${String(w.to)} is too close (distance ${Math.abs(there.x-here.x-offsetX)}, gap ${gap}); omit this walk or move the resting actor farther from its destination`);
    const start=numeric(w.start,0,0,1),end=numeric(w.end,.35,0,1);
    if(end<=start||w.hold!==undefined&&typeof w.hold!=='boolean')throw new Error('Vector: invalid walk timing');
    const timing={start,end,cue:w.cue as string|undefined};
    if(w.hold&&w.cue!==undefined)throw new Error('Vector: held walk cannot have a new speech cue');
    if(w.carry!==undefined&&!['l','r'].includes(String(w.carry)))throw new Error('Vector: invalid carrying arm');
    const sx=(node.width??asset.width)/asset.width*(node.scaleX??1),sy=(node.height??asset.height)/asset.height*(node.scaleY??1),distance=dx/sx;
    const illustrated=asset.nodes.some(n=>n.id==='folk-art-v2');
    const cycles=Math.ceil(Math.abs(distance)/52);
    if(cycles>6)throw new Error('Vector: walk is too long for one shot; split it into cuts');
    for(const side of ['l','r']){
      const leg=asset.nodes.find(n=>n.id==='leg-'+side)!,knee=asset.nodes.find(n=>n.id==='knee-'+side)!,foot=asset.nodes.find(n=>n.id==='foot-'+side)!;
      if(knee.parent!==leg.id||foot.parent!==knee.id||knee.y!==55||foot.y!==55||foot.x!==6||leg.y!==340)throw new Error('Vector: walking needs the standard leg chain');
    }
    const keys=new Set([0,.04,.08,.92,.96,1]);
    const samples=cycles*Math.min(12,Math.floor(25/cycles));
    for(let i=0;i<=samples;i++)keys.add(i/samples);
    const frames=new Map<string,VectorFrame[]>();
    const add=(target:string,frame:VectorFrame)=>{const list=frames.get(target)||[];list.push({...frame,easing:'smooth'});frames.set(target,list);};
    for(const t of [...keys].sort((a,b)=>a-b)){
      const blend=Math.min(1,t/.08,(1-t)/.08),lower=(illustrated?6:8)*Math.max(0,blend);
      add(node.id,{t,dx:offsetX+dx*t,dy:lower*sy});
      for(const side of ['l','r'] as const){
        const leg=asset.nodes.find(n=>n.id==='leg-'+side)!,phase=cycles*t+(side==='r'?.5:0),cycle=Math.floor(phase),f=phase-cycle;
        const swing=f<.5?0:(f-.5)*2,smooth=swing*swing*(3-2*swing);
        const plant=(leg.x??0)+6+(cycle+smooth)*distance/cycles;
        const x=plant-distance*t-(leg.x??0),y=110-lower-Math.sin(Math.PI*swing)*(illustrated?9:14);
        // Backing away changes the step direction, never the knee's bending plane.
        const a=55,b=Math.hypot(6,55),q=Math.acos(Math.max(-1,Math.min(1,(x*x+y*y-a*a-b*b)/(2*a*b))));
        const upper=Math.atan2(y,x)-Math.atan2(b*Math.sin(q),a+b*Math.cos(q))-Math.PI/2;
        const knee=q+Math.atan2(6,55),deg=180/Math.PI;
        const r1=upper*deg*blend,r2=knee*deg*blend;
        add(`${node.id}/leg-${side}`,{t,rotation:r1});add(`${node.id}/knee-${side}`,{t,rotation:r2});
        add(`${node.id}/foot-${side}`,{t,rotation:-r1-r2});
        if(w.carry!==side&&backstep===undefined){
          const swing=Math.sin(2*Math.PI*cycles*t+(side==='r'?Math.PI:0));
          add(`${node.id}/arm-${side}`,{t,rotation:swing*9*blend});
          add(`${node.id}/forearm-${side}`,{t,rotation:(side==='l'?-1:1)*(12+Math.abs(swing)*6)*blend});
        }
      }
    }
    if(illustrated&&backstep===undefined){
      // One quiet counter-swing through the connected spine, neck and cloth.
      // Blend to a perfectly stable rest; avoid mechanical repeated rocking.
      for(const t of [...keys].sort((a,b)=>a-b)){
        const envelope=Math.max(0,Math.min(1,t/.1,(1-t)/.15));
        const stride=Math.sin(2*Math.PI*cycles*t)*envelope;
        add(`${node.id}/upper-body`,{t,rotation:stride*2.2});
        add(`${node.id}/head-group`,{t,rotation:-stride*1.1});
        add(`${node.id}/tunic-hem`,{t,rotation:-stride*1.5});
      }
    }
    if(backstep!==undefined){
      // A retreat is defensive acting, not an ordinary walk played backwards.
      // Raise one free hand toward the chest, leaving the occupied grip alone.
      const protective=w.carry==='r'?'l':w.carry==='l'?'r':toward>0?'r':'l';
      const reach=vectorReachTracks(d,assets,[{actor:node.id,arm:protective,
        point:{x:protective==='r'?130:110,y:218},start,end}]);
      for(const track of reach){
        const angle=track.frames.at(-1)!.rotation!;
        for(const [t,fraction] of [[0,0],[.16,.25],[.4,1],[.72,.95],[1,.9]])add(track.target,{t:t!,rotation:angle*fraction!});
      }
      const other=protective==='r'?'l':'r';
      if(w.carry!==other){
        for(const [t,fraction] of [[0,0],[.3,1],[.65,.7],[1,.35]]){
          add(`${node.id}/arm-${other}`,{t:t!,rotation:(other==='l'?16:-16)*fraction!});
          add(`${node.id}/forearm-${other}`,{t:t!,rotation:(other==='l'?-8:8)*fraction!});
        }
      }
      for(const [part,amount] of [['upper-body',direction*7],['head-group',-direction*4],['tunic-hem',-direction*4]] as const){
        if(!asset.nodes.some(n=>n.id===part))continue;
        for(const [t,fraction] of [[0,0],[.16,.6],[.42,1],[.76,.8],[1,.55]])add(`${node.id}/${part}`,{t:t!,rotation:amount*fraction!});
      }
    }
    return [...frames].map(([target,frames])=>w.hold?
      {target,start:0,end:1,frames:[{...frames.at(-1)!,t:0}]}:{target,...timing,frames});
  });
}

export function vectorReactionTracks(d:VectorDrawing,assets:Library,raw:unknown):VectorTrack[]{
  return entries(raw,'reactions').flatMap(r=>{
    if(r.kind==='fear')return vectorPuppetFearTracks(d,assets,[r]);
    const {node,asset}=actor(d,assets,r.actor);
    const target=d.nodes.find(n=>n.id===r.toward);
    if(!target)throw new Error('Vector: reaction needs an existing target');
    // Looking at a mounted lamp or knocker does not require it to stand on
    // the actor's floor. Compare their actual world positions across parents.
    const scene={durationMs:10000,vectorScene:d,vectorAssetLibrary:assets} as CanvasStudioScene;
    const targetAsset=target.type==='instance'?assets[target.asset!]:undefined;
    const here=vectorPoint(vectorWorldMatrix(node.id,scene,0,assets),asset.width/2,asset.height/2);
    const there=vectorPoint(vectorWorldMatrix(target.id,scene,0,assets),targetAsset?targetAsset.width/2:(target.width??0)/2,targetAsset?targetAsset.height/2:(target.height??0)/2);
    const puppet=asset.nodes.some(n=>n.id==='puppet-root');
    const inkedPuppet=puppet&&asset.nodes.some(n=>n.id==='handdrawn-finish');
    const mouth=asset.nodes.find(n=>n.id==='mouth');
    const mouthPose=(part:string,rest=false):Partial<VectorFrame>=>part==='mouth'&&mouth?.type==='path'&&puppet
      ?rest?{d:mouth.d,fill:mouth.fill}:{d:'M 0 -1.4 A 3.4 1.4 0 1 0 0 1.4 A 3.4 1.4 0 1 0 0 -1.4 Z',fill:mouth.stroke||'#141313'}:{};
    const illustrated=asset.nodes.some(n=>n.id==='folk-art-v2');
    if(!['look','startle'].includes(String(r.kind)))throw new Error('Vector: unknown physical reaction');
    const direction=Math.sign(there.x-here.x)||1,start=numeric(r.start,0,0,1),end=numeric(r.end,.25,0,1);
    if(end<=start)throw new Error('Vector: invalid reaction timing');
    const cue=r.cue as string|undefined,scared=r.kind==='startle',sign=scared?-direction:direction;
    const poses:[string,string,number][]=[['upper-body','rotation',sign*(scared?(inkedPuppet?5.2:puppet?6:10):2)],['head-group','rotation',sign*(scared?(inkedPuppet?6:puppet?4:8):4)],['eyes','dx',direction*(inkedPuppet?5:4)]];
    if(scared){poses.push(['mouth','scaleY',inkedPuppet?3.6:illustrated?2.9:1.8]);
      if(illustrated||inkedPuppet)poses.push(['brow-l','dy',inkedPuppet?-4.5:-6],['brow-r','dy',inkedPuppet?-4.5:-6]);}
    if(r.carry!==undefined&&!['l','r'].includes(String(r.carry)))throw new Error('Vector: invalid reaction carrying arm');
    const protective=scared&&(r.carry!==undefined||illustrated)&&!puppet?vectorReachTracks(d,assets,[{actor:node.id,arm:r.carry==='r'?'l':'r',
      point:{x:r.carry==='r'?110:130,y:235},start,end,cue}]):[];
    return [...poses.map(([part,channel,value])=>({target:`${node.id}/${part}`,start,end,cue,frames:puppet?[
      {t:0,[channel]:channel==='scaleY'?1:0,
        ...mouthPose(part,true),
        ...(inkedPuppet&&scared&&part==='eyes'?{scaleY:1}:{}),
        ...(inkedPuppet&&scared&&part==='mouth'?{scaleX:1}:{}),easing:'smooth'},
      {t:part==='eyes'?.08:part==='head-group'?.16:.22,[channel]:value,
        ...mouthPose(part),
        ...(inkedPuppet&&scared&&part==='eyes'?{scaleY:1.28}:{}),
        ...(inkedPuppet&&scared&&part==='mouth'?{scaleX:2.2}:{}),easing:'smooth'},
      // Read the reaction, settle once, then KEEP the pose. A slow continuous
      // return throughout the narration made even listening look like swaying.
      {t:.55,[channel]:channel==='scaleY'?(inkedPuppet&&scared?2.1:1.35):scared?value*.35:value*.7,
        ...mouthPose(part),
        ...(inkedPuppet&&scared&&part==='eyes'?{scaleY:1.11}:{}),
        ...(inkedPuppet&&scared&&part==='mouth'?{scaleX:1.6}:{}),easing:'smooth'},
      {t:1,[channel]:channel==='scaleY'?(inkedPuppet&&scared?2.1:1.35):scared?value*.35:value*.7,
        ...mouthPose(part),
        ...(inkedPuppet&&scared&&part==='eyes'?{scaleY:1.11}:{}),
        ...(inkedPuppet&&scared&&part==='mouth'?{scaleX:1.6}:{})},
    ] as VectorFrame[]:[
      {t:0,[channel]:channel==='scaleY'?1:0},
      ...(illustrated&&scared?[{t:.12,[channel]:channel==='scaleY'?1:part==='upper-body'?value*-.28:0,easing:'ease-out' as const}]:[]),
      {t:part==='eyes'?.15:part==='head-group'?.3:.45,[channel]:value,easing:'smooth'},
      ...(illustrated&&scared?[{t:.7,[channel]:channel==='scaleY'?1.8:value*.5,easing:'smooth' as const}]:[]),
      {t:1,[channel]:channel==='scaleY'?(illustrated&&scared?1.45:1):scared?value*.35:value*.7,easing:'smooth'},
    ] as VectorFrame[]})),...protective];
  });
}

export function vectorLightTracks(d:VectorDrawing,assets:Library,raw:unknown):VectorTrack[]{
  return entries(raw,'light controls').flatMap(l=>{
    if(typeof l.on!=='boolean')throw new Error('Vector: light control needs on/off');
    const n=d.nodes.find(n=>n.id===l.target),asset=n?.type==='instance'?assets[n.asset!]:undefined;
    const targets=asset?asset.nodes.filter(n=>n.light).map(p=>`${n!.id}/${p.id}`):n?.light?[n.id]:[];
    if(!targets.length)throw new Error('Vector: light control target has no emitter');
    const start=numeric(l.start,0,0,1),end=numeric(l.end,start+.02,0,1);
    if(end<=start||l.hold!==undefined&&typeof l.hold!=='boolean')throw new Error('Vector: invalid light control timing');
    if(l.hold&&l.cue!==undefined)throw new Error('Vector: held light state cannot have a new speech cue');
    return targets.map(target=>({target,start:l.hold?0:start,end:l.hold?1:end,cue:l.cue as string|undefined,
      frames:l.hold?[{t:0,opacity:l.on?1:0}]:[{t:0,opacity:l.on?0:1},{t:1,opacity:l.on?1:0}]}));
  });
}

/** Flat vertical hinges turn in depth: foreshorten width, never rotate slats
 * diagonally in the image. Also clears a prior erroneous rotation channel. */
export function vectorHingeTracks(d:VectorDrawing,raw:unknown):VectorTrack[]{
  return entries(raw,'hinges').map((h):VectorTrack=>{
    const n=d.nodes.find(n=>n.id===h.target&&['group','rect'].includes(n.type));
    if(!n||typeof h.open!=='boolean')throw new Error('Vector: vertical hinge needs a group or rectangle and open state');
    const start=numeric(h.start,0,0,1),end=numeric(h.end,.25,0,1);
    if(end<=start||h.hold!==undefined&&typeof h.hold!=='boolean'||h.hold&&h.cue!==undefined)throw new Error('Vector: invalid hinge timing');
    const from=h.open?1:.15,to=h.open?.15:1,rotation=-(n.rotation??0);
    return {target:n.id,start:h.hold?0:start,end:h.hold?1:end,cue:h.cue as string|undefined,
      frames:h.hold?[{t:0,rotation,scaleX:to}]:[{t:0,rotation,scaleX:from},{t:1,rotation,scaleX:to,easing:'ease-in-out'}]};
  });
}
