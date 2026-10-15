import type {VectorNode} from '../../shared/canvasVectorScene';
import {approvedCourtyard,type CourtyardLight} from './canvasVectorApprovedCourtyard';
import {FOLK_INK_STYLE} from '../../shared/canvasVectorInk';

/** Reusable setting, without a screenplay or camera. Contact objects have
 * deliberate dimensions/anchors so different models need not guess anatomy. */
export function vectorCourtyard(frame?:{width:number;height:number},options?:{artStyle?:typeof FOLK_INK_STYLE;light?:CourtyardLight}){
  if(options?.artStyle===FOLK_INK_STYLE)return approvedCourtyard(frame,options.light,'upright');
  const ink='#25211c';
  const nodes:VectorNode[]=[];
  const path=(id:string,d:string,fill:string,stroke=ink,width=3,parent?:string)=>nodes.push({id,type:'path',d,fill,stroke,strokeWidth:width,...(parent?{parent}:{})});
  const rect=(id:string,x:number,y:number,width:number,height:number,fill:string,parent?:string)=>nodes.push({id,type:'rect',x,y,width,height,fill,stroke:ink,strokeWidth:3,...(parent?{parent}:{})});
  nodes.push({id:'sky',type:'rect',width:720,height:1280,fill:'#293b55'});
  path('far-hills','M 0 540 L 0 418 Q 85 380 156 435 Q 248 332 328 424 Q 410 370 465 428 Q 570 350 720 425 L 720 600 Z','#465a6b','#374955',2);
  path('near-hills','M 0 600 L 0 535 Q 150 450 250 530 Q 370 470 460 535 Q 600 450 720 515 L 720 700 Z','#536b68','#344b4b',2);
  nodes.push({id:'moon',type:'ellipse',x:582,y:295,rx:26,ry:26,fill:'#fff2c6',light:{kind:'moon',radius:88}});
  const fence=(left:number,right:number)=>{
    const sticks=Array.from({length:Math.ceil((right-left)/30)+1},(_,i)=>{const x=left+i*30;return `M ${x} 864 L ${x-1} 777 L ${x+6} 766 L ${x+13} 777 L ${x+14} 864 Z`;});
    return Array.from({length:Math.ceil(sticks.length/18)},(_,i)=>sticks.slice(i*18,i*18+18).join(' '));
  };
  fence(0,720).forEach((d,i)=>path(i?'distant-fence-'+i:'distant-fence',d,'#9b855a',ink,2.4));
  path('fence-rails','M 0 800 Q 350 795 720 803 M 0 833 Q 360 826 720 834','none','#544b36',6);
  rect('yard-floor',0,850,720,430,'#9b896c');
  nodes.push({id:'physical-ground-plane',type:'rect',y:980,width:720,height:940,fill:'#9b896c'});
  path('yard-back-shadow','M 0 862 Q 320 829 720 880 L 720 984 Q 360 924 0 966 Z','#85795f','none');
  nodes.push({id:'house',type:'group',x:276,y:462,width:658,height:518,bounds:{x:-210,y:12,width:658,height:506},groundAnchor:{x:215,y:518}});
  path('house-wall','M -180 118 Q 110 113 420 118 L 420 506 Q 100 511 -180 506 Z','#9b7958',ink,4,'house');
  path('house-wall-shade','M -180 118 L 420 118 L 420 158 L -180 150 Z','#705840',ink,2,'house');
  for(let x=-161;x<420;x+=37)path('wall-plank-'+x,`M ${x} 158 Q ${x-2} 328 ${x} 492`,'none','#6a523e',1.6,'house');
  path('roof','M -210 131 Q -131 75 -87 12 Q 135 29 338 17 Q 381 84 448 132 L 422 154 Q 104 143 -187 154 Z','#a38b59',ink,5.2,'house');
  path('roof-eaves','M -210 131 Q 109 121 448 132 L 422 154 Q 104 143 -187 154 Z','#6b5436',ink,2.8,'house');
  path('roof-ridge','M -90 12 Q 135 29 338 17 L 347 30 Q 134 41 -97 25 Z','#c0a26b',ink,2.5,'house');
  // Short irregular straw strokes follow the roof's slope. A full intersecting
  // grid looked like a net stretched across a plain curved rectangle.
  for(let i=0;i<6;i++)for(let j=0;j<11;j++){
    const y=48+i*14,x=-90-i*17+j*(40+i*3),lean=(x-120)*.025;
    path(`roof-straw-${i}-${j}`,`M ${x} ${y} l ${lean-3} 8 m 7 -6 l ${lean-2} 7`,'none',i%2?'#775c43':'#c3a77d',1.2,'house');
  }
  rect('window-void',44,202,80,99,'#f1ce86','house');
  path('window-bars','M 44 231 L 124 231 M 44 269 L 124 269 M 70 202 L 70 301 M 98 202 L 98 301','none','#493e32',5,'house');
  rect('window-sill',35,303,98,12,'#6c5844','house');
  rect('house-base',-188,496,620,22,'#81704f','house');
  rect('side-window-void',-139,214,108,92,'#e5c28a','house');
  path('side-window-bars','M -139 244 L -31 244 M -139 275 L -31 275 M -104 214 L -104 306 M -66 214 L -66 306','none','#493c2d',4,'house');
  rect('side-window-sill',-146,307,123,11,'#6b5436','house');
  rect('door-opening',438,597,164,383,'#17212c');
  nodes.push({id:'door',type:'group',x:450,y:610,groundAnchor:{x:70,y:370}});
  rect('door-frame',-12,-13,164,383,'#4e4437','door');
  rect('door-left',0,0,68,358,'#786149','door');
  rect('door-right',72,0,68,358,'#705a45','door');
  rect('door-void',68,0,4,358,'#111a20','door');
  path('door-planks','M 22 4 L 22 354 M 45 4 L 45 354 M 95 4 L 95 354 M 118 4 L 118 354','none','#4d4437',2,'door');
  path('door-grain','M 28 145 Q 16 165 29 190 M 107 54 Q 96 73 107 91 M 126 245 Q 116 272 126 287','none','#9b8363',2,'door');
  rect('door-threshold',-18,358,176,12,'#a89d80','door');
  nodes.push({id:'ring',type:'instance',parent:'door',asset:'folk-courtyard-ring',x:30,y:210,width:40,height:56,pivotX:20,pivotY:4});
  path('lamp-hook','M 650 620 L 650 681 Q 650 692 642 692','none',ink,5);
  nodes.push({id:'lamp',type:'instance',asset:'folk-courtyard-lamp',x:614,y:690,width:56,height:94});
  path('stone-path','M 486 986 L 548 986 Q 553 1100 700 1280 L 254 1280 Q 420 1114 486 986 Z','#96917b',ink,2);
  Object.assign(nodes[nodes.length-1]!,{width:720,height:1280});
  for(let i=0;i<6;i++){
    const y=1009+i*49,left=480-i*30,right=549+i*24;
    path('path-joint-'+i,`M ${left} ${y} Q 510 ${y-6} ${right} ${y+5}`,'none','#605f53',2);
    path('path-stone-'+i,`M ${511+(i%2?16:-9)} ${y} L ${497+(i%2?22:-11)} ${y+45}`,'none','#605f53',2);
  }
  nodes.push({id:'tree',type:'group',width:280,height:985});
  path('tree-trunk','M 69 977 Q 90 821 79 638 L 58 588 L 94 607 L 122 549 L 132 566 L 107 640 Q 114 827 134 977 Z','#76694f',ink,4,'tree');
  path('tree-bark','M 94 683 Q 103 822 91 944 M 114 802 L 120 929 M 85 746 L 87 819','none','#4a493c',2,'tree');
  path('tree-canopy-0','M -20 565 Q -37 537 -13 516 Q -23 482 14 471 Q 22 443 55 453 Q 72 420 110 433 Q 146 408 175 437 Q 211 426 230 460 Q 264 459 267 492 Q 294 509 276 541 Q 291 571 260 589 Q 250 620 212 613 Q 190 641 154 624 Q 118 644 91 623 Q 51 638 33 610 Q -4 612 -20 589 Z','#5e7859',ink,3,'tree');
  path('tree-canopy-1','M -16 565 Q 25 582 43 559 Q 66 594 102 569 Q 125 603 157 582 Q 187 604 218 577 Q 246 592 275 558 Q 283 585 260 589 Q 250 620 212 613 Q 190 641 154 624 Q 118 644 91 623 Q 51 638 33 610 Q -4 612 -16 589 Z','#49634c','none',0,'tree');
  path('tree-canopy-2','M 18 493 Q 33 461 61 475 Q 89 445 114 459 M 145 459 Q 169 444 189 465 M 206 493 Q 236 480 251 508','none','#78916b',4,'tree');
  path('tree-leaf-lines','M 44 536 Q 69 554 57 575 M 129 475 Q 111 496 131 510 M 193 523 Q 218 544 202 560','none','#405942',2,'tree');
  path('tree-root','M 43 983 Q 79 970 89 958 M 109 957 Q 136 980 159 982','none',ink,3,'tree');
  // Set dressing stays outside the person-to-door contact corridor.
  nodes.push({id:'water-jar',type:'group',x:628,y:905,width:64,height:75});
  path('jar-body','M 10 13 Q -4 32 5 59 Q 11 75 31 75 Q 55 75 60 58 Q 68 31 51 13 Z','#886b54',ink,2.5,'water-jar');
  path('jar-shoulder','M 10 17 Q 31 27 51 17 M 7 42 Q 31 53 60 42','none','#ab8a68',2,'water-jar');
  nodes.push({id:'jar-mouth',type:'ellipse',parent:'water-jar',x:31,y:13,rx:21,ry:6,fill:'#303732',stroke:ink,strokeWidth:2.5});
  path('window-awning','M 35 193 L 132 193 L 125 207 L 42 207 Z','#705743',ink,2,'house');
  for(const [i,x,y] of [[0,19,1012],[1,167,1091],[2,62,1192],[3,695,1038]] as const){
    path('grass-'+i,`M ${x} ${y} l -12 -29 l 18 19 l 7 -37 l 7 36 l 18 -22 l -10 33 Z`,'#455e47',ink,2);
    path('stone-'+i,`M ${x+22} ${y+9} q 6 -15 22 -10 l 12 11 Z`,'#8d8d78',ink,2);
  }
  nodes.push({id:'person',type:'instance',asset:'folk-courtyard-person',x:185,width:212,height:330});
  nodes.push({id:'lamp-mount',type:'group'});
  for(const n of nodes)if(n.id==='lamp'||n.id==='lamp-hook')n.parent='lamp-mount';
  const stage={width:720,height:1280,nodes,ground:{y:980,targets:[{target:'person'},{target:'door',anchor:{x:70,y:370}},{target:'house',anchor:{x:215,y:518}}]},tracks:[]};
  if(frame&&frame.width>frame.height){
    // Keep actor/prop proportions and all local contact coordinates intact.
    // Widen only the scenery planes; a portrait world must never be stretched.
    const scale=frame.height/960,offset=(frame.width-720*scale)/2;
    const world:VectorNode={id:'courtyard-world',type:'group',x:offset,y:frame.height*.86-980*scale,scaleX:scale,scaleY:scale};
    const fenceAt=nodes.findIndex(n=>n.id==='distant-fence');
    for(let i=nodes.length-1;i>=0;i--)if(/^distant-fence(?:-\d+)?$/.test(nodes[i]!.id))nodes.splice(i,1);
    nodes.splice(fenceAt,0,...fence(-offset/scale,(frame.width-offset)/scale).map((d,i):VectorNode=>({id:i?'distant-fence-'+i:'distant-fence',type:'path',d,fill:'#9b855a',stroke:ink,strokeWidth:2.4})));
    for(const n of nodes){
      if(n.id==='sky'){n.width=frame.width;n.height=frame.height;continue;}
      if(!n.parent)n.parent=world.id;
      if(['far-hills','near-hills','fence-rails','yard-back-shadow'].includes(n.id)){n.x=-offset/scale;n.scaleX=frame.width/(720*scale);}
      if(['yard-floor','physical-ground-plane'].includes(n.id)){n.x=-offset/scale;n.width=frame.width/scale;}
    }
    nodes.splice(1,0,world);
    stage.width=frame.width;stage.height=frame.height;
    Object.assign(stage.ground,{parent:world.id});
  }
  return {assets:{
    'folk-courtyard-person':{rig:'simple-puppet',outfit:'ao-dai',hair:'bun',palette:{shirt:'#785e74',accent:'#b48c9a',inner:'#ede1c6',trim:'#d1bd87',skin:'#ead2b3'}},
    'folk-courtyard-lamp':{rig:'lantern'},
    'folk-courtyard-ring':{width:40,height:56,nodes:[
      {id:'mount',type:'ellipse',x:20,y:4,rx:7,ry:4,fill:'#ac925c',stroke:ink,strokeWidth:2},
      {id:'ring',type:'ellipse',x:20,y:31,rx:15,ry:19,fill:'none',stroke:'#d5b66d',strokeWidth:6},
      {id:'ring-inner',type:'ellipse',x:20,y:31,rx:15,ry:19,fill:'none',stroke:ink,strokeWidth:1.5},
    ]},
  },stage};
}
