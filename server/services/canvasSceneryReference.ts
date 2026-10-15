import type {VectorNode,VectorTrack,VectorDrawing} from '../../shared/canvasVectorScene';
import {sceneryPen,sceneryRandom,type SceneryPoint as P} from './canvasSceneryInk';
import {placePaintedHouse,placePaintedFlowers} from './canvasSceneryHouse';

// Separate opt-in locations: existing accepted settings and saved paint stay intact.
export const REFERENCE_SETTING_PLACES=['thatched-yard','cliff-path','village-wide','village-map','forest-path','mountain-path','market-wide','shrine','bedroom','tree-square','tiled-yard','wood-room','night-house','gallows'] as const;
export type ReferenceSettingPlace=typeof REFERENCE_SETTING_PLACES[number];
export const REFERENCE_SETTING_VERSION='folk-wide-settings-v1';
export const REFERENCE_SETTING_CONTRACT=`WIDE FOLK LOCATIONS: folk-setting also supports place thatched-yard (timber/thatch house and yard), cliff-path (night steps above a real drop), village-wide (frontal village panorama with layered small houses and winding roads), village-map (parchment map), forest-path (earth path with broad tree canopy), mountain-path (diagonal stone steps, rock bank, SMALL DISTANT waterfall), market-wide (open village market with supported stalls), shrine (tiled altar hall), bedroom (bed with curtains), tree-square (wide yard beneath a large tree), tiled-yard (large red-roof wooden house), wood-room (living room with low table, bowls, shelves and hearth), night-house (house at left, large tree and narrow water strip behind), gallows (empty clearing and wooden gallows). Use these exact place values when they match the request, not a generic village/room/waterfall substitute. All use template:folk-setting, a stable seed, native world folk-setting-world and person slot. A location has a fixed composition: composition must be center, a wide study uses camera [{t:0,x:640,y:360,zoom:1}], no raw nodes or extra decorative geometry. For scenery-only sheets use cast:[], visibleCast:[] and hold beats, never invent inhabitants or a narrative ending. Each requested setting must have its own stable location ID; do not merge unrelated settings. Native focus reference-layout includes the whole environment. Named groups include house on thatched-yard/tiled-yard, house-left/river-water/tree on night-house, tree on tree-square, altar on shrine, bed/window on bedroom, table/window/shelf/firewood on wood-room, stone-steps/distant-waterfall on mountain-path, terrain on outdoor settings, market-sign/stall-left/stall-right/stall-back on market-wide, map-village on village-map and gallows on gallows. A still image is a set study, not an animation export. INK AND CONSTRUCTION: every discrete visible object has a closed dark outer contour. Man-made edges use straight horizontal or vertical segments and sharp corners, never rounded-rectangle architecture. A foreground house includes eave and base beams, corner posts, wall boards, framed lattice windows, a framed doorway, threshold, plaque or paper decoration, roof material marks and grounded yard props; do not reduce it to one wall rectangle and a roof. FRONTAL PROJECTION FOR ALL FOLK SCENERY: eye-level flat 2D staging, viewed from outside facing the set. Furniture exposes its front edge and legs, not a broad tabletop. Steps are thin horizontal stone edges ascending a hillside, never receding tread parallelograms. Rocks have frontal silhouettes and small crack marks, not separate top facets. Counters, well rims, bridge decks and landing planks show narrow front edges. Use overlap, layers and near/far size to convey depth; do not tilt the scene downward or introduce an overhead/isometric camera. Roof silhouettes and a broad ground backdrop remain as authored. The map is a flat diagram viewed head-on.`;
export function referenceSettingScenery(o:{place:ReferenceSettingPlace;seed:number;light:string;composition:string;atmosphere:string;smoke:boolean},frame:{width:number;height:number}){
 const nodes:VectorNode[]=[],paintAssets:Record<string,unknown>={},world='folk-setting-world',layout='reference-layout';
 const tracks:VectorTrack[]=[];
 const pen=sceneryPen(nodes,o.seed),{shape,add}=pen;
 const line=(id:string,points:readonly P[],colour:string,width:number,parent=layout)=>pen.line(id,points,colour,width,parent);
 const night=o.light==='night',dusk=o.light==='dusk',interior=['shrine','bedroom','wood-room'].includes(o.place);
 const C={ink:'#17120f',sky:night?'#283b50':dusk?'#aa8c79':'#a2cbd9',mountain:night?'#566f7b':'#87978e',pine:night?'#425b5d':'#526b4d',
  grass:night?'#4a6254':'#687f54',earth:night?'#9d8c6e':'#baa071',leaf:night?'#405847':'#40583c',leaf2:night?'#4e6548':'#607a48',
  bush:night?'#354b3e':'#5d774b',wood:night?'#927248':'#a47849',woodDark:'#64472d',thatch:night?'#aa8641':'#c1933d',roof:'#aa4932',wall:'#957044',stone:'#85816a',light:'#f4dda0'};
 if(dusk&&['forest-path','mountain-path','gallows'].includes(o.place))Object.assign(C,{sky:'#b5a68c',mountain:'#aaa790',pine:'#777e66',grass:'#a1a185',earth:'#b5a88a',leaf:'#8b9174',leaf2:'#939478',bush:'#8c957a',wood:'#92836a',woodDark:'#70664f',stone:'#a19b83'});
 const scale=frame.width>frame.height?frame.height/720:frame.width/720;
 nodes.push({id:'sky',type:'rect',width:frame.width,height:frame.height,fill:interior?'#4b4035':C.sky},
  {id:world,type:'group',x:frame.width>frame.height?(frame.width-1280*scale)/2:-280*scale,y:frame.width>frame.height?0:frame.height*.79-620*scale,scaleX:scale,scaleY:scale},
  {id:'physical-ground-plane',type:'rect',parent:world,x:-4096,y:620,width:8192,height:4096,fill:interior?'#88785f':C.earth},
  {id:layout,type:'group',parent:world,bounds:{x:0,y:0,width:1280,height:720}},
  {id:REFERENCE_SETTING_VERSION,type:'group',parent:world});
 const supports:Record<string,{x:number;y:number;width:number}>={floor:{x:640,y:620,width:1190}};
 const group=(id:string,bounds?:VectorNode['bounds'],parent=layout,extra:Partial<VectorNode>={})=>nodes.push({id,type:'group',parent,...(bounds?{bounds}:{}),...extra});
 // The structure is straight. Small pen deviations are confined to the edge,
 // rather than bending walls, roof planes or whole furniture silhouettes.
 const face=(id:string,corners:readonly P[],fill:string,parent=layout,width=1.9)=>{
  const r=sceneryRandom(o.seed+':'+id),p:P[]=[];
  corners.forEach((a,i)=>{const b=corners[(i+1)%corners.length]!,dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),steps=Math.ceil(len/34);
   p.push(a);for(let k=1;k<steps;k++){const t=k/steps,n=(r()-.5)*.65;p.push([a[0]+dx*t-dy/(len||1)*n,a[1]+dy*t+dx/(len||1)*n]);}});
  shape(id,p,fill,parent,width*1.55,0);
 };
 const path=(id:string,d:string,fill:string,parent=layout,width=1.8)=>add(id,d,fill,parent,width?C.ink:'none',width&&fill!=='none'?Math.max(2.8,width*1.4):width);
 const ellipse=(id:string,x:number,y:number,rx:number,ry:number,fill:string,parent=layout,width=1.8)=>nodes.push({id:'scenery-'+id,type:'ellipse',parent,x,y,rx,ry,fill,stroke:width?C.ink:'none',strokeWidth:width,...(id==='moon'?{light:{kind:'moon' as const,radius:78,intensity:.6}}:id==='lamp-flame'?{light:{kind:'flame' as const,radius:86,intensity:.8}}:{})});
 function bush(id:string,x:number,y:number,w:number,h:number,parent=layout,colour=C.bush){
  path(id,`M${x-w/2} ${y}Q${x-w*.56} ${y-h*.42} ${x-w*.38} ${y-h*.46}Q${x-w*.36} ${y-h*.88} ${x-w*.19} ${y-h*.72}Q${x-w*.08} ${y-h*1.14} ${x+w*.05} ${y-h*.82}Q${x+w*.25} ${y-h*.97} ${x+w*.31} ${y-h*.6}Q${x+w*.55} ${y-h*.64} ${x+w*.5} ${y}Z`,colour,parent,1.6);
 }
 function grass(id:string,x:number,y:number,s=1,parent=layout){
  path(id,`M${x-12*s} ${y}q-4 ${-12*s} ${-13*s} ${-23*s}l${22*s} ${18*s}q-4 ${-17*s} 0 ${-30*s}l${8*s} ${27*s}l${19*s} ${-22*s}l${-13*s} ${30*s}Z`,C.leaf2,parent,1.4);
 }
 function stone(id:string,x:number,y:number,w:number,h:number,parent=layout){
  ellipse(id+'-contact',x,y+2,w*.51,Math.max(2,h*.06),'#4a493b',parent,0);nodes.at(-1)!.opacity=.22;
  path(id,`M${x-w/2} ${y}Q${x-w*.5} ${y-h*.65} ${x-w*.15} ${y-h}Q${x+w*.2} ${y-h*1.05} ${x+w*.5} ${y-h*.25}L${x+w*.48} ${y}Z`,C.stone,parent,1.7);
  path(id+'-mark',`M${x-w*.16} ${y-h*.56}l${w*.14} ${h*.22}l${w*.2} ${-h*.05}`,'none',parent,1.1);
 }
 function tree(id:string,x:number,y:number,h:number,parent=layout){
  group(id,{x:x-h*.47,y:y-h,width:h*.94,height:h},parent);
  path(id+'-trunk',`M${x-h*.2} ${y}Q${x-h*.07} ${y-h*.18} ${x-h*.06} ${y-h*.58}L${x-h*.17} ${y-h*.81}L${x-h*.08} ${y-h*.84}L${x+h*.01} ${y-h*.62}L${x+h*.14} ${y-h*.82}L${x+h*.19} ${y-h*.78}Q${x+h*.07} ${y-h*.45} ${x+h*.1} ${y-h*.15}L${x+h*.23} ${y}Q${x+h*.03} ${y-h*.03} ${x-h*.2} ${y}Z`,C.woodDark,id,2.1);
  // One broad, connected canopy, not a vertical stack of cloud ellipses.
  const cy=y-h*.71,w=h*.88,ch=h*.5;
  path(id+'-crown',`M${x-w*.5} ${cy+ch*.12}Q${x-w*.61} ${cy-ch*.05} ${x-w*.44} ${cy-ch*.21}Q${x-w*.48} ${cy-ch*.47} ${x-w*.27} ${cy-ch*.45}Q${x-w*.12} ${cy-ch*.64} ${x+w*.03} ${cy-ch*.47}Q${x+w*.24} ${cy-ch*.57} ${x+w*.3} ${cy-ch*.34}Q${x+w*.54} ${cy-ch*.35} ${x+w*.51} ${cy-ch*.06}Q${x+w*.65} ${cy+ch*.17} ${x+w*.4} ${cy+ch*.3}Q${x+w*.21} ${cy+ch*.49} ${x+w*.05} ${cy+ch*.34}Q${x-w*.12} ${cy+ch*.53} ${x-w*.25} ${cy+ch*.34}Q${x-w*.5} ${cy+ch*.4} ${x-w*.5} ${cy+ch*.12}Z`,C.leaf,id,2.1);
  path(id+'-foliage-volume',`M${x-w*.37} ${cy-ch*.15}q${-w*.04} ${-ch*.21} ${w*.13} ${-ch*.23}q${w*.03} ${-ch*.12} ${w*.14} ${-ch*.03}q${w*.16} ${-ch*.12} ${w*.2} ${ch*.08}q${w*.1} ${ch*.02} ${w*.07} ${ch*.17}M${x-w*.28} ${cy+ch*.15}q${w*.04} ${ch*.19} ${w*.19} ${ch*.08}q${w*.1} ${ch*.14} ${w*.19} 0q${w*.16} ${ch*.04} ${w*.22} ${-ch*.12}`,'none',id,1.35);
  path(id+'-leaf-folds',`M${x-w*.32} ${cy-ch*.31}q${-w*.05} ${ch*.2} ${w*.1} ${ch*.25}q${-w*.03} ${ch*.18} ${w*.12} ${ch*.23}M${x+w*.19} ${cy-ch*.37}q${w*.1} ${ch*.15} 0 ${ch*.28}q${w*.15} ${ch*.15} ${w*.04} ${ch*.31}`,'none',id,1.1);
  path(id+'-bark',`M${x-h*.025} ${y-h*.06}q${-h*.025} ${-h*.2} 0 ${-h*.38}M${x+h*.055} ${y-h*.16}l${-h*.01} ${-h*.19}`,'none',id,1.2);
  // Interior lobes describe foliage volumes within the existing silhouette.
  let leaves='';
  for(let i=0;i<22;i++){const a=i*2.399,r=Math.sqrt((i+.5)/22),lx=x+Math.cos(a)*w*.39*r,ly=cy+Math.sin(a)*ch*.3*r;leaves+=`M${lx} ${ly}q${w*.018} ${-ch*.035} ${w*.037} 0`;}
  path(id+'-leaf-texture',leaves,'none',id,1.15);nodes.at(-1)!.opacity=.55;
  path(id+'-root-lines',`M${x-h*.14} ${y-h*.01}q${h*.05} ${-h*.03} ${h*.07} ${-h*.1}M${x+h*.12} ${y-h*.01}q${-h*.04} ${-h*.04} ${-h*.05} ${-h*.1}`,'none',id,1.2);
 }
 function bamboo(id:string,x:number,y:number,h:number){
  group(id,{x:x-h*.25,y:y-h,width:h*.5,height:h});
  for(let i=0;i<3;i++){
   const px=x+(i-1)*h*.08,top=y-h+(i%2)*h*.13;
   line(id+'-stem-'+i,[[px,y],[px-3,top]],'#626f41',3,id);
   for(let k=0;k<4;k++){const py=top+k*h*.19;line(id+'-joint-'+i+'-'+k,[[px-4,py],[px+3,py]],C.woodDark,1,id);}
   path(id+'-leaves-'+i,`M${px} ${top+h*.08}q${-h*.22} ${-h*.16} ${-h*.26} ${h*.03}q${h*.1} ${-h*.12} ${h*.26} ${-h*.03}q${h*.2} ${-h*.12} ${h*.25} ${h*.08}q${-h*.13} ${-h*.12} ${-h*.25} ${-h*.08}M${px} ${top+h*.28}q${-h*.17} ${-h*.05} ${-h*.21} ${h*.12}q${h*.07} ${-h*.09} ${h*.21} ${-h*.12}`,C.leaf,id,1.1);
  }
 }
 function backdrop(ground=415){
  group('forest-backdrop',{x:0,y:150,width:1280,height:ground-150});
  path('distant-mountains',`M-30 ${ground}L-30 327Q19 313 72 248Q116 315 171 328Q228 319 268 186Q309 305 365 320Q412 329 452 279Q509 264 556 158Q607 302 664 323Q728 318 774 210Q818 320 866 332Q961 315 1018 188Q1075 313 1133 330Q1206 317 1252 220L1320 ${ground}Z`,C.mountain,'forest-backdrop',1.3);
  face('mountain-folds',[[248,218],[267,186],[316,260],[281,238]],C.sky,'forest-backdrop',.8);
  if(['forest-path','mountain-path','cliff-path','gallows'].includes(o.place)){for(let i=0;i<21;i++){const x=i*67-24+Math.sin(i*2.2)*15,y=ground-11,h=25+(i*17)%48;face('far-pine-'+i,[[x-h*.28,y],[x-h*.1,y-h*.32],[x-h*.23,y-h*.32],[x,y-h],[x+h*.24,y-h*.32],[x+h*.1,y-h*.32],[x+h*.29,y]],C.pine,'forest-backdrop',.8);}}else for(let i=0;i<17;i++)bush('far-bush-'+i,i*84-17,ground+4,102,49+(i%3)*14,'forest-backdrop',C.bush);
  path('back-ground',`M-30 ${ground}Q260 ${ground-16} 590 ${ground+3}Q940 ${ground-13} 1310 ${ground}L1310 740H-30Z`,C.grass,layout,0);
  if(night){
   // Celestial emitters stay in the background. Every real foreground shape
   // occludes both the disk and its halo, including a partial canopy overlap.
   group('sky-light',{x:900,y:-30,width:240,height:240});
   for(let i=18;i>=1;i--){ellipse('moon-haze-'+i,1020,90,30+i*5,30+i*5,'#c8d2df','sky-light',0);nodes.at(-1)!.opacity=.008;}
   ellipse('moon',1020,90,27,27,'#f4efda','sky-light',1);
   nodes.at(-1)!.light=undefined;
  }
 }
 function fence(id:string,x:number,y:number,w:number,h:number){
  group(id,{x,y:y-h,width:w,height:h});
  for(let i=0;i<=Math.floor(w/13);i++){const px=x+i*13;face(id+'-slat-'+i,[[px,y],[px-1,y-h+5],[px+4,y-h],[px+8,y-h+6],[px+8,y]],'#bca373',id,1);}
  line(id+'-rail',[[x,y-h*.43],[x+w,y-h*.43]],C.woodDark,2,id);
 }
 function jar(id:string,x:number,y:number,w:number,h:number,parent=layout){
  group(id,{x:x-w/2,y:y-h,width:w,height:h},parent);
  path(id+'-body',`M${x-w*.25} ${y-h}L${x+w*.25} ${y-h}Q${x+w*.22} ${y-h*.8} ${x+w*.44} ${y-h*.65}Q${x+w*.55} ${y-h*.4} ${x+w*.34} ${y}L${x-w*.34} ${y}Q${x-w*.56} ${y-h*.4} ${x-w*.44} ${y-h*.65}Q${x-w*.22} ${y-h*.8} ${x-w*.25} ${y-h}Z`,C.woodDark,id,1.9);
  line(id+'-bands',[[x-w*.42,y-h*.4],[x,y-h*.36],[x+w*.42,y-h*.4]],'#413d32',1.2,id);
 }
 function flowers(id:string,x:number,y:number,s=1){
  placePaintedFlowers(nodes,paintAssets,id,layout,x,y,105*s);
 }
 function house(id:string,x:number,y:number,w:number,h:number,tiled=false,lit=false,_details=true){
  placePaintedHouse(nodes,paintAssets,{id,parent:layout,x,y,width:w,height:h,light:o.light,tiled,lit});
 }
 function indoor(){
  group('walls',{x:0,y:0,width:1280,height:455});
  face('wood-wall',[[0,0],[1280,0],[1280,455],[0,455]],'#998165','walls',0);
  for(let i=0;i<46;i++)line('wall-plank-'+i,[[i*29,0],[i*29+1,455]],'#79694f',.9,'walls');
  line('wall-base',[[0,455],[1280,455]],'#514632',2.2,'walls');
  group('terrain',{x:0,y:455,width:1280,height:265});face('room-floor',[[0,456],[1280,456],[1280,740],[0,740]],'#89785f','terrain',0);
 }
 function window(id:string,x:number,y:number,w:number,h:number){
  group(id,{x,y,width:w,height:h});face(id+'-hole',[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],night?'#2f4053':'#859e96',id,2);
  for(let i=1;i<6;i++)line(id+'-bar-'+i,[[x+i*w/6,y],[x+i*w/6,y+h]],'#beab84',2,id);
  line(id+'-sill',[[x-5,y+h+3],[x+w+5,y+h+3]],C.woodDark,4,id);
 }
 function table(id:string,x:number,y:number,w:number,h:number){
  group(id,{x,y:y-h,width:w,height:h});
  for(const px of [x+12,x+w-22])face(id+'-leg-'+px,[[px,y-h+6],[px+9,y-h+6],[px+8,y],[px-1,y]],C.woodDark,id,1.5);
  face(id+'-top',[[x-7,y-h],[x+w+7,y-h],[x+w+7,y-h+11],[x-7,y-h+11]],'#a08b68',id,1.8);
  supports[id]={x:x+w/2,y:y-h,width:w};
 }
 function roomDetails(){
  window('window',650,106,90,120);
  face('wall-picture',[[130,90],[230,90],[230,258],[130,258]],'#c4bba4',layout,1.9);
  path('picture-marks','M163 132l10 8l5-16m-11 78l8 4l5-8','none',layout,2);
  face('wall-plaque',[[360,63],[535,63],[535,110],[360,110]],'#5c523e');
  for(let i=0;i<4;i++)ellipse('plaque-mark-'+i,386+i*37,88,3,4,'#cdb879',layout,0);
  for(const x of [102,259])face('red-paper-'+x,[[x,88],[x+14,88],[x+14,253],[x,253]],'#a45b45',layout,1);
 }
 function bed(){
  group('bed',{x:620,y:190,width:560,height:440});
  for(const x of [650,1150])line('bed-post-'+x,[[x,190],[x,630]],'#544838',5,'bed');
  face('bed-canopy',[[640,188],[1160,188],[1160,214],[640,214]],'#c5beb0','bed',1.7);
  face('bed-mattress',[[655,526],[1147,526],[1147,558],[655,558]],'#b7a9a0','bed',1.5);
  face('bed-base',[[650,557],[1150,557],[1150,578],[650,578]],'#69533f','bed',1.8);
  path('bed-left-curtain','M650 211L715 211Q695 367 658 526Z','#c2b9a8','bed',1.6);
  path('bed-right-curtain','M1086 211L1150 211L1143 525Q1101 356 1086 211Z','#c2b9a8','bed',1.6);
  path('bed-pillow','M680 511q35-19 75 0l-2 15h-75Z','#b7aea3','bed',1.4);
 }
 const place=o.place;
 if(interior){
  if(place==='shrine'){
   face('shrine-wall',[[0,0],[1280,0],[1280,415],[0,415]],'#a8a396',layout,0);
   group('terrain',{x:0,y:415,width:1280,height:305});face('tile-floor',[[0,415],[1280,415],[1280,740],[0,740]],'#a8a8a3','terrain',0);
   for(const y of [459,524,612])line('tile-row-'+y,[[0,y],[1280,y]],'#68675f',1.5,'terrain');
   for(let i=-4;i<8;i++)line('tile-column-'+i,[[640+i*130,415],[640+i*300,740]],'#68675f',1.4,'terrain');
   group('altar',{x:420,y:230,width:440,height:195});
   face('altar-base',[[414,347],[866,347],[866,428],[414,428]],'#a59576','altar',2);
   face('altar-body',[[432,263],[848,263],[848,350],[432,350]],'#a17d62','altar',2.3);
   face('altar-top',[[418,253],[862,253],[862,267],[418,267]],'#74604b','altar',2);
   path('altar-decoration','M460 294q35-24 65 0q95 36 183 0q42-23 100 3','none','altar',1.5);
   supports.altar={x:640,y:253,width:440};
   face('shrine-scroll',[[582,30],[698,30],[698,221],[582,221]],'#d5cbb3',layout,2);
   for(let i=0;i<5;i++)path('scroll-mark-'+i,`M622 ${65+i*27}l11 5l15-7m-13-5v18`,'none',layout,1.5);
   for(const x of [461,814]){ellipse('altar-vase-'+x,x,239,12,15,'#c0b99c');path('altar-plant-'+x,`M${x} 224l-18-51q20 3 20 23q5-23 23-32q0 29-22 42l3 18`,C.leaf,layout,1.4);}
   // Structural and age detail keeps the large wall from reading as a blank
   // rectangle while preserving the frontal altar composition.
   for(const x of [48,318,946,1216])face('shrine-column-'+x,[[x,0],[x+17,0],[x+17,415],[x,415]],'#706757',layout,1.6);
   line('shrine-top-beam',[[0,23],[1280,23]],'#5d5548',8,layout);
   path('shrine-wall-age','M276 82q34-9 67 0m-95 58q22-6 43 1M895 91q37-10 74 0m-46 67q28-7 55 1M348 352q36-8 71 0m448-2q35-7 69 1','none',layout,1.05);nodes.at(-1)!.opacity=.45;
   for(const x of [90,1030]){face('curtain-'+x,[[x,0],[x+160,0],[x+160,341],[x+137,330],[x+112,342],[x+88,332],[x+62,344],[x+36,330],[x,340]],'#62565c',layout,1.7);for(let j=1;j<5;j++)line('curtain-fold-'+x+'-'+j,[[x+j*29,0],[x+j*29+1,328]],'#4d454a',1.2);}
  }else{
   indoor();
   if(place==='bedroom'){
    window('window',245,207,110,133);bed();
    table('lamp-table',278,602,95,115);ellipse('lamp-flame',325,469,6,12,'#f8db86',layout,0);
   }else{
    roomDetails();table('table',400,619,536,100);
    face('bench',[[428,636],[911,636],[911,650],[428,650]],C.woodDark);
    for(const x of [448,884])line('bench-leg-'+x,[[x,650],[x,682]],C.woodDark,6);
    for(const [i,x] of [520,670,810].entries())path('bowl-'+i,`M${x-13} ${supports.table!.y-9}q13 18 26 0Z`,'#cec6ad',layout,1.4);
    group('shelf',{x:880,y:132,width:370,height:150});
    for(const y of [182,275]){line('shelf-'+y,[[890,y],[1240,y]],C.woodDark,6,'shelf');for(let k=0;k<7;k++)jar('shelf-jar-'+y+'-'+k,913+k*47,y-3,28,32,'shelf');}
    face('cupboard',[[900,348],[1210,348],[1210,461],[900,461]],'#77634c');
    face('cupboard-top',[[891,339],[1220,339],[1220,351],[891,351]],'#564c3c');flowers('table-flowers',1055,335,.85);
    group('firewood',{x:240,y:363,width:130,height:96});
    for(let row=0;row<3;row++)for(let k=0;k<4-row;k++)ellipse('log-'+row+'-'+k,260+k*29+row*14,440-row*23,13,12,'#a18b69','firewood',1.3);
    face('hearth',[[45,453],[192,453],[192,468],[45,468]],'#695843');
    path('fire-flame','M98 451Q79 431 111 396Q140 429 124 451Z','#e7bc65',layout,1.2);
    for(let k=0;k<4;k++)face('hanging-cup-'+k,[[70+k*40,353],[86+k*40,353],[82+k*40,382],[73+k*40,382]],'#cfc6a9',layout,1);
    jar('water-jar',1003,637,70,93);jar('storage-jar',1110,674,75,90);
   }
  }
 }else if(place==='village-map'){
  face('map-backing',[[67,44],[1214,44],[1214,680],[67,680]],'#6f5e43');
  face('map-paper',[[85,66],[1195,71],[1189,661],[89,654]],'#d4c6a0',layout,2.1);
  group('map-village',{x:430,y:230,width:410,height:315});
  path('map-boundary','M443 400C462 242 776 231 830 400C808 588 453 599 443 400Z','none','map-village',2);
  for(let i=0;i<15;i++){const a=i*.419,x=638+Math.cos(a)*154,y=416+Math.sin(a)*117;ellipse('map-tree-'+i,x,y,7,10,'#807e59','map-village',.5);}
  for(let i=0;i<9;i++){const x=550+(i%3)*72,y=340+Math.floor(i/3)*65;face('map-hut-'+i,[[x-12,y],[x,y-19],[x+13,y],[x+11,y+19],[x-10,y+19]],'#97866b','map-village',1);}
  for(const [i,x,y] of [[0,260,220],[1,401,155],[2,617,145],[3,870,204],[4,990,320],[5,306,466],[6,880,545]] as const)path('map-mountain-'+i,`M${x-30} ${y+20}l30-52l35 52m-51-11l16-23l14 22`,'none',layout,1.7);
  path('map-road','M132 591Q280 519 440 550Q684 647 848 541Q1034 443 1128 434','none',layout,2.2);
  path('map-water','M973 269Q1023 253 1137 276Q1111 334 987 321Z','#a8ac91',layout,1.6);
 }else{
  const mountainPath=place==='mountain-path',cliff=place==='cliff-path',forest=place==='forest-path';
  backdrop(mountainPath?405:forest?428:cliff?402:395);
  if(place==='village-wide'){
   group('terrain',{x:0,y:375,width:1280,height:345});
   path('village-lane','M-20 682L300 566L565 485L723 412L803 398L738 485L410 633L266 740H-20Z',C.earth,'terrain',1.7);
   for(const [i,x,y,w,h] of [[0,104,425,80,84],[1,247,410,65,66],[2,378,440,90,87],[3,458,390,59,62],[4,586,438,94,91],[5,719,400,64,66],[6,803,438,92,96],[7,965,405,78,82],[8,1114,447,101,110],[9,266,542,146,148],[10,505,514,116,118],[11,868,566,178,184]] as const)house('house-'+i,x,y,w,h,i%4===0,night,false);
   bamboo('bamboo-left',50,545,270);bamboo('bamboo-right',1160,510,280);
   tree('village-tree-left',400,475,430);tree('village-tree-mid',728,428,350);tree('village-tree-right',1051,525,450);
   // Draw complete native subtrees by ground contact, so a nearer cottage
   // occludes a tree rooted behind it. Paint and world positions stay unchanged.
   const depthGroups=nodes.filter(n=>n.parent===layout&&(/^house-\d+$/.test(n.id)||/^village-tree-/.test(n.id)));
   const ids=new Set(depthGroups.map(n=>n.id));
   depthGroups.sort((a,b)=>(a.bounds!.y+a.bounds!.height)-(b.bounds!.y+b.bounds!.height));
   let depthIndex=0;for(let i=0;i<nodes.length;i++)if(ids.has(nodes[i]!.id))nodes[i]=depthGroups[depthIndex++]!;
   group('gate',{x:30,y:469,width:260,height:192});
   for(const x of [65,242])face('gate-post-'+x,[[x,510],[x+14,510],[x+14,661],[x,661]],C.wood,'gate',1.6);
   face('gate-beam',[[40,496],[274,496],[274,520],[40,520]],C.woodDark,'gate',1.7);
   face('gate-roof',[[24,496],[67,467],[245,469],[291,499]],'#b3a277','gate',1.9);
   bush('front-bush-left',-12,722,220,174);bush('front-bush-right',1280,722,236,191);
  }else if(place==='market-wide'){
   group('terrain',{x:0,y:412,width:1280,height:308});face('market-ground',[[0,402],[1280,403],[1280,740],[0,740]],C.earth,'terrain',0);
   for(let i=0;i<7;i++)house('house-'+i,-20+i*205,420,160,125,i%2===0,false,false);
   tree('market-tree-left',120,419,250);tree('market-tree-right',1185,450,289);
   for(const [id,x,y,w,h] of [['stall-left',35,558,350,158],['stall-right',928,576,335,170],['stall-back',414,475,211,102]] as const){
    group(id,{x,y:y-h,width:w,height:h});
    for(const px of [x+14,x+w-19])line(id+'-post-'+px,[[px,y],[px,y-h*.82]],C.woodDark,5,id);
    face(id+'-counter',[[x,y-53],[x+w,y-53],[x+w,y],[x,y]],'#8d7959',id,1.8);
    face(id+'-awning',[[x-14,y-h*.6],[x+35,y-h],[x+w-35,y-h],[x+w+14,y-h*.6]],C.thatch,id,2);
    let straw='';for(let px=x-10;px<x+w+10;px+=14)straw+=`M${px} ${y-h*.6-5}l-2 10`;path(id+'-straw',straw,'none',id,1.1);
    for(let j=0;j<5;j++){
     const px=x+35+j*(w-70)/4;face(id+'-basket-'+j,[[px-21,y-71],[px+21,y-71],[px+16,y-53],[px-16,y-53]],'#b49a67',id,1.4);
     for(let k=0;k<3;k++)ellipse(id+'-goods-'+j+'-'+k,px+(k-1)*11,y-75-(k%2)*5,8,7,j%2?'#a4b35e':'#d2b274',id,1);
    }
    supports[id]={x:x+w/2,y:y-53,width:w-35};
   }
   group('market-sign',{x:650,y:265,width:267,height:239});
   for(const x of [672,877])line('sign-post-'+x,[[x,320],[x,504]],C.woodDark,7,'market-sign');
   face('market-sign-board',[[650,281],[915,281],[915,345],[650,345]],'#716043','market-sign',2.1);
   face('market-sign-roof',[[637,279],[668,256],[894,256],[929,279]],C.thatch,'market-sign',1.8);
   for(const x of [681,868])ellipse('sign-lantern-'+x,x,378,13,17,'#b36c4b','market-sign',1.4);
   for(let k=0;k<3;k++)jar('market-jar-'+k,175+k*108,666,49,56);
   flowers('market-flower',1080,668,1.5);grass('market-front-grass',48,701,1.4);
  }else if(forest){
   group('terrain',{x:0,y:435,width:1280,height:285});
   path('forest-lane','M-20 720L383 511Q609 431 910 435L1310 474V740Z',C.earth,'terrain',1.6);
   for(let i=0;i<10;i++)bush('forest-undergrowth-'+i,i*145-10,439,170,88+(i%3)*17,'forest-backdrop');
   for(const [i,x,y,h] of [[0,48,475,515],[1,310,472,530],[2,560,438,393],[3,737,432,330]] as const)tree('forest-tree-'+i,x,y,h);
   path('forest-right-bank','M885 486Q1077 350 1310 405V740H1026Z',C.grass,layout,1.4);
   stone('forest-rock-large',1149,472,126,73);stone('forest-rock-mid',1093,545,94,49);stone('forest-rock-small',1190,603,63,30);
   for(const [i,x,y,s] of [[0,75,679,1.8],[1,345,580,.9],[2,675,645,1.2],[3,940,703,1.4],[4,1225,655,1.1]] as const)grass('forest-grass-'+i,x,y,s);
   bush('forest-front-left',15,739,210,94);
  }else if(mountainPath){
   // The waterfall is a distant detail, behind the path, never a giant foreground curtain.
   group('distant-waterfall',{x:812,y:285,width:35,height:172});
   path('distant-waterfall-body','M821 286L839 286L840 430L851 448L808 448L818 430Z','#d3d4bd','distant-waterfall',1);
   path('distant-waterfall-lines','M826 302L824 427M834 330L834 434','none','distant-waterfall',.8);
   group('terrain',{x:0,y:360,width:1280,height:360});
   path('mountain-earth','M0 625L340 540L657 454L925 404L1280 457V740H0Z',C.earth,'terrain',1.7);
   path('rock-bank','M-20 161Q172 164 276 350L335 740H-20Z',C.grass,layout,1.6);
   for(const [i,x,y,w,h] of [[0,146,327,115,158],[1,204,460,116,167],[2,253,616,131,193],[3,290,747,153,163]] as const)stone('path-rock-'+i,x,y,w,h);
   tree('mountain-tree',1090,580,600);
   group('stone-steps',{x:314,y:430,width:626,height:290});
   // Frontal cutout steps: thin level edges ascend along the hillside.
   // There is no visible tread plane or receding parallelogram surface.
   for(let i=6;i>=0;i--){
    const x=410+i*68,y=687-i*34,w=168-i*10;
    face('step-'+i,[[x-w/2,y],[x+w/2,y],[x+w/2-4,y+9],[x-w/2+4,y+9]],'#bcb59a','stone-steps',1.3);
    line('step-riser-'+i,[[x-w/2+4,y+9],[x+w/2-4,y+9]],'#858574',1.1,'stone-steps');
   }
   path('rock-vine','M198 324q17 30 8 64q19 16 18 43m-14-45l-18-6m21 18l17-12','none',layout,1.6);
   grass('mountain-grass-left',72,705,1.6);grass('mountain-grass-right',880,646,1.2);
  }else if(cliff){
   group('terrain',{x:0,y:402,width:1280,height:318});
   path('cliff-top','M0 500Q215 461 385 466L790 449L936 478L942 514L0 557Z',C.earth,'terrain',1.7);
   path('cliff-face','M0 556L940 514L940 740H0Z','#3f4b49','terrain',2.3);
   path('cliff-right-void','M943 491L1280 414V740H943Z','#263e42','terrain',0);
   tree('cliff-tree',212,479,332);
   for(let i=0;i<5;i++){const x=469+i*63,y=502-i*6;face('night-step-'+i,[[x,y],[x+62,y],[x+60,y+6],[x+2,y+6]],'#9e9b86','terrain',1.1);}
   for(const [i,x,y,w,h] of [[0,160,688,99,55],[1,463,647,122,63],[2,701,725,140,72]] as const)stone('cliff-rock-'+i,x,y,w,h,'terrain');
   grass('cliff-grass',883,485,.8);stone('cliff-top-stone',368,486,52,31);
  }else if(place==='tree-square'){
   group('terrain',{x:0,y:400,width:1280,height:320});face('square-ground',[[0,406],[1280,406],[1280,740],[0,740]],C.earth,'terrain',0);
   for(const [i,x,y,w,h] of [[0,-25,455,280,167],[1,1020,448,240,143]] as const)house('square-house-'+i,x,y,w,h,false,false,false);
   fence('square-fence-left',261,468,224,61);fence('square-fence-right',1000,476,243,57);
   tree('tree',678,551,620);stone('square-stone',922,627,96,50);
   grass('square-grass-left',365,585,1.1);grass('square-grass-mid',752,597,.9);grass('square-grass-right',1072,641,1.1);
  }else if(place==='gallows'){
   group('terrain',{x:0,y:400,width:1280,height:320});face('clearing',[[0,405],[1280,405],[1280,740],[0,740]],C.earth,'terrain',0);
   group('gallows',{x:450,y:178,width:405,height:490});
   face('gallows-post',[[493,661],[508,234],[538,229],[541,655]],C.woodDark,'gallows',2.2);
   face('gallows-beam',[[466,222],[850,208],[851,228],[467,241]],C.woodDark,'gallows',2.2);
   path('gallows-rope','M783 227L783 364q-29 27-7 44q26 12 30-10q-1-18-23-34','none','gallows',2.3);
   for(const [i,x,y,s] of [[0,179,663,1.1],[1,942,686,1.4],[2,1130,620,1]] as const)grass('clearing-grass-'+i,x,y,s);
   stone('clearing-stone',813,602,42,17);
  }else if(place==='night-house'){
   group('terrain',{x:0,y:462,width:1280,height:258});
   group('river-water',{x:0,y:454,width:1280,height:60},'terrain');
   face('river-water',[[0,454],[1280,454],[1280,514],[0,514]],'#617d85','river-water',0);
   path('house-bank','M0 514Q348 499 659 527Q969 513 1280 519V740H0Z',C.earth,'terrain',1.3);
   house('house-left',-45,559,443,336,true,true,false);jar('water-jar',398,571,54,72);
   tree('tree',794,620,750);stone('night-stone',1133,664,103,54);
   for(let k=0;k<7;k++)ellipse('outside-log-'+k,95+(k%4)*29,579-Math.floor(k/4)*23,13,11,'#8d7d60',layout,1.3);
   bush('night-front-left',-20,730,210,92);grass('night-grass',1087,703,.7);
  }else{
   const tiled=place==='tiled-yard';
   group('terrain',{x:0,y:408,width:1280,height:312});face('yard-ground',[[0,410],[1280,410],[1280,740],[0,740]],C.earth,'terrain',0);
   if(tiled){house('house',282,551,714,343,true,true);tree('yard-tree',1115,548,365);flowers('yard-flower',1110,650,1.7);}
   else{house('house',230.8,552,782.4,430.8,false,night);bamboo('yard-bamboo-left',124,489,312);bamboo('yard-bamboo-right',1098,475,321);fence('yard-fence',-10,558,305,95);tree('yard-tree',1128,583,340);flowers('yard-flower-left',329,566,1.1);flowers('yard-flower-right',856,570,1.2);jar('water-jar',222,575,63,78);}
   const doorway=nodes.find(n=>n.id==='house-door')!,entryX=doorway.x!+doorway.width!/2,half=doorway.width!/2+8,porchY=tiled?551:552;
   group('stone-path',{x:entryX-155,y:porchY,width:310,height:740-porchY});
   path('yard-path',`M${entryX-half} ${porchY}H${entryX+half}L${entryX+155} 740H${entryX-155}Z`,night?'#8d8064':'#bdaa82','stone-path',0);
   stone('yard-stone',957,672,56,29);grass('yard-grass',71,665,1.1);
   line('yard-line',[[116,646],[278,648]],C.woodDark,1.2);
  }
 }
 // Material detail belongs to its support, never scattered in screen space.
 // Keep broad acting lanes clear; marks get smaller towards the horizon.
 const textureRandom=sceneryRandom(o.seed+':surface');
 if(place!=='village-map'){
  const terrain=nodes.find(n=>n.id==='terrain');
  if(terrain&&!['shrine','cliff-path'].includes(place)){
   const top=(terrain.bounds?.y??430)+35;let soil='',blades='';
   for(let i=0;i<94;i++){
    const x=25+textureRandom()*1230,y=top+textureRandom()*(714-top),s=.35+(y-top)/(720-top)*.8;
    soil+=`M${x.toFixed(1)} ${y.toFixed(1)}l${(4*s).toFixed(1)} ${(-.4*s).toFixed(1)}`;
    if(!interior&&i%3===0)blades+=`M${(x+9).toFixed(1)} ${y.toFixed(1)}l0 ${(-6*s).toFixed(1)}m3 ${(6*s).toFixed(1)}l1 ${(-4*s).toFixed(1)}`;
   }
   path('ground-grain',soil,'none','terrain',.9);nodes.at(-1)!.opacity=.55;
   if(blades){path('ground-sprigs',blades,'none','terrain',1);nodes.at(-1)!.opacity=.6;}
  }
  const walls=nodes.find(n=>n.id==='walls');
  if(walls){
   let grain='';for(let i=0;i<128;i++){const x=8+textureRandom()*1260,y=10+textureRandom()*415;grain+=`M${x.toFixed(1)} ${y.toFixed(1)}q-1 8 0 ${10+Math.round(textureRandom()*14)}`;}
   path('wall-wood-grain',grain,'none','walls',.85);nodes.at(-1)!.opacity=.45;
   face('room-top-beam',[[0,24],[1280,24],[1280,42],[0,42]],C.woodDark,'walls',1.5);
   for(const x of [24,470,1251])face('room-post-'+x,[[x,42],[x+13,42],[x+13,454],[x,454]],C.woodDark,'walls',1.4);
  }
 }
 if(['thatched-yard','tiled-yard'].includes(place)){
  group('yard-firewood',{x:55,y:530,width:127,height:76});
  for(let row=0;row<3;row++)for(let k=0;k<4-row;k++){
   const x=70+k*29+row*14,y=595-row*24;
   ellipse('yard-log-'+row+'-'+k,x,y,14,12,'#877153','yard-firewood',1.4);
   path('yard-log-ring-'+row+'-'+k,`M${x-6} ${y+2}q-3-8 4-8q8 3 2 9`,'none','yard-firewood',.8);
  }
  table('yard-offering-table',167,654,110,100);
  for(const x of [187,220,252])ellipse('yard-offering-'+x,x,546,10,9,'#b6a15b','yard-offering-table',1.3);
  group('yard-tools',{x:902,y:535,width:87,height:103});
  face('yard-tool-basket',[[908,601],[967,601],[977,639],[900,639]],C.woodDark,'yard-tools',1.8);
  line('yard-tool-handle',[[937,607],[965,530]],'#978056',3,'yard-tools');
  path('yard-tool-weave','M909 613h57m-60 11h63m-48-21v32m18-32v32m17-32v32','none','yard-tools',1);
 }
 if(place==='market-wide'){
  for(const id of ['stall-left','stall-right','stall-back']){
   const b=nodes.find(n=>n.id===id)!.bounds!,y=b.y+b.height,w=b.width,x=b.x;
   let weave='';for(let i=0;i<5;i++){const cx=x+35+i*(w-70)/4;weave+=`M${cx-13} ${y-69}l3 13m8-13v13m9-13l-3 13m-25-6h32`;}
   path(id+'-basket-weave',weave,'none',id,.9);
  }
  path('market-sign-carving','M706 305h25m-12-9v30m-12-9h25m28-21v28m-9-20h19m-19 10h19m18-19h25m-14 0v31','none','market-sign',2);nodes.at(-1)!.stroke='#d1b971';
 }
 if(place==='bedroom'){
  face('bed-cover',[[771,520],[1136,520],[1136,551],[777,551]],'#696473','bed',1.5);
  path('bed-cover-seams','M790 530h330m-323 10h315M700 230q-7 138-31 252M1104 230q8 140 28 254','none','bed',1);
  face('bedside-cabinet',[[1172,498],[1270,498],[1270,588],[1172,588]],C.woodDark);
  face('cabinet-drawer',[[1183,512],[1259,512],[1259,544],[1183,544]],'#796248',layout,1.2);
  ellipse('cabinet-knob',1221,527,5,3,'#b2a26b',layout,1);
  path('lamp-dish','M307 484q18 12 36 0Z','#b69c69',layout,1.2);
 }
 if(place==='shrine'){
  table('altar-front-table',358,502,564,89);
  path('altar-incense-bowl','M606 243q34 20 68 0l-4-18h-58Z','#7b6749',layout,1.5);
  path('altar-incense-sticks','M625 229v-38m13 38v-43m13 43v-35','none',layout,1.3);
  for(const x of [535,744])path('altar-cup-'+x,`M${x-8} 244h16l-3 9h-10Z`,'#d5cbb3',layout,1);
 }
 if(place==='wood-room'){
  path('table-grain','M437 522q58-3 102 0m25 2q65-4 109 0m21-2h150','none','table',.8);
  path('table-meal','M570 517q18-39 36 0Z','#bca45b','table',1.2);
  path('shelf-brackets','M904 184l22 18v-18m270 0l20 18v-18M904 277l22 18v-18m270 0l20 18v-18','none','shelf',1.8);
 }
 if(place==='mountain-path'){
  // Cracks follow the bank; they do not cross the stair run.
  path('bank-cracks','M49 228l48 22l15 36m-15-36l21-14M91 391l39 19l-5 41m5-41l30-12M119 568l48 17l23 40','none',layout,1.3);
 }
 if(place==='cliff-path')path('cliff-strata','M30 575l42 15l-8 61m8-61l81-11M281 564l47 27l-7 82m7-82l48-9M580 548l57 29l-2 88m2-88l42-11M810 538l35 28l-7 109','none','terrain',1.4);
 // Lights are independent of material colour. Night colours are baked into
 // newly generated native paint below, leaving saved assets and actors alone.
 const emitters:{id:string;x:number;y:number;radius:number;flame:boolean}[]=[];
 if(place==='shrine')for(const [i,x] of [535,744].entries()){
  face('shrine-candle-'+i,[[x-5,252],[x+5,252],[x+4,226],[x-4,226]],'#b99c68',layout,1.1);
  emitters.push({id:'shrine-candle-light-'+i,x,y:218,radius:92,flame:true});
 }
 if(night||dusk&&place==='tiled-yard'){
  for(const id of ['house','house-left']){
   const d=nodes.find(n=>n.id===id+'-door');if(!d)continue;
   const x=d.x!,y=d.y!,w=d.width!,h=d.height!;
   group(id+'-door-light',{x,y,width:w,height:h});
   // Nested translucent pools fade out without changing global light rules.
   for(let i=10;i>=1;i--){ellipse(id+'-door-pool-'+i,x+w*.5,y+h+18,w*(.35+i*.08),h*(.08+i*.018),'#edbd65',id+'-door-light',0);nodes.at(-1)!.opacity=.018;}
   face(id+'-lit-opening',[[x+9,y+8],[x+w*.7,y+8],[x+w*.7,y+h-8],[x+9,y+h-8]],'#e3c477',id+'-door-light',1);
   emitters.push({id:id+'-warm-halo',x:x+w*.4,y:y+h*.58,radius:w*1.3,flame:false});
   for(const [k,lx] of [x-24,x+w+24].entries()){
    line(id+'-lantern-hook-'+k,[[lx,y-6],[lx,y+15]],C.ink,2);
    ellipse(id+'-lantern-'+k,lx,y+28,12,18,'#b35b36',layout,1.6);
    path(id+'-lantern-ribs-'+k,`M${lx-4} ${y+11}v34m8-34v34`,'none',layout,.8);
    emitters.push({id:id+'-lantern-core-'+k,x:lx,y:y+28,radius:78,flame:true});
   }
  }
  if(place==='bedroom'){
   emitters.push({id:'bed-lamp',x:325,y:469,radius:155,flame:true});
   group('window-light',{x:245,y:207,width:110,height:133},'window');
   for(let i=10;i>=1;i--){ellipse('window-moon-haze-'+i,310,267,21+i*2,21+i*2,'#c8d2df','window-light',0);nodes.at(-1)!.opacity=.012;}
   ellipse('window-moon',310,267,21,21,'#e5e2ca','window-light',0);
   for(let i=1;i<6;i++)line('window-lit-bar-'+i,[[245+i*110/6,207],[245+i*110/6,340]],'#8a816b',2,'window-light');
  }
 }
 if(place==='wood-room')emitters.push({id:'hearth-light',x:111,y:432,radius:147,flame:true});
 for(const e of emitters){
  group(e.id,{x:e.x-e.radius,y:e.y-e.radius,width:e.radius*2,height:e.radius*2});
  for(let i=12;i>=1;i--){ellipse(e.id+'-bloom-'+i,e.x,e.y,e.radius*i/12,e.radius*i/12,'#f5c574',e.id,0);nodes.at(-1)!.opacity=.022;}
  if(e.flame){nodes.push({id:e.id+'-source',type:'ellipse',parent:e.id,x:e.x,y:e.y,rx:4,ry:9,fill:'#fff1ba',light:{kind:'flame',radius:40,intensity:.7}});}
 }
 if(!interior&&place!=='village-map'&&o.atmosphere!=='clear'){
  group('ground-mist',{x:-80,y:438,width:1440,height:175},layout,{atmosphere:{kind:'fog',density:o.atmosphere==='fog'?.68:.42,seed:o.seed,speed:.35}});
  group('distant-mist',{x:-80,y:330,width:1440,height:110},'forest-backdrop',{atmosphere:{kind:'fog',density:o.atmosphere==='fog'?.48:.25,seed:o.seed+1,speed:.18}});
 }
 if(o.smoke&&['wood-room','shrine'].includes(place))group('hearth-smoke',{x:place==='shrine'?611:60,y:place==='shrine'?103:256,width:place==='shrine'?62:108,height:place==='shrine'?118:180},layout,{atmosphere:{kind:'smoke',density:.55,seed:o.seed,speed:.4}});
 if((night||dusk)&&!interior&&place!=='village-map'){
  group('fireflies',{x:150,y:440,width:1000,height:245});
  const random=sceneryRandom(o.seed+':fireflies');
  for(let i=0;i<8;i++){
   const id='firefly-'+i,x=180+random()*900,y=(['thatched-yard','tiled-yard','night-house'].includes(place)?565:460)+random()*90;
   group(id,{x:x-18,y:y-18,width:36,height:36},'fireflies');
   for(let k=5;k>=1;k--){ellipse(id+'-glow-'+k,x,y,3+k*3,3+k*3,'#e9e69c',id,0);nodes.at(-1)!.opacity=.025+(5-k)*.008;}
   ellipse(id+'-core',x,y,1.8,1.8,'#fffddd',id,0);
   const phase=random()*Math.PI*2;
   tracks.push({target:id,start:0,end:1,frames:Array.from({length:13},(_,k)=>{
    const t=k/12,a=t*Math.PI*2;
    return {t,dx:Math.sin(a+phase)*12,dy:Math.cos(a+phase)*7,opacity:.18+.82*(.5+.5*Math.sin(a*2+phase))**2,easing:'smooth' as const};
   })});
  }
 }
 if(night||dusk||interior){
  const amount=night?.7:dusk?.28:place==='shrine'?.1:.26,tint=interior?[26,23,21]:night?[11,18,36]:[54,44,43];
  const shade=(paint:string|undefined)=>{
   if(!paint||!/^#[0-9a-f]{6}$/i.test(paint)||paint.toLowerCase()==='#17120f')return paint;
   return '#'+[0,2,4].map((offset,k)=>Math.round(parseInt(paint.slice(1+offset,3+offset),16)*(1-amount)+tint[k]!*amount).toString(16).padStart(2,'0')).join('');
  };
  const luminous=new Set(['sky-light','window-light','house-door-light','house-left-door-light','fireflies',...emitters.map(e=>e.id)]);
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const isLight=(node:VectorNode)=>{
   let n:VectorNode|undefined=node;while(n){if(luminous.has(n.id)||n.light)return true;n=n.parent?byId.get(n.parent):undefined;}return false;
  };
  for(const n of nodes)if(!isLight(n)){if(n.fill)n.fill=shade(n.fill);if(n.stroke)n.stroke=shade(n.stroke);}
  // A multi-location film shares one asset dictionary. Give each painted
  // lighting variant its own identity, so a later dusk planter cannot replace
  // a day or night planter used by another scene.
  const paletteSuffix='-shade-'+Math.round(amount*100)+'-'+tint.join('-');
  for(const [id,drawing] of Object.entries(paintAssets) as [string,VectorDrawing][]){
   for(const n of drawing.nodes){if(n.fill)n.fill=shade(n.fill);if(n.stroke)n.stroke=shade(n.stroke);}
   const key=id+paletteSuffix;delete paintAssets[id];paintAssets[key]=drawing;
   for(const n of nodes)if(n.asset===id)n.asset=key;
  }
 }
 nodes.push({id:'person',type:'instance',parent:world,asset:'setting-person',x:505,y:495,width:80.36,height:125,groundAnchor:{x:90,y:280}},
  {id:'folk-setting-grammar-v1',type:'group',parent:world});
 return {assets:{...paintAssets,'setting-person':{rig:'simple-puppet',finish:'handdrawn',hair:'short',outfit:'tunic'}},stage:{width:frame.width,height:frame.height,nodes,ground:{y:620,parent:world,targets:[{target:'person'}]},tracks},supports};
}
