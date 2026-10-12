import type {VectorDrawing,VectorNode} from './canvasVectorScene';

/** Bounds of the actual simple SVG curves, rather than their control points.
 * Unsupported commands are left authored; do not guess contact geometry. */
export function vectorCurveBounds(d:string){
  const tokens=d.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)||[];
  let i=0,x=0,y=0,mx=0,my=0,cmd='',first=true;const points:Array<{x:number;y:number}>=[];
  while(i<tokens.length){
    if(/^[a-z]$/i.test(tokens[i]!))cmd=tokens[i++]!;
    const upper=cmd.toUpperCase(),count=({M:2,L:2,H:1,V:1,Q:4,C:6} as Record<string,number>)[upper];
    if(upper==='Z'){x=mx;y=my;cmd='';continue;}
    if(!count||i+count>tokens.length||tokens.slice(i,i+count).some(t=>/^[a-z]$/i.test(t)))return undefined;
    const values=tokens.slice(i,i+count).map(Number);i+=count;
    if(!values.every(Number.isFinite))return undefined;
    const relative=cmd!==upper,ox=x,oy=y;
    if(upper==='H')values.splice(0,1,values[0]!+(relative?x:0),y);
    else if(upper==='V')values.splice(0,1,x,values[0]!+(relative?y:0));
    else if(relative)for(let j=0;j<values.length;j++)values[j]!+=j%2?y:x;
    x=values.at(-2)!;y=values.at(-1)!;
    if(first&&upper!=='M')return undefined;first=false;
    if(upper==='C'||upper==='Q')for(let j=0;j<=64;j++){
      const t=j/64,u=1-t;
      points.push(upper==='C'?{x:u*u*u*ox+3*u*u*t*values[0]!+3*u*t*t*values[2]!+t*t*t*x,
        y:u*u*u*oy+3*u*u*t*values[1]!+3*u*t*t*values[3]!+t*t*t*y}:
        {x:u*u*ox+2*u*t*values[0]!+t*t*x,y:u*u*oy+2*u*t*values[1]!+t*t*y});
    }else points.push({x,y});
    if(upper==='M'){mx=x;my=y;cmd=relative?'l':'L';}
  }
  if(!points.length)return undefined;
  return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y)),topPoint:points.reduce((a,b)=>b.y<a.y?b:a)};
}

function visibleHandleGrip(asset:VectorDrawing,grip:{x:number;y:number}|undefined){
  // Hanging lamps have a curved top handle. A knife's rectangular grip is a
  // different contact and must retain its explicit authored point.
  if(!asset.nodes.some(n=>n.light?.kind==='flame'))return grip;
  const handles=asset.nodes.filter(n=>/(?:^|[-_])handle$/.test(n.id)&&n.type==='path'&&!n.parent&&!n.rotation&&(n.scaleX??1)===1&&(n.scaleY??1)===1);
  if(handles.length!==1)return grip;
  const handle=handles[0]!,b=vectorCurveBounds(handle.d!);if(!b)return grip;
  const actual={x:(handle.x??0)+b.topPoint.x,y:(handle.y??0)+b.topPoint.y};
  const tolerance=(handle.strokeWidth??2)/2+1;
  return !grip||Math.hypot(grip.x-actual.x,grip.y-actual.y)>tolerance?actual:grip;
}

/** Repair a misplaced emitter only when its point lies outside its own flame. */
export function alignVectorEmitters(drawing:VectorDrawing):VectorDrawing{
  return {...drawing,nodes:drawing.nodes.map(n=>{
    if(n.type!=='path'||n.light?.kind!=='flame')return n;
    const b=vectorCurveBounds(n.d!);if(!b)return n;
    const x=n.light.x??0,y=n.light.y??0;
    if(x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom)return n;
    return {...n,light:{...n.light,x:(b.left+b.right)/2,y:(b.top+b.bottom)/2}};
  })};
}

export const vectorIsReleaseAction=(cue:string)=>/(?:nhả|buông|thả|rơi|lăn|\bdrop\b|\brelease\b|\broll\b)/iu.test(cue);

/** Lighting changes the emitter inside a prop, not the visibility of its case. */
export function vectorLightActionTargets(asset:VectorDrawing|undefined,target:string,cue:string){
  if(target.includes('/')||!/(?:bùng sáng|bật.{0,12}đèn|tắt|thắp|châm lửa|dập lửa|ignite|extinguish|light the|turn.{0,12}(?:on|off))/iu.test(cue))return [];
  return asset?.nodes.filter(n=>n.light).map(n=>target+'/'+n.id)||[];
}

/** Saved expanded props may predate explicit grip metadata. */
export function vectorPropGrip(asset:VectorDrawing|undefined,instance?:VectorNode){
  if(!asset)return undefined;
  // A compiled carry already stores its exact authored grip as the local
  // instance pivot. Keep that per-instance grip through later framing cuts,
  // including custom props whose reusable artwork has no default grip.
  if(instance?.attachTo&&instance.pivotSpace==='local'&&instance.pivotX!==undefined&&instance.pivotY!==undefined)
    return visibleHandleGrip(asset,{x:instance.pivotX*asset.width/(instance.width??asset.width),y:instance.pivotY*asset.height/(instance.height??asset.height)});
  if(asset.grip)return visibleHandleGrip(asset,asset.grip);
  const handle=asset.nodes.find(n=>n.id==='handle'&&n.type==='rect'&&!n.parent);
  if(handle?.width&&handle.height)return {x:(handle.x||0)+handle.width/2,y:(handle.y||0)+handle.height/2};
  if(asset.width===60&&asset.height===100&&['handle','case','flame'].every(id=>asset.nodes.some(n=>n.id===id)))return {x:30,y:6};
  return visibleHandleGrip(asset,undefined);
}

/** A village cutout holds a hanging light by its upper handle near the
 * shoulder, so the flame lights the chest rather than dangling at the hem.
 * Other props and explicitly posed hands keep their own contact geometry. */
export function vectorRaisedLampHand(drawing:VectorDrawing,assets:Record<string,VectorDrawing>,actor:string,arm:string){
  const owner=drawing.nodes.find(n=>n.id===actor&&n.type==='instance'),rig=assets[owner?.asset||''];
  if(!rig?.nodes.some(n=>n.id==='village-cast-v1'))return undefined;
  const lamp=drawing.nodes.find(n=>n.attachTo===`${actor}/hand-${arm}`&&n.hang&&assets[n.asset||'']?.nodes.some(p=>p.light?.kind==='flame'));
  const hand=rig.nodes.find(n=>n.id===`hand-${arm}`);
  return lamp&&hand?{dx:arm==='r'?28:-28,dy:134-(hand.y??0)}:undefined;
}

/** Attach the object's own grip to the actual hand, not its bounding box or
 * the elbow. Compiles to ordinary transforms used by both preview and export. */
export function vectorCarryDrawing(drawing:VectorDrawing,assets:Record<string,VectorDrawing>,raw:unknown):VectorDrawing{
  if(raw===undefined)return drawing;
  if(!Array.isArray(raw)||raw.length>16)throw new Error('Vector: invalid carries');
  const nodes=drawing.nodes.map(n=>({...n})),props=new Set<string>(),hands=new Set<string>();
  for(const entry of raw){
    if(!entry||typeof entry!=='object')throw new Error('Vector: invalid carry');
    const c=entry as Record<string,unknown>,actor=nodes.find(n=>n.id===c.actor&&n.type==='instance');
    const prop=nodes.find(n=>n.id===c.prop),rig=assets[actor?.asset||''];
    const hand=`hand-${c.arm}`;
    if(!actor||!rig||!['l','r'].includes(String(c.arm))||!rig.nodes.some(n=>n.id===hand)
      ||!prop||prop.id===actor.id||prop.type!=='instance')throw new Error('Vector: carry needs an actor hand and an existing prop instance');
    if(props.has(prop.id)||hands.has(actor.id+'/'+hand))throw new Error('Vector: one carried prop per hand');
    const asset=assets[prop.asset!];
    let grip=(c.grip??vectorPropGrip(asset,prop)) as {x?:unknown;y?:unknown}|undefined;
    if(!asset||!grip||typeof grip.x!=='number'||typeof grip.y!=='number'||!Number.isFinite(grip.x)||!Number.isFinite(grip.y)
      ||grip.x<0||grip.x>asset.width||grip.y<0||grip.y>asset.height)throw new Error('Vector: carry grip must be a point inside the prop asset');
    grip=visibleHandleGrip(asset,grip as {x:number;y:number})!;
    if(c.hang!==undefined&&typeof c.hang!=='boolean')throw new Error('Vector: invalid carry hang');
    const px=(grip.x as number)*(prop.width??asset.width)/asset.width,py=(grip.y as number)*(prop.height??asset.height)/asset.height;
    delete prop.parent;
    delete prop.groundAnchor;
    prop.attachTo=actor.id+'/'+hand;prop.x=-px;prop.y=-py;
    prop.pivotX=px;prop.pivotY=py;prop.pivotSpace='local';
    prop.hang=c.hang===true;
    props.add(prop.id);hands.add(prop.attachTo);
  }
  return {...drawing,nodes};
}

/** Reusable objects, independent of story/location. Emitters never own casing. */
export function vectorLantern():VectorDrawing{
  return {width:60,height:100,grip:{x:30,y:6},nodes:[
    {id:'handle',type:'path',d:'M18 22 L18 12 Q30 -2 42 12 L42 22',fill:'none',stroke:'#9d8960',strokeWidth:4},
    {id:'case',type:'rect',x:10,y:22,width:40,height:68,fill:'#202923',stroke:'#a18b58',strokeWidth:4},
    {id:'glass',type:'rect',x:17,y:31,width:26,height:48,fill:'#50452d'},
    {id:'flame',type:'path',d:'M30 77 Q18 65 30 43 Q43 66 30 77 Z',fill:'#ffd36b',pivotX:30,pivotY:77,
      light:{kind:'flame',radius:80,color:'#ffba42',intensity:.85,x:30,y:64}},
    {id:'bar-l',type:'line',x:19,y:25,x2:0,y2:62,stroke:'#a18b58',strokeWidth:3},
    {id:'bar-r',type:'line',x:41,y:25,x2:0,y2:62,stroke:'#a18b58',strokeWidth:3},
  ]};
}
export function vectorFootprintNodes(prefix:string,color='#0b1514'):VectorNode[]{
  const nodes:VectorNode[]=[
    {id:prefix+'-sole',type:'path',d:'M -4 15 C -7 10 -6 5 -6 0 C -7 -7 5 -10 6 -3 C 8 3 3 6 4 12 C 6 19 -2 21 -4 15 Z',fill:color},
    {id:prefix+'-heel',type:'path',d:'M -3 13 Q -4 10 -3 8',fill:'none',stroke:'#49635a',strokeWidth:.65},
    ...[-5,-2,1,4,6].map((x,i):VectorNode=>({id:prefix+`-toe-${i}`,type:'ellipse',x,y:-11+Math.abs(x)*.3,rx:i===0?2.6:1.9-i*.15,ry:i===0?3:2.2,fill:color})),
  ];
  return nodes;
}
