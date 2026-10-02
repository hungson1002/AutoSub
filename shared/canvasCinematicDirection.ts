import type {CanvasStudioProject,CanvasStudioScene,CanvasAnimationAction} from './canvasAnimationStudio';
import {defaultCanvasBackgroundRef,resolveCanvasAuthoredAsset} from './canvasAssetRegistry';
import {synchronizeCanvasPerformance} from './canvasPerformance';

const plain=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/g,'d');

function sceneTimeOfDay(scene:CanvasStudioScene) {
  const narration=scene.dialogue?.length?scene.dialogue.filter(line=>!line.characterKey).map(line=>line.text).join(' '):scene.narration||'';
  const current=plain(`${scene.visualBrief||''} ${narration}`);
  // Current-scene morning transitions override inherited night metadata.
  // Character dialogue about tomorrow is not a scene-time change.
  if(/sang hom sau|sang ngay hom sau|hung sang|binh minh|ban mai|suong som|ban ngay|giua trua|buoi sang|anh nang|\bdawn\b|\bdaytime\b|\bmorning\b/.test(current))return 'day' as const;
  if(/chang vang|chap choang|hoang hon|\bdusk\b|twilight|late afternoon/.test(current))return 'dusk' as const;
  if(/\bdem\b|bong toi|troi den|anh trang|\bnight\b|midnight|moonlight/.test(current))return 'night' as const;
}

/** Compile physical staging from an authored shot, not from the global prompt.
 * Retained projects and newly generated plans use exactly the same rules. */
export function directCanvasScene(scene:CanvasStudioScene,width:number,height:number):CanvasStudioScene {
  scene=structuredClone(scene);
  const narration=scene.dialogue?.length?scene.dialogue.filter(line=>!line.characterKey).map(line=>line.text).join(' '):scene.narration||'';
  const story=plain(narration);
  for(const actor of scene.objects){
    if(actor.kind!=='character'||!['walk-left','walk-right'].includes(actor.motion)||!['idle','run',undefined].includes(actor.pose))continue;
    actor.pose='run';
    actor.keyframes=actor.keyframes?.map(k=>({...k,pose:!k.pose||k.pose==='idle'?'run':k.pose}));
    const end=Math.min(scene.durationMs,Math.max(actor.motionDurationMs||0,...(actor.keyframes||[]).map(k=>k.atMs)));
    for(const beat of scene.animationBeats||[])if(beat.action==='run'&&beat.targetIds.includes(actor.id))beat.durationMs=Math.max(120,end-beat.atMs);
  }
  for(const effect of scene.effects||[])if(['vignette','flashlight'].includes(effect.type))effect.durationMs=scene.durationMs-(effect.startMs||0);
  for(const object of scene.objects){
    const asset=resolveCanvasAuthoredAsset(object);
    if(object.kind==='prop'&&asset?.kind==='prop')object.variant=asset.propVariant;
  }
  const timeOfDay=sceneTimeOfDay(scene)||scene.atmosphere?.timeOfDay;
  if(timeOfDay)scene.atmosphere={...scene.atmosphere,timeOfDay};
  const river=scene.background==='river'||scene.background==='underwater'||(scene.background==='night'&&(!scene.backgroundRef||scene.backgroundRef.includes('river')||scene.backgroundRef==='bg:night-rescue-banks'));
  if(!river)return scene;
  const night=timeOfDay==='night'||timeOfDay==='dusk';
  if(!scene.backgroundImageUrl&&scene.background!=='underwater'){
    if(night){
      scene.background='night';scene.backgroundRef='bg:night-river-shoreline';
      scene.atmosphere={...scene.atmosphere,timeOfDay:timeOfDay||'night',waterIntensity:scene.atmosphere?.waterIntensity??.55};
    }else if(timeOfDay==='day'&&scene.background==='night'){
      const shoreline=scene.backgroundRef==='bg:night-river-shoreline';
      scene.background='river';scene.backgroundRef=shoreline?'bg:river-shoreline':defaultCanvasBackgroundRef(scene);
    }
  }
  for(const prop of scene.objects){
    if(prop.variant!=='sandals'||prop.heldBy||!/bo|shore|bank/.test(plain(`${prop.designNotes||''} ${scene.visualBrief||''}`)))continue;
    scene.backgroundRef=night?'bg:night-river-shoreline':'bg:river-shoreline';
    prop.x=width*.14;prop.y=height*.76;prop.width=width*.11;prop.height=height*.06;
    prop.motion='none';prop.rotation=-12;
  }
  const ghosts=scene.objects.filter(o=>(o.variant==='ghost'||o.appearance==='water-spirit')&&!o.imageUrl);
  for(const ghost of ghosts){
    ghost.kind='character';ghost.appearance='water-spirit';ghost.variant=undefined;
    ghost.assetRef='character:villager';ghost.characterKey=ghost.characterKey||'water-spirit';
    ghost.archetype='villager';ghost.hair='messy';ghost.skinTone='#a6b7ac';
    ghost.color='#293e38';ghost.secondaryColor='#20342f';ghost.pose=ghost.pose||'idle';
    ghost.motion='none';ghost.opacity=1;ghost.width=height*.23;ghost.height=height*.45;
    ghost.waterlineY=scene.background==='underwater'?undefined:height*.67;
    ghost.y=scene.background==='underwater'?height*.49:height*.66;
    // The old icon's pop/scale animation is not a physical emergence.
    ghost.keyframes=ghost.keyframes?.map(frame=>({...frame,pose:undefined,scale:1,opacity:1}));
    if(scene.background!=='underwater')for(const beat of scene.animationBeats||[]){
      if(beat.action==='reveal'&&beat.targetIds.includes(ghost.id))beat.action='surface';
    }
  }
  const people=scene.objects.filter(o=>o.kind==='character'&&o.appearance!=='water-spirit');
  const cue=(pattern:RegExp)=>{
    const match=narration.match(pattern);if(!match)return;
    const prefix=plain(narration.slice(Math.max(0,(match.index||0)-35),match.index));
    // A legend's narrator describes the danger as "sẽ túm ...". It still
    // needs an illustration; character commands are excluded above.
    return /(?:khong|dung|dinh|tung)\b[^,.;!?]{0,28}$/.test(prefix)?undefined:match[0];
  };
  const add=(action:CanvasAnimationAction,actorId:string,targetId:string|undefined,phrase:string|undefined,durationMs:number)=>{
    if(!phrase||scene.animationBeats?.some(b=>b.action===action&&b.targetIds.includes(actorId)))return;
    const line=scene.dialogue?.find(l=>l.text.includes(phrase));
    const atMs=Math.round((line?.atMs||0)+(line?.durationMs||scene.durationMs)*Math.max(0,narration.indexOf(phrase))/Math.max(1,narration.length));
    (scene.animationBeats??=[]).push({id:`physical-${action}-${actorId}`,action,targetIds:[actorId],focusTargetId:targetId,speechCue:phrase,dialogueId:line?.id,atMs,durationMs});
  };
  const ghost=ghosts[0],victim=people.find(o=>/swimmer|boi|nan nhan/.test(plain(`${o.characterKey||''} ${o.designNotes||''} ${o.label}`)));
  const grabCue=cue(/(?:túm chặt|tóm lấy|nắm chặt)[^.!,]{0,45}(?:cổ chân|chân)/iu);
  if(ghost&&victim&&grabCue){
    scene.template='two-shot';scene.camera={shot:'medium',motion:'none',focusX:width*.5,focusY:height*.52,zoom:1};
    victim.x=width*.54;victim.y=height*.40;victim.width=height*.23;victim.height=height*.40;
    victim.pose='struggle';victim.expression='afraid';victim.waterlineY=height*.59;victim.motion='none';
    victim.keyframes=undefined;
    ghost.height=victim.height;
    ghost.x=victim.x-victim.width*.4;ghost.y=victim.y+victim.height*.46;ghost.facing='right';ghost.waterlineY=height*.71;
    ghost.keyframes=undefined;ghost.rotation=0;
    // Remove decorative shocks that previously obscured the actual grip.
    scene.effects=scene.effects?.filter(e=>e.type!=='impact'&&e.type!=='splash');
    scene.animationBeats=scene.animationBeats?.filter(b=>!(b.targetIds.includes(ghost.id)&&['reach','react','reveal','float'].includes(b.action)));
    add('grab',ghost.id,victim.id,grabCue,1800);
    add('struggle',victim.id,ghost.id,grabCue,2400);
    const sinkCue=cue(/(?:lôi ghì|lôi tuột|kéo[^.!,]{0,15}xuống|ghì[^.!,]{0,15}xuống)[^.!,]{0,35}/iu);
    add('sink',victim.id,ghost.id,sinkCue,2300);
    add('sink',ghost.id,victim.id,sinkCue,2300);
  }else if(ghost&&/troi len|nho.*mat nuoc/.test(story)){
    add('surface',ghost.id,undefined,cue(/trồi lên(?: mặt nước)?/iu),1800);
  }
  for(const person of people){
    const notes=plain(person.designNotes||'');
    if((person.pose==='lie-down'||person.pose==='float-body')&&!scene.objects.some(o=>o.variant==='bed')){
      person.pose='float-body';person.recliningStyle='exposed';person.waterlineY=height*.67;
      person.x=width*.34;person.y=height*.66;person.width=width*.26;person.height=height*.22;
      person.motion='none';person.rotation=0;person.keyframes=[{atMs:0,dx:0,dy:0},{atMs:scene.durationMs,dx:24,dy:0,easing:'ease-in-out'}];
      if(/bai boi|bai cat|dat vao/.test(story)){
        scene.backgroundRef=night?'bg:night-river-shoreline':'bg:river-shoreline';
        person.waterlineY=undefined;person.y=height*.71;
        person.keyframes=undefined;
      }
    }else if(!person.onBoat&&/boi|duoi nuoc/.test(notes)){
      person.waterlineY=person.waterlineY??height*.65;
    }else if(ghosts.length&&!person.onBoat){
      // A shore actor must stand on the near bank, not in open water.
      person.x=width*.16;person.y=height*.61;person.width=height*.22;person.height=height*.40;
    }
  }
  for(const lamp of scene.objects.filter(o=>o.variant==='lantern'&&!o.heldBy)){
    const carrier=people.find(o=>/cam|den|lantern/.test(plain(o.designNotes||'')))||(people.length===1?people[0]:undefined);
    if(carrier&&/cam tay|cam den|handheld/.test(plain(lamp.designNotes||'')))lamp.heldBy=carrier.id;
  }
  for(const tree of scene.objects.filter(o=>o.variant==='tree'&&!o.imageUrl)){
    tree.y=height*.43;tree.height=height*.24;tree.width=width*.16;
  }
  synchronizeCanvasPerformance(scene);
  return scene;
}

export function directCanvasProject(project:CanvasStudioProject):CanvasStudioProject {
  let timeOfDay:NonNullable<CanvasStudioScene['atmosphere']>['timeOfDay'];
  const result={...project,scenes:project.scenes.map(s=>{
    timeOfDay=sceneTimeOfDay(s)||timeOfDay;
    return directCanvasScene({...s,atmosphere:{...s.atmosphere,...(timeOfDay?{timeOfDay}:{})}},project.width,project.height);
  })};
  const cast=new Map<string,typeof result.scenes[number]['objects'][number]>();
  const visualStyle=/ma xo|ma da|truyen ma|kinh di|horror/.test(plain(project.sourcePrompt||''))?'horror':'story';
  for(const scene of result.scenes)for(const actor of scene.objects){
    if(actor.kind!=='character'||!actor.characterKey)continue;
    actor.visualStyle=actor.visualStyle||visualStyle;
    const original=cast.get(actor.characterKey);
    if(!original){cast.set(actor.characterKey,actor);continue;}
    actor.hair=original.hair;actor.archetype=original.archetype;actor.skinTone=original.skinTone;
    actor.color=original.color;actor.secondaryColor=original.secondaryColor;actor.appearance=original.appearance;
    actor.visualStyle=original.visualStyle;actor.voiceGender=original.voiceGender||actor.voiceGender;
  }
  return result;
}
