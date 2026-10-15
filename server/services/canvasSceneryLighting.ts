import type {VectorNode} from '../../shared/canvasVectorScene';

const hex=(paint:string|undefined)=>paint&&/^#[0-9a-f]{6}$/i.test(paint)?paint:undefined;

/** Bake a readable moonlit palette into native scenery paint. Emitters and
 * their descendants keep their warm colours so a night scene has real light
 * hierarchy instead of a uniformly grey or daylight-bright set. */
export function applySceneryNightPalette(nodes:VectorNode[],amount=.48){
 const tint=[11,18,36] as const,byId=new Map(nodes.map(node=>[node.id,node]));
 const luminousRoots=new Set(['sky-light','window-light','lamp-flame','cooking-flame','fireflies']);
 const isLuminous=(node:VectorNode)=>{
  let current:VectorNode|undefined=node;
  while(current){
   if(current.light||luminousRoots.has(current.id))return true;
   current=current.parent?byId.get(current.parent):undefined;
  }
  return false;
 };
 const shade=(paint:string|undefined)=>{
  const value=hex(paint);if(!value)return paint;
  const rgb=[1,3,5].map(offset=>parseInt(value.slice(offset,offset+2),16));
  // Preserve the approved strong ink instead of washing black outlines blue.
  if(Math.max(...rgb)<48)return paint;
  return '#'+rgb.map((channel,index)=>Math.round(channel*(1-amount)+tint[index]!*amount).toString(16).padStart(2,'0')).join('');
 };
 for(const node of nodes)if(!isLuminous(node)){
  if(node.fill)node.fill=shade(node.fill);
  if(node.stroke)node.stroke=shade(node.stroke);
 }
}
