import {createCanvasProject,type CanvasStudioProject,type CanvasStudioScene} from '../../shared/canvasAnimationStudio';
import {normalizeVectorScene,type VectorNode} from '../../shared/canvasVectorScene';
import {APPROVED_FOLK_STYLE} from '../../shared/canvasVectorInk';

export type VectorCastDetail={view:'right'|'left';assetIds:string[];imageUrl:string};

/** An inspection view of immutable generated assets, never a replacement film. */
export function buildVectorCastReview(project:CanvasStudioProject){
  const assets=project.vectorAssets||{};
  const ids=[...new Set(project.scenes.flatMap(s=>s.vectorScene?.nodes.filter(n=>n.type==='instance').map(n=>n.asset!)||[]))]
    .filter(id=>assets[id]?.nodes.some(n=>n.id===APPROVED_FOLK_STYLE)
      &&assets[id]!.nodes.some(n=>n.id==='puppet-root')).sort().slice(0,16);
  if(!ids.length)return undefined;
  const pageSize=ids.every(id=>assets[id]!.nodes.some(n=>n.id==='front-head'))?8:4;
  const preview=createCanvasProject();preview.name='Cast detail inspection';preview.width=1600;preview.height=740;preview.vectorAssets=assets;
  const base=preview.scenes[0]!,scenes:CanvasStudioScene[]=[],pages:Array<{id:string;view:'right'|'left';assetIds:string[]}>=[];
  for(let offset=0;offset<ids.length;offset+=pageSize)for(const view of ['right','left'] as const){
    const assetIds=ids.slice(offset,offset+pageSize),id=`cast-${view}-${offset}`;
    const nodes:VectorNode[]=[{id:'background',type:'rect',width:1600,height:740,fill:'#e8e0ca'}];
    for(const [i,asset] of assetIds.entries()){
      const drawing=assets[asset]!,width=280*(drawing.width||180)/(drawing.height||280);
      nodes.push({id:'cast-'+i,type:'instance',asset,x:i%4*400+200-width/2,y:Math.floor(i/4)*355+50,width,height:280});
    }
    scenes.push({...base,id,name:`Cast ${view}`,durationMs:1000,narration:'',audioUrl:undefined,dialogue:undefined,
      vectorAssetLibrary:assets,vectorScene:normalizeVectorScene({width:1600,height:740,nodes,
        ...(view==='left'?{turns:assetIds.map((_,i)=>({actor:'cast-'+i,from:'right',to:'left',hold:true}))}:{})},assets)});
    pages.push({id,view,assetIds});
  }
  preview.scenes=scenes;
  return {project:preview,pages};
}
