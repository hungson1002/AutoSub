import type {VectorNode,VectorTrack} from '../../shared/canvasVectorScene';
import {FOLK_INK_STYLE,handInkDrawing} from '../../shared/canvasVectorInk';

/** Location-driven 2D layout grammar. No story/character is hardcoded.
 * Each site has real near/middle/far depth planes, local detail and actor floor.
 * This is only a reusable optional stage, not a universal movie background. */
export type IllustratedPlace='village'|'forest'|'waterside'|'street'|'corridor'|'rural-interior';
export type IllustratedLight='day'|'dusk'|'night';
type Options={place:IllustratedPlace;light?:IllustratedLight;seed?:number;view?:'eye-level'|'elevated';finish?:'clean'|'handdrawn';setting?:'residential'|'market';festival?:'none'|'tet';artStyle?:typeof FOLK_INK_STYLE};

function palette(light:IllustratedLight){
  if(light==='day')return {sky:'#d9ded1',far:'#a7b5a0',mid:'#7e9880',ground:'#c3b595',earth:'#aa997b',
    plant:'#718969',plantShade:'#4e6e59',wood:'#826c55',roof:'#8a7157',wall:'#c5b79b',ink:'#3d4540',lit:'#edcc8b',water:'#72959b'};
  if(light==='dusk')return {sky:'#687889',far:'#899393',mid:'#556e72',ground:'#928574',earth:'#776b61',
    plant:'#4d6961',plantShade:'#354d4b',wood:'#675847',roof:'#715e56',wall:'#958679',ink:'#30393d',lit:'#edc184',water:'#4e737d'};
  return {sky:'#27374b',far:'#5b6e77',mid:'#3e555b',ground:'#786e63',earth:'#645c53',
    plant:'#506a59',plantShade:'#344d46',wood:'#665443',roof:'#6c594d',wall:'#867c6b',ink:'#27343b',lit:'#f4ca88',water:'#375b66'};
}
/** Muted local colour like illustrated folklore: cool receding landscape,
 * warm lived-in buildings, skin and foreground. Never apply to old stages. */
function handdrawnPalette(light:IllustratedLight){
  const C=palette(light);
  if(light==='day')return {...C,sky:'#b5dce8',far:'#a6bdbb',mid:'#7c9c90',
    ground:'#c8b187',earth:'#ab9270',plant:'#66855e',plantShade:'#456952',
    wood:'#83644d',roof:'#a17c5b',wall:'#c6ae8d',water:'#73989e',ink:'#393d37'};
  if(light==='dusk')return {...C,sky:'#848998',far:'#9ba7a1',mid:'#667d76',
    ground:'#b09d81',earth:'#958067',plant:'#657960',plantShade:'#485c50',
    wood:'#7d6553',roof:'#8b6658',wall:'#ae9881',water:'#61787d',ink:'#373c39'};
  return {...C,sky:'#293b52',far:'#71868d',mid:'#526e70',
    ground:'#78816d',earth:'#a08e74',plant:'#5c7c68',plantShade:'#3c5c53',
    wood:'#79624f',roof:'#906c60',wall:'#b2a18a',water:'#527c87',ink:'#263136'};
}
export function illustratedPlace(options:Options,frame?:{width:number;height:number}){
  if(options.artStyle===FOLK_INK_STYLE)options={...options,finish:'handdrawn'};
  const {place,light='night',finish='clean',setting='residential',festival='none'}=options;
  const inkV2=options.artStyle===FOLK_INK_STYLE;
  if(!['residential','market'].includes(setting)||setting==='market'&&place!=='village')throw new Error('Vector: market setting requires village');
  if(!['none','tet'].includes(festival)||festival==='tet'&&place!=='village')throw new Error('Vector: tet festival requires village');
  if(!['clean','handdrawn'].includes(finish))throw new Error('Vector: invalid illustrated finish');
  if(options.view!==undefined&&!['eye-level','elevated'].includes(options.view)||options.view==='elevated'&&place!=='village')throw new Error('Vector: elevated view requires a village');
  const elevated=options.view==='elevated'||options.view===undefined&&finish==='handdrawn'&&setting==='market';
  const wideMarket=elevated&&setting==='market'&&finish==='handdrawn';
  const actorFloor=elevated?(wideMarket?1160:900):980;
  if(!['village','forest','waterside','street','corridor','rural-interior'].includes(place)||!['day','dusk','night'].includes(light))
    throw new Error('Vector: unsupported illustrated place');
  const seed=Number.isInteger(options.seed)&&Math.abs(options.seed!)<100000?options.seed!:17;
  const C=finish==='handdrawn'?handdrawnPalette(light):palette(light),N:VectorNode[]=[],T:VectorTrack[]=[];
  if(inkV2&&elevated&&place==='village')C.ink='#2c251f';
  if(wideMarket&&light==='day')Object.assign(C,{roof:'#bd995d',earth:'#c5ad7f'});
  // Source-style folk interiors at night use a darker WOOD palette, not a
  // generic blue nighttime overlay on the same beige daylight room.
  // Only explicit handdrawn rural-interior + night receives this treatment.
  if(finish==='handdrawn'&&place==='rural-interior'&&light==='night')
    Object.assign(C,{wall:'#6b544a',wood:'#58443a',roof:'#76594a',ground:'#5d5046',
      earth:'#806959',mid:'#40555c',plantShade:'#28353a',ink:'#29231f',lit:'#f3ca87'});
  const path=(id:string,d:string,fill='none',stroke='none',strokeWidth=0,parent?:string)=>N.push({id,type:'path',d,fill,stroke,strokeWidth,...(parent?{parent}:{})});
  const rect=(id:string,x:number,y:number,width:number,height:number,fill:string,parent?:string)=>N.push({id,type:'rect',x,y,width,height,fill,...(parent?{parent}:{})});
  const ellipse=(id:string,x:number,y:number,rx:number,ry:number,fill:string,parent?:string,stroke?:string)=>N.push({id,type:'ellipse',x,y,rx,ry,fill,...(parent?{parent}:{}),...(stroke?{stroke,strokeWidth:1.5}:{})});
  const group=(id:string,x=0,y=0)=>N.push({id,type:'group',x,y});
  const hash=(i:number)=>((Math.imul(i+seed+701,1103515245)+12345)>>>0)/4294967296;
  // Actor and support are separate from the scenic paint; their positions do
  // not depend on whether the location is an old village or a new city.
  rect('paint-sky',0,0,720,1280,C.sky);
  if(place!=='corridor'&&place!=='rural-interior'){
    path('thin-clouds','M 12 212 Q 134 189 231 210 M 448 285 Q 570 261 696 277','none',C.far,3);
    if(light==='night'){
      ellipse('moon',580,188,33,33,'#f1e2bc');
      N[N.length-1]!.light={kind:'moon',radius:90};
      for(let i=0;i<12;i++)ellipse('star-'+i,35+hash(i)*640,60+hash(i+14)*315,hash(i+6)*1.1+.5,hash(i+20)*1.1+.5,'#ddd9c7');
    }
    path('mountains-back','M 0 651 L 0 492 Q 72 421 142 490 Q 224 396 320 489 Q 412 400 505 475 Q 618 406 720 499 L 720 716 Z',C.far,C.ink,1);
    path('mountains-shade','M 0 690 L 0 574 Q 90 518 160 594 Q 256 516 347 601 Q 478 511 558 595 Q 645 527 720 584 L 720 751 Z',C.mid);
    path('distant-leaves','M 0 736 L 0 668 Q 28 638 48 669 Q 63 623 91 671 Q 122 632 150 665 Q 197 629 228 678 Q 269 615 301 675 Q 341 632 364 677 Q 407 617 437 676 Q 479 633 506 672 Q 558 625 584 675 Q 615 631 645 671 Q 681 639 720 672 L 720 754 Z',C.plantShade);
  }
  if(place!=='corridor'&&place!=='rural-interior')path('middle-ground','M 0 733 Q 180 724 360 737 Q 540 727 720 734 L 720 990 L 0 990 Z',C.ground);
  rect('physical-ground-plane',0,980,720,1280,C.ground);
  path('ground-edge','M 0 950 Q 169 944 338 951 Q 521 957 720 947','none',C.ink,finish==='handdrawn'?0:3);
  // Ground features use deterministic distributions so a location's geometry
  // remains exactly the same through every shot, export and retry.
  const smallDetails=()=>{
    // Market scenes may have 5–8 actors plus a camera group. Combine tiny
    // ground marks into compound Path2D contours: SAME visual complexity,
    // fewer scene nodes, no reduction in quality or actor/world capabilities.
    if(setting==='market'&&finish==='handdrawn'){
      for(const parity of [0,1]){
        const d=Array.from({length:6},(_,j)=>{
          const i=2*j+parity,x=28+hash(i+30)*646,y=1019+hash(i+64)*240;
          return `M ${x.toFixed(1)} ${y.toFixed(1)} q 12 -4 26 0 m 9 4 q 10 -2 17 0`;
        }).join(' ');
        path('soil-ink-'+parity,d,'none',parity?C.earth:C.ink,1.05);
        N[N.length-1]!.opacity=.45;
      }
      const stones=Array.from({length:8},(_,i)=>{
        const x=20+hash(i+41)*662,y=992+hash(i+81)*262;
        return `M ${x.toFixed(1)} ${y.toFixed(1)} q 8 -8 18 -4 q 10 0 14 8 Z`;
      }).join(' ');
      path('market-pebbles',stones,C.earth,C.ink,1.25);
      return;
    }
    for(let i=0;i<12;i++){
      const x=28+hash(i+30)*646,y=1019+hash(i+64)*240;
      path('soil-detail-'+i,`M ${x.toFixed(1)} ${y.toFixed(1)} q 12 -4 26 0 m 9 4 q 10 -2 17 0`,'none',i%2?C.earth:C.ink,i%3===0?1.4:.85);
      N[N.length-1]!.opacity=.45;
    }
    for(let i=0;i<8;i++){
      const x=20+hash(i+41)*662,y=992+hash(i+81)*262;
      path('pebble-'+i,`M ${x.toFixed(1)} ${y.toFixed(1)} q 8 -8 18 -4 q 10 0 14 8 Z`,C.earth,C.ink,1.25);
    }
  };
  const foliage=(id:string,x:number,y:number,scale=1)=>{
    group(id,x,y);const px=(s:number)=>Number((s*scale).toFixed(2));
    if(finish==='handdrawn'){
      ellipse(id+'-contact-shadow',px(8),px(3),px(58),px(10),C.plantShade,id);
      N[N.length-1]!.opacity=.28;
    }
    path(id+'-trunk',`M ${px(-10)} 0 Q ${px(-17)} ${px(-82)} ${px(-15)} ${px(-155)} L ${px(-46)} ${px(-197)} L ${px(-34)} ${px(-205)} L ${px(-4)} ${px(-176)} Q ${px(11)} ${px(-241)} ${px(51)} ${px(-273)} L ${px(62)} ${px(-261)} Q ${px(17)} ${px(-191)} ${px(16)} ${px(-141)} L ${px(19)} 0 Z`,C.wood,C.ink,2.4,id);
    path(id+'-canopy',`M ${px(-94)} ${px(-202)} Q ${px(-110)} ${px(-250)} ${px(-60)} ${px(-268)} Q ${px(-57)} ${px(-320)} ${px(-3)} ${px(-315)} Q ${px(32)} ${px(-339)} ${px(64)} ${px(-309)} Q ${px(118)} ${px(-312)} ${px(116)} ${px(-259)} Q ${px(142)} ${px(-223)} ${px(90)} ${px(-202)} Q ${px(48)} ${px(-184)} ${px(9)} ${px(-210)} Q ${px(-49)} ${px(-178)} ${px(-94)} ${px(-202)} Z`,C.plant,C.ink,2.7,id);
    path(id+'-canopy-shadow',`M ${px(-91)} ${px(-212)} Q ${px(-50)} ${px(-194)} ${px(2)} ${px(-220)} Q ${px(59)} ${px(-187)} ${px(118)} ${px(-238)} Q ${px(119)} ${px(-202)} ${px(87)} ${px(-197)} Q ${px(46)} ${px(-179)} ${px(7)} ${px(-206)} Q ${px(-48)} ${px(-178)} ${px(-91)} ${px(-212)} Z`,C.plantShade,'none',0,id);
    path(id+'-leaves',`M ${px(-66)} ${px(-261)} q ${px(19)} ${px(-20)} ${px(39)} ${px(-3)} M ${px(16)} ${px(-296)} q ${px(20)} ${px(-15)} ${px(39)} ${px(4)} M ${px(60)} ${px(-248)} q ${px(22)} ${px(-16)} ${px(35)} ${px(1)}`,'none',C.far,2,id);
    if(finish==='handdrawn'){
      const crown=N.find(n=>n.id===id+'-canopy');
      const kind=[...id].reduce((a,c)=>a+c.charCodeAt(0),0)%3;
      if(crown&&kind===1)crown.d=`M ${px(-106)} ${px(-211)} Q ${px(-116)} ${px(-248)} ${px(-78)} ${px(-261)} Q ${px(-80)} ${px(-303)} ${px(-39)} ${px(-305)} Q ${px(-13)} ${px(-341)} ${px(19)} ${px(-318)} Q ${px(72)} ${px(-340)} ${px(87)} ${px(-291)} Q ${px(136)} ${px(-281)} ${px(126)} ${px(-240)} Q ${px(120)} ${px(-204)} ${px(80)} ${px(-202)} Q ${px(33)} ${px(-182)} ${px(-7)} ${px(-208)} Q ${px(-67)} ${px(-181)} ${px(-106)} ${px(-211)} Z`;
      if(crown&&kind===2)crown.d=`M ${px(-91)} ${px(-204)} Q ${px(-109)} ${px(-260)} ${px(-55)} ${px(-269)} Q ${px(-46)} ${px(-320)} ${px(4)} ${px(-307)} Q ${px(34)} ${px(-337)} ${px(66)} ${px(-297)} Q ${px(122)} ${px(-296)} ${px(128)} ${px(-244)} Q ${px(142)} ${px(-205)} ${px(94)} ${px(-190)} Q ${px(38)} ${px(-176)} ${px(6)} ${px(-204)} Q ${px(-46)} ${px(-182)} ${px(-91)} ${px(-204)} Z`;
      path(id+'-branch-ink',`M ${px(-1)} ${px(-26)} Q ${px(4)} ${px(-105)} ${px(10)} ${px(-161)} M ${px(4)} ${px(-145)} Q ${px(-4)} ${px(-196)} ${px(-33)} ${px(-220)}`,'none',C.ink,1.1,id);
      path(id+'-crown-ink',`M ${px(-74)} ${px(-252)} Q ${px(-80)} ${px(-276)} ${px(-52)} ${px(-278)} M ${px(-9)} ${px(-303)} Q ${px(19)} ${px(-315)} ${px(37)} ${px(-295)} M ${px(75)} ${px(-274)} Q ${px(103)} ${px(-271)} ${px(103)} ${px(-241)}`,'none',C.ink,1,id);
      if(inkV2){
        const trunk=N.find(n=>n.id===id+'-trunk')!;
        trunk.d=`M ${px(-25)} 0 Q ${px(-12)} ${px(-28)} ${px(-15)} ${px(-81)} Q ${px(-25)} ${px(-148)} ${px(-48)} ${px(-202)} L ${px(-34)} ${px(-211)} Q ${px(-9)} ${px(-183)} ${px(2)} ${px(-157)} Q ${px(14)} ${px(-220)} ${px(49)} ${px(-268)} L ${px(62)} ${px(-257)} Q ${px(29)} ${px(-194)} ${px(22)} ${px(-135)} Q ${px(16)} ${px(-66)} ${px(35)} 0 Q ${px(8)} ${px(7)} ${px(-25)} 0 Z`;
        path(id+'-bark',`M ${px(-5)} ${px(-18)} Q ${px(1)} ${px(-49)} ${px(-6)} ${px(-74)} M ${px(12)} ${px(-91)} Q ${px(7)} ${px(-108)} ${px(14)} ${px(-124)}`,'none',C.earth,1.7,id);
      }
    }
  };
  const house=(id:string,x:number,y:number,w:number,h:number)=>{
    // Stable variations across one location: thatch, pitched tile, low eave.
    // Distinct silhouette/material is more valuable than random decoration.
    const variety=finish==='handdrawn'?([...id].reduce((v,c)=>(v*33+c.charCodeAt(0))%3,0)+(inkV2?seed:0))%3:-1;
    group(id,x,y);
    if(elevated)Object.assign(N[N.length-1]!,{width:w,height:h,groundAnchor:{x:w/2,y:h},groundOffsetY:y+h-actorFloor});
    if(elevated)path(id+'-yard',inkV2?`M -20 ${h-3} Q ${w*.5} ${h-11} ${w+25} ${h-2} L ${w+40} ${h+28} Q ${w*.55} ${h+40} -36 ${h+20} Z`:`M -28 ${h-6} L ${w+30} ${h-6} L ${w+62} ${h+49} Q ${w/2} ${h+65} -55 ${h+43} Z`,inkV2?C.earth:C.ground,'none',0,id);
    if(finish==='handdrawn'){
      ellipse(id+'-contact-shadow',w*.55,h+13,w*.68,14,C.plantShade,id);
      N[N.length-1]!.opacity=.3;
    }
    const wall=finish==='handdrawn'
      ?`M 0 0 Q ${-2-variety} ${(h*.45).toFixed(1)} 1 ${h} L ${w+2} ${h} Q ${w+3} ${(h*.51).toFixed(1)} ${w-1} 0 Z`
      :`M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
    path(id+'-wall',wall,inkV2&&elevated?(variety===2?C.wood:variety===1?C.wall:C.earth):variety===2?C.earth:C.wall,C.ink,inkV2&&elevated?3.6:2,id);
    if(finish==='handdrawn'){
      path(id+'-side-plane',`M ${w*.81} 5 L ${w-1} 0 L ${w+2} ${h} L ${w*.81} ${h} Z M 1 16 Q ${w*.48} 11 ${w-1} 16 L ${w} 31 Q ${w*.5} 25 0 32 Z`,C.wood,'none',0,id);
    }
    path(id+'-base',`M -6 ${h} Q ${w/2} ${h+5} ${w+6} ${h} L ${w+6} ${h+14} L -6 ${h+14} Z`,C.earth,C.ink,1.7,id);
    const roof=elevated&&inkV2?(variety%2===0
      ?`M -26 8 Q -3 ${-h*.22} 14 ${-h*.58} Q ${w*.48} ${-h*.62} ${w-14} ${-h*.58} Q ${w+2} ${-h*.24} ${w+26} 8 L ${w+12} 22 Q ${w*.49} 16 -12 22 Z`
      :`M -26 8 Q ${w*.19} ${-h*.35} ${w*.48} ${-h*.69} Q ${w*.5} ${-h*.73} ${w*.54} ${-h*.67} Q ${w*.81} ${-h*.29} ${w+26} 8 Q ${w*.72} 22 ${w*.5} 17 Q ${w*.23} 23 -26 8 Z`)
      :elevated?`M -24 8 L 14 ${-h*.58} L ${w-14} ${-h*.58} L ${w+24} 8 L ${w+10} 21 L -10 21 Z`:
      variety===0?`M -26 5 Q ${w*.15} -59 ${w*.48} -57 Q ${w*.73} -63 ${w+26} 5 L ${w+24} 18 Q ${w*.83} 11 ${w*.64} 19 L ${w*.42} 12 Q ${w*.2} 22 -22 17 Z`:
      variety===1?`M -26 9 L ${w*.47} -75 Q ${w*.5} -79 ${w*.54} -74 L ${w+27} 9 Q ${w*.84} 21 ${w*.51} 15 Q ${w*.17} 20 -24 17 Z`:
      variety===2?`M -25 6 Q ${w*.16} -35 ${w*.37} -31 Q ${w*.5} -50 ${w*.66} -40 Q ${w*.85} -40 ${w+23} 7 L ${w+15} 19 Q ${w*.5} 12 -16 18 Z`:
      `M -25 5 Q ${w*.17} -52 ${w*.53} -46 Q ${w*.82} -60 ${w+27} 6 L ${w+15} 21 Q ${w/2} 6 -13 20 Z`;
    path(id+'-roof',roof,variety===0?C.earth:variety===1?(light==='night'?C.roof:'#976e5c'):C.roof,C.ink,inkV2&&elevated?4.2:2.7,id);
    if(finish==='handdrawn'&&elevated&&!(inkV2&&variety%2!==0))
      path(id+'-roof-side',`M ${w-14} ${-h*.58} L ${w+24} 8 L ${w+10} 21 L ${w*.81} 8 Z`,C.wood,C.ink,1.4,id);
    path(id+'-roof-stripes',elevated&&inkV2&&variety%2!==0?`M -9 5 Q ${w*.2} ${-h*.28} ${w*.49} ${-h*.58} M ${w*.57} ${-h*.52} Q ${w*.8} ${-h*.23} ${w+7} 5 M -3 12 Q ${w*.5} 20 ${w+5} 12`:elevated?`M -12 5 L 20 ${-h*.5} L ${w-20} ${-h*.5} L ${w+12} 5 M -6 15 L ${w+6} 15 M ${w*.3} ${-h*.5} L ${w*.22} 7 M ${w*.65} ${-h*.5} L ${w*.74} 7`:`M -10 10 Q ${w*.3} -30 ${w/2} -21 Q ${w*.8} -30 ${w+13} 9 M -4 17 Q ${w*.4} 5 ${w*.64} 8`,'none',C.earth,1.6,id);
    if(elevated){
      path(id+'-thatch',Array.from({length:8},(_,i)=>{const x=20+(w-40)*i/7,top=inkV2&&variety%2!==0?-h*.56*(1-Math.abs(x-w*.51)/(w*.51)):-h*.46;return `M ${x} ${top} L ${x+(i-3.5)*3} 5`;}).join(' '),'none',inkV2?C.wood:C.earth,inkV2?1.5:.9,id);
      path(id+(finish==='handdrawn'?'-handdrawn-planks':'-wall-planks'),Array.from({length:6},(_,i)=>`M ${12+i*(w-24)/5} 26 L ${12+i*(w-24)/5} ${h-4}`).join(' '),'none',C.earth,1,id);
    }
    const dw=Math.max(36,w*.24),doorL=w*.52-dw/2,doorR=w*.52+dw/2;
    const door=finish==='handdrawn'&&variety===1
      ?`M ${doorL} ${h} L ${doorL+2} ${h*.4} Q ${w*.52} ${h*.25} ${doorR-1} ${h*.41} L ${doorR} ${h} Z`
      :finish==='handdrawn'&&variety===2
        ?`M ${doorL+5} ${h} L ${doorL+3} ${h*.48} Q ${w*.52} ${h*.45} ${doorR} ${h*.46} L ${doorR-2} ${h} Z`
        :`M ${doorL} ${h} L ${doorL} ${h*.42} Q ${w*.52} ${h*.38} ${doorR} ${h*.42} L ${doorR} ${h} Z`;
    path(id+'-door',door,C.wood,C.ink,2,id);
    path(id+'-door-planks',`M ${w*.52} ${h*.48} L ${w*.52} ${h-5} M ${w*.52-dw/2+6} ${h*.55} L ${w*.52-dw/2+6} ${h*.95}`,'none',C.earth,1.2,id);
    // The primary home exposes an actual door, like the courtyard component.
    // Bind the existing painted leaf instead of asking AI to redraw the house
    // just to get a usable door ID. Its fixed aperture stays behind the leaf.
    if(finish==='handdrawn'&&id==='house-mid'){
      const leaf=N.find(n=>n.id===id+'-door')!,planks=N.find(n=>n.id===id+'-door-planks')!;
      const at=N.indexOf(leaf);
      N.splice(at,0,{id:'door-opening',type:'path',parent:id,d:door,fill:C.ink},
        {id:'door',type:'group',parent:id,width:w,height:h,pivotX:doorL,pivotY:h*.42,pivotSpace:'local'});
      leaf.parent='door';planks.parent='door';
    }
    if(finish==='handdrawn')
      path(id+'-window',`M ${w*.075} ${h*.39} Q ${w*.17} ${h*.376} ${w*.275} ${h*.395} L ${w*.27} ${h*.66} Q ${w*.17} ${h*.668} ${w*.073} ${h*.653} Z`,light==='night'?C.lit:C.far,C.ink,1.1,id);
    else rect(id+'-window',w*.075,h*.39,w*.2,h*.27,light==='night'?C.lit:C.far,id);
    path(id+'-window-slat',`M ${w*.175} ${h*.39} L ${w*.175} ${h*.66} M ${w*.075} ${h*.52} L ${w*.275} ${h*.52}`,'none',C.wood,2,id);
    if(inkV2&&elevated&&['house-mid','house-left'].includes(id)){
      const x=w+19,y=h-24;
      path(id+'-yard-jar',`M ${x-8} ${y+6} Q ${x-17} ${y+16} ${x-12} ${y+29} Q ${x} ${y+36} ${x+12} ${y+29} Q ${x+17} ${y+16} ${x+8} ${y+6} Z`,C.wood,C.ink,2.1,id);
      path(id+'-jar-rim',`M ${x-8} ${y+6} Q ${x} ${y+11} ${x+8} ${y+6} Q ${x} ${y+1} ${x-8} ${y+6} Z`,C.ink,C.ink,1,id);
    }
    if(finish==='handdrawn'&&!elevated){
      path(id+'-handdrawn-planks',Array.from({length:6},(_,i)=>{const sx=9+i*(w-16)/6;return `M ${sx.toFixed(2)} 24 Q ${(sx-2.8).toFixed(2)} ${Math.round(h*.32)} ${sx.toFixed(2)} ${Math.round(h*.53)} M ${(sx+1).toFixed(2)} ${Math.round(h*.77)} L ${(sx-1).toFixed(2)} ${h-9}`;}).join(' '),'none',C.wood,1.05,id);
      path(id+'-roof-hatch',variety===0?
        Array.from({length:13},(_,i)=>{const sx=-6+i*(w+16)/13;return `M ${sx.toFixed(2)} 9 q 3 ${2+(i%3)} 6 0`;}).join(' '):
        variety===1?`M -3 2 L ${w*.49} -59 L ${w+4} 2 M 13 -3 L ${w*.48} -48 M ${w*.55} -48 L ${w-6} -4`:
        Array.from({length:7},(_,i)=>{const sx=-4+i*(w+6)/7;return `M ${sx.toFixed(2)} 8 q 7 -3 14 0`;}).join(' '),'none',C.earth,1.25,id);
    }
  };
  if(elevated){
    // This is a different projected environment, not a rotated/zoomed front
    // view. Road surfaces, roof planes and depth placement supply the angle.
    N.length=0;
    const scale=frame&&frame.width>frame.height?frame.height/1080:1;
    const left=frame&&frame.width>frame.height?-(frame.width-720*scale)/2/scale:0,right=720-left;
    rect('paint-sky',0,0,720,1280,C.sky);
    if(inkV2&&light==='night'){
      ellipse('moon',580,175,29,29,'#f1e2bc');N[N.length-1]!.light={kind:'moon',radius:85};
      for(let i=0;i<12;i++)ellipse('star-'+i,left+(right-left)*hash(i),90+hash(i+14)*160,1.2,1.2,'#ddd9c7');
    }
    path('mountains-back',wideMarket?'M 0 780 L 0 620 Q 120 410 240 585 Q 330 425 440 590 Q 580 430 720 620 L 720 780 Z':'M 0 420 L 0 335 Q 120 240 240 330 Q 330 260 440 330 Q 580 245 720 335 L 720 430 Z',C.far,C.ink,1);
    path('mountains-shade',wideMarket?'M 0 810 L 0 706 Q 180 642 360 710 Q 550 635 720 706 L 720 835 Z':'M 0 450 L 0 390 Q 180 320 360 390 Q 550 319 720 390 L 720 470 Z',C.mid);
    if(inkV2&&!wideMarket){
      N.find(n=>n.id==='mountains-back')!.d='M 0 430 L 0 330 Q 42 322 85 349 L 168 222 Q 177 204 187 227 L 247 315 Q 283 341 319 307 L 398 204 Q 411 184 424 211 L 482 324 Q 537 291 579 306 L 626 245 Q 638 224 650 250 L 699 309 L 720 320 L 720 430 Z';
      path('ink-distant-pines',[[88,421,47],[274,420,40],[564,424,52]].map(([x,y,h])=>`M ${x!-3} ${y} L ${x!-3} ${y!-10} L ${x!-16} ${y!-10} L ${x!-8} ${y!-23} L ${x!-13} ${y!-23} L ${x} ${y!-h!} L ${x!+13} ${y!-23} L ${x!+8} ${y!-23} L ${x!+16} ${y!-10} L ${x!+3} ${y!-10} L ${x!+3} ${y} Z`).join(' '),C.plantShade,C.ink,1.4);
    }
    path('middle-ground',wideMarket?'M 0 732 Q 350 710 720 737 L 720 1600 L 0 1600 Z':'M 0 421 Q 350 404 720 425 L 720 1600 L 0 1600 Z',C.plant);
    rect('physical-ground-plane',left,900,right-left,1000,C.plant);
    if(inkV2){N.find(n=>n.id==='middle-ground')!.fill=C.ground;N.find(n=>n.id==='physical-ground-plane')!.fill=C.ground;}
    path('village-street',wideMarket?`M ${left} 815 Q 80 780 440 900 Q 690 980 ${right} 895 L ${right} 990 Q 660 1090 380 1015 Q 80 880 ${left} 910 Z`:`M ${left} 712 Q 80 626 440 795 Q 690 912 ${right} 870 L ${right} 986 Q 670 1028 378 893 Q 80 728 ${left} 807 Z`,C.earth,C.ink,2);
    if(wideMarket)path('market-square',`M ${left+220} 900 Q 190 850 630 900 Q ${right-260} 920 ${right-90} 1030 L ${right} 1600 L ${left} 1600 Z`,C.earth,C.ink,1.5);
    else path('village-path-branch','M 378 864 Q 350 1050 227 1410 L 474 1410 Q 513 1100 466 895 Z',C.earth,C.ink,2);
    const houses:[string,number,number,number,number][]=wideMarket?[
      ['house-left',left+100,720,230,130],['house-back',40,666,155,110],
      ['house-mid',535,710,174,125],['house-right',right-290,750,210,145],
    ]:[
      ['house-back',30,526,135,110],['house-mid',inkV2?475:535,inkV2?585:610,inkV2?270:174,inkV2?160:125],
      ['house-left',left+90,612,190,130],['house-right',right-240,654,180,140],
      ['house-near-left',left+(inkV2?150:200),1080,inkV2?320:270,inkV2?185:155],['house-near-right',right-365,inkV2?1090:1170,inkV2?305:285,inkV2?170:160],
    ];
    for(const [id,x,y,w,h]of houses)house(id,x,y,w,h);
    foliage('village-tree',250,665,.55);foliage('village-tree-left',left+410,720,.7);foliage('village-tree-right',right-420,796,.65);
    if(inkV2){
      foliage('ink-frame-tree-left',left+45,1210,1.18);foliage('ink-frame-tree-right',right-28,1245,1.12);
      path('ink-lane-stones',`M ${left+280} 1030 q 13 -5 25 -1 m 12 18 q 11 -4 19 1 M 600 1200 q 14 -6 28 -1 M 464 954 q 8 -5 16 -1`,'none',C.ink,1.3);
      path('ink-garden-fence',Array.from({length:5},(_,i)=>{const x=left+28+i*17;return `M ${x} 1178 L ${x-1} 1090 L ${x+5} 1082 L ${x+12} 1090 L ${x+13} 1178 Z`;}).join(' '),C.roof,C.ink,2.5);
      path('ink-garden-fence-rails',`M ${left+24} 1104 Q ${left+68} 1099 ${left+112} 1104 M ${left+24} 1144 Q ${left+68} 1140 ${left+112} 1144`,'none',C.wood,4);
    }
    if(inkV2){
      // A semantic scene target wraps the existing tree without moving it.
      // The writer may safely frame "tree" while native IDs stay available.
      const at=N.findIndex(n=>n.id==='village-tree'),native=N[at]!;
      N.splice(at,0,{id:'tree',type:'group',x:0,y:0,bounds:{x:250-78,y:665-187,width:160,height:187}});
      native.parent='tree';
    }
    if(wideMarket){
      // A public square has its own projected ground and side stalls. It is
      // not a street-level portrait background with a row of enlarged heads.
      const stall=(id:string,x:number,y:number,w:number,h:number)=>{
        group(id,x,y);
        Object.assign(N[N.length-1]!,{width:w,height:h});
        path(id+'-shadow',`M -15 ${h} Q ${w*.55} ${h+35} ${w+25} ${h+8} L ${w+34} ${h+30} Q ${w*.5} ${h+54} -20 ${h+22} Z`,C.plantShade,'none',0,id);
        path(id+'-posts',`M 12 28 L 12 ${h} M ${w-12} 29 L ${w-12} ${h}`,'none',C.wood,9,id);
        path(id+'-roof',`M -32 42 L 16 -29 Q ${w*.5} -42 ${w-19} -26 L ${w+32} 44 L ${w+20} 62 Q ${w*.65} 49 ${w*.5} 64 Q ${w*.23} 48 -24 61 Z`,C.roof,C.ink,3,id);
        path(id+'-thatch',Array.from({length:10},(_,i)=>{const x=i*w/9;return `M ${x} 3 l -3 44 m 8 -21 l -1 22`;}).join(' '),'none',C.earth,1.4,id);
        path(id+'-counter',`M -8 ${h*.7} Q ${w*.5} ${h*.66} ${w+8} ${h*.7} L ${w+8} ${h*.8} L ${w-8} ${h} L 4 ${h} Z`,C.wood,C.ink,2.4,id);
        path(id+'-goods',Array.from({length:4},(_,i)=>{const x=18+i*(w-70)/4,yy=h*.69;return `M ${x} ${yy} l 3 -29 q 20 -10 40 0 l 3 29 Z M ${x+4} ${yy-18} l 35 0`;}).join(' '),C.wall,C.ink,1.8,id);
      };
      stall('market-stall',left+80,780,350,245);
      stall('market-stall-right',right-475,755,330,235);
      stall('market-thatch-stall',left+110,1120,395,260);
      group('market-sign',310,660);
      Object.assign(N[N.length-1]!,{width:269,height:252});
      path('market-sign-posts','M 0 18 L 0 252 M 269 18 L 269 248','none',C.wood,12,'market-sign');
      path('market-sign-roof','M -28 17 L 5 -30 Q 125 -45 265 -29 L 300 19 L 287 32 L -19 31 Z',C.roof,C.ink,3,'market-sign');
      path('market-sign-board','M 14 33 L 257 33 L 254 105 Q 132 99 15 105 Z',C.wood,C.ink,2.5,'market-sign');
      path('market-sign-carving','M 44 58 q 23 16 48 0 m 23 2 q 23 -12 43 1 m 17 -3 q 19 15 37 0 M 55 82 q 49 -8 101 0 m 14 -1 l 31 2','none',C.lit,3,'market-sign');
      path('market-lantern-cords','M 6 112 L 6 134 M 132 103 L 132 129 M 265 111 L 265 134','none',C.wood,2,'market-sign');
      for(const [i,x] of [6,132,265].entries())ellipse('market-lantern-'+i,x,149,12,18,light==='night'?C.lit:'#b65e49','market-sign',C.ink);
      // Foreground architecture frames the plaza; it must not fill its center.
      foliage('market-foreground-tree',right-50,1340,1.8);
    }else for(let i=0;i<9;i++){
      const x=left+90+i*(right-left-180)/8;
      path('field-detail-'+i,`M ${x} 1020 q 10 -22 20 -12 m -14 10 q -3 -16 -10 -20`,'none',C.plantShade,2);
    }
    if(!wideMarket&&!inkV2)for(let i=0;i<5;i++)path('roof-thatch-'+i,`M ${55+i*20} 475 l -6 43 M ${557+i*26} 550 l 8 60`,'none',C.earth,1);
  }else if(place==='village'||place==='waterside'){
    if(place==='waterside'){
      rect('water-plane',0,710,720,251,C.water);
      path('far-shore','M 0 718 Q 150 681 338 720 Q 533 687 720 718','none',C.plantShade,18);
      for(let i=0;i<8;i++){
        const x=12+i*93,y=753+i%3*44;
        path('wave-'+i,`M ${x} ${y} q 20 -5 43 -2 m 7 -1 q 17 4 32 -2`,'none',light==='night'?'#799697':'#b8d0c9',1.6);
        T.push({target:'wave-'+i,start:0,end:1,frames:[{t:0,dx:0},{t:.5,dx:8,easing:'smooth'},{t:1,dx:0,easing:'smooth'}]});
      }
      path('bank-rim','M 0 944 Q 184 933 344 944 Q 526 955 720 941 L 720 980 Q 509 970 345 981 Q 162 959 0 974 Z',C.earth,C.ink,2);
      rect('dock',480,892,185,35,C.wood);
      for(let i=0;i<3;i++)rect('dock-post-'+i,494+i*68,907,13,110,C.wood);
      path('dock-planks','M 498 895 L 498 926 M 547 894 L 547 926 M 601 894 L 601 926','none',C.earth,2);
    }else{
      path('village-street','M 298 941 Q 251 1014 182 1280 L 602 1280 Q 487 1038 404 941 Z',C.earth,C.ink,2);
      for(let i=0;i<7;i++){
        const x=80+i*86,y=882+(i%2)*5;
        path('fence-post-'+i,`M ${x} ${y-48} L ${x} ${y+56} L ${x+13} ${y+56} L ${x+13} ${y-48} Z`,C.wood,C.ink,1.7);
      }
      path('fence-top','M 68 867 L 715 871 M 68 891 L 715 895','none',C.wood,8);
    }
    house('house-back',480,637,170,180);
    house('house-mid',32,699,204,214);
    foliage('village-tree',270,922,.72);
    path('hanging-plant','M 0 956 Q 38 922 66 947 Q 92 922 122 950 Q 148 927 170 956','none',C.plant,8);
  }else if(place==='forest'){
    foliage('far-tree-a',118,877,.6);foliage('far-tree-b',540,878,.76);
    foliage('big-tree-left',-7,1055,1.25);foliage('big-tree-right',710,1080,.98);
    path('forest-path','M 287 945 Q 259 1057 187 1280 L 583 1280 Q 458 1039 397 945 Z',C.earth,C.ink,2);
    for(let i=0;i<12;i++){
      const x=20+hash(i+75)*675,y=952+hash(i+92)*310;
      path('ferns-'+i,`M ${x.toFixed(1)} ${y.toFixed(1)} q -14 -35 -9 -55 m 11 54 q 4 -44 22 -58 m -22 58 q -26 -19 -30 -32`,'none',C.plantShade,2.3);
    }
  }else if(place==='street'){
    for(let i=0;i<3;i++){
      const x=15+i*242,w=225,h=270+(i%2)*62,y=945-h;
      rect('block-'+i,x,y,w,h,C.wall);
      path('roofline-'+i,`M ${x-7} ${y} L ${x+w+7} ${y}`,'none',C.ink,7);
      for(let row=0;row<2;row++)for(let col=0;col<3;col++){
        const wx=x+26+col*62,wy=y+28+row*73;
        rect('window-'+i+'-'+row+'-'+col,wx,wy,38,45,light==='night'&&(col+row)%2===0?C.lit:C.mid);
        path('window-sashes-'+i+'-'+row+'-'+col,`M ${wx+19} ${wy} L ${wx+19} ${wy+45} M ${wx} ${wy+22} L ${wx+38} ${wy+22}`,'none',C.ink,1.8);
      }
      path('shopfront-'+i,`M ${x+12} ${y+h-72} L ${x+w-12} ${y+h-72} L ${x+w-7} ${y+h-60} L ${x+7} ${y+h-60} Z`,C.roof,C.ink,2);
      rect('store-door-'+i,x+w*.43,y+h-59,50,59,C.wood);
    }
    path('pavement','M 0 953 L 720 953 L 720 1022 L 0 1022 Z',C.earth,C.ink,2);
    for(let i=0;i<5;i++)path('pavement-joint-'+i,`M ${i*148} 954 L ${i*148+20} 1021`,'none',C.ink,1);
    rect('street-lamp-post',618,605,10,344,C.wood);
    path('street-lamp-top','M 590 632 Q 622 585 650 634 Z',C.wood,C.ink,2);
    ellipse('street-lamp-light',620,631,12,17,C.lit);
  }else if(place==='rural-interior'){
    // Small traditional home: timber walls, floor, daylight and domestic props.
    // This is a reusable ROOM, never a fixed scary scene or inherited village.
    rect('interior-room-back',-460,0,1640,985,C.wall);
    path('interior-ceiling','M -460 0 L 1180 0 L 1180 255 Q 450 210 -460 246 Z',C.wood);
    path('interior-beam','M -460 243 Q 310 253 1180 239 L 1180 268 Q 310 275 -460 270 Z',C.roof,C.ink,3);
    path('interior-plank-joins',Array.from({length:24},(_,i)=>{const x=-445+i*68;return `M ${x} 272 Q ${x+(i%3)-1} 509 ${x+1} 754 Q ${x-2} 872 ${x+2} 970`;}).join(' '),'none',C.wood,1.85);
    path('interior-plank-scuffs',Array.from({length:16},(_,i)=>{const x=-399+i*97,y=346+(i%4)*139;return `M ${x} ${y} q -3 23 2 47 m 3 7 q 3 9 -1 22`;}).join(' '),'none',C.earth,1.1);
    path('interior-supports','M -58 246 L -58 982 M 755 242 L 755 985 M 484 252 L 484 970','none',C.wood,18);
    path('interior-wall-shadow','M -460 881 Q -130 868 178 885 Q 507 876 1180 881 L 1180 948 Q 540 932 170 941 Q -80 927 -460 940 Z',C.earth,'none',0);
    path('interior-baseboard','M -460 969 Q 300 962 1180 969 L 1180 989 L -460 989 Z',C.wood,C.ink,2);
    path('interior-floorboards','M -450 1036 Q 210 1044 1180 1034 M -440 1162 Q 330 1176 1180 1164 M -200 989 L -340 1280 M 201 990 L 156 1280 M 560 990 L 684 1280 M 942 990 L 1145 1280','none',C.earth,1.8);
    // A shuttered window and the dark doorway establish lived-in structure.
    group('interior-window',-38,475);
    path('interior-window-opening','M 0 0 L 172 -3 L 175 197 L -2 197 Z',C.mid,C.ink,4,'interior-window');
    path('interior-window-frame','M 84 -2 L 87 198 M 0 91 L 176 91 M -8 -13 L 181 -13 L 182 210 L -8 210 Z','none',C.wood,9,'interior-window');
    path('interior-window-shutter','M 5 0 Q 26 -2 47 3 L 47 190 L 5 194 Z M 127 0 L 169 1 L 169 193 L 127 191 Z',C.roof,C.ink,2,'interior-window');
    path('interior-window-hatch','M 13 16 L 13 177 M 31 17 L 31 180 M 141 17 L 141 181 M 158 15 L 158 182','none',C.earth,1.35,'interior-window');
    group('interior-door',551,500);
    Object.assign(N[N.length-1]!,{width:176,height:477,groundAnchor:{x:88,y:477}});
    path('interior-door-opening','M 0 0 Q 87 -11 174 -3 L 176 476 L 0 476 Z',C.plantShade,C.ink,4,'interior-door');
    path('interior-door-frame','M -10 475 L -10 -8 Q 85 -24 184 -9 L 185 477','none',C.wood,13,'interior-door');
    path('interior-door-leaf','M 7 13 Q 88 8 143 14 L 141 461 L 8 463 Z',C.roof,C.ink,3,'interior-door');
    path('interior-door-grain','M 24 31 Q 21 232 27 447 M 55 24 Q 59 244 56 451 M 87 23 Q 85 222 89 448 M 121 30 Q 125 216 122 451','none',C.wood,1.85,'interior-door');
    ellipse('interior-door-knob',127,776,7.5,7.5,C.lit);
    // Shelf, household containers and a low table: identifiable domestic
    // objects rather than random texture, with no scripted ghost or story clue.
    group('interior-shelf',229,566);
    path('interior-shelf-boards','M -14 2 L 224 2 L 223 21 L -14 21 Z M -12 150 L 222 148 L 221 168 L -13 166 Z',C.wood,C.ink,2.5,'interior-shelf');
    path('interior-shelf-brackets','M 11 18 L 30 48 L 40 18 M 185 18 L 175 49 L 164 18 M 13 167 L 25 200 L 35 168 M 184 165 L 178 199 L 166 166','none',C.ink,2.4,'interior-shelf');
    path('interior-pottery','M 20 -5 Q 6 -30 19 -57 L 53 -57 Q 68 -30 55 -5 Z M 76 0 Q 62 -38 78 -48 L 112 -48 Q 122 -21 111 0 Z M 146 151 Q 131 123 148 102 L 185 102 Q 194 127 180 151 Z',C.earth,C.ink,2,'interior-shelf');
    path('interior-pottery-rims','M 15 -54 Q 37 -61 58 -55 M 74 -46 Q 92 -53 114 -47 M 145 101 Q 163 95 187 101','none',C.roof,3,'interior-shelf');
    group('interior-low-table',-146,847);
    path('interior-table-top','M 0 0 Q 178 -8 381 0 L 380 23 Q 193 31 2 21 Z',C.wood,C.ink,3,'interior-low-table');
    path('interior-table-legs','M 27 23 L 15 114 M 353 25 L 364 114','none',C.wood,10,'interior-low-table');
    path('interior-tea-set','M 97 0 Q 80 -29 105 -45 Q 134 -55 146 -25 L 137 0 Z M 164 -1 L 164 -17 L 199 -16 L 198 -1 Z M 236 -2 L 236 -15 L 267 -15 L 266 -2 Z',C.wall,C.ink,2,'interior-low-table');
    path('interior-teapot-handle','M 143 -28 Q 176 -40 168 -13 M 109 -42 Q 117 -57 133 -48','none',C.ink,2,'interior-low-table');
    // A single standing oil lamp adds warmth without a cinematic glow layer.
    path('interior-oil-lamp','M 416 962 L 427 920 Q 414 897 430 878 Q 448 871 459 895 L 458 920 L 472 961 Z',C.roof,C.ink,2.4);
    ellipse('interior-oil-light',444,872,7,13,C.lit);
    // Uneven beams, knots, woven household items and foreground furniture.
    // Every group can be reused by several camera cuts of this one location.
    path('interior-crossbeams','M -460 329 Q 380 324 1180 332 M -460 335 Q 380 331 1180 336 M -460 916 Q 334 909 1180 917','none',C.wood,3.6);
    path('interior-beam-carving','M 4 249 q 28 11 65 0 M 189 249 q 16 -6 33 0 M 377 249 q 26 9 53 -2 M 611 250 q 23 7 43 -3','none',C.ink,1.25);
    path('interior-wood-knots','M 48 391 q -9 8 -1 18 q 12 5 9 -8 q -4 -8 -8 -10 M 334 514 q 10 -10 17 0 q 6 11 -7 14 q -8 -1 -10 -14 M 699 681 q 10 -11 17 0 q 4 14 -9 15 q -9 0 -8 -15','none',C.wood,1.55);
    group('interior-earthenware',60,879);
    path('interior-urn-body','M 11 19 Q -7 55 3 96 Q 8 119 35 124 Q 71 121 78 94 Q 82 60 61 19 Z',C.earth,C.ink,3,'interior-earthenware');
    path('interior-urn-mouth','M 6 20 Q 37 31 67 20 L 62 7 Q 38 3 13 7 Z',C.roof,C.ink,2,'interior-earthenware');
    path('interior-urn-grooves','M 15 64 Q 31 72 45 64 M 53 69 Q 63 64 68 59 M 16 101 Q 38 112 65 100','none',C.wood,1.7,'interior-earthenware');
    group('interior-stool',493,900);
    path('interior-stool-seat','M -30 0 Q 4 -10 51 0 L 48 13 Q 2 19 -29 13 Z',C.wood,C.ink,2,'interior-stool');
    path('interior-stool-legs','M -20 12 L -27 64 M 39 11 L 49 66 M -20 52 Q 13 59 43 54','none',C.wood,6,'interior-stool');
    path('interior-woven-mat','M 193 1003 Q 314 996 468 1007 L 494 1093 Q 321 1098 185 1083 Z',C.earth,C.ink,2.3);
    path('interior-mat-weave','M 205 1028 Q 333 1024 474 1033 M 197 1050 Q 331 1045 485 1057 M 192 1074 Q 329 1071 490 1082 M 223 1008 L 212 1080 M 266 1006 L 256 1089 M 324 1006 L 324 1096 M 385 1007 L 392 1094 M 441 1009 L 458 1090','none',C.wood,1);
    path('interior-rope-hook','M 499 321 Q 521 344 502 360 M 509 321 L 509 397','none',C.wood,3);
    path('interior-cloth-roll','M 500 390 Q 520 380 535 393 L 529 464 Q 507 470 498 461 Z',C.roof,C.ink,2);
    path('interior-cloth-folds','M 506 403 Q 512 419 508 441 M 523 400 Q 519 423 521 448','none',C.earth,1.25);

    if(finish==='handdrawn'){
      path('interior-wood-ink','M -300 420 q 2 43 -1 80 M 68 295 q -3 42 2 79 M 340 291 q 3 53 -2 86 M 667 301 q -4 60 1 99 M 103 830 q -1 44 2 68','none',C.ink,1.05);
      path('interior-floor-scuffs','M 49 1041 q 18 -4 34 -1 M 306 1150 q 20 -4 42 1 M 582 1089 q 18 -2 32 2','none',C.ink,.9);
    }
  }else{
    // Interior: real wall/floor junction, floor lines and door depth. Generic
    // hallway can represent a school, hospital, hotel or apartment via palette
    // + per-scene authored props and signage, without baking in a story.
    rect('room-back',0,0,720,976,C.wall);
    path('room-ceiling','M 0 0 L 720 0 L 720 125 L 0 155 Z',C.far);
    path('baseboard','M 0 947 L 720 947 L 720 975 L 0 975 Z',C.wood,C.ink,3);
    path('perspective-floor','M 0 977 L 720 977 L 720 1280 L 0 1280 Z',C.ground);
    for(let i=0;i<5;i++)path('floor-tile-'+i,`M 360 973 L ${-180+i*250} 1280`,'none',C.earth,1.7);
    for(let i=0;i<4;i++)path('floor-row-'+i,`M 0 ${1010+i*i*21} L 720 ${1010+i*i*21}`,'none',C.earth,1.5);
    for(let i=0;i<2;i++){
      const x=55+i*420,y=400+i*24;
      path('door-panel-'+i,`M ${x} ${y} L ${x+150} ${y} L ${x+150} 948 L ${x} 948 Z`,C.wood,C.ink,4);
      path('door-inset-'+i,`M ${x+18} ${y+33} L ${x+132} ${y+33} L ${x+132} 904 L ${x+18} 904 Z`,'none',C.earth,2);
      ellipse('door-knob-'+i,x+127,730,8,8,C.lit);
      rect('over-door-window-'+i,x+12,y+15,126,8,C.earth);
    }
    for(let i=0;i<3;i++){
      const x=148+i*211;
      path('ceiling-lamp-'+i,`M ${x-25} 159 L ${x+25} 159 L ${x+40} 174 L ${x-39} 174 Z`,C.earth);
      ellipse('ceiling-glow-'+i,x,173,11,3,C.lit);
    }
    // Architectural rhythm and believable prop silhouettes give the interior
    // depth even when no characters are present. Story-specific signs and
    // objects can still be composed into the same world on later shots.
    for(let i=0;i<4;i++){
      const x=7+i*232;
      path('wall-batten-'+i,`M ${x} 184 L ${x} 948`,'none',C.earth,2.2);
      path('wall-border-'+i,`M ${x+4} 190 L ${x+4} 942`,'none',C.ink,.8);
      rect('wall-plaque-'+i,x+18,290,57,34,i%2===0?C.mid:C.earth);
      path('plaque-hatch-'+i,`M ${x+23} 299 L ${x+62} 299 M ${x+23} 306 L ${x+49} 306 M ${x+23} 313 L ${x+57} 313`,'none',C.wall,1.6);
    }
    rect('low-cabinet',257,792,135,155,C.wood);
    path('low-cabinet-doors','M 323 805 L 323 938 M 269 817 L 380 817 M 269 920 L 380 920','none',C.ink,1.8);
    ellipse('low-cabinet-knob-l',311,859,3.7,3.7,C.lit);
    ellipse('low-cabinet-knob-r',334,859,3.7,3.7,C.lit);
    path('wall-cornice','M 0 185 Q 359 195 720 185 M 0 209 Q 360 215 720 209','none',C.earth,3);
  }
  if(finish==='handdrawn'&&['village','forest','waterside'].includes(place)&&!elevated){
    // The reference uses purposeful irregular mountain peaks and foreground
    // marks rather than mechanically repeated, perfectly smooth horizon bands.
    const mountains=N.find(n=>n.id==='mountains-back');
    if(mountains)mountains.d='M 0 653 L 0 542 Q 51 526 83 545 L 151 481 Q 162 451 173 481 L 210 532 Q 239 545 268 516 L 338 450 Q 349 431 359 457 L 411 540 Q 443 521 481 531 L 579 464 Q 589 453 599 480 L 634 522 Q 688 488 720 527 L 720 716 Z';
    const foothills=N.find(n=>n.id==='mountains-shade');
    if(foothills)foothills.d='M 0 699 L 0 609 Q 64 555 151 594 Q 204 553 255 619 Q 314 575 366 599 Q 413 558 468 584 Q 547 543 598 611 Q 663 572 720 616 L 720 754 Z';
    // A few deliberate pines mark the foothill scale in the sample. Rendered
    // as two compound inked paths, not hundreds of individual sprite nodes.
    const pines=[
      [-4,671,14],[33,683,11],[123,662,19],[205,690,12],
      [274,679,15],[431,671,17],[495,680,13],[622,668,20],[683,676,15],
    ] as const;
    const pineOutline=pines.map(([x,y,s])=>
      `M ${x} ${y} L ${x-s*.7} ${y-s*.6} L ${x-s*.27} ${y-s*.6} L ${x-s*.64} ${y-s*1.13} L ${x-s*.2} ${y-s*1.13} L ${x} ${y-s*1.7} L ${x+s*.2} ${y-s*1.13} L ${x+s*.64} ${y-s*1.13} L ${x+s*.27} ${y-s*.6} L ${x+s*.7} ${y-s*.6} Z`).join(' ');
    path('handdrawn-distant-pines',pineOutline,C.plantShade,C.ink,.95);
  }
  if(finish==='handdrawn'&&place==='village'&&!elevated){
    // Domestic details are a reusable visual language, not a script about
    // a particular village. They sit *behind* the hero and supporting cast.
    const lane=N.find(n=>n.id==='village-street');
    if(lane)lane.d='M 293 938 Q 271 993 261 1045 Q 222 1133 158 1280 L 614 1280 Q 521 1156 472 1073 Q 438 1004 407 943 Z';
    path('worn-lane-edging','M 294 944 Q 268 1026 235 1117 Q 194 1193 166 1275 M 407 946 Q 445 1036 486 1104 Q 563 1220 600 1274','none',C.ink,1.55);
    path('worn-lane-stones','M 294 1065 Q 310 1054 334 1063 L 339 1072 Q 316 1078 292 1074 Z M 399 1163 Q 431 1152 458 1165 L 457 1175 Q 427 1182 396 1174 Z M 261 1226 Q 285 1219 309 1226 L 308 1238 Q 282 1242 256 1234 Z',C.earth,C.ink,1.5);
    path('worn-lane-ruts','M 319 971 Q 305 1014 299 1051 M 385 976 Q 413 1056 423 1119','none',C.earth,1.5);
    path('handdrawn-fence-texture','M 89 835 q 2 27 1 57 M 176 838 q -2 25 1 54 M 341 837 l 1 58 M 505 841 q -2 27 0 54','none',C.earth,1.15);
    group('crockery',601,890);
    path('clay-urn','M 13 21 Q -1 46 4 74 Q 9 96 35 98 Q 62 98 68 74 Q 70 46 55 21 Z',C.earth,C.ink,2.5,'crockery');
    path('clay-urn-neck','M 9 21 Q 35 27 60 21 L 56 10 Q 34 6 14 10 Z',C.roof,C.ink,1.8,'crockery');
    path('clay-urn-grooves','M 14 55 q 12 6 24 2 M 45 57 q 10 -2 14 -8 M 16 80 q 23 9 43 -1','none',C.wood,1.3,'crockery');
    group('woven-basket',62,914);
    path('basket-shape','M 0 13 Q 28 24 62 13 L 55 57 Q 32 68 7 56 Z',C.earth,C.ink,1.5,'woven-basket');
    path('basket-rim','M -2 13 Q 30 6 64 13','none',C.wood,5,'woven-basket');
    path('basket-weave','M 5 29 Q 33 37 60 29 M 9 43 Q 33 52 57 43 M 12 54 Q 34 63 54 55','none',C.wood,1.15,'woven-basket');
    path('seedlings','M 5 974 q 1 -25 -17 -39 m 17 39 q 12 -34 25 -38 m 601 65 q 2 -29 -14 -43 m 14 43 q 10 -31 29 -39 m -28 39 q -13 -11 -28 -15','none',C.plantShade,2);
    path('small-grass-clumps','M 119 983 l -9 -15 m 9 15 l 1 -21 m -1 21 l 15 -12 M 484 1009 l -8 -12 m 8 12 l 0 -20 m 0 20 l 12 -12','none',C.plant,1.7);
    path('scattered-roof-straw','M 23 698 l 7 -6 m 4 11 l 8 -5 M 506 640 l 8 -7 m 12 12 l 7 -6','none',C.earth,1.3);
  }
  if(setting==='market'&&place==='village'&&!elevated){
    // Optional lived-in market dressing. The AI must select this setting from
    // the story; a silent village never receives unexplained stalls/lanterns.
    group('market-stall',551,765);
    path('market-stall-posts','M 11 24 L 11 180 M 156 25 L 156 180','none',C.wood,8,'market-stall');
    path('market-stall-awning','M -21 31 Q 1 -17 54 -20 Q 119 -29 177 27 L 163 41 Q 150 34 138 43 Q 125 37 113 45 Q 101 39 87 46 Q 65 37 52 45 Q 31 37 15 43 Q 0 38 -13 43 Z',C.earth,C.ink,2.6,'market-stall');
    path('market-stall-awning-ink','M -12 25 Q 40 5 82 8 Q 132 5 172 27 M 10 42 q 6 -4 11 -2 m 29 3 q 6 -4 12 0 m 40 0 q 7 -5 13 0','none',C.roof,1.5,'market-stall');
    path('market-stall-counter','M 0 114 Q 81 110 168 114 L 165 128 Q 80 124 2 130 Z',C.wood,C.ink,2.1,'market-stall');
    path('market-stall-goods','M 20 112 Q 12 92 27 90 Q 43 90 42 112 Z M 55 111 Q 49 88 62 91 Q 77 91 80 112 Z M 105 112 Q 99 93 112 88 Q 128 90 130 112 Z',C.wall,C.ink,1.8,'market-stall');
    group('market-sign',365,637);
    path('market-sign-poles','M 4 0 L 4 204 M 121 0 L 121 196 M 4 19 L 121 16','none',C.wood,6,'market-sign');
    path('market-sign-board','M 20 18 Q 69 23 108 17 L 110 69 Q 70 74 19 69 Z',C.roof,C.ink,2.5,'market-sign');
    path('market-sign-carving','M 30 31 q 12 7 23 0 M 61 31 q 10 5 17 -1 M 38 51 Q 64 46 91 52','none',C.lit,2,'market-sign');
    path('market-lantern-cords','M 21 69 L 21 83 M 105 70 L 105 84','none',C.wood,1.8,'market-sign');
    ellipse('market-lantern-l',386,741,10,14,light==='night'?C.lit:'#b36751');
    ellipse('market-lantern-r',469,743,10,14,light==='night'?C.lit:'#b36751');
    path('market-lantern-tassels','M 386 756 l -2 7 M 469 758 l 2 7','none',C.roof,1.5);
    path('market-basket','M 635 914 Q 655 908 677 916 L 670 954 Q 653 962 641 953 Z',C.earth,C.ink,1.8);
    if(finish==='handdrawn'){
      // A distinct foreground thatch stall, not a fourth copy of the same
      // hut. Group/local coordinates keep it reusable with the same stage.
      group('market-thatch-stall',-245,788);
      path('market-thatch-roof','M -43 48 Q -32 22 0 16 Q 51 -19 111 0 Q 159 -3 198 40 L 190 57 Q 166 53 152 61 Q 126 53 111 63 Q 82 51 65 61 Q 37 52 22 60 Q -13 51 -38 59 Z',C.earth,C.ink,3.3,'market-thatch-stall');
      path('market-thatch-straw',Array.from({length:13},(_,i)=>{
        const x=-23+i*16,yy=i%3*2+45;return `M ${x} ${yy} q -5 -14 3 -25 M ${x+4} ${yy+6} l 0 9`;
      }).join(' '),'none',C.wood,1.65,'market-thatch-stall');
      path('market-thatch-support','M -5 53 L -5 187 M 168 55 L 168 186 M -12 150 Q 80 144 176 149','none',C.wood,8,'market-thatch-stall');
      path('market-thatch-counter','M -26 144 Q 72 151 186 143 L 183 162 Q 76 167 -23 161 Z',C.wood,C.ink,2.6,'market-thatch-stall');
      path('market-thatch-baskets','M -3 142 q 3 -26 25 -20 q 22 3 20 21 Z M 59 145 q -1 -30 25 -32 q 28 0 29 30 Z M 137 146 q 0 -29 20 -29 q 17 0 20 27 Z',C.wall,C.ink,1.8,'market-thatch-stall');
      path('market-thatch-weave','M -3 134 q 23 8 45 0 M 63 130 q 21 11 45 0 M 142 132 q 16 6 32 -1 M 70 114 q 4 17 2 29 m 14 -27 q 2 16 0 29','none',C.wood,1.3,'market-thatch-stall');
      path('market-thatch-shadows','M -8 187 Q 69 196 167 187 M 10 171 Q 79 174 156 169','none',C.ink,1.25,'market-thatch-stall');
      // Small hanging pieces and plant shapes make a *market* legible at
      // mobile size; keep these out of residential/forest scenes.
      path('market-pennant-cord','M 210 697 Q 345 710 514 692','none',C.wood,1.8);
      path('market-fabric-bunting','M 226 699 l 7 26 l 18 -27 Z M 277 702 l 9 24 l 16 -23 Z M 341 703 l 8 22 l 17 -24 Z M 406 702 l 8 25 l 18 -27 Z M 469 696 l 8 24 l 18 -26 Z',C.roof,C.ink,1.1);
      path('market-dry-leaves','M -118 969 q 14 -14 30 -2 m -22 4 q 0 -16 9 -24 M 708 974 q -5 -22 10 -32 m -10 32 q 12 -16 26 -13','none',C.plantShade,2.1);
    }
  }
  if(festival==='tet'){
    // Tet dressing shares the location palette/ink so new props never drift
    // style. Deterministic geometry: same stage survives cuts and rerenders.
    // Elevated market is a different projection: dress the plaza, not the
    // eye-level lane coordinates.
    if(elevated){
      for(const side of [0,1] as const){
        const bx=side===0?180:540,by=1060;
        group('tet-mai-'+side,bx,by);
        path('tet-mai-pot-'+side,'M -26 0 L 26 0 L 19 36 L -19 36 Z',C.wood,C.ink,2.2,'tet-mai-'+side);
        path('tet-mai-branches-'+side,'M 0 0 Q -6 -40 -28 -62 M 0 0 Q 2 -48 16 -68 M 0 0 Q 12 -36 30 -48','none',C.wood,2.6,'tet-mai-'+side);
        path('tet-mai-blooms-'+side,'M -38 -62 q 7 -9 14 -2 q 7 -7 13 0 q 7 -6 12 2 M 4 -74 q 7 -9 14 -2 q 7 -6 12 1 M 22 -52 q 7 -8 13 -1 q 6 -6 11 1','none',C.lit,4,'tet-mai-'+side);
      }
      // Couplets flank the mid house door (house-mid at 535,710 174x125).
      path('tet-couplet-l','M 560 736 L 574 736 L 574 820 L 560 820 Z','#a63d32',C.ink,1.6);
      path('tet-couplet-r','M 660 736 L 674 736 L 674 820 L 660 820 Z','#a63d32',C.ink,1.6);
      path('tet-neu-pole','M 90 700 L 90 980','none',C.wood,4);
      path('tet-neu-flag','M 90 700 L 126 712 L 90 726 Z','#a63d32',C.ink,1.4);
      path('tet-lantern-string','M 120 780 Q 360 806 600 778','none',C.wood,1.8);
      for(let i=0;i<3;i++){
        const x=180+i*150;
        ellipse('tet-lantern-'+i,x,796,10,14,light==='night'?C.lit:'#b65e49');
      }
      // Live barnyard rigs (simple-chicken/simple-snake) play these roles;
      // static copies were removed to leave budget for cast and story props.
    }else{
      // Eye-level lane dressing.
      for(const side of [0,1] as const){
        const bx=side===0?150:545,by=1010;
        group('tet-mai-'+side,bx,by);
        path('tet-mai-pot-'+side,'M -26 0 L 26 0 L 19 36 L -19 36 Z',C.wood,C.ink,2.2,'tet-mai-'+side);
        path('tet-mai-branches-'+side,'M 0 0 Q -6 -40 -28 -62 M 0 0 Q 2 -48 16 -68 M 0 0 Q 12 -36 30 -48','none',C.wood,2.6,'tet-mai-'+side);
        path('tet-mai-blooms-'+side,'M -38 -62 q 7 -9 14 -2 q 7 -7 13 0 q 7 -6 12 2 M 4 -74 q 7 -9 14 -2 q 7 -6 12 1 M 22 -52 q 7 -8 13 -1 q 6 -6 11 1','none',C.lit,4,'tet-mai-'+side);
      }
      // Red couplets on the mid house + one neu pole + lantern string.
      // No text glyphs: red bands read as couplets at mobile size.
      path('tet-couplet-l','M 44 726 L 62 726 L 62 830 L 44 830 Z','#a63d32',C.ink,1.6);
      path('tet-couplet-r','M 202 726 L 220 726 L 220 830 L 202 830 Z','#a63d32',C.ink,1.6);
      path('tet-neu-pole','M 648 700 L 648 980','none',C.wood,4);
      path('tet-neu-flag','M 648 700 L 684 712 L 648 726 Z','#a63d32',C.ink,1.4);
      ellipse('tet-neu-bell',666,734,5,7,C.lit);
      path('tet-lantern-string','M 90 690 Q 360 716 630 688','none',C.wood,1.8);
      for(let i=0;i<3;i++){
        const x=150+i*170;
        ellipse('tet-lantern-'+i,x,706,10,14,light==='night'?C.lit:'#b65e49');
      }
    }
  }
  if(finish==='handdrawn'&&place==='corridor'){
    path('interior-board-ink','M 24 242 q 3 55 1 109 M 230 226 q -2 69 2 119 M 500 230 q 2 67 -2 124','none',C.earth,1.35);
    path('interior-floor-ink','M 30 1096 q 80 -5 146 0 M 426 1151 q 85 -4 154 2','none',C.ink,.9);
    path('interior-door-ink','M 64 423 q -3 66 0 128 M 480 455 q 2 65 -1 131','none',C.ink,1);
  }
  if(!['corridor','rural-interior','street'].includes(place)&&!elevated)smallDetails();
  if(finish==='handdrawn'&&place!=='corridor'&&place!=='rural-interior'){
    // Deliberate short dry-brush contours: stable across frames and rerenders.
    // No per-frame random noise, textures, or fake 3D lighting.
    path('handdrawn-ground-inks','M 23 1040 q 17 -5 28 -1 M 450 1066 q 22 -6 42 -1 M 102 1156 q 18 -3 30 0 M 581 1208 q 15 -4 33 0','none',C.ink,1.1);
    path('handdrawn-earth-specks','M 58 1001 l 5 -2 M 238 1108 q 5 -3 11 -1 M 365 1056 l 8 1 M 646 1127 q 9 -1 13 2','none',C.earth,1.25);
  }
  // Neutral placeholder; caller-supplied cast always replaces this slot. It
  // deliberately carries NO global costume or mandatory character style.
  if(finish==='handdrawn')for(const n of N){
    if(n.stroke&&n.stroke!=='none'&&n.strokeWidth!==undefined&&n.strokeWidth>0&&n.strokeWidth<5.5
      &&!/mountains|cloud|star|reflection/.test(n.id)){
      n.strokeWidth=Math.min(5.5,n.strokeWidth*(n.strokeWidth>=1.7?1.34:1.13));
    }
  }
  // An elevated native house has a 70–80 unit doorway. Its default person
  // must fit that doorway; a close reaction comes from the camera, never
  // from enlarging the actor relative to the same architecture.
  const actorHeight=elevated?(wideMarket?155:finish==='handdrawn'?80:190):285;
  N.push({id:'person',type:'instance',x:elevated?350:255,asset:'illustrated-place-person',width:actorHeight*(elevated?122/190:180/285),height:actorHeight});
  const world={width:720,height:1280,nodes:N,ground:{y:actorFloor,targets:[{target:'person'}]},tracks:T};
  if(frame&&frame.width>frame.height){
    // Illustrated 16:9 frame should not leave half of the image as empty sky.
    // Zoom the WHOLE authored world, never only actors, props or a lone roof.
    // Existing clean stages and elevated bird's-eye views are unchanged.
    const scale=frame.height/(finish==='handdrawn'&&!elevated?900:1080),offset=(frame.width-720*scale)/2;
    const left=-offset/scale,right=(frame.width-offset)/scale,span=right-left;
    // Sky objects must actually be inside a landscape frame. Reusing portrait
    // y=188 put the moon above the top edge after the scenic world transform.
    if(finish==='handdrawn'&&!elevated){
      const worldY=frame.height*.86-980*scale;
      const moon=N.find(n=>n.id==='moon');if(moon)moon.y=(frame.height*.12-worldY)/scale;
      for(const n of N.filter(n=>n.id.startsWith('star-'))){
        const i=Number(n.id.slice(5));n.x=left+(right-left)*(.08+hash(i)*.84);
        n.y=(frame.height*(.045+hash(i+14)*.17)-worldY)/scale;
      }
      const clouds=N.find(n=>n.id==='thin-clouds');if(clouds)clouds.y=120;
    }
    // Scenic horizon bands span the output, while people/buildings keep their
    // uniform local proportions. Never present a portrait island inside 16:9.
    const bands=new Set(['thin-clouds','mountains-back','mountains-shade','distant-leaves','middle-ground','ground-edge','water-plane','far-shore','bank-rim','pavement']);
    for(const n of N)if(bands.has(n.id)){n.x=(n.x??0)+left;n.scaleX=span/720;}
    if(!elevated&&(place==='village'||place==='waterside')){
      const foreground=N.length;
      house('landscape-house-left',left+(finish==='handdrawn'?115:80),finish==='handdrawn'?794:742,finish==='handdrawn'?240:210,finish==='handdrawn'?164:190);
      house('landscape-house-right',right-(finish==='handdrawn'?325:285),finish==='handdrawn'?676:710,finish==='handdrawn'?225:215,finish==='handdrawn'?235:215);
      foliage('landscape-tree-left',left+370,967,.8);
      foliage('landscape-tree-right',right-(finish==='handdrawn'?118:410),finish==='handdrawn'?1075:957,finish==='handdrawn'?1.28:.7);
      // Put flanking architecture behind foreground detail and the cast.
      const sideNodes=N.splice(foreground);
      const insert=N.findIndex(n=>n.id==='house-back');
      N.splice(insert,0,...sideNodes);
    }
    if(finish==='handdrawn'&&!elevated&&place==='forest'){
      const at=N.findIndex(n=>n.id==='person'),from=N.length;
      foliage('landscape-tree-left',left+76,1080,1.8);
      foliage('landscape-tree-right',right-52,1100,1.65);
      N.splice(at,0,...N.splice(from));
    }
    N.splice(1,0,{id:'illustrated-world',type:'group',x:offset,y:elevated?frame.height*.92-(inkV2&&!wideMarket?1080:1280)*scale:frame.height*.86-980*scale,scaleX:scale,scaleY:scale});
    for(const n of N){
      if(n.id==='paint-sky'){n.width=frame.width;n.height=frame.height;continue;}
      if(n.id!=='illustrated-world'&&!n.parent)n.parent='illustrated-world';
      if(n.id==='physical-ground-plane'){n.x=-offset/scale;n.width=frame.width/scale;n.height=1600;}
    }
    world.width=frame.width;world.height=frame.height;
    Object.assign(world.ground,{parent:'illustrated-world'});
  }
  // One stable compound starfield leaves room in the existing node budget
  // for story props and background people; it paints the same small dots.
  if(finish==='handdrawn'){
    const stars=N.filter(n=>n.id.startsWith('star-'));
    if(stars.length){
      const at=N.indexOf(stars[0]!),starSet=new Set(stars);
      const d=stars.map(n=>`M ${(n.x??0)-n.rx!} ${n.y} a ${n.rx} ${n.ry} 0 1 0 ${n.rx!*2} 0 a ${n.rx} ${n.ry} 0 1 0 ${-n.rx!*2} 0 Z`).join(' ');
      const retained=N.filter(n=>!starSet.has(n));retained.splice(at,0,{id:'night-stars',type:'path',d,fill:'#ddd9c7',parent:stars[0]!.parent});
      N.splice(0,N.length,...retained);
    }
  }
  const finished=inkV2?{...world,nodes:handInkDrawing(world).nodes}:world;
  return {assets:{'illustrated-place-person':{rig:'simple-puppet',hair:'short',outfit:'tunic',...(inkV2?{artStyle:FOLK_INK_STYLE}:{}),
    palette:{skin:'#e7d1b8',shirt:'#718376',hair:'#393334',trim:'#ceb997',accent:'#a28c73',inner:'#e6dcc9'}}},stage:finished};
}
