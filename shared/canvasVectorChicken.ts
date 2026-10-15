import type {VectorDrawing,VectorNode,VectorTrack,VectorFrame} from './canvasVectorScene';

/** Reusable barnyard anatomy, not a story or a shot. Two articulated legs keep
 * the bird recognisable while the director supplies its setting and acting.
 * Ground contact at local (120,190); instance height 150-220px on stage. */
export function vectorChickenRig(raw:Record<string,unknown>):VectorDrawing{
  const palette=(raw.palette||{}) as Record<string,unknown>;
  const color=(key:string,fallback:string)=>{
    const value=palette[key]??fallback;
    if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Vector: invalid chicken palette');
    return value;
  };
  const skin=color('skin','#d9c4a3'),ink=color('ink','#332b2a'),comb=color('comb','#b65042'),beak=color('beak','#d99a4e');
  if(raw.facing!==undefined&&!['left','right'].includes(String(raw.facing)))throw new Error('Vector: invalid chicken facing');
  const nodes:VectorNode[]=[{id:'profile',type:'group',pivotX:120,scaleX:raw.facing==='left'?-1:1}];
  const add=(id:string,type:VectorNode['type'],props:Partial<VectorNode>)=>nodes.push({id,type,parent:'profile',...props});
  for(const side of ['l','r'] as const){
    const near=side==='l';
    add('leg-'+side,'group',{x:near?102:138,y:128,opacity:near?1:.7});
    add('thigh-'+side,'path',{parent:'leg-'+side,d:'M -9 -3 Q 0 -7 9 -3 L 8 30 L -8 30 Z',fill:skin,stroke:ink,strokeWidth:2});
    add('knee-'+side,'group',{parent:'leg-'+side,y:30});
    add('shin-'+side,'path',{parent:'knee-'+side,d:'M -7 -2 L 7 -2 L 6 28 L -6 28 Z',fill:skin,stroke:ink,strokeWidth:2});
    add('foot-'+side,'group',{parent:'knee-'+side,y:30});
    for(let i=0;i<3;i++){
      const x=-12+i*12;
      add(`toe-${side}-${i+1}`,'path',{parent:'foot-'+side,d:`M ${x} 0 L ${x+10} 0 L ${x+8} -6 Q ${x+5} -9 ${x+2} -6 Z`,fill:beak,stroke:ink,strokeWidth:.8});
    }
  }
  add('body','ellipse',{x:120,y:95,rx:68,ry:46,fill:skin,stroke:ink,strokeWidth:3});
  add('wing','ellipse',{x:112,y:100,rx:34,ry:22,fill:skin,stroke:ink,strokeWidth:2});
  add('wing-ink','path',{d:'M 88 96 Q 112 108 136 98',fill:'none',stroke:ink,strokeWidth:1.4});
  add('tail','path',{pivotX:54,pivotY:80,d:'M 56 84 Q 30 60 22 40 Q 36 52 44 44 Q 40 66 58 78 Z',fill:skin,stroke:ink,strokeWidth:2.4});
  add('head-group','group',{x:182,y:48,pivotX:-18,pivotY:20});
  add('head','ellipse',{parent:'head-group',rx:24,ry:22,fill:skin,stroke:ink,strokeWidth:3});
  add('comb','path',{parent:'head-group',pivotX:0,pivotY:-22,d:'M -12 -20 Q -12 -34 -4 -28 Q -2 -38 4 -30 Q 8 -38 12 -28 Q 18 -30 14 -18 Z',fill:comb,stroke:ink,strokeWidth:2});
  add('beak','path',{parent:'head-group',d:'M 22 -4 L 40 2 L 22 8 Z',fill:beak,stroke:ink,strokeWidth:2});
  add('wattle','ellipse',{parent:'head-group',x:14,y:18,rx:7,ry:10,fill:comb,stroke:ink,strokeWidth:1.6});
  add('eyes','group',{parent:'head-group',pivotY:-4});
  add('eye','ellipse',{parent:'eyes',x:6,y:-4,rx:4.5,ry:6,fill:ink});
  return {width:240,height:200,nodes};
}

/** Alternating two-leg strut with head counter-bob. A small bird takes many
 * short strides: up to 10 per shot with two keys each (lift/plant), so a
 * visible barnyard scurry fits the 32-frame track budget without sliding. */
export function vectorChickenWalkTracks(node:VectorNode,asset:VectorDrawing,dx:number,raw:Record<string,unknown>):VectorTrack[]{
  const start=Number(raw.start??0),end=Number(raw.end??.5);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>1||end<=start)throw new Error('Vector: invalid chicken walk timing');
  if(node.rotation||node.attachTo||(node.scaleX??1)<=0||(node.scaleY??1)<=0)throw new Error('Vector: chicken walk needs an upright instance');
  if(raw.hold!==undefined&&typeof raw.hold!=='boolean'||raw.hold&&raw.cue!==undefined)throw new Error('Vector: invalid held chicken walk');
  const sx=(node.width??asset.width)/asset.width*(node.scaleX??1),sy=(node.height??asset.height)/asset.height*(node.scaleY??1);
  const facing=asset.nodes.find(n=>n.id==='profile')?.scaleX??1,distance=dx/sx/facing;
  const cycles=Math.min(10,Math.max(1,Math.ceil(Math.abs(distance)/30)));
  if(Math.abs(distance)>300)throw new Error('Vector: chicken walk needs a short distance; split longer travel into cuts');
  const keys=new Set([0,.06,.12,.88,.94,1]);
  for(let i=0;i<=cycles*2;i++)keys.add(i/(cycles*2));
  const tracks=new Map<string,VectorFrame[]>(),add=(target:string,frame:VectorFrame)=>{
    const frames=tracks.get(target)||[];frames.push({...frame,easing:'smooth'});tracks.set(target,frames);
  };
  for(const t of [...keys].sort((a,b)=>a-b)){
    const blend=Math.max(0,Math.min(1,t/.08,(1-t)/.08));
    add(node.id,{t,dx:(Number(raw.offsetX??0))+dx*t,dy:Math.abs(Math.sin(Math.PI*cycles*2*t))*3*sy*blend});
    for(const side of ['l','r'] as const){
      const phase=cycles*2*t+(side==='r'?.5:0),swing=Math.sin(Math.PI*2*phase);
      add(node.id+'/leg-'+side,{t,rotation:swing*18*blend});
      add(node.id+'/knee-'+side,{t,rotation:Math.max(0,-swing)*26*blend});
      add(node.id+'/foot-'+side,{t,rotation:-swing*10*blend});
    }
    add(node.id+'/head-group',{t,rotation:Math.sin(Math.PI*2*cycles*2*t+.6)*4*blend});
    add(node.id+'/tail',{t,rotation:Math.sin(Math.PI*2*cycles*2*t+1.2)*6*blend});
    add(node.id+'/wing',{t,rotation:Math.sin(Math.PI*2*cycles*2*t)*3*blend});
  }
  return [...tracks].map(([target,frames])=>({target,start,end,...(raw.cue?{cue:String(raw.cue)}:{}),frames}));
}
