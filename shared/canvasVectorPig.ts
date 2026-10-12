import type {VectorDrawing,VectorNode,VectorTrack,VectorFrame} from './canvasVectorScene';

/** Reusable anatomy, not a story or a shot. Four short articulated legs keep
 * the animal recognisable while the director supplies its setting and acting. */
export function vectorPigRig(raw:Record<string,unknown>):VectorDrawing{
  const palette=(raw.palette||{}) as Record<string,unknown>;
  const color=(key:string,fallback:string)=>{
    const value=palette[key]??fallback;
    if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Vector: invalid pig palette');
    return value;
  };
  const skin=color('skin','#a18a79'),ink=color('ink','#332b2a'),hoof=color('hoof','#211e20');
  const toes=raw.toes??2;
  if(![2,5].includes(Number(toes)))throw new Error('Vector: pig toes must be 2 or 5');
  if(raw.facing!==undefined&&!['left','right'].includes(String(raw.facing)))throw new Error('Vector: invalid pig facing');
  const nodes:VectorNode[]=[{id:'profile',type:'group',pivotX:180,scaleX:raw.facing==='left'?-1:1}];
  const add=(id:string,type:VectorNode['type'],props:Partial<VectorNode>)=>nodes.push({id,type,parent:'profile',...props});
  for(const side of ['hr','fr','hl','fl']){
    const front=side[0]==='f',near=side[1]==='l';
    add('leg-'+side,'group',{x:front?(near?248:272):(near?86:110),y:130,opacity:near?1:.65});
    add('thigh-'+side,'path',{parent:'leg-'+side,d:'M -12 -4 Q 0 -9 12 -4 L 10 42 L -10 42 Z',fill:skin,stroke:ink,strokeWidth:2});
    add('knee-'+side,'group',{parent:'leg-'+side,y:42});
    add('shin-'+side,'path',{parent:'knee-'+side,d:'M -10 -2 L 10 -2 L 9 39 L -9 39 Z',fill:skin,stroke:ink,strokeWidth:2});
    add('hoof-'+side,'group',{parent:'knee-'+side,y:42,width:30,height:9});
    for(let i=0;i<Number(toes);i++){
      const width=30/Number(toes),x=-15+i*width;
      add(`toe-${side}-${i+1}`,'path',{parent:'hoof-'+side,d:`M ${x+.7} 0 L ${x+width-.7} 0 L ${x+width-1} -6 Q ${x+width/2} -11 ${x+1} -6 Z`,fill:hoof,stroke:skin,strokeWidth:.7});
    }
  }
  add('body','ellipse',{x:172,y:111,rx:112,ry:65,fill:skin,stroke:ink,strokeWidth:3});
  add('tail','path',{pivotX:62,pivotY:102,d:'M 64 105 C 35 78 25 103 43 105 C 58 106 48 85 34 90',fill:'none',stroke:skin,strokeWidth:6});
  add('neck','ellipse',{x:261,y:106,rx:30,ry:39,fill:skin});
  add('head-group','group',{x:278,y:86,pivotX:-20,pivotY:25});
  add('face','ellipse',{parent:'head-group',rx:48,ry:43,fill:skin,stroke:ink,strokeWidth:3});
  add('ear','path',{parent:'head-group',pivotX:-16,pivotY:-27,d:'M -31 -25 Q -46 -72 -12 -53 L 0 -28 Z',fill:skin,stroke:ink,strokeWidth:3});
  add('snout','ellipse',{parent:'head-group',x:46,y:15,rx:25,ry:20,fill:'#b29583',stroke:ink,strokeWidth:3});
  for(const x of [38,53])add('nostril-'+x,'ellipse',{parent:'head-group',x,y:15,rx:3,ry:5,fill:ink});
  add('eyes','group',{parent:'head-group',pivotY:-6});
  add('eye','ellipse',{parent:'eyes',x:12,y:-6,rx:5,ry:7,fill:ink});
  add('mouth','path',{parent:'head-group',d:'M 21 32 Q 38 37 53 31',fill:'none',stroke:ink,strokeWidth:2});
  return readableVectorPig({width:360,height:240,nodes});
}

/** Upgrade only the native pig scaffold, including expanded saved assets. */
export function readableVectorPig(drawing:VectorDrawing):VectorDrawing {
  if(drawing.width!==360||drawing.height!==240||!['profile','body','head-group','snout','eye','hoof-fl','hoof-hr'].every(id=>drawing.nodes.some(n=>n.id===id)))return drawing;
  const nodes=drawing.nodes.filter(n=>!['eye-white','eye-glint'].includes(n.id)).map(n=>({...n}));
  // Rear the trunk around the hips. Hind legs retain their own planted chains;
  // rotating/translating the complete instance lifts its feet off the floor.
  if(!nodes.some(n=>n.id==='body-pose'))nodes.splice(1,0,{id:'body-pose',type:'group',parent:'profile',pivotX:98,pivotY:130});
  for(const n of nodes)if(n.parent==='profile'&&['body','tail','neck','head-group','leg-fl','leg-fr'].includes(n.id))n.parent='body-pose';
  // The fixed hind chains must paint BEFORE the moving trunk. Inserting the
  // trunk group first previously made both hind thighs show through its fill.
  const pose=nodes.splice(nodes.findIndex(n=>n.id==='body-pose'),1)[0]!;
  const siblings=nodes.flatMap((n,i)=>n.parent==='profile'?[i]:[]);
  nodes.splice(Math.max(0,...siblings)+1,0,pose);
  const body=nodes.find(n=>n.id==='body')!,old=body.fill||'#a18a79';
  const rgb=/^#[0-9a-f]{6}$/i.test(old)?[1,3,5].map(i=>parseInt(old.slice(i,i+2),16)):[161,138,121];
  const luminance=rgb[0]!*.2126+rgb[1]!*.7152+rgb[2]!*.0722;
  const skin=luminance<95?'#786c60':old,ink='#080808';
  for(const n of nodes){
    if(n.fill===old)n.fill=skin;
    if(n.stroke&&n.stroke!=='none'&&!n.id.startsWith('toe-')){n.stroke=ink;n.strokeWidth=Math.max(n.strokeWidth||0,3);}
  }
  const eye=nodes.find(n=>n.id==='eye')!;
  eye.fill=ink;eye.rx=6;eye.ry=8;delete eye.stroke;delete eye.strokeWidth;
  // Open stroke endpoints leave the joints seamless; SVG still closes the fill.
  for(const side of ['fl','fr','hl','hr']){
    const leg=nodes.find(n=>n.id==='leg-'+side);
    if(leg)leg.opacity=1; // A far leg is shaded, never translucent anatomy.
    const thigh=nodes.find(n=>n.id==='thigh-'+side),shin=nodes.find(n=>n.id==='shin-'+side);
    if(thigh)thigh.d='M -10 46 L -12 -4 Q 0 -9 12 -4 L 10 46';
    if(shin)shin.d='M -10 -6 L -9 39 L 9 39 L 10 -6';
    if(side.endsWith('r'))for(const part of [thigh,shin])if(part){
      part.fill='#'+[1,3,5].map(i=>Math.round(parseInt(skin.slice(i,i+2),16)*.84).toString(16).padStart(2,'0')).join('');
    }
    const hoof=nodes.find(n=>n.id==='hoof-'+side);
    if(hoof){hoof.width=34;hoof.height=15;}
    const toes=nodes.filter(n=>n.parent==='hoof-'+side&&n.id.startsWith('toe-'));
    for(const [i,toe] of toes.entries()){
      const width=34/toes.length,x=-17+i*width;
      toe.d=`M ${x+1.1} 0 L ${x+width-1.1} 0 L ${x+width-.9} -9 Q ${x+width/2} -15 ${x+.9} -9 Z`;
      toe.fill='#b8aa91';toe.stroke=ink;toe.strokeWidth=1;
    }
  }
  const face=nodes.find(n=>n.id==='face');
  if(face){face.type='ellipse';face.rx=48;face.ry=43;delete face.d;}
  // Head and torso already overlap. The extra unoutlined neck ellipse was
  // painting over the torso contour, leaving a gap below the head.
  const neck=nodes.find(n=>n.id==='neck');
  if(neck){neck.fill='none';neck.stroke='none';}
  const mouth=nodes.find(n=>n.id==='mouth');
  // Keep its address for saved action tracks, without a permanent smile.
  if(mouth){mouth.d='M 0 0';mouth.fill='none';mouth.stroke='none';}
  const ear=nodes.find(n=>n.id==='ear');
  if(ear)ear.d='M -31 -25 Q -46 -72 -12 -53 L 0 -28 Z';
  return {...drawing,nodes};
}

/** Two-link IK with alternating diagonal stance pairs. Translation alone can
 * never pass for a walk; all four hooves plant, lift and return to rest. */
export function vectorPigWalkTracks(node:VectorNode,asset:VectorDrawing,dx:number,raw:Record<string,unknown>):VectorTrack[]{
  const start=Number(raw.start??0),end=Number(raw.end??.5),offset=Number(raw.offsetX??0);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>1||end<=start||!Number.isFinite(offset))throw new Error('Vector: invalid pig walk timing');
  if(node.rotation||node.attachTo||(node.scaleX??1)<=0||(node.scaleY??1)<=0)throw new Error('Vector: pig walk needs an upright instance');
  if(raw.hold!==undefined&&typeof raw.hold!=='boolean'||raw.hold&&raw.cue!==undefined)throw new Error('Vector: invalid held pig walk');
  const sx=(node.width??asset.width)/asset.width*(node.scaleX??1),sy=(node.height??asset.height)/asset.height*(node.scaleY??1);
  const facing=asset.nodes.find(n=>n.id==='profile')?.scaleX??1,distance=dx/sx/facing;
  const cycles=Math.ceil(Math.abs(distance)/38);
  if(!cycles||cycles>6)throw new Error('Vector: pig walk needs 1-6 short strides; split longer travel into cuts');
  const samples=cycles*Math.min(12,Math.floor(25/cycles)),keys=new Set([0,.04,.08,.92,.96,1]);
  for(let i=0;i<=samples;i++)keys.add(i/samples);
  const tracks=new Map<string,VectorFrame[]>(),add=(target:string,frame:VectorFrame)=>{
    const frames=tracks.get(target)||[];frames.push({...frame,easing:'smooth'});tracks.set(target,frames);
  };
  for(const t of [...keys].sort((a,b)=>a-b)){
    const blend=Math.max(0,Math.min(1,t/.08,(1-t)/.08)),lower=6*blend;
    add(node.id,{t,dx:offset+dx*t,dy:lower*sy});
    for(const side of raw.biped?['hl','hr']:['fl','fr','hl','hr']){
      const phase=cycles*t+((raw.biped?side==='hr':['fr','hl'].includes(side))?.5:0),cycle=Math.floor(phase),f=phase-cycle;
      const swing=f<.5?0:(f-.5)*2,smooth=swing*swing*(3-2*swing);
      const x=(cycle+smooth)*distance/cycles-distance*t,y=84-lower-Math.sin(Math.PI*swing)*10;
      // Foreleg elbows and hind stifles bend on opposite planes. Reversing
      // travel must not turn either joint inside out.
      const q=(side.startsWith('f')?-1:1)*Math.acos(Math.max(-1,Math.min(1,(x*x+y*y-2*42**2)/(2*42**2))));
      const upper=(Math.atan2(y,x)-Math.atan2(42*Math.sin(q),42+42*Math.cos(q))-Math.PI/2)*180/Math.PI*blend;
      const knee=q*180/Math.PI*blend;
      add(node.id+'/leg-'+side,{t,rotation:upper});add(node.id+'/knee-'+side,{t,rotation:knee});
      add(node.id+'/hoof-'+side,{t,rotation:-upper-knee});
    }
    if(!raw.biped)add(node.id+'/head-group',{t,rotation:Math.sin(2*Math.PI*cycles*t-.4)*2*blend});
    add(node.id+'/ear',{t,rotation:Math.sin(2*Math.PI*cycles*t-.8)*5*blend});
    add(node.id+'/tail',{t,rotation:Math.sin(2*Math.PI*cycles*t-1)*5*blend});
  }
  return [...tracks].map(([target,frames])=>raw.hold?{target,start:0,end:1,frames:[{...frames.at(-1)!,t:0}]}:
    {target,start,end,...(raw.cue?{cue:String(raw.cue)}:{}),frames});
}
