import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {vectorCourtyard} from './canvasVectorCourtyard';
import {vectorRoom} from './canvasVectorRoom';
import {vectorRiverbank} from './canvasVectorRiverbank';
import {illustratedPlace,type IllustratedPlace,type IllustratedLight} from './canvasVectorIllustratedPlace';
import type {VectorNode} from '../../shared/canvasVectorScene';
import {FOLK_INK_STYLE,APPROVED_FOLK_STYLE,handInkDrawing} from '../../shared/canvasVectorInk';
import {lockFolkInkAsset} from '../../shared/canvasVectorStyleLock';
import {normalizeVectorAssets} from '../../shared/canvasVectorScene';
import {approvedFolkSourceHash,approvedFolkWomanSourceHash} from '../../shared/canvasVectorApprovedArt';
import {approvedCourtyardSourceHash,type CourtyardLight} from './canvasVectorApprovedCourtyard';
import {natureScenery,natureLayout,NATURE_SCENERY_VERSION} from './canvasSceneryNature';
import {settingScenery,settingLayout,SETTING_SCENERY_VERSION} from './canvasScenerySetting';
import {REFERENCE_SETTING_PLACES,REFERENCE_SETTING_VERSION} from './canvasSceneryReference';

const boat=JSON.parse(readFileSync(new URL('../assets/vector-styles/folk-horror/folk-river-boat.json',import.meta.url),'utf8'));
const courtyard=vectorCourtyard();
const riverbank=vectorRiverbank();
// Approved heel/sole/toes silhouette, reusable at any placement/shot scale.
const footprint={width:24,height:20,nodes:[
  {id:'sole',type:'path',d:'M 10 18 C 6 16 8 13 6 10 C 3 5 8 4 12 5 C 18 4 20 8 17 11 C 14 13 16 16 14 18 Q 12 20 10 18 Z',fill:'#223e38'},
  {id:'heel',type:'path',d:'M 10 17 Q 9 15 10 14',fill:'none',stroke:'#69877a',strokeWidth:.6},
  ...[-7,-4,-1,2,5].map((x,i)=>({id:`toe-${i}`,type:'ellipse',x:x+12,y:3,rx:i?1.5:2,ry:i?1.4:1.8,fill:'#223e38'})),
]};
// A new component must not silently reuse a plan containing its old geometry.
// Voice/audio caches and every older checkpoint remain intact.
export const vectorStageLibrarySignature=createHash('sha256').update(JSON.stringify({boat,footprint,courtyard,landscapeCourtyard:vectorCourtyard({width:1280,height:720}),approvedCourtyard:vectorCourtyard({width:1280,height:720},{artStyle:FOLK_INK_STYLE,light:'day'}),nature:{version:NATURE_SCENERY_VERSION,woodland:natureScenery({water:'none',atmosphere:'fog'}),waterfall:natureScenery({water:'waterfall'}),bridge:natureScenery({terrain:'gorge',bridge:true}),valley:natureScenery({terrain:'cliffs',water:'river',vegetation:'pine',light:'night'})},room:vectorRoom(),riverbank,landscapeRiverbank:vectorRiverbank({width:1280,height:720}),illustratedPlaces:['village','forest','waterside','street','corridor','rural-interior'].map(place=>illustratedPlace({place:place as IllustratedPlace})),artStyle:FOLK_INK_STYLE,approvedFolkSourceHash,approvedFolkWomanSourceHash,approvedCourtyardSourceHash,settings:{version:SETTING_SCENERY_VERSION,riverside:settingScenery({place:'riverside'}),village:settingScenery({place:'village',atmosphere:'mist',smoke:true}),market:settingScenery({place:'market'}),room:settingScenery({place:'room'})},componentVersion:58})).update(JSON.stringify({referenceSettings:REFERENCE_SETTING_VERSION,places:REFERENCE_SETTING_PLACES.map(place=>settingScenery({place}))})).digest('hex');

/** Deck is an attachment group above the floor surface AND loose plank, so
 * floor clues inherit the boat transform and cannot hide under its planks.
 * Reusable location geometry, not a film: no narration, camera, clues or main
 * gestures. The director still owns the story, actors, shots and acting. */
export function expandVectorStageLibrary(data:Record<string,unknown>,frame?:{width:number;height:number},storyCast:readonly string[]=[]):Record<string,unknown>{
  const stages=data.vectorStages as Record<string,Record<string,unknown>>|undefined;
  if(!stages||!Object.values(stages).some(s=>s?.template!==undefined))return data;
  const assets={...(data.vectorAssets||{}) as Record<string,unknown>};
  const stageAliases=new Map<string,Record<string,string>>();
  const supplied=new Set(Object.keys(assets));
  const expanded=Object.fromEntries(Object.entries(stages).map(([id,raw])=>{
    if(raw.template===undefined)return [id,raw];
    if(!['folk-river-boat','folk-courtyard','folk-room','folk-riverbank','illustrated-place','nature-landscape','folk-setting'].includes(String(raw.template)))throw new Error('Vector: unknown stage component');
    const isCourtyard=raw.template==='folk-courtyard',isRiverbank=raw.template==='folk-riverbank',isIllustrated=raw.template==='illustrated-place';
    const approvedYard=isCourtyard&&raw.artStyle===FOLK_INK_STYLE;
    const isNature=raw.template==='nature-landscape';
    const isSetting=raw.template==='folk-setting';
    const setting=isSetting?settingScenery(settingLayout(raw),frame):undefined;
    if(isCourtyard&&raw.light!==undefined&&!['day','dusk','night'].includes(String(raw.light)))throw new Error('Vector: courtyard light needs day, dusk or night');
    if(isIllustrated&&(!['village','forest','waterside','street','corridor','rural-interior'].includes(String(raw.place))||raw.light!==undefined&&!['day','dusk','night'].includes(String(raw.light))||raw.seed!==undefined&&(!Number.isInteger(raw.seed)||Math.abs(raw.seed as number)>99999)||raw.festival!==undefined&&!['none','tet'].includes(String(raw.festival))))throw new Error('Vector: illustrated-place needs a supported place, light and integer seed');
    const location=setting??(isNature?natureScenery(natureLayout(raw),frame):isIllustrated?illustratedPlace({place:raw.place as IllustratedPlace,light:raw.light as IllustratedLight|undefined,seed:raw.seed as number|undefined,view:raw.view as 'eye-level'|'elevated'|undefined,finish:raw.finish as 'clean'|'handdrawn'|undefined,setting:raw.setting as 'residential'|'market'|undefined,festival:(raw.festival as 'none'|'tet'|undefined),artStyle:raw.artStyle===FOLK_INK_STYLE?FOLK_INK_STYLE:undefined},frame):raw.template==='folk-room'?vectorRoom(frame):isRiverbank&&frame&&frame.width>frame.height?vectorRiverbank(frame):isRiverbank?riverbank:approvedYard?vectorCourtyard(frame,{artStyle:FOLK_INK_STYLE,light:raw.light as CourtyardLight|undefined}):isCourtyard&&frame&&frame.width>frame.height?vectorCourtyard(frame):isCourtyard?courtyard:boat);
    for(const [name,value] of Object.entries({...location.assets,...(location===boat?{'folk-wet-footprint':footprint}:{})})){
      if(supplied.has(name))throw new Error('Vector: built-in asset identities are read-only');
      const native=value as Record<string,unknown>;
      const frozenPaint=Array.isArray(native.nodes)&&(native.nodes as Array<{id?:string}>).some(n=>n.id===APPROVED_FOLK_STYLE);
      // Native accepted paint already contains filled pen-pressure outlines.
      // The custom-AI style lock would add a second stroke to every straw mark.
      assets[name]=raw.artStyle===FOLK_INK_STYLE&&native.rig!=='simple-human'&&!frozenPaint?lockFolkInkAsset(value):value;
    }
    const base=structuredClone(location.stage),cast=raw.cast as Record<string,string>|undefined;
    // Semantic aliases own the actual painted subtree, not an empty fake
    // target or a second landscape redrawn to satisfy a screenplay name.
    const alias=(id:string,target:string,bounds?:VectorNode['bounds'])=>{
      if(base.nodes.some((n:VectorNode)=>n.id===id))return;
      const owner=base.nodes.find((n:VectorNode)=>n.id===target);if(!owner)return;
      if(owner.type!=='group'){
        const extent=owner.type==='ellipse'?{x:owner.x!-owner.rx!,y:owner.y!-owner.ry!,width:owner.rx!*2,height:owner.ry!*2}:owner.bounds;
        base.nodes.splice(base.nodes.indexOf(owner),0,{id,type:'group',parent:owner.parent,bounds:bounds??extent});
        owner.parent=id;return;
      }
      const children=base.nodes.filter((n:VectorNode)=>n.parent===target);
      base.nodes.push({id,type:'group',parent:target,bounds:owner.bounds??bounds,...(owner.pivotX!==undefined?{pivotX:owner.pivotX,pivotY:owner.pivotY,pivotSpace:owner.pivotSpace}:{})});
      for(const child of children)child.parent=id;
    };
    if(isNature){
      alias('river-water','stream');alias('river-bank','stream-banks',{x:0,y:410,width:1280,height:310});
      if(raw.vegetation==='bamboo')alias('bamboo-grove','forest-front');
      if(raw.vegetation==='pine'){alias('pine-trees','forest-front');alias('pine-tree','pine-trees');}
      alias('hills-far','forest-backdrop',{x:0,y:70,width:1280,height:365});
      alias('fern-bushes','bank-plants',{x:0,y:450,width:1280,height:270});
      alias('bamboo-river','river-water');alias('shore-rocks','river-stones');alias('moon-light','moon');
      alias('pine-clearing','clearing');alias('gentle-hills','hills-far');alias('mossy-rocks','river-stones');
    }
    if(isSetting){
      if(raw.place==='room'||raw.place==='corridor'){
        alias('room-floor','terrain',{x:0,y:549,width:1280,height:171});alias('room-wall','walls');
        alias('low-table','table');alias('oil-lamp','lamp');alias('window-light','window');alias('lamp-glow','lamp-flame');
      }else{
        alias('house-mid','house-far');
        alias('tree',base.nodes.some((n:VectorNode)=>n.id==='village-tree-left')?'village-tree-left':'tree-left');
        alias('door','house-far-door');
        alias('market-lane','terrain',{x:350,y:427,width:665,height:293});
        alias('village-far','built-layout',{x:70,y:260,width:1130,height:370});
        alias('wooden-stalls','built-layout');alias('woven-baskets','market');alias('distant-cottages','house-far');alias('market-ground','terrain');
        if(raw.place==='village-wide')alias('village','reference-layout',{x:0,y:0,width:1280,height:720});
        if(raw.place==='shrine'){
          alias('table','altar-front-table');
          alias('curtain','scenery-curtain-90');
          alias('lamp','shrine-candle-light-0');
        }
      }
    }
    if(raw.artStyle===FOLK_INK_STYLE&&location===boat&&(!cast?.lam||!cast?.old))
      throw new Error('Vector: folk-ink boat needs compact simple-puppet cast bindings for lam and old');
    // This attachment group owns floor clues. Its bounds give the director a
    // stable deck context without adding another painted support surface.
    const deck=base.nodes.find((n:{id:string})=>n.id==='deck');if(deck){deck.width=640;deck.height=90;}
    if(isIllustrated&&!cast?.person)throw new Error('Vector: illustrated-place requires the user-designed person cast binding');
    if(cast){
      const slots=location===boat?['lam','old']:['person'];
      // A redundant binding for an explicitly declared extra is unambiguous.
      // Keep rejecting unknown slots and mismatched asset ownership.
      const declaredExtras=Array.isArray(raw.extras)?raw.extras as Array<{id?:string;asset?:string}>:[];
      if(typeof cast!=='object'||Array.isArray(cast)||Object.keys(cast).some(k=>!slots.includes(k)&&!declaredExtras.some(e=>e?.id===k&&e.asset===cast[k])))throw new Error('Vector: invalid stage cast slots');
      for(const n of base.nodes)if(cast[n.id])n.asset=cast[n.id];
    }
    if(raw.extras!==undefined){
      if(location===boat||!Array.isArray(raw.extras)||raw.extras.length>8)throw new Error('Vector: stage extras need up to eight grounded background actors');
      const ids=new Set(base.nodes.map((n:{id:string})=>n.id));
      const world=base.nodes.find((n:{id:string})=>n.id===base.ground?.parent),worldScale=world?.scaleX??1;
      const left=world?-(world.x??0)/worldScale:0,right=left+base.width/worldScale;
      const wideMarket=isIllustrated&&raw.place==='village'&&raw.setting==='market'&&raw.finish==='handdrawn'&&raw.view!=='eye-level';
      // Extras without coordinates get the native depth spread, but only when
      // the stage itself is elevated (same rule as the painter: explicit
      // elevated view, or handdrawn market without a view). Other stages
      // still need explicit local placement.
      const autoSpread=isIllustrated&&raw.place==='village'
        &&(raw.view==='elevated'||(raw.view===undefined&&raw.finish==='handdrawn'&&raw.setting==='market'));
      const depthSlots=raw.artStyle===FOLK_INK_STYLE&&autoSpread&&!wideMarket
        ?[[.25,940,100],[.38,985,105],[.52,910,90],[.65,970,105],[.79,1020,115],[.70,905,85],[.43,1070,120],[.75,1080,120]]
        :[[.18,1040,120],[.36,920,100],[.46,870,90],[.64,930,105],[.78,1000,115],[.68,840,85],[.42,1220,145],[.74,1240,152]];
      for(const [index,value] of raw.extras.entries()){
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Vector: invalid background actor');
        const suppliedExtra=value as Record<string,unknown>,slot=depthSlots[index]!;
        // Omitted placement on the native wide market uses a shared depth
        // layout. The preview and AI pipeline both use this owning layer.
        // Explicit positions stay authoritative; no per-shot actor resizing.
        const e=autoSpread?{x:left+(right-left)*slot[0]!,footY:slot[1]!,height:slot[2]!,...suppliedExtra}:suppliedExtra;
        const asset=assets[String(e.asset)] as Record<string,unknown>|undefined;
        if(typeof e.id!=='string'||! /^[\w-]{1,100}$/.test(e.id)||ids.has(e.id)||typeof e.asset!=='string'||!asset||
          !(asset.rig==='simple-puppet'||asset.rig==='simple-chicken'||asset.rig==='simple-snake'||Array.isArray(asset.nodes)&&asset.nodes.some((n:{id?:string})=>n.id==='puppet-root')))
          throw new Error('Vector: background actors need distinct IDs and an existing compact cast asset');
        // Barnyard rigs stage small by design (a hen is ~0.15 of a person);
        // people keep the 60px minimum so crowds never shrink to dots.
        const minHeight=asset.rig==='simple-chicken'||asset.rig==='simple-snake'?20:60;
        if(typeof e.x!=='number'||!Number.isFinite(e.x)||e.x<left-100||e.x>right||typeof e.footY!=='number'||!Number.isFinite(e.footY)||e.footY<400||e.footY>((wideMarket||autoSpread)?1280:1100)||
          typeof e.height!=='number'||!Number.isFinite(e.height)||e.height<minHeight||e.height>330)throw new Error('Vector: background actor placement must use local x, footY and height; for a market instead declare setting market with finish handdrawn and OMIT coordinates for the native auto-spread');
        ids.add(e.id);
        const rigDims=asset.rig==='simple-chicken'?{width:240,height:200}:asset.rig==='simple-snake'?{width:360,height:120}:undefined;
        const width=typeof asset.width==='number'?asset.width:rigDims?.width??180,height=typeof asset.height==='number'?asset.height:rigDims?.height??280;
        // Feet retain their authored depth plane; only the main acting cast is
        // snapped to ground.y. Background figures share the location's world.
        let actorHeight=e.height;
        if(raw.artStyle===FOLK_INK_STYLE&&isIllustrated&&raw.place==='village'&&raw.view==='elevated'&&!rigDims){
          const hero=base.nodes.find((n:{id:string})=>n.id==='person'),floor=base.ground?.y??900;
          const depth=Math.max(.5,Math.min(1.8,(e.footY-400)/(floor-400)));
          const expected=(hero?.height??80)*depth*(asset.age==='child'?.72:1);
          actorHeight=Math.max(expected*.85,Math.min(expected*1.08,actorHeight));
        }
        const extra={id:e.id,type:'instance',asset:e.asset,x:e.x,y:e.footY-actorHeight,width:actorHeight*width/height,height:actorHeight,
          groundAnchor:{x:width/2,y:height},groundOffsetY:e.footY-(base.ground?.y??980),...(base.ground?.parent?{parent:base.ground.parent}:{})};
        const front=base.nodes.findIndex((n:{id:string})=>n.id==='person');
        base.nodes.splice(front<0?base.nodes.length:front,0,extra);
      }
      if(wideMarket){
        const extraIds=new Set((raw.extras as Array<{id:string}>).map(e=>e.id));
        const sceneNodes=base.nodes as VectorNode[];
        const actors=sceneNodes.filter(n=>n.id==='person'||extraIds.has(n.id));
        const ordered=[...actors].sort((a,b)=>(a.groundOffsetY??0)-(b.groundOffsetY??0));
        const positions=sceneNodes.map((n,i)=>actors.includes(n)?i:-1).filter(i=>i>=0);
        positions.forEach((at,i)=>{sceneNodes[at]=ordered[i]!;});
      }
    }
    if(raw.tracks!==undefined||raw.camera!==undefined||raw.shot!==undefined)throw new Error('Vector: add stage actions and framing in individual shots');
    // Story-specific static objects belong to the reusable world. Requiring
    // the illustrator to copy them into every cut made clues disappear and
    // rejected otherwise valid native sets. Normalization still rejects ID
    // collisions, unsafe shapes, missing assets and cyclic parents.
    if(raw.nodes!==undefined){
      if(!Array.isArray(raw.nodes))throw new Error('Vector: stage additions must be an array of static nodes');
      if((isSetting||raw.sceneryPolicy==='approved-v1')&&raw.nodes.length)
        throw new Error('Vector: approved scenery does not accept raw stage overlays. Reuse native objects; add a necessary new story prop with objects:[{id,asset,support:"floor"|"table"|"stall-left"|"stall-right",height:60,at:0}]. Do not copy scenery from the rejected draft.');
      base.nodes.push(...raw.nodes.map(value=>{
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Vector: invalid static stage object');
        const node=value as VectorNode;
        const footY=(value as Record<string,unknown>).footY;
        if(footY!==undefined){
          if(node.type!=='instance'||typeof footY!=='number'||!Number.isFinite(footY)||!(node.height!>0)||node.y!==undefined)
            throw new Error('Vector: stage footY needs an instance with height and no competing y');
          const asset=normalizeVectorAssets({placed:assets[node.asset!] }).placed;
          if(!asset)throw new Error('Vector: unknown grounded stage asset');
          return {...node,y:footY-node.height!,groundAnchor:{x:asset.width/2,y:asset.height},groundOffsetY:footY-base.ground!.y,...(!node.parent&&base.ground?.parent?{parent:base.ground.parent}:{})};
        }
        return {...node,...(!node.parent&&base.ground?.parent?{parent:base.ground.parent}:{})};
      }));
    }
    if(raw.objects!==undefined){
      if(!isNature&&!isSetting||!Array.isArray(raw.objects)||raw.objects.length>12)throw new Error('Vector: supported objects require nature-landscape or folk-setting');
      const supports=setting?.supports??{floor:{x:640,y:620,width:1100}};
      for(const value of raw.objects){
        const p=value as Record<string,unknown>;
        if(!p||typeof p!=='object'||Object.keys(p).some(k=>!['id','asset','support','height','at'].includes(k))||typeof p.id!=='string'||!/^[\w-]{1,100}$/.test(p.id))throw new Error('Vector: invalid supported object');
        if(base.nodes.some((n:VectorNode)=>n.id===p.id))throw new Error(`Vector: invalid supported object: ${p.id} already exists in the native scenery. Remove this entry from objects and reuse the existing ${p.id}; do not redraw or duplicate it`);
        const support=supports[String(p.support) as keyof typeof supports],asset=normalizeVectorAssets({prop:assets[String(p.asset)]}).prop;
        const height=p.height,at=p.at??0;
        if(!support||!asset||typeof height!=='number'||!Number.isFinite(height)||height<8||height>(p.support==='floor'?200:90)||typeof at!=='number'||!Number.isFinite(at)||Math.abs(at)>1)throw new Error('Vector: story object needs a real named support, bounded height and at between -1 and 1');
        const width=height*asset.width/asset.height;if(width>support.width)throw new Error('Vector: story object is wider than its real support');
        const anchor={x:asset.width/2,y:asset.ground?.y??asset.height};
        base.nodes.push({id:p.id,type:'instance',asset:String(p.asset),parent:base.ground!.parent,x:support.x+at*(support.width-width)/2-width/2,y:support.y-height*anchor.y/asset.height,width,height,groundAnchor:anchor,groundOffsetY:support.y-base.ground!.y});
        base.ground!.targets.push({target:p.id});
      }
    }
    // Native geometry owns the surface. Keep explicit support declarations for
    // new story objects instead of silently dropping them during expansion.
    if(raw.ground!==undefined){
      const ground=raw.ground as Record<string,unknown>;
      if(!ground||typeof ground!=='object'||Array.isArray(ground)
        ||ground.y!==undefined&&ground.y!==base.ground?.y
        ||ground.parent!==undefined&&ground.parent!==base.ground?.parent
        ||!Array.isArray(ground.targets))throw new Error('Vector: native stage ground may only add targets on its existing surface');
      base.ground={...base.ground,targets:[...(base.ground?.targets||[]),...ground.targets]};
    }
    // Native slots are implementation names. Bind a unique screenplay actor
    // through its cast asset instead of forcing the writer to name everyone
    // "person". Apply the binding to references, never narration or artwork.
    const aliases:Record<string,string>={};
    if(storyCast.length&&cast)for(const [slot,asset] of Object.entries(cast))
      if(slot!==asset&&storyCast.includes(asset)&&!storyCast.includes(slot)&&base.nodes.some((n:VectorNode)=>n.id===slot&&n.type==='instance')&&!base.nodes.some((n:VectorNode)=>n.id===asset))aliases[slot]=asset;
    stageAliases.set(id,aliases);
    const bound=Object.keys(aliases).length?bindStageReferences(base,aliases) as typeof base:base;
    // Imported pressure contours are already the approved ink, like the cast.
    // Running the generic bender a second time deforms the accepted artwork.
    return [id,raw.artStyle===FOLK_INK_STYLE&&!approvedYard&&!isNature&&!isSetting?{...bound,nodes:handInkDrawing(bound).nodes}:bound];
  }));
  const scenes=Array.isArray(data.scenes)?data.scenes.map(value=>{
    const scene=value as {vectorScene?:{stage?:string};vectorBeats?:unknown};
    const aliases=stageAliases.get(scene.vectorScene?.stage??'');
    return aliases&&Object.keys(aliases).length?{...scene,vectorScene:bindStageReferences(scene.vectorScene,aliases),vectorBeats:bindStageReferences(scene.vectorBeats,aliases)}:scene;
  }):data.scenes;
  return {...data,vectorAssets:assets,vectorStages:expanded,scenes};
}

function bindStageReferences(value:unknown,aliases:Record<string,string>,key=''):unknown{
  if(Array.isArray(value))return value.map(v=>bindStageReferences(v,aliases,key));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,bindStageReferences(v,aliases,k)]));
  if(typeof value==='string'&&['id','target','targets','include','parent','attachTo','actor','to','toward','focus','prop'].includes(key))
    for(const [slot,actor] of Object.entries(aliases))if(value===slot||value.startsWith(slot+'/'))return actor+value.slice(slot.length);
  return value;
}
