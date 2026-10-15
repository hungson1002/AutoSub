import {evaluateVectorPart,frameVectorScene,type CanvasVectorScene,type VectorDrawing,type VectorNode} from './canvasVectorScene';
import {vectorWorldMatrix,vectorPoint} from './canvasVectorTransform';
import type {CanvasStudioScene} from './canvasAnimationStudio';

/** Measured screen coverage for declared story objects. Presence in JSON is
 * not evidence that a viewer can see a clue or its interaction partner. */
export function vectorShotVisibility(scene:CanvasStudioScene,assets:Record<string,VectorDrawing>,target:string,atMs:number){
  const drawing=scene.vectorScene!;
  const [owner,part]=target.split('/'),instance=drawing.nodes.find(n=>n.id===owner);
  const asset=instance?.type==='instance'?assets[instance.asset!]:undefined;
  const node=part?asset?.nodes.find(n=>n.id===part):instance;
  if(!node)return {target,missing:true as const};
  const width=part?node.width:asset?.width??node.width,height=part?node.height:asset?.height??node.height;
  const bounds=node.bounds?[node.bounds.x,node.bounds.y,node.bounds.width,node.bounds.height]:node.type==='ellipse'?[-(node.rx??0),-(node.ry??0),(node.rx??0)*2,(node.ry??0)*2]:width&&height?[0,0,width,height]:undefined;
  if(!bounds)return {target,unmeasured:true as const};
  let opacity=1,current:VectorNode|undefined=node,inside=Boolean(part);
  while(current){
    opacity*=evaluateVectorPart(inside?owner+'/'+current.id:current.id,scene,atMs,current.opacity??1).opacity;
    if(inside&&!current.parent){inside=false;current=instance;}
    else current=current.parent?(inside?asset!.nodes:drawing.nodes).find(n=>n.id===current!.parent):undefined;
  }
  const matrix=vectorWorldMatrix(target,scene,atMs,assets),[x,y,w,h]=bounds as [number,number,number,number];
  const points=[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([x,y])=>vectorPoint(matrix,x!,y!));
  const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y));
  const area=(right-left)*(bottom-top),visible=Math.max(0,Math.min(right,drawing.width)-Math.max(left,0))*Math.max(0,Math.min(bottom,drawing.height)-Math.max(top,drawing.height*.19));
  return {target,opacity,visibleFraction:area?visible/area:0,widthFraction:(right-left)/drawing.width,heightFraction:(bottom-top)/drawing.height};
}

/** Balance a fixed acting cut and retain carried props through the complete
 * motion. A wider fixed cut is preferable to chopping off a narrated prop. */
export function balanceGroundedActingFrame(scene:CanvasStudioScene,assets:Record<string,VectorDrawing>):CanvasStudioScene{
  const d=scene.vectorScene;if(!d?.ground)return scene;
  if(scene.vectorDirection?.shot.size==='detail')return scene;
  const actors=d.nodes.filter(n=>n.type==='instance'&&assets[n.asset!]?.nodes.some(p=>p.id==='foot-r'));
  if(actors.length!==1)return scene;
  const actor=actors[0]!,asset=assets[actor.asset!]!;
  const camera=d.tracks.find(t=>/^camera-world(?:-\d+)?$/.test(t.target)&&t.frames.length===1&&(t.frames[0]!.scaleY??1)>1);
  if(!camera||actor.parent!==camera.target)return scene;
  const points=[0,scene.durationMs/2,scene.durationMs].flatMap(t=>{
    const m=vectorWorldMatrix(actor.id,scene,t,assets);
    return [vectorPoint(m,asset.width/2,60),vectorPoint(m,asset.width/2,465)];
  });
  const top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y)),middle=(top+bottom)/2;
  const carried=d.nodes.filter(n=>n.attachTo?.startsWith(actor.id+'/'));
  const horizontal:Array<number>=[];
  for(let i=0;i<=32;i++)for(const n of [actor,...carried]){
    const a=n.type==='instance'?assets[n.asset!]:undefined,m=vectorWorldMatrix(n.id,scene,i/32*scene.durationMs,assets);
    const bounds=n===actor?[40,60,200,465]:a?[0,0,a.width,a.height]:n.type==='ellipse'?
      [-(n.rx??0),-(n.ry??0),n.rx??0,n.ry??0]:[0,0,n.width??n.x2??0,n.height??n.y2??0];
    for(const [x,y] of [[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[0],bounds[3]],[bounds[2],bounds[3]]])
      horizontal.push(vectorPoint(m,x!,y!).x);
  }
  const extent=Math.max(...horizontal.map(x=>Math.abs(x-d.width/2)));
  const zoom=camera.frames[0]!.scaleX??1;
  const fitted=carried.length?Math.max(1/zoom,Math.min(1,(d.width/2-24)/Math.max(1,extent))):1;
  const factor=fitted>1-1e-9?1:fitted;
  const newMiddle=d.height/2+(middle-d.height/2)*factor;
  let shift=newMiddle>=d.height*.4&&newMiddle<=d.height*.65?0:d.height*.55-newMiddle;
  if(d.height/2+(top-d.height/2)*factor+shift<d.height*.2||d.height/2+(bottom-d.height/2)*factor+shift>d.height*.92)shift=0;
  if(factor===1&&shift===0)return scene;
  return {...scene,vectorScene:{...d,tracks:d.tracks.map(t=>t===camera?{...t,frames:t.frames.map(f=>({...f,
    dx:d.width/2+((f.dx??0)-d.width/2)*factor,dy:d.height/2+((f.dy??0)-d.height/2)*factor+shift,
    scaleX:(f.scaleX??1)*factor,scaleY:(f.scaleY??1)*factor}))}:t)}};
}

/** A fixed actor shot derived from its actual world geometry, never a redraw. */
export function vectorSubjectCamera(stage:CanvasVectorScene,assets:Record<string,VectorDrawing>,raw:unknown,context?:CanvasStudioScene){
  if(!raw||typeof raw!=='object')throw new Error('Vector: invalid subject shot');
  const shot=raw as Record<string,unknown>;
  if(typeof shot.target==='string'&&(shot.target.includes('/')||shot.bounds!==undefined)){
    const [owner,part,...extra]=shot.target.split('/'),instance=stage.nodes.find(n=>n.id===owner&&n.type==='instance');
    if(extra.length||(part?!assets[instance?.asset||'']?.nodes.some(n=>n.id===part):!stage.nodes.some(n=>n.id===owner)))throw new Error('Vector: detail shot needs an existing instance part or scene object');
    const b=shot.bounds as Record<string,number>|undefined;
    if(!b||!['x','y','width','height'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])&&Math.abs(b[k]!)<=4096)||b.width!<=0||b.height!<=0)throw new Error('Vector: part detail needs finite local bounds');
    const world={...stage,tracks:stage.tracks.filter(t=>!/^camera-world(?:-\d+)?$/.test(t.target))};
    const scene={...context,durationMs:context?.durationMs??10000,vectorScene:world,vectorAssetLibrary:assets} as CanvasStudioScene;
    const points=[0,.5,1].flatMap(t=>{
      const m=vectorWorldMatrix(shot.target as string,scene,t*scene.durationMs,assets);
      return [[b.x!,b.y!],[b.x!+b.width!,b.y!],[b.x!,b.y!+b.height!],[b.x!+b.width!,b.y!+b.height!]].map(([x,y])=>vectorPoint(m,x!,y!));
    });
    const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y));
    return [{t:0,x:(left+right)/2,y:(top+bottom)/2,zoom:Math.max(1,Math.min(4,(stage.width-96)/Math.max(1,right-left),stage.height*.55/Math.max(1,bottom-top)))}];
  }
  const subject=stage.nodes.find(n=>n.id===shot.target&&n.type==='instance');
  if(typeof shot.target!=='string')throw new Error('Vector: vectorScene.shot needs camera format {target:"actor-id",height:0.25-0.7}; screenplay format {size,focus} belongs in the screenplay step, not the drawing');
  if(!subject)throw new Error('Vector: subject shot needs an existing actor instance');
  // Near-miss heights (0.18 instead of 0.25) are composition preferences, not
  // structural defects: clamp them so one number cannot abort a whole film.
  // The pixel review still judges whether the subject reads clearly.
  const asked=shot.height??.45;
  if(typeof asked!=='number'||!Number.isFinite(asked))throw new Error('Vector: invalid subject framing height');
  const fraction=Math.min(.7,Math.max(.25,asked));
  const asset=assets[subject.asset!]!;
  if(stage.ground||shot.include!==undefined)return physicalSubjectCamera(stage,assets,shot,subject,fraction,context);
  const width=subject.width??asset.width,height=subject.height??asset.height;
  let points=[[0,0],[width,0],[width,height],[0,height]];
  let current:VectorNode|undefined=subject;
  while(current){
    const n:VectorNode=current;
    const px=n.pivotX??0,py=n.pivotY??0,angle=(n.rotation??0)*Math.PI/180;
    points=points.map(([x,y])=>{
      const dx=(x!-px)*(n.scaleX??1),dy=(y!-py)*(n.scaleY??1);
      return [(n.x??0)+px+dx*Math.cos(angle)-dy*Math.sin(angle),(n.y??0)+py+dx*Math.sin(angle)+dy*Math.cos(angle)];
    });
    current=n.parent?stage.nodes.find(p=>p.id===n.parent):undefined;
    if(current?.type==='instance'){
      const parent=assets[current.asset!]!;
      points=points.map(([x,y])=>[x!*(current!.width??parent.width)/parent.width,y!*(current!.height??parent.height)/parent.height]);
    }
  }
  const xs=points.map(p=>p[0]!),ys=points.map(p=>p[1]!);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const zoom=stage.height*fraction/(maxY-minY);
  if(!Number.isFinite(zoom)||zoom>4&&asset.nodes.some(n=>n.id==='foot-r'))throw new Error('Vector: focal actor is too small for a readable close-up; enlarge its base stage design while keeping its feet on the support');
  return [{t:0,x:(minX+maxX)/2,y:(minY+maxY)/2,zoom:Math.max(1,Math.min(4,zoom))}];
}

/** Interpret the simple-puppet screenplay's shot sizes on the SAME world.
 * Only camera channels change. A later explicit repair is never overwritten. */
export function directVectorShot(scene:CanvasStudioScene,assets:Record<string,VectorDrawing>):CanvasStudioScene{
  const d=scene.vectorScene,direction=scene.vectorDirection;
  if(!d||!direction||scene.vectorFramingVersion===1||!d.nodes.some(n=>n.type==='instance'&&assets[n.asset!]?.nodes.some(p=>p.id==='puppet-root')))return scene;
  const cameras=new Set(d.nodes.filter(n=>/^camera-world(?:-\d+)?$/.test(n.id)).map(n=>n.id));
  const camera=d.nodes.find(n=>cameras.has(n.id)&&!n.parent);
  const world={...d,tracks:d.tracks.filter(t=>!cameras.has(t.target))};
  const context={...scene,vectorScene:world};
  const actor=(id:string)=>{const n=world.nodes.find(n=>n.id===id.split('/')[0]&&n.type==='instance');return n&&direction.visibleCast?.includes(n.id)!==false&&assets[n.asset!]?.nodes.some(p=>p.id==='head-group')?n:undefined;};
  const focus=actor(direction.shot.focus)||direction.shot.include.map(actor).find(Boolean);
  let frames;
  if(direction.shot.size==='wide')frames=[{t:0,x:d.width/2,y:d.height/2,zoom:1}];
  else if(direction.shot.size==='detail'||!focus){
    const reveal=direction.beats.find(b=>b.kind==='reveal');
    const target=reveal?.motionTargets.find(id=>world.nodes.some(n=>n.id===id)&&!actor(id))||direction.shot.focus;
    const node=world.nodes.find(n=>n.id===target),asset=node?.type==='instance'?assets[node.asset!]:undefined;
    const width=node?.bounds?.width??asset?.width??node?.width??(node?.groundAnchor?node.groundAnchor.x*2:0),height=node?.bounds?.height??asset?.height??node?.height??node?.groundAnchor?.y??0;
    if(!node||width<=0||height<=0)return scene;
    frames=vectorSubjectCamera(world,assets,{target,bounds:node.bounds??{x:0,y:0,width,height}},context);
  }else{
    const include=[...new Set([direction.shot.focus,...direction.shot.include])].filter(id=>id!==focus.id&&world.nodes.some(n=>n.id===id&&(n.type==='instance'||n.groundAnchor||n.width&&n.height))).slice(0,4);
    // Story purpose chooses a closer angle; "reaction" alone is not a reason
    // to enlarge the person. Both views retain the same full puppet and props.
    frames=vectorSubjectCamera(world,assets,{target:focus.id,height:direction.shot.framing==='close'?.44:.25,include},context);
  }
  const framed=frameVectorScene({...world,tracks:[]},frames);
  return {...scene,vectorFramingVersion:1,vectorScene:camera?{...world,tracks:[...world.tracks,{...framed.tracks.at(-1)!,target:camera.id}]}:{...framed,tracks:[...world.tracks,...framed.tracks]}};
}

/** Grounded acting shots fit evaluated travel and held props, rather than the
 * actor's old resting position. A fixed cut includes the entire performance. */
function physicalSubjectCamera(stage:CanvasVectorScene,assets:Record<string,VectorDrawing>,shot:Record<string,unknown>,subject:VectorNode,fraction:number,context?:CanvasStudioScene){
  const includes=shot.include??[];
  if(!Array.isArray(includes)||includes.length>4||includes.some(id=>typeof id!=='string'||!stage.nodes.some(n=>n.id===id)))throw new Error('Vector: shot include must name up to four existing scene objects');
  const world={...stage,tracks:stage.tracks.filter(t=>!/^camera-world(?:-\d+)?$/.test(t.target))};
  const scene={...context,durationMs:context?.durationMs??10000,vectorScene:world,vectorAssetLibrary:assets} as CanvasStudioScene;
  const carried=stage.nodes.filter(n=>n.attachTo?.startsWith(subject.id+'/')).map(n=>n.id);
  const targets=[...new Set([subject.id,...carried,...includes])];
  const body:Array<{x:number;y:number}>=[],all:Array<{x:number;y:number}>=[],primary:Array<{x:number;y:number}>=[];
  for(let i=0;i<=16;i++)for(const id of targets){
    const node=stage.nodes.find(n=>n.id===id)!,asset=node.type==='instance'?assets[node.asset!]:undefined;
    const human=asset?.nodes.some(n=>n.id==='head-group')&&asset.nodes.some(n=>n.id==='foot-r');
    const puppet=asset?.nodes.some(n=>n.id==='puppet-root');
    const folkChibi=human&&asset?.nodes.some(n=>n.id==='folk-collar');
    const bounds=node.bounds?[node.bounds.x,node.bounds.y,node.bounds.x+node.bounds.width,node.bounds.y+node.bounds.height]:asset?(human?(folkChibi?[20,0,220,465]:[40,60,200,465]):[0,0,asset.width,asset.height]):node.groundAnchor?
      [0,0,node.groundAnchor.x*2,node.groundAnchor.y]:[0,0,node.width??0,node.height??0];
    if(bounds[2]!<=bounds[0]!||bounds[3]!<=bounds[1]!)throw new Error(`Vector: shot context ${id} needs finite local bounds. Add bounds:{x:LOCAL_LEFT,y:LOCAL_TOP,width:WIDTH,height:HEIGHT} to this group; a groundAnchor is a contact point, not its bounding box. Keep the existing artwork and position unchanged`);
    const matrix=vectorWorldMatrix(id,scene,i/16*scene.durationMs,assets);
    let points=[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[0],bounds[3]],[bounds[2],bounds[3]]].map(([x,y])=>vectorPoint(matrix,x!,y!));
    // Native acting can extend far outside the resting asset canvas (a raised
    // pig or a reclining person). Fit evaluated bones and head, not that box.
    if(asset&&(human||puppet||asset.nodes.some(n=>n.id==='body-pose'))){
      const parts:Array<[string,number[]]>=puppet?
        [['head-group',[-66,-80,80,72]],['upper-body',[35,155,145,280]],['hand-l',[-17,-17,17,17]],['hand-r',[-17,-17,17,17]]]:human?
        [['upper-body',[58,175,182,370]],['head-group',folkChibi?[-64,-85,64,75]:[-50,-52,50,52]],['foot-l',[-22,-8,22,8]],['foot-r',[-22,-8,22,8]]]:
        [['body',[-115,-68,115,68]],['head-group',[-50,-72,73,45]],...['fl','fr','hl','hr'].map(side=>['hoof-'+side,[-18,-16,18,2]] as [string,number[]])];
      const posed=parts.flatMap(([part,b])=>{
        const m=vectorWorldMatrix(id+'/'+part,scene,i/16*scene.durationMs,assets);
        return [[b[0],b[1]],[b[2],b[1]],[b[0],b[3]],[b[2],b[3]]].map(([x,y])=>vectorPoint(m,x!,y!));
      });
      points=human||puppet?[...points,...posed]:posed;
    }
    // A reusable stall/house is still architecture. Treating every asset as
    // a partner forced reaction shots to fit a distant building and zoom out.
    const partner=asset?.nodes.some(n=>n.id==='head-group');
    all.push(...points);if(id===subject.id||carried.includes(id)||includes.includes(id)&&partner)primary.push(...points);if(id===subject.id)body.push(...points);
  }
  const bodyMinY=Math.min(...body.map(p=>p.y)),bodyMaxY=Math.max(...body.map(p=>p.y));
  const left=Math.min(...all.map(p=>p.x)),right=Math.max(...all.map(p=>p.x));
  // A contextual action view must retain its explicitly included setting.
  // Tight reactions still prioritize the actor/held prop rather than fitting
  // an entire house. Neither view changes any world geometry.
  const fitting=fraction<=.3&&includes.length?all:primary;
  const primaryLeft=Math.min(...fitting.map(p=>p.x)),primaryRight=Math.max(...fitting.map(p=>p.x));
  const top=Math.min(...fitting.map(p=>p.y)),bottom=Math.max(...fitting.map(p=>p.y));
  const y=fitting===all?(top+bottom)/2:(bodyMinY+bodyMaxY)/2,requested=stage.height*fraction/(bodyMaxY-bodyMinY);
  if(!Number.isFinite(requested)||requested>4&&assets[subject.asset!]!.nodes.some(n=>n.id==='foot-r'))throw new Error('Vector: focal actor is too small for a readable close-up');
  // Small props keep their real world size; use the maximum supported camera
  // magnification rather than rejecting a lamp/knife as an undersized actor.
  const desired=Math.min(4,requested);
  // Tight shots prioritize actor/held props and allow architecture to crop;
  // contextual shots retain their explicitly included setting via fitting.
  const zoom=Math.max(1,Math.min(desired,(stage.width-64)/(primaryRight-primaryLeft),(stage.height*.31)/Math.max(1,y-top),(stage.height*.5-40)/Math.max(1,bottom-y)));
  const half=(stage.width/2-32)/zoom;
  const x=Math.max(primaryRight-half,Math.min(primaryLeft+half,(left+right)/2));
  return [{t:0,x,y,zoom}];
}
