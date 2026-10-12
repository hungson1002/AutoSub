import type {VectorNode} from '../../shared/canvasVectorScene';

/** Reusable setting, without a screenplay or camera. Contact objects have
 * deliberate dimensions/anchors so different models need not guess anatomy. */
export function vectorCourtyard(frame?:{width:number;height:number}){
  const ink='#202b2b';
  const nodes:VectorNode[]=[];
  const path=(id:string,d:string,fill:string,stroke=ink,width=3,parent?:string)=>nodes.push({id,type:'path',d,fill,stroke,strokeWidth:width,...(parent?{parent}:{})});
  const rect=(id:string,x:number,y:number,width:number,height:number,fill:string,parent?:string)=>nodes.push({id,type:'rect',x,y,width,height,fill,stroke:ink,strokeWidth:3,...(parent?{parent}:{})});
  nodes.push({id:'sky',type:'rect',width:720,height:1280,fill:'#293b55'});
  path('far-hills','M 0 540 L 0 418 Q 85 380 156 435 Q 248 332 328 424 Q 410 370 465 428 Q 570 350 720 425 L 720 600 Z','#465a6b','#374955',2);
  path('near-hills','M 0 600 L 0 535 Q 150 450 250 530 Q 370 470 460 535 Q 600 450 720 515 L 720 700 Z','#536b68','#344b4b',2);
  nodes.push({id:'moon',type:'ellipse',x:582,y:295,rx:26,ry:26,fill:'#fff2c6',light:{kind:'moon',radius:88}});
  path('distant-fence','M 0 790 L 720 790 M 0 824 L 720 824 M 20 760 L 20 870 M 65 756 L 65 870 M 112 765 L 112 870 M 158 770 L 158 870 M 205 775 L 205 870 M 680 765 L 680 870 M 715 760 L 715 870','none','#354a43',7);
  rect('yard-floor',0,850,720,430,'#777c67');
  nodes.push({id:'physical-ground-plane',type:'rect',y:980,width:720,height:940,fill:'#777c67'});
  path('yard-back-shadow','M 0 862 Q 320 829 720 880 L 720 984 Q 360 924 0 966 Z','#667361','none');
  nodes.push({id:'house',type:'group',x:276,y:462,groundAnchor:{x:215,y:518}});
  rect('house-wall',18,118,402,388,'#9a8c75','house');
  path('house-wall-shade','M 18 118 L 420 118 L 420 158 L 18 150 Z','#746756',ink,2,'house');
  for(let x=35;x<420;x+=37)path('wall-plank-'+x,`M ${x} 158 L ${x} 492`,'none','#6e6555',1.6,'house');
  path('roof','M -16 131 Q 64 75 108 12 Q 239 33 338 17 Q 381 84 448 132 L 422 154 Q 209 137 7 154 Z','#a28363',ink,4,'house');
  path('roof-eaves','M -16 131 Q 209 116 448 132 L 422 154 Q 209 137 7 154 Z','#705743',ink,2,'house');
  path('roof-ridge','M 105 12 Q 239 33 338 17 L 347 30 Q 236 44 98 25 Z','#c2a179',ink,2,'house');
  // Short irregular straw strokes follow the roof's slope. A full intersecting
  // grid looked like a net stretched across a plain curved rectangle.
  for(let i=0;i<6;i++)for(let j=0;j<11;j++){
    const y=48+i*14,x=100-i*17+j*(22+i*3),lean=(x-220)*.04;
    path(`roof-straw-${i}-${j}`,`M ${x} ${y} l ${lean-3} 8 m 7 -6 l ${lean-2} 7`,'none',i%2?'#775c43':'#c3a77d',1.2,'house');
  }
  rect('window-void',44,202,80,99,'#f1ce86','house');
  path('window-bars','M 44 231 L 124 231 M 44 269 L 124 269 M 70 202 L 70 301 M 98 202 L 98 301','none','#493e32',5,'house');
  rect('window-sill',35,303,98,12,'#6c5844','house');
  rect('house-base',11,496,421,22,'#726854','house');
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
    for(const n of nodes){
      if(n.id==='sky'){n.width=frame.width;n.height=frame.height;continue;}
      if(!n.parent)n.parent=world.id;
      if(['far-hills','near-hills','distant-fence','yard-back-shadow'].includes(n.id)){n.x=-offset/scale;n.scaleX=frame.width/(720*scale);}
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
