import type {
  CanvasPropVariant,
  CanvasStudioObject,
  CanvasStudioProject,
  CanvasStudioScene,
} from './canvasAnimationStudio';

export type CanvasProceduralMaterial =
  | 'wood' | 'metal' | 'paper' | 'glass' | 'fabric' | 'stone'
  | 'ceramic' | 'organic' | 'shadow' | 'mixed';

export type CanvasProceduralAge = 'clean' | 'used' | 'worn' | 'decayed';

export type CanvasProceduralAssetProfile = {
  /** Stable identity used to keep the same authored design across scenes. */
  identity: string;
  seed: number;
  material: CanvasProceduralMaterial;
  age: CanvasProceduralAge;
  /** 0..1: internal construction/detail density. */
  detail: number;
  /** 0..1: edge wear, chips, scratches, tarnish. */
  wear: number;
  /** 0..1: organic asymmetry; never frame-random. */
  asymmetry: number;
  /** Base ink width in local 100-unit asset coordinates. */
  lineWeight: number;
  /** 0..1 amount of deterministic grain/hatching. */
  grain: number;
  /** 0..1 amount of small hardware / seams / fasteners. */
  hardware: number;
  /** Warm/cool highlight used by material-specific details. */
  highlight: string;
  shadow: string;
};

const norm=(value:string|undefined)=>(value||'')
  .normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/g,'d')
  .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
  .slice(0,72);

function hash32(value:string){
  let h=2166136261;
  for(let i=0;i<value.length;i++){
    h^=value.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return h>>>0;
}

const PERSISTENT_STAGE_VARIANTS=new Set<CanvasPropVariant>([
  'bed','table','chair','box','window','door','lantern','fire','basket','stairs','barrel',
]);

const MATERIAL_BY_VARIANT:Partial<Record<CanvasPropVariant,CanvasProceduralMaterial>>={
  tree:'organic',house:'wood',fire:'organic',barrel:'wood',shield:'metal',sword:'metal',
  flag:'fabric',mountain:'stone',book:'paper',bridge:'wood',clock:'mixed',lightbulb:'glass',
  ghost:'shadow',cart:'wood',box:'wood',door:'wood',window:'glass',bowl:'ceramic',
  pipe:'wood',bamboo:'organic',table:'wood',chair:'wood',lantern:'mixed',bed:'mixed',
  basket:'organic',rope:'organic',stairs:'wood',floorboard:'wood',note:'paper',phone:'mixed',
  oar:'wood',teapot:'ceramic',sandals:'organic',pig:'organic','pig-hoof':'organic',
  dog:'organic','demon-dog':'organic',
};

const DEFAULT_DESIGN:Partial<Record<CanvasPropVariant,string>>={
  door:'old timber door; visible frame and panel construction; believable hinges/latch/knob; subtle grain, edge wear and uneven hand-built geometry',
  table:'sturdy wooden table; readable top thickness; four-leg construction or visible near legs; cross-brace/grain where framing allows; grounded floor contact',
  chair:'simple wooden chair with coherent back, seat thickness and legs; hand-built asymmetry; no icon geometry',
  lantern:'old practical lantern; metal cage, glass chamber, handle, burner and base; tarnished hardware; warm local light only',
  note:'handled paper clue; irregular/torn edges, fold memory, slight staining and strong readable ink; no pristine rectangle',
  phone:'believable small phone with bezel, glass screen, speaker/camera detail and restrained UI marks; not a generic rounded rectangle',
  ghost:'ambiguous human shadow silhouette; readable head-neck-shoulder-torso anatomy; subordinate cool rim only; never cute or icon-like',
  box:'worn wooden box with lid thickness, joinery and edge wear',
  barrel:'wooden staves, metal/rope hoops, grain and believable volume',
  bed:'simple bed with coherent mattress, frame, pillow and grounded legs; consistent perspective',
  window:'window frame with sill, mullions, glass depth and subtle reflection; architecture not floating prop',
  stairs:'wooden stair run with tread thickness and support structure; coherent perspective',
  basket:'woven basket with rim, handle and alternating weave rhythm',
  floorboard:'aged timber plank with grain, gaps, nail heads and wear',
};

function defaultMaterial(object:CanvasStudioObject):CanvasProceduralMaterial{
  if(object.kind==='prop'&&object.variant)return MATERIAL_BY_VARIANT[object.variant]||'mixed';
  if(object.kind==='character')return 'fabric';
  if(object.kind==='ship'||object.kind==='stake')return 'wood';
  return 'mixed';
}

function inferredAge(object:CanvasStudioObject,scene?:CanvasStudioScene):CanvasProceduralAge{
  const cue=norm([object.label,object.designNotes,scene?.name,scene?.visualBrief,scene?.narration].filter(Boolean).join(' '));
  if(/(?:abandoned|old|ancient|rotten|decay|muc|cu-ky|cu-nat|bo-hoang|hanh-lang|kinh-di|horror)/.test(cue))return 'decayed';
  if(/(?:worn|used|weathered|cu|xuoc|mon|am-moc|wet|mud)/.test(cue))return 'worn';
  if(/(?:new|clean|modern|moi|sach)/.test(cue))return 'clean';
  return 'used';
}

function detailFor(object:CanvasStudioObject,scene?:CanvasStudioScene){
  const close=scene?.camera?.shot==='close-up'||scene?.camera?.shot==='extreme-close-up'||scene?.template==='prop-focus';
  if(object.role==='focal'||object.sizeClass==='hero'||close)return .96;
  if(object.role==='support'||object.sizeClass==='large'||object.sizeClass==='medium')return .78;
  return .58;
}

export function canvasProceduralAssetIdentity(object:CanvasStudioObject,scene?:CanvasStudioScene){
  if(object.assetKey)return object.assetKey;
  if(object.kind==='character')return `character:${norm(object.characterKey||object.label||object.id)}`;
  if(object.kind==='prop'){
    const stage=norm(scene?.stageId||scene?.backgroundRef||scene?.background||'stage');
    const role=object.role==='focal'?'focal':'set';
    return `${role}:${stage}:${object.variant||'prop'}:${norm(object.label||object.id)}`;
  }
  return `${object.kind}:${norm(object.label||object.id)}`;
}

export function resolveCanvasProceduralAssetProfile(
  object:CanvasStudioObject,
  scene?:CanvasStudioScene,
):CanvasProceduralAssetProfile{
  const identity=canvasProceduralAssetIdentity(object,scene);
  const seed=hash32(identity);
  const material=defaultMaterial(object);
  const age=inferredAge(object,scene);
  const detail=detailFor(object,scene);
  const ageWear=age==='decayed'?.88:age==='worn'?.68:age==='used'?.38:.12;
  const materialGrain=material==='wood'?.78:material==='paper'?.46:material==='organic'?.42:material==='metal'?.2:.28;
  const hardware=material==='metal'||material==='mixed'?.78:material==='wood'?.42:.18;
  const variation=(seed%997)/997;
  return {
    identity,seed,material,age,detail,
    wear:Math.min(1,ageWear*(.88+variation*.22)),
    asymmetry:.18+detail*.18+variation*.12,
    lineWeight:1.15+detail*.6,
    grain:Math.min(1,materialGrain*(.7+detail*.42)),
    hardware:Math.min(1,hardware*(.72+detail*.38)),
    highlight:material==='metal'?'#b8aa91':material==='glass'?'#bcd0ce':material==='paper'?'#e9d8b4':'#b9956d',
    shadow:material==='shadow'?'#0d1415':'#332923',
  };
}

function defaultDesignNotes(object:CanvasStudioObject){
  if(object.kind==='prop'&&object.variant)return DEFAULT_DESIGN[object.variant];
  if(object.kind==='ship')return 'coherent vessel construction; believable hull/deck perspective; designed silhouette; visible material cues and joinery';
  if(object.kind==='stake')return 'irregular natural timber taper; cut wood and grain cues; non-uniform edges; believable perspective';
  return undefined;
}

/**
 * Art-direct procedural assets before layout/render. This does not generate
 * images and never changes story semantics. It only gives repeated assets a
 * stable identity and a professional construction brief that the vector forge
 * can resolve deterministically.
 */
export function compileCanvasProceduralAssetForge(project:CanvasStudioProject):CanvasStudioProject{
  return {
    ...project,
    scenes:project.scenes.map(scene=>{
      const variantCounts=new Map<string,number>();
      for(const object of scene.objects){
        if(object.kind==='prop'&&object.variant)variantCounts.set(object.variant,(variantCounts.get(object.variant)||0)+1);
      }
      return {
        ...scene,
        objects:scene.objects.map(object=>{
          let assetKey=canvasProceduralAssetIdentity(object,scene);
          if(object.kind==='prop'&&object.variant&&PERSISTENT_STAGE_VARIANTS.has(object.variant)){
            const stage=norm(scene.stageId||scene.backgroundRef||scene.background||'stage');
            const uniqueVariant=variantCounts.get(object.variant)===1;
            const discriminator=uniqueVariant?'primary':norm(object.slot||object.label||object.id);
            assetKey=`set:${stage}:${object.variant}:${discriminator}`;
          }
          const notes=defaultDesignNotes(object);
          return {
            ...object,
            assetKey,
            designNotes:object.designNotes?.trim()||notes,
          };
        }),
      };
    }),
  };
}
