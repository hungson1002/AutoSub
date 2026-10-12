import {evaluateVectorPart,vectorTrackTiming,type VectorDrawing,type VectorNode,type VectorTrack,type VectorFrame} from './canvasVectorScene';
import type {CanvasStudioScene} from './canvasAnimationStudio';
import {villagePuppetArt} from './canvasVectorVillageArt';
import {isCanvasActorSpeaking,canvasActorSpeechLevel} from './canvasDialogue';

/** Model A: swept layered hair and decorated continuous robes, never sleeves
 * or articulated limbs. Keep native pivots/contacts stable across costumes. */
export function vectorPuppetRig(raw:Record<string,unknown>):VectorDrawing{
  const design=raw.design??'legacy';
  if(!['legacy','village'].includes(String(design)))throw new Error('Vector: invalid puppet design');
  const palette=(raw.palette||{}) as Record<string,unknown>;
  const color=(key:string,fallback:string)=>{
    const value=palette[key]??fallback;
    if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Vector: invalid puppet palette');
    return value;
  };
  const skin=color('skin','#ead2b3'),shirt=color('shirt','#6c8c8c'),ink=color('ink','#080808'),hair=color('hair','#302a29');
  // Opt-in illustrated contour treatment; no anatomical change or migration of saved assets.
  const finish=raw.finish??(design==='village'?'handdrawn':'clean');
  if(!['clean','handdrawn'].includes(String(finish)))throw new Error('Vector: unknown puppet finish');
  const accent=color('accent','#d3b37a'),inner=color('inner','#f0e2c8'),trim=color('trim','#c5a773');
  const facialHair=raw.facialHair??'none';
  if(!['none','moustache','beard'].includes(String(facialHair)))throw new Error('Vector: invalid puppet facial hair');
  const headwear=raw.headwear??'none';
  if(!['none','headscarf','conical','headwrap'].includes(String(headwear)))throw new Error('Vector: invalid puppet headwear');
  // One flat lighter tone follows the actual hair palette, including gray hair.
  const hairShade='#'+[1,3,5].map(i=>Math.round(parseInt(hair.slice(i,i+2),16)*.9+255*.1).toString(16).padStart(2,'0')).join('');
  const hairstyle=raw.hair??'short';
  if(!['short','side-part','bun','long','tied','none','braid','double-bun','cropped','wavy','bob'].includes(String(hairstyle)))throw new Error('Vector: invalid puppet hairstyle');
  const outfit=raw.outfit??'robe';
  if(!['robe','tunic','ao-dai','vest','shawl'].includes(String(outfit)))throw new Error('Vector: invalid puppet outfit');
  // Optional same-style cast variation; defaults are intentionally unchanged
  // for every previously authored puppet/scene.
  const faceShape=raw.faceShape??'round',eyeStyle=raw.eyeStyle??'classic';
  if(!['round','oval','broad'].includes(String(faceShape))||!['classic','wide','tired','sharp'].includes(String(eyeStyle)))
    throw new Error('Vector: invalid puppet face/eye design');
  const faceRx=faceShape==='broad'?61:faceShape==='oval'?49:56,faceRy=faceShape==='oval'?68:faceShape==='broad'?57:60;
  const eyeRx=eyeStyle==='wide'?7:eyeStyle==='sharp'?5:6,eyeRy=eyeStyle==='wide'?10:eyeStyle==='tired'?5.5:eyeStyle==='sharp'?6:8;
  const line=(id:string,d:string,stroke=ink,width=2):VectorNode=>({id,type:'path',parent:'costume',d,fill:'none',stroke,strokeWidth:width});
  const cloth=(id:string,d:string,fill:string):VectorNode=>({id,type:'path',parent:'costume',d,fill,stroke:ink,strokeWidth:2});
  const flower=(id:string,x:number,y:number,size=1):VectorNode[]=>[
    {id,type:'group',parent:'costume',x,y,scaleX:size,scaleY:size},
    ...[[0,-5],[5,0],[0,5],[-5,0]].map(([x,y],i):VectorNode=>({id:id+'-petal-'+i,type:'ellipse',parent:id,x,y,rx:4,ry:4,fill:trim})),
    {id:id+'-center',type:'ellipse',parent:id,rx:2.3,ry:2.3,fill:accent},
  ];
  const clothing:VectorNode[]=outfit==='tunic'?[
    cloth('collar','M 77 127 Q 90 136 103 127 L 106 141 L 90 153 L 74 141 Z',inner),
    line('collar-trim','M 75 136 L 90 148 L 105 136',trim,2.5),
    line('front-seam','M 90 150 L 90 270',ink,1.4),
    ...[163,187,211,235].flatMap((y,i):VectorNode[]=>[
      line('button-'+i,`M 84 ${y} L 96 ${y}`,trim,2.4),
      ...[83,97].map((x,j):VectorNode=>({id:`button-${i}-${j}`,type:'ellipse',parent:'costume',x,y,rx:2.5,ry:3,fill:trim})),
    ]),
    line('hem-trim','M 49 260 Q 90 277 131 260',trim,2.5),
    line('fabric-fold','M 64 226 Q 61 245 63 257 M 115 232 L 119 256',ink,1),
  ]:outfit==='ao-dai'?[
    cloth('collar','M 77 127 Q 90 135 103 127 L 105 144 Q 90 150 75 144 Z',inner),
    // One continuous front panel: the old crossed panels resembled two loose
    // sleeves and hid the garment's actual construction at small sizes.
    cloth('wrap-r','M 103 134 Q 119 138 127 154 L 120 165 L 99 153 L 78 151 L 78 141 Q 92 145 103 134 Z',accent),
    line('wrap-l','M 103 141 Q 108 159 120 165 L 120 263',ink,1.4),
    line('wrap-edge','M 104 141 Q 108 155 119 161',trim,2),
    ...[164,178].map((y,i):VectorNode=>({id:'fastener-'+i,type:'ellipse',parent:'costume',x:120,y,rx:2.3,ry:2.3,fill:trim})),
    line('panel-l','M 63 215 Q 60 242 62 263',ink,1),
    line('hem-trim','M 49 263 Q 90 274 131 263',accent,3),
    line('fabric-sprig','M 81 251 Q 70 231 78 216 M 77 235 Q 67 233 68 225 M 75 229 Q 88 228 87 220',trim,1.5),
    ...flower('fabric-flower',78,211,.85),...flower('fabric-bud',87,232,.55),
  ]:outfit==='vest'?[
    cloth('inner-shirt','M 75 131 L 90 146 L 105 131 L 118 258 Q 90 265 62 258 Z',inner),
    cloth('vest-l','M 58 133 Q 66 128 76 130 L 87 153 L 80 216 Q 78 222 71 225 L 53 235 Q 48 237 49 231 L 55 148 Q 55 138 58 133 Z',accent),
    cloth('vest-r','M 104 130 Q 114 128 122 133 Q 125 138 125 148 L 131 231 Q 132 237 127 235 L 109 225 Q 102 222 100 216 L 93 153 Z',accent),
    line('collar','M 76 133 L 90 147 L 104 133'),
    line('pocket-l','M 56 196 L 73 198'),line('pocket-r','M 106 198 L 124 196'),
    line('waist-band','M 48 241 Q 90 250 132 241',accent,5),
  ]:outfit==='shawl'?[
    cloth('shawl','M 60 133 L 79 127 Q 90 139 101 127 L 121 134 Q 127 150 130 179 Q 114 194 91 208 Q 70 194 51 179 Q 53 150 60 133 Z',accent),
    line('collar','M 65 136 L 94 173 L 117 136'),
    line('shawl-edge','M 55 173 L 91 198 L 125 173',inner,3),
    line('shawl-fold','M 91 174 L 91 196',ink,1.5),
    line('hem-trim','M 51 263 Q 90 277 130 263',accent,3),
  ]:[
    cloth('collar','M 72 128 L 90 142 L 107 128 L 116 142 L 91 174 L 64 142 Z',inner),
    cloth('lapel-l','M 62 136 L 77 130 L 98 162 L 90 172 Z',shirt),
    cloth('lapel-r','M 107 131 L 121 140 L 70 211 L 54 207 Z',shirt),
    line('collar-trim','M 65 138 L 94 165 M 115 140 L 70 200',inner,3),
    cloth('sash','M 48 200 Q 90 211 132 200 L 134 214 Q 90 225 46 214 Z',accent),
    cloth('sash-end','M 113 215 Q 119 217 125 214 L 131 259 L 118 257 Z',accent),
    cloth('sash-knot','M 110 204 Q 122 197 125 207 L 121 219 Q 111 223 108 215 Z',accent),
    line('sash-fold','M 117 207 L 114 216 M 123 226 L 126 251',trim,1.3),
    line('hem-trim','M 49 262 Q 90 277 131 262',trim,2.5),
  ];
  const frontHair=hairstyle==='side-part'?'M -56 11 Q -63 -8 -58 -26 L -68 -29 Q -56 -33 -53 -46 L -64 -49 Q -43 -51 -29 -63 Q -5 -76 22 -65 Q 27 -69 22 -76 Q 41 -73 39 -62 Q 63 -50 62 -27 L 68 -22 L 56 -20 L 54 11 L 46 -10 Q 37 -16 26 -37 Q 21 -48 9 -40 Q -14 -12 -48 -14 L -48 11 Z':
    hairstyle==='bun'||hairstyle==='long'?'M -56 12 Q -67 -18 -55 -43 Q -41 -67 -11 -66 Q 16 -71 40 -55 Q 66 -39 56 12 L 47 -14 Q 20 -15 5 -40 Q -8 -18 -34 -15 L -48 -12 L -48 12 Z':
    hairstyle==='tied'?'M -56 12 Q -65 -22 -52 -44 Q -28 -70 2 -64 Q 36 -69 55 -38 Q 64 -20 55 12 L 47 -12 Q 28 -25 23 -44 Q 2 -18 -29 -16 L -47 -12 L -48 12 Z':
    'M -56 12 Q -65 -19 -53 -43 L -62 -47 Q -45 -48 -34 -58 Q -10 -74 19 -61 Q 25 -67 22 -72 Q 39 -69 38 -57 Q 63 -45 57 -16 L 54 12 L 47 -14 Q 38 -24 30 -35 Q 6 -12 -22 -18 L -12 -27 Q -30 -16 -47 -17 L -48 12 Z';
  const nodes:VectorNode[]=[
    {id:'puppet-root',type:'group'},
    {id:'upper-body',type:'group',parent:'puppet-root',pivotX:90,pivotY:280,pivotSpace:'local'},
    {id:'neck',type:'rect',parent:'upper-body',x:81,y:149,width:18,height:24,fill:skin,stroke:ink,strokeWidth:2.5},
    {id:'torso',type:'path',parent:'upper-body',d:'M 65 162 Q 90 151 115 162 Q 136 168 136 199 L 140 251 Q 140 280 113 280 L 67 280 Q 40 280 40 251 L 44 199 Q 44 168 65 162 Z',fill:shirt,stroke:ink,strokeWidth:3},
    // Compress costume details, rather than scaling the whole actor: the ground
    // pivot and prop contacts remain in the same native 180x280 coordinate space.
    {id:'costume',type:'group',parent:'upper-body',y:61.6,scaleY:.78},
    // Hem folds stay inside the robe; long side seams can look like idle arms.
    {id:'robe-fold',type:'path',parent:'costume',pivotX:90,pivotY:155,pivotSpace:'local',d:'M 62 244 L 60 262 M 112 247 L 115 263 M 54 266 Q 90 276 127 266',fill:'none',stroke:ink,strokeWidth:1.3,opacity:.24},
    {id:'fabric-shade',type:'path',parent:'costume',d:'M 123 149 Q 133 168 132 197 L 137 245 Q 139 267 118 276 L 68 276 Q 109 269 113 251 L 118 191 Z',fill:ink,opacity:.08},
    ...clothing,
    {id:'head-group',type:'group',parent:'upper-body',x:90,y:92,pivotY:55,pivotSpace:'local',scaleX:1.2,scaleY:1.1},
    ...(hairstyle==='long'?[
      {id:'hair-back',type:'path',parent:'head-group',d:'M -54 -21 Q -67 7 -63 80 Q -59 108 -35 110 L -27 103 L -29 31 L 29 31 L 27 103 Q 43 117 61 102 Q 67 76 64 26 L 54 -21 Z',fill:hair,stroke:ink,strokeWidth:2.5} as VectorNode,
    ]:hairstyle==='tied'?[
      {id:'hair-tip',type:'path',parent:'head-group',pivotX:49,pivotY:-25,pivotSpace:'local',d:'M 48 -31 Q 89 -42 80 1 Q 75 17 67 18 Q 72 -7 50 -6 Z',fill:hair,stroke:ink,strokeWidth:2.5} as VectorNode,
    ]:hairstyle==='bun'?[
      {id:'hair-bun',type:'ellipse',parent:'head-group',x:51,y:-25,rx:21,ry:24,fill:hair,stroke:ink,strokeWidth:2.5} as VectorNode,
    ]:[]),
    {id:'ear-l',type:'ellipse',parent:'head-group',x:-56,y:5,rx:8,ry:12,fill:skin,stroke:ink,strokeWidth:2.5},
    {id:'ear-r',type:'ellipse',parent:'head-group',x:56,y:5,rx:8,ry:12,fill:skin,stroke:ink,strokeWidth:2.5},
    {id:'face',type:'ellipse',parent:'head-group',rx:faceRx,ry:faceRy,fill:skin,stroke:ink,strokeWidth:3},
    {id:'cheek-l',type:'ellipse',parent:'head-group',x:-34,y:18,rx:8,ry:3.5,fill:'#c78e80',opacity:.28},
    {id:'cheek-r',type:'ellipse',parent:'head-group',x:34,y:18,rx:8,ry:3.5,fill:'#c78e80',opacity:.28},
    ...(hairstyle==='none'?[]:[
      {id:'hair',type:'path',parent:'head-group',d:frontHair,fill:hair,stroke:ink,strokeWidth:2.5} as VectorNode,
      {id:'hair-layer',type:'path',parent:'head-group',d:hairstyle==='side-part'?'M -52 -38 Q -31 -66 3 -61 Q 24 -58 27 -42 Q 19 -52 7 -44 Q -13 -22 -42 -22 Q -23 -28 -8 -45 Q -32 -33 -52 -38 Z':hairstyle==='short'?'M -45 -39 Q -21 -65 7 -56 Q 25 -54 30 -40 Q 7 -51 -6 -38 Q -25 -25 -39 -27 Q -19 -35 -12 -44 Q -30 -35 -45 -39 Z':'M -49 -36 Q -31 -61 -7 -59 Q 8 -63 23 -53 Q 8 -56 2 -43 Q -16 -22 -41 -23 Q -16 -36 -12 -48 Q -32 -35 -49 -36 Z',fill:hairShade} as VectorNode,
      {id:'hair-part',type:'path',parent:'head-group',d:hairstyle==='side-part'?'M -49 -21 Q -21 -18 2 -43 Q 21 -61 34 -40 M 31 -51 Q 49 -43 53 -25':'M -45 -19 Q -17 -21 3 -44 Q 17 -25 45 -19',fill:'none',stroke:ink,strokeWidth:1.4} as VectorNode,
      ...(hairstyle==='tied'?[]:[{id:'hair-tip',type:'path',parent:'head-group',pivotX:hairstyle==='long'?49:-43,pivotY:hairstyle==='long'?51:-12,pivotSpace:'local',d:hairstyle==='long'?'M 49 51 L 61 52 L 60 98 Q 52 112 39 107 Q 52 85 49 51 Z':hairstyle==='bun'?'M -48 -14 Q -52 4 -46 21 Q -42 28 -46 35 Q -37 30 -42 19 Q -47 6 -43 -14 Z':'M -43 -16 Q -21 -17 -6 -34 Q -12 -19 -35 -15 Z',fill:hair,stroke:hairstyle==='bun'||hairstyle==='long'?ink:'none',strokeWidth:1.2} as VectorNode]),
      ...(hairstyle==='bun'?[
        {id:'hair-pin',type:'path',parent:'head-group',d:'M 52 -23 L 69 -37 M 54 -21 L 73 -25',fill:'none',stroke:trim,strokeWidth:1.8} as VectorNode,
        ...[[57,-28],[62,-25],[60,-20],[54,-20],[52,-25]].map(([x,y],i):VectorNode=>({id:'hair-flower-'+i,type:'ellipse',parent:'head-group',x,y,rx:3.7,ry:3.7,fill:accent})),
        {id:'hair-flower-center',type:'ellipse',parent:'head-group',x:57,y:-24,rx:2.2,ry:2.2,fill:trim} as VectorNode,
      ]:[]),
    ]),
    ...(headwear==='conical'?[
      {id:'headwear',type:'path',parent:'head-group',d:'M -79 -39 Q -35 -70 0 -101 Q 35 -70 79 -39 Q 0 -25 -79 -39 Z',fill:accent,stroke:ink,strokeWidth:2.5} as VectorNode,
      {id:'hat-weave',type:'path',parent:'head-group',d:'M -58 -44 Q 0 -38 58 -44 M -35 -57 Q 0 -51 35 -57 M 0 -96 L -18 -39 M 0 -96 L 18 -39',fill:'none',stroke:trim,strokeWidth:1.2} as VectorNode,
    ]:headwear==='headscarf'?[
      {id:'headwear',type:'path',parent:'head-group',d:'M -59 -20 Q -62 -67 -12 -70 Q 48 -75 60 -26 L 53 -14 Q 22 -38 -12 -27 Q -35 -20 -59 -20 Z',fill:accent,stroke:ink,strokeWidth:2.5} as VectorNode,
      {id:'scarf-knot',type:'path',parent:'head-group',d:'M 52 -23 Q 76 -40 73 -12 L 64 -7 L 73 26 L 56 20 L 52 -16 Z',fill:accent,stroke:ink,strokeWidth:2} as VectorNode,
    ]:[]),
    {id:'blink',type:'group',parent:'head-group',pivotY:-3,pivotSpace:'local'},
    {id:'eyes',type:'group',parent:'blink',pivotY:-3,pivotSpace:'local'},
    {id:'eye-l',type:'ellipse',parent:'eyes',x:-20,y:-3,rx:eyeRx,ry:eyeRy,fill:ink},
    {id:'eye-r',type:'ellipse',parent:'eyes',x:20,y:-3,rx:eyeRx,ry:eyeRy,fill:ink},
    {id:'brow-l',type:'path',parent:'head-group',d:eyeStyle==='sharp'?'M -31 -20 Q -20 -30 -10 -28':eyeStyle==='tired'?'M -30 -20 Q -20 -18 -11 -22':'M -30 -24 Q -20 -28 -11 -24',fill:'none',stroke:ink,strokeWidth:2},
    {id:'brow-r',type:'path',parent:'head-group',d:eyeStyle==='sharp'?'M 10 -28 Q 20 -30 31 -20':eyeStyle==='tired'?'M 11 -22 Q 20 -18 30 -20':'M 11 -24 Q 20 -28 30 -24',fill:'none',stroke:ink,strokeWidth:2},
    {id:'mouth',type:'ellipse',parent:'head-group',y:27,rx:3.5,ry:1.8,fill:ink},
    ...(facialHair==='moustache'?[{id:'moustache',type:'path',parent:'head-group',d:'M 0 20 Q -5 13 -11 20 Q -17 26 -22 24 Q -12 31 0 25 Q 12 31 22 24 Q 17 26 11 20 Q 5 13 0 20 Z',fill:hair,stroke:hairShade,strokeWidth:1} as VectorNode]:[]),
    ...(facialHair==='beard'?[
      {id:'beard',type:'path',parent:'head-group',d:'M -39 26 Q -34 37 -20 34 Q 0 47 20 34 Q 34 37 39 26 Q 35 62 18 73 L 0 89 L -18 73 Q -35 62 -39 26 Z',fill:hair,stroke:ink,strokeWidth:2} as VectorNode,
      {id:'beard-strands',type:'path',parent:'head-group',d:'M -20 43 Q -17 62 -5 77 M 7 47 Q 15 58 6 77 M 23 42 L 20 61',fill:'none',stroke:hairShade,strokeWidth:1.5} as VectorNode,
    ]:[]),
    // Renderers reveal only the hand carrying a prop or performing a gesture.
    {id:'hand-l',type:'ellipse',parent:'upper-body',x:47,y:182,rx:17,ry:17,fill:skin,stroke:ink,strokeWidth:2.5},
    {id:'hand-r',type:'ellipse',parent:'upper-body',x:133,y:182,rx:17,ry:17,fill:skin,stroke:ink,strokeWidth:2.5},
  ];
  if(finish==='handdrawn'){
    // Follow the reference's softly uneven *silhouette* rather than adding
    // exposed limbs or random vector noise. Root/neck/prop contacts stay fixed.
    const torso=nodes.find(n=>n.id==='torso')!;
    // The shoulder outline goes AROUND the neck opening. A continuous top
    // arc painted over the neck looked like a second loose collar.
    torso.d='M 65 162 Q 71 160 79 158 Q 90 170 101 158 Q 108 160 115 162 Q 129 168 130 195 L 136 258 Q 137 280 113 280 L 67 280 Q 43 280 44 258 L 50 195 Q 51 168 65 162 Z';
    torso.strokeWidth=3;
    const neck=nodes.find(n=>n.id==='neck')!;
    neck.type='path';neck.d='M 81 142 L 80 162 Q 90 168 100 162 L 99 142 Z';
    neck.x=undefined;neck.y=undefined;neck.width=undefined;neck.height=undefined;neck.strokeWidth=2;
    const face=nodes.find(n=>n.id==='face');
    if(face){
      // A balanced, rounded silhouette reads at village-shot scale. The old
      // asymmetric contour and under-eye etching made every age look weary.
      // Keep native pivots and the existing face/eye design choices.
      face.type='path';
      face.d=`M 0 ${-faceRy} C ${faceRx*.66} ${-faceRy} ${faceRx} ${-faceRy*.55} ${faceRx} 0 C ${faceRx} ${faceRy*.64} ${faceRx*.55} ${faceRy} 0 ${faceRy} C ${-faceRx*.55} ${faceRy} ${-faceRx} ${faceRy*.64} ${-faceRx} 0 C ${-faceRx} ${-faceRy*.55} ${-faceRx*.66} ${-faceRy} 0 ${-faceRy} Z`;
      face.rx=undefined;face.ry=undefined;face.strokeWidth=3;
    }
    // Readable cartoon eyes share the SAME eyes/blink chain. Dot pupils stay
    // on the original landmarks; no independently blinking white overlays.
    const eyeIndex=nodes.findIndex(n=>n.id==='eye-l');
    nodes.splice(eyeIndex,0,...(['l','r'] as const).map((side):VectorNode=>({
      id:'eye-white-'+side,type:'ellipse',parent:'eyes',x:side==='l'?-20:20,y:-3,
      rx:eyeRx+4,ry:eyeStyle==='tired'?13:eyeRy+4,fill:'#fff8ed',stroke:ink,strokeWidth:2,
    })));
    for(const side of ['l','r']){const pupil=nodes.find(n=>n.id==='eye-'+side)!;pupil.rx=eyeRx*.73;pupil.ry=eyeStyle==='tired'?7:eyeRy*.75;}
    if(outfit==='tunic'){
      // Rural standing collar and side fastening, rather than four ornate
      // horizontal clasps on every villager. Keep the same garment/contact map.
      const collar=nodes.find(n=>n.id==='collar')!;
      // Costume coordinates are compressed by .78 + 61.6: this opening now
      // meets the native neck instead of drawing a ring down on the chest.
      collar.d='M 79 121 Q 90 127 101 121 L 103 133 Q 90 141 77 133 Z';collar.fill=shirt;
      nodes.find(n=>n.id==='collar-trim')!.opacity=0; // the collar already has its own outline
      const seam=nodes.find(n=>n.id==='front-seam')!;seam.d='M 103 133 Q 112 151 118 170 L 121 257';seam.strokeWidth=1.3;
      for(let i=0;i<4;i++){
        const clasp=nodes.find(n=>n.id==='button-'+i)!;clasp.opacity=0;
        for(let j=0;j<2;j++){
          const button=nodes.find(n=>n.id===`button-${i}-${j}`)!;
          if(i>=2||j===1)button.opacity=0;
          else {button.x=i?119:114;button.y=i?191:165;button.rx=2;button.ry=2;button.fill=trim;}
        }
      }
      nodes.find(n=>n.id==='hem-trim')!.opacity=.45;
    }
    if(outfit==='ao-dai')nodes.find(n=>n.id==='collar')!.d='M 79 121 Q 90 127 101 121 L 103 134 Q 90 140 77 134 Z';
    const hairFront=nodes.find(n=>n.id==='hair');
    if(hairFront&&(hairstyle==='short'||hairstyle==='side-part'))hairFront.d=hairstyle==='short'
      ?'M -56 10 Q -64 -17 -54 -41 Q -37 -65 -8 -66 Q 24 -72 47 -49 Q 63 -33 57 10 L 48 -13 Q 36 -19 25 -35 Q 4 -18 -21 -20 Q -36 -16 -48 -18 L -48 10 Z'
      :'M -56 10 Q -64 -16 -55 -41 Q -40 -64 -10 -66 Q 22 -73 46 -51 Q 65 -34 57 10 L 48 -12 Q 36 -17 25 -36 Q 19 -45 9 -39 Q -12 -16 -47 -16 L -48 10 Z';
    const hairLine=nodes.find(n=>n.id==='hair-part');if(hairLine)hairLine.strokeWidth=1.15;
    // Non-rendering marker chooses the *cutout* motion grammar. It is never a limb.
    nodes.push({id:'handdrawn-finish',type:'group',parent:'puppet-root'});
    nodes.push({id:'handdrawn-ear-left',type:'path',parent:'head-group',d:'M -59 2 Q -64 7 -58 13',fill:'none',stroke:ink,strokeWidth:1.1,opacity:.65});
    nodes.push({id:'handdrawn-ear-right',type:'path',parent:'head-group',d:'M 59 2 Q 64 7 58 13',fill:'none',stroke:ink,strokeWidth:1.1,opacity:.65});
    nodes.push({id:'handdrawn-hem',type:'path',parent:'upper-body',d:'M 52 264 Q 66 269 84 268 Q 112 271 129 263',fill:'none',stroke:trim,strokeWidth:1.5,opacity:.6});
    nodes.push({id:'handdrawn-fabric',type:'path',parent:'costume',d:'M 61 229 Q 59 245 62 255 M 120 230 Q 123 245 120 255',fill:'none',stroke:ink,strokeWidth:1,opacity:.24});
  }
  if(finish==='handdrawn'||design==='village'){
    // A real rear pose, hidden until a native turn selects it. A mirror of
    // the front face is not a back view. Keep the SAME head/body/hand chain.
    const hatIndex=nodes.findIndex(n=>n.id==='headwear');
    const rear:VectorNode[]=[
      {id:'rear-head',type:'group',parent:'head-group',opacity:0},
      {id:hairstyle==='none'?'rear-scalp':'rear-hair',type:'path',parent:'rear-head',d:hairstyle==='none'
        ?`M 0 ${-faceRy} C ${faceRx} ${-faceRy} ${faceRx} ${faceRy} 0 ${faceRy} C ${-faceRx} ${faceRy} ${-faceRx} ${-faceRy} 0 ${-faceRy} Z`
        :'M 0 -67 C 39 -70 61 -41 59 -3 Q 60 43 34 54 Q 0 67 -34 54 Q -60 43 -59 -3 C -61 -41 -39 -70 0 -67 Z',
        fill:hairstyle==='none'?skin:hair,stroke:ink,strokeWidth:3},
      ...(hairstyle==='none'?[]:[{id:'rear-hair-lines',type:'path',parent:'rear-head',d:'M -28 -40 Q -42 -5 -30 30 M 31 -42 Q 43 -9 32 29',fill:'none',stroke:hairShade,strokeWidth:1.5} as VectorNode]),
      {id:'rear-costume',type:'group',parent:'upper-body',opacity:0},
      {id:'rear-seam',type:'path',parent:'rear-costume',d:'M 90 174 L 90 260 M 53 264 Q 90 275 128 264',fill:'none',stroke:ink,strokeWidth:1.3,opacity:.3},
    ];
    nodes.splice(hatIndex<0?nodes.findIndex(n=>n.id==='hand-l'):hatIndex,0,...rear);
  }
  const rig={width:180,height:280,nodes};
  return withPuppetFearEffects(design==='village'?villagePuppetArt(rig,raw):rig);
}

/** Opt-in upgrade for retained puppets: add invisible effects, preserve all art.
 * Insert before the rear drawing so sweat never paints over the back of a head. */
export function withPuppetFearEffects(rig:VectorDrawing):VectorDrawing{
  if(!rig.nodes.some(n=>n.id==='puppet-root'))return rig;
  const existing=rig.nodes.some(n=>n.id==='fear-effects');
  if(existing&&rig.nodes.some(n=>n.id==='fear-stress'))return rig;
  const ink=rig.nodes.find(n=>n.id==='face')?.stroke||'#080808';
  const village=rig.nodes.some(n=>n.id==='village-cast-v1');
  const effects:VectorNode[]=[...existing?[]:[{id:'fear-effects',type:'group',parent:'head-group'} as VectorNode,
    ...(['l','r'] as const).flatMap((side):VectorNode[]=>[
      {id:'sweat-'+side,type:'group',parent:'fear-effects',x:side==='l'?-44:44,y:-8,opacity:0,...(village?{scaleX:.55,scaleY:.65}:{})},
      {id:'sweat-drop-'+side,type:'path',parent:'sweat-'+side,d:'M 0 -10 Q -7 0 -7 5 A 7 7 0 0 0 7 5 Q 7 0 0 -10 Z',fill:'#a9dce7',stroke:ink,strokeWidth:1.3},
      {id:'sweat-shine-'+side,type:'path',parent:'sweat-'+side,d:'M -3 1 Q -5 5 -2 7',fill:'none',stroke:'#f3fcff',strokeWidth:1.8},
    ])],
    {id:'fear-stress',type:'group',parent:'fear-effects',opacity:0},
    {id:'fear-stress-lines',type:'path',parent:'fear-stress',d:'M 7 -34 L 7 -23 M 15 -35 L 15 -22 M 23 -33 L 23 -23',fill:'none',stroke:'#65718b',strokeWidth:2},
  ];
  const nodes=rig.nodes.map(n=>village&&/^sweat-[lr]$/.test(n.id)?{...n,scaleX:.55,scaleY:.65}:n),rear=nodes.findIndex(n=>n.id==='rear-head');
  nodes.splice(rear<0?nodes.length:rear,0,...effects);
  return {...rig,nodes};
}

/** Bounded fear: linked cutout shivers, readable face and two staggered drops.
 * Feet/root, facing, hand ownership and the camera are never animated here. */
export function vectorPuppetFearTracks(d:VectorDrawing,assets:Record<string,VectorDrawing>,raw:unknown,durationMs=10000):VectorTrack[]{
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>16)throw new Error('Vector: invalid fear reactions');
  return raw.flatMap((value):VectorTrack[]=>{
    if(!value||typeof value!=='object')throw new Error('Vector: invalid fear reaction');
    const r=value as Record<string,unknown>,node=d.nodes.find(n=>n.id===r.actor&&n.type==='instance'),rig=assets[node?.asset||''];
    const level=r.level??'terrified',start=r.start??0,end=r.end??.24;
    if(!node||!rig?.nodes.some(n=>n.id==='puppet-root'))throw new Error('Vector: fear needs a compact puppet actor');
    if(!['uneasy','terrified'].includes(String(level)))throw new Error('Vector: fear level must be uneasy or terrified');
    if(typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>1||end<=start
      ||r.cue!==undefined&&(typeof r.cue!=='string'||!r.cue.trim()))throw new Error('Vector: invalid fear timing');
    const village=rig.nodes.some(n=>n.id==='village-cast-v1');
    const strong=level==='terrified',amplitude=village?(strong?1.8:.9):(strong?3:1.4);
    const cycles=Math.max(1,Math.min(12,Math.round((end-start)*durationMs/1000*(strong?4.5:3.2))));
    const shake:VectorFrame[]=[{t:0,dx:0,rotation:0,easing:'smooth'}];
    for(let i=0;i<cycles*2;i++){
      const t=.06+(i+.5)/(cycles*2)*.8,envelope=Math.min(1,t/.14,(1-t)/.25),sign=i%2?-1:1;
      shake.push({t,dx:sign*amplitude*envelope,rotation:sign*(village?(strong?.25:.12):(strong?.55:.25))*envelope,easing:'smooth'});
    }
    shake.push({t:1,dx:0,rotation:0,easing:'smooth'});
    const track=(part:string,frames:VectorFrame[]):VectorTrack=>({target:node.id+'/'+part,start,end,...(r.cue!==undefined?{cue:r.cue as string}:{}),frames});
    const face=(part:string,pose:Partial<VectorFrame>,rest:Partial<VectorFrame>)=>track(part,[
      {t:0,...rest,easing:'smooth'},{t:.1,...pose,easing:'smooth'},{t:.76,...pose,easing:'smooth'},{t:1,...rest,easing:'smooth'},
    ]);
    const mouth=rig.nodes.find(n=>n.id==='mouth'),pathMouth=mouth?.type==='path';
    const tracks=[track('upper-body',shake),
      face('eyes',{scaleX:village?(strong?1.08:1.03):(strong?1.12:1.05),scaleY:village?(strong?1.16:1.08):(strong?1.3:1.12)},{scaleX:1,scaleY:1}),
      face('brow-l',{dy:-3,rotation:-14},{dy:0,rotation:0}),face('brow-r',{dy:-3,rotation:14},{dy:0,rotation:0}),
      face('mouth',{scaleX:village?1:(strong?2.1:1.4),scaleY:village?1:(strong?4:2),
        ...(pathMouth?{d:village?'M -8 1 Q -5 -3 -2 0 Q 1 3 4 0 Q 7 -3 10 1':'M 0 -1.4 A 3.4 1.4 0 1 0 0 1.4 A 3.4 1.4 0 1 0 0 -1.4 Z',fill:village?'none':mouth.stroke||'#141313'}:{})},
        {scaleX:1,scaleY:1,...(pathMouth?{d:mouth.d,fill:mouth.fill}:{})}),
      track('mouth',shake.map(f=>({t:f.t,dx:f.dx!*.2,easing:f.easing}))),
    ];
    if(village&&rig.nodes.some(n=>n.id==='fear-stress'))tracks.push(face('fear-stress',{opacity:strong?1:.6},{opacity:0}));
    for(const side of ['l','r'])if(rig.nodes.some(n=>n.id==='sweat-'+side)){
      const delay=side==='l'?.08:.27;
      tracks.push(track('sweat-'+side,village?[
        {t:0,opacity:0,dy:0},{t:side==='l'?.12:.48,opacity:0,dy:0},
        {t:side==='l'?.18:.54,opacity:1,dy:1,easing:'smooth'},
        {t:side==='l'?.32:.68,opacity:1,dy:10,easing:'linear'},
        {t:side==='l'?.41:.77,opacity:0,dy:14,easing:'smooth'},{t:1,opacity:0,dy:14},
      ]:[{t:0,opacity:0,dy:0},{t:delay,opacity:0,dy:0},
        {t:delay+.09,opacity:1,dy:2,easing:'smooth'},{t:delay+.47,opacity:1,dy:19,easing:'linear'},
        {t:delay+.61,opacity:0,dy:25,easing:'smooth'},{t:1,opacity:0,dy:25}]));
    }
    return tracks;
  });
}

/** Short 2D pose changes about the planted body's center. Facing changes never
 * translate the actor or change which anatomical hand owns a carried prop. */
export const puppetTurnOpacityParts=['rear-head','rear-costume','costume','blink','brow-l','brow-r','mouth','cheek-l','cheek-r','beard','beard-strands','moustache','handdrawn-hem','village-nose','age-lines','glasses'] as const;
/** Paint occupied hands AND their attachments behind the opaque body when
 * facing away. Geometry/contact stays unchanged; exposed portions remain visible. */
export function puppetPaintOrder(children:VectorNode[],rig:VectorDrawing,prefix:string,scene:CanvasStudioScene,timeMs:number):VectorNode[]{
  if(!children.some(n=>/^hand-[lr]$/.test(n.id))||!rig.nodes.some(n=>n.id==='puppet-root'))return children;
  const rear=rig.nodes.find(n=>n.id==='rear-head');
  if(!rear||evaluateVectorPart(prefix+'rear-head',scene,timeMs,rear.opacity??0).opacity<.5)return children;
  return [...children.filter(n=>/^hand-[lr]$/.test(n.id)),...children.filter(n=>!/^hand-[lr]$/.test(n.id))];
}
export function vectorPuppetTurnTracks(d:VectorDrawing,assets:Record<string,VectorDrawing>,raw:unknown):VectorTrack[]{
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>16)throw new Error('Vector: invalid turns');
  return raw.flatMap((value):VectorTrack[]=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Vector: invalid turn');
    const r=value as Record<string,unknown>,node=d.nodes.find(n=>n.id===r.actor&&n.type==='instance'),rig=assets[node?.asset||''];
    const views=['front','back','left','right'],from=r.from??'front',to=r.to;
    if(!node||!rig?.nodes.some(n=>n.id==='puppet-root')||!views.includes(String(from))||!views.includes(String(to)))throw new Error('Vector: turn needs a compact actor and front/back/left/right views');
    if((from==='back'||to==='back')&&!rig.nodes.some(n=>n.id==='rear-head'))throw new Error('Vector: a back turn needs an authored rear-head view');
    const start=r.start??0,end=r.end??.1;
    if(typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>1||end<=start||r.hold!==undefined&&typeof r.hold!=='boolean'||r.hold&&r.cue!==undefined)throw new Error('Vector: invalid turn timing');
    if(r.cue!==undefined&&typeof r.cue!=='string')throw new Error('Vector: invalid turn cue');
    const timing={start:r.hold?0:start,end:r.hold?1:end,...(r.cue!==undefined?{cue:r.cue as string}:{})};
    const sign=(v:unknown)=>v==='left'||v==='back'?-1:1,a=sign(from),b=sign(to);
    const track=(part:string,frames:VectorFrame[]):VectorTrack=>({target:node.id+'/'+part,...timing,frames:r.hold?[{...frames.at(-1)!,t:0}]:frames});
    const flip=from!=='back'&&to!=='back';
    const tracks=[track('upper-body',flip?[
      // Image-style facing flip: keep the full silhouette and swap in one
      // frame. Never rotate the drawing sideways or interpolate through zero.
      {t:0,scaleX:a},{t:.5,scaleX:b,easing:'hold'},{t:1,scaleX:b,easing:'hold'},
    ]:[
      {t:0,scaleX:a},{t:.4,scaleX:a*.76,easing:'smooth'},
      {t:.5,scaleX:b*.76,easing:'hold'},{t:1,scaleX:b,easing:'smooth'},
    ])];
    const rear=(v:unknown)=>v==='back'?1:0;
    const pose=(part:string,back:boolean,frontOpacity=1)=>track(part,[
      {t:0,opacity:back?rear(from):frontOpacity*(1-rear(from))},
      {t:.5,opacity:back?rear(to):frontOpacity*(1-rear(to)),easing:'hold'},
      {t:1,opacity:back?rear(to):frontOpacity*(1-rear(to)),easing:'hold'},
    ]);
    for(const part of puppetTurnOpacityParts){
      const p=rig.nodes.find(n=>n.id===part);if(p)tracks.push(pose(part,part.startsWith('rear-'),p.opacity??1));
    }
    return tracks;
  });
}

/** Hand visibility is independent of its prop's transform/visibility: hiding
 * the unused dot must not hide a lamp attached to the same contact point. */
export function puppetHandOpacity(target:string,scene:CanvasStudioScene,timeMs:number):number{
  const carried=scene.vectorScene!.nodes.filter(n=>n.attachTo===target);
  if(carried.some(n=>evaluateVectorPart(n.id,scene,timeMs,n.opacity??1).opacity>0))return 1;
  const tracks=scene.vectorScene!.tracks.filter(t=>t.target===target);
  if(tracks.some(t=>t.frames.some(f=>f.opacity!==undefined)))return evaluateVectorPart(target,scene,timeMs,0).opacity;
  let opacity=0;
  for(const track of tracks){
    if(!(['dx','dy','rotation','scaleX','scaleY'] as const).some(key=>{
      const values=track.frames.filter(f=>f[key]!==undefined).map(f=>f[key]);return new Set(values).size>1;
    }))continue;
    const {start,end}=vectorTrackTiming(track,scene),fade=Math.min(80,(end-start)/4);
    if(timeMs>=start&&timeMs<=end)opacity=Math.max(opacity,Math.min(1,(timeMs-start)/fade,(end-timeMs)/fade));
  }
  return opacity;
}

/** Newly drawn village puppets omit an idle mouth, like the reference cutouts.
 * Both renderers share measured per-speaker speech and authored emotion. Older
 * expanded assets lack the marker and keep their existing appearance. */
export function puppetMouthState(target:string,rig:VectorDrawing,scene:CanvasStudioScene,timeMs:number){
  if(!rig.nodes.some(n=>n.id==='village-mouth-cued'))return {};
  const mouth=rig.nodes.find(n=>n.id==='mouth')!;
  const state=evaluateVectorPart(target,scene,timeMs,mouth.opacity??1);
  const actorId=target.split('/')[0]!,actor=scene.vectorScene!.nodes.find(n=>n.id===actorId);
  const object=scene.objects?.find(n=>n.id===actorId&&n.kind==='character');
  const identity={characterKey:actor?.characterKey||object?.characterKey||actorId,label:object?.label||actorId};
  const acting=rig.nodes.some(n=>n.id==='village-mouth-emotion')
    ||state.d!==undefined&&state.d!==mouth.d
    ||Math.abs(state.scaleX-1)>.02||Math.abs(state.scaleY-1)>.02
    ||Math.abs(state.dx)>.02||Math.abs(state.dy)>.02||Math.abs(state.rotation)>.02;
  if(acting)return {opacity:state.opacity};
  if(isCanvasActorSpeaking(scene,identity,timeMs)!==true)return {opacity:0};
  // Narration has no actor identity. Only this speaker's own measured windows
  // drive the mouth; do not use mixed music/foley energy for background people.
  const measured=canvasActorSpeechLevel(scene,identity,timeMs);
  if(measured!==undefined&&measured<=.03)return {opacity:0};
  const level=measured??(.5+.5*Math.sin(timeMs/1000*Math.PI*8));
  if(level<.2)return {opacity:state.opacity};
  const ry=Number((1+Math.min(1,Math.max(0,level))*3).toFixed(2));
  return {opacity:state.opacity,d:`M 0 ${-ry} A 3.8 ${ry} 0 1 0 0 ${ry} A 3.8 ${ry} 0 1 0 0 ${-ry} Z`,fill:mouth.stroke||'#141313'};
}

/** Compact cutout travel. The route advances independently of the linked
 * silhouette's step rhythm, and both settle at the destination. */
export function vectorPuppetTravelTracks(actor:string,asset:VectorDrawing,distance:number,timing:Pick<VectorTrack,'start'|'end'|'cue'>,hold=false):VectorTrack[]{
  const sign=Math.sign(distance);
  const parts=['upper-body','head-group'].filter(id=>asset.nodes.some(n=>n.id===id));
  if(asset.nodes.some(n=>n.id==='handdrawn-finish')){
    // Measured TRUE travel at 01:58 in the supplied reference: forward
    // progress + alternating whole-cutout roll, two small lifts per sway.
    // 04:11 is a camera move on a held pose, not evidence of a walking cycle.
    // Distance is in native rig pixels, so a small background actor does not
    // take more steps merely because its scene/world uses a different scale.
    const cycles=Math.max(1,Math.min(6,Math.ceil(Math.abs(distance)/85)));
    const keys=new Set([0,.05,.95,1]);
    for(let i=0;i<=cycles*4;i++)keys.add(i/(cycles*4));
    const amplitude=Math.min(1,Math.abs(distance)/40);
    return parts.map(part=>({target:actor+'/'+part,...timing,frames:hold?[{t:0,rotation:0,...(part==='upper-body'?{dy:0}:{})}]:
      [...keys].sort((a,b)=>a-b).map((t):VectorFrame=>{
        if(t===0||t===1)return {t,rotation:0,...(part==='upper-body'?{dy:0}:{}),easing:'smooth'};
        const envelope=Math.max(0,Math.min(1,t/.08,(1-t)/.08))*amplitude;
        const sway=Math.sin(t*cycles*2*Math.PI);
        // Head, clothes and occupied hands inherit the SAME body movement.
        // No independent counter-bobbing head, scale pulse, or idle loop.
        return {t,rotation:part==='upper-body'?sign*2.8*sway*envelope:0,
          ...(part==='upper-body'?{dy:-4.5*sway*sway*envelope}:{}),easing:'smooth'};
      })}));
  }
  const cycles=Math.max(1,Math.min(4,Math.ceil(Math.abs(distance)/65))),steps=cycles*6+4;
  return parts.map(part=>({target:actor+'/'+part,...timing,frames:hold?[{t:0,rotation:0}]:Array.from({length:steps+1},(_,i):VectorFrame=>{
    const t=i/steps,envelope=Math.sin(Math.PI*Math.min(1,t/.14)/2)*Math.sin(Math.PI*Math.min(1,(1-t)/.18)/2);
    const phase=t*cycles*2*Math.PI;
    const rotation=part==='upper-body'?envelope*(sign*.8+Math.sin(phase)*.65):
      envelope*(-sign*.35-Math.sin(phase-.45)*.35);
    return {t,rotation:i===0||i===steps?0:rotation,easing:'smooth'};
  })}));
}

/** Pair eyes on the continuous film clock for BOTH legacy puppets and new
 * articulated folk-chibi rigs. Never add an idle arm/head wobble or overwrite
 * deliberately animated eye-closing tracks. */
export function puppetBlinkTracks(scene:CanvasStudioScene,assets:Record<string,VectorDrawing>,elapsedMs:number):VectorTrack[]{
  const tracks:VectorTrack[]=[];
  for(const node of scene.vectorScene!.nodes){
    if(node.type!=='instance')continue;
    const rig=assets[node.asset!];
    const puppet=rig?.nodes.some(n=>n.id==='blink'&&n.parent==='head-group');
    const folkChibi=rig?.nodes.some(n=>n.id==='folk-collar')&&rig.nodes.some(n=>n.id==='eyes'&&n.parent==='head-group');
    if(!puppet&&!folkChibi)continue;
    const target=node.id+'/'+(puppet?'blink':'eyes');
    if(scene.vectorScene!.tracks.some(t=>t.target===target&&t.frames.some(f=>f.scaleY!==undefined)))continue;
    // Background cast keep a stable individual phase across cuts; a whole
    // village blinking on the same frame reads as synchronized puppets.
    const phase=node.groundOffsetY===undefined?0:[...node.id].reduce((h,c)=>(h*31+c.charCodeAt(0))%1200,0);
    for(let at=1800+phase,index=0;at<elapsedMs+scene.durationMs;at+=[4100,3700,4600][index++%3]!){
      const start=at-elapsedMs,end=start+180;
      if(start<0||end>scene.durationMs)continue;
      tracks.push({target,start:start/scene.durationMs,end:end/scene.durationMs,frames:[
        {t:0,scaleY:1,easing:'smooth'},{t:.4,scaleY:.08,easing:'smooth'},{t:1,scaleY:1,easing:'smooth'},
      ]});
    }
  }
  return tracks;
}
