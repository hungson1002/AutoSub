import {vectorLightState} from '../../shared/canvasVectorLight';
import type {ReactNode} from 'react';
import {useCurrentFrame,useVideoConfig} from 'remotion';
import type {CanvasStudioScene} from '../../shared/canvasAnimationStudio';
import type {VectorDrawing,VectorNode} from '../../shared/canvasVectorScene';
import {evaluateVectorPart} from '../../shared/canvasVectorScene';
import {canvasCaptionAt} from '../canvasAnimationStudio/captions';
import {vectorWorldMatrix,hangingRotation} from '../../shared/canvasVectorTransform';
import {puppetHandOpacity,puppetPaintOrder,puppetMouthState} from '../../shared/canvasVectorPuppet';

export function RemotionVectorSceneFrame(props:{scene:CanvasStudioScene;width:number;height:number;playbackRate?:number}){
  const frame=useCurrentFrame(),{fps}=useVideoConfig();
  return <VectorSceneFrame {...props} timeMs={frame/fps*1000*(props.playbackRate??1)}/>;
}

/** Real SVG elements inside the Remotion composition, sharing authored timing
 * with the editor. Generated scripts/markup are never evaluated. */
export function VectorSceneFrame({scene,timeMs,width,height}:{scene:CanvasStudioScene;timeMs:number;width:number;height:number}){
  const assets=scene.vectorAssetLibrary||{};let clipIndex=0;
  const drawing=scene.vectorScene!;
  const attachments=new Map<string,VectorNode[]>();
  for(const n of drawing.nodes)if(n.attachTo){const list=attachments.get(n.attachTo)||[];list.push(n);attachments.set(n.attachTo,list);}
  let renderSceneNode:(node:VectorNode)=>ReactNode;
  function renderDrawing(d:VectorDrawing,prefix=''):ReactNode{
    const children=new Map<string|undefined,VectorNode[]>();
    for(const node of d.nodes){if(node.attachTo)continue;const list=children.get(node.parent)||[];list.push(node);children.set(node.parent,list);}
    function nodeElement(node:VectorNode):ReactNode{
      const state={...evaluateVectorPart(prefix+node.id,scene,timeMs,node.opacity??1),
        ...(node.id==='mouth'?puppetMouthState(prefix+node.id,d,scene,timeMs):{})};
      const px=node.pivotX??(node.hang&&node.type==='instance'?(node.width??assets[node.asset!]!.width)/2:0),py=node.pivotY||0;
      const suspended=node.hang?hangingRotation(vectorWorldMatrix(node.attachTo!,scene,timeMs,assets)):0;
      const transform=`translate(${(node.x||0)+state.dx} ${(node.y||0)+state.dy}) translate(${px} ${py}) rotate(${(node.rotation||0)+state.rotation+suspended}) scale(${(node.scaleX??1)*state.scaleX} ${(node.scaleY??1)*state.scaleY}) translate(${-px} ${-py})`;
      const light=node.light?vectorLightState(node.light,timeMs):undefined;
      const puppetHand=d.nodes.some(n=>n.id==='puppet-root')&&/^hand-[lr]$/.test(node.id);
      const paint={fill:state.fill||(light&&node.type!=='group'?light.sourceColor:node.fill)||'none',stroke:node.stroke||'none',strokeWidth:node.strokeWidth??2,strokeLinecap:'round' as const,strokeLinejoin:'round' as const,
        ...(puppetHand?{opacity:puppetHandOpacity(prefix+node.id,scene,timeMs)}:{})};
      const clipId=`vector-clip-${scene.id}-${clipIndex++}`;
      let shape:ReactNode;
      if(node.type==='instance'){
        const asset=assets[node.asset!];
        if(!asset)throw new Error(`Missing vector asset ${node.asset}`);
        shape=<g transform={`scale(${(node.width??asset.width)/asset.width} ${(node.height??asset.height)/asset.height})`}>{renderDrawing(asset,node.id+'/')}{(children.get(node.id)||[]).map(nodeElement)}</g>;
      }else if(node.type==='path')shape=<path d={state.d||node.d} {...paint}/>;
      else if(node.type==='ellipse')shape=<ellipse cx={0} cy={0} rx={node.rx} ry={node.ry} {...paint}/>;
      else if(node.type==='rect')shape=<rect width={node.width} height={node.height} {...paint}/>;
      else if(node.type==='line')shape=<line x1={0} y1={0} x2={node.x2||0} y2={node.y2||0} {...paint} fill="none"/>;
      return <g key={node.id} transform={transform} opacity={puppetHand?1:state.opacity}>
        {node.clip?<defs><clipPath id={clipId}><rect {...node.clip}/></clipPath></defs>:null}
        <g clipPath={node.clip?`url(#${clipId})`:undefined}>
          {light?.rings.map((ring,i)=><circle key={i} cx={light.x} cy={light.y} r={ring.radius} fill={light.color} opacity={ring.opacity}/>)}
          <g transform={node.light?.kind==='flame'?`translate(${node.pivotX??light!.x} ${node.pivotY??light!.y}) scale(${light!.scaleX} ${light!.scaleY}) translate(${-(node.pivotX??light!.x)} ${-(node.pivotY??light!.y)})`:undefined}>
            {puppetHand?null:shape}{node.type==='instance'?null:puppetPaintOrder(children.get(node.id)||[],d,prefix,scene,timeMs).map(nodeElement)}
            {(attachments.get(prefix+node.id)||[]).map(n=>renderSceneNode(n))}
            {puppetHand?shape:null}
            {node.light?.kind==='flame'?<ellipse cx={light!.x} cy={light!.y} rx={node.light.radius*.045} ry={node.light.radius*.085} fill="#fffde9"/>:null}
          </g>
        </g>
      </g>;
    }
    if(!prefix)renderSceneNode=nodeElement;
    return (children.get(undefined)||[]).map(nodeElement);
  }
  const caption=canvasCaptionAt(scene,timeMs);
  const backdrop=drawing.nodes.find(n=>n.type==='rect'&&(n.x??0)===0&&(n.y??0)===0&&(n.width??0)>=drawing.width&&(n.height??0)>=drawing.height&&n.fill&&n.fill!=='none'&&n.fill!=='transparent')?.fill||'#0c1218';
  return <div style={{position:'absolute',inset:0,overflow:'hidden',width,height}}>
    <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={`0 0 ${drawing.width} ${drawing.height}`} preserveAspectRatio="none" style={{display:'block',overflow:'hidden'}}><rect width={drawing.width} height={drawing.height} fill={backdrop}/>{renderDrawing(drawing)}</svg>
    {caption?<div style={{position:'absolute',top:'4%',left:'8%',right:'8%',padding:'8px 12px',color:'#fff',background:'rgba(0,0,0,.38)',fontFamily:'Arial, Helvetica, sans-serif',fontWeight:600,fontSize:Math.max(20,Math.round(Math.min(height*.034,width*.052))),lineHeight:1.22,textAlign:'center',textShadow:'0 1px 3px #000',whiteSpace:'normal'}}>{caption}</div>:null}
  </div>;
}
