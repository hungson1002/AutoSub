import art from '../assets/vector-styles/folk-horror/upright-courtyard/drawing.json';
import type {VectorNode} from '../../shared/canvasVectorScene';
import {APPROVED_FOLK_STYLE} from '../../shared/canvasVectorInk';

type Assets=Record<string,unknown>;
type PaintPart=keyof typeof art.parts;
type Box={x:number;y:number;width:number;height:number};
// The actual accepted wall grain, straw, ink ribbons and costume-like details
// are reusable paint, not instructions asking an AI to draw them again.
export const HOUSE_PAINT_HASH=art.sourceSha256;
function asset(parts:readonly PaintPart[],box:Box,light:string,tiled=false,lit=false){
 const tone=(colour:string)=>{
  if(lit&&colour==='#39291f')return '#d1ab57';
  if(tiled&&colour==='#c1933d')return light==='night'?'#8d4c36':'#aa4932';
  const night:Record<string,string>={'#a47849':'#927248','#c1933d':'#aa8641','#b58c59':'#a07b4d','#946928':'#75501f'};
  return light==='night'?night[colour]||colour:colour;
 };
 const nodes:VectorNode[]=[{id:APPROVED_FOLK_STYLE,type:'group'},{id:'paint-space',type:'group',x:-box.x,y:-box.y}];
 for(const part of parts)for(const n of art.parts[part])nodes.push({...n,type:'path',parent:'paint-space',fill:tone(n.fill)});
 if(tiled){
  for(let row=0;row<3;row++){
   const y=85+row*66,left=85-(y-30)*120/248+8,right=615+(y-30)*166/248-8;
   let d=`M${left} ${y}H${right}`;
   for(let x=left+17;x<right-10;x+=34)d+=`M${x} ${y}v14`;
   nodes.push({id:'tile-seams-'+row,type:'path',parent:'paint-space',d,fill:'none',stroke:'#6c3326',strokeWidth:1.7});
  }
 }
 return {width:box.width,height:box.height,nodes};
}
export function placePaintedHouse(nodes:VectorNode[],assets:Assets,p:{id:string;parent:string;x:number;y:number;width:number;height:number;light:string;tiled:boolean;lit:boolean}){
 const {id,parent,x,y,width:w,height:h,light,tiled,lit}=p,wallHeight=h*.57,wallTop=y-wallHeight;
 const body=`native-house-wall-${light}`,roof=`native-house-roof-${light}-${tiled?'tile':'straw'}`,door=`native-house-door-${light}-${lit?'lit':'dark'}`;
 assets[body]??=asset(['house'],{x:-24,y:278,width:796,height:267},light);
 assets[roof]??=asset(tiled?['roof']:['roof','straw'],{x:-35,y:19,width:816,height:292},light,tiled);
 assets[door]??=asset(['door-opening','door-leaf'],{x:95,y:326,width:164,height:195},light,false,lit);
 const ink='#17120f',wallFill=light==='night'?'#7f6443':'#a47849',windowFill=lit?'#e6bd62':light==='night'?'#49504a':'#706b55';
 const rect=(part:string,left:number,top:number,width:number,height:number,fill:string)=>({id:id+'-'+part,type:'path' as const,parent:id,d:`M${left} ${top}H${left+width}V${top+height}H${left}Z`,fill});
 const roofX=x-w*.09,roofW=w*1.18,roofTop=y-h,roofBottom=y-h*.535;
 const doorX=x+119*w/796,doorY=wallTop+48*wallHeight/267,doorW=164*w/796,doorH=195*wallHeight/267;
 const full=w>=300,compact=w>=135,beam=Math.max(2.2,Math.min(7,w*.009));
 nodes.push({id,type:'group',parent,bounds:{x:roofX,y:roofTop,width:roofW,height:h}},
  // A solid ink silhouette gives every architectural mass a closed contour.
  // It is deliberately made from straight M/L/H/V segments so corners remain
  // square even though the organic scenery pen has rounded joins.
  rect('wall-outline',x-beam,wallTop-beam,w+beam*2,wallHeight+beam*2,ink),
  {id:id+'-wall',type:'instance',parent:id,asset:body,x,y:wallTop,width:w,height:wallHeight},
  {id:id+'-roof-outline',type:'path',parent:id,d:`M${roofX-beam} ${roofBottom+beam}L${x+w*.17} ${roofTop-beam}H${x+w*.8}L${roofX+roofW+beam} ${roofBottom+beam}Z`,fill:ink},
  {id:id+'-roof',type:'instance',parent:id,asset:roof,x:roofX,y:roofTop,width:roofW,height:h*.43*292/259},
  rect('eave-beam',x-beam,wallTop-beam*.3,w+beam*2,beam*1.35,ink),
  rect('base-beam',x-beam,y-beam*1.2,w+beam*2,beam*1.2,ink),
  rect('corner-post-left',x,wallTop,beam,wallHeight,ink),
  rect('corner-post-right',x+w-beam,wallTop,beam,wallHeight,ink),
  rect('door-frame',doorX-beam,doorY-beam,doorW+beam*2,doorH+beam,ink),
  {id:id+'-door',type:'instance',parent:id,asset:door,x:doorX,y:doorY,width:doorW,height:doorH});
 if(compact){
  const middleY=wallTop+wallHeight*.48;
  nodes.push(rect('middle-beam',x+beam,middleY,w-beam*2,beam*.75,ink));
  let boards='';for(let j=1;j<10;j++){const px=x+w*j/10;boards+=`M${px} ${wallTop+beam*1.8}V${y-beam*1.5}`;}
  nodes.push({id:id+'-wall-board-seams',type:'path',parent:id,d:boards,fill:'none',stroke:light==='night'?'#4b3828':'#6d4c32',strokeWidth:Math.max(1,w*.0022)});
 }
 if(full){
  const windows=[x+w*.43,x+w*.69],wy=wallTop+wallHeight*.19,ww=w*.15,wh=wallHeight*.27;
  windows.forEach((wx,index)=>{
   nodes.push(rect(`window-${index}-outline`,wx-beam*.65,wy-beam*.65,ww+beam*1.3,wh+beam*1.3,ink),
    rect(`window-${index}-pane`,wx,wy,ww,wh,windowFill),
    rect(`window-${index}-mullion-v`,wx+ww*.47,wy,beam*.55,wh,ink),
    rect(`window-${index}-mullion-h`,wx,wy+wh*.47,ww,beam*.55,ink),
    rect(`window-${index}-sill`,wx-beam,wy+wh,ww+beam*2,beam*.75,ink));
  });
  const plaqueX=doorX+doorW*.16,plaqueY=doorY-beam*4,plaqueW=doorW*.68;
  nodes.push(rect('door-plaque-outline',plaqueX-beam*.45,plaqueY-beam*.45,plaqueW+beam*.9,beam*2.7,ink),
   rect('door-plaque',plaqueX,plaqueY,plaqueW,beam*1.8,'#a84732'),
   rect('door-paper-left',doorX-beam*1.6,doorY+doorH*.09,beam*1.1,doorH*.58,'#a84732'),
   rect('door-paper-right',doorX+doorW+beam*.5,doorY+doorH*.09,beam*1.1,doorH*.58,'#a84732'));
  let foundation='';for(let j=0;j<8;j++){const bx=x+w*(.05+j*.115),bw=w*.08,by=y-beam*3;foundation+=`M${bx} ${by}H${bx+bw}V${y-beam*1.25}H${bx}Z`;}
  nodes.push({id:id+'-foundation-blocks',type:'path',parent:id,d:foundation,fill:wallFill,stroke:ink,strokeWidth:Math.max(1.5,w*.0028)});
 }
}
export function placePaintedFlowers(nodes:VectorNode[],assets:Assets,id:string,parent:string,x:number,y:number,height:number){
 const key='native-house-flowering-planter';
 assets[key]??=asset(['tree','planter'],{x:320,y:275,width:270,height:315},'day');
 nodes.push({id,type:'instance',parent,asset:key,x:x-height*270/315/2,y:y-height,width:height*270/315,height});
}
