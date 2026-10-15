import type {VectorNode} from '../../shared/canvasVectorScene';

/** Complete reusable folk riverbank. It is scenery + contact geometry, never a
 * fixed Ma Da storyboard: any waterside tale may introduce its own cast/clues.
 * The near soil is a physical support; moving river and distant hills are
 * separate depth planes, not a single flat brown background. */
export function vectorRiverbank(frame?:{width:number;height:number}){
  const ink='#25241f',nodes:VectorNode[]=[];
  const rect=(id:string,x:number,y:number,width:number,height:number,fill:string,parent?:string)=>{
    nodes.push({id,type:'rect',x,y,width,height,fill,...(parent?{parent}:{} )});
  };
  const path=(id:string,d:string,fill:string,stroke='none',strokeWidth=1,parent?:string)=>{
    nodes.push({id,type:'path',d,fill,stroke,strokeWidth,...(parent?{parent}:{})});
  };
  rect('sky',0,0,720,1280,'#26384b');
  rect('sky-haze',0,360,720,420,'#314a59');
  path('high-cloud','M 48 260 Q 154 210 272 262 Q 340 296 410 262 Q 514 223 653 258','none','#718087',3);
  nodes.push({id:'moon',type:'ellipse',x:570,y:240,rx:37,ry:37,fill:'#f5e7bd',light:{kind:'moon',radius:116}});
  path('mountain-back','M 0 616 L 0 472 Q 47 447 85 471 L 153 369 Q 163 350 173 374 L 236 476 Q 278 489 307 460 L 356 368 Q 368 346 379 374 L 437 475 Q 488 441 525 464 L 585 386 Q 596 370 607 392 L 661 459 Q 695 444 720 459 L 720 682 Z','#496172','#354957',2);
  path('mountain-mid','M 0 664 L 0 553 Q 110 483 198 561 Q 302 495 413 580 Q 545 510 720 555 L 720 734 Z','#506762','#344e50',2);
  path('distant-tree-line','M 0 692 L 0 644 Q 32 625 45 599 L 57 633 Q 78 590 95 641 Q 134 599 149 652 Q 191 604 204 652 Q 238 608 255 661 Q 302 601 327 658 Q 375 604 393 667 Q 439 611 460 648 Q 499 601 530 657 Q 578 604 611 648 Q 655 590 682 650 L 720 635 L 720 702 Z','#334b47',ink,1.5);
  path('far-bank','M 0 686 Q 166 651 320 690 Q 530 661 720 688 L 720 772 L 0 770 Z','#465c53',ink,3);
  path('far-grass','M 0 683 Q 183 667 360 686 Q 548 667 720 687','none','#80917a',2);
  rect('river-water',0,716,720,565,'#314d54');
  path('river-shadow-band','M 0 744 Q 225 720 447 750 Q 613 728 720 743 L 720 814 Q 490 786 290 812 Q 136 784 0 806 Z','#29434b');
  path('river-middle-band','M 0 855 Q 196 820 398 855 Q 545 821 720 852 L 720 917 Q 460 883 235 926 L 0 909 Z','#385960');
  for(let i=0;i<11;i++){
    const x=19+(i*67)%656,y=769+(i%4)*43;
    path('water-ripple-'+i,`M ${x} ${y} q 17 -5 36 -1 m 10 0 q 13 3 27 -1`,'none',i%3===0?'#6a8984':'#506e70',i%3===0?2.5:1.5);
  }
  // Earthen near bank occupies a real surface; the scene actor stands on it.
  rect('physical-ground-plane',0,980,720,1300,'#8f7b61');
  path('foreground-earth','M 0 947 Q 118 940 236 965 Q 364 971 504 976 Q 628 968 720 973 L 720 1280 L 0 1280 Z','#8f7b61',ink,4);
  path('bank-edge','M 0 947 Q 118 940 236 965 Q 364 971 504 976 Q 628 968 720 973','none','#334b47',8);
  path('bank-edge-light','M 0 943 Q 118 935 236 960 Q 364 966 504 971 Q 628 962 720 968','none','#b7b397',3);
  path('soil-cliffs','M 230 1020 Q 269 1044 292 1090 M 433 1009 Q 479 1047 499 1112 M 153 1062 L 182 1097 M 615 1107 L 641 1160','none','#5a5549',2.1);
  path('bank-root','M 75 1006 Q 111 1020 128 1033 Q 161 1026 182 1045 M 145 1033 Q 124 1051 139 1094 M 184 1010 L 211 1034','none','#4c4a40',3);
  // Background huts suggest a lived-in place without locking the story to one house.
  nodes.push({id:'distant-house',type:'group',x:35,y:521,opacity:.7});
  path('hut-wall','M 0 78 L 145 78 L 145 157 L 0 157 Z','#65716a',ink,2,'distant-house');
  path('hut-roof','M -17 86 Q 34 12 80 26 Q 122 8 166 86 L 143 93 Q 75 76 4 94 Z','#6f6655',ink,2,'distant-house');
  path('hut-window','M 31 112 L 64 112 L 64 141 L 31 141 Z','#b4a177',ink,2,'distant-house');
  // Large, irregular plants and rocks occupy the foreground depth layer.
  nodes.push({id:'tree',type:'group',x:-44,y:493,width:270,height:525});
  path('tree-trunk','M 73 504 Q 97 370 91 222 L 50 178 L 72 165 L 118 210 Q 139 121 174 100 L 187 113 Q 157 176 135 232 Q 143 365 155 504 Z','#665b47',ink,4,'tree');
  path('tree-bark','M 99 281 Q 113 391 99 474 M 132 289 L 143 457 M 85 230 Q 102 260 105 286','none','#433f37',2,'tree');
  path('tree-crown','M 5 151 Q -7 111 28 100 Q 17 69 48 50 Q 61 21 98 29 Q 124 -3 155 17 Q 190 -7 214 29 Q 252 26 261 61 Q 298 78 279 112 Q 297 148 264 160 Q 249 192 208 181 Q 173 208 143 181 Q 105 206 79 178 Q 37 197 5 151 Z','#58755c',ink,3,'tree');
  path('tree-canopy-shade','M 10 151 Q 72 173 109 153 Q 149 180 197 152 Q 243 164 279 112 Q 297 148 264 160 Q 249 192 208 181 Q 173 208 143 181 Q 105 206 79 178 Q 37 197 10 151 Z','#405e4c','none',0,'tree');
  path('tree-leaf-marks','M 43 76 Q 68 55 95 74 M 136 48 Q 162 30 183 58 M 214 91 Q 244 86 251 116 M 78 128 Q 93 113 115 127','none','#789172',3,'tree');
  for(let i=0;i<7;i++){
    const x=[27,85,137,312,507,610,686][i]!,y=[922,975,1039,991,1122,1161,1211][i]!;
    path('reeds-'+i,`M ${x} ${y} q -16 -30 -12 -61 m 11 62 q 14 -45 24 -67 m -21 66 q -28 -19 -31 -40`,'none','#344f41',i%2?3.5:2.7);
    path('reed-blades-'+i,`M ${x-11} ${y-43} q -19 -3 -25 -15 M ${x+10} ${y-50} q 19 -11 23 -23`,'none','#648165',2);
  }
  for(let i=0;i<5;i++){
    const x=68+i*133,y=1053+(i%3)*60;
    path('pebble-'+i,`M ${x} ${y} q 11 -15 25 -13 q 14 1 23 13 Z`,'#8f8874',ink,1.6);
  }
  // Front-water objects stay separate from the actor; no implicit grab action.
  nodes.push({id:'mooring-stake',type:'group',x:550,y:770,width:50,height:215,groundAnchor:{x:25,y:215}});
  path('stake','M 12 215 L 9 24 L 25 2 L 43 24 L 45 215 Z','#655543',ink,4,'mooring-stake');
  path('stake-grain','M 23 44 L 22 191 M 36 48 Q 31 88 36 112','none','#a08a68',2,'mooring-stake');
  path('stake-rope','M 8 118 Q 26 129 47 117 M 9 128 Q 28 140 46 126','none','#c3af81',4,'mooring-stake');
  // The landing is one supported object in world coordinates, not a loose
  // screen-space plank. Its near posts meet the same y=980 shore surface.
  nodes.push({id:'jetty',type:'group',x:480,y:865,width:205,height:115,groundAnchor:{x:100,y:115}});
  path('jetty-posts','M 14 24 L 14 101 M 49 4 L 49 87 M 148 68 L 148 115 M 187 43 L 187 112','none','#473d30',6,'jetty');
  path('jetty-planks','M -8 22 L 34 -3 L 201 43 L 162 72 Z','#7c674d',ink,3.5,'jetty');
  path('jetty-joints','M 28 11 L 188 55 M 9 23 L 167 66 M 66 6 L 48 34 M 105 17 L 87 45 M 145 28 L 127 56','none','#b29a72',1.7,'jetty');
  // Art-directed set dressing: one coherent shoreline rather than several
  // broad flat SVG regions. These are independent reusable depth planes.
  path('moon-water-reflection','M 525 736 Q 558 740 610 735 L 635 938 Q 581 930 520 944 Q 546 845 525 736 Z','#c5b993','none',0);
  nodes.find(n=>n.id==='moon-water-reflection')!.opacity=.09;
  for(let i=0;i<7;i++){
    const x=450+(i*31)%210,y=750+i*29;
    path('moon-reflection-'+i,`M ${x} ${y} Q ${x+22} ${y-5} ${x+42} ${y}`,'none','#c5bb9b',1.5);
    nodes[nodes.length-1]!.opacity=.24+i*.015;
  }
  // A sheltered distant settlement provides cultural scale and story context.
  nodes.push({id:'far-dock',type:'group',x:412,y:633,opacity:.8});
  path('dock-posts','M 20 57 L 20 109 M 77 57 L 77 112 M 134 58 L 134 104','none','#384b43',4,'far-dock');
  path('dock-boards','M 0 48 Q 90 46 170 50 L 170 61 Q 88 57 0 62 Z','#625e4d',ink,1.8,'far-dock');
  path('dock-line','M 15 49 L 153 51','none','#99876b',1.6,'far-dock');
  nodes.push({id:'hut-2',type:'group',x:270,y:576,opacity:.76});
  path('hut-2-wall','M 0 39 L 118 39 L 118 91 L 0 91 Z','#626c62',ink,1.6,'hut-2');
  path('hut-2-roof','M -12 45 Q 24 -6 57 5 Q 95 -9 130 46 L 115 52 Q 58 39 1 50 Z','#80705a',ink,2,'hut-2');
  path('hut-2-door','M 48 60 L 76 60 L 76 91 L 48 91 Z','#313c3a',ink,1,'hut-2');
  path('back-tree-silhouettes','M 240 673 Q 237 645 230 632 Q 217 630 213 619 Q 202 614 217 599 Q 238 582 258 602 Q 270 582 290 599 Q 302 611 287 625 L 267 634 L 265 676 Z','#3e544c',ink,1.5);
  // Realistic floor treatment with texture bands and scattered foliage. Ground
  // baseline remains y=980, matched to the hero's native foot anchor.
  path('earth-light-wash','M 0 991 Q 195 970 375 993 Q 560 987 720 998 L 720 1041 Q 490 1033 310 1039 Q 141 1027 0 1059 Z','#92836c');
  nodes[nodes.length-1]!.opacity=.37;
  for(let i=0;i<10;i++){
    const x=33+(i*73)%650,y=1030+(i%4)*57;
    path('fine-soil-'+i,`M ${x} ${y} q 12 -4 29 0 m 9 3 l 9 -2`,'none',i%2?'#635d4c':'#a49a7c',1.1);
    nodes[nodes.length-1]!.opacity=.55;
  }
  for(let i=0;i<5;i++){
    const x=56+i*153,y=1183+(i%2)*40;
    path('flat-stone-'+i,`M ${x} ${y} Q ${x+16} ${y-15} ${x+34} ${y-9} Q ${x+50} ${y-6} ${x+54} ${y+3} Z`,'#978c76',ink,1.25);
    path('stone-glint-'+i,`M ${x+14} ${y-4} Q ${x+27} ${y-10} ${x+40} ${y-4}`,'none','#c0b49a',1.35);
  }
  const waves=[1,3,6,8].map(i=>({target:'water-ripple-'+i,start:0,end:1,frames:[
    {t:0,dx:0,opacity:.85},{t:.48,dx:11+i%3*3,opacity:.5,easing:'ease-in-out' as const},
    {t:1,dx:0,opacity:.85,easing:'ease-in-out' as const},
  ]}));
  // The stage's single cast slot is replaceable with any stable character asset.
  nodes.push({id:'person',type:'instance',asset:'folk-riverbank-person',x:160,width:210,height:380});
  const stage={width:720,height:1280,nodes,ground:{y:980,targets:[{target:'person'}]},tracks:waves};
  if(frame&&frame.width>frame.height){
    const scale=frame.height/960,offset=(frame.width-720*scale)/2;
    const world:VectorNode={id:'riverbank-world',type:'group',x:offset,y:frame.height*.86-980*scale,scaleX:scale,scaleY:scale};
    const left=-offset/scale,right=(frame.width-offset)/scale,by=(id:string)=>nodes.find(n=>n.id===id)!;
    // Every near-earth paint layer must span 16:9, not only the invisible
    // physical support. Keep the authored contact surface/actor scale intact.
    const shore=`M ${left} 944 Q -60 922 236 965 Q 364 971 504 976 Q 628 968 720 973 Q 970 959 ${right} 982`;
    by('foreground-earth').d=shore+` L ${right} 1280 L ${left} 1280 Z`;
    by('bank-edge').d=shore;by('bank-edge-light').d=shore;by('bank-edge-light').strokeWidth=2;
    by('earth-light-wash').d=`M ${left} 984 Q 190 970 375 993 Q 560 987 720 998 Q 970 981 ${right} 995 L ${right} 1041 Q 490 1033 310 1039 Q 141 1027 ${left} 1059 Z`;
    Object.assign(by('sky-haze'),{type:'path',d:`M ${left} 320 Q 360 290 ${right} 335 L ${right} 700 L ${left} 700 Z`,opacity:.4});
    by('moon').y=(frame.height*.26-world.y!)/scale;
    for(const n of nodes){
      if(n.id==='sky'){n.width=frame.width;n.height=frame.height;continue;}
      if(!n.parent)n.parent=world.id;
      if(['river-water','physical-ground-plane'].includes(n.id)){n.x=-offset/scale;n.width=frame.width/scale;}
      if(['mountain-back','mountain-mid','distant-tree-line','far-bank','far-grass','river-shadow-band','river-middle-band'].includes(n.id)){
        n.x=-offset/scale;n.scaleX=frame.width/(720*scale);
      }
    }
    nodes.splice(1,0,world);stage.width=frame.width;stage.height=frame.height;
    Object.assign(stage.ground,{parent:world.id});
  }
  return {assets:{'folk-riverbank-person':{rig:'simple-puppet',outfit:'tunic',hair:'short',
    palette:{skin:'#e4c9a9',shirt:'#756355',inner:'#efe0c8',hair:'#24272b',accent:'#b18e6d',trim:'#ddc69f'}}},stage};
}
