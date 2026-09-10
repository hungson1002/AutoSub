import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnimatedObjects, buildAnimatedObjects } from './animationObjects';
import { normalizeLongAnimationSegments, buildBeatPerformances } from './animationDirector';
const object = { name: 'Vệ tinh', shape: 'ellipse', fill: '#50aaff', width: .1, height: .1, path: [{ t: 0, x: .2, y: .4, rotation: 0 }, { t: .5, x: .5, y: .2, rotation: 90 }, { t: 1, x: .8, y: .4, rotation: 180 }] };
test('moving objects survive director normalization without needing a raster background', () => {
  const [segment] = normalizeLongAnimationSegments({ segments: [{ narration: 'Vệ tinh chuyển động', visualBeats: [{ objects: normalizeAnimatedObjects([object]) }] }] }, 1);
  assert.equal(segment.visualBeats.length, 1);
  const result = buildBeatPerformances({ sceneIndex: 0, durationMs: 6000, width: 1920, height: 1080, assets: [], beats: segment.visualBeats });
  assert.equal(result.layers[0].name, 'Vệ tinh');
  assert.equal(result.commands.filter((c) => c.type === 'MOVE').length, 2);
  assert.equal(result.commands.filter((c) => c.type === 'ROTATE').length, 2);
  assert.ok(result.commands.every((c) => c.startMs >= 0 && c.startMs + c.durationMs <= 6000));
});
test('invalid object paths are rejected, never converted into a fake moving placeholder', () => {
  for (const bad of [{ ...object, width: 5 }, { ...object, fill: 'url(x)' }, { ...object, path: [{ t: 0, x: 0, y: 0 }] }, { ...object, path: [...object.path].reverse() }]) assert.deepEqual(normalizeAnimatedObjects([bad]), []);
  const result = buildAnimatedObjects(normalizeAnimatedObjects([object]), 'second', 4000, 8000, 1080, 1920);
  assert.ok(result.commands.every((c) => c.startMs >= 4000 && c.startMs + c.durationMs <= 8000));
});
