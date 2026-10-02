import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasObject, createCanvasProject, type CanvasSpriteAct } from '../../shared/canvasAnimationStudio';
import { collectCanvasActorRequests } from './canvasActorRequests';
import { attachCanvasActorActs } from './canvasProfessionalSprites';

test('attaches directed sheets while preserving the static pose and other actors', () => {
  const project = createCanvasProject();
  const hero = createCanvasObject('character', { characterKey: 'hero', assetId: 'hero-pose', imageUrl: '/hero.png' });
  const villager = createCanvasObject('character', { characterKey: 'villager', assetId: 'villager-pose', imageUrl: '/villager.png' });
  project.scenes[0].objects = [hero, villager];
  project.scenes[0].animationBeats = [{ id: 'gesture', action: 'point', atMs: 300, durationMs: 900, targetIds: [hero.id] }];
  const requests = collectCanvasActorRequests(project);
  const act: CanvasSpriteAct = { action: 'point', imageUrl: '/hero-point.png', frameWidth: 256, frameHeight: 256, columns: 4, from: 0, to: 7, fps: 8, loop: false };
  const result = attachCanvasActorActs(project, requests, new Map([[requests[0].key, act]]));
  assert.deepEqual(result.scenes[0].objects[0].spriteActs, [act]);
  assert.equal(result.scenes[0].objects[0].imageUrl, '/hero.png');
  assert.equal(result.scenes[0].objects[1].spriteActs, undefined);
  assert.equal(project.scenes[0].objects[0].spriteActs, undefined);
});

test('an atlas is not attached to another expression or identity reference', () => {
  const project = createCanvasProject();
  const angry = createCanvasObject('character', { characterKey: 'hero', assetId: 'hero-pose', expression: 'angry' });
  const sad = createCanvasObject('character', { characterKey: 'hero', assetId: 'hero-pose', expression: 'sad' });
  project.scenes[0].objects = [angry, sad];
  project.scenes[0].animationBeats = [{ id: 'gesture', action: 'talk', atMs: 0, durationMs: 900, targetIds: [angry.id] }];
  const requests = collectCanvasActorRequests(project);
  const act: CanvasSpriteAct = { action: 'talk', imageUrl: '/angry-talk.png', frameWidth: 256, frameHeight: 256, columns: 4, from: 0, to: 7, fps: 8 };
  const result = attachCanvasActorActs(project, requests, new Map([[requests[0].key, act]]));
  assert.equal(result.scenes[0].objects[1].spriteActs, undefined);
});
