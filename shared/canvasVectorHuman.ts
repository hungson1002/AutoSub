import type {VectorDrawing,VectorNode} from './canvasVectorScene';
import {illustrateArticulatedChibi} from './canvasVectorChibiArt';

/** Small anatomy scaffold, not a scene/template: AI still authors the story,
 * environment, composition, poses, timings and any additional SVG parts. */
export function vectorHumanRig(raw:Record<string,unknown>):VectorDrawing{
  const palette=(raw.palette||{}) as Record<string,unknown>;
  const color=(key:string,fallback:string)=>{
    const value=palette[key]??fallback;
    if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Vector: invalid human palette');
    return value;
  };
  const skin=color('skin','#cfc8ac'),shirt=color('shirt','#554a3b'),pants=color('pants','#49372c'),ink=color('ink','#252d2c'),hem=color('hem',shirt);
  const nodes:VectorNode[]=[];
  const add=(id:string,type:VectorNode['type'],props:Partial<VectorNode>)=>nodes.push({id,type,...props});
  add('leg-l','group',{x:88,y:340,pivotX:0,pivotY:0});add('leg-r','group',{x:152,y:340,pivotX:0,pivotY:0});
  for(const side of ['l','r']){
    add(`thigh-${side}`,'path',{parent:`leg-${side}`,d:'M -9 -4 Q 0 -8 9 -4 L 10 55 Q 0 62 -10 55 Z',fill:pants});
    add(`knee-${side}`,'group',{parent:`leg-${side}`,y:55,joint:{min:0,max:145}});
    add(`shin-${side}`,'path',{parent:`knee-${side}`,d:'M -9 -2 L 9 -2 L 8 54 Q 0 60 -8 54 Z',fill:pants});
    add(`foot-${side}`,'ellipse',{parent:`knee-${side}`,x:6,y:55,rx:18,ry:7,fill:'#15191e'});
  }
  add('upper-body','group',{pivotX:120,pivotY:340,pivotSpace:'local'});
  add('neck','rect',{parent:'upper-body',x:108,y:153,width:24,height:34,fill:skin});
  add('torso','path',{parent:'upper-body',d:'M 80 180 C 105 175 135 175 160 180 C 175 220 182 280 178 350 C 140 355 100 355 62 350 C 58 280 65 220 80 180 Z',fill:shirt,stroke:ink,strokeWidth:3});
  add('tunic-hem','path',{parent:'upper-body',pivotX:120,pivotY:345,d:'M 62 345 Q 120 358 178 345 L 175 365 Q 120 378 65 365 Z',fill:hem});
  add('belt','rect',{parent:'upper-body',x:70,y:275,width:100,height:14,fill:'#2f1f14'});
  for(const side of ['l','r']){
    add(`arm-${side}`,'group',{parent:'upper-body',x:side==='l'?80:160,y:190,pivotX:0,pivotY:0,pivotSpace:'local'});
    add(`sleeve-${side}`,'path',{parent:`arm-${side}`,d:'M -11 0 Q -11 -12 0 -12 Q 11 -12 11 0 L 11 50 L -11 50 Z',fill:shirt,stroke:ink,strokeWidth:2});
    // In a frontal drawing the projected bend depends on the shoulder pose.
    // IK chooses the elbow below the shoulder, rather than forcing a screen-side sign.
    add(`forearm-${side}`,'group',{parent:`arm-${side}`,y:50,pivotX:0,pivotY:0,pivotSpace:'local',joint:{min:-145,max:145}});
    add(`cuff-${side}`,'path',{parent:`forearm-${side}`,d:'M -11 0 L 11 0 L 10 46 Q 0 54 -10 46 Z',fill:shirt,stroke:ink,strokeWidth:2});
    add(`hand-${side}`,'ellipse',{parent:`forearm-${side}`,y:57,rx:10,ry:10,fill:skin});
  }
  add('head-group','group',{parent:'upper-body',x:120,y:115,pivotX:0,pivotY:40,pivotSpace:'local'});
  add('face','ellipse',{parent:'head-group',rx:46,ry:50,fill:skin,stroke:ink,strokeWidth:4});
  add('eyes','group',{parent:'head-group',pivotX:0,pivotY:-4,pivotSpace:'local'});
  for(const side of ['l','r']){
    add(`eye-${side}`,'ellipse',{parent:'eyes',x:side==='l'?-16:16,y:-4,rx:6,ry:8,fill:'#181410'});
    const x=side==='l'?-26:9;
    add(`brow-${side}`,'path',{parent:'head-group',d:`M ${x} -22 Q ${x+8} -27 ${x+17} -22`,stroke:ink,strokeWidth:2.5});
  }
  add('mouth','ellipse',{parent:'head-group',y:25,rx:6,ry:4,fill:'#171b1b'});
  // Opt-in illustrated folk chibi: expressive face, distinct hair and costume,
  // but the SAME native shoulders, elbows, knees, feet and attachment anchors.
  // Older projects and their approved simple-human assets are left untouched.
  if(raw.style==='folk-chibi'||raw.style==='folk-chibi-v2'){
    const valid=(value:unknown,choices:string[],fallback:string)=>typeof value==='string'&&choices.includes(value)?value:fallback;
    const hairStyle=valid(raw.hair,['short','side-part','bun','long','tied','none'],'side-part');
    const outfit=valid(raw.outfit,['robe','tunic','ao-dai','vest','shawl'],'robe');
    const accent=color('accent','#ad8866'),trim=color('trim','#e3c29a'),hair=color('hair','#302b2a');
    const head=nodes.find(n=>n.id==='head-group')!;head.scaleX=1.2;head.scaleY=1.35;
    const face=nodes.find(n=>n.id==='face')!;face.rx=55;face.ry=59;face.strokeWidth=3.5;
    for(const n of nodes.filter(n=>/^eye-[lr]$/.test(n.id))){n.rx=5.8;n.ry=7.3;}
    const mouth=nodes.find(n=>n.id==='mouth')!;mouth.y=29;mouth.rx=3.7;mouth.ry=2.7;
    const faceDetails:VectorNode[]=[
      {id:'cheek-l',type:'ellipse',parent:'head-group',x:-38,y:19,rx:10,ry:4.5,fill:'#c98780',opacity:.32},
      {id:'cheek-r',type:'ellipse',parent:'head-group',x:38,y:19,rx:10,ry:4.5,fill:'#c98780',opacity:.32},
      {id:'hair-back',type:'path',parent:'head-group',d:hairStyle==='long'?'M -58 -21 Q -76 -10 -67 81 L -38 92 L -36 25 L 39 25 L 41 88 L 66 82 Q 75 21 57 -25 Z':'M -55 -25 Q -53 -65 0 -68 Q 52 -68 56 -21 Z',fill:hair,stroke:ink,strokeWidth:2.5},
      {id:'hair-front',type:'path',parent:'head-group',d:hairStyle==='side-part'?'M -58 -15 Q -68 -51 -31 -64 Q -7 -75 21 -64 Q 48 -58 59 -27 L 57 -2 Q 36 -13 26 -42 Q 11 -18 -15 -18 Q -41 -13 -54 10 Z':hairStyle==='bun'?'M -56 4 Q -68 -45 -27 -62 Q 9 -81 44 -53 Q 63 -28 56 4 L 48 -19 Q 21 -9 8 -42 Q -19 -16 -48 -15 Z':hairStyle==='tied'?'M -56 -1 Q -64 -44 -25 -63 Q 10 -77 44 -48 Q 63 -28 55 -1 L 47 -20 Q 20 -13 8 -38 Q -20 -12 -47 -14 Z':hairStyle==='long'?'M -56 6 Q -69 -45 -29 -63 Q 9 -76 43 -53 Q 62 -27 56 6 L 44 -15 Q 10 -5 -1 -39 Q -21 -15 -47 -13 Z':'M -55 -6 Q -62 -40 -34 -60 Q -10 -71 7 -64 Q 28 -74 47 -47 Q 64 -28 55 -5 L 48 -20 Q 18 -17 6 -43 Q -15 -19 -47 -14 Z',fill:hair,stroke:ink,strokeWidth:2.5},
      {id:'hair-highlight',type:'path',parent:'head-group',d:'M -42 -42 Q -18 -65 7 -57 M 17 -58 Q 33 -55 42 -40',fill:'none',stroke:trim,strokeWidth:1.6,opacity:.4},
    ];
    if(hairStyle==='none')faceDetails.splice(2);
    if(hairStyle==='bun')faceDetails.splice(3,0,{id:'hair-bun',type:'ellipse',parent:'head-group',x:46,y:-42,rx:20,ry:21,fill:hair,stroke:ink,strokeWidth:2.5});
    const firstFace=nodes.findIndex(n=>n.id==='face');nodes.splice(firstFace,0,...faceDetails.filter(n=>n.id==='hair-back'||n.id==='hair-bun'));
    const firstEye=nodes.findIndex(n=>n.id==='eyes');nodes.splice(firstEye,0,...faceDetails.filter(n=>n.id!=='hair-back'&&n.id!=='hair-bun'));
    const costume:VectorNode[]=[
      {id:'folk-collar',type:'path',parent:'upper-body',d:outfit==='ao-dai'?'M 99 181 Q 120 192 141 181 L 145 204 Q 119 219 95 203 Z':'M 96 181 L 120 198 L 145 181 L 154 197 L 121 232 L 89 196 Z',fill:trim,stroke:ink,strokeWidth:2},
      {id:'folk-lapel',type:'path',parent:'upper-body',d:outfit==='tunic'?'M 120 205 L 120 339':'M 142 202 Q 125 227 94 265 L 103 277 Q 136 245 151 209',fill:outfit==='vest'?'none':accent,stroke:ink,strokeWidth:1.6},
      {id:'folk-sash',type:'path',parent:'upper-body',d:outfit==='vest'?'M 74 278 Q 120 288 168 278 L 169 292 Q 120 302 71 293 Z':'M 65 280 Q 120 294 176 280 L 177 297 Q 119 312 64 298 Z',fill:accent,stroke:ink,strokeWidth:2},
      {id:'folk-seam',type:'path',parent:'upper-body',d:'M 90 312 Q 85 335 88 349 M 150 312 Q 155 336 149 350',fill:'none',stroke:ink,strokeWidth:1.1,opacity:.3},
      {id:'folk-hem-embroidery',type:'path',parent:'upper-body',d:'M 81 340 Q 120 347 160 340 M 110 330 Q 119 322 128 330',fill:'none',stroke:trim,strokeWidth:2.2},
    ];
    if(outfit==='shawl')costume.unshift({id:'folk-shawl',type:'path',parent:'upper-body',d:'M 77 187 L 105 181 L 120 218 L 138 181 L 161 189 Q 157 238 120 261 Q 85 237 77 187 Z',fill:accent,stroke:ink,strokeWidth:2.5});
    if(outfit==='vest')costume.unshift({id:'folk-vest',type:'path',parent:'upper-body',d:'M 78 181 L 103 189 L 114 244 L 104 268 L 78 253 Z M 137 189 L 162 182 L 162 253 L 136 268 L 126 244 Z',fill:accent,stroke:ink,strokeWidth:2});
    nodes.splice(nodes.findIndex(n=>n.id==='tunic-hem'),0,...costume);
    nodes.push({id:'folk-belt-knot',type:'ellipse',parent:'upper-body',x:126,y:295,rx:7,ry:5,fill:trim,stroke:ink,strokeWidth:1});
  }
  if(raw.nodes!==undefined){
    if(!Array.isArray(raw.nodes))throw new Error('Vector: invalid human additions');
    for(const entry of raw.nodes){
      if(!entry||typeof entry!=='object')throw new Error('Vector: invalid human addition');
      const n=entry as VectorNode,index=nodes.findIndex(old=>old.id===n.id);
      if(index<0)nodes.push(n);else nodes[index]={...nodes[index],...n};
    }
  }
  const basis=readableVectorHuman({width:240,height:480,nodes});
  return raw.style==='folk-chibi-v2'?illustrateArticulatedChibi(basis,palette,String(raw.outfit||'robe'),String(raw.hair||'side-part')):basis;
}

/** Native scaffold only: black outside contours, no elbow/knee crossbars. */
export function readableVectorHuman(drawing:VectorDrawing):VectorDrawing{
  if(drawing.width!==240||drawing.height!==480||!['upper-body','torso','sleeve-l','cuff-r','knee-r','head-group'].every(id=>drawing.nodes.some(n=>n.id===id)))return drawing;
  const nodes=drawing.nodes.map(n=>({...n})),ink='#080808';
  for(const n of nodes)if(n.stroke&&n.stroke!=='none')n.stroke=ink;
  if(nodes.some(n=>n.id==='folk-art-v2'))return {...drawing,nodes};
  for(const side of ['l','r'])for(const [id,d] of [
    ['sleeve','M -11 54 L -11 0 Q -11 -12 0 -12 Q 11 -12 11 0 L 11 54'],
    ['cuff','M -11 -6 L -10 46 Q 0 54 10 46 L 11 -6'],
    ['thigh','M -10 59 L -9 -4 Q 0 -8 9 -4 L 10 59'],
    ['shin','M -9 -6 L -8 54 Q 0 60 8 54 L 9 -6'],
  ]){
    const part=nodes.find(n=>n.id===`${id}-${side}`);
    if(part){part.d=d;part.stroke=ink;part.strokeWidth=3;}
  }
  const neck=nodes.find(n=>n.id==='neck');
  if(neck?.type==='rect'){neck.type='path';neck.d='M 0 34 L 0 0 L 24 0 L 24 34';neck.stroke=ink;neck.strokeWidth=3;}
  for(const n of nodes.filter(n=>/^(hand|foot)-[lr]$/.test(n.id))){n.stroke=ink;n.strokeWidth=2;}
  return {...drawing,nodes};
}
