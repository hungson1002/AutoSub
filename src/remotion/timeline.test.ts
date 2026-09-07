import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnimationProject, CompositeScene } from '../../shared/animationStudio';
import { buildRenderTimeline, renderDurationInFrames } from './timeline';

const scene = (id: string, order: number, durationMs: number): CompositeScene => ({
  id, order, durationMs, name: id, narration: '', renderMode: 'composite', backgroundColor: '#000', layers: [], commands: [],
  camera: { transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } }, commands: [] },
});

const project = (scenes: CompositeScene[]): AnimationProject => ({ schemaVersion: 1, id: '00000000-0000-0000-0000-000000000001', name: 'test', width: 1920, height: 1080, fps: 30, createdAt: '', updatedAt: '', assets: [], scenes });

test('Remotion timeline overlaps adjacent scenes for a short crossfade', () => {
  const ranges = buildRenderTimeline(project([scene('b', 1, 1000), scene('a', 0, 1000)]));
  assert.equal(ranges[0]?.scene.id, 'a');
  assert.equal(ranges[0]?.durationInFrames, 30);
  assert.equal(ranges[1]?.from, 23);
  assert.equal(ranges[1]?.transitionInFrames, 7);
  assert.equal(renderDurationInFrames(project([scene('a', 0, 1000), scene('b', 1, 1000)])), 53);
});

test('Remotion timeline keeps very short scenes valid', () => {
  const ranges = buildRenderTimeline(project([scene('a', 0, 100), scene('b', 1, 100)]));
  assert.equal(ranges[0]?.durationInFrames, 3);
  assert.equal(ranges[1]?.transitionInFrames, 1);
  assert.equal(renderDurationInFrames(project([scene('a', 0, 100), scene('b', 1, 100)])), 5);
});
