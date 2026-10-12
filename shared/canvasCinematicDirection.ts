import type {CanvasStudioProject,CanvasStudioScene,CanvasAnimationAction} from './canvasAnimationStudio';
import {defaultCanvasBackgroundRef,resolveCanvasAuthoredAsset} from './canvasAssetRegistry';
import {synchronizeCanvasPerformance} from './canvasPerformance';
import {directCanvasConversations} from './canvasDialogueDirection';

const plain=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/g,'d');

function sceneTimeOfDay(scene:CanvasStudioScene) {
  const narration=scene.dialogue?.length?scene.dialogue.filter(line=>!line.characterKey).map(line=>line.text).join(' '):scene.narration||'';
  const visual=plain(scene.visualBrief||''),spoken=plain(narration);
  const saysNight=(source:string)=>/(?:^|[^\p{L}])đêm(?:$|[^\p{L}])/iu.test(source.normalize('NFC'))
    || /ban dem|trong dem|nua dem|dem (?:toi|khuya|mu mit)|troi den|anh trang|\bnight\b|midnight|moonlight/.test(plain(source));
  const saysDay=(source:string)=>/sang hom sau|sang ngay hom sau|rang sang|hung sang|binh minh|ban mai|suong som|buoi som mai|som mai|buoi sang|anh nang|nang mai|nang som|mat troi (?:da )?(?:len cao|moc|chieu)|\bdawn\b|\bmorning\b|\bdaylight\b|sunrise|sunlight/.test(source);
  // Current-scene morning transitions override inherited night metadata.
  // Character dialogue about tomorrow is not a scene-time change.
  if(saysDay(visual))return 'day' as const;
  if(/ban ngay|\bdaytime\b/.test(visual))return 'day' as const;
  // A legend listing times when danger occurs is not a cut to midday. The
  // current shot's explicit environment takes precedence over such narration.
  for(const description of [visual]){
    if(/chang vang|chap choang|hoang hon|\bdusk\b|twilight|late afternoon/.test(description))return 'dusk' as const;
    if(saysNight(scene.visualBrief||''))return 'night' as const;
    if(/ban ngay|giua trua|\bdaytime\b/.test(description))return 'day' as const;
  }
  if(scene.atmosphere?.timeOfDay==='day'||scene.atmosphere?.timeOfDay==='dusk')return scene.atmosphere.timeOfDay;
  // Darkness can describe grief, not the light in the current shot. A repaired
  // daytime atmosphere wins unless the visual brief explicitly changes time.
  if(/bong toi/.test(visual))return 'night' as const;
  if(saysDay(spoken))return 'day' as const;
  if(/chang vang|chap choang|hoang hon|\bdusk\b|twilight|late afternoon/.test(spoken))return 'dusk' as const;
  if(saysNight(narration))return 'night' as const;
  if(/ban ngay|giua trua|\bdaytime\b/.test(spoken))return 'day' as const;
  if(scene.backgroundRef==='bg:room-stilt-day')return 'day' as const;
}

/** Compile physical staging from an authored shot, not from the global prompt.
 * Retained projects and newly generated plans use exactly the same rules. */
export function directCanvasScene(scene:CanvasStudioScene,width:number,height:number):CanvasStudioScene {
  scene=structuredClone(scene);
  if (scene.template && !['diagram-clean', 'split-contrast'].includes(scene.template)) {
    scene.animationBeats = scene.animationBeats?.filter(beat => beat.action !== 'reveal' || !!beat.speechCue
      || beat.targetIds.some(id => scene.objects.some(o => o.id === id && (o.environmentAnchor === 'doorway' || o.appearance === 'water-spirit' || o.variant === 'ghost'))));
    for (const object of scene.objects) {
      if (!['character', 'ship', 'prop', 'image'].includes(object.kind)) continue;
      if (['slide-left', 'slide-right', 'slide-up', 'pop'].includes(object.motion)) {
        object.motion = 'none'; object.delayMs = 0;
      }
      if (object.variant === 'lantern' && object.keyframes?.some(k => k.lightLevel !== undefined)) {
        object.opacity = 1;
        object.keyframes = object.keyframes.map(frame => ({...frame, opacity: 1, scale: 1}));
      }
      const opacityKeys = object.keyframes?.filter(k => k.opacity !== undefined) || [];
      if (object.opacity === 1 && object.appearance !== 'water-spirit' && object.variant !== 'ghost'
        && opacityKeys[0]?.opacity === 0 && opacityKeys[1]?.opacity === 1 && opacityKeys[1].atMs <= 1800
        && opacityKeys.slice(1).every(k => k.opacity === 1)) {
        object.keyframes = object.keyframes?.map(({opacity, ...frame}) => frame);
      }
    }
  }
  const narration=scene.dialogue?.length?scene.dialogue.filter(line=>!line.characterKey).map(line=>line.text).join(' '):scene.narration||'';
  const story=plain(narration);
  if(scene.template){
    const reacted=new Set<string>();
    scene.animationBeats=scene.animationBeats?.filter(beat=>{
      if(beat.action!=='react')return true;
      // One recoil can illustrate surprise. Repeating the same recoil for
      // every clause makes a quiet narrator's ending look like an exercise loop.
      const fresh=beat.targetIds.filter(id=>!reacted.has(id));
      if(!fresh.length)return false;
      fresh.forEach(id=>reacted.add(id));beat.targetIds=fresh;return true;
    });
  }
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
  // cover-face is the legacy blanket pose. A frightened standing actor must
  // not suddenly become a sleeping horizontal body between reaction beats.
  if(!scene.objects.some(o=>o.variant==='bed'))for(const actor of scene.objects){
    if(actor.kind!=='character')continue;
    if(actor.pose==='cover-face')actor.pose='brace';
    actor.keyframes=actor.keyframes?.map(k=>k.pose==='cover-face'?{...k,pose:'brace'}:k);
  }
  const lamps=scene.objects.filter(o=>o.variant==='lantern');
  scene.effects=scene.effects?.flatMap(effect=>{
    if(!['glow','flashlight'].includes(effect.type))return [effect];
    const source=lamps.find(o=>o.id===effect.sourceObjectId)||[...lamps].sort((a,b)=>
      Math.hypot(a.x-effect.x,a.y-effect.y)-Math.hypot(b.x-effect.x,b.y-effect.y))[0];
    if(source)return [{...effect,sourceObjectId:source.id}];
    // A decorative lamp halo without a lamp reads as a floating yellow disk.
    return effect.type==='glow'?[]:[effect];
  });
  if(scene.template==='prop-focus'&&scene.camera){
    const speaker=scene.objects.find(o=>o.kind==='character'&&scene.animationBeats?.some(b=>b.action==='talk'&&b.targetIds.includes(o.id)));
    if(speaker){
      // A dialogue shot accidentally labelled as a prop insert must frame the
      // speaker, not push them out while centering a pair of sandals.
      scene.template='hero-left';speaker.role='focal';
      for(const o of scene.objects)if(o.kind==='prop'&&o.role==='focal')o.role='support';
      scene.camera={...scene.camera,shot:'medium',focusX:speaker.x,focusY:speaker.y,zoom:1.1};
    }
  }
  if(scene.template==='prop-focus'&&scene.camera){
    const focal=scene.objects.find(o=>o.role==='focal'&&o.kind!=='character')||scene.objects.find(o=>o.kind==='prop'&&o.variant!=='lantern');
    if(focal)scene.camera={...scene.camera,focusX:focal.x,focusY:focal.y};
  }
  const timeOfDay=sceneTimeOfDay(scene)||scene.atmosphere?.timeOfDay;
  if(timeOfDay)scene.atmosphere={...scene.atmosphere,timeOfDay};
  if(!scene.backgroundImageUrl&&scene.background==='room'){
    if(timeOfDay==='day'&&scene.backgroundRef==='bg:room-stilt-house')scene.backgroundRef='bg:room-stilt-day';
    else if((timeOfDay==='night'||timeOfDay==='dusk')&&scene.backgroundRef==='bg:room-stilt-day')scene.backgroundRef='bg:room-stilt-house';
  }
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
    if(prop.variant!=='sandals'||prop.heldBy||prop.onBoat||!/\bbo\b|shore|bank/.test(plain(`${prop.designNotes||''} ${scene.visualBrief||''}`)))continue;
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
  const ferry=scene.objects.find(o=>o.kind==='ship'&&o.depth!=='background'&&o.role!=='background'
    &&(scene.objects.some(actor=>actor.onBoat===o.id)||scene.animationBeats?.some(beat=>beat.action==='grab'
      &&beat.focusTargetId===o.id&&ghosts.some(ghost=>beat.targetIds.includes(ghost.id)))));
  if(ferry)for(const spirit of ghosts){
    // Emerge beside the gunwale, with the lower body masked by the surface.
    spirit.x=ferry.x-ferry.width*.46;spirit.y=ferry.y+ferry.height*.13;
    spirit.waterlineY=ferry.y+ferry.height*.30;
    spirit.height=Math.min(spirit.height,ferry.width*.36);spirit.width=spirit.height*.55;
    spirit.keyframes=spirit.keyframes?.map(({dx,dy,rotation,...frame})=>frame);
  }
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
  const horrorProject=/ma xo|ma da|truyen ma|kinh di|horror/.test(plain(project.sourcePrompt||''));
  const result={...project,scenes:project.scenes.map((s,index)=>{
    timeOfDay=sceneTimeOfDay(s)||timeOfDay||s.atmosphere?.timeOfDay;
    const scene=directCanvasScene({...s,atmosphere:{...s.atmosphere,...(timeOfDay?{timeOfDay}:{})}},project.width,project.height);
    if(scene.template&&scene.camera&&!horrorProject){
      const travel=scene.objects.some(o=>o.kind==='character'&&(['walk-left','walk-right'].includes(o.motion)||o.keyframes?.some(k=>Math.abs(k.dx||0)>60)));
      // Quiet dialogue and inserts need time to be read. Reserve camera motion
      // for occasional shots and purposeful travel, never every generated cut.
      if(!travel&&index%4!==0)scene.camera={...scene.camera,motion:'none',keyframes:undefined};
      else if(!travel&&scene.camera.motion!=='none'){
        const zoom=scene.camera.zoom||1;
        scene.camera={...scene.camera,motion:'none',keyframes:[{atMs:0,zoom},{atMs:scene.durationMs,zoom:zoom+Math.min(.04,Math.max(0,1.35-zoom)),easing:'ease-in-out'}]};
      }
    }
    return scene;
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
  directCanvasConversations(result);
  // Every scene must leave direction with synchronized character performance.
  // Some scene branches (for example room/field shots) return before the
  // river-specific synchronizer in directCanvasScene, so enforce it once at
  // project level as the final deterministic pass.
  for(const scene of result.scenes)synchronizeCanvasPerformance(scene);
  return result;
}
