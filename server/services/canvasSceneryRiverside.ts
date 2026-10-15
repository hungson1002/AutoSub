import type {VectorNode} from '../../shared/canvasVectorScene';
import {sceneryPen,sceneryRandom,type SceneryPoint as P} from './canvasSceneryInk';
import {applySceneryNightPalette} from './canvasSceneryLighting';
import courtyard from '../assets/vector-styles/folk-horror/approved-courtyard/drawing.json';
import type {SettingLayout} from './canvasScenerySetting';

/** An elevated village landing: one connected shore, a lane from the house
 * to the pier, and planting rooted on that land. Seed varies materials rather
 * than scattering objects; all semantic groups own the actual native paint. */
export function riversideScenery(o:Required<SettingLayout>,frame:{width:number;height:number}){
 const nodes:VectorNode[]=[],pen=sceneryPen(nodes,o.seed),{add,shape,line}=pen;
 const night=o.light==='night',dusk=o.light==='dusk',ink='#29271f';
 const C={sky:night?'#435a65':dusk?'#c6b49a':'#a2cbd4',far:night?'#697d7e':'#91a49a',hill:night?'#5b7265':'#7e9476',
  grass:night?'#61735d':'#7e926e',leaf:night?'#59714e':'#68834f',leafDark:night?'#425b43':'#476544',leafLight:night?'#6c8056':'#809858',
  earth:night?'#a29376':'#c1b087',bank:night?'#8e7d61':'#a18c65',water:night?'#4c7477':'#638e87',ripple:night?'#9eb9ae':'#a9c5b6',wood:'#9b784d',woodDark:'#70563c'};
 const scale=frame.width>frame.height?frame.height/720:frame.width/720,shift=o.composition==='left'?-36:o.composition==='right'?36:0;
 const world='folk-setting-world',layout='riverside-layout';
 nodes.push({id:'sky',type:'rect',width:frame.width,height:frame.height,fill:C.sky},
  {id:world,type:'group',x:frame.width>frame.height?(frame.width-1280*scale)/2:-(640-360)*scale,y:frame.width>frame.height?0:frame.height*.79-620*scale,scaleX:scale,scaleY:scale},
  {id:'physical-ground-plane',type:'rect',parent:world,x:-4096,y:620,width:8192,height:4096,fill:C.grass},
  {id:layout,type:'group',parent:world,x:shift});
 const group=(id:string,bounds?:VectorNode['bounds'],parent=layout,extra:Partial<VectorNode>={})=>nodes.push({id,type:'group',parent,...(bounds?{bounds}:{}),...extra});
 // Exact architectural corners; subpixel changes along an edge carry the pen.
 const face=(id:string,corners:P[],fill:string,parent:string,width=1.7)=>{
  const r=sceneryRandom(o.seed+':edge:'+id),points:P[]=[];
  corners.forEach((a,i)=>{const b=corners[(i+1)%corners.length]!,dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),steps=Math.ceil(length/25);
   points.push(a);for(let j=1;j<steps;j++){const t=j/steps,n=(r()-.5)*.7;points.push([a[0]+dx*t-dy/length*n,a[1]+dy*t+dx/length*n]);}});
  shape(id,points,fill,parent,width,0);
 };
 const crown=(id:string,x:number,y:number,w:number,h:number,fill:string,parent:string)=>{
  const r=sceneryRandom(o.seed+':crown:'+id),j=(r()-.5)*5;
  add(id,`M${x-w*.48} ${y+h*.1}C${x-w*.65} ${y-h*.1} ${x-w*.51} ${y-h*.38} ${x-w*.34} ${y-h*.34}C${x-w*.32} ${y-h*.6} ${x-w*.06+j} ${y-h*.62} ${x+w*.03} ${y-h*.44}C${x+w*.2} ${y-h*.62} ${x+w*.42} ${y-h*.39} ${x+w*.38} ${y-h*.2}C${x+w*.63} ${y-h*.19} ${x+w*.64} ${y+h*.12} ${x+w*.43} ${y+h*.2}C${x+w*.32} ${y+h*.4} ${x+w*.07} ${y+h*.36} ${x-w*.03} ${y+h*.29}C${x-w*.2} ${y+h*.42} ${x-w*.46} ${y+h*.31} ${x-w*.48} ${y+h*.1}Z`,fill,parent,ink,1.65);
 };
 const tree=(id:string,x:number,footY:number,height:number,parent:string)=>{
  const s=height/300;
  group(id,{x:-40,y:-32,width:260,height:335},parent,{x:x-90*s,y:footY-300*s,scaleX:s,scaleY:s,groundAnchor:{x:90,y:300},groundOffsetY:footY-620});
  shape(id+'-trunk',[[44,300],[65,278],[75,220],[79,99],[95,65],[108,101],[106,220],[117,279],[139,300]],C.wood,id,2.1,.025);
  add(id+'-bark','M80 288q9-38 9-90m14 63q-5-18-2-33','none',id,C.woodDark,1.15);
  crown(id+'-back',118,64,177,105,C.leafDark,id);
  crown(id+'-left',43,65,149,99,C.leaf,id);
  crown(id+'-front',93,28,155,112,C.leafLight,id);
  crown(id+'-top',101,-5,92,76,C.leaf,id);
  add(id+'-leaf-marks','M55 67q7-6 14 0m38-29q7-6 13 0m-31 59q6-5 12 0','none',id,'#4e6744',1.1);
 };
 const cottage=(id:string,x:number,y:number,w:number,parent:string)=>{
  const h=w*.73,top=y-h,eave=top+h*.46,r=sceneryRandom(o.seed+':roof:'+id);
  group(id,{x,y:top,width:w,height:h},parent,{groundAnchor:{x:x+w*.5,y},groundOffsetY:y-620});
  face(id+'-wall',[[x+w*.08,eave],[x+w*.92,eave],[x+w*.92,y],[x+w*.08,y]],'#ae8e60',id,1);
  face(id+'-roof',[[x+w*.2,top],[x+w*.76,top+.4],[x+w,eave+1],[x,eave]],'#c4a560',id,1.2);
  face(id+'-door',[[x+w*.43,y-h*.3],[x+w*.59,y-h*.3],[x+w*.59,y],[x+w*.43,y]],'#514331',id,.7);
  let detail='';for(let i=0;i<6;i++){const px=x+w*(.25+i*.09),py=top+h*(.12+r()*.12);detail+=`M${px} ${py}l-1 ${h*.09} `;}
  add(id+'-straw',detail,'none',id,'#927945',.8);
  add(id+'-wood',`M${x+w*.23} ${eave+3}V${y-2}M${x+w*.76} ${eave+3}V${y-2}`,'none',id,'#856c48',.8);
 };

 group('forest-backdrop',{x:-80,y:100,width:1440,height:260});
 add('hills-far','M-80 260Q40 231 138 146Q202 223 288 240Q355 229 422 169Q481 229 562 241Q675 229 754 151Q828 224 912 235Q1023 214 1119 141Q1203 227 1360 253V380H-80Z',C.far,'forest-backdrop','#647b70',1.3);
 add('hill-facets','M138 150Q151 193 183 225L154 210Z M754 156Q766 198 804 222L776 209Z M1119 146Q1127 194 1164 225L1136 209Z','#859a8e','forest-backdrop');
 add('hills-middle','M-80 315Q86 271 233 282Q379 222 511 279Q655 245 797 282Q965 244 1086 277Q1210 250 1360 297V393H-80Z',C.hill,'forest-backdrop','#63785c',1.2);
 group('village',{x:90,y:210,width:1120,height:140});
 cottage('house-back-left',163,316,74,'village');cottage('house-far',704,296,59,'village');cottage('house-back-right',1094,297,67,'village');
 group('far-trees',undefined,'village');
 tree('far-tree',970,316,129,'far-trees');
 let hedge='M-80 354V319';
 const hr=sceneryRandom(o.seed+':hedge');
 for(let i=0;i<20;i++){const x=-80+i*73,y=314-hr()*17;hedge+=`Q${x+8} ${y-23} ${x+30} ${y-10}Q${x+52} ${y-28} ${x+73} ${y+1}`;}
 add('far-bank-hedge',hedge+'L1380 354Z','#6c8260','forest-backdrop','#4e674e',1);
 if(o.atmosphere!=='clear')group('distant-haze',{x:0,y:224,width:1280,height:160},layout,{atmosphere:{kind:'fog',density:o.atmosphere==='fog'?.5:.17,seed:o.seed,speed:.3}});
 group('terrain',{x:-80,y:325,width:1440,height:435});
 add('village-ground','M-80 333Q205 322 395 337Q690 311 1360 322V790H-80Z',C.grass,'terrain');
 group('river-bank',{x:520,y:284,width:840,height:476});
 add('shore-earth','M1360 284C1185 287 1090 306 1020 336C927 372 874 391 845 430C823 467 794 505 717 542C630 586 577 635 534 790H1360Z',C.bank,'river-bank',ink,1.9);
 add('shore-top','M1360 284C1185 287 1090 306 1020 336C927 372 874 391 845 430C823 467 794 505 717 542C630 586 577 635 534 790H1360Z',C.earth,'river-bank');
 group('river-water',{x:563,y:305,width:797,height:485});
 add('river-surface','M1360 305C1178 306 1100 321 1030 350C948 379 890 400 866 438C841 480 809 514 731 555C650 598 601 641 563 790H1360Z',C.water,'river-water',ink,1.65);
 add('river-ripples','M1120 384q49-9 103-5m-174 48q57-5 102-13m-277 111q48-1 78-14m167 40q69-5 122-17m-363 113q44 6 89-2m64 54q79 4 159-9m-400 63q65 9 125 3','none','river-water',C.ripple,1.3);
 group('lane',{x:-80,y:453,width:830,height:337},'terrain');
 add('village-path','M-80 644C140 612 217 517 301 486C399 451 492 475 586 465C641 462 669 480 710 503L738 534C676 510 640 495 587 493C468 513 394 485 318 510C235 549 194 630 135 790H-80Z',C.earth,'lane',ink,1.65);
 add('lane-marks','M197 607l14-4m181-114 11-1m160-9 15 1m-410 214 20-4','none','lane','#9b8867',1.1);

 group('trees',{x:430,y:178,width:220,height:279});
 tree('tree-middle',548,451,231,'trees');
 group('house-left',{x:0,y:0,width:785,height:545},layout,{x:287,y:463-545*.278,scaleX:.278,scaleY:.278,groundAnchor:{x:215,y:545},groundOffsetY:463-620});
 // Reuse approved construction, including its intact door and material ink.
 // The source art remains immutable; only its group transform changes here.
 for(const part of ['house','door-opening','door-leaf','roof','straw'] as const)for(const [i,n] of courtyard.parts[part].entries()){
  const tones:Record<string,string>=night?{'#c1933d':'#a1844b','#a47849':'#927248','#c7aa67':'#b5a16b','#d0b270':'#bda56c'}:dusk?{'#c1933d':'#b18b47'}:{};
  const fill=tones[n.fill]??n.fill;
  nodes.push({...n,id:`scenery-riverside-house-${part}-${i}`,type:'path',parent:'house-left',fill});
 }
 group('house-left-door',{x:90,y:310,width:220,height:235},'house-left');
 // Semantic door owns the existing drawing, never an empty duplicate target.
 for(const n of nodes)if(n.id.startsWith('scenery-riverside-house-door-'))n.parent='house-left-door';
 group('house-props',{x:489,y:450,width:91,height:37});
 for(const [i,n] of courtyard.parts.jar.entries())nodes.push({...n,id:`scenery-riverside-jar-${i}`,type:'path',parent:'house-props'});
 const jars=nodes.find(n=>n.id==='house-props')!;Object.assign(jars,{x:528-870*.23,y:478-635*.23,scaleX:.23,scaleY:.23});
 // A low boundary fence and small bank objects add lived-in structure without
 // crossing the open lane from the house to the landing.
 group('shore-fence',{x:402,y:448,width:185,height:76},'terrain');
 for(let i=0;i<7;i++)face('shore-fence-picket-'+i,[[411+i*27,470],[417+i*27,467],[417+i*27,520],[411+i*27,520]],i%2?C.wood:C.woodDark,'shore-fence',1.2);
 line('shore-fence-rail-top',[[404,485],[588,479]],C.woodDark,3,'shore-fence');
 line('shore-fence-rail-bottom',[[405,505],[588,500]],C.woodDark,3,'shore-fence');

 group('dock',{x:697,y:498,width:269,height:143});
 for(const [i,x,y,h] of [[0,704,514,34],[1,950,572,45],[2,918,563,42]] as const)face('pier-support-'+i,[[x-3,y-5],[x+4,y-5],[x+4,y+h],[x-3,y+h]],C.woodDark,'dock',1.5);
 face('pier-underbeam',[[703,522],[951,579],[951,588],[703,531]],C.woodDark,'dock',1.5);
 face('pier-deck',[[704,510],[951,571],[951,583],[704,522]],C.wood,'dock',1.65);
 for(let i=1;i<11;i++){const t=i/11,x=704+247*t,y=510+61*t;line('pier-board-'+i,[[x,y],[x,y+12]],C.woodDark,1,'dock');}
 add('post-water-contact','M907 605q12 4 23-1M940 618q9 3 19-1','none','river-water',C.ripple,1.3);
 group('boat',{x:930,y:605,width:170,height:70});
 add('boat-hull','M927 620Q1002 629 1088 605Q1070 666 997 668Q951 656 927 620Z','#96734e','boat',ink,1.9);
 add('boat-interior','M941 621Q1006 628 1072 613L1068 618Q1006 633 945 626Z','#504a35','boat',ink,1.3);
 line('boat-seat',[[989,628],[1015,626]],'#b69b67',3,'boat');
 add('mooring-rope','M952 570Q944 609 961 630','none','boat','#b8a476',1.4);
 add('boat-water-contact','M951 673q67 10 119-8','none','river-water',C.ripple,1.2);

 // Foreground growth is cropped at the frame edge and rests on the bank.
 group('forest-front');tree('tree-left',22,626,420,'forest-front');
 group('bank-plants');
 crown('near-shrub-left',18,692,241,135,C.leafDark,'bank-plants');
 crown('house-shrub',247,465,83,57,C.leaf,'bank-plants');
 crown('shore-shrub',744,418,130,81,C.leaf,'bank-plants');
 let grasses='';for(const [x,y] of [[124,660],[141,648],[220,473],[231,478],[720,462],[748,450],[481,509],[497,513],[56,690],[91,676],[286,520],[332,505],[405,540],[454,525],[1180,364],[1224,350]] as const)grasses+=`M${x-4} ${y}l2-7 3 6 3-9 1 10`;
 add('bank-grass',grasses,'none','bank-plants','#526b47',1.1);
 let shoreMarks='',shorePebbles='';const shoreDetail=sceneryRandom(o.seed+':shore-detail');
 for(const [left,right,top,bottom] of [[24,470,535,700],[1080,1270,330,450]] as const)for(let i=0;i<15;i++){
  const x=left+shoreDetail()*(right-left),y=top+shoreDetail()*(bottom-top),s=.6+shoreDetail()*.55;
  shoreMarks+=`M${x-9*s} ${y}q${9*s} ${-4*s} ${18*s} 0`;
  if(i%3===0)shorePebbles+=`M${x+8} ${y+5}q${5*s} ${-7*s} ${11*s} ${-2*s}q${-4*s} ${5*s} ${-11*s} 2Z`;
 }
 add('shore-soil-marks',shoreMarks,'none','bank-plants',night?'#667263':'#907e5b',1.15);
 add('shore-pebbles',shorePebbles,night?'#74776a':'#9d8d6c','bank-plants',ink,1.05);
 let reeds='';for(const [x,y,h] of [[825,500,34],[848,488,42],[875,472,31],[1160,350,28],[1180,342,37],[1202,336,25]] as const){
  reeds+=`M${x} ${y}q${-3} ${-h*.55} 0 ${-h}m0 ${h}q8 ${-h*.6} 15 ${-h*.8}m-15 ${h*.45}q-9 ${-h*.35} -16 ${-h*.42}`;
 }
 add('shore-reeds',reeds,'none','bank-plants',night?'#526a57':'#597548',1.55);
 for(const [i,x,y,w,h] of [[0,448,554,30,17],[1,509,567,24,14],[2,1089,391,27,15]] as const){
  add('shore-stone-'+i,`M${x-w/2} ${y}q2 ${-h*.72} ${w*.35} ${-h}q${w*.42} 0 ${w*.5} ${h}Z`,night?'#686b62':'#88836e','bank-plants',ink,1.25);
 }
 if(o.smoke){group('cooking-fire',{x:545,y:482,width:24,height:13});
  add('hearth','M548 492l17-4m-15-1 15 6','none','cooking-fire',C.woodDark,2.5);
  nodes.push({id:'cooking-flame',type:'ellipse',parent:'cooking-fire',x:557,y:486,rx:2,ry:5,fill:'#edbd69',light:{kind:'flame',radius:18}});
  group('cooking-smoke',{x:528,y:389,width:56,height:95},'cooking-fire',{atmosphere:{kind:'smoke',density:.6,seed:o.seed,speed:.6}});
 }
 if(o.atmosphere!=='clear')group('ground-mist',{x:590,y:372,width:740,height:330},layout,{atmosphere:{kind:'fog',density:o.atmosphere==='fog'?.6:.2,seed:o.seed+2,speed:.4}});
 if(night)nodes.push({id:'moon',type:'ellipse',parent:layout,x:1019,y:91,rx:17,ry:17,fill:'#eee1b4',light:{kind:'moon',radius:41}});
 if(night)applySceneryNightPalette(nodes);
 nodes.push({id:'person',type:'instance',parent:world,asset:'setting-person',x:360+shift,y:495,width:80.36,height:125,groundAnchor:{x:90,y:280}},
  {id:'folk-setting-grammar-v1',type:'group',parent:world});
 return {assets:{'setting-person':{rig:'simple-puppet',finish:'handdrawn',hair:'short',outfit:'tunic'}},
  stage:{width:frame.width,height:frame.height,nodes,ground:{y:620,parent:world,targets:[{target:'person'}]},tracks:[]},
  supports:{floor:{x:360+shift,y:620,width:410},dock:{x:816+shift,y:540,width:24}}};
}
