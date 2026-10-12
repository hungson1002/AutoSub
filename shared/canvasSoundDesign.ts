import {vectorTrackTiming} from './canvasVectorScene';
import type { CanvasStudioScene, CanvasSoundCue, CanvasSoundPreset } from './canvasAnimationStudio';

export const CANVAS_SOUND_LABELS: Record<CanvasSoundPreset,string> = {
  water:'Nước sông', splash:'Nước bắn / mái chèo',
  knock:'Gõ gỗ', scratch:'Cào gỗ', cloth:'Chăn / vải', fire:'Lửa tí tách',
  bell:'Chu\u00f4ng', 'horror-score':'Nh\u1ea1c n\u1ec1n kinh d\u1ecb',
  wind:'Gió', footstep:'Bước chân', 'door-creak':'Cửa cót két', 'dog-howl':'Chó tru', 'pig-grunt':'Heo khụt khịt',
};

/** Modest, explicit cues; never add a scare or reveal merely to fill silence. */
export function planCanvasSoundCues(scene:CanvasStudioScene):CanvasSoundCue[] {
  const cues:CanvasSoundCue[]=[];
  const brief=`${scene.name} ${scene.narration || ''}`.toLowerCase();
  const add=(preset:CanvasSoundPreset,atMs:number,durationMs:number,volume:number,pan=0)=>{
    const start=Math.min(Math.max(0,atMs),Math.max(0,scene.durationMs-100));
    cues.push({id:`${scene.id}-sound-${cues.length}`,preset,atMs:start,durationMs:Math.min(durationMs,scene.durationMs-start),volume,pan});
  };
  const knockingStopped=/(?:tiếng )?gõ\s+(?:đã\s+)?(?:im bặt|ngừng|dừng|tắt)|không (?:còn )?(?:có )?tiếng gõ/u.test(brief);
  if (/gõ|knock/u.test(brief) && !knockingStopped && !/lời dặn|sáng|morning/u.test(scene.name.toLowerCase())) add('knock',900,1400,.38,-.18);
  if (/cào|scratch/u.test(brief)) add('scratch',900,1700,.26,-.18);
  if (/kéo chăn|cover-face/u.test(brief) || scene.objects.some(o=>o.pose==='cover-face')) {
    const event=scene.objects.flatMap(o=>o.keyframes||[]).find(k=>k.pose==='cover-face');
    add('cloth',event?.atMs??450,900,.23);
  }
  const hearth=scene.objects.find(o=>o.kind==='prop'&&(o.variant==='fire'||o.assetRef==='prop:fire'));
  if(hearth) add('fire',0,scene.durationMs,.1,Math.max(-.7,Math.min(.7,(hearth.x/1280-.5)*1.4)));
  if(scene.backgroundRef==='bg:night-stilt-house') add('wind',0,scene.durationMs,.09);
  const river=scene.background==='river'||scene.background==='underwater'||/river|rescue-banks/.test(scene.backgroundRef||'');
  if(river)for(let atMs=0;atMs<scene.durationMs&&cues.length<16;atMs+=30000)
    add('water',atMs,Math.min(30000,scene.durationMs-atMs),.13);
  // Foley follows authored physical actions rather than keywords in narration.
  for(const beat of scene.animationBeats||[]) {
    if(['surface','sink','struggle','row'].includes(beat.action)&&river){
      const actor=scene.objects.find(object=>beat.targetIds.includes(object.id));
      const pan=Math.max(-.6,Math.min(.6,((actor?.x||640)/1280-.5)*1.2));
      const spacing=beat.action==='row'?1200:900;
      for(let atMs=beat.atMs+150;atMs<beat.atMs+beat.durationMs-150&&cues.length<16;atMs+=spacing)
        add('splash',atMs,beat.action==='row'?380:650,beat.action==='row'?.16:.25,pan);
    }
    if(beat.action!=='run')continue;
    const actor=scene.objects.find(object=>beat.targetIds.includes(object.id)&&object.kind==='character');
    if(!actor)continue;
    const pan=Math.max(-.6,Math.min(.6,(actor.x/1280-.5)*1.2));
    for(let atMs=beat.atMs+180;atMs<beat.atMs+beat.durationMs-150&&cues.length<16;atMs+=550) {
      add('footstep',atMs,140,.13,pan);
    }
  }
  for(const object of scene.objects) {
    if(object.kind!=='prop'||(object.variant!=='door'&&object.assetRef!=='prop:door'))continue;
    let open=object.doorOpen;
    let atMs=0;
    for(const frame of [...(object.keyframes||[])].sort((a,b)=>a.atMs-b.atMs)) {
      if(frame.doorOpen===undefined)continue;
      if(open!==undefined&&Math.abs(frame.doorOpen-open)>.08&&cues.length<16) {
        add('door-creak',atMs,Math.max(120,Math.min(750,frame.atMs-atMs)),.12,Math.max(-.6,Math.min(.6,(object.x/1280-.5)*1.2)));
      }
      open=frame.doorOpen;atMs=frame.atMs;
    }
  }
  return cues;
}

export function normalizeCanvasSoundCues(value:unknown,durationMs:number):CanvasSoundCue[] {
  if(!Array.isArray(value))return [];
  return value.slice(0,16).flatMap((item,index)=>{
    if(!item||typeof item!=='object'||!Object.hasOwn(CANVAS_SOUND_LABELS,String(item.preset)))return [];
    const atMs=Math.max(0,Math.min(durationMs-50,Number(item.atMs)||0));
    return [{id:String(item.id||`sound-${index}`),preset:item.preset as CanvasSoundPreset,atMs,
      durationMs:Math.max(50,Math.min(30000,durationMs-atMs,Number(item.durationMs)||1000)),
      volume:Math.max(0,Math.min(1,Number.isFinite(Number(item.volume))?Number(item.volume):.3)),
      pan:Math.max(-1,Math.min(1,Number(item.pan)||0))}];
  });
}


/** A quiet musical bed is independent of authored physical action cues. */
export function canvasHorrorScoreCues(scene:CanvasStudioScene,prompt:string):CanvasSoundCue[]{
  const text=prompt.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  if(!/folk-horror|horror|truyen ma|kinh di/.test(text)||scene.soundEffects?.some(c=>c.preset==='horror-score'))return [];
  const cues:CanvasSoundCue[]=[];
  for(let atMs=0;atMs<scene.durationMs;atMs+=30000)cues.push({id:`${scene.id}-score-${atMs}`,preset:'horror-score',atMs,durationMs:Math.min(30000,scene.durationMs-atMs),volume:.3,pan:0});
  return cues;
}


export function canvasVectorBellCue(scene:CanvasStudioScene):CanvasSoundCue[]{
  if(scene.soundEffects?.some(c=>c.preset==='bell'))return [];
  const beat=scene.vectorBeats?.find(b=>/(?:giong|danh|rung|ngan|ring|strike).*(?:chuong|bell)|(?:chuong|bell).*(?:rung|ngan|ring)/.test(b.cue.normalize('NFD').replace(/\p{M}/gu,'').replace(/\u0111/g,'d').toLowerCase()));
  if(!beat)return [];
  const timing=vectorTrackTiming({target:'',start:0,end:1,cue:beat.cue,frames:[]},scene);
  const atMs=Math.min(scene.durationMs-50,Math.max(0,timing.start));
  return [{id:`${scene.id}-auto-bell`,preset:'bell',atMs,durationMs:Math.min(2500,scene.durationMs-atMs),volume:.28,pan:0}];
}
