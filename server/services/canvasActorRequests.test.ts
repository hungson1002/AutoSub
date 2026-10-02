import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasObject, createCanvasProject } from '../../shared/canvasAnimationStudio';
import { collectCanvasActorRequests } from './canvasActorRequests';

test('requests only directed acting clips and deduplicates recurring actors', () => {
  const project = createCanvasProject();
  const actor = createCanvasObject('character', { characterKey: 'hero', assetId: 'ref-hero', pose: 'talk' });
  const other = createCanvasObject('character', { characterKey: 'villager', assetId: 'ref-villager' });
  const scene = project.scenes[0];
  scene.objects = [actor, other];
  scene.animationBeats = [
    { id: 'talk', action: 'talk', atMs: 0, durationMs: 1000, targetIds: [actor.id] },
    { id: 'point', action: 'point', atMs: 1100, durationMs: 1000, targetIds: [actor.id] },
    { id: 'camera-emphasis', action: 'pulse', atMs: 2200, durationMs: 500, targetIds: [actor.id] },
  ];
  project.scenes.push({ ...scene, id: 'scene-two' });
  const requests = collectCanvasActorRequests(project);
  assert.deepEqual(requests.map((request) => request.action), ['talk', 'point']);
  assert.ok(requests.every((request) => request.object.characterKey === 'hero'));
});

test('different reference assets and expressions never share an acting request', () => {
  const project = createCanvasProject();
  const a = createCanvasObject('character', { characterKey: 'hero', assetId: 'red', expression: 'angry' });
  const b = createCanvasObject('character', { characterKey: 'hero', assetId: 'blue', expression: 'sad' });
  project.scenes[0].objects = [a, b];
  project.scenes[0].animationBeats = [{ id: 'react', action: 'react', atMs: 0, durationMs: 600, targetIds: [a.id, b.id] }];
  const requests = collectCanvasActorRequests(project);
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].key, requests[1].key);
});

test('static pose without an acting beat does not schedule extra image generation', () => {
  const project = createCanvasProject();
  project.scenes[0].objects = [createCanvasObject('character', { pose: 'talk' })];
  project.scenes[0].animationBeats = [];
  assert.deepEqual(collectCanvasActorRequests(project), []);
});
