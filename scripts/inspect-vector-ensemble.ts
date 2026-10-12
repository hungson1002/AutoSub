// Inspect the common tool compiler on an existing AI-produced project. No
// authored story, geometry, replacement assets or manually added motions.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {compileCanvasProjectLayout} from '../shared/canvasLayoutCompiler';
import {evaluateVectorPart,normalizeVectorScene} from '../shared/canvasVectorScene';
import {vectorEnsembleCoverage} from '../shared/canvasVectorEnsemble';
import {vectorDirectionIssues} from '../server/services/canvasVectorStory';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';
const saved=JSON.parse(await readFile(path.resolve(process.argv[2]!),'utf8'));
const source=(saved.project||saved) as CanvasStudioProject;
const output=path.resolve(process.argv[3]||'tmp/vector-ensemble-test');
await mkdir(output,{recursive:true});
const project=compileCanvasProjectLayout(structuredClone(source));
assert.deepEqual(compileCanvasProjectLayout(project),project,'normal export preparation is idempotent');
const coverage=project.scenes.map((scene,i)=>{
  normalizeVectorScene(scene.vectorScene,project.vectorAssets!,scene.narration);
  const before=vectorEnsembleCoverage(source.scenes[i]!,source.vectorAssets!),after=vectorEnsembleCoverage(scene,project.vectorAssets!);
  return {scene:scene.name,before:{active:before.activeFraction,multiple:before.multipleFraction},after:{active:after.activeFraction,multiple:after.multipleFraction},windows:after.windows};
});
const continuity=[];
for(let i=1;i<project.scenes.length;i++){
  const a=project.scenes[i-1]!,b=project.scenes[i]!;
  if(a.vectorStageId!==b.vectorStageId||b.vectorDirection?.continuity==='reset')continue;
  for(const n of b.vectorScene!.nodes.filter(n=>n.type==='instance'&&project.vectorAssets![n.asset!]?.nodes.some(p=>p.id==='puppet-root'))){
    for(const part of ['', '/upper-body','/head-group']){
      const old=evaluateVectorPart(n.id+part,a,a.durationMs),current=evaluateVectorPart(n.id+part,b,0);
      const delta=Math.max(...(['dx','dy','rotation','scaleX'] as const).map(k=>Math.abs(old[k]-current[k])));
      if(delta>.01)continuity.push({from:a.name,to:b.name,target:n.id+part,delta});
    }
  }
}
const issues=vectorDirectionIssues(project);
await writeFile(path.join(output,'project.json'),JSON.stringify(project,null,2));
await writeFile(path.join(output,'ensemble-evidence.json'),JSON.stringify({coverage,continuity,issues},null,2));
console.log(JSON.stringify({coverage:coverage.map(({windows,...c})=>c),continuity,issues}));
