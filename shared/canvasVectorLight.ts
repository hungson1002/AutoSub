import type {VectorDrawing,VectorNode,CanvasVectorScene} from './canvasVectorScene';

/** Declarative emitters shared by Canvas preview and native SVG export. */
export type VectorLight={kind:'moon'|'flame';radius:number;color?:string;x?:number;y?:number;intensity?:number};

export function normalizeVectorLight(raw:unknown):VectorLight{
  if(!raw||typeof raw!=='object')throw new Error('Vector: invalid light');
  const v=raw as Record<string,unknown>;
  if(v.kind!=='moon'&&v.kind!=='flame')throw new Error('Vector: unknown light kind');
  const finite=(value:unknown,fallback:number,min:number,max:number)=>{
    if(value===undefined)return fallback;
    if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error('Vector: invalid light geometry');
    return value;
  };
  if(v.color!==undefined&&(typeof v.color!=='string'||!/^#[0-9a-f]{6}$/i.test(v.color)))throw new Error('Vector: invalid light color');
  return {kind:v.kind,radius:finite(v.radius,60,1,1000),color:v.color as string|undefined,
    x:finite(v.x,0,-10000,10000),y:finite(v.y,0,-10000,10000),intensity:finite(v.intensity,1,0,1)};
}

export function vectorLightState(light:VectorLight,timeMs:number){
  const t=Math.max(0,timeMs)/1000;
  const flutter=light.kind==='flame'?Math.sin(t*13.1)*.075+Math.sin(t*23.7+1)*.035:0;
  return {x:light.x??0,y:light.y??0,color:light.color||(light.kind==='moon'?'#fff3ce':'#ffb943'),
    sourceColor:light.kind==='moon'?(light.color||'#fff3ce'):'#fff4b0',scaleY:1+flutter,scaleX:1-flutter*.4,
    rings:[1,.76,.53].map((scale,i)=>({radius:light.radius*scale*(1+flutter*.18),opacity:(light.intensity??1)*[.045,.075,.13][i]!*(1+flutter*.3)}))};
}
/** Moonlit subjects retain readable midtones. Keep the authored night sky,
 * black contours, facial details and luminous colors unchanged. */
function isNightBrief(brief:string){
  const text=brief.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return /(?:horror|kinh di|\bnight\b|\bdem\b|am u)/.test(text);
}
function readableNightPaint(n:VectorNode,minimum:number){
  if(n.light||n.groundMark||/(?:^|[-_])(?:eyes?|pupil|nose|nostril|mouth|brow|hair|hole|void|gap|crack|dirt)(?:[-_]|$)/i.test(n.id)||!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(n.fill||''))return n;
  let color=n.fill!.slice(1);if(color.length===3)color=color.split('').map(c=>c+c).join('');
  const rgb=[0,2,4].map(i=>parseInt(color.slice(i,i+2),16));
  const luminance=rgb[0]!*.2126+rgb[1]!*.7152+rgb[2]!*.0722;
  if(luminance>=minimum||Math.max(...rgb)>160)return n;
  const lift=Math.ceil(minimum-luminance);
  return {...n,fill:'#'+rgb.map(c=>(c+lift).toString(16).padStart(2,'0')).join('')};
}
export function readableVectorNightAssets(assets:Record<string,VectorDrawing>,brief:string){
  if(!isNightBrief(brief))return assets;
  return Object.fromEntries(Object.entries(assets).map(([id,drawing])=>{
    const actor=drawing.nodes.some(n=>n.id==='head-group')&&drawing.nodes.some(n=>n.id==='body'||n.id==='torso');
    // Wet sole silhouettes are dark marks on a support, not illuminated solids.
    if(!actor&&drawing.nodes.some(n=>/(?:^|[-_])sole$/.test(n.id)))return [id,drawing];
    const minimum=actor?96:80;
    return [id,{...drawing,nodes:drawing.nodes.map(n=>readableNightPaint(n,minimum))}];
  }));
}

/** Grounded architecture needs the same visibility as reusable props. A
 * decorative black wash must not undo the readable foreground palette. */
export function readableVectorNightScene(drawing:CanvasVectorScene,brief:string):CanvasVectorScene{
  if(!isNightBrief(brief))return drawing;
  const supported=new Set(drawing.nodes.filter(n=>n.groundAnchor&&!n.groundMark).map(n=>n.id));
  const parents=new Map(drawing.nodes.map(n=>[n.id,n.parent]));
  return {...drawing,nodes:drawing.nodes.map((node,i)=>{
    if(i===drawing.nodes.length-1&&node.type==='rect'&&(node.x??0)<=0&&(node.y??0)<=0&&(node.width??0)>=drawing.width&&(node.height??0)>=drawing.height
      &&/^#(?:000|000000)$/i.test(node.fill||'')&&(node.opacity??1)>.12&&(node.opacity??1)<1&&!drawing.tracks.some(t=>t.target===node.id&&t.frames.some(f=>f.opacity!==undefined)))return {...node,opacity:.12};
    let owner:string|undefined=node.id;
    while(owner&&!supported.has(owner))owner=parents.get(owner);
    if(owner)return readableNightPaint(node,82);
    // The generated floor and distant scenery are not ground targets. Leaving
    // them near black flattened the whole set despite readable actors.
    if(/(?:^|[-_])(?:ground|floor|yard|path|wall|roof|house|mountain|hill|tree|foliage|fence)(?:[-_]|$)/i.test(node.id))return readableNightPaint(node,72);
    return node;
  })};
}

