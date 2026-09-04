import test from 'node:test';
import assert from 'node:assert/strict';
import { ANIMATION_PROJECT_VERSION, defaultTransform, type AnimationProject } from '../../shared/animationStudio';
import { autoFixAnimationQuality, checkAnimationQuality } from './animationQuality';

test('flags empty, static and offscreen composite scenes', () => {
  const now = new Date().toISOString();
  const project: AnimationProject = { schemaVersion: ANIMATION_PROJECT_VERSION, id: 'test', name: 'test', width: 1080, height: 1920, fps: 30, createdAt: now, updatedAt: now, assets: [], scenes: [
    { id: 'empty', name: 'Empty', order: 0, durationMs: 4000, narration: '', renderMode: 'composite', backgroundColor: '#000', layers: [], commands: [], camera: { transform: defaultTransform(), commands: [] } },
    { id: 'offscreen', name: 'Offscreen', order: 1, durationMs: 1000, narration: '', renderMode: 'composite', backgroundColor: '#000', layers: [{ id: 'shape', name: 'Shape', type: 'shape', visible: true, locked: false, zIndex: 1, width: 100, height: 100, transform: { ...defaultTransform(), position: { x: -200, y: 100 } } }], commands: [], camera: { transform: defaultTransform(), commands: [] } },
  ] };
  const codes = checkAnimationQuality(project).map((issue) => issue.code);
  assert.ok(codes.includes('EMPTY_SCENE')); assert.ok(codes.includes('STATIC_SCENE')); assert.ok(codes.includes('OFFSCREEN_LAYER'));
  const fixed = autoFixAnimationQuality(project);
  assert.equal(fixed.remaining.some((issue) => ['EMPTY_SCENE', 'STATIC_SCENE', 'OFFSCREEN_LAYER'].includes(issue.code)), false);
  assert.equal(fixed.project.scenes[0].renderMode === 'composite' && fixed.project.scenes[0].layers.length > 0, true);
});
