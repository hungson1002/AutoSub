import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasTransitionProgress} from '../../shared/canvasSceneTransition';

test('a story cut shows the incoming scene completely from its first frame',()=>{
  const values=Array.from({length:8},(_,frame)=>canvasTransitionProgress(frame/30*1000,12000));
  assert.ok(values.every(value=>value===1));
  assert.equal(canvasTransitionProgress(500,12000),1);
});

test('short and empty scenes also use complete cuts',()=>{
  assert.equal(canvasTransitionProgress(100,400),1);
  assert.equal(canvasTransitionProgress(0,0),1);
});
