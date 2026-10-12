import type {
  CanvasAnimationAction,
  CanvasAnimationBeat,
  CanvasObjectKeyframe,
  CanvasStudioObject,
  CanvasStudioProject,
  CanvasStudioScene,
} from './canvasAnimationStudio';

const plain=(value:string)=>(value||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/g,'d');
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const RUN_CUE=/\b(?:chay|lao di|bo chay|run(?:s|ning)?|sprint(?:s|ed|ing)?)\b/;

const STRONG_ACTIONS=new Set<CanvasAnimationAction>([
  'grab','struggle','sink','surface','reach','wipe','write','tie','aid','assist',
  'point','react','celebrate','brace','run','row','impact',
]);

function isHorror(project:CanvasStudioProject){
  return /kinh\s*di|truyen\s*ma|horror|ghost|haunted|creepy|ma\s*x[oó]|rung\s*ron/i.test(plain(project.sourcePrompt||''))
    || project.scenes.some(scene=>scene.objects.some(object=>object.visualStyle==='horror'));
}

function characterTarget(scene:CanvasStudioScene){
  return scene.objects.find(object=>object.kind==='character'&&object.role==='focal')
    ||scene.objects.find(object=>object.kind==='character');
}

function hasDirectedAction(scene:CanvasStudioScene,actor:CanvasStudioObject){
  return (scene.animationBeats||[]).some(beat=>beat.targetIds.includes(actor.id)&&STRONG_ACTIONS.has(beat.action));
}

function cueWindow(scene:CanvasStudioScene,ratio:number,durationMs:number){
  const latest=Math.max(0,scene.durationMs-durationMs-350);
  return clamp(Math.round(scene.durationMs*ratio-durationMs*.5),350,latest);
}

function objectByVariant(scene:CanvasStudioScene,variant:string){
  return scene.objects.find(object=>object.kind==='prop'&&object.variant===variant);
}

function semanticFocusTarget(scene:CanvasStudioScene,cue:string){
  const rules:Array<[RegExp,(object:CanvasStudioObject)=>boolean]>=[
    [/bong (?:nguoi|den|mo|sau lung)|ghost|shadow|ma\b/,object=>object.variant==='ghost'||object.appearance==='water-spirit'],
    [/cua|door/,object=>object.variant==='door'||object.environmentAnchor==='doorway'],
    [/dien thoai|phone/,object=>object.variant==='phone'],
    [/manh giay|to giay|note|paper/,object=>object.variant==='note'],
    [/den|lamp|lantern/,object=>object.variant==='lantern'],
    [/giuong|bed/,object=>object.variant==='bed'],
  ];
  for(const [pattern,match] of rules){
    if(!pattern.test(cue))continue;
    const target=scene.objects.find(object=>match(object));
    if(target)return target.id;
  }
  return undefined;
}

function semanticBeat(
  scene:CanvasStudioScene,
  actor:CanvasStudioObject,
  horror:boolean,
):CanvasAnimationBeat|undefined{
  const cue=plain([scene.name,scene.visualBrief,scene.narration].filter(Boolean).join(' '));
  const suppressLook=/khong quay lai|khong ngoai lai|khong nhin|tranh nhin|does not turn|doesn't turn|do not look|avoid looking/.test(cue);
  const focusTargetId=suppressLook?undefined:semanticFocusTarget(scene,cue);
  const hold=/dung im|bat dong|im lang|nin tho|khong nhuc nhich|freeze|motionless|stillness/.test(cue);
  if(RUN_CUE.test(cue)){
    return {id:`motion-${scene.id}-run`,atMs:cueWindow(scene,.55,1200),durationMs:1200,action:'run',targetIds:[actor.id],intensity:horror?.58:.82};
  }
  if(/\b(?:he|mo) cua\b|crack(?:ed|ing)? (?:the )?door|open(?:ed|ing)? (?:the )?door/.test(cue)){
    const door=objectByVariant(scene,'door');
    return {id:`motion-${scene.id}-door-reach`,atMs:cueWindow(scene,.24,920),durationMs:920,action:'reach',targetIds:[actor.id],intensity:horror?.40:.62,...(door?{focusTargetId:door.id}:{})};
  }
  if(/nhin ra|nhìn ra|nhin qua khe|nhìn qua khe|ngo ra|ngó ra|peek|peer|look(?:ed|ing)? out/.test(cue)){
    return {id:`motion-${scene.id}-peek`,atMs:cueWindow(scene,.28,760),durationMs:760,action:'nod',targetIds:[actor.id],intensity:horror?.34:.54,speechCue:'head-turn',...(focusTargetId?{focusTargetId}:{})};
  }
  if(/giat minh|hoang hot|hoang so|choang|sung sot|startl|flinch|shock/.test(cue)){
    return {id:`motion-${scene.id}-react`,atMs:cueWindow(scene,.52,650),durationMs:650,action:'react',targetIds:[actor.id],intensity:horror?.48:.72,...(focusTargetId?{focusTargetId}:{})};
  }
  if(/lui lai|co nguoi|phong thu|thu minh|brace|recoil/.test(cue)){
    return {id:`motion-${scene.id}-brace`,atMs:cueWindow(scene,.62,900),durationMs:900,action:'brace',targetIds:[actor.id],intensity:horror?.44:.68,...(focusTargetId?{focusTargetId}:{})};
  }
  if(/ngang dau|ng[aẩ]ng|quay dau|ngoai lai|lang nghe|nghe thay|tieng go|listen|turn(?:ed)? (?:his|her|their)? ?head/.test(cue)){
    const direction=/ngang dau|ng[aẩ]ng|look up|raised? (?:his|her|their)? ?head/.test(cue)
      ?'head-up'
      :/quay dau|ngoai lai|turn(?:ed)? (?:his|her|their)? ?head/.test(cue)
        ?'head-turn'
        :'listen';
    return {id:`motion-${scene.id}-listen`,atMs:cueWindow(scene,.43,780),durationMs:780,action:'nod',targetIds:[actor.id],intensity:horror?.34:.55,speechCue:direction,...(focusTargetId?{focusTargetId}:{})};
  }
  if(/chi vao|chi tay|tro vao|point(?:ed|ing)?/.test(cue)){
    return {id:`motion-${scene.id}-point`,atMs:cueWindow(scene,.55,900),durationMs:900,action:'point',targetIds:[actor.id],intensity:horror?.45:.7,...(focusTargetId?{focusTargetId}:{})};
  }
  // A quiet horror hold is intentional. Atmosphere and facial blink may move,
  // but the body holds its pose until a motivated story beat changes it.
  if(hold)return undefined;
  return undefined;
}

function directSemanticTravel(
  scene:CanvasStudioScene,
  actor:CanvasStudioObject,
  width:number,
){
  const cue=plain([scene.name,scene.visualBrief,scene.narration].filter(Boolean).join(' '));
  if(!/lui lai|lui khoi|lui xa|back(?:ed|ing)? away|step(?:ped|ping)? back|retreat/.test(cue))return {scene,beat:undefined as CanvasAnimationBeat|undefined};
  if(actor.keyframes?.some(frame=>frame.dx!==undefined))return {scene,beat:undefined as CanvasAnimationBeat|undefined};

  const targetId=semanticFocusTarget(scene,cue);
  const target=targetId?scene.objects.find(object=>object.id===targetId):undefined;
  const direction=target
    ? (actor.x<target.x?-1:1)
    : (actor.facing==='left'?1:-1);
  const distance=Math.max(34,Math.min(width*.055,64));
  const duration=860;
  const atMs=cueWindow(scene,.24,duration);
  const endMs=Math.min(scene.durationMs-180,atMs+duration);
  const travelFrames:CanvasObjectKeyframe[]=[
    {atMs,dx:0,easing:'ease-in-out'},
    {atMs:endMs,dx:direction*distance,easing:'ease-out'},
  ];
  const objects=scene.objects.map(object=>object.id===actor.id
    ?{...object,keyframes:[...(object.keyframes||[]),...travelFrames].sort((a,b)=>a.atMs-b.atMs)}
    :object);
  const beat:CanvasAnimationBeat={
    id:`motion-${scene.id}-step-back`,
    atMs,
    durationMs:Math.max(300,endMs-atMs),
    action:'run',
    targetIds:[actor.id],
    intensity:.34,
    speechCue:'step-back',
  };
  return {scene:{...scene,objects},beat};
}

function dialogueGesture(scene:CanvasStudioScene,actor:CanvasStudioObject,horror:boolean){
  const line=(scene.dialogue||[]).find(item=>item.characterKey===actor.characterKey&&item.text.trim().length>=36);
  if(!line)return undefined;
  if((scene.animationBeats||[]).some(beat=>beat.dialogueId===line.id&&beat.action!=='talk'))return undefined;
  const duration=Math.min(820,Math.max(520,scene.durationMs*.12));
  return <CanvasAnimationBeat>{
    id:`motion-${scene.id}-dialogue-${line.id}`,
    atMs:cueWindow(scene,.48,duration),
    durationMs:duration,
    action:'gesture',
    targetIds:[actor.id],
    intensity:horror?.32:.58,
    dialogueId:line.id,
    speechCue:line.text.slice(0,120),
  };
}

/**
 * Senior acting pass inspired by pose-to-pose 2D choreography: one motivated
 * body beat, followed by a held pose. It never turns suspense into constant
 * looping body animation.
 */
export function compileCanvasMotionDirection(project:CanvasStudioProject):CanvasStudioProject{
  const horror=isHorror(project);
  return {
    ...project,
    scenes:project.scenes.map(original=>{
      const cue=plain([original.name,original.visualBrief,original.narration].filter(Boolean).join(' '));
      if(!RUN_CUE.test(cue)&&original.animationBeats?.some(beat=>beat.id===`motion-${original.id}-run`)){
        original={...original,animationBeats:original.animationBeats.filter(beat=>beat.id!==`motion-${original.id}-run`)};
      }
      const actor=characterTarget(original);
      if(!actor)return original;
      const travel=directSemanticTravel(original,actor,project.width);
      const scene=travel.scene;
      const stagedActor=scene.objects.find(object=>object.id===actor.id)||actor;
      const beats=[...(scene.animationBeats||[])];
      if(travel.beat&&!beats.some(beat=>beat.id===travel.beat!.id))beats.push(travel.beat);
      if(!hasDirectedAction(scene,stagedActor)||travel.beat){
        const semantic=semanticBeat(scene,stagedActor,horror);
        if(semantic&&!beats.some(beat=>beat.id===semantic.id))beats.push(semantic);
        else if(!semantic&&!travel.beat){
          const gesture=dialogueGesture(scene,stagedActor,horror);
          if(gesture&&!beats.some(beat=>beat.id===gesture.id))beats.push(gesture);
        }
      }
      return {...scene,animationBeats:beats.sort((a,b)=>a.atMs-b.atMs)};
    }),
  };
}
