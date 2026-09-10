import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnimationAssetManifest } from './animationManifest';
import { defaultTransform, type AnimationProject } from '../../shared/animationStudio';

function project(): AnimationProject {
  const now = new Date(0).toISOString();
  return {
    schemaVersion: 1,
    id: 'manifest-fixture',
    name: 'Manifest fixture',
    width: 1280,
    height: 720,
    fps: 30,
    createdAt: now,
    updatedAt: now,
    assets: [{ id: 'bg', type: 'background', name: 'Background', uri: '/bg.png', tags: ['bg'], status: 'approved', createdAt: now }],
    scenes: [{
      id: 'scene-1', name: 'Scene 1', order: 0, durationMs: 5000, narration: 'Mặt Trăng biến mất.', renderMode: 'composite', backgroundColor: '#000',
      layers: [{ id: 'visual-0-0', name: 'Background', type: 'image', assetId: 'bg', visible: true, locked: true, zIndex: 0, width: 1280, height: 720, transform: defaultTransform() }, { id: 'voice', name: 'Voiceover', type: 'audio', visible: true, locked: true, zIndex: 9, width: 1, height: 1, transform: defaultTransform() }],
      commands: [], camera: { transform: defaultTransform(), commands: [] },
    }],
    productionPlan: {
      version: 1, source: 'director', status: 'draft', narrationUnits: [{ id: 'n-1', sceneId: 'scene-1', text: 'Mặt Trăng biến mất.' }],
      beats: [{ id: 'b-1', sceneId: 'scene-1', narrationUnitId: 'n-1', cueText: 'Mặt Trăng', subjectIds: ['moon'], technique: 'image-camera', visibleEvidence: 'Mặt Trăng biến mất khỏi bầu trời', failureConditions: ['Không thấy chủ thể'] }],
    },
  };
}

test('manifest derives required background and audio entries without provider calls', () => {
  const manifest = buildAnimationAssetManifest(project(), new Date(1).toISOString());
  assert.equal(manifest.version, 1);
  assert.equal(manifest.entries.length, 2);
  assert.ok(manifest.entries.some((entry) => entry.role === 'background' && entry.status === 'ready' && entry.assetIds.includes('bg')));
  assert.ok(manifest.entries.some((entry) => entry.role === 'audio' && entry.status === 'missing'));
});

test('manifest marks candidate assets and stable cache keys', () => {
  const first = project();
  first.assets[0] = { ...first.assets[0], status: 'candidate' };
  const a = buildAnimationAssetManifest(first, new Date(1).toISOString());
  const b = buildAnimationAssetManifest(first, new Date(2).toISOString());
  const backgroundA = a.entries.find((entry) => entry.role === 'background');
  const backgroundB = b.entries.find((entry) => entry.role === 'background');
  assert.equal(backgroundA?.status, 'candidate');
  assert.equal(backgroundA?.cacheKey, backgroundB?.cacheKey);
});

test('background music cannot satisfy a required spoken narration', () => {
  const p = project();
  p.assets.push({ id: 'music', type: 'audio', name: 'Music', uri: '/music.mp3', tags: ['music'], createdAt: '' });
  if (p.scenes[0].renderMode !== 'composite') throw new Error('fixture');
  p.scenes[0].layers.push({ id: 'music', name: 'Music', type: 'audio', assetId: 'music', visible: true, locked: false, width: 1, height: 1, zIndex: 1, transform: defaultTransform() });
  assert.equal(buildAnimationAssetManifest(p).entries.find((e) => e.role === 'audio')?.status, 'missing');
});
