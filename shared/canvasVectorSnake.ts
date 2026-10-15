import type {VectorDrawing,VectorNode,VectorTrack,VectorFrame} from './canvasVectorScene';

/** Reusable serpent anatomy, not a story or a shot. A thin segmented body
 * (like the yard worms in the reference: ~0.4 person-length, ~0.05 thick)
 * keeps the animal readable while the director supplies setting/acting.
 * Belly contact at local y=90; instance height 25-40px on stage. */
const SEGMENTS=5;
export function vectorSnakeRig(raw:Record<string,unknown>):VectorDrawing{
  const palette=(raw.palette||{}) as Record<string,unknown>;
  const color=(key:string,fallback:string)=>{
    const value=palette[key]??fallback;
    if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Vector: invalid snake palette');
    return value;
  };
  const skin=color('skin','#4a4438'),ink=color('ink','#26231d'),belly=color('belly','#8a7f63');
  if(raw.facing!==undefined&&!['left','right'].includes(String(raw.facing)))throw new Error('Vector: invalid snake facing');
  const nodes:VectorNode[]=[{id:'profile',type:'group',pivotX:180,scaleX:raw.facing==='left'?-1:1}];
  const add=(id:string,type:VectorNode['type'],props:Partial<VectorNode>)=>nodes.push({id,type,parent:'profile',...props});
  for(let i=0;i<SEGMENTS;i++){
    const x=52+i*56,rx=i===0||i===SEGMENTS-1?30:38;
    add('seg-'+i,'group',{x,y:74});
    add('coil-'+i,'ellipse',{parent:'seg-'+i,rx,ry:15,fill:skin,stroke:ink,strokeWidth:2.6});
    add('belly-'+i,'path',{parent:'seg-'+i,d:`M ${-rx+8} 8 Q 0 14 ${rx-8} 8`,fill:'none',stroke:belly,strokeWidth:2});
  }
  add('tail-tip','path',{pivotX:24,pivotY:74,d:'M 26 74 Q 8 66 2 52 Q 14 60 24 62 Z',fill:skin,stroke:ink,strokeWidth:2});
  add('head-group','group',{x:322,y:68,pivotX:-24,pivotY:8});
  add('head','ellipse',{parent:'head-group',rx:30,ry:16,fill:skin,stroke:ink,strokeWidth:2.8});
  add('snout','ellipse',{parent:'head-group',x:24,y:6,rx:10,ry:12,fill:belly,stroke:ink,strokeWidth:2});
  add('tongue','path',{parent:'head-group',d:'M 32 8 L 48 4 M 32 8 L 48 12',fill:'none',stroke:'#a63d32',strokeWidth:2});
  add('eyes','group',{parent:'head-group',pivotY:-8});
  for(const x of [-6,8])add('eye-'+x,'ellipse',{parent:'eyes',x,y:-8,rx:4,ry:5.5,fill:ink});
  return {width:360,height:120,nodes};
}

/** Lateral-undulation slither: segments oscillate phase-shifted while the root
 * advances. Short ground distances only; never slide without body waves. */
export function vectorSnakeWalkTracks(node:VectorNode,asset:VectorDrawing,dx:number,raw:Record<string,unknown>):VectorTrack[]{
  const start=Number(raw.start??0),end=Number(raw.end??.5);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>1||end<=start)throw new Error('Vector: invalid snake walk timing');
  if(node.rotation||node.attachTo||(node.scaleX??1)<=0||(node.scaleY??1)<=0)throw new Error('Vector: snake walk needs an upright instance');
  if(raw.hold!==undefined&&typeof raw.hold!=='boolean'||raw.hold&&raw.cue!==undefined)throw new Error('Vector: invalid held snake walk');
  const sx=(node.width??asset.width)/asset.width*(node.scaleX??1);
  const facing=asset.nodes.find(n=>n.id==='profile')?.scaleX??1,distance=dx/sx/facing;
  const waves=Math.min(4,Math.max(1,Math.ceil(Math.abs(distance)/70)));
  if(Math.abs(distance)>320)throw new Error('Vector: snake travel needs a short distance; split longer travel into cuts');
  const keys=new Set([0,.06,.12,.88,.94,1]);
  for(let i=0;i<=waves*6;i++)keys.add(i/(waves*6));
  const tracks=new Map<string,VectorFrame[]>(),add=(target:string,frame:VectorFrame)=>{
    const frames=tracks.get(target)||[];frames.push({...frame,easing:'smooth'});tracks.set(target,frames);
  };
  for(const t of [...keys].sort((a,b)=>a-b)){
    const blend=Math.max(0,Math.min(1,t/.08,(1-t)/.08));
    add(node.id,{t,dx:(Number(raw.offsetX??0))+dx*t});
    for(let i=0;i<SEGMENTS;i++){
      const wave=Math.sin(Math.PI*2*waves*t+i*.95);
      add(node.id+'/seg-'+i,{t,dy:wave*6*blend,rotation:wave*5*blend});
    }
    add(node.id+'/head-group',{t,dy:Math.sin(Math.PI*2*waves*t+SEGMENTS*.95)*7*blend,rotation:Math.sin(Math.PI*2*waves*t+2)*6*blend});
    add(node.id+'/tongue',{t,opacity:blend>.4?1:0});
    add(node.id+'/tail-tip',{t,rotation:Math.sin(Math.PI*2*waves*t+.5)*8*blend});
  }
  return [...tracks].map(([target,frames])=>({target,start,end,...(raw.cue?{cue:String(raw.cue)}:{}),frames}));
}
