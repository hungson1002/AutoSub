export type VectorAtmosphere={kind:'fog'|'smoke';density:number;seed:number;speed:number};
export type AtmosphereBounds={x:number;y:number;width:number;height:number};
export function normalizeVectorAtmosphere(raw:unknown):VectorAtmosphere{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Vector: invalid atmosphere');
 const a=raw as Record<string,unknown>;
 if(a.kind!=='fog'&&a.kind!=='smoke')throw new Error('Vector: atmosphere needs fog or smoke');
 const bounded=(key:string,fallback:number,min:number,max:number)=>{const v=a[key]??fallback;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error('Vector: invalid atmosphere '+key);return v;};
 const seed=bounded('seed',17,-99999,99999);if(!Number.isInteger(seed))throw new Error('Vector: atmosphere seed needs an integer');
 return {kind:a.kind,density:bounded('density',.35,0,1),seed,speed:bounded('speed',1,0,2)};
}
/** Pure frame evaluation: seeking backward or rendering out of order gives
 * the same clouds. No wall-clock time, CSS animation or mutable RNG state. */
export function vectorAtmospherePuffs(effect:VectorAtmosphere,b:AtmosphereBounds,timeMs:number){
 let value=(effect.seed^0x63d83595)>>>0;const random=()=>((value=(Math.imul(value,1664525)+1013904223)>>>0)/4294967296);
 const t=Math.max(0,timeMs)/1000*effect.speed;
 return Array.from({length:effect.kind==='fog'?11:8},(_,i)=>{
  const px=random(),py=random(),phase=random(),size=random();
  if(effect.kind==='smoke'){
   const age=(t/7+i/8+phase*.035)%1,envelope=Math.sin(age*Math.PI)**1.25;
   return {x:b.x+b.width*.5+Math.sin(age*5+phase*6.28)*b.width*age*.18,y:b.y+b.height*(1-age),rx:b.width*(.055+age*.22),ry:b.height*(.035+age*.09),opacity:effect.density*.25*envelope,rotation:Math.sin(age*4+phase*6.28)*20};
  }
  return {x:b.x+b.width*(px+Math.sin(t*.045+phase*6.28)*.12),y:b.y+b.height*(.2+py*.6+Math.sin(t*.055+phase*6.28)*.045),rx:b.width*(.12+size*.14),ry:b.height*(.055+py*.065),opacity:effect.density*(.2+size*.12),rotation:Math.sin(t*.025+phase*6.28)*7};
 });
}
