import type {VectorNode} from '../../shared/canvasVectorScene';
import {sceneryPen,sceneryRandom,type SceneryPoint as P} from './canvasSceneryInk';
import {applySceneryNightPalette} from './canvasSceneryLighting';

export const NATURE_SCENERY_VERSION='folk-nature-grammar-v1';
export type NatureLayout={terrain?:'rolling'|'gorge'|'cliffs';water?:'none'|'river'|'stream'|'waterfall';
 bridge?:boolean;vegetation?:'mixed'|'pine'|'bamboo';composition?:'left'|'center'|'right';light?:'day'|'dusk'|'night';seed?:number;atmosphere?:'clear'|'mist'|'fog'};
export function natureLayout(raw:Record<string,unknown>):Required<NatureLayout>{
 const choose=<T extends string>(key:string,values:readonly T[],fallback:T):T=>{
  if(raw[key]!==undefined&&!values.includes(raw[key] as T))throw new Error('Vector: invalid nature '+key);
  return (raw[key]??fallback) as T;
 };
 if(raw.bridge!==undefined&&typeof raw.bridge!=='boolean')throw new Error('Vector: nature bridge must be boolean');
 if(raw.seed!==undefined&&(!Number.isInteger(raw.seed)||Math.abs(raw.seed as number)>99999))throw new Error('Vector: nature seed needs an integer');
 const water=choose('water',['none','river','stream','waterfall'],'stream');
 if(raw.bridge===true&&water==='none')throw new Error('Vector: a nature bridge needs a real watercourse');
 return {terrain:choose('terrain',['rolling','gorge','cliffs'],water==='waterfall'?'cliffs':'rolling'),water,bridge:raw.bridge===true,
  vegetation:choose('vegetation',['mixed','pine','bamboo'],'mixed'),composition:choose('composition',['left','center','right'],'center'),
  light:choose('light',['day','dusk','night'],'day'),seed:(raw.seed??17) as number,atmosphere:choose('atmosphere',['clear','mist','fog'],raw.light==='night'||water==='waterfall'?'mist':'clear')};
}
function palette(light:NatureLayout['light']){
 const day={sky:'#a3cbd5',far:'#8ca29e',ridge:'#6d887c',hill:'#536e58',wood:'#8c633c',woodShade:'#64482e',
  leaf:'#526b42',leafBright:'#6d814c',leafDark:'#364d32',earth:'#b39a6d',earthShade:'#90734f',
  stone:'#89816b',stoneTop:'#a49c80',stoneShade:'#6d6251',moss:'#61794b',water:'#417f7c',waterDeep:'#326c69',waterLight:'#87b6a7',foam:'#e0ead1'};
 if(light==='dusk')return {...day,sky:'#c6b49c',far:'#8b9794',ridge:'#747f72',hill:'#5d7056',earth:'#b99a68',stone:'#91816a',stoneTop:'#b39d7b',water:'#56817b',waterLight:'#a3b8a0'};
 if(light==='night')return {...day,sky:'#2d4358',far:'#637e85',ridge:'#526f71',hill:'#48635b',leaf:'#4b654b',leafDark:'#344d40',leafBright:'#61785a',earth:'#968467',stone:'#817c6b',stoneTop:'#9a947e',water:'#3c7378',waterLight:'#84aca5',foam:'#cddfce'};
 return day;
}

/** A composition grammar, not three imported pictures. Terrain, hydrology,
 * planting, span, focus and seed jointly place reusable inked components.
 * Every component shares this 1280x720 world and has a named physical extent. */
export function natureScenery(raw:NatureLayout={},frame={width:1280,height:720}){
 const o=natureLayout(raw as Record<string,unknown>),C=palette(o.light),R=sceneryRandom(o.seed),nodes:VectorNode[]=[];
 const pen=sceneryPen(nodes,o.seed),{shape,line,add}=pen;
 const woodland=o.water==='none'&&o.terrain==='rolling';
 const bambooReach=o.water==='river'&&o.vegetation==='bamboo'&&o.terrain==='rolling';
 const side=o.composition==='left'?-1:o.composition==='right'?1:0;
 const focus=(bambooReach?884:640)+side*150+(R()-.5)*72,crest=225+(R()-.5)*45,impact=518+(R()-.5)*20;
 const wide=frame.width>frame.height,scale=wide?frame.height/720:frame.width/720;
 const world:VectorNode={id:'nature-world',type:'group',x:wide?(frame.width-1280*scale)/2:-(focus-360)*scale,
  y:wide?0:frame.height*.79-620*scale,scaleX:scale,scaleY:scale};
 nodes.push({id:'sky',type:'rect',width:frame.width,height:frame.height,fill:C.sky},world,
  {id:'physical-ground-plane',type:'rect',parent:world.id,x:-4096,y:620,width:8192,height:4096,fill:C.earth});
 const group=(id:string,bounds?:{x:number;y:number;width:number;height:number},extra:Partial<VectorNode>={})=>
  nodes.push({id,type:'group',parent:world.id,...(bounds?{bounds}:{}),...extra});
 const rng=(id:string)=>sceneryRandom(o.seed+':'+id);

 function rock(id:string,x:number,y:number,w:number,h:number,parent='nature-world',wet=false){
  const r=rng(id),tilt=(r()-.5)*w*.2;
  const contour:P[]=[[x-w*.5,y-h*.08],[x-w*.59,y-h*.37],[x-w*.4,y-h*.78],[x+tilt,y-h],[x+w*.38,y-h*.82],[x+w*.55,y-h*.45],[x+w*.44,y-h*.02],[x+w*.04,y+h*.04]];
  shape(id,contour,C.stone,parent,w>70?3.8:2.7,.12);
  // Frontal stone silhouette plus a small crack, without a painted top plane.
  line(id+'-fault',[[x-w*.16,y-h*.77],[x-w*.02,y-h*.6],[x-w*.1,y-h*.42]],pen.ink,w>70?1.9:1.2,parent);
  if(wet)line(id+'-contact',[[x-w*.72,y+2],[x-w*.35,y+5],[x+w*.25,y+4],[x+w*.67,y]],C.waterLight,2.2,parent);
 }
 function fern(id:string,x:number,y:number,s=1,parent='nature-world'){
  const r=rng(id);let leaves='';
  for(let j=0;j<3;j++){
   const dx=(j-1)*28*s,dy=-(29+r()*22)*s;
   line(id+'-stem-'+j,[[x,y],[x+dx*.24,y+dy*.55],[x+dx,y+dy]],C.leafDark,1.9*s,parent);
   for(let k=1;k<5;k++){
    const t=k/5,px=x+dx*t*t,py=y+dy*t,len=(9-k*.9)*s;
    for(const sign of [-1,1])leaves+=`M${px} ${py}q${sign*len*.6} ${-len*.9} ${sign*len*1.2} ${-len*.65}q${-sign*len*.35} ${len*.6} ${-sign*len*1.2} ${len*.65}Z`;
   }
  }
  add(id+'-leaves',leaves,C.leaf,parent,pen.ink,1.1*s);
 }
 function canopy(id:string,x:number,y:number,w:number,h:number,parent:string,colour=C.leaf){
  const r=rng(id);const pts:P[]=[];
  if(woodland||bambooReach||o.water==='waterfall'){
   const lobes:P[]=[[-.5,.24],[-.57,-.03],[-.47,-.3],[-.34,-.28],[-.26,-.52],[-.08,-.53],[.04,-.39],[.23,-.48],[.36,-.32],[.48,-.28],[.56,-.04],[.48,.21],[.27,.31],[.1,.4],[-.16,.31]];
   shape(id,lobes.map(([dx,dy])=>[x+w*dx,y+h*dy] as P),colour,parent,woodland?2.3:3.1,.22);return;
  }
  // Attached foliage lobes rather than one smooth oval for every crown.
  const lobes:P[]=[[-.5,.19],[-.58,-.04],[-.46,-.24],[-.34,-.22],[-.29,-.42],[-.09,-.49],[.03,-.34],[.18,-.44],[.33,-.29],[.44,-.27],[.55,-.05],[.49,.17],[.3,.27],[.12,.37],[-.12,.3],[-.27,.34]];
  for(const [dx,dy] of lobes)pts.push([x+(dx+(r()-.5)*.045)*w,y+(dy+(r()-.5)*.05)*h]);
  shape(id,pts,colour,parent,3.3,.21);
 }
 function tree(id:string,x:number,y:number,h:number,kind=o.vegetation,parent='nature-world'){
  const r=rng(id),lean=(r()-.5)*h*(woodland?.07:.23),top=y-h,thick=h*.067;
  const crownX=x+lean;
  if(kind==='bamboo'){
   for(let k=0;k<4;k++){
    const dx=(k-1.5)*12,end=x+dx*1.8;
    shape(id+'-cane-'+k,[[x+dx-3,y],[end-4,top+20+k*8],[end+2,top+18+k*8],[x+dx+4,y]],k%2?C.wood:C.moss,parent,2,.04);
    for(let z=0;z<4;z++)line(id+'-joint-'+k+'-'+z,[[x+dx-3+(end-x-dx)*(z/4),y-h*z/4],[x+dx+4+(end-x-dx)*(z/4),y-h*z/4-1]],pen.ink,1.4,parent);
   }
   let leaves='',twigs='';
   if(woodland){
    for(let k=0;k<20;k++){
     const px=x+(r()-.5)*65,py=top+20+r()*h*.64,sign=r()<.5?-1:1,len=22+r()*25;
     leaves+=`M${px} ${py}q${sign*len*.4} ${-len*.7} ${sign*len} ${-len*.5}q${-sign*len*.35} ${len*.5} ${-sign*len} ${len*.5}Z`;
    }
    add(id+'-bamboo-leaves',leaves,C.leaf,parent,pen.ink,2);return;
   }
   for(let k=0;k<11;k++){
    const sign=k%2?1:-1,px=x+(r()-.5)*24,py=top+20+k*h*.053,len=(.21+r()*.1)*h;
    twigs+=`M${px} ${py+18}q${sign*len*.48} -29 ${sign*len} -12`;
    for(let j=0;j<5;j++){
     const t=.25+j*.17,lx=px+sign*len*t,ly=py+18-58*t+46*t*t,tip=22+r()*22;
     const dy=j%2?-tip*.75:tip*.7,dx=sign*tip*.72;
     leaves+=`M${lx} ${ly}q${dx*.4} ${dy*.12} ${dx} ${dy}q${-dx*.7} ${-dy*.22} ${-dx} ${-dy}Z`;
    }
   }
   const compact=(s:string)=>s.replace(/-?\d+(?:\.\d+)?/g,n=>Number(n).toFixed(1));
   add(id+'-bamboo-twigs',compact(twigs),'none',parent,C.woodShade,1.6);
   add(id+'-bamboo-leaves',compact(leaves),C.leaf,parent,pen.ink,1.4);return;
  }
  if(woodland&&kind==='pine'){
   // Full-height forest trees, not identical bonsai perched at the two edges.
   const bw=h*.12;
   shape(id+'-trunk',[[x-bw,y],[x-bw*.35,y-h*.24],[crownX-6,top+30],[crownX+8,top+30],[x+bw*.35,y-h*.25],[x+bw,y]],C.wood,parent,3.4,.055);
   for(let k=3;k>=0;k--){
    const cy=top+45+k*h*.132,spread=h*(.115+k*.062),cx=x+lean*(1-k*.17);
    shape(id+'-crown-'+k,[[cx,cy-h*.13],[cx+spread*.44,cy-h*.04],[cx+spread*.72,cy+21],[cx+spread*.6,cy+23],[cx+spread,cy+h*.105],[cx+spread*.37,cy+h*.087],[cx+spread*.13,cy+h*.117],[cx-spread*.43,cy+h*.092],[cx-spread,cy+h*.108],[cx-spread*.65,cy+23],[cx-spread*.78,cy+23],[cx-spread*.39,cy-h*.04]],k%2?C.leaf:C.leafDark,parent,3.2,.04);
    add(id+'-needle-clusters-'+k,`M${cx-spread*.5} ${cy+28}q10-7 21 0m${spread*.4} -2q11-8 21-1`,'none',parent,C.leafDark,1.6);
   }
   add(id+'-bark',`M${x-13} ${y-10}q18-31 14-80l-3-48M${x+13} ${y-26}q-13-30-7-64M${x-bw+8} ${y-3}q22-4 32-19`,'none',parent,C.woodShade,1.7);
   return;
  }
  if(woodland||o.water==='waterfall'){
   // Connected, flared forest trunks and overlapping lobed crowns follow the
   // reference's large foreground trees. The per-tree RNG varies proportion,
   // not the attachment between trunk, branches and canopy.
   const root=h*.19,crownY=top+h*.1;
   shape(id+'-trunk',[[x-root,y],[x-root*.56,y-h*.08],[x-root*.27,y-h*.29],[crownX-root*.2,top+h*.15],[crownX+root*.2,top+h*.15],[x+root*.32,y-h*.32],[x+root*.62,y-h*.09],[x+root,y]],C.wood,parent,3.5,.12);
   shape(id+'-branch-left',[[x-7,y-h*.55],[crownX-h*.19,top+h*.12],[crownX-h*.21,top+h*.1],[x-22,y-h*.52]],C.wood,parent,2.7,.1);
   shape(id+'-branch-right',[[x+8,y-h*.59],[crownX+h*.2,top+h*.13],[crownX+h*.23,top+h*.12],[x+22,y-h*.55]],C.wood,parent,2.7,.1);
   canopy(id+'-crown-back',crownX+h*.16,crownY+h*.1,h*.58,h*.43,parent,C.leafDark);
   canopy(id+'-crown-left',crownX-h*.19,crownY+h*.07,h*.59,h*.46,parent,C.leaf);
   canopy(id+'-crown-front',crownX+h*.03,crownY-h*.08,h*.63,h*.4,parent,C.leafBright);
   canopy(id+'-crown-tip-left',crownX-h*.14,crownY-h*.19,h*.34,h*.27,parent,C.leaf);
   canopy(id+'-crown-tip-right',crownX+h*.24,crownY-h*.12,h*.31,h*.24,parent,C.leafBright);
   let bark=`M${x-root*.83} ${y-3}q${root*.55} -5 ${root*.66} -28M${x+root*.75} ${y-3}q${-root*.51} -8 ${-root*.59} -31`;
   for(let k=0;k<3;k++){const bx=x+(k-1)*root*.22; bark+=`M${bx} ${y-h*.1-k*13}q${(r()-.5)*16} ${-h*.17} ${crownX-x} ${-h*.38}`;}
   add(id+'-bark',bark,'none',parent,C.woodShade,1.8);
   for(let k=0;k<4;k++){
    const px=crownX+(r()-.5)*h*.48,py=crownY+(r()-.5)*h*.19;
    line(id+'-foliage-'+k,[[px-15,py+5],[px-3,py-1],[px+10,py+3]],C.leafDark,1.7,parent);
   }
   // Vines start inside a crown and carry their own attached leaves.
   if(id.endsWith('1')||id.endsWith('3')){
    const vx=crownX-h*.24,vy=crownY+h*.04;
    add(id+'-vine',`M${vx} ${vy}q-12 42-2 77q12 37-6 70`,'none',parent,C.leafDark,1.6);
    add(id+'-vine-leaves',`M${vx-3} ${vy+37}q-16-9-16 4q8 10 16-4Z M${vx} ${vy+87}q17-8 18 4q-10 10-18-4Z M${vx-4} ${vy+126}q-16-8-14 5q9 7 14-5Z`,C.leaf,parent,C.leafDark,1);
   }
   return;
  }
  shape(id+'-trunk',[[x-thick*.65,y],[x-thick*.35,y-h*.28],[x+lean*.48-thick*.38,y-h*.62],[crownX-4,top+18],[crownX+4,top+18],[x+lean*.52+thick*.38,y-h*.61],[x+thick*.35,y-h*.24],[x+thick*.8,y]],C.wood,parent,3.4,.15);
  if(kind==='pine'){
   for(let k=0;k<4;k++){
    const py=top+28+k*h*.16+(r()-.5)*13,spread=h*(.13+k*.046),cx=x+lean*(1-k*.16);
    line(id+'-bough-'+k,[[cx-spread,py-3],[cx-spread*.47,py+9],[cx,py+18],[cx+spread*.6,py+1],[cx+spread,py-6]],C.woodShade,5,parent);
    for(let j=0;j<3;j++){
     const px=cx+(j-1)*spread*.72+(r()-.5)*14,cy=py+(j===1?-10:0)+(r()-.5)*8;
     const w=spread*(1.14+r()*.3),hh=h*(.12+r()*.035);
     const needles:P[]=[[px-w*.56,cy+4],[px-w*.5,cy-hh*.23],[px-w*.33,cy-hh*.2],[px-w*.32,cy-hh*.52],[px-w*.13,cy-hh*.6],[px+w*.01,cy-hh*.46],[px+w*.16,cy-hh*.64],[px+w*.33,cy-hh*.49],[px+w*.36,cy-hh*.21],[px+w*.51,cy-hh*.25],[px+w*.55,cy+3],[px+w*.29,cy+hh*.25],[px-w*.13,cy+hh*.3]];
     shape(id+'-needles-'+k+'-'+j,needles,(k+j)%3===0?C.leafBright:j===1?C.leaf:C.leafDark,parent,2.8,.19);
    }
    line(id+'-needle-marks-'+k,[[cx-spread*.6,py-3],[cx-spread*.4,py-8],[cx-spread*.24,py-3]],pen.ink,1.4,parent);
   }
  }else{
   for(const [k,dx,dy] of [[0,-h*.16,-h*.7],[1,h*.19,-h*.76]] as const)
    shape(id+'-branch-'+k,[[x+lean*.5,y-h*.53],[x+dx,y+dy],[x+dx+4,y+dy-3],[x+lean*.5+6,y-h*.55]],C.wood,parent,2.7);
   canopy(id+'-crown-back',crownX+h*.18,top+h*.18,h*.66,h*.39,parent,C.leafDark);
   canopy(id+'-crown-left',crownX-h*.2,top+h*.14,h*.61,h*.4,parent,C.leaf);
   canopy(id+'-crown-front',crownX+h*.035,top+h*.025,h*.62,h*.4,parent,C.leafBright);
   for(let k=0;k<2+Math.floor(r()*3);k++){
    const px=crownX+(r()-.5)*h*.35,py=top+h*(-.02+r()*.2);
    line(id+'-leaves-'+k,[[px-10,py+5],[px,py],[px+12,py+3]],C.leafDark,2,parent);
   }
  }
  line(id+'-bark',[[x+3,y-25],[x-2,y-h*.36],[x+lean*.45+2,y-h*.58]],C.woodShade,2,parent);
  line(id+'-roots',[[x-thick*1.4,y+2],[x-thick*.5,y-5],[x+5,y],[x+thick*1.3,y+3]],pen.ink,2.4,parent);
 }
 function ridge(id:string,y:number,amplitude:number,colour:string,phase:number){
  const r=rng(id),pts:P[]=[[-40,760],[-40,y]];
  for(let i=0;i<=10;i++)pts.push([i*135-30,y-Math.sin(i*.9+phase)*amplitude-r()*amplitude*.5]);
  pts.push([1320,760]);shape(id,pts,colour,'forest-backdrop',1.7,.12);
 }

 // Receding landforms occupy the entire world; the water and banks below join
 // them at real edges. Nothing is a screen-space picture inside another set.
 group('forest-backdrop',{x:0,y:80,width:1280,height:570});
 if(woodland||bambooReach){
  ridge('mountains-far',292,71,C.far,.8+R());
  ridge('mountains-middle',348,44,C.ridge,1.5+R());
  let shrubs='M-40 490V361';
  for(let i=0;i<23;i++){
   const x=i*62-40,y=351-(i%3)*9;
   shrubs+=`C${x+2} ${y-42} ${x+35} ${y-43} ${x+43} ${y-12}Q${x+57} ${y-30} ${x+62} ${y+4}`;
  }
  if(woodland){
   let firs='';for(let i=0;i<23;i++){
    const x=i*62-25+(R()-.5)*22,y=375+(i%3)*12,h=87+R()*86,w=h*.58;
    firs+=`M${x} ${y-h}L${x+w*.18} ${y-h*.52}L${x+w*.09} ${y-h*.52}L${x+w*.3} ${y-h*.18}L${x+w*.18} ${y-h*.18}L${x+w*.4} ${y}L${x-w*.4} ${y}L${x-w*.18} ${y-h*.18}L${x-w*.3} ${y-h*.18}L${x-w*.09} ${y-h*.52}L${x-w*.18} ${y-h*.52}Z`;
   }
   add('forest-firs',firs.replace(/-?\d+(?:\.\d+)?/g,n=>Number(n).toFixed(1)),'#647b61','forest-backdrop','#4c664f',.9);
  }
  // Low undergrowth covers distant tree bases; it cannot cut across the
  // foreground trunks. This keeps depth without black overlapping triangles.
  add('hills-near',shrubs+'L1320 490Z',C.hill,'forest-backdrop',woodland?'#405c43':pen.ink,woodland?1.6:2.5);
 }else{
  ridge('mountains-far',265,o.water==='waterfall'?75:141,C.far,.8+R());
  ridge('mountains-middle',330,o.water==='waterfall'?57:95,C.ridge,1.5+R());
  ridge('hills-near',410,o.water==='waterfall'?38:59,C.hill,2.1+R());
 }
 let silhouettes='';
 for(let i=0;i<32;i++){
  const x=i*43+(R()-.5)*20,y=400+Math.sin(i*.44)*20,h=23+R()*26;
  silhouettes+=o.vegetation==='pine'?`M${x-14} ${y}q-3-9 5-12q-4-9 4-12q-1-12 7-14q8 1 7 13q9 2 5 12q11 4 9 13Z`:
   `M${x-17} ${y}q-5 ${-h*.45} 7 ${-h*.52}q-1 ${-h*.55} 12 ${-h*.52}q13 ${-h*.1} 15 ${h*.46}q14 5 8 ${h*.45}Z`;
 }
 add('distant-woodland',silhouettes,C.leafDark,'forest-backdrop');
 shape('cloud',[[180,110],[214,105],[232,91],[258,97],[274,88],[306,98],[345,105],[335,113]],'#d0ded3','forest-backdrop',0);
 if(o.light==='night')nodes.push({id:'moon',type:'ellipse',parent:world.id,x:360,y:176,rx:21,ry:21,fill:'#f2e4bf',light:{kind:'moon',radius:59}});

 if(o.atmosphere!=='clear')group('forest-haze',{x:0,y:210,width:1280,height:290},{atmosphere:{kind:'fog',density:o.atmosphere==='fog'?.5:.2,seed:o.seed+1,speed:.45}});
 group('terrain',{x:0,y:350,width:1280,height:370});
 shape('open-earth',[[-30,427],[220,416],[450,432],[710,416],[980,426],[1310,410],[1320,760],[-40,760]],C.earth,'terrain',0);
 const cliffMode=o.terrain==='cliffs'&&o.water!=='waterfall';
 const streamMode=!cliffMode&&(o.water==='stream'||o.water==='river');
 const riverEnd=bambooReach?490+side*100:focus+(side===0?100:-side*120),bend=bambooReach?632+(R()-.5)*90:focus+(R()-.5)*200;
 if(o.water==='waterfall'){
  // One opaque rock face runs behind the entire falling water. Side planes
  // overlap it; they must never expose sky, distant trees or soil through gaps.
  group('cliff',{x:0,y:crest-30,width:1280,height:500});
  shape('escarpment-top',[[focus-322,crest+59],[focus-271,crest-10],[focus-163,crest-54],[focus-17,crest-73],[focus+134,crest-83],[focus+251,crest-18],[focus+335,crest+55],[focus+179,crest+13],[focus-180,crest+14]],C.moss,'cliff',2.5,.11);
  shape('forest-slope-left',[[-30,395],[130,352],[focus-340,crest+72],[focus-281,impact+43],[98,impact+69],[-35,impact+103]],C.hill,'cliff',2.4,.17);
  shape('forest-slope-right',[[focus+279,impact+53],[focus+315,crest+89],[1110,357],[1310,400],[1310,impact+137],[1124,impact+69]],C.leaf,'cliff',2.4,.16);
  shape('cliff-backwall',[[focus-180,crest+10],[focus+180,crest+10],[focus+190,impact+25],[focus-190,impact+25]],C.stoneShade,'cliff',0,0);
  shape('cliff-left',[[focus-323,crest+61],[focus-270,crest+12],[focus-168,crest-8],[focus-89,crest+19],[focus-110,crest+100],[focus-96,crest+159],[focus-166,impact-16],[focus-277,impact+50],[focus-351,impact+17],[focus-311,crest+137]],C.stoneShade,'cliff',3.7,.075);
  shape('cliff-right',[[focus+86,crest+16],[focus+144,crest-3],[focus+219,crest+11],[focus+287,crest-7],[focus+338,crest+74],[focus+311,crest+146],[focus+356,impact+31],[focus+260,impact+47],[focus+140,impact-12],[focus+123,crest+154],[focus+103,crest+98]],C.stone,'cliff',3.7,.075);
  shape('cliff-left-plane',[[focus-146,crest+7],[focus-241,crest+46],[focus-218,crest+97],[focus-159,crest+126],[focus-216,impact-30],[focus-165,impact-17],[focus-98,crest+157],[focus-113,crest+99]],C.stone,'cliff',2,.07);
  shape('cliff-right-plane',[[focus+145,crest+4],[focus+222,crest+14],[focus+184,crest+77],[focus+207,crest+122],[focus+166,impact-14],[focus+139,impact-13],[focus+124,crest+152],[focus+105,crest+98]],C.stoneTop,'cliff',1.7,.08);
  shape('cliff-left-light',[[focus-270,crest+16],[focus-176,crest+2],[focus-130,crest+30],[focus-181,crest+79],[focus-238,crest+108],[focus-302,crest+94]],C.stoneTop,'cliff',0,.025);
  shape('cliff-left-shade',[[focus-307,crest+136],[focus-245,crest+126],[focus-190,crest+158],[focus-162,crest+193],[focus-221,impact+21],[focus-287,impact+42]],C.stoneShade,'cliff',0,.035);
  shape('cliff-right-light',[[focus+152,crest+9],[focus+279,crest+3],[focus+316,crest+70],[focus+274,crest+125],[focus+204,crest+110],[focus+181,crest+58]],C.stoneTop,'cliff',0,.025);
  shape('cliff-right-shade',[[focus+208,crest+153],[focus+300,crest+137],[focus+320,impact+24],[focus+276,impact+40],[focus+217,impact+6]],C.stoneShade,'cliff',0,.025);
  line('cliff-stratum-left',[[focus-305,crest+116],[focus-254,crest+106],[focus-205,crest+115],[focus-164,crest+105]],C.woodShade,1.6,'cliff');
  line('cliff-stratum-right',[[focus+180,crest+143],[focus+227,crest+134],[focus+267,crest+143],[focus+311,crest+134]],C.woodShade,1.6,'cliff');
  line('cliff-fracture-left',[[focus-225,crest+30],[focus-212,crest+61],[focus-230,crest+85]],C.woodShade,1.4,'cliff');
  line('cliff-fracture-right',[[focus+273,crest+165],[focus+259,crest+198],[focus+271,crest+218]],C.woodShade,1.4,'cliff');
  for(const [i,x,y,w] of [[0,focus-244,crest+19,66],[1,focus+259,crest+11,79],[2,focus-207,impact-5,45]] as const){
   shape('slab-moss-'+i,[[x-w*.5,y],[x-w*.24,y-5],[x,y-2],[x+w*.23,y-7],[x+w*.5,y],[x+w*.34,y+5],[x-w*.14,y+6]],C.moss,'cliff',0,.12);
  }
  group('waterfall',{x:focus-92,y:crest-25,width:184,height:impact-crest+40});
  shape('upper-water',[[focus+75,crest-70],[focus+115,crest-65],[focus+124,crest-52],[focus+60,crest-27],[focus+68,crest-14],[focus+75,crest+10],[focus-74,crest+10],[focus-38,crest-11],[focus+28,crest-23],[focus+71,crest-47]],C.water,'waterfall',2.5,.09);
  shape('fall-ribbon',[[focus-73,crest+4],[focus-38,crest+10],[focus+4,crest+8],[focus+75,crest+4],[focus+60,crest+88],[focus+67,crest+174],[focus+91,impact+8],[focus+41,impact+15],[focus-26,impact+13],[focus-87,impact+8],[focus-63,crest+169],[focus-60,crest+88]],C.foam,'waterfall',0,.025);
  // Separate narrow water sheets accelerate and spread into the receiving pool.
  // No heavy black outline or round blue patch at the top of the falling water.
  for(let i=0;i<7;i++){
   const x=focus-65+i*19,w=2+R()*5,drift=(i-3)*2.3,end=impact+5+R()*9;
   shape('fall-sheet-'+i,[[x,crest+10+R()*9],[x+w,crest+10],[x+w-1,crest+112],[x+w+drift,crest+210],[x+w+drift*1.5,end],[x+drift*1.5-2,end+5],[x+drift-1,crest+210],[x+2,crest+110]],i%3===1?'#fff8e6':C.waterLight,'waterfall',0,.015);
   nodes[nodes.length-1]!.opacity=i%3===1?.7:.3;
  }
  group('pool',{x:focus-320,y:impact-12,width:640,height:200});
  shape('pool-water',[[focus-100,impact-8],[focus-220,impact-5],[focus-295,impact+26],[focus-375,impact+52],[focus-363,impact+103],[focus-279,impact+139],[focus-178,impact+168],[focus-150,760],[focus+201,760],[focus+163,impact+173],[focus+289,impact+132],[focus+365,impact+100],[focus+343,impact+58],[focus+265,impact+18],[focus+105,impact-7]],C.water,'pool',3.6,.16);
  shape('impact-splash',[[focus-97,impact+6],[focus-78,impact-9],[focus-61,impact-3],[focus-43,impact-17],[focus-21,impact-8],[focus+7,impact-12],[focus+24,impact-3],[focus+51,impact-13],[focus+67,impact-3],[focus+89,impact-7],[focus+108,impact+14],[focus+76,impact+24],[focus+17,impact+20],[focus-32,impact+26],[focus-75,impact+18]],C.foam,'pool',0,.16);
  for(let i=0;i<3;i++){
   const rx=113+i*31,y=impact+22+i*10,depth=12+i*4;
   add('impact-foam-'+i,`M${focus-rx} ${y}C${focus-rx*.6} ${y+depth} ${focus+rx*.5} ${y+depth+4} ${focus+rx} ${y-3}`,'none','pool',C.foam,2.4-i*.4);
  }
  let spray='';
  for(let i=0;i<18;i++){const x=focus+(R()-.5)*238,y=impact-8-R()*34,r=1.4+R()*2.6;spray+=`M${x.toFixed(1)} ${y.toFixed(1)}a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(r*2).toFixed(1)} 0a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-r*2).toFixed(1)} 0Z`;}
  add('impact-spray',spray,C.foam,'pool');
  add('pool-current-0',`M${focus-227} ${impact+80}q96 17 174 9M${focus+72} ${impact+82}q77 3 145-10`,'none','pool',C.waterLight,1.6);
  add('pool-current-1',`M${focus-137} ${impact+130}q126 12 233-4`,'none','pool',C.waterLight,1.5);
 }else if(streamMode){
  group('stream',{x:Math.min(focus,riverEnd)-250,y:350,width:600,height:400});
  const w=o.water==='river'?1.5:1;
  shape('stream-water',[[focus-5,390],[focus-13*w,410],[focus-45*w,439],[bend-86*w,472],[riverEnd-160*w,610],[riverEnd-246*w,755],[riverEnd+245*w,755],[riverEnd+122*w,605],[bend+80*w,472],[focus+28*w,435],[focus+11*w,408],[focus+5,390]],C.water,'stream',3.6,.16);
  line('stream-reflection',[[focus-3,411],[focus+2,439],[bend-12,487],[riverEnd-16,616],[riverEnd+34,732]],C.waterLight,3,'stream');
  line('stream-near-current',[[bend+27,500],[riverEnd+36,613],[riverEnd+109,732]],C.waterLight,1.9,'stream');
  shape('bank-left',[[-30,443],[focus-64,421],[bend-105*w,483],[riverEnd-192*w,609],[riverEnd-276*w,754],[-40,760]],C.earth,'terrain',3.6,.11);
  shape('bank-right',[[focus+70,414],[1320,428],[1320,760],[riverEnd+270*w,754],[riverEnd+158*w,606],[bend+107*w,479]],C.earth,'terrain',3.6,.11);
  // Paint banks above the water but not above later bridge/rocks.
  // terrain was introduced before stream; reparent these two paints to a new layer.
  group('stream-banks');
  for(const n of nodes)if(n.id.startsWith('scenery-bank-'))n.parent='stream-banks';
 }else if(!cliffMode){
  group('clearing',{x:0,y:410,width:1280,height:310});
  shape('clearing-earth',[[-30,462],[155,430],[345,451],[560,425],[769,440],[1000,424],[1310,457],[1310,760],[-30,760]],C.earth,'clearing',2.8,.13);
  shape('clearing-path',[[-30,587],[234,572],[473,589],[753,562],[1017,576],[1310,551],[1310,649],[1031,643],[761,630],[479,650],[228,636],[-30,649]],'#bea77b','clearing',2.2,.1);
  shape('clearing-rise',[[900,449],[1008,399],[1135,396],[1307,429],[1310,527],[1083,514],[931,520]],C.earth,'clearing',2.3,.18);
 }else{
  group('valley',{x:0,y:300,width:1280,height:440});
  shape('valley-left',[[0,409],[220,373],[430,404],[650,462],[940,570],[1320,692],[1320,760],[-40,760]],C.leaf,'valley',2.8,.19);
  shape('valley-right',[[1280,397],[1100,375],[920,418],[820,454],[690,532],[580,620],[510,760],[1320,760]],C.hill,'valley',2.8,.19);
  for(const [i,x,y,w] of [[0,480,441,170],[1,682,513,105],[2,1093,454,152],[3,1177,600,183],[4,545,667,126],[5,801,572,96]] as const){
   shape('valley-grove-'+i,[[x-w*.5,y],[x-w*.38,y-14],[x-w*.19,y-19],[x-w*.1,y-31],[x+w*.13,y-24],[x+w*.26,y-27],[x+w*.4,y-9],[x+w*.53,y],[x+w*.17,y+14],[x-w*.18,y+10]],i%2?C.leafDark:C.leafBright,'valley',1.5,.17);
   let stand='';
   for(let k=0;k<5;k++){const px=x+(k-2)*w*.13,py=y+Math.sin(k)*5;stand+=`M${px-7} ${py}l4-9-2 0 5-11 4 10-2 0 5 10Z`;}
   add('grove-trees-'+i,stand,i%2?C.leaf:C.leafDark,'valley');
  }
  if(cliffMode&&o.water!=='none'){
   group('river-water',{x:640,y:360,width:550,height:360});
   shape('valley-river',[[910,363],[876,400],[938,442],[867,500],[1009,568],[939,625],[1040,739],[1100,755],[989,627],[1062,566],[912,499],[965,442],[901,401],[922,363]],C.waterLight,'river-water',2.2,.14);
  }
 }

 if(o.terrain==='gorge'&&streamMode){
  // Both screenplay words identify the actual same banks. A missing semantic
  // ID made visual repair draw unrelated replacement cliffs over the bridge.
  group('cliff',{x:0,y:423,width:1280,height:297});
  group('rock-ledges',{x:0,y:445,width:1280,height:260},{parent:'cliff'});
  shape('gorge-left',[[0,445],[163,423],[focus-165,446],[bend-133,504],[riverEnd-242,640],[0,720]],C.stone,'rock-ledges',3.6,.1);
  shape('gorge-right',[[1280,423],[1125,425],[focus+173,444],[bend+137,506],[riverEnd+213,641],[1280,720]],C.stoneShade,'rock-ledges',3.6,.1);
  shape('gorge-grass-left',[[0,443],[163,426],[focus-165,448],[focus-186,464],[155,453],[0,469]],C.moss,'rock-ledges',1.8,.13);
  shape('gorge-grass-right',[[1280,423],[1125,428],[focus+173,448],[focus+191,470],[1138,455],[1280,449]],C.leaf,'rock-ledges',1.8,.13);
  for(let i=0;i<3;i++)line('gorge-fault-'+i,[[90+i*95,456],[110+i*88,496],[82+i*77,530]],pen.ink,2,'rock-ledges');
  line('bank-root-main',[[168,523],[198,551],[257,570],[319,609]],C.woodShade,5,'rock-ledges');
  line('bank-root-fork',[[197,550],[236,552],[278,575],[305,576]],C.woodShade,3,'rock-ledges');
 }
 if(o.bridge){
  const y=o.water==='waterfall'?impact+57:482,cx=o.water==='waterfall'?focus:bend;
  const left=cx-(o.water==='waterfall'?415:179),right=cx+(o.water==='waterfall'?415:185);
  group('bridge',{x:left-35,y:y-68,width:right-left+70,height:125},{groundAnchor:{x:cx,y:y+20},groundOffsetY:y+20-620});
  rock('bridge-foot-left',left,y+31,73,51,'bridge');rock('bridge-foot-right',right,y+7,76,46,'bridge');
  shape('bridge-underbeam',[[left-12,y+4],[right+13,y-24],[right+12,y-9],[left-11,y+21]],C.woodShade,'bridge',3.2,.06);
  const boards=o.water==='waterfall'?24:12;
  for(let i=0;i<boards;i++){
   const x=left+(right-left)*i/boards,dx=(right-left)/boards,yy=y-(x-left)*.075;
   shape('bridge-board-'+i,[[x-2,yy],[x+dx-1,yy-dx*.075],[x+dx-1,yy-dx*.075+8],[x-2,yy+8]],i%3===0?C.woodShade:C.wood,'bridge',2.3,0);
  }
  for(let i=0;i<4;i++){
   const x=left+(right-left)*i/3,yy=y-(x-left)*.075;
   shape('bridge-post-'+i,[[x-4,yy-56],[x+3,yy-58],[x+5,yy+7],[x-5,yy+10]],C.woodShade,'bridge',2.5);
  }
  line('bridge-rail',[[left-11,y-55],[left+118,y-63],[left+247,y-73],[right+12,y-84]],C.wood,7,'bridge');
  line('bridge-rail-ink',[[left-11,y-60],[left+118,y-67],[left+247,y-77],[right+12,y-88]],pen.ink,2.4,'bridge');
 }

 // Edge planting frames the focal opening. Every trunk/root shares its bank.
 group('forest-front',{x:0,y:180,width:1280,height:540});
 const plants:P[]=woodland?[[95,550],[414,529],[1143,568]]:bambooReach?[[-12,619],[193,503],[1094,522],[1290,645]]:o.water==='waterfall'?[[35,570],[205,524],[1130,538],[1278,587]]:
  cliffMode?[[1120,575],[1265,634]]:[[25,600],[177,536],[1130,527],[1270,632]];
 for(const [i,p] of plants.entries()){
  if(i===0&&!cliffMode)group('tree',{x:p[0]-110,y:p[1]-320,width:260,height:330},{parent:'forest-front'});
  tree('edge-tree-'+i,p[0]+(R()-.5)*25,p[1],woodland?430+R()*125:bambooReach?340+R()*105:210+R()*80,o.vegetation==='bamboo'&&i===plants.length-1?'mixed':o.vegetation,i===0&&!cliffMode?'tree':'forest-front');
 }
 if(cliffMode){
  group('cliff',{x:0,y:480,width:520,height:270},{groundAnchor:{x:220,y:620},groundOffsetY:0});
  shape('overlook-rock',[[0,503],[138,485],[239,507],[325,550],[441,590],[507,650],[449,747],[-40,760]],C.stoneShade,'cliff',4,.12);
  shape('overlook-top',[[0,503],[140,491],[241,515],[322,556],[442,595],[377,623],[274,580],[163,564],[0,550]],C.earth,'cliff',3.3,.15);
  for(let i=0;i<4;i++)line('overlook-crack-'+i,[[80+i*85,570+i*15],[97+i*78,620+i*17],[78+i*83,687+i*10]],pen.ink,2.3,'cliff');
  group('tree',{x:90,y:256,width:320,height:375});
  group('pine-tree',{x:90,y:256,width:320,height:375},{parent:'tree'});
  tree('overlook-pine',205,551,294,'pine','pine-tree');
  fern('ledge-fern',355,603,.85,'cliff');
 }
 group('river-stones',{x:0,y:480,width:1280,height:240});
 const stonePositions:P[]=o.water==='waterfall'?[[focus-269,impact+69],[focus+275,impact+95],[focus+155,impact+165]]:
  streamMode?(bambooReach?[[bend-31,506],[riverEnd+143,663]]:[[bend-52,519],[riverEnd+83,621],[riverEnd-141,703]]):cliffMode?[[50,543],[288,602]]:[[853,568],[1140,684]];
 for(const [i,p] of stonePositions.entries()){
  const w=55+R()*48,h=34+R()*31,deckY=o.water==='waterfall'?impact+57:482;
  const y=o.bridge&&p[1]-h<deckY+24&&p[1]>deckY-30?deckY+40+h:p[1];
  rock('water-stone-'+i,p[0],y,w,h,'river-stones',o.water!=='none'&&!cliffMode);
 }
 const fernPositions:P[]=cliffMode?[[49,545],[128,568],[394,625],[1143,636]]:[[100,655],[285,594],[1084,615],[1217,681]];
 group('bank-plants');
 // Place ground detail on the two real banks/ledges, never over the channel.
 // Shared clusters create texture at several depths rather than one empty
 // floor with four equally spaced plants.
 const bankZones=o.water==='waterfall'?[[30,230,590,710],[1070,1260,570,710]]:
  cliffMode?[[25,275,530,575],[1080,1260,565,690]]:
  [[20,Math.max(170,Math.min(bend-200,riverEnd-300)),555,710],[Math.min(1110,Math.max(bend+220,riverEnd+305)),1260,550,710]];
 let grass='',pebbles='',dryMarks='';
 for(const [zoneIndex,zone] of bankZones.entries()){
  const [left,right,top,bottom]=zone as [number,number,number,number];
  for(let k=0;k<18;k++){
   const x=Math.round(left+R()*(right-left)),y=Math.round(cliffMode&&zoneIndex===0?510+Math.max(0,x-140)*.22+R()*22:top+R()*(bottom-top)),s=(k%3+2)*.25;
   grass+=`M${x-9*s} ${y}q2 ${-8*s} 5 ${-12*s}l${3*s} ${9*s}q1 ${-13*s} ${5*s} ${-16*s}l${2*s} ${14*s}q${5*s} ${-8*s} ${8*s} ${-10*s}l${-4*s} ${15*s}Z`;
   if(k%3===0)pebbles+=`M${x+13} ${y+4}q${5*s} ${-7*s} ${12*s} ${-3*s}l${2*s} ${4*s}Z`;
   if(k%2===0)dryMarks+=`M${x-16} ${y+6}q${10*s} ${-4*s} ${20*s} ${-1*s}`;
  }
  const x=left+(right-left)*.6,y=top+(bottom-top)*.6;
  fern('bank-fern-'+zoneIndex,x,y,1.3,'bank-plants');
 }
 add('bank-grass',grass,C.moss,'bank-plants',C.leafDark,1.3);
 add('bank-pebbles',pebbles,C.stoneTop,'bank-plants',pen.ink,1.3);
 add('bank-soil-marks',dryMarks,'none','bank-plants',C.earthShade,1.6);
 if(woodland){
  let litter='';const leafR=rng('ground-leaf-litter');
  for(const [cx,cy] of [[140,573],[390,553],[1090,572]] as const)for(let k=0;k<8;k++){
   const x=cx+(leafR()-.5)*115,y=cy+leafR()*48;
   litter+=`M${x} ${y}q8-9 14-5q-3 8-14 5Z`;
  }
  add('ground-leaf-litter',litter,'#958157','bank-plants','#796b4b',.7);
 }
 // Low thickets rest behind the nearest trunks; their lobed silhouettes and
 // light/shade masses vary independently of the large canopy above them.
 for(const [i,x,y] of [[0,97,494],[1,1194,489]] as const){
  shape('thicket-stem-'+i,[[x-5,y+57],[x-4,y+25],[x-20,y+4],[x-15,y],[x+1,y+24],[x+20,y+5],[x+25,y+7],[x+5,y+30],[x+6,y+58]],C.wood,'bank-plants',2.1,.13);
  canopy('thicket-back-'+i,x+18,y-7,185,100,'bank-plants',C.leafDark);
  canopy('thicket-front-'+i,x-11,y+6,148,81,'bank-plants',C.leaf);
  line('thicket-leaf-'+i,[[x-32,y+3],[x-19,y-5],[x-6,y+2]],C.leafDark,2,'bank-plants');
 }
 canopy('near-shrub-left',40,705,225,92,'bank-plants',C.leafDark);
 canopy('near-shrub-right',1266,704,215,109,'bank-plants',C.leaf);
 for(let i=0;i<5;i++){
  const px=40+i*41,py=663+(i%2)*8;
  line('ground-scratch-'+i,[[px,py],[px+12,py-3],[px+20,py-1]],C.earthShade,1.8,'bank-plants');
 }
 for(const [i,p] of fernPositions.entries())fern('fern-'+i,p[0],p[1],1.1+R()*.5,'bank-plants');
 // Thin, bounded atmospheric element is optional story motion, never an opaque
 // strip across the horizon. Its semantic owner is the actual painted mist.
 group('valley-mist',{x:0,y:330,width:1280,height:340},{opacity:o.atmosphere==='clear'?0:1,atmosphere:{kind:'fog',density:o.atmosphere==='fog'?.85:.34,seed:o.seed,speed:.7}});
 if(o.light==='night')applySceneryNightPalette(nodes);
 const footY=cliffMode?590:620;
 nodes.push({id:'person',type:'instance',parent:world.id,asset:'nature-person',x:cliffMode?285:o.water==='waterfall'?Math.max(10,focus-465):260,
  y:footY-125,width:80.36,height:125,groundAnchor:{x:90,y:280},groundOffsetY:footY-620});
 nodes.push({id:NATURE_SCENERY_VERSION,type:'group',parent:world.id});
 return {assets:{'nature-person':{rig:'simple-puppet',finish:'handdrawn',hair:'short',outfit:'tunic'}},
  stage:{width:frame.width,height:frame.height,nodes,ground:{y:620,parent:world.id,targets:[{target:'person'}]},tracks:[]}};
}
