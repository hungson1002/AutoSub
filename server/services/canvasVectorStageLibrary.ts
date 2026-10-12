import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {vectorCourtyard} from './canvasVectorCourtyard';
import {vectorRoom} from './canvasVectorRoom';
import {vectorRiverbank} from './canvasVectorRiverbank';
import {illustratedPlace,type IllustratedPlace,type IllustratedLight} from './canvasVectorIllustratedPlace';
import type {VectorNode} from '../../shared/canvasVectorScene';

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
export const vectorStageLibrarySignature=createHash('sha256').update(JSON.stringify({boat,footprint,courtyard,landscapeCourtyard:vectorCourtyard({width:1280,height:720}),room:vectorRoom(),riverbank,landscapeRiverbank:vectorRiverbank({width:1280,height:720}),illustratedPlaces:['village','forest','waterside','street','corridor','rural-interior'].map(place=>illustratedPlace({place:place as IllustratedPlace})),componentVersion:26})).digest('hex');

/** Deck is an attachment group above the floor surface AND loose plank, so
 * floor clues inherit the boat transform and cannot hide under its planks.
 * Reusable location geometry, not a film: no narration, camera, clues or main
 * gestures. The director still owns the story, actors, shots and acting. */
export function expandVectorStageLibrary(data:Record<string,unknown>,frame?:{width:number;height:number}):Record<string,unknown>{
  const stages=data.vectorStages as Record<string,Record<string,unknown>>|undefined;
  if(!stages||!Object.values(stages).some(s=>s?.template!==undefined))return data;
  const assets={...(data.vectorAssets||{}) as Record<string,unknown>};
  const supplied=new Set(Object.keys(assets));
  const expanded=Object.fromEntries(Object.entries(stages).map(([id,raw])=>{
    if(raw.template===undefined)return [id,raw];
    if(!['folk-river-boat','folk-courtyard','folk-room','folk-riverbank','illustrated-place'].includes(String(raw.template)))throw new Error('Vector: unknown stage component');
    const isCourtyard=raw.template==='folk-courtyard',isRiverbank=raw.template==='folk-riverbank',isIllustrated=raw.template==='illustrated-place';
    if(isIllustrated&&(!['village','forest','waterside','street','corridor','rural-interior'].includes(String(raw.place))||raw.light!==undefined&&!['day','dusk','night'].includes(String(raw.light))||raw.seed!==undefined&&(!Number.isInteger(raw.seed)||Math.abs(raw.seed as number)>99999)))throw new Error('Vector: illustrated-place needs a supported place, light and integer seed');
    const location=isIllustrated?illustratedPlace({place:raw.place as IllustratedPlace,light:raw.light as IllustratedLight|undefined,seed:raw.seed as number|undefined,view:raw.view as 'eye-level'|'elevated'|undefined,finish:raw.finish as 'clean'|'handdrawn'|undefined,setting:raw.setting as 'residential'|'market'|undefined},frame):raw.template==='folk-room'?vectorRoom(frame):isRiverbank&&frame&&frame.width>frame.height?vectorRiverbank(frame):isRiverbank?riverbank:isCourtyard&&frame&&frame.width>frame.height?vectorCourtyard(frame):isCourtyard?courtyard:boat;
    for(const [name,value] of Object.entries({...location.assets,...(location===boat?{'folk-wet-footprint':footprint}:{})})){
      if(supplied.has(name))throw new Error('Vector: built-in asset identities are read-only');
      assets[name]=value;
    }
    const base=structuredClone(location.stage),cast=raw.cast as Record<string,string>|undefined;
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
      const depthSlots=[[.18,1040,120],[.36,920,100],[.46,870,90],[.64,930,105],[.78,1000,115],[.68,840,85],[.42,1220,145],[.74,1240,152]];
      for(const [index,value] of raw.extras.entries()){
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Vector: invalid background actor');
        const suppliedExtra=value as Record<string,unknown>,slot=depthSlots[index]!;
        // Omitted placement on the native wide market uses a shared depth
        // layout. The preview and AI pipeline both use this owning layer.
        // Explicit positions stay authoritative; no per-shot actor resizing.
        const e=wideMarket?{x:left+(right-left)*slot[0]!,footY:slot[1]!,height:slot[2]!,...suppliedExtra}:suppliedExtra;
        const asset=assets[String(e.asset)] as Record<string,unknown>|undefined;
        if(typeof e.id!=='string'||! /^[\w-]{1,100}$/.test(e.id)||ids.has(e.id)||typeof e.asset!=='string'||!asset||
          !(asset.rig==='simple-puppet'||Array.isArray(asset.nodes)&&asset.nodes.some((n:{id?:string})=>n.id==='puppet-root')))
          throw new Error('Vector: background actors need distinct IDs and an existing compact cast asset');
        if(typeof e.x!=='number'||!Number.isFinite(e.x)||e.x<left-100||e.x>right||typeof e.footY!=='number'||!Number.isFinite(e.footY)||e.footY<400||e.footY>(wideMarket?1280:1100)||
          typeof e.height!=='number'||!Number.isFinite(e.height)||e.height<60||e.height>330)throw new Error('Vector: background actor placement must use local x, footY and height');
        ids.add(e.id);
        const width=typeof asset.width==='number'?asset.width:180,height=typeof asset.height==='number'?asset.height:280;
        // Feet retain their authored depth plane; only the main acting cast is
        // snapped to ground.y. Background figures share the location's world.
        const extra={id:e.id,type:'instance',asset:e.asset,x:e.x,y:e.footY-e.height,width:e.height*width/height,height:e.height,
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
      base.nodes.push(...raw.nodes.map(value=>{
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Vector: invalid static stage object');
        const node=value as VectorNode;
        return {...node,...(!node.parent&&base.ground?.parent?{parent:base.ground.parent}:{})};
      }));
    }
    return [id,base];
  }));
  return {...data,vectorAssets:assets,vectorStages:expanded};
}
