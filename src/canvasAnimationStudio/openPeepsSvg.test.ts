import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasObject, createCanvasScene } from './types';
import { openPeepsCharacterSvg, shouldUseOpenPeeps } from './openPeepsSvg';

test('Open Peeps SVG is deterministic for the same character identity', () => {
  const object = createCanvasObject('character', {
    characterKey: 'hero-001',
    archetype: 'narrator',
    hair: 'short',
    expression: 'happy',
    color: '#9a684a',
    pose: 'talk',
  });
  const a = openPeepsCharacterSvg(object);
  const b = openPeepsCharacterSvg({ ...object });
  assert.equal(a, b);
  assert.match(a, /^<svg\b/);
  assert.ok(a.length > 4000);
});

test('Open Peeps is reserved for generic medium/close acting, not historical action poses', () => {
  const scene = createCanvasScene();
  scene.camera = { shot: 'close-up', motion: 'push-in', focusX: 640, focusY: 360, zoom: 1 };
  const narrator = createCanvasObject('character', { archetype: 'narrator', pose: 'talk' });
  const warrior = createCanvasObject('character', { archetype: 'warrior', pose: 'talk' });
  const pointing = createCanvasObject('character', { archetype: 'narrator', pose: 'point' });
  assert.equal(shouldUseOpenPeeps(scene, narrator), true);
  assert.equal(shouldUseOpenPeeps(scene, warrior), false);
  assert.equal(shouldUseOpenPeeps(scene, pointing), false);
});
