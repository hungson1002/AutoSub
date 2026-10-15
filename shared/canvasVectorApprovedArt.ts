import approved from './assets/folk-approved/character.json';
import approvedWoman from './assets/folk-approved/woman/character.json';
import type {VectorDrawing,VectorNode} from './canvasVectorScene';
import {APPROVED_FOLK_STYLE,FOLK_INK_STYLE,folkInkPalette,handInkPath} from './canvasVectorInk';

export const approvedFolkSourceHash=approved.sourceSha256;
export const approvedFolkWomanSourceHash=approvedWoman.sourceSha256;

/** The user-approved SVG, on the existing cutout motion/contact tree. This is
 * an asset factory, not a second illustrator. No model can change its anatomy. */
export function approvedFolkPuppet(raw:Record<string,unknown>):VectorDrawing{
  const age=raw.age??'adult',gender=raw.gender??'male',expression=raw.expression??'neutral';
  const femaleSheet=gender==='female'&&age!=='child',sheet=femaleSheet?approvedWoman:approved;
  const hair=raw.hair??(femaleSheet?'bun':'short'),headwear=raw.headwear??(femaleSheet?'none':'headwrap'),facialHair=raw.facialHair??(femaleSheet?'none':'stubble');
  const validate=(value:unknown,allowed:string[],label:string)=>{
    if(!allowed.includes(String(value)))throw new Error('Vector: invalid approved '+label);
  };
  validate(age,['child','adult','elder'],'age');validate(gender,['male','female','neutral'],'gender');
  validate(expression,['neutral','soft','worried','surprised'],'expression');
  validate(hair,['short','side-part','bun','long','tied','none','tuft','braid','double-bun','cropped','wavy','bob','fringe'],'hair');
  validate(headwear,['none','headscarf','conical','headwrap'],'headwear');
  validate(facialHair,['none','stubble','moustache','beard'],'facial hair');
  if(raw.outfit!==undefined)validate(raw.outfit,['robe','tunic','ao-dai','vest','shawl','work-shirt','cross-collar','apron'],'outfit');
  const costumeDetail=raw.costumeDetail??'plain';validate(costumeDetail,['plain','patch','roundel','piping','sash'],'costume detail');
  if(raw.castRole!==undefined)validate(raw.castRole,['lead','support'],'cast role');
  if(raw.glasses!==undefined&&typeof raw.glasses!=='boolean')throw new Error('Vector: invalid approved glasses');
  const palette=folkInkPalette(raw.palette,femaleSheet);
  const shade=(source:string,base:string,target:string)=>'#'+[1,3,5].map(i=>Math.max(0,Math.min(255,
    parseInt(source.slice(i,i+2),16)-parseInt(base.slice(i,i+2),16)+parseInt(target.slice(i,i+2),16))).toString(16).padStart(2,'0')).join('');
  const tones:Record<string,string>={
    '#0e0c0b':palette.ink!,'#e7bfa3':palette.skin!,'#343d60':palette.shirt!,
    '#2b3251':shade('#2b3251','#343d60',palette.shirt!),'#252b45':shade('#252b45','#343d60',palette.shirt!),'#25283d':palette.skirt!,
    '#18171d':palette.hair!,'#242633':shade('#242633','#18171d',palette.hair!),'#1d1f2b':shade('#1d1f2b','#18171d',palette.hair!),
    '#9c783e':palette.accent!,'#e1d1ac':palette.inner!,'#c7c0a3':palette.trim!,
  };
  if(femaleSheet)Object.assign(tones,{'#f2d8ce':palette.skin,'#654958':palette.shirt,
    '#4e3b49':shade('#4e3b49','#654958',palette.shirt!),'#28272d':palette.skirt});
  // The source cheek fold was imported as age-lines. It is a design detail,
  // not facial anatomy, and must not become a fixed mark on every new person.
  const nodes=(structuredClone(sheet.drawing.nodes) as VectorNode[])
    .filter(n=>n.parent!=='age-lines').map(n=>{
    if(n.fill&&tones[n.fill])n.fill=tones[n.fill];
    if(n.stroke&&tones[n.stroke])n.stroke=tones[n.stroke];
    return n;
  });
  const by=(id:string)=>nodes.find(n=>n.id===id)!;
  const fear=by('approved-fear-mouth'),mouth=by('mouth');
  if(expression==='worried'){
    mouth.d=fear.d;mouth.fill=palette.ink;mouth.stroke='none';
    nodes.push({id:'village-mouth-emotion',type:'group',parent:'puppet-root'});
  }else{
    for(const side of ['l','r']){
      const brow=by('brow-'+side),at=nodes.indexOf(brow),prefix='brow-'+side+'-ink-';
      for(let i=nodes.length-1;i>=0;i--)if(nodes[i]!.id.startsWith(prefix))nodes.splice(i,1);
      nodes.splice(at+1,0,{...sheet.neutralBrows[side==='l'?0:1] as VectorNode,
        id:prefix+'0',parent:brow.id,stroke:palette.ink,strokeWidth:3});
    }
    if(expression==='surprised')nodes.push({id:'village-mouth-emotion',type:'group',parent:'puppet-root'});
  }
  // Replacing a selection replaces its painted geometry. Recoloring the cap
  // as hair left every no-hat character wearing the same headwrap and tie.
  const replacePaint=(group:string,paint:VectorNode[])=>{
    for(let i=nodes.length-1;i>=0;i--)if(nodes[i]!.parent===group)nodes.splice(i,1);
    nodes.splice(nodes.findIndex(n=>n.id===group)+1,0,...paint);
  };
  const hairPath=(id:string,parent:string,d:string):VectorNode=>({id,type:'path',parent,d,fill:palette.hair,stroke:palette.ink,strokeWidth:5.1});
  const eyeShape=raw.eyeShape??'round';validate(eyeShape,['round','half-lidded'],'eye shape');
  if(eyeShape==='half-lidded'){
    for(const side of ['l','r']){
      const eye=by('eye-'+side),x=eye.x!,y=eye.y!;
      replacePaint('eye-white-'+side,[{id:'approved-half-eye-'+side,type:'path',parent:'eye-white-'+side,
        d:`M ${x-10} ${y-5} Q ${x} ${y-4} ${x+10} ${y-5} Q ${x+10} ${y+8} ${x} ${y+8} Q ${x-10} ${y+8} ${x-10} ${y-5} Z`,
        fill:'#fff3da',stroke:palette.ink,strokeWidth:3.8}]);
      eye.y=y+1.5;
      if(!femaleSheet)by('brow-'+side).y!+=7;
    }
    by('blink').pivotY=by('eyes').pivotY=by('eye-l').y;
    if(femaleSheet){
      const left=by('eye-l'),right=by('eye-r'),y=left.y!-6.5;
      replacePaint('eyelashes',[{id:'approved-half-lashes',parent:'eyelashes',type:'path',
        d:`M ${left.x!-10} ${y} l -4 -3 M ${left.x!-7} ${y} l -2 -4 M ${right.x!+10} ${y} l 4 -3 M ${right.x!+7} ${y} l 2 -4`,
        fill:'none',stroke:palette.ink,strokeWidth:2.4}]);
    }
  }
  // Keep the authored ink contour and round chin. The old replacement jaws
  // pulled oval faces to a point and discarded the source's filled outline.
  const faceShape=['oval','broad'].includes(String(raw.faceShape))?String(raw.faceShape):'round';
  if(faceShape!=='round'&&!femaleSheet){
    const reshape=(d:string)=>d.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g,(_pair,sx,sy)=>{
      const x=Number(sx),y=Number(sy),w=Math.max(0,Math.min(1,(y-10)/45));
      const nx=6+(x-6)*(1+w*(faceShape==='oval'?-.025:.035)),ny=y+w*(faceShape==='oval'?3:0);
      return `${Number(nx.toFixed(3))} ${Number(ny.toFixed(3))}`;
    });
    for(const n of nodes)if(n.parent==='face'&&n.d)n.d=reshape(n.d);
  }
  const jaw=()=>{
    const face=by('face-ink-0').d!,start=face.indexOf('C 76');
    // Broad/oval contours retain the authored commands, but their coordinates
    // change. The jaw begins after the source's final forehead L command.
    const at=start>=0?start:face.indexOf(' C ',face.lastIndexOf(' L '));
    if(at<0)throw new Error('Vector: approved face has no jaw contour');
    return face.slice(at).trim();
  };
  // Only the male sheet already contains a headwrap. Treat women's wraps as
  // a real selected garment too, instead of retaining their default top bun.
  if(headwear!=='headwrap'||femaleSheet){
    replacePaint('headwear',headwear==='none'?[]:[{
      id:'approved-'+headwear,type:'path',parent:'headwear',fill:palette.headwear??(headwear==='headwrap'?'#242633':palette.accent),stroke:palette.ink,strokeWidth:5.1,
      d:headwear==='conical'?'M -102 -29 Q -57 -57 -4 -95 Q 41 -67 91 -27 Q 40 -12 -5 -17 Q -59 -17 -102 -29 Z'
        :femaleSheet?'M -76 17 C -80 -13 -61 -39 -34 -48 Q -6 -60 24 -44 C 48 -36 69 -14 74 9 L 73 22 Q 42 7 9 -9 Q -9 -12 -27 -3 Q -45 7 -55 23 L -59 30 Q -65 14 -76 17 Z'
        :'M -77 -1 C -80 -27 -61 -51 -33 -61 Q -4 -72 25 -56 C 48 -46 65 -27 69 -5 L 58 3 Q 30 -18 0 -23 Q -29 -24 -54 -4 L -59 12 Q -66 -5 -77 -1 Z',
    },...(femaleSheet&&headwear==='headwrap'?[{id:'approved-wrap-folds',type:'path' as const,parent:'headwear',
      d:'M -59 -28 Q -58 -18 -48 -10 M -36 -45 L -30 -25 M -8 -49 L -7 -26 M 22 -42 L 16 -22 M 48 -25 L 34 -10',
      fill:'none',stroke:'#686579',strokeWidth:2.5}]:[])]);
    // The source hair-back includes the headwrap knot. It is not a bun.
    if(!(femaleSheet&&hair==='bun'))replacePaint('hair-back',[hairPath('hair-back-ink-0','hair-back',
      'M -76 -13 C -82 0 -84 24 -77 41 Q -72 54 -59 51 L -46 18 L -50 -35 Q -64 -32 -76 -13 Z')]);
    const cap=nodes.findIndex(n=>n.id==='rear-head-art-3');if(cap>=0)nodes.splice(cap,1);
    by('rear-hair').d=by('hair-back-ink-0').d;
  }
  const accessory:VectorNode[]=[];
  if(hair==='bun'&&!femaleSheet||hair==='double-bun'){
    const femalePair=femaleSheet&&hair==='double-bun';
    for(const x of hair==='double-bun'?(femalePair?[-50,47]:[-68,65]):[-54])accessory.push({id:'approved-bun-'+(x<0?'l':'r'),type:'ellipse',parent:'head-group',x,y:femalePair?-38:hair==='bun'?-59:-53,rx:femalePair||hair==='bun'?18:21,ry:femalePair||hair==='bun'?18:20,fill:palette.hair,stroke:palette.ink,strokeWidth:5.1});
  }
  if(hair==='tuft')accessory.push(hairPath('approved-hair-length','head-group',
    'M -22 -64 C -17 -76 -20 -86 -15 -93 Q -4 -88 -2 -77 Q 5 -90 12 -83 Q 18 -72 4 -65 Q -8 -61 -22 -64 Z'));
  if(['long','bob','braid','tied'].includes(String(hair)))accessory.push({id:'approved-hair-length',type:'path',parent:'head-group',
    d:hair==='braid'?'M -65 28 Q -79 40 -67 49 Q -78 58 -67 68 Q -77 78 -66 87 Q -77 97 -65 106 Q -76 117 -64 126 L -60 146 L -54 126 Q -44 116 -54 106 Q -44 97 -55 87 Q -45 77 -55 68 Q -46 58 -56 49 Q -48 39 -56 29 Z'
      :hair==='tied'?'M -72 -2 Q -96 11 -81 44 Q -70 61 -65 63 Q -73 37 -58 19 Z'
      :hair==='bob'?'M -76 -6 Q -84 25 -78 61 Q -67 66 -58 58 L -55 10 L 57 8 L 60 58 Q 72 62 79 54 Q 84 24 74 -6 Z'
      :'M -76 -6 Q -85 26 -78 103 Q -68 112 -58 109 L -55 10 L 57 8 L 60 108 Q 72 110 79 101 Q 85 26 74 -6 Z',fill:palette.hair,stroke:palette.ink,strokeWidth:5.1});
  if(accessory.length)nodes.splice(nodes.findIndex(n=>n.id==='hair-back'),0,...accessory);
  if(['side-part','wavy','cropped'].includes(String(hair))){
    const d=hair==='side-part'
      ?'M -77 1 Q -83 -27 -63 -48 C -46 -66 -14 -75 12 -67 Q 30 -76 47 -54 Q 68 -38 68 -4 L 55 -9 Q 48 -17 24 -24 Q 6 -28 -5 -20 Q -30 -7 -55 1 L -57 12 Q -63 -7 -77 1 Z'
      :hair==='wavy'?'M -77 2 Q -85 -11 -76 -26 Q -81 -41 -63 -47 Q -58 -66 -38 -62 Q -21 -77 -3 -67 Q 15 -75 31 -62 Q 50 -66 56 -47 Q 75 -39 67 -19 L 69 -3 Q 54 -4 48 -19 Q 33 -12 23 -27 Q 5 -17 -8 -28 Q -28 -12 -47 -14 L -55 11 Q -64 -6 -77 2 Z'
      :'M -77 1 Q -82 -21 -66 -39 Q -47 -61 -15 -64 Q 18 -68 45 -49 Q 64 -35 67 -8 L 55 -13 Q 28 -28 -2 -26 Q -28 -26 -53 -7 L -57 10 Q -65 -7 -77 1 Z';
    replacePaint('hair',[hairPath('approved-hair-fringe','hair',d)]);
    by('rear-head-art-2').d=d;
  }
  // Under-wrap hair is not a complete uncovered haircut. New male no-hat
  // styles share one rounded cranium and connect at the actual ear/temple,
  // with only the fringe changing. The approved wrapped source stays exact.
  let uncoveredHairOuter:string|undefined;
  if(!femaleSheet&&['none','conical'].includes(String(headwear))&&!['none','tuft'].includes(String(hair))){
    const outer=hair==='cropped'
      ?'M -77 3 C -81 -23 -61 -53 -30 -61 C 2 -71 38 -60 60 -40 C 76 -24 80 -9 76 10 '
      :hair==='wavy'?'M -77 3 Q -84 -12 -76 -25 Q -76 -46 -55 -52 Q -39 -70 -20 -64 Q 0 -76 20 -63 Q 42 -66 55 -47 Q 75 -36 74 -18 Q 81 -5 76 10 '
      :'M -77 3 C -82 -28 -62 -58 -30 -66 C 2 -77 39 -64 60 -44 C 76 -28 80 -12 76 10 ';
    const fringe=hair==='side-part'
      ?'L 68 17 L 64 -2 Q 42 -9 19 -25 Q 6 -31 -8 -20 Q -30 -5 -55 1 L -57 12 Q -61 -7 -70 -5 Q -78 -5 -77 3 Z'
      :hair==='wavy'?'L 68 17 L 64 -2 Q 49 -2 38 -13 Q 21 -8 10 -22 Q -5 -15 -18 -23 Q -36 -15 -55 1 L -57 12 Q -61 -7 -70 -5 Q -78 -5 -77 3 Z'
      :hair==='fringe'?'L 68 17 L 62 -8 L 47 -11 L 41 -23 L 31 -12 L 17 -14 L 10 -25 L 1 -14 L -15 -14 L -23 -23 L -30 -12 L -51 -8 L -57 12 Q -61 -7 -70 -5 Q -78 -5 -77 3 Z'
      :'L 68 17 L 64 -2 Q 43 -18 19 -23 Q -7 -29 -28 -19 Q -43 -13 -55 1 L -57 12 Q -61 -7 -70 -5 Q -78 -5 -77 3 Z';
    uncoveredHairOuter=outer;
    replacePaint('hair',[hairPath('approved-hair-fringe','hair',outer+fringe)]);
    replacePaint('hair-back',[hairPath('hair-back-ink-0','hair-back',
      'M -75 -7 C -83 10 -79 34 -67 43 Q -62 47 -54 44 L -49 22 L -52 -24 Z')]);
    by('rear-hair').d=by('hair-back-ink-0').d;
  }
  // Women's variants use their own skull and ear, not the male cap stretched
  // over the female sheet. New fringes stay clear of the native eye line.
  if(femaleSheet&&['none','conical'].includes(String(headwear))&&['side-part','wavy','cropped','short','fringe'].includes(String(hair))){
    uncoveredHairOuter=hair==='wavy'
      ?'M -77 17 Q -83 -6 -71 -24 Q -66 -42 -46 -43 Q -29 -58 -10 -53 Q 11 -59 29 -45 Q 49 -43 62 -26 Q 79 -10 77 17 '
      :'M -77 17 C -83 -11 -62 -40 -33 -49 C -3 -61 31 -47 53 -27 C 71 -13 79 1 77 17 ';
    const fringe=hair==='fringe'
      ?'L 69 28 L 65 8 L 48 2 L 41 -9 L 31 1 L 18 0 L 10 -11 L 0 0 L -14 1 L -22 -8 L -31 2 L -50 12 L -55 25 Q -61 9 -69 10 Q -76 11 -77 17 Z'
      :hair==='wavy'?'L 69 28 L 65 8 Q 49 12 39 -1 Q 23 3 12 -10 Q -4 -4 -17 -11 Q -37 -2 -50 12 L -55 25 Q -61 9 -69 10 Q -76 11 -77 17 Z'
      :'L 69 28 L 65 8 Q 43 -1 18 -15 Q 7 -21 -7 -10 Q -29 7 -50 12 L -55 25 Q -61 9 -69 10 Q -76 11 -77 17 Z';
    replacePaint('hair',[hairPath('approved-hair-fringe','hair',uncoveredHairOuter+fringe)]);
  }
  if(hair==='none'||hair==='tuft'){
    by('hair').opacity=0;by('hair-back').opacity=0;by('rear-hair').opacity=0;by('rear-head-art-2').opacity=0;
    if(headwear==='none'){
      const scalp=age==='child'
        ?'M -66 12 C -78 -12 -60 -53 -29 -62 C -3 -74 36 -63 58 -43 C 76 -28 82 -3 75 24 C 68 57 40 82 7 86 C -25 88 -54 73 -65 49 Q -73 30 -66 12 Z'
        :(femaleSheet?'M -55 15 C -77 -7 -60 -54 -10 -57 C 34 -63 74 -33 73 9 '
        :'M -55 1 C -80 -27 -60 -65 -10 -66 C 35 -72 76 -39 73 -5 ')+jaw();
      replacePaint('face',[{id:'face-ink-0',type:'path',parent:'face',d:scalp,fill:palette.skin,stroke:palette.ink,strokeWidth:5.1}]);
    }
  }
  // Rear silhouettes must follow the selected hair/hat too. Original approved
  // short hair + headwrap is left byte-for-byte unchanged.
  const rearAccessories=accessory.map(n=>({...n,id:'rear-'+n.id,parent:'rear-head'}));
  nodes.splice(nodes.findIndex(n=>n.id==='rear-head')+1,0,...rearAccessories);
  if(headwear!=='headwrap'||femaleSheet)nodes.splice(nodes.findIndex(n=>n.id==='rear-head-art-2')+1,0,
    ...nodes.filter(n=>n.parent==='headwear').map(n=>({...n,id:'rear-'+n.id,parent:'rear-head',
      ...(n.id==='approved-'+headwear&&(headwear==='headscarf'||headwear==='headwrap')?{d:femaleSheet
        ?'M -76 17 C -80 -13 -61 -39 -34 -48 Q -6 -60 24 -44 C 48 -36 69 -14 74 9 L 73 37 Q 63 61 11 64 Q -38 64 -58 43 Z'
        :'M -77 -1 C -80 -27 -61 -51 -33 -61 Q -4 -72 25 -56 C 48 -46 65 -27 69 -5 L 68 30 Q 31 51 -14 45 Q -51 39 -70 20 Z'}
        :n.id==='approved-wrap-folds'?{d:'M -59 -24 Q -50 -15 -47 -4 M -35 -43 L -27 -21 M -5 -48 L -5 -25 M 24 -37 L 19 -16 M 50 -17 L 37 1'}:{})})));
  // A back view is one continuous skull contour. Painting the front fringe
  // over the jaw left a second face-shaped seam on the back of every head.
  by('rear-head-art-2').opacity=0;
  by('rear-head-art-1').d=uncoveredHairOuter
    ?uncoveredHairOuter+'C 79 35 67 61 48 74 Q 24 90 -2 86 C -35 86 -63 67 -72 43 Q -80 22 -77 3 Z'
    :femaleSheet?'M -76 14 C -82 -15 -60 -42 -32 -49 C -3 -61 29 -45 51 -28 C 74 -10 81 17 73 43 C 65 67 43 84 13 87 C -16 90 -48 77 -63 58 Q -78 39 -76 14 Z'
      :'M -77 1 C -81 -32 -51 -63 -17 -66 C 21 -74 61 -52 72 -20 C 82 9 74 45 55 66 Q 31 89 1 86 C -32 86 -60 68 -70 44 Q -79 22 -77 1 Z';
  by('rear-head-art-1').fill=['none','tuft'].includes(String(hair))?palette.skin:palette.hair;
  if(uncoveredHairOuter)by('rear-hair').opacity=0;
  if(headwear==='headwrap'&&nodes.some(n=>n.id==='rear-head-art-3'))by('rear-head-art-3').d=
    'M -77 -2 Q -78 -21 -69 -36 C -61 -52 -45 -62 -27 -64 C -7 -69 20 -65 39 -56 Q 61 -45 65 -24 L 68 -2 Q 35 12 -5 9 Q -45 8 -77 -2 Z';
  if(palette.headwear&&headwear==='headwrap'){
    for(const n of nodes)if(n.parent==='headwear'&&n.fill&&n.fill!==palette.ink&&n.fill!=='none')n.fill=palette.headwear;
    if(nodes.some(n=>n.id==='rear-head-art-3'))by('rear-head-art-3').fill=palette.headwear;
  }
  // A costume selects a complete garment, not a decorative line on the same
  // blue tunic. The source tunic remains the exact accepted default.
  const outfit=raw.outfit??'tunic';
  const female=gender==='female'&&age!=='child';
  const garment=(id:string,parent:string,d:string,fill:string,width=3):VectorNode=>({id,type:'path',parent,
    d:handInkPath(d,id),fill,stroke:palette.ink,strokeWidth:width});
  const silhouettes:Record<string,string>={
    robe:'M 67 173 Q 96 178 132 168 C 137 188 135 212 139 241 Q 145 286 157 331 Q 160 343 145 344 Q 100 339 57 345 Q 42 344 47 330 C 54 290 52 255 57 219 Q 59 191 67 173 Z',
    'ao-dai':female
      ?'M 67 173 Q 98 178 132 168 C 139 178 145 193 144 207 Q 142 221 135 233 Q 136 272 151 330 Q 154 342 140 343 L 61 344 Q 47 343 50 330 Q 61 270 57 231 Q 55 199 67 173 Z'
      :'M 67 173 Q 98 178 132 168 Q 138 190 137 219 Q 139 275 150 331 Q 152 343 137 343 L 60 344 Q 47 343 50 330 Q 57 278 56 229 Q 56 196 67 173 Z',
    vest:'M 66 173 Q 96 179 133 169 Q 139 199 138 230 L 147 332 Q 149 344 135 344 L 60 344 Q 46 344 49 331 L 56 230 Q 56 197 66 173 Z',
    shawl:'M 65 174 Q 96 180 131 169 Q 139 191 138 223 Q 138 275 150 331 Q 152 343 137 344 L 59 344 Q 46 343 49 331 Q 57 274 55 227 Q 54 196 65 174 Z',
    'work-shirt':'M 66 174 Q 97 181 133 170 Q 141 191 140 226 L 143 272 L 142 332 Q 143 343 132 344 L 62 344 Q 50 343 51 331 L 55 272 L 56 222 Q 56 192 66 174 Z',
    'cross-collar':'M 66 175 Q 96 182 132 171 Q 142 191 139 220 L 134 251 Q 142 285 151 332 Q 153 344 139 344 L 61 345 Q 47 343 50 331 Q 57 286 58 252 L 55 221 Q 55 193 66 175 Z',
    apron:'M 66 173 Q 97 181 133 170 Q 142 193 138 225 L 145 282 L 148 333 Q 149 344 135 344 L 60 344 Q 48 343 50 331 L 54 282 L 56 224 Q 55 194 66 173 Z',
  };
  const body=String(outfit)==='tunic'&&female&&!femaleSheet
    ?'M 67 173 Q 98 178 132 168 C 139 179 145 194 143 207 Q 139 222 134 235 Q 139 286 150 325 Q 154 337 144 341 Q 100 340 62 343 Q 48 343 50 331 Q 57 281 56 238 Q 55 197 67 173 Z'
    :silhouettes[String(outfit)];
  if(body)replacePaint('torso',[garment('torso-ink-0','torso',body,outfit==='vest'?palette.inner!:palette.shirt!,5.1),
    garment('approved-body-shade','torso','M 63 185 Q 59 258 53 333 Q 59 336 63 333 Q 67 257 72 182 Z',outfit==='vest'?palette.trim!:tones['#2b3251']!,0.5)]);
  if(outfit!=='tunic'){
    const c=(id:string,d:string,fill='none',width=2.8)=>garment('approved-'+id,'costume',d,fill,width);
    const clothing:VectorNode[]=outfit==='robe'?[
      c('wrap-collar','M 72 175 Q 85 184 99 200 L 128 173 L 132 184 L 101 221 Q 87 204 67 185 Z',palette.inner!),
      c('wrap-seam','M 128 184 Q 119 215 100 234 Q 97 280 101 336'),
      c('sash','M 57 236 Q 97 243 139 234 L 140 249 Q 99 258 56 250 Z',palette.accent!),
      c('robe-folds','M 76 267 Q 72 299 69 331 M 126 271 Q 132 307 137 332','none',1.8),
    ]:outfit==='ao-dai'?[
      c('standing-collar','M 83 173 Q 103 176 124 171 L 126 184 Q 104 192 82 185 Z',palette.inner!),
      c('ao-seam','M 124 184 Q 134 192 134 210 Q 128 256 132 329'),
      c('ao-slit','M 60 274 Q 69 302 67 337 M 139 277 Q 132 308 135 338','none',2.2),
      ...[197,216,236].map((y,i):VectorNode=>({id:'approved-fastener-'+i,type:'ellipse',parent:'costume',x:132-i,y,rx:2.4,ry:2.4,fill:palette.trim})),
      c('ao-hem','M 65 330 Q 100 335 136 330','none',1.7),
    ]:outfit==='vest'?[
      c('vest-left','M 66 174 Q 78 177 86 181 L 92 211 L 86 271 Q 69 277 55 269 L 57 220 Q 57 191 66 174 Z',palette.shirt!),
      c('vest-right','M 118 176 L 133 169 Q 140 197 138 231 L 141 269 Q 122 276 105 271 L 105 210 Z',palette.shirt!),
      c('vest-neck','M 86 181 Q 104 195 118 176'),
      c('waistband','M 54 277 Q 100 283 141 275 L 142 287 Q 100 295 53 288 Z',palette.accent!),
      c('lower-garment','M 53 291 Q 101 299 143 290 L 147 332 Q 148 342 134 343 L 59 343 Q 48 341 50 331 Z',palette.skirt!),
      c('vest-pocket','M 113 239 Q 124 241 135 237 L 134 251 Q 125 257 115 253 Z',palette.shirt!,1.8),
    ]:outfit==='work-shirt'?[
      c('work-trousers','M 55 270 Q 99 279 143 270 L 145 333 Q 145 344 133 344 L 61 344 Q 50 343 51 332 Z',palette.skirt!),
      c('work-shirt-hem','M 55 265 Q 98 273 141 265 L 143 279 Q 98 287 54 278 Z',palette.shirt!),
      c('work-neck','M 80 177 L 97 196 L 117 177 L 120 189 L 99 211 L 76 190 Z',palette.inner!),
      c('work-placket','M 99 209 Q 96 236 98 273'),
      c('work-pocket','M 112 221 Q 124 223 136 219 L 135 241 Q 125 247 114 242 Z',palette.shirt!,1.9),
      ...[219,239,258].map((y,i):VectorNode=>({id:'approved-work-button-'+i,type:'ellipse',parent:'costume',x:98,y,rx:2,ry:2,fill:palette.trim})),
      c('trouser-fold','M 99 291 Q 97 312 99 334','none',1.8),
    ]:outfit==='cross-collar'?[
      c('cross-skirt','M 58 253 Q 97 263 135 253 L 151 333 Q 152 343 139 344 L 61 345 Q 47 343 50 331 Z',palette.skirt!),
      c('cross-blouse','M 66 175 Q 96 182 132 171 Q 142 191 139 221 L 134 260 Q 98 272 57 260 L 55 221 Q 55 193 66 175 Z',palette.shirt!,3.5),
      c('cross-collar','M 71 176 Q 96 199 132 177 L 135 191 Q 112 207 97 211 L 63 190 Z',palette.inner!),
      c('cross-seam','M 129 194 Q 104 215 71 233 L 65 260'),
      c('cross-knot','M 65 230 Q 71 222 77 231 Q 81 240 71 242 Q 63 239 65 230 Z',palette.accent!,2),
      c('skirt-folds','M 73 278 Q 67 309 65 332 M 124 280 Q 132 308 135 332','none',1.7),
    ]:outfit==='apron'?[
      c('apron-lower','M 54 281 Q 100 288 144 281 L 148 333 Q 149 344 135 344 L 60 344 Q 48 343 50 331 Z',palette.skirt!),
      c('apron-neck','M 80 177 Q 100 192 121 175','none',2.8),
      c('apron-strap-l','M 78 180 L 89 183 L 84 215 L 74 216 Z',palette.accent!,2),
      c('apron-strap-r','M 117 178 L 127 174 L 132 213 L 121 214 Z',palette.accent!,2),
      c('apron-bib','M 75 209 Q 100 216 131 207 L 133 248 Q 140 281 142 316 Q 103 329 57 318 Q 60 280 69 251 Z',palette.accent!,3.5),
      c('apron-waist','M 59 249 Q 100 258 139 247','none',2),
      c('apron-pocket','M 78 273 Q 104 278 127 271 L 125 292 Q 103 305 80 295 Z',palette.accent!,2),
    ]:[
      c('shawl-drape','M 64 174 Q 95 190 132 169 Q 139 188 139 205 Q 118 231 55 218 Q 56 190 64 174 Z',palette.accent!),
      c('shawl-fold','M 67 184 Q 91 206 135 189 M 64 198 Q 86 218 121 211','none',2),
      c('shawl-tail','M 116 212 Q 130 218 137 213 L 145 268 Q 134 276 124 270 Z',palette.accent!),
      c('skirt-band','M 54 281 Q 101 288 143 280 L 145 295 Q 101 304 53 295 Z',palette.trim!,2),
      c('shawl-hem','M 57 329 Q 101 338 142 329','none',1.8),
    ];
    replacePaint('costume',clothing);
    replacePaint('rear-costume',[
      garment('approved-rear-garment','rear-costume',body!,outfit==='vest'?palette.inner!:palette.shirt!,5.1),
      garment('rear-seam','rear-costume','M 99 191 Q 97 250 100 332','none',1.6),
      ...(outfit==='shawl'?[garment('approved-rear-shawl','rear-costume','M 64 174 Q 95 181 132 169 L 140 205 Q 104 226 55 214 Z',palette.accent!)]:[]),
      ...(outfit==='vest'?[garment('approved-rear-vest','rear-costume','M 66 174 Q 98 182 133 169 L 141 269 Q 99 280 55 269 Z',palette.shirt!),
        garment('approved-rear-lower','rear-costume','M 54 281 Q 100 290 142 280 L 147 332 Q 148 342 134 343 L 59 343 Q 48 341 50 331 Z',palette.skirt!)]:[]),
    ]);
  }
  if(age==='child'){
    for(const id of ['torso','costume','rear-costume'])Object.assign(by(id),{y:73,scaleY:.6});
    Object.assign(by('head-group'),{y:111,scaleX:.7,scaleY:.7});
  }
  if(costumeDetail!=='plain'){
    const detail=(id:string,d:string,fill='none',width=2.5)=>garment('approved-identity-'+id,'costume',d,fill,width);
    const paint:VectorNode[]=costumeDetail==='roundel'?[
      {id:'approved-identity-roundel',parent:'costume',type:'ellipse',x:103,y:222,rx:13,ry:14,fill:palette.accent,stroke:palette.ink,strokeWidth:2.7},
      detail('roundel-mark','M 98 218 Q 104 214 109 221 Q 104 228 98 224','none',1.8),
    ]:costumeDetail==='patch'?[
      detail('patch','M 65 247 L 83 244 L 86 264 L 67 267 Z',palette.trim!,2),
      detail('patch-stitches','M 69 245 L 70 249 M 78 244 L 79 248 M 68 264 L 69 268 M 79 262 L 80 266','none',1.4),
    ]:costumeDetail==='sash'?[
      detail('sash','M 124 177 L 134 182 Q 103 225 63 253 L 58 240 Q 94 216 124 177 Z',palette.accent!,2.8),
      detail('sash-tail','M 61 244 L 72 248 L 78 283 L 63 278 Z',palette.accent!,2),
    ]:[
      detail('piping','M 70 185 Q 58 230 58 276 M 64 327 Q 101 333 139 327','none',3),
      detail('clasp','M 119 193 Q 127 187 132 194 Q 130 202 122 201 Z',palette.accent!,2),
    ];
    const at=nodes.reduce((last,n,i)=>n.id==='costume'||n.parent==='costume'?i:last,0);
    nodes.splice(at+1,0,...paint);
  }
  if(gender==='female'||age==='child'||facialHair==='none')by('beard').opacity=0;
  else if(facialHair==='moustache'||facialHair==='beard')replacePaint('beard',[
    garment('approved-'+facialHair,'beard',facialHair==='moustache'
      ?'M 10 42 Q 18 35 24 40 Q 29 35 35 40 Q 39 46 46 45 Q 38 55 26 48 Q 14 54 7 49 Z'
      :'M 5 68 Q 19 75 35 66 Q 34 81 27 91 L 22 99 L 18 93 Q 9 87 5 68 Z',palette.hair!,2.8),
  ]);
  if(raw.glasses)nodes.splice(nodes.findIndex(n=>n.id==='rear-head'),0,
    {id:'glasses',type:'group',parent:'head-group'},
    ...['l','r'].map((side,i):VectorNode=>({id:'glasses-'+i,type:'ellipse',parent:'glasses',x:by('eye-'+side).x,y:by('eye-'+side).y,rx:15,ry:17,fill:'none',stroke:palette.ink,strokeWidth:2.7})),
    {id:'glasses-bridge',type:'path',parent:'glasses',d:`M ${by('eye-l').x!+15} ${by('eye-l').y!-1} Q 15 ${by('eye-l').y!-5} ${by('eye-r').x!-15} ${by('eye-r').y!-1}`,fill:'none',stroke:palette.ink,strokeWidth:2.7});
  // One front-paint layer keeps the whole front face/hair/accessories hidden
  // on a back turn without adding separate animation tracks for every part.
  // Clothes must be below the head in both views. A child's shortened torso
  // otherwise paints the rear shirt seam over the bottom of a bald head.
  const rearCostume=nodes.splice(nodes.findIndex(n=>n.id==='rear-costume'),1)[0]!;
  nodes.splice(nodes.findIndex(n=>n.id==='head-group'),0,rearCostume);
  nodes.splice(nodes.findIndex(n=>n.id==='head-group')+1,0,{id:'front-head',type:'group',parent:'head-group'});
  for(const n of nodes)if(n.parent==='head-group'&&n.id!=='front-head'&&n.id!=='rear-head')n.parent='front-head';
  nodes.push({id:FOLK_INK_STYLE,type:'group',parent:'puppet-root'},
    {id:'village-age-'+age,type:'group',parent:'puppet-root'},
    {id:'village-gender-'+gender,type:'group',parent:'puppet-root'});
  if(raw.castRole)nodes.push({id:'village-role-'+raw.castRole,type:'group',parent:'puppet-root'});
  if(!nodes.some(n=>n.id===APPROVED_FOLK_STYLE))throw new Error('Vector: approved SVG marker missing');
  return {width:180,height:280,nodes};
}
