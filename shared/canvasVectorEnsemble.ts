import type {CanvasStudioScene,CanvasVectorDirection} from './canvasAnimationStudio';
import {evaluateVectorPart,type VectorDrawing,type VectorFrame,type VectorNode,type VectorTrack} from './canvasVectorScene';

type Action=NonNullable<CanvasVectorDirection['backgroundActions']>[number];
type Pose=ReturnType<typeof evaluateVectorPart>;
type State={asset:string;x:number;y:number;parent?:string;activity:Action['activity'];partner?:string;clock:number;seed:number;distance:number;depth:number;walkMs:number;toward:number;root:Pose;body:Pose;head:Pose;eyes:Pose;hand:Pose;side:'l'|'r'};
const hash=(id:string)=>{
  let n=[...id].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7);
  // Consecutive IDs must not create consecutive millisecond offsets and an
  // accidentally synchronized crowd. Avalanche the stable identity first.
  n=Math.imul(n^(n>>>16),0x7feb352d);
  n=Math.imul(n^(n>>>15),0x846ca68b);
  return (n^(n>>>16))>>>0;
};
const ease=(t:number)=>t*t*(3-2*t);
const text=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d');
const moving=(t:VectorTrack)=>!t.ensemble&&t.target.split('/')[1]!=='blink'&&(['dx','dy','rotation','scaleX','scaleY','opacity'] as const).some(k=>new Set(t.frames.filter(f=>f[k]!==undefined).map(f=>f[k])).size>1);

/** Defaults belong to a populated native set, never an empty/tension tableau.
 * Explicit tasks also work on other compact-character sets. */
export function vectorBackgroundActions(scene:CanvasStudioScene,assets:Record<string,VectorDrawing>):Action[]{
  if(scene.vectorDirection?.backgroundActions!==undefined)return scene.vectorDirection.backgroundActions;
  const d=scene.vectorScene,dir=scene.vectorDirection;
  if(!d||!dir||!scene.vectorStageId||!d.nodes.some(n=>n.id==='market-square'))return [];
  const words=text(dir.purpose+' '+(scene.narration||''));
  if(/(?:tat ca|moi nguoi|dam dong).{0,25}(?:dung im|bat dong)|im phang phac|khong mot bong nguoi|frozen crowd|empty market/.test(words))return [];
  const actors=d.nodes.filter(n=>n.type==='instance'&&assets[n.asset!]?.nodes.some(p=>p.id==='puppet-root')&&evaluateVectorPart(n.id,scene,0,n.opacity??1).opacity>.5);
  if(actors.length<4)return [];
  const extras=actors.filter(n=>n.id!=='person'&&n.id!==dir.shot.focus.split('/')[0]);
  const sellers=extras.filter(n=>/vendor|seller|merchant/.test(n.id)),assigned=new Set<string>();
  return extras.map((n,i)=>{
    const seller=[...sellers].filter(p=>!assigned.has(p.id)&&p.parent===n.parent).sort((a,b)=>Math.hypot((a.x??0)-(n.x??0),(a.y??0)-(n.y??0))-Math.hypot((b.x??0)-(n.x??0),(b.y??0)-(n.y??0)))[0];
    if(/shopper/.test(n.id)&&seller){assigned.add(seller.id);return {actor:n.id,activity:'visit',partner:seller.id};}
    return {actor:n.id,activity:/vendor|seller|merchant/.test(n.id)?'attend':/passer/.test(n.id)||i%3===0?'pass':'converse'};
  });
}

/** A visit has an arrival, a shared conversation, then a departure. It is
 * finite on the stage clock; a cut never starts the errand over again. */
function visitPhase(state:State,ms:number){
  const delay=350+state.seed%1500,t=state.clock+ms-delay,walk=state.walkMs,pause=3200;
  const returning=t>walk+pause,local=returning?t-walk-pause:t;
  const progress=ease(Math.max(0,Math.min(1,local/walk)));
  return {progress:t<=0?0:returning?1-progress:progress,traveling:t>0&&local>0&&local<walk,
    returning,interacting:t>=walk&&t<=walk+pause,interactionMs:t-walk,local};
}

/** One stage clock for cutout ensembles. Each person walks, settles, observes
 * or gestures at a partner, with independent cadence. Authored story actions,
 * deliberate holds, rear poses and occupied hands always take priority. */
export class VectorEnsembleDirector {
  private stage?:string;
  private states=new Map<string,State>();
  private assignments=new Map<string,Action>();
  direct(scene:CanvasStudioScene,assets:Record<string,VectorDrawing>):CanvasStudioScene{
    if(!scene.vectorStageId||this.stage!==scene.vectorStageId||scene.vectorDirection?.continuity==='reset'){this.states.clear();this.assignments.clear();this.stage=scene.vectorStageId;}
    const d=scene.vectorScene!;
    let actions=vectorBackgroundActions(scene,assets);
    if(scene.vectorDirection?.backgroundActions===undefined){
      // Omitting a repeated instruction at a camera cut does not change a
      // seller into a passer or stop an explicitly assigned conversation.
      const candidates=new Map(actions.map(a=>[a.actor,this.assignments.get(a.actor)||a]));
      for(const [id,a] of this.assignments)if(d.nodes.some(n=>n.id===id))candidates.set(id,a);
      actions=[...candidates.values()];
    }
    for(const a of actions)if(a.activity!=='hold')this.assignments.set(a.actor,a);
    const active=new Set<string>(),generated:VectorTrack[]=[];
    for(const action of actions){
      const node=d.nodes.find(n=>n.id===action.actor&&n.type==='instance'),rig=assets[node?.asset||''];
      if(!node||!rig?.nodes.some(n=>n.id==='puppet-root')||action.activity==='hold'||evaluateVectorPart(node.id,scene,0,node.opacity??1).opacity<.5)continue;
      if(action.activity==='visit'&&!action.partner)continue;
      if(action.partner&&!d.nodes.some(n=>n.id===action.partner&&n.type==='instance'&&evaluateVectorPart(n.id,scene,0,n.opacity??1).opacity>.5))continue;
      if(action.activity==='visit'&&d.nodes.find(n=>n.id===action.partner)?.parent!==node.parent)continue;
      // A cue-linked turn/reach/travel must never be masked by background work.
      if(d.tracks.some(t=>(t.target===node.id||t.target.startsWith(node.id+'/'))&&moving(t))
        ||scene.vectorDirection?.beats.some(b=>[...b.targets,...b.motionTargets].some(t=>t===node.id||t.startsWith(node.id+'/')))
        ||evaluateVectorPart(node.id+'/rear-head',scene,0,rig.nodes.find(n=>n.id==='rear-head')?.opacity??0).opacity>.5)continue;
      active.add(node.id);
      let state=this.states.get(node.id);
      if(!state||state.asset!==node.asset||state.x!==(node.x??0)||state.y!==(node.y??0)||state.parent!==node.parent||state.activity!==action.activity||state.partner!==action.partner){
        const position=evaluateVectorPart(node.id,scene,0),seed=hash(node.id);
        const peers=d.nodes.filter(n=>n.type==='instance'&&n.id!==node.id&&n.parent===node.parent&&assets[n.asset!]?.nodes.some(p=>p.id==='puppet-root')&&evaluateVectorPart(n.id,scene,0,n.opacity??1).opacity>.5);
        const customer=actions.find(a=>a.activity==='visit'&&a.partner===node.id)?.actor;
        const partner=peers.find(n=>n.id===(action.partner||customer))||[...peers].sort((a,b)=>Math.hypot((a.x??0)-(node.x??0),(a.y??0)-(node.y??0))-Math.hypot((b.x??0)-(node.x??0),(b.y??0)-(node.y??0)))[0];
        const toward=partner?Math.sign((partner.x??0)-(node.x??0))||1:seed%2?1:-1;
        const width=node.width??rig.width,height=node.height??rig.height,foot=(node.y??0)+height;
        // Stay on the existing depth lane and stop short of another body.
        // Never send a passer through the protagonist or through a vendor.
        const limit=(sign:number)=>{
          let distance=width*(2.1+(seed%5)*.2);
          for(const peer of peers){
            const peerFoot=(peer.y??0)+(peer.height??assets[peer.asset!]!.height)+evaluateVectorPart(peer.id,scene,0).dy;
            const x=(peer.x??0)+evaluateVectorPart(peer.id,scene,0).dx-(node.x??0)-position.dx;
            if(Math.abs(peerFoot-foot-position.dy)<height*.5&&Math.sign(x)===sign)distance=Math.min(distance,Math.max(0,Math.abs(x)-width*1.1));
          }
          return distance;
        };
        const distance=limit(toward)>width*.6?toward*limit(toward):-toward*limit(-toward);
        const body=evaluateVectorPart(node.id+'/upper-body',scene,0),side=toward*Math.sign(body.scaleX)<0?'l':'r';
        let route=distance,depth=0;
        if(action.activity==='visit'&&partner&&partner.parent===node.parent){
          const target=evaluateVectorPart(partner.id,scene,0),pw=partner.width??assets[partner.asset!]!.width,ph=partner.height??assets[partner.asset!]!.height;
          route=(partner.x??0)+target.dx+pw/2-(node.x??0)-position.dx-width/2-toward*(width+pw)*.65;
          depth=(partner.y??0)+target.dy+ph-foot-position.dy;
          // A customer already near the seller may simply settle, rather
          // than crossing through them to satisfy a minimum travel distance.
          if(Math.sign(route)!==toward)route=0;
        }
        state={asset:node.asset!,x:node.x??0,y:node.y??0,parent:node.parent,activity:action.activity,partner:action.partner,clock:0,seed,distance:route,depth,walkMs:Math.max(2400,Math.min(6500,Math.hypot(route,depth)/55*1000)),toward,
          root:position,body:evaluateVectorPart(node.id+'/upper-body',scene,0),head:evaluateVectorPart(node.id+'/head-group',scene,0),eyes:evaluateVectorPart(node.id+'/eyes',scene,0),hand:evaluateVectorPart(node.id+'/hand-'+side,scene,0),side};
        this.states.set(node.id,state);
      }
    }
    for(const id of this.states.keys())if(!active.has(id))this.states.delete(id);
    // Resolve every participant before sampling paired activity; input cast
    // ordering must not make a seller respond to a stale customer clock.
    for(const id of active){
      const node=d.nodes.find(n=>n.id===id)!,state=this.states.get(id)!;
      generated.push(...this.tracks(scene,node,assets[node.asset!]!,state));
    }
    for(const id of active)this.states.get(id)!.clock+=scene.durationMs;
    if(!generated.length)return scene;
    const owned=new Set(generated.map(t=>t.target));
    return {...scene,vectorScene:{...d,tracks:[...d.tracks.filter(t=>!t.ensemble||!owned.has(t.target)),...generated]}};
  }
  private tracks(scene:CanvasStudioScene,node:VectorNode,rig:VectorDrawing,state:State):VectorTrack[]{
    const {seed,clock,distance}=state,delay=350+seed%1500,walk=4200+seed%1900,pause=2600+seed%1700,cycle=2*(walk+pause),sign=Math.sign(distance)||1;
    const attached=scene.vectorScene!.nodes.some(n=>n.attachTo===node.id+'/hand-'+state.side);
    const visitor=[...this.states.entries()].find(([,s])=>s.activity==='visit'&&s.partner===node.id)?.[1];
    const pose=(ms:number)=>{
      if(state.activity==='visit'){
        const v=visitPhase(state,ms),pulse=v.interacting?Math.sin(Math.PI*Math.min(1,v.interactionMs/1600))**2:0;
        const sway=v.traveling?Math.sin(v.local/1100*Math.PI*2)*Math.min(1,v.local/300,(state.walkMs-v.local)/300):0;
        const facing=state.clock+ms<=delay?state.body.scaleX:v.returning?-state.toward:state.toward,look=state.toward*(Math.sign(facing)||1);
        return {dx:state.root.dx+distance*v.progress,rootY:state.root.dy+state.depth*v.progress,dy:state.body.dy-3*sway*sway,rotation:state.body.rotation+2*sway,
          facing,head:state.head.rotation+look*4*pulse,eyes:state.eyes.dx+look*3*pulse,handX:state.hand.dx+look*16*pulse,handY:state.hand.dy-14*pulse,handOpacity:attached?1:pulse};
      }
      const absolute=clock+ms,phase=Math.max(0,absolute-delay)%cycle,returning=phase>=walk+pause,p=returning?phase-walk-pause:phase;
      const traveling=state.activity==='pass'&&absolute>delay&&p<walk&&Math.abs(distance)>10;
      // Only ease the departure/arrival, retaining constant forward progress
      // over most of the walk. The same analytic phase crosses camera cuts.
      const t=Math.min(1,p/walk),r=.12;
      const progress=(t<r?t*t/(2*r):t>1-r?1-r-(1-t)*(1-t)/(2*r):t-r/2)/(1-r);
      const dx=absolute<=delay?0:returning?distance*(1-progress):distance*progress;
      const sway=traveling?Math.sin(p/(1050+seed%350)*Math.PI*2)*Math.min(1,p/300,(walk-p)/300):0;
      const settled=state.activity==='pass'?Math.max(0,p-walk):Math.max(0,absolute-delay)%(3900+seed%2100);
      const response=visitor?visitPhase(visitor,ms):undefined;
      const pulse=response?(response.interacting?Math.sin(Math.PI*Math.max(0,Math.min(1,(response.interactionMs-1400)/1600)))**2:0):absolute<=delay||traveling?0:settled<500?ease(settled/500):settled<1200?1:settled<1800?1-ease((settled-1200)/600):0;
      const facing=state.activity==='pass'&&absolute>delay?(returning?-sign:sign):visitor&&absolute>delay?-visitor.toward:state.body.scaleX;
      const look=(visitor?-visitor.toward:state.toward)*(Math.sign(facing)||1);
      return {dx:state.root.dx+(state.activity==='pass'?dx:0),rootY:state.root.dy,dy:state.body.dy-4.5*sway*sway,rotation:state.body.rotation+2.8*sway,
        facing,head:state.head.rotation+look*(state.activity==='attend'?3:5)*pulse,eyes:state.eyes.dx+look*4*pulse,
        handX:state.hand.dx+look*18*pulse,handY:state.hand.dy-12*pulse,handOpacity:attached?1:pulse};
    };
    // Include exact phase boundaries, so an image flip is never interpolated
    // through a narrow/zero silhouette. Bounded keys keep long films small.
    const times=new Set([0,scene.durationMs]);
    for(const s of [state,visitor].filter((s):s is State=>Boolean(s)))if(s.activity==='visit')for(const offset of [0,s.walkMs,s.walkMs+1600,s.walkMs+3200,2*s.walkMs+3200]){
      const ms=350+s.seed%1500+offset-s.clock;if(ms>0&&ms<scene.durationMs)times.add(ms);
    }
    for(let c=Math.floor((clock-delay)/cycle);c<=Math.ceil((clock+scene.durationMs-delay)/cycle);c++)for(const offset of [0,walk,walk+pause,2*walk+pause]){
      const ms=delay+c*cycle+offset-clock;if(ms>0&&ms<scene.durationMs)times.add(ms);
    }
    const slots=Math.max(1,Math.min(24,32-times.size));
    for(let i=1;i<slots;i++)times.add(scene.durationMs*i/slots);
    const samples=[...times].sort((a,b)=>a-b).map(ms=>({ms,value:pose(ms)}));
    const track=(part:string,frames:VectorFrame[]):VectorTrack=>({target:node.id+(part?'/'+part:''),start:0,end:1,ensemble:true,frames});
    const frames=(fn:(p:ReturnType<typeof pose>)=>Partial<VectorFrame>,hold=false)=>samples.map(({ms,value}):VectorFrame=>({t:ms/scene.durationMs,...fn(value),easing:hold?'hold':'smooth'}));
    const out=[track('head-group',frames(p=>({rotation:p.head}))),track('eyes',frames(p=>({dx:p.eyes})))];
    if(state.activity==='visit'||state.activity==='pass'&&Math.abs(distance)>10)out.push(track('',frames(p=>({dx:p.dx,dy:p.rootY}))),track('upper-body',frames(p=>({dy:p.dy,rotation:p.rotation}))),track('upper-body',frames(p=>({scaleX:p.facing}),true)));
    else if(visitor)out.push(track('upper-body',frames(p=>({scaleX:p.facing}),true)));
    // A dot appears only for a purposeful gesture. A carried hand keeps its
    // exact grip; the whole prop still inherits root/body travel.
    if(state.activity!=='pass'&&!attached&&rig.nodes.some(n=>n.id==='hand-'+state.side))out.push(track('hand-'+state.side,frames(p=>({dx:p.handX,dy:p.handY,opacity:p.handOpacity}))));
    return out;
  }
}

/** Evaluate actor activity in stage space, excluding camera/fog/blinks. */
export function vectorEnsembleCoverage(scene:CanvasStudioScene,assets:Record<string,VectorDrawing>){
  const actors=(scene.vectorScene?.nodes||[]).filter(n=>n.type==='instance'&&assets[n.asset!]?.nodes.some(p=>p.id==='puppet-root')&&n.id!=='person');
  const windows:Array<{atMs:number;active:string[]}>=[];
  for(let ms=0;ms<scene.durationMs-200;ms+=400){
    const active=actors.filter(n=>{
      if(evaluateVectorPart(n.id,scene,ms,n.opacity??1).opacity<.5)return false;
      return ['', '/upper-body','/head-group','/eyes','/hand-l','/hand-r'].some(part=>{
        const a=evaluateVectorPart(n.id+part,scene,ms),b=evaluateVectorPart(n.id+part,scene,ms+200);
        return Math.abs(a.dx-b.dx)>.7||Math.abs(a.dy-b.dy)>.7||Math.abs(a.rotation-b.rotation)>.4||Math.abs(a.scaleX-b.scaleX)>.2;
      });
    }).map(n=>n.id);
    windows.push({atMs:ms,active});
  }
  return {actors:actors.map(n=>n.id),activeFraction:windows.length?windows.filter(w=>w.active.length).length/windows.length:0,multipleFraction:windows.length?windows.filter(w=>w.active.length>=2).length/windows.length:0,windows};
}
