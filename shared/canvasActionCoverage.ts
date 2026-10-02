import type {CanvasStudioProject,CanvasAnimationAction} from './canvasAnimationStudio';

const normalize=(text:string)=>text.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/g,'d');
type Rule={pattern:RegExp;action:CanvasAnimationAction;prop?:string;person?:boolean};
const rules:Rule[]=[
  {pattern:/(?:túm chặt|tóm lấy|nắm chặt)[^.!,]{0,45}(?:cổ chân|chân)/giu,action:'grab',person:true},
  {pattern:/(?:lôi ghì|lôi tuột|kéo[^.!,]{0,15}xuống|ghì[^.!,]{0,15}xuống)[^.!,]{0,35}/giu,action:'sink',person:true},
  {pattern:/lau(?: lại)? (?:kính|đèn)/giu,action:'wipe',prop:'lantern'},
  {pattern:/(?:ghi|viết)\b[^.!?]{0,65}(?:giấy|tờ giấy|nhịp|số cứu hộ)/giu,action:'write',prop:'note'},
  {pattern:/buộc dây/giu,action:'tie',prop:'rope'},
  {pattern:/(?:kiểm tra|băng(?: bó)?) chân/giu,action:'aid',person:true},
  {pattern:/(?<![\p{L}])dìu(?![\p{L}])/giu,action:'assist',person:true},
  {pattern:/lấy\b[^.!?]{0,45}(?:mảnh|tờ) giấy/giu,action:'reach',prop:'note'},
  {pattern:/treo\b[^.!?]{0,35}đèn/giu,action:'reach',prop:'lantern'},
];
export type CanvasActionCoverageIssue={sceneId:string;sceneName:string;cue:string;message:string};

/** A narrow deterministic backstop for supported concrete actions, not a word-count quota.
 * The Director's independent review covers the remaining narration semantics. */
export function evaluateCanvasActionCoverage(project:CanvasStudioProject):CanvasActionCoverageIssue[]{
  const issues:CanvasActionCoverageIssue[]=[];
  for(const scene of project.scenes){
    // Quoted dialogue may describe plans, memories or commands to someone off-screen.
    const narration=scene.dialogue?.length?scene.dialogue.filter(l=>!l.characterKey).map(l=>l.text).join(' '):scene.narration||'';
    const normalized=normalize(narration);
    for(const rule of rules)for(const match of narration.matchAll(rule.pattern)){
      const prefix=normalized.slice(Math.max(0,match.index!-35),match.index);
      const nonEvent=rule.action==='grab'||rule.action==='sink'
        ? /(?:khong|dung|dinh|tung)\b[^,.;!?]{0,28}$/
        : /(?:khong|dung|dinh|se|tung)\b[^,.;!?]{0,28}$/;
      if(nonEvent.test(prefix))continue;
      const cue=narration.slice(match.index,match.index!+match[0].length);
      const beat=scene.animationBeats?.find(b=>b.action===rule.action&&b.speechCue&&normalize(b.speechCue).includes(normalize(match[0])));
      const actors=beat?.targetIds.map(id=>scene.objects.find(o=>o.id===id)).filter(o=>o?.kind==='character')||[];
      const target=scene.objects.find(o=>o.id===beat?.focusTargetId);
      const valid=actors.length>0&&target&&(rule.prop?target.kind==='prop'&&target.variant===rule.prop:target.kind==='character'&&!actors.some(a=>a?.id===target.id));
      if(!valid)issues.push({sceneId:scene.id,sceneName:scene.name,cue,message:`Lời kể “${cue}” cần ${rule.action}, đúng người và đích tương tác${rule.prop?` (${rule.prop})`:''}; đứng/chỉ tay không minh họa hành động này.`});
    }
    const sit=narration.match(/\bngồi\b/iu);
    if(sit&&!/(?:khong|dung|se|cu)\s+ngoi/.test(normalized)&&!scene.objects.some(o=>o.kind==='character'&&(o.pose==='sit'||o.keyframes?.some(k=>k.pose==='sit')))){
      issues.push({sceneId:scene.id,sceneName:scene.name,cue:'ngồi',message:'Lời kể mô tả ngồi nhưng không có nhân vật ngồi.'});
    }
  }
  return issues;
}

export function canvasSpokenTranscript(project:CanvasStudioProject){
  return normalize(project.scenes.map(scene=>scene.dialogue?.length?scene.dialogue.map(l=>l.text).join(' '):scene.narration||'').join(' ')).replace(/[^a-z0-9]+/g,' ').trim();
}

export function canvasSpokenIdentity(project:CanvasStudioProject){
  return project.scenes.flatMap(scene=>(scene.dialogue?.length?scene.dialogue:[{speaker:'Người kể',characterKey:undefined,text:scene.narration||''}])
    .flatMap(line=>normalize(line.text).replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean)
      .map(word=>`${normalize(line.characterKey||line.speaker)}:${word}`))).join('|');
}
