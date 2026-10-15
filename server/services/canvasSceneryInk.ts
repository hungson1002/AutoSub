import type {VectorNode} from '../../shared/canvasVectorScene';

export type SceneryPoint=readonly [number,number];
const f=(v:number)=>Number(v.toFixed(1));
export function sceneryRandom(seed:number|string){
 let value=2166136261;
 for(const c of String(seed))value=Math.imul(value^c.charCodeAt(0),16777619)>>>0;
 return ()=>((value=(Math.imul(value,1664525)+1013904223)>>>0)/4294967296);
}
/** Shared stable pen for all newly composed nature objects. The authored
 * silhouette supplies the asymmetry; no frame noise, raster filter or AI ink. */
export function sceneryPen(nodes:VectorNode[],seed:number){
 const ink='#17120f';
 const add=(id:string,d:string,fill:string,parent:string,stroke='none',strokeWidth=0)=>{
  if(d.length>7800)throw new Error('Vector: scenery contour exceeds path budget: '+id);
  nodes.push({id:'scenery-'+id,type:'path',parent,d,fill,stroke,strokeWidth});
 };
 const curve=(points:readonly SceneryPoint[],closed=false,tension=.16)=>{
  if(points.length<2)throw new Error('Vector: scenery pen needs points');
  const samples:SceneryPoint[]=[points[0]!];
  let d=`M${f(points[0]![0])} ${f(points[0]![1])}`;
  const count=closed?points.length:points.length-1;
  for(let i=0;i<count;i++){
   const a=points[i]!,b=points[(i+1)%points.length]!,before=points[closed?(i-1+points.length)%points.length:Math.max(0,i-1)]!,after=points[closed?(i+2)%points.length:Math.min(points.length-1,i+2)]!;
   const c1:[number,number]=[a[0]+(b[0]-before[0])*tension,a[1]+(b[1]-before[1])*tension];
   const c2:[number,number]=[b[0]-(after[0]-a[0])*tension,b[1]-(after[1]-a[1])*tension];
   d+=`C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(b[0])} ${f(b[1])}`;
   const steps=Math.max(2,Math.ceil((Math.hypot(c1[0]-a[0],c1[1]-a[1])+Math.hypot(c2[0]-c1[0],c2[1]-c1[1])+Math.hypot(b[0]-c2[0],b[1]-c2[1]))/7));
   for(let k=1;k<=steps;k++){
    const t=k/steps,u=1-t;
    samples.push([u*u*u*a[0]+3*u*u*t*c1[0]+3*u*t*t*c2[0]+t*t*t*b[0],u*u*u*a[1]+3*u*u*t*c1[1]+3*u*t*t*c2[1]+t*t*t*b[1]]);
   }
  }
  return {d:d+(closed?'Z':''),samples};
 };
 const pressure=(id:string,points:readonly SceneryPoint[],width:number,colour:string,parent:string)=>{
  const phase=sceneryRandom(seed+':'+id)()*6.28,left:SceneryPoint[]=[],right:SceneryPoint[]=[];
  let distance=0;
  points.forEach((p,i)=>{
   const previous=points[Math.max(0,i-1)]!,next=points[Math.min(points.length-1,i+1)]!;
   if(i)distance+=Math.hypot(p[0]-previous[0],p[1]-previous[1]);
   const dx=next[0]-previous[0],dy=next[1]-previous[1],length=Math.hypot(dx,dy)||1;
   const w=width*.5*(1+.18*Math.sin(distance/29+phase)+.08*Math.sin(distance/10.7+phase*.3));
   const irregular=.6*Math.sin(distance/16.3+phase)+.22*Math.sin(distance/7.7+phase*.6);
   const cx=p[0]-dy/length*irregular,cy=p[1]+dx/length*irregular;
   left.push([cx-dy/length*w,cy+dx/length*w]);right.push([cx+dy/length*w,cy-dx/length*w]);
  });
  let compound='',chunk=0;
  for(let i=0;i<points.length-1;i+=30){
   const stop=Math.min(points.length,i+32),strip=[...left.slice(i,stop),...right.slice(i,stop).reverse()];
   const d='M'+strip.map(p=>`${f(p[0])} ${f(p[1])}`).join('L')+'Z';
   if(compound.length+d.length>7600){add(id+'-ink-'+chunk++,compound,colour,parent);compound='';}
   compound+=d;
  }
  if(compound)add(id+'-ink-'+chunk,compound,colour,parent);
 };
 const line=(id:string,points:readonly SceneryPoint[],colour=ink,width=2.5,parent='nature-world')=>{
  width*=1.12;
  const c=curve(points,false,.19);
  // Rounded base closes the joins; the filled ribbons carry pen pressure.
  add(id,c.d,'none',parent,colour,width*.72);pressure(id,c.samples,width,colour,parent);
 };
 const shape=(id:string,points:readonly SceneryPoint[],fill:string,parent='nature-world',width=3.3,tension=.13)=>{
  width*=1.12;
  const c=curve(points,true,tension);add(id,c.d,fill,parent,width?ink:'none',width*.7);
  if(width)pressure(id,c.samples,width,ink,parent);
 };
 return {ink,shape,line,add};
}
