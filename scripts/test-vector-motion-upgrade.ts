// Retained-film QA for the production native actions. No hand-authored poses,
// new drawings, regenerated voice or direct Remotion rendering.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {applyVectorRepairs} from '../server/services/canvasVectorDirector';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';

const source='tmp/vector-director-upgrade/final/project.json';
const output='tmp/vector-motion-upgrade';
const original:CanvasStudioProject=JSON.parse(await readFile(source,'utf8'));
const [rowing,,reaction,ending]=original.scenes;
assert.ok(rowing&&reaction&&ending);
const oldRow=rowing.vectorScene!.tracks.find(t=>t.target==='old/arm-r')!;
const oldStrike=reaction.vectorScene!.tracks.find(t=>t.target==='old/arm-l')!;
const oldWalk=reaction.vectorScene!.tracks.find(t=>t.target==='lam')!;
const retreat={actor:'lam',to:'old',backstep:35,start:oldWalk.start,end:oldWalk.end};
const patch={scenes:[
  {id:rowing.id,vectorScenePatch:{rows:[{actor:'old',arm:'r',prop:'old/oar',cycles:2,start:oldRow.start,end:oldRow.end,cue:oldRow.cue}],
    shot:{target:'old',height:.45,include:['lam']}}},
  {id:reaction.id,vectorScenePatch:{walks:[{...retreat,cue:oldWalk.cue}],
    strikes:[{actor:'old',arm:'l',target:'bell',start:oldStrike.start,end:oldStrike.end,cue:oldStrike.cue}]}},
  {id:ending.id,vectorScenePatch:{walks:[{...retreat,hold:true}]}},
]};
const repaired=applyVectorRepairs(original,JSON.stringify(patch),new Set(patch.scenes.map(s=>s.id)));
for(let i=0;i<original.scenes.length;i++){
  const before=original.scenes[i]!,after=repaired.scenes[i]!;
  assert.equal(after.narration,before.narration);
  assert.equal(after.durationMs,before.durationMs);
  assert.equal(after.audioUrl,before.audioUrl);
  assert.deepEqual(after.dialogue,before.dialogue);
  assert.deepEqual(JSON.parse(JSON.stringify(after.vectorScene!.nodes)),before.vectorScene!.nodes,'native actions retain all artwork');
}
assert.deepEqual(JSON.parse(JSON.stringify(repaired.vectorAssets)),original.vectorAssets);
assert.deepEqual(JSON.parse(JSON.stringify(repaired.vectorStages)),original.vectorStages);
await mkdir(output,{recursive:true});
await writeFile(output+'/native-action-patch.json',JSON.stringify(patch,null,2));
await writeFile(output+'/project.json',JSON.stringify({...repaired,id:randomUUID(),name:'Kiểm tra chuyển động mới 30 giây',vectorReview:undefined},null,2));
console.log('Prepared retained 30s film using production rows/strikes/walks; artwork, narration and audio unchanged.');
