import type {VectorAtmosphere as Atmosphere,AtmosphereBounds} from '../../shared/canvasVectorAtmosphere';
import {vectorAtmospherePuffs} from '../../shared/canvasVectorAtmosphere';
/** These filters belong only to atmosphere; scenery and people stay crisp. */
export function VectorAtmosphere({effect,bounds:b,timeMs,id}:{effect:Atmosphere;bounds:AtmosphereBounds;timeMs:number;id:string}){
 const fog=effect.kind==='fog',puffs=vectorAtmospherePuffs(effect,b,timeMs),colour=fog?'#dce4da':'#c9cfbf',t=Math.max(0,timeMs)/1000*effect.speed;
 return <g data-vector-atmosphere={effect.kind}>
  <defs>
   <radialGradient id={id+'-puff'}><stop offset="0" stopColor={colour} stopOpacity=".9"/><stop offset=".5" stopColor={colour} stopOpacity=".6"/><stop offset="1" stopColor={colour} stopOpacity="0"/></radialGradient>
   <linearGradient id={id+'-edge'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="white" stopOpacity="0"/><stop offset=".18" stopColor="white"/><stop offset=".78" stopColor="white"/><stop offset="1" stopColor="white" stopOpacity="0"/></linearGradient>
   <mask id={id+'-mask'} maskUnits="userSpaceOnUse" x={b.x} y={b.y} width={b.width} height={b.height}><rect {...b} fill={`url(#${id}-edge)`}/></mask>
   <filter id={id+'-soft'} filterUnits="userSpaceOnUse" x={b.x} y={b.y} width={b.width} height={b.height} colorInterpolationFilters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency={`${.012+Math.sin(t*.06)*.0005} .024`} numOctaves="2" seed={Math.abs(effect.seed)%997} result="cloudNoise"/>
    <feDisplacementMap in="SourceGraphic" in2="cloudNoise" scale={Math.min(38,b.height*.16)} xChannelSelector="R" yChannelSelector="G"/>
    <feGaussianBlur stdDeviation={Math.min(9,b.height*(fog?.025:.018))}/>
   </filter>
  </defs>
  <g mask={`url(#${id}-mask)`} filter={`url(#${id}-soft)`}>
   {puffs.map((p,i)=><ellipse key={i} cx={p.x} cy={p.y} rx={p.rx} ry={p.ry} fill={`url(#${id}-puff)`} opacity={p.opacity} transform={`rotate(${p.rotation} ${p.x} ${p.y})`}/>)}
  </g>
 </g>;
}
