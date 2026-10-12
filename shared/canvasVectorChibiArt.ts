import type {VectorDrawing,VectorNode} from './canvasVectorScene';

/** Versioned art pass over the established physical skeleton.
 * Keeps EVERY native contact point/joint coordinate unchanged. Existing
 * folk-chibi and simple-human projects retain their previous drawings. */
export function illustrateArticulatedChibi(drawing:VectorDrawing,palette:Record<string,unknown>,outfit:string,hairStyle:string):VectorDrawing {
  const nodes=drawing.nodes.map(n=>({...n}));
  const find=(id:string)=>{const p=nodes.find(n=>n.id===id);if(!p)throw new Error('Chibi: missing anatomical part '+id);return p;};
  const paint=(name:string,fallback:string)=>typeof palette[name]==='string'&&/^#[0-9a-f]{6}$/i.test(palette[name] as string)?palette[name] as string:fallback;
  const ink='#080808',skin=paint('skin','#ead2b3'),shirt=paint('shirt','#766455');
  const trim=paint('trim','#e5c8a9'),accent=paint('accent','#bd9873'),hair=paint('hair','#302829');
  const shade=paint('shade','#56463e'),pants=paint('pants','#4b4a44');
  const path=(id:string,parent:string,d:string,fill:string,stroke='none',strokeWidth=0):VectorNode=>({id,type:'path',parent,d,fill,stroke,strokeWidth});
  const ellipse=(id:string,parent:string,x:number,y:number,rx:number,ry:number,fill:string,stroke='none',strokeWidth=0):VectorNode=>({id,type:'ellipse',parent,x,y,rx,ry,fill,stroke,strokeWidth});
  // Explicit version marker, invisible and harmless in the renderer. Used to
  // protect these curved contours from the legacy straight-segment normalizer.
  nodes.unshift({id:'folk-art-v2',type:'group'});
  // Contact shadow lives in the actor's geometry, not at an arbitrary pixel
  // on the background. It follows the actor through a native walk or camera.
  nodes.splice(1,0,{id:'folk-ground-shadow',type:'ellipse',x:120,y:455,rx:57,ry:9,fill:'#182625',opacity:.22});
  const torso=find('torso');
  torso.d='M 81 185 Q 92 169 112 172 Q 135 166 154 176 Q 171 180 175 205 L 185 327 Q 188 350 171 359 Q 126 372 69 359 Q 54 350 57 331 L 65 210 Q 68 191 81 185 Z';
  torso.stroke=ink;torso.strokeWidth=3.2;
  const belt=find('belt');belt.opacity=0;
  const hem=find('tunic-hem');
  hem.d='M 62 339 Q 120 362 179 339 L 179 364 Q 126 380 65 365 Z';
  hem.fill=shade;hem.stroke=ink;hem.strokeWidth=2.2;
  const neck=find('neck');neck.fill=skin;
  // Garment is layered over the skeleton but DOES NOT replace articulated
  // shoulders/elbows: each arm keeps its original joint pivot and length.
  for(const side of ['l','r']){
    const sleeve=find('sleeve-'+side);
    sleeve.d=side==='l'?'M -3 -10 Q -18 -7 -20 12 Q -22 31 -15 55 Q 0 62 16 51 Q 22 33 15 12 Q 11 -7 -3 -10 Z':
      'M 3 -10 Q 20 -5 20 14 Q 22 36 16 55 Q 0 62 -15 52 Q -20 35 -16 14 Q -12 -8 3 -10 Z';
    sleeve.fill=shirt;sleeve.stroke=ink;sleeve.strokeWidth=2.5;
    const forearm=find('cuff-'+side);
    forearm.d='M -15 -6 Q -19 10 -17 26 L -13 45 Q -7 52 0 55 Q 9 54 13 45 L 17 25 Q 19 8 15 -6';
    forearm.fill='none';forearm.stroke=ink;forearm.strokeWidth=2.4;
    const hand=find('hand-'+side);hand.rx=12.5;hand.ry=11;hand.stroke=ink;hand.strokeWidth=2;
    // Soft fabric folds and colored cuffs are independent moving parts.
    nodes.push(path('folk-sleeve-fold-'+side,'arm-'+side,'M -10 13 Q -4 19 1 20 M 7 32 Q -2 38 -7 38','none',shade,1.35));
    nodes.push(path('folk-wrist-band-'+side,'forearm-'+side,'M -13 43 Q 0 49 13 43','none',trim,3));
    nodes.push(ellipse('folk-palm-shade-'+side,'forearm-'+side,3,60,4,4,accent));
    // Keep approved 55+55 joint lengths for the native planted walk solver.
    const thigh=find('thigh-'+side);
    thigh.d='M -13 -3 Q 0 -10 13 -3 L 12 54 Q 0 60 -12 54 Z';
    thigh.fill=pants;thigh.stroke=ink;thigh.strokeWidth=1.7;
    const shin=find('shin-'+side);
    shin.d='M -12 -4 Q -15 15 -11 34 L -10 56 Q 0 60 10 56 L 12 32 Q 15 12 12 -4';
    shin.fill=pants;shin.stroke=ink;shin.strokeWidth=1.8;
    const foot=find('foot-'+side);foot.rx=20;foot.ry=9;foot.fill='#4a3a31';foot.stroke=ink;foot.strokeWidth=1.8;
    nodes.push(path('folk-boot-detail-'+side,'knee-'+side,'M -8 49 Q 0 53 11 49 M -11 58 Q 7 64 21 58','none',trim,1.5));
  }
  // These details appear behind animated hands and head but on the same
  // articulated garment, so they never become floating scene accessories.
  nodes.push(path('folk-robe-shade','upper-body','M 157 186 Q 173 217 175 263 L 181 338 Q 165 359 137 364 Q 160 303 158 260 Z',shade));
  nodes.push(path('folk-front-panel','upper-body',outfit==='tunic'?
    'M 111 190 Q 122 196 129 189 L 135 352 Q 119 361 108 351 Z':
    'M 101 196 Q 113 212 136 219 L 150 350 Q 121 360 100 354 L 101 196 Z',shirt,ink,1.35));
  nodes.push(path('folk-pleat','upper-body','M 88 290 Q 84 322 90 353 M 146 280 Q 153 320 148 353','none',shade,1.6));
  nodes.push(path('folk-hem-line','upper-body','M 68 354 Q 120 370 172 353','none',trim,2.4));
  const sash=find('folk-sash');sash.fill=accent;sash.strokeWidth=2;
  const lapel=find('folk-lapel');lapel.strokeWidth=1.8;
  const head=find('head-group');head.scaleX=1.23;head.scaleY=1.33;
  const face=find('face');face.rx=54;face.ry=57;face.fill=skin;face.strokeWidth=3;
  const mouth=find('mouth');mouth.ry=2.5;mouth.rx=3.5;mouth.y=29;
  nodes.push(ellipse('folk-nose','head-group',0,17,3.5,2.1,'#b58c79'));
  nodes.push(path('folk-under-eye','head-group','M -32 9 Q -22 12 -12 9 M 12 9 Q 22 12 32 9','none','#ad8571',1.2));
  // Existing pupils stay bound to eyes group and eye-blink system.
  for(const side of ['l','r']){
    const eye=find('eye-'+side);eye.rx=5.7;eye.ry=7;
    nodes.push(ellipse('folk-eye-glint-'+side,'eyes',side==='l'?-18:-0+19,-6,1.8,2,'#fff8ec'));
    const brow=find('brow-'+side);brow.strokeWidth=2.2;
  }
  if(hairStyle!=='none'){
    const back=find('hair-back');back.fill=hair;
    const front=find('hair-front');front.fill=hair;front.strokeWidth=2.5;
    nodes.push(path('folk-hair-strands','head-group','M -44 -40 Q -34 -57 -12 -62 M 2 -62 Q 28 -66 40 -45','none',shade,1.5));
    // A fringe-side lock breaks the old smooth helmet silhouette.
    nodes.push(path('folk-fringe-lock','head-group',hairStyle==='bun'?
      'M -50 -21 Q -58 -3 -50 15 Q -40 11 -42 -12 Z':
      'M -47 -26 Q -65 -9 -51 19 Q -38 14 -42 -7 Z',hair,ink,2));
  }
  nodes.push(path('folk-collar-stitch','upper-body','M 100 185 Q 117 197 139 187','none','#f1e3cf',2));
  nodes.push(path('folk-fabric-stitch','upper-body','M 74 227 Q 73 247 76 265 M 167 230 Q 169 244 167 263','none',trim,1.2));
  return {...drawing,nodes};
}
