// Approval-prototype helper only. The application renderer is untouched.
const svgpath = require('svgpath');
const f = x => +x.toFixed(2);
function rng(seed) {
  let h=2166136261;
  for(const ch of seed)h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;
  return ()=>((h=(Math.imul(h,1664525)+1013904223)>>>0)/4294967296);
}
function soften(source,structural=false) {
  const random=rng(source);
  const segments=svgpath(source).abs().unshort().segments;
  let x=0,y=0,mx=0,my=0;
  const result=[];
  for(const segment of segments) {
    const [command,...v]=segment;
    let end;
    if(command==='M') {
      [x,y]=v;[mx,my]=v;
      result.push(`M${x} ${y}`);continue;
    }
    if(command==='Z')end=[mx,my];
    else if(command==='L')end=v;
    else if(command==='H')end=[v[0],y];
    else if(command==='V')end=[x,v[0]];
    if(end) {
      const dx=end[0]-x,dy=end[1]-y,length=Math.hypot(dx,dy);
      if(length>.01) {
        // Broad slow bows, not high frequency vibration or displaced endpoints.
        const amplitude=structural?Math.min(.3,length*.004):Math.min(3.4,length*.035);
        const bend=(random()<.5?-1:1)*amplitude;
        const nx=-dy/length,ny=dx/length;
        result.push(`C${f(x+dx*.33+nx*bend)} ${f(y+dy*.33+ny*bend)} ${f(x+dx*.69+nx*bend*.7)} ${f(y+dy*.69+ny*bend*.7)} ${end[0]} ${end[1]}`);
      }
      [x,y]=end;
      if(command==='Z')result.push('Z');
    } else {
      result.push(command+v.join(' '));
      [x,y]=v.slice(-2);
    }
  }
  return result.join(' ');
}
function loop(points) {
  const middle=(a,b)=>`${f((a.x+b.x)/2)} ${f((a.y+b.y)/2)}`;
  let d='M'+middle(points.at(-1),points[0]);
  points.forEach((p,i)=>d+=` Q${f(p.x)} ${f(p.y)} ${middle(p,points[(i+1)%points.length])}`);
  return d+'Z';
}
function sample(subpath) {
  const points=[];
  let x=0,y=0,travel=0,previous;
  for(const [command,...v] of svgpath(subpath).abs().unshort().segments) {
    if(command==='M'){[x,y]=v;continue;}
    if(command==='Z')continue;
    const end=v.slice(-2),px=x,py=y;
    const estimate=command==='C'?Math.hypot(v[0]-x,v[1]-y)+Math.hypot(v[2]-v[0],v[3]-v[1])+Math.hypot(end[0]-v[2],end[1]-v[3]):Math.hypot(v[0]-x,v[1]-y)+Math.hypot(end[0]-v[0],end[1]-v[1]);
    const steps=Math.max(3,Math.ceil(estimate/3.5));
    for(let i=points.length?1:0;i<=steps;i++) {
      const t=i/steps,u=1-t;
      let sx,sy,dx,dy;
      if(command==='C'){
        sx=u*u*u*px+3*u*u*t*v[0]+3*u*t*t*v[2]+t*t*t*v[4];
        sy=u*u*u*py+3*u*u*t*v[1]+3*u*t*t*v[3]+t*t*t*v[5];
        dx=3*u*u*(v[0]-px)+6*u*t*(v[2]-v[0])+3*t*t*(v[4]-v[2]);
        dy=3*u*u*(v[1]-py)+6*u*t*(v[3]-v[1])+3*t*t*(v[5]-v[3]);
      }else if(command==='Q'){
        sx=u*u*px+2*u*t*v[0]+t*t*v[2];sy=u*u*py+2*u*t*v[1]+t*t*v[3];
        dx=2*u*(v[0]-px)+2*t*(v[2]-v[0]);dy=2*u*(v[1]-py)+2*t*(v[3]-v[1]);
      }else throw new Error('Unexpected prototype path command: '+command);
      if(previous)travel+=Math.hypot(sx-previous.x,sy-previous.y);
      const norm=Math.hypot(dx,dy)||1;
      const p={x:sx,y:sy,tangentX:dx/norm,tangentY:dy/norm,s:travel,t};
      points.push(p);previous=p;
    }
    [x,y]=end;
  }
  return points;
}
function paintedPath(source,fill,width,color,options={}) {
  if(width===0)return `<path d="${source}" fill="${fill}"/>`;
  const d=soften(source,options.structural===true);
  const common='stroke-linejoin="round" stroke-linecap="round"';
  let output='';
  const subpaths=d.match(/M[^M]+/g)||[];
  subpaths.forEach((subpath,index)=>{
    const samples=sample(subpath);
    if(samples.length<2)return;
    const random=rng(source+':'+index),phase=random()*Math.PI*2;
    const left=[],right=[];
    const length=samples.at(-1).s;
    // Slow, uneven pen deviations. Join points remain attached; the fill follows
    // the exact same contour, so there is no displaced-outline or filter effect.
    samples.forEach(a=>{
      const feather=Math.sin(Math.PI*a.t)**.65;
      const deviation=Math.min(.85,width*.3)*Math.min(1,length/65)*feather*(.7*Math.sin(a.s/17.7+phase)+.3*Math.sin(a.s/8.9+phase*.47));
      a.x-=a.tangentY*deviation;
      a.y+=a.tangentX*deviation;
    });
    let center=`M${f(samples[0].x)} ${f(samples[0].y)}`;
    for(let i=1;i<samples.length;i++)center+=` L${f(samples[i].x)} ${f(samples[i].y)}`;
    if(subpath.endsWith('Z'))center+='Z';
    output+=`<path d="${center}" fill="${fill}" stroke="${color}" stroke-width="${f(width*.6)}" ${common}/>`;
    for(const a of samples) {
      const s=a.s;
      // Filled ink varies in thickness along a stable authored contour.
      const pressure=1+.22*Math.sin(s/31+phase)+.1*Math.sin(s/11.3+phase*.7);
      const half=width*.5*pressure,nx=-a.tangentY,ny=a.tangentX;
      left.push({x:a.x+nx*half,y:a.y+ny*half});
      right.push({x:a.x-nx*half,y:a.y-ny*half});
    }
    output+=`<path d="${loop([...left,...right.reverse()])}" fill="${color}"/>`;
    if(!subpath.endsWith('Z')) {
      for(const p of [samples[0],samples.at(-1)]){
        output+=`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(width*.43)}" fill="${color}"/>`;
      }
    }
  });
  return output;
}
module.exports={paintedPath};
