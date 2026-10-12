import {vectorLightState} from '../../shared/canvasVectorLight';
import type {CanvasStudioScene} from './types';
import type {VectorDrawing,VectorNode} from '../../shared/canvasVectorScene';
import {evaluateVectorPart} from '../../shared/canvasVectorScene';
import {vectorWorldMatrix,hangingRotation} from '../../shared/canvasVectorTransform';
import {puppetHandOpacity,puppetPaintOrder,puppetMouthState} from '../../shared/canvasVectorPuppet';

// Path2D consumes SVG geometry only; generated HTML or code never executes.
const paths=new Map<string,Path2D>();
function cachedPath(d:string){
  let path=paths.get(d);
  if(!path){path=new Path2D(d);if(paths.size>=512)paths.clear();paths.set(d,path);}
  return path;
}
export function drawVectorScene(ctx:CanvasRenderingContext2D,scene:CanvasStudioScene,timeMs:number,width:number,height:number){
  const drawing=scene.vectorScene;if(!drawing)return false;
  const assets=scene.vectorAssetLibrary||{};
  const attachments=new Map<string,VectorNode[]>();
  for(const n of drawing.nodes)if(n.attachTo){const list=attachments.get(n.attachTo)||[];list.push(n);attachments.set(n.attachTo,list);}
  let visitSceneNode:(node:VectorNode)=>void;
  const draw=(drawing:VectorDrawing,prefix='')=>{
    const children=new Map<string|undefined,VectorNode[]>();
    for(const node of drawing.nodes){if(node.attachTo)continue;const list=children.get(node.parent)||[];list.push(node);children.set(node.parent,list);}
    const visit=(node:VectorNode)=>{
      const state={...evaluateVectorPart(prefix+node.id,scene,timeMs,node.opacity??1),
        ...(node.id==='mouth'?puppetMouthState(prefix+node.id,drawing,scene,timeMs):{})};
      const puppetHand=drawing.nodes.some(n=>n.id==='puppet-root')&&/^hand-[lr]$/.test(node.id);
      ctx.save();ctx.translate((node.x||0)+state.dx,(node.y||0)+state.dy);
      const px=node.pivotX??(node.hang&&node.type==='instance'?(node.width??assets[node.asset!]!.width)/2:0),py=node.pivotY||0;
      ctx.translate(px,py);
      const suspended=node.hang?hangingRotation(vectorWorldMatrix(node.attachTo!,scene,timeMs,assets)):0;
      ctx.rotate(((node.rotation||0)+state.rotation+suspended)*Math.PI/180);
      ctx.scale((node.scaleX??1)*state.scaleX,(node.scaleY??1)*state.scaleY);
      ctx.translate(-px,-py);
      if(node.clip){ctx.beginPath();ctx.rect(node.clip.x,node.clip.y,node.clip.width,node.clip.height);ctx.clip();}
      ctx.globalAlpha*=puppetHand?1:state.opacity;
      ctx.lineJoin='round';ctx.lineCap='round';ctx.lineWidth=node.strokeWidth??2;
      const light=node.light?vectorLightState(node.light,timeMs):undefined;
      if(light){
        for(const ring of light.rings){
          ctx.save();ctx.globalAlpha*=ring.opacity;ctx.fillStyle=light.color;
          ctx.beginPath();ctx.arc(light.x,light.y,ring.radius,0,Math.PI*2);ctx.fill();ctx.restore();
        }
        if(node.light?.kind==='flame'){
          const ax=node.pivotX??light.x,ay=node.pivotY??light.y;
          ctx.translate(ax,ay);ctx.scale(light.scaleX,light.scaleY);ctx.translate(-ax,-ay);
        }
      }
      if(puppetHand)for(const child of attachments.get(prefix+node.id)||[])visitSceneNode(child);
      const fill=state.fill||(light&&node.type!=='group'?light.sourceColor:node.fill)||'none',stroke=node.stroke||'none';
      ctx.fillStyle=fill==='none'?'transparent':fill;ctx.strokeStyle=stroke==='none'?'transparent':stroke;
      if(node.type==='instance'){
        const asset=assets[node.asset!];if(!asset)throw new Error(`Vector asset unavailable: ${node.asset}`);
        ctx.scale((node.width??asset.width)/asset.width,(node.height??asset.height)/asset.height);
        draw(asset,node.id+'/');
      }else if(node.type!=='group'){
        ctx.save();
        if(puppetHand)ctx.globalAlpha*=puppetHandOpacity(prefix+node.id,scene,timeMs);
        let path:Path2D;
        if(node.type==='path')path=cachedPath(state.d||node.d!);
        else{
          path=new Path2D();
          if(node.type==='ellipse')path.ellipse(0,0,node.rx!,node.ry!,0,0,Math.PI*2);
          else if(node.type==='rect')path.rect(0,0,node.width!,node.height!);
          else {path.moveTo(0,0);path.lineTo(node.x2||0,node.y2||0);}
        }
        if(fill!=='none'&&node.type!=='line')ctx.fill(path);
        if(stroke!=='none'&&ctx.lineWidth>0)ctx.stroke(path);
        ctx.restore();
      }
      for(const child of puppetPaintOrder(children.get(node.id)||[],drawing,prefix,scene,timeMs))visit(child);
      if(!puppetHand)for(const child of attachments.get(prefix+node.id)||[])visitSceneNode(child);
      if(light&&node.light?.kind==='flame'){
        ctx.fillStyle='#fffde9';ctx.beginPath();ctx.ellipse(light.x,light.y,node.light.radius*.045,node.light.radius*.085,0,0,Math.PI*2);ctx.fill();
      }
      ctx.restore();
    };
    if(!prefix)visitSceneNode=visit;
    for(const node of children.get(undefined)||[])visit(node);
  };
  ctx.save();ctx.scale(width/drawing.width,height/drawing.height);
  ctx.beginPath();ctx.rect(0,0,drawing.width,drawing.height);ctx.clip();
  draw(drawing);ctx.restore();return true;
}
