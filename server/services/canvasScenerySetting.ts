import type {VectorNode} from '../../shared/canvasVectorScene';
import {sceneryPen,sceneryRandom,type SceneryPoint as P} from './canvasSceneryInk';
import {applySceneryNightPalette} from './canvasSceneryLighting';
import courtyardArt from '../assets/vector-styles/folk-horror/approved-courtyard/drawing.json';
import {riversideScenery} from './canvasSceneryRiverside';
import {referenceSettingScenery,REFERENCE_SETTING_PLACES,type ReferenceSettingPlace} from './canvasSceneryReference';

export const SETTING_SCENERY_VERSION='folk-setting-grammar-v1';
export type SettingLayout={place?:'market'|'village'|'street'|'room'|'corridor'|'riverside'|ReferenceSettingPlace;light?:'day'|'dusk'|'night';composition?:'left'|'center'|'right';seed?:number;atmosphere?:'clear'|'mist'|'fog';smoke?:boolean};
export function settingLayout(raw:Record<string,unknown>):Required<SettingLayout>{
 const pick=(key:string,values:string[],fallback:string)=>{if(raw[key]!==undefined&&!values.includes(String(raw[key])))throw new Error('Vector: invalid setting '+key);return String(raw[key]??fallback);};
 if(raw.seed!==undefined&&(!Number.isInteger(raw.seed)||Math.abs(Number(raw.seed))>99999))throw new Error('Vector: invalid setting seed');
 if(raw.smoke!==undefined&&typeof raw.smoke!=='boolean')throw new Error('Vector: setting smoke needs a boolean');
 return {place:pick('place',['market','village','street','room','corridor','riverside',...REFERENCE_SETTING_PLACES],'village') as Required<SettingLayout>['place'],
  light:pick('light',['day','dusk','night'],'day') as Required<SettingLayout>['light'],
  composition:pick('composition',['left','center','right'],'center') as Required<SettingLayout>['composition'],seed:Number(raw.seed??41),atmosphere:pick('atmosphere',['clear','mist','fog'],raw.light==='night'&&raw.place!=='room'&&raw.place!=='corridor'?'mist':'clear') as Required<SettingLayout>['atmosphere'],smoke:raw.smoke===true};
}

/** Code-owned ink/coordinates. AI composes a place and supported story props,
 * never a second room/landscape in guessed screen coordinates. */
export function settingScenery(raw:SettingLayout={},frame={width:1280,height:720}){
 const o=settingLayout(raw as Record<string,unknown>),R=sceneryRandom(o.seed),nodes:VectorNode[]=[];
 if(REFERENCE_SETTING_PLACES.includes(o.place as ReferenceSettingPlace))return referenceSettingScenery({...o,place:o.place as ReferenceSettingPlace},frame);
 if(o.place==='riverside')return riversideScenery(o,frame);
 const pen=sceneryPen(nodes,o.seed),{shape,line,add}=pen,ink=pen.ink;
 const night=o.light==='night',dusk=o.light==='dusk';
 const C={sky:night?'#334b60':dusk?'#bcada0':'#a3cbd5',earth:night?'#968467':'#bca97c',wood:'#997147',darkWood:'#62472f',plaster:'#b9a079',roof:'#a15d46',leaf:'#5d784f',leafDark:'#415d40',leafLight:'#738758',inside:'#30271f',cream:'#d3b567'};
 const wide=frame.width>frame.height,scale=wide?frame.height/720:frame.width/720;
 const world='folk-setting-world',room=o.place==='room'||o.place==='corridor';
 const groundColour=!room&&o.place!=='market'?(night?'#596d53':'#6b8270'):C.earth;
 const town=o.place==='village'||o.place==='street';
 const layoutShift=o.composition==='left'?-70:o.composition==='right'?70:0;
 const group=(id:string,bounds?:{x:number;y:number;width:number;height:number},extra:Partial<VectorNode>={})=>nodes.push({id,type:'group',parent:world,...(bounds?{bounds}:{}),...extra});
 const pivot=o.composition==='left'?460:o.composition==='right'?820:640;
 nodes.push({id:'sky',type:'rect',width:frame.width,height:frame.height,fill:C.sky},
  {id:world,type:'group',x:wide?(frame.width-1280*scale)/2:-(pivot-360)*scale,y:wide?0:frame.height*.79-620*scale,scaleX:scale,scaleY:scale},
  {id:'physical-ground-plane',type:'rect',parent:world,x:-4096,y:620,width:8192,height:4096,fill:groundColour});
 const floorSupport={x:640,y:620,width:1260};
 const supports:Record<string,{x:number;y:number;width:number}>={floor:floorSupport};
 const stem=(id:string,x:number,y:number,h:number)=>{
  group(id,{x:x-h*.34,y:y-h*1.2,width:h*.68,height:h*1.2},{parent:'trees',pivotX:x,pivotY:y,pivotSpace:'local'});
  shape(id+'-trunk',[[x-h*(town?.2:.09),y],[x-h*(town?.08:.04),y-h*.17],[x-7,y-h*.6],[x+2,y-h],[x+12,y-h*.63],[x+h*(town?.09:.04),y-h*.17],[x+h*(town?.22:.1),y]],town?'#7b6f53':C.darkWood,id,town?2.5:3.4,.13);
  const clusters=town&&h>=170?[[-.15,.08,.36,.27],[.16,.07,.38,.28],[-.27,.18,.3,.23],[.29,.17,.3,.22],[0,-.03,.29,.23],[0,.21,.38,.29]]:[[-.12,.07,.38,.27],[0,-.05,.38,.27],[.12,.07,.38,.27]];
  for(const [k,c] of clusters.entries()){
   const [dx,dy,cw,ch]=c as [number,number,number,number],cx=x+dx*h,cy=y-h+dy*h,w=h*cw,hc=h*ch;
   const lobes:P[]=[[-.5,.24],[-.57,-.03],[-.47,-.3],[-.34,-.28],[-.26,-.52],[-.08,-.53],[.04,-.39],[.23,-.48],[.36,-.32],[.48,-.28],[.56,-.04],[.48,.21],[.27,.31],[.1,.4],[-.16,.31]];
   shape(id+'-canopy-'+k,lobes.map(([dx,dy])=>[cx+dx*w,cy+dy*hc] as P),town?(k===4?'#58734b':k%3===1?'#6d874f':'#63814d'):(k===4?C.leafDark:k%3===1?C.leafLight:C.leaf),id,town?2.1:3.1,.22);
   line(id+'-leaf-'+k,[[cx-16,cy+4],[cx-5,cy-2],[cx+8,cy+3]],C.leafDark,town?1.1:1.8,id);
   add(id+'-leaf-clusters-'+k,`M${cx-29} ${cy+14}q5-9 13-5m16-16q7-7 13 0m-3 27q6-6 14 1`,'none',id,C.leafDark,1.1);
  }
  add(id+'-bark',`M${x-6} ${y-13}q-2-34 0-62M${x+6} ${y-h*.34}l1 ${-h*.2}`,'none',id,'#3c3425',1.3);
 };
 const basket=(id:string,x:number,y:number,w:number,parent:string,produce=false)=>{
  shape(id,[[x-w*.48,y-w*.4],[x+w*.5,y-w*.37],[x+w*.38,y],[x-w*.33,y+2]],C.wood,parent,2.6,0);
  line(id+'-rim',[[x-w*.49,y-w*.4],[x,y-w*.35],[x+w*.49,y-w*.37]],C.darkWood,3,parent);
  let weave='';for(let j=0;j<4;j++)weave+=`M${Math.round(x-w*.3+j*w*.18)} ${Math.round(y-w*.3)}q-2 8 2 ${Math.round(w*.25)}`;
  add(id+'-weave',weave,'none',parent,C.darkWood,1.4);
  if(produce)for(let j=0;j<3;j++){
   const px=x+(j-1)*w*.2,py=y-w*.4-3;
   add(id+'-goods-'+j,`M${px-w*.13} ${py}q${-w*.02} ${-w*.16} ${w*.14} ${-w*.2}q${w*.13} ${w*.03} ${w*.12} ${w*.22}Z`,j%2?C.leafLight:'#b5763f',parent,ink,1.4);
  }
 };
 // A pen may wander slightly along an edge, but it must not round a roof
 // corner or bow the whole wall. Keep every structural vertex exact.
 const buildingFace=(id:string,corners:readonly P[],fill:string,parent:string,width:number)=>{
  const points:P[]=[],random=sceneryRandom(o.seed+':building:'+id);
  corners.forEach((a,i)=>{
   const b=corners[(i+1)%corners.length]!,dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),steps=Math.max(1,Math.ceil(length/28));
   points.push(a);
   for(let j=1;j<steps;j++){
    const t=j/steps,offset=(random()-.5)*.9;
    points.push([a[0]+dx*t-dy/length*offset,a[1]+dy*t+dx/length*offset]);
   }
  });
  shape(id,points,fill,parent,width,0);
 };
 function roof(id:string,x:number,y:number,w:number,h:number,parent:string,straw:boolean){
  const eave=y+h,pts:P[]=[[x+w*.18,y],[x+w*.79,y+.6],[x+w,eave]];
  // Straw ends are small, irregular fringes, not a repeating sawtooth roof.
  if(straw){const fringe=sceneryRandom(o.seed+':eave:'+id);for(let px=x+w-8;px>x+6;px-=8+fringe()*10)pts.push([px,eave+(fringe()-.5)*2.2]);}
  pts.push([x,eave]);
  const weight=Math.min(2.5,1.05+w*.004);
  buildingFace(id,pts,straw?'#c8a85f':C.roof,parent,weight);
  let hatch='';const material=sceneryRandom(o.seed+':roof-material:'+id);
  if(straw)for(let j=0;j<Math.floor(w/9);j++){
   const px=x+j*9+(material()-.5)*5,py=y+9+material()*h*.38;
   const inside=(sx:number,sy:number)=>{const t=(sy-y)/h;return sy>y+3&&sy+19<eave-4&&sx>x+w*.18*(1-t)+4&&sx<x+w*.79+w*.21*t-4;};
   const len=8+material()*10;
   if(inside(px,py))hatch+=`M${px} ${py}q${(material()-.5)*3} ${len*.5} -1 ${len}`;
   const lower=eave-26-material()*13;if(inside(px+5,lower))hatch+=`M${px+5} ${lower}q1 6 0 ${7+material()*8}`;
  }else for(let row=0;row<3;row++)for(let j=0;j<Math.floor(w/36)-row;j++){
   const px=x+17+row*7+j*36,py=y+18+row*(h-18)/3;
   const t=(py-y)/h;
   if(py+9<eave-5&&px>x+w*.18*(1-t)+3&&px+13<x+w*.79+w*.21*t-3)hatch+=`M${px} ${py}q5 9 13 0`;
  }
  if(hatch)add(id+'-material',hatch.replace(/-?\d+(?:\.\d+)?/g,n=>Number(n).toFixed(1)),'none',parent,straw?'#9d824b':'#7c4535',Math.min(1.5,.6+w*.003));
 }
 function house(id:string,x:number,y:number,w:number,h:number,straw=false){
  h=Math.min(h,w*.78);
  const top=y-h,eave=top+h*.44,weight=Math.min(2.4,1+w*.004),wallLeft=x+w*.07,wallRight=x+w*.93;
  group(id,{x,y:y-h,width:w,height:h},{parent:'architecture-back',groundAnchor:{x:x+w/2,y},groundOffsetY:y-620});
  buildingFace(id+'-wall',[[wallLeft,eave-1],[wallRight,eave-1],[wallRight,y],[wallLeft,y]],straw?(town?'#ad8658':C.wood):C.plaster,id,weight);
  // Architectural members use exact horizontal/vertical segments. Organic
  // hand variation belongs in the material marks, never in the house corners.
  const beam=Math.max(2,Math.min(6,w*.018));
  add(id+'-wall-perimeter',`M${wallLeft} ${eave-1}H${wallRight}V${y}H${wallLeft}Z`,'none',id,ink,weight*1.15);
  add(id+'-construction-beams',`M${wallLeft} ${eave-1}H${wallRight}V${eave-1+beam}H${wallLeft}ZM${wallLeft} ${eave-1}H${wallLeft+beam}V${y}H${wallLeft}ZM${wallRight-beam} ${eave-1}H${wallRight}V${y}H${wallRight-beam}ZM${wallLeft} ${y-beam}H${wallRight}V${y}H${wallLeft}Z`,C.darkWood,id);
  let planks='';for(let j=1;j<6;j++){const px=wallLeft+(wallRight-wallLeft)*j/6;planks+=`M${px} ${eave+3}l${j%2?.4:-.4} ${y-eave-5}`;}
  add(id+'-planks',planks,'none',id,straw?'#795b3e':'#9b8059',Math.min(1.1,w*.005));
  const doorLeft=x+w*.38,doorRight=x+w*.55,doorTop=eave+(y-eave)*.3;
  group(id+'-door',{x:doorLeft,y:doorTop,width:doorRight-doorLeft,height:y-doorTop},{parent:id,pivotX:doorLeft,pivotY:doorTop,pivotSpace:'local'});
  buildingFace(id+'-door-opening',[[doorLeft,doorTop],[doorRight,doorTop],[doorRight,y],[doorLeft,y]],C.inside,id+'-door',weight*.7);
  if(w>=180){
   const left=x+w*.68,right=x+w*.8,wy=eave+(y-eave)*.25,wh=(y-eave)*.29;
   buildingFace(id+'-window',[[left,wy],[right,wy],[right,wy+wh],[left,wy+wh]],'#6b6650',id,weight*.75);
   add(id+'-window-cross',`M${left+(right-left)*.5} ${wy}V${wy+wh}M${left} ${wy+wh*.5}H${right}`,'none',id,C.darkWood,weight*.8);
   add(id+'-window-sill',`M${left-beam*.45} ${wy+wh}H${right+beam*.45}V${wy+wh+beam*.55}H${left-beam*.45}Z`,C.darkWood,id);
  }
  // Near buildings have construction, not just a rectangle with a hole.
  // Frames belong to the wall; the leaf belongs to the hinged door group.
  if(w>=105){
   const variant=Math.floor(sceneryRandom(o.seed+':house:'+id)()*3),post=w*.018;
   add(id+'-eave-shadow',`M${wallLeft} ${eave-1}H${wallRight}v${h*.035}H${wallLeft}Z`,C.darkWood,id);
   add(id+'-door-frame',`M${doorLeft-post} ${y}V${doorTop-post}H${doorRight+post}V${y}H${doorRight}V${doorTop}H${doorLeft}V${y}Z`,C.darkWood,id,ink,.8);
   add(id+'-threshold',`M${doorLeft-post*2} ${y-2}H${doorRight+post*2}v3H${doorLeft-post*2}Z`,'#a4987c',id,ink,.8);
   add(id+'-post-detail',`M${wallLeft+post} ${eave+5}V${y-2}M${wallRight-post} ${eave+5}V${y-2}`,'none',id,C.darkWood,weight*.65);
   add(id+'-lintel-detail',`M${doorLeft-post*2} ${doorTop-post*2}H${doorRight+post*2}V${doorTop+post}H${doorLeft-post*2}Z`,C.darkWood,id);
   if(w>=180){
    const plaqueLeft=doorLeft+(doorRight-doorLeft)*.16,plaqueWidth=(doorRight-doorLeft)*.68,plaqueTop=doorTop-post*5;
    add(id+'-door-plaque-outline',`M${plaqueLeft-post} ${plaqueTop-post}H${plaqueLeft+plaqueWidth+post}V${plaqueTop+post*3.2}H${plaqueLeft-post}Z`,ink,id);
    add(id+'-door-plaque',`M${plaqueLeft} ${plaqueTop}H${plaqueLeft+plaqueWidth}V${plaqueTop+post*2.2}H${plaqueLeft}Z`,'#a84732',id);
    add(id+'-door-papers',`M${doorLeft-post*2.2} ${doorTop+post*2}H${doorLeft-post*.8}V${y-post*4}H${doorLeft-post*2.2}ZM${doorRight+post*.8} ${doorTop+post*2}H${doorRight+post*2.2}V${y-post*4}H${doorRight+post*.8}Z`,'#a84732',id);
    let panels='';for(let j=0;j<3;j++){const px=wallLeft+w*(.08+j*.1);panels+=`M${px} ${eave+h*.12}H${px+w*.065}V${eave+h*.22}H${px}Z`;}
    add(id+'-wall-panels',panels,'none',id,C.darkWood,Math.max(1.2,weight*.55));
   }
   if(variant===0)buildingFace(id+'-leaf',[[doorLeft,doorTop],[doorLeft+w*.052,doorTop+2],[doorLeft+w*.052,y],[doorLeft,y]],'#b08b59',id+'-door',weight*.5);
   if(variant===1&&w>=180)add(id+'-window-shutter',`M${x+w*.8} ${eave+(y-eave)*.25}l${w*.07} -3v${(y-eave)*.29}l${-w*.07} 3Z`,C.darkWood,id,ink,.8);
   if(variant===2)add(id+'-wall-patches',`M${wallLeft+12} ${y-8}q3-14 0-23q-3-13 0-23`,'none',id,'#cdb88e',1.8);
  }
  roof(id+'-roof',x,top,w,h*.44,id,straw);
 }
 function stall(id:string,x:number,y:number,w:number,h:number,kind=0){
  group(id,{x:x-15,y:y-h,width:w+30,height:h+5},{parent:y>550?'architecture-front':'architecture-middle',groundAnchor:{x:x+w/2,y},groundOffsetY:y-620});
  // Rear posts, counter and front feet share these exact grounded endpoints.
  for(const [j,px] of [[0,x+12],[1,x+w-12]] as const){
   shape(id+'-post-'+j,[[px-4,y],[px-5,y-h*.87],[px+4,y-h*.87],[px+5,y]],C.darkWood,id,2.7,0);
   line(id+'-foot-'+j,[[px-10,y+2],[px+9,y+2]],ink,2.2,id);
  }
  shape(id+'-counter-front',[[x-3,y-h*.3],[x+w+3,y-h*.3],[x+w-2,y-15],[x+4,y-13]],kind===2?'#b2a17b':'#7d5b3d',id,3,0);
  shape(id+'-counter-top',[[x-3,y-h*.3],[x+w+3,y-h*.3],[x+w+3,y-h*.3+5],[x-3,y-h*.3+5]],C.cream,id,2.5,0);
  roof(id+'-awning',x-2,y-h,w+5,h*.26,id,kind!==2);
  if(kind===2){
   for(let j=0;j<3;j++){
    const px=x+18+j*w*.3;
    shape(id+'-cloth-'+j,[[px,y-h*.69],[px+w*.18,y-h*.69],[px+w*.18+2,y-h*.38],[px-2,y-h*.39]],j===1?'#ac5b45':'#d2c39d',id,1.8,0);
    const patternColour=j===1?'#e1bf75':'#9d4f37';let embroidery='';
    for(let row=0;row<3;row++){const cy=y-h*.63+row*h*.075;embroidery+=j===1?`M${px+w*.09} ${cy-5}l6 5-6 5-6-5Z`:`M${px+6} ${cy}h${w*.18-12}m${-(w*.18-12)} 4h${w*.18-12}`;}
    add(id+'-cloth-mark-'+j,embroidery,'none',id,patternColour,1.6);
    add(id+'-cloth-seams-'+j,`M${px+4} ${y-h*.68}v${h*.28}M${px+w*.18-4} ${y-h*.68}v${h*.28}`,'none',id,patternColour,.9);
   }
  }else if(kind===1){
   // A pottery stall has ceramic vessels and stacked bowls, not produce clones.
   for(let j=0;j<4;j++){
    const px=x+w*(.13+j*.24),py=y-h*.3,r=12+j%2*3;
    add(id+'-pottery-'+j,`M${px-r*.5} ${py-31}h${r}v7q${r} 8 ${r*.9} 17q-2 9 ${-r*.9} 10h${-r}q${-r} -2 ${-r*.9} -10q-1-9 ${r*.9} -17Z`,j%2?'#9a6e4b':'#7d8974',id,ink,1.4);
    add(id+'-pottery-rim-'+j,`M${px-r*.5-1} ${py-31}h${r+2}m${-r-2} 5h${r+2}`,'none',id,C.darkWood,1.5);
   }
  }else for(let j=0;j<4;j++){
   const px=x+w*(.12+j*.245),py=y-h*.3,bw=29+w*.035;
   basket(id+'-basket-'+j,px,py,bw,id,false);
   let goods='';for(let k=0;k<5;k++){const gx=px+(k-2)*bw*.13,gy=py-bw*.4-2-(k%2)*4;goods+=`M${gx-4} ${gy}q-2-9 4-10q7 1 5 10Z`;}
   add(id+'-produce-'+j,goods,j%2?'#a67b39':'#728554',id,ink,1);
  }
  if(kind===0&&y>550)for(let j=0;j<2;j++){
   const px=x+w*(j?.78:.25),py=y-h*.74;
   add(id+'-herb-tie-'+j,`M${px} ${py}v25`,'none',id,C.darkWood,1.2);
   add(id+'-herb-bundle-'+j,`M${px} ${py+25}q-15 5-12 28q7-7 12-3q8 5 13-2q2-19-13-23Z`,C.leaf,id,ink,1.3);
   add(id+'-herb-stems-'+j,`M${px} ${py+26}l-5 20m5-20 6 18`,'none',id,C.leafLight,1.3);
  }
  let grain='';for(let j=0;j<5;j++)grain+=`M${x+15+j*w*.19} ${y-h*.25}q-2 5 0 15`;
  add(id+'-counter-grain',grain,'none',id,C.darkWood,1.4);
  supports[id]={x:x+w*.5,y:y-h*.3,width:w*.8};
 }
 if(!room){
  group('forest-backdrop');
  if(town){
   add('far-hills','M-20 288Q30 243 62 188Q109 245 177 270Q239 249 293 148Q318 210 369 245Q452 267 523 201Q564 250 637 280Q708 266 756 199Q795 263 856 297Q922 316 987 206Q1030 291 1054 304Q1163 324 1220 157Q1250 244 1304 284V450H-20Z','#99a9a1','forest-backdrop',ink,1.9);
   add('middle-hills','M-20 405Q43 364 73 304Q107 366 128 391Q180 358 210 255Q222 329 271 384Q312 377 348 352Q395 390 453 361Q515 334 554 296Q599 353 647 361Q704 329 721 275Q752 313 783 343Q833 376 878 331Q899 309 910 278Q933 336 975 378Q1103 411 1168 318Q1192 368 1260 389L1304 450H-20Z','#9bad97','forest-backdrop',ink,1.7);
  }else shape('far-hills',[[-20,207],[80,111],[176,184],[284,80],[387,169],[511,126],[613,183],[739,84],[855,159],[963,114],[1071,187],[1175,91],[1310,191],[1310,450],[-20,450]],'#96a99f','forest-backdrop',2,.12);
  let facets=town?'M293 153Q299 208 292 264L315 241Q310 211 300 177Z M523 205L486 273L514 255Q522 234 527 210Z M1220 163Q1214 221 1202 271L1230 253Q1231 208 1220 163Z':'';
  if(!town)for(let j=0;j<6;j++)facets+=`M${80+j*215} 113l-28 102 82-22Z`;
  add('mountain-facets',facets,'#8c9e96','forest-backdrop');
  const bushes:P[]=[[-30,390],[-30,254]];
  for(let j=0;j<29;j++)bushes.push([j*48-16,219-(j%3)*17],[j*48+9,191-(j%4)*12],[j*48+30,224-(j%3)*13]);
  bushes.push([1310,395]);
  if(town){
   let firs='';for(const [px,py,ph] of [[233,405,45],[304,400,35],[365,404,46],[431,411,48],[535,404,52],[596,404,35],[598,315,29],[637,306,26],[683,403,41],[796,402,40],[817,310,30],[846,405,51],[1210,399,34],[1244,402,38]] as const){
    const w=ph*.45;firs+=`M${px} ${py-ph}l${w*.45} ${ph*.36}h${-w*.18}l${w*.5} ${ph*.36}h${-w*.26}l${w*.5} ${ph*.28}h${-w*2}l${w*.5} ${-ph*.28}h${-w*.26}l${w*.5} ${-ph*.36}h${-w*.18}Z`;
   }add('village-conifers',firs,'#728970','forest-backdrop','#445440',1.1);
  }else shape('near-woodland',bushes,C.leaf,'forest-backdrop',2.7,.14);
  if(o.atmosphere!=='clear')group('distant-haze',{x:0,y:200,width:1280,height:290},{atmosphere:{kind:'fog',density:o.atmosphere==='fog'?.7:.3,seed:o.seed+1,speed:.5}});
  group('terrain');
  const groundEdge:P[]=o.place==='market'?[[-20,361],[250,348],[490,368],[750,349],[1040,369],[1310,352]]:[[-20,414],[250,402],[490,415],[750,409],[1040,405],[1310,417]];
  shape('village-ground',[...groundEdge,[1310,770],[-20,770]],groundColour,'terrain',0);
  shape('lane',o.place==='market'?[[616,354],[696,351],[752,417],[794,510],[860,619],[978,760],[364,760],[452,601],[544,485],[575,406]]:
   [[-30,724],[170,650],[367,624],[519,602],[635,568],[672,570],[557,623],[352,662],[247,688],[172,724]],o.place==='market'?C.earth:'#d2bf95','terrain',o.place==='market'?0:2,.1);
  if(o.place!=='market')for(const n of nodes)if(n.id.startsWith('scenery-lane'))n.x=layoutShift;
  // Transform the whole assembly at its existing paint depth. Reparenting
  // selected houses into a late group used to paint them over the nearer gate.
  group('built-layout',undefined,{x:layoutShift});
  group('village',{x:0,y:240,width:1280,height:480},{parent:'built-layout'});
  group('market',{x:0,y:290,width:1280,height:420},{parent:'village'});
  for(const layer of ['architecture-back','architecture-middle','architecture-front','architecture-props'])group(layer,undefined,{parent:'market'});
  let villageBend=0;
  if(o.place==='market'){
   // Behind the gate and counters only the roof silhouettes are visible.
   // Exposed wall fragments here read as floating panels below the sign.
   roof('house-rear-left-roof',540,235,116,44,'architecture-back',true);
   roof('house-rear-right-roof',793,236,109,43,'architecture-back',true);
   house('house-far',384,346,198,191);house('house-middle',864,357,139,147,true);
   house('house-left',46,372,243,205,true);house('house-right',1009,383,230,212);
  }else{
   // Seed chooses bounded lots and roof tones, not unrelated random coordinates.
   const lots=sceneryRandom(o.seed+':lots'),bend=(lots()-.5)*70;
   villageBend=bend;
   for(const [j,px,py,pw] of [[0,169,375,52],[1,249,387,50],[2,675,378,39],[3,744,388,44],[4,1032,374,58],[5,1130,384,48]] as const)
    house('house-distant-'+j,px+bend*.35,py, pw+lots()*6,pw*.8,true);
   house('house-back-left',38+bend,464,68,64,true);house('house-back-middle',307+bend,480,100,86,true);house('house-back-right',775+bend,507,111,95,true);
   house('house-far',458+bend,527,131+lots()*5,110,true);
   house('house-left',111+bend,508,123+lots()*5,103,true);
   house('house-right',1054+bend,535,127+lots()*5,111,true);
   house('house-side',563+bend,467,87,73,true);
   house('house-near-left',279+bend,574,93,78,true);house('house-near-middle',666+bend,574,112,90,true);house('house-near-right',848+bend,589,109,87,true);
  }
  group('trees',undefined,{parent:town?'architecture-middle':world});
  stem('tree-left',town?-14:-9,town?460:437,town?150:371);stem('tree-right',town?1295:1273,town?458:486,town?145:454);
  if(o.place!=='market'){
   stem('village-tree-left',412,501,248);stem('village-tree-center',727,467,211);stem('village-tree-right',990,506,258);
   const fragment=(id:string,part:'fence'|'jar'|'bamboo',x:number,y:number,s:number,origin:P,parent:string)=>{
    group(id,undefined,{parent,x:x-origin[0]*s,y:y-origin[1]*s,scaleX:s,scaleY:s});
    for(const [i,n] of courtyardArt.parts[part].entries())nodes.push({...n,id:`scenery-${id}-${i}`,type:'path',parent:id});
   };
   group('village-fence',undefined,{parent:'architecture-front'});
   let pickets='';for(let j=0;j<9;j++){const x=1177+j*13;pickets+=`M${x} 561v-40l4-5 5 5v40Z`;}
   add('fence-pickets',pickets,'#b7a16c','village-fence',ink,1.3);
   add('fence-rails','M1176 534H1295M1176 551H1295','none','village-fence','#6b593b',2.4);
   fragment('village-jar-left','jar',241+villageBend,520,.34,[820,635],'architecture-props');
   fragment('village-jar-right','jar',1182+villageBend,543,.32,[820,635],'architecture-props');
   fragment('village-bamboo','bamboo',640,568,.46,[807,744],'architecture-front');
   // Ground and planting are arranged around lots and the lane. Central acting
   // space remains open rather than filling it with random decoration.
   add('field-terraces-fill','M900 503Q1070 512 1280 501V591Q1075 582 900 590Z','#8fa675','terrain');
   add('field-terraces','M900 518Q1046 524 1270 514M908 548Q1068 548 1270 543M912 578Q1073 577 1270 573','none','terrain','#425f43',1.4);
   add('house-paths',`M${523+villageBend} 527Q540 551 570 586M${1010+villageBend} 620Q982 636 949 649`,'none','terrain','#bdac7c',7);
   for(const [j,bx,by,s] of [[0,114,526,1.45],[1,370,545,.66],[2,908,589,1.18],[3,1174,489,1.24],[4,753,574,.65]] as const){
    group('bamboo-clump-'+j,undefined,{parent:'architecture-front',x:bx,y:by,scaleX:s,scaleY:s});
    add('clump-canes-'+j,'M-8 0Q-11-75-18-165L-11-165Q-4-73-2 0Z M5 0Q14-91 23-182L30-180Q19-83 12 0Z','#a0a065','bamboo-clump-'+j,ink,1.8);
    let fronds='',veins='';for(const [tx,ty,sign] of [[-14,-158,-1],[26,-174,1],[-9,-105,1],[17,-102,-1]] as const){
     fronds+=`M${tx} ${ty}q${sign*37} -36 ${sign*70} -8q${-sign*38} -5 ${-sign*70} 8Z`;
     for(let k=1;k<5;k++){const px=tx+sign*k*13,py=ty-20+Math.abs(k-2)*4;fronds+=`M${px} ${py}q${sign*7} 9 ${sign*12} 22q${-sign*11} -5 ${-sign*12} -22Z`;veins+=`M${px} ${py}l${sign*12} 22`;}
    }
    add('clump-fronds-'+j,fronds,'#6b824f','bamboo-clump-'+j,C.leafDark,1.1);
    add('clump-veins-'+j,veins,'none','bamboo-clump-'+j,C.leafDark,.8);
   }
   for(const [j,x,y] of [[0,110,503],[1,858,452],[2,1190,532]] as const){
    add('garden-'+j,`M${x-40} ${y}C${x-50} ${y-15} ${x-43} ${y-31} ${x-28} ${y-28}C${x-25} ${y-50} ${x+1} ${y-51} ${x+10} ${y-29}C${x+31} ${y-47} ${x+50} ${y-18} ${x+42} ${y}Z`,C.leaf,'architecture-props',ink,2.5);
    add('garden-leaf-'+j,`M${x-17} ${y-12}q7-9 14-2M${x+8} ${y-22}q8-7 15 1`,'none','architecture-props',C.leafDark,1.6);
   }
   add('near-shrub-left','M-30 677V423Q-3 402 17 414Q29 410 42 424Q64 419 79 448Q92 461 89 483Q106 500 96 526Q105 551 93 573Q104 596 98 619Q112 647 102 675Z',C.leafDark,'architecture-props',ink,2.4);
   add('near-shrub-right','M1145 696Q1150 609 1164 554Q1175 484 1196 444Q1208 417 1222 420Q1235 401 1250 414Q1265 412 1310 437V697Z',C.leaf,'architecture-props',ink,2.4);
   add('near-shrub-leaves','M16 579q7-12 18-4m33 8q8-10 16 1M57 637q7-12 17-4M1232 600q8-12 18-3m-35 39q7-12 16-2','none','architecture-props','#2e4935',1.7);
   group('village-gate',{x:100,y:510,width:220,height:200},{parent:'architecture-props',groundAnchor:{x:210,y:707},groundOffsetY:87});
   buildingFace('village-gate-left',[[127,546],[149,548],[150,706],[133,707]],'#937342','village-gate',2.7);
   buildingFace('village-gate-right',[[268,548],[286,548],[283,706],[267,706]],'#97794a','village-gate',2.7);
   add('village-gate-roof','M102 528Q149 512 207 513Q268 513 318 530L303 534Q209 521 114 534Z','#c5a56a','village-gate',ink,2.3);
   buildingFace('village-gate-beam',[[113,534],[305,534],[304,551],[114,550]],'#b19865','village-gate',2.3);
   buildingFace('village-gate-sign',[[172,563],[247,564],[247,593],[172,592]],'#3b3725','village-gate',1.6);
   add('village-gate-carving','M186 577h17m-10-7v18M219 573l11 11m0-9-11 10','none','village-gate','#c5a34d',2.1);
  }
  if(o.place==='market'){
   // A market is a layered courtyard around an open acting space, not three
   // miniature identical huts along a horizon. Rear roofs overlap; nearer
   // stalls enter the frame and carry different trades/materials.
   stall('stall-back-left',-23,455,342,204);
   stall('stall-back',330,440,212,172,1);
   stall('stall-back-right',991,449,303,195);
   group('market-gate',{x:577,y:135,width:396,height:253},{parent:'architecture-middle'});
   shape('gate-posts',[[598,382],[599,224],[614,224],[614,382],[598,382]],C.darkWood,'market-gate',2.6,.025);
   shape('gate-post-right',[[921,382],[920,223],[937,223],[936,382]],C.darkWood,'market-gate',2.6,.025);
   shape('gate-sign',[[636,241],[896,241],[896,306],[636,307]],'#594632','market-gate',3,.035);
   shape('gate-sign-inset',[[646,250],[887,250],[887,295],[646,296]],'#786039','market-gate',1.8,.025);
   // Nonverbal carved motif; never fabricate illegible narrative text.
   add('gate-sign-carving','M760 283Q749 269 760 254Q771 269 760 283ZM760 283Q737 281 734 265Q752 263 760 283ZM760 283Q783 281 786 265Q768 263 760 283ZM744 289Q760 296 776 289M680 278Q705 261 724 277M800 277Q821 261 846 278','none','market-gate','#c8a653',2.5);
   roof('gate-roof',583,137,370,97,'market-gate',false);
   stall('stall-left',-68,649,352,223);
   stall('stall-right',1032,641,278,280,2);
   // Suspended lantern line ties the two sides together without blocking the
   // central ground where small actors travel.
   group('market-lanterns',undefined,{parent:'architecture-middle'});
   line('lantern-cord',[[284,351],[500,373],[735,379],[1002,353]],C.darkWood,2,'market-lanterns');
   for(const [j,x,y] of [[0,338,359],[1,511,373],[2,686,378],[3,862,367],[4,989,354]] as const){
    shape('lantern-'+j,[[x-13,y+2],[x+12,y+2],[x+18,y+15],[x+13,y+37],[x-12,y+37],[x-18,y+19]],'#a74934','market-lanterns',2.3,.13);
    add('lantern-ribs-'+j,`M${x-6} ${y+3}q-5 17 0 32M${x+6} ${y+3}q5 17 0 32M${x-9} ${y+39}h18M${x} ${y+40}v14`,'none','market-lanterns','#62402b',1.7);
   }
   basket('basket-front',425,685,68,'architecture-props',true);basket('basket-near',549,681,61,'architecture-props',true);
   line('carrying-yoke',[[407,605],[480,601],[563,600]],C.darkWood,4,'architecture-props');
   add('basket-ropes','M393 658L407 605L459 660M520 657L555 601L580 658','none','architecture-props',ink,2);
   group('flower-pot',undefined,{parent:'architecture-props'});
   shape('flower-pot',[[871,641],[945,643],[933,709],[884,707]],'#397b7d','flower-pot',3.3,.04);
   shape('flower-pot-rim',[[865,636],[948,638],[948,649],[866,647]],'#508c8b','flower-pot',2.6,.025);
   const branches=[[905,639,894,563,830,503],[905,639,935,562,927,476],[899,607,855,568,790,555],[917,583,965,563,1013,519]];
   add('flower-branches',branches.map(([x,y,cx,cy,tx,ty])=>`M${x} ${y}Q${cx} ${cy} ${tx} ${ty}`).join(''),'none','flower-pot',C.darkWood,4);
   const floral=sceneryRandom(o.seed+':flowers'),f=(v:number)=>Number(v.toFixed(1));
   let petals='',twigs='';for(let j=0;j<34;j++){
    const [sx,sy,cx,cy,tx,ty]=branches[j%4]!,t=.43+floral()*.57,u=1-t;
    const bx=u*u*sx!+2*u*t*cx!+t*t*tx!,by=u*u*sy!+2*u*t*cy!+t*t*ty!;
    const x=f(bx+(j%2?1:-1)*(5+floral()*9)),y=f(by-4-floral()*8);
    twigs+=`M${f(bx)} ${f(by)}Q${x} ${f(by-3)} ${x} ${y}`;
    petals+=`M${x} ${y-3}q-2-6-6-3q-5 0-3 5q-5 4 1 6q2 6 6 2q6 0 5-5q4-5-2-6q0-4-1 1Z`;
   }
   add('flower-twigs',twigs,'none','flower-pot',C.darkWood,1.6);
   add('flower-petals',petals,'#d7af3f','flower-pot','#76542c',1.15);
   // Slender bamboo poles and sparse leaves break the repetitive roof line.
   group('market-bamboo',undefined,{parent:'village'});
   for(const [j,x] of [[0,354],[1,984]] as const){
    shape('bamboo-pole-'+j,[[x-4,354],[x-6,-25],[x+2,-25],[x+3,354]],'#a18b56','market-bamboo',2.4,.02);
    let joints='';for(let k=0;k<9;k++)joints+=`M${x-6} ${k*43}h9`;
    add('bamboo-joints-'+j,joints,'none','market-bamboo',ink,1.6);
    add('bamboo-leaves-'+j,`M${x} 55q-48-44-78-12q49-5 78 12q31-53 69-36q-41 9-69 36q-7-45-36-52q6 39 36 52Z`,C.leafLight,'market-bamboo',ink,2);
   }
  }else{
   // Native well is a useful story object with its real base/contact metadata.
   group('well',{x:820,y:491,width:136,height:75},{parent:'architecture-front',x:1010-888*.6,y:625-566*.6,scaleX:.6,scaleY:.6,groundAnchor:{x:888,y:566},groundOffsetY:5});
   add('well-wall','M826 509L826 552Q888 579 950 552L950 509Z','#91816a','well',ink,3);
   shape('well-rim',[[820,506],[956,506],[956,514],[820,514]],'#b39d7b','well',3,0);
   shape('well-hole',[[838,507],[938,507],[938,509],[838,509]],C.inside,'well',1,0);
   add('well-stones','M827 536q61 24 122 0M855 527v17M903 528v19M878 548v17M931 545v15','none','well','#645940',1.6);
  }
  let marks='';for(let j=0;j<32;j++){const x=Math.round(R()*1280),y=Math.round(492+R()*218);marks+=`M${x} ${y}q8-3 16 0`;}add('soil-marks',marks,'none','terrain','#90734f',1.8);
  if(night)nodes.push({id:'moon',type:'ellipse',parent:world,x:380,y:176,rx:20,ry:20,fill:'#f2e4bf',light:{kind:'moon',radius:59}});
 }else{
  group('walls',{x:0,y:0,width:1280,height:550});
  shape('room-wall',[[-30,-25],[1305,-25],[1305,480],[-30,477]],'#99734e','walls',0);
  for(let j=0;j<24;j++){
   const x=-16+j*57+(R()-.5)*9;
   if(j%3===0)shape('plank-tone-'+j,[[x,-20],[x+51,-20],[x+53,478],[x+2,477]],j%2?'#a27c51':'#8f6949','walls',0,.02);
   line('wall-plank-'+j,[[x,-20],[x-2,183],[x+3,320],[x,477]],C.darkWood,1.8,'walls');
  }
  let woodGrain='';for(let j=0;j<42;j++){
   const x=12+R()*1260,y=R()*420;
   woodGrain+=`M${x} ${y}q-3 16 -1 32q2 14 0 27`;
   if(j%6===0)woodGrain+=`M${x+5} ${y+18}q-6 12 0 18q6-8 0-18Z`;
  }
  add('wood-grain',woodGrain,'none','walls','#755334',1.1);
  shape('wall-top-beam',[[-20,15],[1298,22],[1298,49],[-20,41]],'#59402c','walls',3.3,.025);
  shape('wall-bottom-beam',[[-20,455],[1298,460],[1298,480],[-20,477]],C.darkWood,'walls',3.3,.025);
  for(const [j,x] of [[0,29],[1,956]] as const){
   shape('house-post-'+j,[[x-17,-30],[x+15,-30],[x+12,478],[x-20,480]],'#6f4d33','walls',3.4,.025);
   line('post-grain-'+j,[[x-4,57],[x-6,191],[x-3,402]],'#473523',1.4,'walls');
  }
  group('terrain');
  shape('room-floor',[[-30,478],[1306,480],[1306,770],[-30,770]],'#a58f6b','terrain',2.7,.025);
  // Worn earthen floor, as in the reference; no ruler-straight perspective grid.
  let wear='';for(let j=0;j<44;j++){
   const x=R()*1280,y=492+R()*225;
   wear+=j%3===0?`M${x} ${y}l-1 7m5-9l1 7`:`M${x} ${y}q6-2 11 0`;
  }
  add('floor-wear',wear,'none','terrain','#756344',1.6);
  group('window',{x:150,y:146,width:205,height:200});
  shape('window-frame',[[148,147],[355,150],[357,344],[151,346]],C.darkWood,'window',3.8,.035);
  shape('window-glass',[[162,163],[339,164],[339,329],[165,330]],night?'#3e5359':'#9eb9b0','window',2.3,.025);
  shape('window-sill',[[145,331],[355,330],[363,344],[143,346]],'#70502f','window',2.8,.025);
  let slats='';for(let j=0;j<6;j++)slats+=`M${174+j*29} 164q-2 75 0 165`;
  add('window-slats',slats,'none','window','#56422d',6);
  shape('window-shutter',[[141,146],[111,161],[116,341],[149,345]],C.roof,'window',3,.04);
  group('door',{x:1006,y:130,width:262,height:350},{groundAnchor:{x:1120,y:478},groundOffsetY:-142});
  shape('door-frame',[[1006,131],[1267,134],[1268,478],[1008,478]],'#523b2b','door',3.5,.025);
  shape('door-opening',[[1020,147],[1252,150],[1252,466],[1022,465]],C.inside,'door',2.2,.02);
  shape('door-leaf',[[1185,151],[1252,150],[1252,465],[1178,466]],'#7f5a3b','door',2.5,.025);
  add('door-planks','M1205 153q-4 146-3 311M1231 152q2 137-2 312','none','door','#533d2a',1.5);
  shape('door-threshold',[[1003,467],[1276,466],[1281,480],[1000,482]],'#b19a74','door',2.6,.02);
  group('mat',{x:105,y:608,width:355,height:12},{groundAnchor:{x:282,y:620}});
  shape('woven-mat',[[105,608],[460,608],[460,620],[105,620]],'#a88a57','mat',3,0);
  for(let j=0;j<8;j++)line('mat-weave-'+j,[[126+j*43,609],[126+j*43,618]],'#7c663f',1.3,'mat');
  group('table',{x:525,y:448,width:358,height:172},{groundAnchor:{x:705,y:620}});
  for(const [j,x] of [[0,558],[1,826]] as const)shape('table-leg-'+j,[[x-7,458],[x+6,458],[x+1,620],[x-12,620]],C.darkWood,'table',3,.04);
  shape('table-front',[[528,451],[880,451],[880,464],[528,464]],C.darkWood,'table',3,0);
  shape('table-top',[[525,448],[883,448],[883,452],[525,452]],C.wood,'table',3.7,0);
  line('table-wood-grain',[[564,457],[673,457],[784,458],[850,457]],C.darkWood,1.6,'table');
  supports.table={x:704,y:448,width:277};
  group('kettle',{x:576,y:411,width:76,height:51},{y:13});
  shape('teapot-body',[[591,414],[591,400],[605,392],[630,395],[638,410],[632,434],[600,435]],'#a69c7b','kettle',2.6,.2);
  shape('teapot-spout',[[595,409],[579,402],[581,417],[597,427]],'#a69c7b','kettle',2,.1);
  line('teapot-handle',[[632,401],[648,403],[650,416],[638,426]],ink,3,'kettle');
  shape('teapot-lid',[[592,400],[602,393],[628,395],[637,402]],'#b8ad87','kettle',2,.12);
  group('cups',{x:653,y:419,width:70,height:27});
  for(let j=0;j<2;j++)shape('cup-'+j,[[654+j*36,426],[680+j*36,426],[677+j*36,448],[658+j*36,448]],C.cream,'cups',2,0);
  group('lamp',{x:759,y:350,width:49,height:99},{y:2});
  shape('lamp-foot',[[760,445],[771,434],[771,417],[789,417],[790,435],[804,446]],'#9f7645','lamp',2.6,.1);
  shape('lamp-oil',[[769,421],[766,403],[770,386],[791,386],[797,404],[790,422]],'#c5b07c','lamp',2.5,.18);
  shape('lamp-chimney',[[774,389],[773,363],[779,348],[785,349],[790,364],[787,389]],'#d7c796','lamp',2,.12);
  group('lamp-flame',{x:778,y:365,width:9,height:22},{parent:'lamp',pivotX:782,pivotY:385,pivotSpace:'local'});
  nodes.push({id:'scenery-lamp-source',type:'ellipse',parent:'lamp-flame',x:782,y:376,rx:4,ry:9,fill:'#fff4b0',light:{kind:'flame',radius:60}});
  group('shelf',{x:455,y:225,width:260,height:68});
  shape('shelf-board',[[454,275],[713,276],[711,288],[455,287]],C.wood,'shelf',2.7,.04);
  line('shelf-bracket-left',[[477,287],[494,310],[507,288]],C.darkWood,3,'shelf');line('shelf-bracket-right',[[659,288],[676,310],[689,288]],C.darkWood,3,'shelf');
  basket('shelf-basket',521,274,60,'shelf');
  // Household storage clusters at the walls, leaving readable acting space.
  group('storage',{x:893,y:460,width:120,height:200});
  const jar=(id:string,x:number,y:number,w:number,h:number)=>{
   shape(id,[[x-w*.28,y-h],[x+w*.26,y-h],[x+w*.31,y-h*.8],[x+w*.49,y-h*.59],[x+w*.48,y-h*.24],[x+w*.34,y],[x-w*.31,y],[x-w*.46,y-h*.21],[x-w*.47,y-h*.61],[x-w*.29,y-h*.81]],'#7b654b','storage',2.9,.13);
   line(id+'-rim',[[x-w*.27,y-h+3],[x,y-h+5],[x+w*.27,y-h+3]],'#493b29',3,'storage');
   line(id+'-belly',[[x-w*.36,y-h*.35],[x,y-h*.29],[x+w*.37,y-h*.36]],'#4c3b28',2,'storage');
  };
  jar('jar-back',926,579,69,87);jar('jar-front',974,637,81,99);
  group('firewood',{x:60,y:411,width:117,height:85});
  let logs='';for(let row=0;row<3;row++)for(let j=0;j<4-row;j++){
   const x=81+j*25+row*13,y=478-row*21;
   logs+=`M${x-10} ${y}a10 11 0 1 0 20 0a10 11 0 1 0-20 0Z`;
  }
  add('stacked-firewood',logs,'#a38256','firewood',C.darkWood,2);
 }
 if(room){
  const first=nodes.findIndex(n=>n.id==='table');
  nodes.splice(first,0,{id:'furniture-layout',type:'group',parent:world,x:layoutShift});
  for(const n of nodes)if(['table','kettle','cups','lamp'].includes(n.id))n.parent='furniture-layout';
 }
 if(!room){
  // Foreground material texture lives in two quiet edge clusters. This adds
  // hand-made detail without blocking the central acting lane or scattering
  // unrelated decoration across the set.
  group('foreground-material-detail',undefined,{parent:'terrain'});
  let soil='',pebbles='',tufts='';
  const detail=sceneryRandom(o.seed+':foreground-material');
  for(const [left,right] of [[20,300],[1010,1260]] as const)for(let j=0;j<13;j++){
   const x=left+detail()*(right-left),y=635+detail()*72,s=.65+detail()*.55;
   soil+=`M${x-10*s} ${y}q${10*s} ${-4*s} ${20*s} 0`;
   if(j%2===0)pebbles+=`M${x+7} ${y+7}q${5*s} ${-7*s} ${11*s} ${-2*s}q${-4*s} ${5*s} ${-11*s} 2Z`;
   if(j%3===0)tufts+=`M${x-3} ${y}l3 ${-13*s}l3 ${13*s}m-3-3l${-8*s} ${-8*s}m8 8l${8*s} ${-9*s}`;
  }
  add('foreground-soil-marks',soil,'none','foreground-material-detail',night?'#657064':'#8e7c58',1.25);
  add('foreground-pebbles',pebbles,night?'#6f7468':'#9b8b69','foreground-material-detail',ink,1.05);
  add('foreground-grass-tufts',tufts,'none','foreground-material-detail',night?'#526653':C.leafDark,1.35);
 }
 if(o.atmosphere!=='clear')group('ground-mist',{x:-50,y:430,width:1380,height:300},{atmosphere:{kind:'fog',density:o.atmosphere==='fog'?.85:.32,seed:o.seed,speed:.65}});
 if(o.smoke){
  if(room){
   group('cooking-smoke',{x:758,y:215,width:50,height:135},{parent:'furniture-layout',atmosphere:{kind:'smoke',density:.7,seed:o.seed,speed:.8}});
  }else{
   const sx=town?396:300,sy=town?560:505;
   group('cooking-fire',{x:sx-22,y:sy-18,width:44,height:24},{parent:'architecture-props',groundAnchor:{x:sx,y:sy},groundOffsetY:sy-620});
   add('hearth-logs',`M${sx-18} ${sy}l32-8m-30 0 30 8`,'none','cooking-fire',C.darkWood,5);
   nodes.push({id:'cooking-flame',type:'ellipse',parent:'cooking-fire',x:sx,y:sy-9,rx:4,ry:8,fill:'#f2bf64',light:{kind:'flame',radius:24}});
   group('cooking-smoke',{x:sx-45,y:sy-165,width:90,height:150},{parent:'cooking-fire',atmosphere:{kind:'smoke',density:.85,seed:o.seed,speed:.85}});
  }
 }
 if(night)applySceneryNightPalette(nodes);
 for(const [name,support] of Object.entries(supports))if(name!=='floor')support.x+=layoutShift;
 nodes.push({id:'person',type:'instance',parent:world,asset:'setting-person',x:room?350:505,y:495,width:80.36,height:125,groundAnchor:{x:90,y:280}},
  {id:SETTING_SCENERY_VERSION,type:'group',parent:world});
 return {assets:{'setting-person':{rig:'simple-puppet',finish:'handdrawn',hair:'short',outfit:'tunic'}},
  stage:{width:frame.width,height:frame.height,nodes,ground:{y:620,parent:world,targets:[{target:'person'}]},tracks:[]},supports};
}
