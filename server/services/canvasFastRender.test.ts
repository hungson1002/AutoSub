import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasFramePlan} from './canvasFastRender';
import {createCanvasProject} from '../../shared/canvasAnimationStudio';

test('direct frame plan preserves full resolution and uses exactly the production timeline rounding',()=>{
  const project=createCanvasProject();project.width=1280;project.height=720;project.fps=30;
  project.scenes=[{...project.scenes[0]!,durationMs:7533.333333},{...project.scenes[0]!,durationMs:10033.333333}];
  assert.deepEqual(canvasFramePlan(project),[226,301]);assert.equal(project.width,1280);assert.equal(project.height,720);assert.equal(project.fps,30);
});

test('requested export runtime retimes every cut proportionally without adding silent scenes',()=>{
  const project=createCanvasProject();project.fps=30;
  project.scenes=[{...project.scenes[0]!,durationMs:7533.333333},{...project.scenes[0]!,durationMs:10033.333333}];
  project.exportDurationMs=19000;
  const frames=canvasFramePlan(project);
  assert.equal(frames.reduce((a,b)=>a+b,0),570);
  for(const [i,n]of frames.entries())assert.ok(Math.abs(n/570-project.scenes[i]!.durationMs/17566.666666)<.002);
  project.exportDurationMs=180000;
  assert.throws(()=>canvasFramePlan(project),/20%/);
});
