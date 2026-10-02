import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasFramePlan} from './canvasFastRender';
import {createCanvasProject} from '../../shared/canvasAnimationStudio';

test('direct frame plan preserves full resolution and uses exactly the production timeline rounding',()=>{
  const project=createCanvasProject();project.width=1280;project.height=720;project.fps=30;
  project.scenes=[{...project.scenes[0]!,durationMs:7533.333333},{...project.scenes[0]!,durationMs:10033.333333}];
  assert.deepEqual(canvasFramePlan(project),[226,301]);assert.equal(project.width,1280);assert.equal(project.height,720);assert.equal(project.fps,30);
});
