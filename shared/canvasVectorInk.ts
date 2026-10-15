import type {VectorDrawing,VectorNode} from './canvasVectorScene';

export const FOLK_INK_STYLE='folk-ink-v3-approved';
export const APPROVED_FOLK_STYLE='approved-folk-svg-v1';
export const FOLK_INK_RULES='folk-ink-v3-approved: use the tool-owned, user-approved SVG model sheet for ALL new people. Its round head, narrow clothed limbless body, thick variable ink contours, tiny centered pupils and deep flat palette are fixed by the renderer, not by the model. Select simple-puppet descriptors; do not redraw anatomy, invent raw-node replacement people, enlarge eyes or invent unbounded anatomy. Default male sheet: outfit:tunic,hair:short,headwear:headwrap,facialHair:stubble. Adult women use a separate reference SVG sheet: rounded pale face, lashed eyes, top bun, curved blouse and dark skirt; default gender:female,faceShape:round,outfit:tunic,hair:bun,headwear:none,facialHair:none. Do not reshape the male jaw into a woman or add a second side bun to that sheet. Choose faceShape:round/oval/broad and outfit:tunic/robe/ao-dai/vest/shawl/work-shirt/cross-collar/apron for genuinely different native jaws and garment construction, not just recolors. Assign distinct face/outfit combinations across the cast. Work-shirt is a short buttoned shirt with trousers, cross-collar is a wrapped short blouse over a dark skirt, apron has a bib and pocket; choose these by occupation instead of putting every villager in the same belted tunic. Choose eyeShape:round/half-lidded for round versus narrow white eyes, keeping pupils small and centered. Hair:tuft adds a small native crown tuft on a round bald head. Vary hair silhouette, headwear, eye shape and age across supporting villagers. Hair:fringe has a native cut fringe; female wavy/side-part/cropped use the female skull. Long braids have a readable woven tail. costumeDetail:plain/patch/roundel/piping/sash adds bounded embroidered edges/clasp, sewn patch, medallion or cross-body sash. Design the cast together: castRole:lead gets a signature garment detail and distinct hair/outfit; supports have varied silhouettes instead of recolors. Hair, age, gender and glasses remain bounded native variants. Keep the approved original round/tunic character available unchanged. Hands are hidden when unused; occupied hands are short concealed grip strokes, never automatic flesh-colored dots. New props must have recognizable outlined flat SVG silhouettes. Geometry stays stable across frames and shots; saved expanded assets stay unchanged.';
const swatches={skin:['#e7bfa3','#f2d8ce','#e5c29c','#c79b78','#ad7c59'],shirt:['#343d60','#654958','#36544a','#684a38','#853d36','#9d793f','#355879','#978a60','#654161'],
  hair:['#18171d','#3f332c','#68605a','#aaa294'],headwear:['#18171d','#3f332c','#343d60','#654161','#853d36','#9c783e'],accent:['#9c783e','#8e7051','#697c70','#a36c58'],inner:['#e1d1ac','#c6bba1'],trim:['#c7c0a3','#88724f'],skirt:['#25283d','#28272d','#655660','#46565b','#796653']} as const;
const rgb=(s:string)=>[1,3,5].map(i=>parseInt(s.slice(i,i+2),16));
export function folkInkPalette(raw:unknown,female=false){
  const supplied=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
  const result:Record<string,string>={ink:'#0e0c0b',skin:'#e7bfa3',shirt:'#343d60',hair:'#18171d',accent:'#9c783e',inner:'#e1d1ac',trim:'#c7c0a3',skirt:'#25283d'};
  if(female)Object.assign(result,{skin:'#f2d8ce',shirt:'#654958',skirt:'#28272d'});
  for(const [key,colors] of Object.entries(swatches)){
    const requested=supplied[key];
    if(requested===undefined)continue;
    if(typeof requested!=='string'||!/^#[0-9a-f]{6}$/i.test(requested))throw new Error('Vector: invalid folk-ink palette');
    // Unspecified skin inventions must not subtly recolor the approved face.
    // Deliberate native skin variants use an exact model-sheet swatch.
    if(key==='skin'){
      if(colors.some(c=>c===requested.toLowerCase()))result[key]=requested.toLowerCase();
      continue;
    }
    const target=rgb(requested),distance=(s:string)=>rgb(s).reduce((sum,v,i)=>sum+(v-target[i]!)**2,0);
    result[key]=colors.reduce((a,b)=>distance(a)<=distance(b)?a:b);
  }
  return result;
}
const hash=(s:string)=>[...s].reduce((h,c)=>Math.imul(h^c.charCodeAt(0),16777619)>>>0,2166136261);
const round=(v:number)=>Number(v.toFixed(3));
/** Only painted segments change. Endpoints, transforms, pivots, grips and
 * animation IDs stay exact. No frame-time randomness or SVG filter. */
export function handInkPath(source:string,seed:string){
  // Smooth commands depend on the previous control point; converting a line
  // before S/T would change that meaning. Leave those authored curves intact.
  if(/[st]/i.test(source.replace(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi,'')))return source;
  const tokens=source.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)||[];
  const out:string[]=[];let i=0,cmd='',x=0,y=0,mx=0,my=0,segment=0;
  const curve=(tx:number,ty:number)=>{
    const dx=tx-x,dy=ty-y,length=Math.hypot(dx,dy);
    if(length<.001){x=tx;y=ty;return;}
    const bend=(hash(seed+':'+segment++)%2?1:-1)*Math.min(1.25,length*.014);
    out.push(`Q ${round((x+tx)/2-dy/length*bend)} ${round((y+ty)/2+dx/length*bend)} ${round(tx)} ${round(ty)}`);x=tx;y=ty;
  };
  while(i<tokens.length){
    if(/^[a-z]$/i.test(tokens[i]!))cmd=tokens[i++]!;
    const upper=cmd.toUpperCase(),relative=cmd!==upper;
    if(upper==='Z'){if(Math.hypot(x-mx,y-my)>.001)curve(mx,my);out.push('Z');cmd='';continue;}
    const count=({M:2,L:2,H:1,V:1,Q:4,C:6,S:4,T:2,A:7} as Record<string,number>)[upper];
    if(!count||i+count>tokens.length||tokens.slice(i,i+count).some(t=>/^[a-z]$/i.test(t)))return source;
    const values=tokens.slice(i,i+count).map(Number);i+=count;
    if(!values.every(Number.isFinite))return source;
    if(upper==='L')curve(values[0]!+(relative?x:0),values[1]!+(relative?y:0));
    else if(upper==='H')curve(values[0]!+(relative?x:0),y);
    else if(upper==='V')curve(x,values[0]!+(relative?y:0));
    else{
      out.push(cmd+' '+values.join(' '));
      x=values.at(-2)!+(relative?x:0);y=values.at(-1)!+(relative?y:0);
      if(upper==='M'){mx=x;my=y;cmd=relative?'l':'L';}
    }
  }
  return out.join(' ');
}
export function handInkDrawing(drawing:VectorDrawing,mark=true,outline=false):VectorDrawing{
  // Approved contours are already filled, variable-width ink paths. Running
  // the generic line bender on them would redraw the accepted model sheet.
  if(drawing.nodes.some(n=>n.id===APPROVED_FOLK_STYLE))return {...drawing,nodes:drawing.nodes.map(n=>({...n}))};
  const nodes=drawing.nodes.map((source):VectorNode=>{
    const n={...source};
    for(const key of ['nodes','children']){
      const nested=(source as unknown as Record<string,unknown>)[key];
      if(Array.isArray(nested))(n as unknown as Record<string,unknown>)[key]=handInkDrawing({nodes:nested} as VectorDrawing,false,outline).nodes;
    }
    // Eyes/contact dots remain smooth; scenery and clothes carry the ink.
    if(/^(?:eye|hand-|blink|mouth|face)|(?:halo|glow|flame|shadow|shine|paint-sky|physical-ground)/.test(n.id))return n;
    if(outline&&n.type!=='group'&&n.type!=='instance'&&/^#[0-9a-f]{3,6}$/i.test(n.fill??'')&&(!n.stroke||n.stroke==='none')&&(n.opacity??1)>=.5){
      n.stroke='#292722';n.strokeWidth=2;
    }
    if(n.type==='rect'){
      const w=n.width??0,h=n.height??0,r=Math.min(n.rx??0,w/2,h/2);
      n.type='path';n.d=r>0?`M ${r} 0 L ${w-r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h-r} Q ${w} ${h} ${w-r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h-r} L 0 ${r} Q 0 0 ${r} 0 Z`:`M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
    }else if(n.type==='line'){
      n.type='path';n.d=`M 0 0 L ${n.x2??0} ${n.y2??0}`;delete n.x2;delete n.y2;
    }
    if(n.type==='path'&&n.d)n.d=handInkPath(n.d,n.id);
    return n;
  });
  if(mark&&!nodes.some(n=>n.id===FOLK_INK_STYLE))nodes.push({id:FOLK_INK_STYLE,type:'group',...(nodes.some(n=>n.id==='puppet-root')?{parent:'puppet-root'}:{})});
  return {...drawing,nodes};
}
