import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasObject, type CanvasStudioScene } from './canvasAnimationStudio';
import { compileCanvasSceneLayout } from './canvasLayoutCompiler';
import { resolveCanvasPropVariant } from './canvasAssetRegistry';

test('a sleeping actor is staged on the mattress above the bed instead of standing in another slot',()=>{
  const scene:CanvasStudioScene={id:'sleep',name:'Sleep',durationMs:3000,background:'room',template:'hero-right',narration:'',effects:[],objects:[
    createCanvasObject('prop',{id:'bed',variant:'bed',assetRef:'prop:bed',slot:'hero-right',sizeClass:'hero'}),
    createCanvasObject('character',{id:'actor',pose:'lie-down',slot:'mid-left',sizeClass:'medium'}),
  ]};
  const result=compileCanvasSceneLayout(scene,1280,720);
  const [bed,actor]=result.objects;
  assert.ok(bed && actor);
  assert.equal(actor.x,bed.x);
  assert.equal(actor.y,bed.y-bed.height*.2);
  assert.equal(actor.width,bed.width*.82);
  assert.equal(actor.zIndex,bed.zIndex+1);
  assert.deepEqual(compileCanvasSceneLayout(scene,1280,720),result);
});

test('authored ghost asset overrides a stale generic box variant',()=>{
  assert.equal(resolveCanvasPropVariant({kind:'prop',variant:'box',assetRef:'prop:ghost'}),'ghost');
  assert.equal(resolveCanvasPropVariant({kind:'prop',variant:'bed',assetRef:undefined}),'bed');
});
