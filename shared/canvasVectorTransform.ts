import {evaluateVectorPart,type VectorNode,type VectorDrawing} from './canvasVectorScene';
import type {CanvasStudioScene} from './canvasAnimationStudio';
type Matrix={a:number;b:number;c:number;d:number;e:number;f:number};
const identity=():Matrix=>({a:1,b:0,c:0,d:1,e:0,f:0});
const multiply=(m:Matrix,n:Matrix):Matrix=>({a:m.a*n.a+m.c*n.b,b:m.b*n.a+m.d*n.b,c:m.a*n.c+m.c*n.d,d:m.b*n.c+m.d*n.d,e:m.a*n.e+m.c*n.f+m.e,f:m.b*n.e+m.d*n.f+m.f});
export function hangingRotation(parent:Matrix){return Math.atan2(parent.c,parent.a)*180/Math.PI+(parent.a*parent.d-parent.b*parent.c<0?180:0);}
/** Actual joint/camera transform, shared by hanging props and framing evidence. */
export function vectorWorldMatrix(target:string,scene:CanvasStudioScene,timeMs:number,assets:Record<string,VectorDrawing>=scene.vectorAssetLibrary||{}):Matrix{
  const drawing=scene.vectorScene!,cache=new Map<string,Matrix>(),visiting=new Set<string>();
  const visit=(target:string):Matrix=>{
    if(cache.has(target))return cache.get(target)!;
    if(visiting.has(target))throw new Error('Vector: cyclic world transform');visiting.add(target);
    const [instance,part]=target.split('/');
    const owner=part?drawing.nodes.find(n=>n.id===instance&&n.type==='instance'):undefined;
    const node:VectorNode|undefined=part?assets[owner?.asset||'']?.nodes.find(n=>n.id===part):drawing.nodes.find(n=>n.id===target);
    if(!node)throw new Error(`Vector: missing world transform target ${target}`);
    const parentTarget=part?(node.parent?instance+'/'+node.parent:instance):node.attachTo||node.parent;
    const parent=parentTarget?visit(parentTarget):identity(),state=evaluateVectorPart(target,scene,timeMs,node.opacity??1);
    const asset=node.type==='instance'?assets[node.asset!]:undefined;
    const px=node.pivotX??(node.hang&&asset?(node.width??asset.width)/2:0),py=node.pivotY??0;
    const angle=((node.rotation??0)+state.rotation+(node.hang?hangingRotation(parent):0))*Math.PI/180;
    const sx=(node.scaleX??1)*state.scaleX,sy=(node.scaleY??1)*state.scaleY;
    const a=Math.cos(angle)*sx,b=Math.sin(angle)*sx,c=-Math.sin(angle)*sy,d=Math.cos(angle)*sy;
    let local:Matrix={a,b,c,d,e:(node.x??0)+state.dx+px-a*px-c*py,f:(node.y??0)+state.dy+py-b*px-d*py};
    if(asset)local=multiply(local,{...identity(),a:(node.width??asset.width)/asset.width,d:(node.height??asset.height)/asset.height});
    const result=multiply(parent,local);cache.set(target,result);visiting.delete(target);return result;
  };
  return visit(target);
}
export function vectorPoint(matrix:Matrix,x:number,y:number){return {x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f};}
