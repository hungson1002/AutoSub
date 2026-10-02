import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasObject,createCanvasProject,createCanvasScene} from './canvasAnimationStudio';
import {compileCanvasTreatmentState} from './canvasTreatmentState';
import {applyCanvasChoreographyState} from '../src/canvasAnimationStudio/choreography';

function fixture(cue='Minh băng chân cho bác Duy.'){
  const project=createCanvasProject();
  project.scenes=['Kiểm tra','Băng chân','Dìu đi'].map((name,index)=>{
    const patient=createCanvasObject('character',{id:`duy-${index}`,characterKey:'duy',pose:'sit',sittingStyle:'injured',legBandage:'right',bandageProgress:1,
      keyframes:index===1?[{atMs:700,dx:4},{atMs:2200,expression:'happy'}]:undefined});
    return {...createCanvasScene(index),name,durationMs:4000,narration:index===1?cue:'Minh kiểm tra chân.',objects:[patient],animationBeats:index===1?[{
      id:'aid',action:'aid' as const,targetIds:['minh'],focusTargetId:patient.id,speechCue:cue,atMs:1000,durationMs:2000,
    }]:[]};
  });return project;
}
test('compiler replaces premature dressing with timed treatment and carries it across character ids',()=>{
  const original=fixture(),result=compileCanvasTreatmentState(original);
  assert.equal(original.scenes[0]!.objects[0]!.bandageProgress,1,'do not mutate input');
  assert.equal(result.scenes[0]!.objects[0]!.bandageProgress,0);
  const scene=result.scenes[1]!,patient=scene.objects[0]!;
  assert.equal(applyCanvasChoreographyState(patient,scene,900).bandageProgress,0);
  assert.equal(applyCanvasChoreographyState(patient,scene,2000).bandageProgress,.5);
  assert.equal(applyCanvasChoreographyState(patient,scene,3500).bandageProgress,1);
  assert.equal(result.scenes[2]!.objects[0]!.bandageProgress,1);
  assert.equal(patient.keyframes?.find(f=>f.atMs===700)?.dx,4);
  assert.deepEqual(result.scenes.map(s=>s.narration),original.scenes.map(s=>s.narration));
  assert.deepEqual(compileCanvasTreatmentState(result),result);
});
test('inspection, future treatment and negated commands do not fabricate a dressing transition',()=>{
  for(const cue of ['Minh kiểm tra chân.','Minh sẽ băng chân.','Không băng chân.','Hãy băng chân cho bác.']){
    const project=fixture(cue);assert.equal(compileCanvasTreatmentState(project),project);
  }
});
