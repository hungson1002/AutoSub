import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasObject, type CanvasStudioScene } from '../../shared/canvasAnimationStudio';
import { resolveCharacterModel } from './characters/characterModel';
import { resolveCharacterRig, segmentLength, solveTwoBoneIk } from './characters/characterRig';

function scene(backgroundRef: string, shot: NonNullable<CanvasStudioScene['camera']>['shot'] = 'medium'): CanvasStudioScene {
  return {
    id: 'scene',
    name: 'test',
    durationMs: 4000,
    background: backgroundRef.includes('night') ? 'night' : 'room',
    backgroundRef,
    template: 'two-shot',
    camera: { shot, motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    objects: [],
  };
}

test('two-bone IK preserves authored bone lengths for reachable target', () => {
  const root = { x: 0, y: 0 };
  const target = { x: 24, y: 12 };
  const result = solveTwoBoneIk(root, target, 20, 18, 1);
  assert.ok(Math.abs(segmentLength(root, result.joint) - 20) < 0.001);
  assert.ok(Math.abs(segmentLength(result.joint, result.end) - 18) < 0.001);
  assert.ok(Math.abs(result.end.x - target.x) < 0.001);
  assert.ok(Math.abs(result.end.y - target.y) < 0.001);
});

test('character identity model is deterministic by characterKey', () => {
  const a = createCanvasObject('character', { label: 'A', characterKey: 'hero-01', archetype: 'worker', height: 300, width: 180 });
  const b = createCanvasObject('character', { label: 'Renamed', characterKey: 'hero-01', archetype: 'worker', height: 300, width: 180 });
  const sa = resolveCharacterModel(a, scene('bg:room-stilt-house'));
  const sb = resolveCharacterModel(b, scene('bg:room-stilt-house'));
  assert.equal(sa.seed, sb.seed);
  assert.equal(sa.faceWidth, sb.faceWidth);
  assert.equal(sa.eyeSpacing, sb.eyeSpacing);
  assert.equal(sa.asymmetryX, sb.asymmetryX);
});

test('horror model restrains eye scale and chooses close LOD for close-up', () => {
  const actor = createCanvasObject('character', { label: 'Minh', characterKey: 'minh', archetype: 'worker', height: 280, width: 170 });
  const horror = resolveCharacterModel(actor, scene('bg:room-stilt-house', 'close-up'));
  const editorial = resolveCharacterModel(actor, scene('bg:room-study', 'close-up'));
  assert.equal(horror.horror, true);
  assert.equal(horror.lod, 'close');
  assert.ok(horror.eyeScale < editorial.eyeScale);
  assert.ok(horror.faceWidth<editorial.faceWidth,'adult horror proportions remain distinct from chibi');
});

test('rig keeps hands connected to shoulder through stable bone lengths across poses', () => {
  const actor = createCanvasObject('character', { label: 'Minh', characterKey: 'minh', archetype: 'worker', height: 300, width: 180, pose: 'point' });
  const s = scene('bg:room-stilt-house');
  const model = resolveCharacterModel(actor, s);
  for (const t of [0, 500, 1200, 2400]) {
    const rig = resolveCharacterRig(actor, model, t);
    assert.ok(Math.abs(segmentLength(rig.shoulderR, rig.elbowR) - model.armLength) < 0.01);
    assert.ok(Math.abs(segmentLength(rig.elbowR, rig.handR) - model.forearmLength) < 0.01);
  }
});
