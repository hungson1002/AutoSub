import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTransform, type AnimationCommand } from '../../shared/animationStudio';
import { evaluateScene, evaluateTransform } from './evaluator';

test('evaluates move deterministically at the requested time', () => {
  const command: AnimationCommand = { id: 'move', type: 'MOVE', targetId: 'layer', startMs: 1000, durationMs: 2000, easing: 'linear', from: { x: 0, y: 20 }, to: { x: 200, y: 60 } };
  assert.deepEqual(evaluateTransform(defaultTransform(), [command], 2000).position, { x: 100, y: 40 });
  assert.deepEqual(evaluateTransform(defaultTransform(), [command], 3000).position, { x: 200, y: 60 });
});

test('applies ease-in-out and fade without mutating the source transform', () => {
  const source = defaultTransform();
  const command: AnimationCommand = { id: 'fade', type: 'FADE_IN', targetId: 'layer', startMs: 0, durationMs: 1000, easing: 'ease-in-out' };
  assert.equal(evaluateTransform(source, [command], 500).opacity, 0.5);
  assert.equal(source.opacity, 1);
});

test('evaluates procedural jump, spawn and deterministic camera shake', () => {
  const base = defaultTransform();
  const jump = evaluateTransform(base, [{ id: 'jump', type: 'JUMP', targetId: 'actor', startMs: 0, durationMs: 1000, from: { x: 0, y: 500 }, to: { x: 100, y: 500 }, parameters: { height: 100 } }], 500);
  assert.equal(jump.position.x, 50); assert.equal(jump.position.y, 400);
  const spawn = evaluateTransform(base, [{ id: 'spawn', type: 'SPAWN', targetId: 'actor', startMs: 0, durationMs: 1000 }], 250); assert.equal(spawn.opacity, .25);
  const command = { id: 'shake', type: 'CAMERA_SHAKE' as const, targetId: 'camera', startMs: 0, durationMs: 1000, parameters: { strength: 20 } };
  assert.deepEqual(evaluateTransform(base, [command], 300), evaluateTransform(base, [command], 300));
});

test('keeps the previous timed image during a rounded cue gap and cuts cleanly at the next cue', () => {
  const image = (id: string, startMs: number, durationMs: number) => ({
    id,
    name: id,
    type: 'image' as const,
    assetId: id,
    visible: true,
    locked: true,
    zIndex: 1,
    width: 1280,
    height: 720,
    startMs,
    durationMs,
    transform: defaultTransform(),
  });
  const scene = {
    id: 'scene', name: 'Scene', order: 0, durationMs: 2_000, narration: '', renderMode: 'composite' as const,
    backgroundColor: '#000000', layers: [image('first', 0, 1_000), image('second', 1_010, 990)], commands: [],
    camera: { transform: defaultTransform(), commands: [] },
  };
  assert.deepEqual(evaluateScene(scene, 1_005).layers.map((layer) => layer.id), ['first']);
  assert.deepEqual(evaluateScene(scene, 1_010).layers.map((layer) => layer.id), ['second']);
});
