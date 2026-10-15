import type {VectorDrawing,VectorNode} from './canvasVectorScene';
import {FOLK_INK_STYLE} from './canvasVectorInk';

/** Approved village cast: flat art on the existing cutout/contact skeleton.
 * Expanded saved drawings never pass through this factory again. */
export function villagePuppetArt(rig:VectorDrawing,raw:Record<string,unknown>):VectorDrawing{
  const age=raw.age??'adult',gender=raw.gender??'neutral',inkV2=raw.artStyle===FOLK_INK_STYLE;
  if(!['child','adult','elder'].includes(String(age)))throw new Error('Vector: invalid village age');
  if(!['male','female','neutral'].includes(String(gender)))throw new Error('Vector: invalid village gender');
  if(raw.glasses!==undefined&&typeof raw.glasses!=='boolean')throw new Error('Vector: invalid village glasses');
  const expression=raw.expression??'neutral';
  if(!['neutral','soft','worried','surprised'].includes(String(expression)))throw new Error('Vector: invalid village expression');
  const child=age==='child',female=gender==='female'&&!child;
  const palette=(raw.palette||{}) as Record<string,string>;
  const ink=palette.ink||'#141313',skin=palette.skin||'#f1d2b1',shirt=palette.shirt||'#344e70';
  const hair=palette.hair||(age==='elder'?'#b5b2aa':'#22232a'),accent=palette.accent||'#98724b';
  const inner=palette.inner||'#f4e7d4',trim=palette.trim||'#d3af65',skirt=palette.skirt||'#302c32';
  if(!/^#[0-9a-f]{6}$/i.test(skirt))throw new Error('Vector: invalid puppet palette');
  const style=String(raw.hair??'short'),outfit=String(raw.outfit??'tunic');
  const tone=(color:string,toward:string,amount:number)=>'#'+[1,3,5].map(i=>Math.round(parseInt(color.slice(i,i+2),16)*(1-amount)+parseInt(toward.slice(i,i+2),16)*amount).toString(16).padStart(2,'0')).join('');
  const clothShade=tone(shirt,ink,.12),hairShade=tone(hair,'#a6a4aa',.12);
  // Replace decoration, not the motion tree or either hand's contact point.
  const oldCostume=new Set(['costume']);
  for(let size=-1;size!==oldCostume.size;){size=oldCostume.size;for(const n of rig.nodes)if(n.parent&&oldCostume.has(n.parent))oldCostume.add(n.id);}
  const nodes=rig.nodes.filter(n=>(n.id==='costume'||!oldCostume.has(n.id))&&!['handdrawn-hem','handdrawn-fabric','handdrawn-ear-left','handdrawn-ear-right','fabric-shade','hair-layer','hair-tip','hair-part','hair-pin','hair-flower-center','rear-seam'].includes(n.id)&&!n.id.startsWith('hair-flower-'));
  const get=(id:string)=>nodes.find(n=>n.id===id)!;
  const path=(id:string,parent:string,d:string,fill:string,stroke=ink,width=2.8):VectorNode=>({id,type:'path',parent,d,fill,stroke,strokeWidth:width});
  const dot=(id:string,parent:string,x:number,y:number,rx:number,ry:number,fill:string,stroke?:string):VectorNode=>({id,type:'ellipse',parent,x,y,rx,ry,fill,...(stroke?{stroke,strokeWidth:2.2}:{})});
  const body=get('torso');
  body.d=female
    ?'M 72 125 Q 76 124 80 124 Q 89 133 100 124 Q 110 130 116 142 Q 120 151 123 161 Q 124 168 120 174 Q 118 182 119 195 Q 119 208 121 222 L 126 261 Q 129 280 111 280 L 64 280 Q 46 280 49 262 L 56 222 Q 60 201 58 179 L 58 149 Q 59 133 72 125 Z'
    :'M 72 125 Q 76 124 80 124 Q 89 133 100 124 Q 112 129 117 142 Q 122 154 121 170 L 125 261 Q 127 280 111 280 L 64 280 Q 47 280 49 262 L 56 169 Q 56 140 72 125 Z';
  body.fill=shirt;body.stroke=ink;body.strokeWidth=4.2;
  // Match the approved head/body ratio without moving the ground or hands.
  // Scale only artwork; the animation/contact skeleton stays in 180x280.
  Object.assign(body,{x:-9,y:child?95.2:56,scaleX:1.1,scaleY:child?.66:.8});
  Object.assign(get('costume'),{x:body.x,y:body.y,scaleX:body.scaleX,scaleY:body.scaleY});
  Object.assign(get('head-group'),{y:child?118:96,scaleX:child?.88:1.13,scaleY:child?.88:1.13});
  if(inkV2&&!child){
    Object.assign(body,{y:44,scaleY:.84});Object.assign(get('costume'),{y:44,scaleY:.84});
    Object.assign(get('head-group'),{y:91,scaleX:1.06,scaleY:1.06,rotation:-2});
  }
  const neck=get('neck');Object.assign(neck,{type:'path',d:child?'M 81 168 L 81 184 Q 90 188 99 184 L 99 168 Z':'M 81 143 L 81 164 Q 90 168 99 164 L 99 143 Z',x:undefined,y:undefined,width:undefined,height:undefined,fill:skin,stroke:ink,strokeWidth:2.8});
  const face=get('face'),rx=raw.faceShape==='broad'?59:raw.faceShape==='oval'?51:56,ry=raw.faceShape==='oval'?61:56;
  // Native front/right is a three-quarter drawing, not a frontal face on a
  // profile costume. Left is its existing whole-cutout mirror. Centered dots
  // stay centered: cheek/jaw, eye spacing, visible ear and hair convey direction.
  Object.assign(face,{type:'path',d:`M 0 ${-ry} C ${rx*.72} ${-ry} ${rx} ${-ry*.48} ${rx} 0 Q ${rx*1.08} ${ry*.54} ${rx*.55} ${ry*.85} Q ${rx*.26} ${ry*1.05} 5 ${ry} C ${-rx*.56} ${ry} ${-rx} ${ry*.61} ${-rx} 0 C ${-rx} ${-ry*.57} ${-rx*.7} ${-ry} 0 ${-ry} Z`,rx:undefined,ry:undefined,fill:skin,stroke:ink,strokeWidth:3.8});
  for(const side of ['l','r']){
    const near=side==='l',x=near?-4:29,y=near?2:0;
    Object.assign(get('ear-'+side),{x:near?-49:55,y:5,rx:8,ry:10,fill:skin,stroke:ink,strokeWidth:2.6,opacity:near?1:0});
    const white=dot('eye-white-'+side,'eyes',x,y,(near?10:8)+(raw.eyeStyle==='wide'?1:0),raw.eyeStyle==='sharp'?8:near?11:10,'#fffaf0',ink);
    const at=nodes.findIndex(n=>n.id==='eye-'+side);
    const existing=nodes.findIndex(n=>n.id===white.id);
    if(existing<0)nodes.splice(at,0,white);else nodes[existing]=white;
    Object.assign(get('eye-'+side),{x,y,rx:1.7,ry:1.7,fill:ink});
    Object.assign(get('cheek-'+side),{x:near?-20:40,y:19,rx:near?8:5,ry:3.4,fill:'#e99582',opacity:gender==='female'?.34:child?.24:.12});
    get('brow-'+side).stroke=ink;get('brow-'+side).strokeWidth=gender==='male'&&!child?3.4:2.5;
    get('brow-'+side).d=raw.eyeStyle==='sharp'?(near?'M -15 -20 L 5 -14':'M 21 -14 L 37 -20')
      :raw.eyeStyle==='tired'?(near?'M -15 -14 Q -4 -12 5 -16':'M 21 -16 Q 29 -13 37 -15')
      :near?'M -15 -16 Q -5 -22 5 -18':'M 21 -19 Q 30 -22 37 -17';
    Object.assign(get('hand-'+side),{fill:skin,stroke:ink,strokeWidth:3.4});
  }
  Object.assign(get('mouth'),{type:'path',x:18,y:29,rx:undefined,ry:undefined,
    d:expression==='soft'?'M -6 -1 Q 0 6 6 -1':expression==='worried'?'M -5 2 Q 0 -4 5 2':expression==='surprised'?'M 0 -4 A 3.5 4 0 1 0 0 4 A 3.5 4 0 1 0 0 -4 Z':'M -4 0 Q 0 1 4 0',
    fill:expression==='surprised'?ink:'none',stroke:ink,strokeWidth:2});
  // Paint the near ear over the cheek/hair edge; the old pair of identical
  // ears and inherited ear etchings made the head read as straight-on.
  const ear=get('ear-l');nodes.splice(nodes.indexOf(ear),1);
  nodes.splice(nodes.findIndex(n=>n.id==='blink'),0,ear,
    path('village-ear-fold','head-group','M -51 1 Q -44 0 -47 9','none',ink,1.6));
  const wardrobe:VectorNode[]=[
    path('cloth-shadow','costume','M 70 137 Q 64 148 65 178 L 61 260 Q 59 270 68 276 L 79 277 Q 70 267 72 251 L 75 177 Q 74 153 79 135 Z',clothShade,'none'),
    path('collar','costume','M 80 125 Q 89 133 100 125 L 103 131 L 90 143 L 79 132 Z',inner),
    path('front-seam','costume','M 79 132 Q 94 147 120 158','none',ink,2.5),
  ];
  if(gender==='female'){
    wardrobe.push(path('skirt','costume','M 56 222 Q 89 227 121 222 L 126 261 Q 129 280 111 280 L 64 280 Q 46 280 49 262 Z',skirt,ink,3.4),
      path('skirt-panel','costume','M 66 226 L 63 268 Q 84 273 119 268','none',tone(skirt,'#b0a7a3',.2),1.5));
  }else{
    wardrobe.push(path('placket','costume','M 120 158 Q 116 164 116 177 L 121 263','none',ink,2.3),
      path('sash','costume','M 52 222 Q 87 227 122 222 L 124 241 Q 86 246 50 241 Z',accent),
      path('sash-end','costume','M 65 241 Q 70 239 74 242 L 72 269 L 63 269 Z',accent),
      path('sash-end-2','costume','M 73 241 L 79 242 L 82 267 L 74 267 Z',accent),
      path('sash-knot','costume','M 65 227 Q 74 221 77 231 L 74 243 Q 64 250 63 239 Z',accent));
    for(const [i,[x,y]] of [[115,161],[117,182]].entries())wardrobe.push(dot('fastener-'+i,'costume',x!,y!,2.8,3,trim,ink));
    if(outfit==='tunic')wardrobe.push(path('inner-hem','costume','M 52 266 Q 86 271 123 266 L 123 271 Q 123 278 110 278 L 64 278 Q 52 278 52 266 Z',inner,ink,2));
  }
  if(outfit==='vest')wardrobe.push(path('vest-l','costume','M 71 128 L 81 131 L 84 213 L 58 217 L 62 151 Z',accent),path('vest-r','costume','M 100 130 L 109 128 L 119 151 L 123 217 L 96 213 Z',accent));
  if(outfit==='shawl')wardrobe.push(path('shawl','costume','M 72 128 L 85 135 L 106 126 L 118 145 L 121 176 Q 92 169 61 146 Z',accent));
  if(outfit==='robe')wardrobe.push(path('wrap-edge','costume','M 80 135 Q 96 150 117 158 L 119 216','none',inner,2.5));
  if(outfit==='ao-dai')wardrobe.push(path('panel-edge','costume','M 68 226 L 65 269','none',ink,1));
  if(inkV2){
    // Cloth has a readable placket and soft folds, without decorating every
    // adult with the same bulky belt/knot. Preserve distinct costume colors.
    if(outfit==='tunic'||outfit==='robe'){
      for(let i=wardrobe.length-1;i>=0;i--)if(/^sash/.test(wardrobe[i]!.id))wardrobe.splice(i,1);
      wardrobe.push(path('cloth-hem','costume','M 54 269 Q 85 278 120 269','none',inner,1.5),
        path('cloth-folds','costume','M 65 191 Q 61 215 64 245 M 111 207 Q 115 240 113 260','none',clothShade,1.8));
    }
    const seam=wardrobe.find(n=>n.id==='front-seam');if(seam)seam.d='M 80 130 Q 97 139 113 151';
  }
  // Costume must paint before the head; appended nodes are ordered by parent.
  nodes.push(...wardrobe);
  const hairNode=nodes.find(n=>n.id==='hair');
  if(hairNode){
    const fringe=style==='bun'||style==='long'||style==='braid'||style==='bob'
      ?'M -56 11 Q -66 -20 -51 -45 Q -34 -67 -4 -65 Q 30 -69 49 -43 Q 63 -26 56 4 L 48 -16 Q 18 -23 3 -43 Q -8 -19 -31 -7 L -43 7 L -48 30 Q -58 23 -56 11 Z'
      :style==='cropped'?'M -55 -4 Q -61 -32 -40 -48 Q -10 -68 22 -55 Q 58 -46 57 -5 L 48 -17 L 34 -19 L 26 -27 L 10 -24 L -3 -28 L -20 -22 L -35 -24 L -48 -13 Z'
      :style==='wavy'?'M -56 11 Q -64 -8 -57 -27 Q -65 -29 -64 -32 Q -54 -34 -51 -43 Q -59 -45 -55 -48 Q -43 -47 -34 -57 Q -15 -71 8 -62 Q 15 -71 24 -62 Q 33 -56 38 -57 Q 60 -48 59 -25 Q 67 -19 61 -15 L 55 11 L 47 -14 Q 36 -15 29 -36 Q 16 -49 3 -35 Q -11 -14 -34 -17 L -48 -12 L -48 10 Z'
      :style==='side-part'?'M -56 10 Q -64 -14 -55 -38 L -61 -43 L -42 -49 Q -14 -71 14 -63 Q 22 -70 30 -60 Q 57 -53 59 -26 L 55 10 L 48 -12 Q 35 -15 25 -36 Q 19 -45 9 -39 Q -15 -13 -47 -14 L -48 10 Z'
      :style==='tied'?'M -56 11 Q -64 -20 -51 -44 Q -28 -69 2 -64 Q 37 -68 55 -38 Q 63 -20 55 10 L 48 -14 Q 34 -24 23 -42 Q -2 -16 -47 -16 L -48 11 Z'
      :'M -56 10 Q -63 -18 -53 -40 Q -28 -69 5 -63 Q 41 -67 56 -38 L 56 10 L 48 -13 L 37 -23 L 25 -20 L 14 -31 L 0 -23 L -12 -28 L -29 -18 L -48 -16 L -48 10 Z';
    hairNode.d=fringe;hairNode.fill=hair;hairNode.stroke=ink;hairNode.strokeWidth=3.8;
    // Put hair details before the face features and rear-view mask.
    const hairAt=nodes.indexOf(hairNode)+1;
    const swept=['bun','long','braid','bob'].includes(style);
    const details:VectorNode[]=[
      path('hair-layer','head-group',swept?'M -51 -24 Q -46 -49 -17 -58 Q 5 -66 24 -55 Q -7 -61 -24 -37 Q -38 -18 -49 -11 Z':'M -51 -29 Q -31 -59 -7 -59 Q 15 -63 31 -49 Q 12 -57 2 -43 Q -18 -24 -43 -22 Q -21 -35 -12 -48 Q -35 -33 -51 -29 Z',hairShade,'none'),
      path('hair-part','head-group',swept?'M -43 -17 Q -18 -27 2 -48 Q 18 -59 35 -40':'M -45 -18 Q -16 -21 4 -43 Q 20 -57 37 -39','none',hairShade,1.5),
    ];
    if(style==='double-bun')for(const x of [-47,47])details.push({...dot('hair-bun-'+(x<0?'l':'r'),'head-group',x,-46,15,15,hair,ink),strokeWidth:3},path('hair-ribbon-'+(x<0?'l':'r'),'head-group',`M ${x-9} -35 Q ${x} -42 ${x+9} -35`,'none',shirt,4));
    if(style==='braid')details.push(path('hair-braid','head-group','M -53 24 Q -65 32 -57 41 Q -66 49 -57 57 Q -65 65 -56 72 Q -62 80 -54 86 L -52 93 L -46 85 Q -39 78 -46 71 Q -38 63 -46 56 Q -37 48 -46 40 Q -39 32 -47 26 Z',hair,ink,3),
      path('braid-weave','head-group','M -57 41 L -46 40 M -57 57 L -46 56 M -56 72 L -46 71','none',hairShade,1.4),
      path('braid-tie','head-group','M -56 82 L -46 82 L -48 87 L -54 87 Z',trim,ink,1.6));
    nodes.splice(hairAt,0,...details);
    if(style==='tied'||style==='bob'){
      const shape=style==='tied'?path('hair-tip','head-group','M -48 -19 Q -84 -24 -76 9 Q -73 28 -62 35 Q -66 8 -49 9 Z',hair)
        :path('hair-back','head-group','M -52 -25 Q -65 0 -62 41 Q -63 57 -45 61 L -41 15 L 41 15 L 45 61 Q 64 57 62 41 Q 65 0 52 -25 Z',hair);
      nodes.splice(nodes.findIndex(n=>n.id==='face'),0,shape);
    }
    const back=nodes.find(n=>n.id==='hair-back');if(back&&style==='long'){back.fill=hair;back.d='M -53 -22 Q -64 6 -62 76 L -45 86 L -42 28 L 43 28 L 45 86 L 62 76 Q 65 7 53 -22 Z';}
    const bun=nodes.find(n=>n.id==='hair-bun');if(bun){
      Object.assign(bun,{x:-53,y:19,rx:19,ry:20,fill:hair,stroke:ink,strokeWidth:3.4});
      nodes.splice(nodes.indexOf(bun)+1,0,path('bun-fold','head-group','M -60 4 Q -72 22 -58 34','none',hairShade,1.5));
    }
    if(style==='bob'||style==='long')nodes.splice(nodes.findIndex(n=>n.id==='face'),0,
      path('back-hair-fold','head-group',style==='bob'?'M -56 23 Q -58 46 -49 53 M 55 23 Q 59 46 50 53':'M -56 30 Q -59 64 -50 78 M 56 30 Q 59 64 50 78','none',hairShade,1.5));
  }
  if(female)nodes.splice(nodes.indexOf(ear)+1,0,dot('village-earring','head-group',-48,17,3.2,3.2,trim,ink));
  const scarf=nodes.find(n=>n.id==='scarf-knot');if(scarf)scarf.d='M -52 -23 Q -76 -40 -73 -12 L -64 -7 L -73 26 L -56 20 L -52 -16 Z';
  const weave=nodes.find(n=>n.id==='hat-weave');if(weave){weave.stroke=tone(accent,ink,.28);weave.strokeWidth=1.4;}
  if(raw.headwear==='headwrap'){
    const at=nodes.findIndex(n=>n.id==='blink');
    nodes.splice(at,0,path('headwear','head-group','M -59 -17 Q -64 -52 -39 -62 Q -8 -78 26 -63 Q 61 -52 60 -20 L 48 -24 Q 21 -49 -8 -40 Q -31 -28 -49 -18 Z',hair),path('headwrap-fold','head-group','M -54 -34 Q -9 -67 53 -33 M -35 -59 L -30 -48 M -7 -68 L -6 -55 M 23 -63 L 18 -52','none','#414147',1.3));
  }
  if(age==='elder')nodes.push(path('age-lines','head-group','M 0 -32 Q 13 -35 26 -32 M 3 -27 Q 13 -29 23 -27 M -23 20 L -18 24 M 39 21 L 43 17','none',ink,1));
  if(raw.glasses)nodes.push({id:'glasses',type:'group',parent:'head-group'},
    ...[-4,29].map((x,i)=>({...dot('glasses-'+i,'glasses',x,i?0:2,i?11:14,14,'none',ink),strokeWidth:2})),
    path('glasses-bridge','glasses','M 10 1 Q 14 -3 18 0 M -18 1 L -43 -2 M 40 0 L 47 -3','none',ink,1.6));
  if(raw.facialHair==='beard'){
    const beard=get('beard');beard.fill=hair;beard.d='M -5 31 Q 8 38 17 33 Q 26 38 37 29 Q 36 46 30 57 L 23 66 L 18 76 L 12 66 Q 1 56 -1 44 Z';
    get('beard-strands').d='M 8 43 L 12 60 M 25 44 L 20 65';
  }
  const moustache=nodes.find(n=>n.id==='moustache');if(moustache)moustache.x=18;
  for(const part of ['moustache','beard-strands','rear-hair','rear-scalp']){
    const n=nodes.find(n=>n.id===part);if(n){if(part==='rear-scalp')n.fill=skin;else if(part!=='beard-strands')n.fill=hair;}
  }
  const rear=get('rear-costume');if(rear)Object.assign(rear,{x:body.x,y:body.y,scaleX:body.scaleX,scaleY:body.scaleY});
  for(const part of ['hair-back','hair-tip','headwear','rear-hair','rear-scalp','beard']){
    const node=nodes.find(n=>n.id===part);if(node){node.stroke=ink;node.strokeWidth=3.8;}
  }
  nodes.push(path('rear-seam','rear-costume','M 73 130 Q 90 139 107 130 M 90 149 L 90 269','none',ink,1));
  if(!nodes.some(n=>n.id==='handdrawn-finish'))nodes.push({id:'handdrawn-finish',type:'group',parent:'puppet-root'});
  if(expression==='worried'||expression==='surprised')nodes.push({id:'village-mouth-emotion',type:'group',parent:'puppet-root'});
  nodes.push({id:'village-cast-v1',type:'group',parent:'puppet-root'},
    {id:'village-mouth-cued',type:'group',parent:'puppet-root'},
    {id:'village-age-'+age,type:'group',parent:'puppet-root'},
    {id:'village-gender-'+gender,type:'group',parent:'puppet-root'});
  return {...rig,nodes};
}
