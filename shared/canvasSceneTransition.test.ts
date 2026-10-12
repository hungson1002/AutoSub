import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasTransitionProgress} from './canvasSceneTransition';

test('ordinary story boundary remains a hard cut',()=>{
  assert.equal(canvasTransitionProgress(0,6000,'cut'),1);
  assert.equal(canvasTransitionProgress(80,6000,'cut'),1);
});

test('same-stage continuation blends for only 180ms',()=>{
  assert.equal(canvasTransitionProgress(0,6000,'stage-blend'),0);
  assert.ok(Math.abs(canvasTransitionProgress(90,6000,'stage-blend')-.5)<1e-9);
  assert.equal(canvasTransitionProgress(180,6000,'stage-blend'),1);
  assert.equal(canvasTransitionProgress(500,6000,'stage-blend'),1);
});
