// One-time import of the user-approved SVG. Runtime generation never calls an AI
// or this script to redraw the character. The original SVG remains the source.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {svgPathProperties} = require('svg-path-properties');

const round = v=>Number(v.toFixed(3));
function simplify(points,tolerance=.065) {
  if(points.length<3)return points;
  const a=points[0],b=points.at(-1),dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
  let distance=0,index=0;
  for(let i=1;i<points.length-1;i++){
    const p=points[i],t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
    const d=Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
    if(d>distance){distance=d;index=i;}
  }
  return distance>tolerance?[...simplify(points.slice(0,index+1),tolerance).slice(0,-1),...simplify(points.slice(index),tolerance)]:[a,b];
}
function compact(d){
  if(d.length<7800)return d;
  return (d.match(/M[^M]*/g)||[]).map(part=>{
    const p=new svgPathProperties(part),length=p.getTotalLength(),n=Math.ceil(length/.4),closed=/Z\s*$/.test(part);
    const points=simplify(Array.from({length:n+1},(_,i)=>p.getPointAtLength(length*i/n)));
    return 'M'+points.map(p=>round(p.x)+' '+round(p.y)).join('L')+(closed?'Z':'');
  }).join(' ');
}
function translate(d,dx,dy){
  const tokens=d.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi),out=[];
  let i=0,cmd='';
  while(i<tokens.length){
    if(/^[a-z]$/i.test(tokens[i])){cmd=tokens[i++];out.push(cmd);}
    if(cmd==='Z')continue;
    const count={M:2,L:2,C:6,Q:4,A:7,H:1,V:1}[cmd];
    if(!count)throw Error('Unsupported approved SVG command '+cmd);
    const values=tokens.slice(i,i+count).map(Number);i+=count;
    if(cmd==='A'){values[5]+=dx;values[6]+=dy;}
    else if(cmd==='H')values[0]+=dx;
    else if(cmd==='V')values[0]+=dy;
    else for(let j=0;j<count;j++)values[j]+=j%2?dy:dx;
    out.push(...values.map(v=>String(round(v))));
  }
  return compact(out.join(' '));
}
function parse(svg){
  const groups={},stack=[{id:'',attrs:{}}];
  for(const tag of svg.match(/<\/?g\b[^>]*>|<(?:path|circle)\b[^>]*\/>/g)||[]){
    if(tag.startsWith('</g')){stack.pop();continue;}
    const a=Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    const inherited={...stack.at(-1).attrs,...a};
    if(tag.startsWith('<g')){const id=a.id||stack.at(-1).id;stack.push({id,attrs:inherited});groups[id]??=[];continue;}
    const shape=tag.startsWith('<circle')?{type:'ellipse',x:+a.cx,y:+a.cy,rx:+a.r,ry:+a.r}:{type:'path',d:compact(a.d)};
    for(const key of ['fill','stroke'])if(inherited[key])shape[key]=inherited[key];
    if(inherited['stroke-width'])shape.strokeWidth=+inherited['stroke-width'];
    groups[stack.at(-1).id].push(shape);
  }
  return groups;
}

async function main(){
  const target=path.resolve(process.argv[3]||'shared/assets/folk-approved'),source=process.argv[2]||path.join(target,'character.svg');
  const svg=await fs.readFile(source,'utf8'),groups=parse(svg);
  const scale=280/345,offset=90-100*scale,ink='#0e0c0b';
  const nodes=[{id:'puppet-root',type:'group'},
    {id:'upper-body',type:'group',parent:'puppet-root',pivotX:90,pivotY:280,pivotSpace:'local'}];
  const group=(id,parent,extra={})=>nodes.push({id,type:'group',parent,...extra});
  const shape=(id,parent,source,dx=0,dy=0)=>{
    const n={id,parent,...source};
    if(n.d)n.d=translate(n.d,dx,dy);
    if(n.x!==undefined)n.x=round(n.x+dx);if(n.y!==undefined)n.y=round(n.y+dy);
    nodes.push(n);return n;
  };
  const art=(id,parent,items,extra={},dx=0,dy=0)=>{
    group(id,parent,extra);items.forEach((n,i)=>shape(id+'-ink-'+i,id,n,dx,dy));
  };
  art('torso','upper-body',groups.body.slice(0,3),{x:offset,scaleX:scale,scaleY:scale});
  art('costume','upper-body',groups.body.slice(3),{x:offset,scaleX:scale,scaleY:scale});
  // The renderer applies the base scale around the motion pivot. Compensate
  // that offset so a stationary head occupies its exact source coordinates.
  group('head-group','upper-body',{x:round(offset+106*scale),y:round(96*scale-86*(1-scale)),scaleX:scale,scaleY:scale,pivotY:86,pivotSpace:'local'});
  art('hair-back','head-group',groups['hair-back'],{},-106,-96);
  art('face','head-group',groups.head.slice(0,2),{},-106,-96);
  art('ear-l','head-group',groups.head.slice(2),{},-106,-96);
  art('hair','head-group',groups['hair-front'],{},-106,-96);
  art('headwear','head-group',groups['head-wrap'],{},-106,-96);
  for(let i=0;i<2;i++){
    const side=i?'r':'l',x=i?143:99,y=93;
    const parts=groups.brows.map(n=>({...n,d:(n.d.match(/M[^M]*/g)||[])[i]}));
    art('brow-'+side,'head-group',parts,{x:x-106,y:y-96},-x,-y);
  }
  const eyeY=groups.lashes?.length?groups.pupils[0].y-96:15;
  group('blink','head-group',{pivotY:eyeY,pivotX:15,pivotSpace:'local'});
  group('eyes','blink',{pivotY:eyeY,pivotX:15,pivotSpace:'local'});
  for(let i=0;i<2;i++){
    const side=i?'r':'l';
    art('eye-white-'+side,'eyes',groups.eyes.slice(i*2,i*2+2),{},-106,-96);
    shape('eye-'+side,'eyes',groups.pupils[i],-106,-96);
  }
  if(groups.lashes?.length)art('eyelashes','eyes',groups.lashes,{},-106,-96);
  // The dynamic mouth retains the approved filled ink contour, rebased to the
  // existing expression target. Dialogue can replace it with a filled ellipse.
  const fearInk=groups['fear-mouth'].filter(n=>n.fill===ink);
  const fear={...fearInk[0],d:fearInk.map(n=>n.d).join(' ')};
  // Mouth and blink anchors follow each authored model sheet, including the
  // lower eye/mouth layout of the reference woman. Male import stays exact.
  const mouthY=groups.lashes?.length?161:140;
  shape('approved-fear-mouth','head-group',{...fear,d:translate(fear.d,-121,-mouthY),opacity:0,x:15,y:mouthY-96});
  shape('mouth','head-group',{type:'path',x:15,y:mouthY-96,d:'M 0 -1.5 A 3.8 1.5 0 1 0 0 1.5 A 3.8 1.5 0 1 0 0 -1.5 Z',fill:ink,stroke:'none'});
  art('beard','head-group',groups.stubble,{},-106,-96);
  art('age-lines','head-group',groups.expression,{},-106,-96);
  // Contacts stay at their long-established native coordinates. The visible
  // grip is a short ink stroke; no flesh-colored dot is invented on the bucket.
  for(const side of ['l','r'])shape('hand-'+side,'upper-body',{type:'path',x:side==='l'?47:133,y:182,d:'M -6 2 Q -3 -4 0 -4 Q 3 -4 6 2',fill:'none',stroke:ink,strokeWidth:2.6});
  group('rear-head','head-group',{opacity:0});
  for(const [i,n] of [groups['hair-back'][0],groups.head[0],groups['hair-front'][0],groups['head-wrap'][0]].entries()){
    if(!n)continue;
    shape(i?'rear-head-art-'+i:'rear-hair','rear-head',{...n,fill:'#18171d',stroke:ink,strokeWidth:5.1},-106,-96);
  }
  group('rear-costume','upper-body',{opacity:0,x:offset,scaleX:scale,scaleY:scale});
  // The reference woman's skirt and over-blouse remain the same garment
  // when she turns away; only front collar/seam decoration disappears.
  if(groups.lashes?.length)groups.body.slice(3,7).forEach((n,i)=>shape('rear-dress-art-'+i,'rear-costume',n));
  shape('rear-seam','rear-costume',{type:'path',d:'M 99 191 Q 97 250 100 318',fill:'none',stroke:ink,strokeWidth:1.5});
  for(const id of ['handdrawn-finish','village-cast-v1','village-mouth-cued','approved-folk-svg-v1'])group(id,'puppet-root');
  if(nodes.length>140)throw Error('Insufficient node budget for motion effects: '+nodes.length);
  for(const n of nodes)if(n.d?.length>8000)throw Error('Approved path exceeds renderer path budget: '+n.id+' '+n.d.length);
  const neutralPath=path.join(path.dirname(source),'character-neutral.svg');
  const neutral=await fs.readFile(neutralPath,'utf8');
  const neutralBrows=parse(neutral).brows[0];
  const data={sourceSha256:crypto.createHash('sha256').update(svg).digest('hex'),sourceViewBox:[0,0,195,355],scale,offset,
    neutralBrows:neutralBrows?(neutralBrows.d.match(/M[^M]*/g)||[]).map((d,i)=>({...neutralBrows,d:translate(d,-(i?143:99),-93)})):[],
    drawing:{width:180,height:280,nodes}};
  await fs.mkdir(target,{recursive:true});
  if(path.resolve(source)!==path.join(target,'character.svg'))await fs.copyFile(source,path.join(target,'character.svg'));
  if(path.resolve(neutralPath)!==path.join(target,'character-neutral.svg'))await fs.copyFile(neutralPath,path.join(target,'character-neutral.svg'));
  await fs.writeFile(path.join(target,'character.json'),JSON.stringify(data));
  console.log(JSON.stringify({nodes:nodes.length,longestPath:Math.max(...nodes.map(n=>n.d?.length||0)),sourceSha256:data.sourceSha256}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
