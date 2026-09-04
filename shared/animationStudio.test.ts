import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANIMATION_PROJECT_VERSION,
  defaultTransform,
  validateAnimationProject,
  type AnimationProject,
} from './animationStudio';

const project = (): AnimationProject => ({
  schemaVersion: ANIMATION_PROJECT_VERSION,
  id: 'd3b07384-d9a0-4d9f-89aa-5d52f3d4f631',
  name: 'Moon explainer',
  width: 1080,
  height: 1920,
  fps: 30,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  assets: [{ id: 'earth', type: 'object', name: 'Earth', uri: 'assets/earth.png', tags: ['space'], createdAt: new Date(0).toISOString() }],
  scenes: [{
    id: 'scene-001', name: 'Moon disappears', order: 0, durationMs: 5000, narration: 'What if the Moon disappeared?',
    renderMode: 'composite', backgroundColor: '#000000',
    layers: [{ id: 'earth-layer', type: 'image', name: 'Earth', assetId: 'earth', visible: true, locked: false, zIndex: 1, width: 320, height: 320, transform: defaultTransform() }],
    commands: [{ id: 'move-earth', type: 'MOVE', targetId: 'earth-layer', startMs: 0, durationMs: 2500, from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }],
    camera: { transform: defaultTransform(), commands: [{ id: 'zoom', type: 'ZOOM_IN', targetId: 'camera', startMs: 0, durationMs: 3000 }] },
  }],
});

test('accepts a deterministic composite project', () => {
  assert.deepEqual(validateAnimationProject(project()), []);
});

test('rejects missing assets, targets, and commands outside scene duration', () => {
  const value = project();
  const scene = value.scenes[0];
  assert(scene && scene.renderMode === 'composite');
  scene.layers[0]!.assetId = 'missing';
  scene.commands[0]!.targetId = 'missing-layer';
  scene.commands[0]!.durationMs = 6000;
  const paths = validateAnimationProject(value).map((issue) => issue.path);
  assert(paths.includes('scenes[0].layers[0].assetId'));
  assert(paths.includes('scenes[0].commands[0].targetId'));
  assert(paths.includes('scenes[0].commands[0]'));
});

test('allows generated video scenes beside composite scenes', () => {
  const value = project();
  value.scenes.push({
    id: 'scene-002', name: 'Cinematic B-roll', order: 1, durationMs: 8000, narration: '',
    renderMode: 'generated-video', prompt: 'A cinematic view of the Moon',
    source: { kind: 'external-video', uri: 'media/moon.mp4' },
  });
  assert.deepEqual(validateAnimationProject(value), []);
});
