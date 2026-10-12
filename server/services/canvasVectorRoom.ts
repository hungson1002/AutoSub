import type {VectorNode} from '../../shared/canvasVectorScene';

/** The reverse side of a rural house, reusable across every interior cut.
 * Contact coordinates use the same uniform local scale as the courtyard. */
export function vectorRoom(frame?:{width:number;height:number}){
  const ink='#292e2e',nodes:VectorNode[]=[];
  const rect=(id:string,x:number,y:number,width:number,height:number,fill:string,parent?:string)=>nodes.push({id,type:'rect',x,y,width,height,fill,stroke:ink,strokeWidth:3,...(parent?{parent}:{})});
  const path=(id:string,d:string,fill:string,stroke=ink,width=2,parent?:string)=>nodes.push({id,type:'path',d,fill,stroke,strokeWidth:width,...(parent?{parent}:{})});
  rect('room-wall',0,0,720,980,'#8b7d6b');
  rect('room-shadow',0,0,720,420,'#625d54');
  rect('room-floor',0,850,720,430,'#a3977c');
  rect('physical-ground-plane',0,980,720,1280,'#a3977c');
  for(let x=0;x<=720;x+=80)path('wall-seam-'+x,`M ${x} 420 L ${x} 850`,'none','#706958',1.2);
  for(let x=0;x<=720;x+=180)rect('room-post-'+x,x,390,18,475,'#64513e');
  rect('room-beam',0,435,720,30,'#5b4b3b');
  path('room-ceiling','M 0 310 L 360 205 L 720 310 M 0 328 L 720 328','none','#463e34',12);
  for(let i=0;i<5;i++)path('floor-line-'+i,`M 0 ${1005+i*60} L 720 ${1005+i*60}`,'none','#7c7563',1.2);
  path('floor-perspective','M 240 850 L 90 1280 M 420 850 L 480 1280 M 580 850 L 720 1160','none','#7c7563',1.2);
  nodes.push({id:'window',type:'group',x:50,y:540,width:160,height:165});
  rect('window-frame',-8,-8,176,181,'#514938','window');
  rect('window-night',0,0,160,165,'#31465f','window');
  nodes.push({id:'window-moon',type:'ellipse',parent:'window',x:125,y:35,rx:14,ry:14,fill:'#eee5bf'});
  path('window-hills','M 0 130 Q 42 88 78 133 Q 124 95 160 129 L 160 165 L 0 165 Z','#4e6769',ink,1,'window');
  path('window-bars','M 0 82 L 160 82 M 53 0 L 53 165 M 107 0 L 107 165','none','#453e33',5,'window');
  rect('window-sill',-16,166,192,12,'#71604a','window');
  path('moonlight','M 57 714 L 196 714 L 390 980 L 97 980 Z','#b3b49b','none',0);
  rect('door-opening',438,597,164,383,'#17212c');
  nodes.push({id:'door',type:'group',x:450,y:610,groundAnchor:{x:70,y:370}});
  rect('door-frame',-12,-13,164,383,'#4e4437','door');
  rect('door-left',0,0,68,358,'#786149','door');
  rect('door-right',72,0,68,358,'#705a45','door');
  rect('door-void',68,0,4,358,'#17212c','door');
  path('door-planks','M 22 4 L 22 354 M 45 4 L 45 354 M 95 4 L 95 354 M 118 4 L 118 354','none','#4d4437',2,'door');
  rect('door-threshold',-18,358,176,12,'#a89d80','door');
  // The bolt retracts on the left leaf; guides stay fixed to the door.
  // dx=0 is unlatched, dx=48 seats the bolt in the opposite guide.
  nodes.push({id:'latch',type:'group',parent:'door',x:22,y:190,width:106,height:25});
  rect('latch-bar',-45,4,86,17,'#aa8b5a','latch');
  path('latch-brackets','M 44 190 L 44 215 M 110 190 L 110 215','none',ink,5,'door');
  nodes.push({id:'table',type:'group',x:40,y:790,width:180,height:190,groundAnchor:{x:90,y:190}});
  rect('table-leg-l',16,30,17,160,'#62503d','table');
  rect('table-leg-r',146,30,17,160,'#62503d','table');
  rect('table-top',0,0,180,30,'#8d6f4d','table');
  path('table-grain','M 10 12 Q 74 2 165 13 M 24 22 L 150 22','none','#5c4e3c',1.5,'table');
  nodes.push({id:'bed',type:'group',x:30,y:940,width:145,height:40});
  rect('bed-platform',0,0,145,22,'#75624b','bed');
  path('bed-mat','M 4 -12 L 138 -12 L 145 1 L 0 1 Z','#b9a880',ink,2,'bed');
  rect('bed-pillow',15,-24,42,12,'#d1c3a4','bed');
  nodes.push({id:'lamp',type:'instance',asset:'folk-room-lamp',x:340,y:620,width:56,height:94});
  path('lamp-hook','M 368 560 L 368 626','none',ink,4);
  rect('wall-scroll',270,505,55,130,'#bdb18e');
  path('scroll-motif','M 285 530 Q 312 545 285 565 Q 310 579 289 600 M 278 620 L 314 620','none','#685345',3);
  nodes.push({id:'person',type:'instance',asset:'folk-room-person',x:245,width:212,height:330});
  const stage={width:720,height:1280,nodes,ground:{y:980,targets:[{target:'person'},{target:'door',anchor:{x:70,y:370}},{target:'table',anchor:{x:90,y:190}}]},tracks:[]};
  if(frame&&frame.width>frame.height){
    const scale=frame.height/960,offset=(frame.width-720*scale)/2;
    const world:VectorNode={id:'room-world',type:'group',x:offset,y:frame.height*.86-980*scale,scaleX:scale,scaleY:scale};
    for(const n of nodes){
      if(!n.parent)n.parent=world.id;
      if(['room-wall','room-shadow','room-floor','physical-ground-plane','room-beam'].includes(n.id)){n.x=-offset/scale;n.width=frame.width/scale;}
    }
    nodes.unshift(world);stage.width=frame.width;stage.height=frame.height;Object.assign(stage.ground,{parent:world.id});
  }
  return {assets:{'folk-room-person':{rig:'simple-puppet',outfit:'robe',hair:'side-part'},'folk-room-lamp':{rig:'lantern'}},stage};
}
