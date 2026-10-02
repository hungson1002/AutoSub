import test from 'node:test';
import assert from 'node:assert/strict';
import { ANIMATION_PROJECT_VERSION, defaultTransform, type AnimationProject } from '../../shared/animationStudio';
import { autoFixAnimationQuality, checkAnimationQuality } from './animationQuality';

test('quality repair preserves missing assets, authored text and intentional static staging', () => {
  const project: AnimationProject = { schemaVersion: 1, id: 'preserve', name: 'Preserve', width: 1280, height: 720, fps: 30, createdAt: '', updatedAt: '', assets: [], scenes: [{ id: 's', name: 'Scene', order: 0, durationMs: 4000, narration: 'Một câu.', renderMode: 'composite', backgroundColor: '#000', camera: { transform: defaultTransform(), commands: [] }, commands: [], layers: [
    { id: 'missing', name: 'Required image', type: 'image', assetId: 'original-reference', visible: true, locked: false, width: 100, height: 100, zIndex: 1, transform: defaultTransform() },
    { id: 'text', name: 'Authored text', type: 'text', text: 'Nội dung quan trọng. '.repeat(20), visible: true, locked: false, width: 500, height: 100, zIndex: 2, transform: defaultTransform() },
  ] }] };
  const result = autoFixAnimationQuality(project);
  assert.deepEqual(result.project.scenes, project.scenes);
  assert.equal(result.fixed, 0);
  assert.ok(result.remaining.some((issue) => issue.code === 'MISSING_ASSET'));
  assert.ok(result.remaining.some((issue) => issue.code === 'LONG_TEXT'));
});

test('decorative overlays cannot pass motion quality and removal preserves user objects', () => {
  const now = new Date().toISOString();
  const project: AnimationProject = { schemaVersion: ANIMATION_PROJECT_VERSION, id: 'qa', name: 'qa', width: 1280, height: 720, fps: 30, createdAt: now, updatedAt: now, assets: [], scenes: [{ id: 's', name: 's', order: 0, durationMs: 4000, narration: 'Trái Đất quay.', renderMode: 'composite', backgroundColor: '#000', camera: { transform: defaultTransform(), commands: [] }, layers: [
    { id: 'bg', name: 'Image', type: 'image', visible: true, locked: false, zIndex: 0, width: 1280, height: 720, transform: defaultTransform() },
    { id: 'motion-accent-0', name: 'Điểm nhấn', type: 'shape', visible: true, locked: false, zIndex: 1, width: 100, height: 100, transform: defaultTransform() },
    { id: 'user-circle', name: 'Vòng tròn của người dùng', type: 'shape', visible: true, locked: false, zIndex: 2, width: 100, height: 100, transform: defaultTransform() },
  ], commands: [{ id: 'pulse', targetId: 'motion-accent-0', type: 'SCALE', startMs: 0, durationMs: 4000, from: { x: 1, y: 1 }, to: { x: 2, y: 2 } }] }] };
  assert.ok(checkAnimationQuality(project).some((i) => i.code === 'SLIDESHOW_ONLY'));
  const result = autoFixAnimationQuality(project).project.scenes[0];
  if (result.renderMode !== 'composite') throw new Error('Expected composite');
  assert.ok(result.layers.some((l) => l.id === 'user-circle'));
  assert.ok(!result.layers.some((l) => l.id === 'motion-accent-0'));
  assert.ok(!result.commands.some((c) => c.targetId === 'motion-accent-0'));
});

test('flags empty, static and offscreen composite scenes', () => {
  const now = new Date().toISOString();
  const project: AnimationProject = { schemaVersion: ANIMATION_PROJECT_VERSION, id: 'test', name: 'test', width: 1080, height: 1920, fps: 30, createdAt: now, updatedAt: now, assets: [], scenes: [
    { id: 'empty', name: 'Empty', order: 0, durationMs: 4000, narration: '', renderMode: 'composite', backgroundColor: '#000', layers: [], commands: [], camera: { transform: defaultTransform(), commands: [] } },
    { id: 'offscreen', name: 'Offscreen', order: 1, durationMs: 1000, narration: '', renderMode: 'composite', backgroundColor: '#000', layers: [{ id: 'shape', name: 'Shape', type: 'shape', visible: true, locked: false, zIndex: 1, width: 100, height: 100, transform: { ...defaultTransform(), position: { x: -200, y: 100 } } }], commands: [], camera: { transform: defaultTransform(), commands: [] } },
  ] };
  const codes = checkAnimationQuality(project).map((issue) => issue.code);
  assert.ok(codes.includes('EMPTY_SCENE')); assert.ok(codes.includes('STATIC_SCENE')); assert.ok(codes.includes('OFFSCREEN_LAYER'));
  const fixed = autoFixAnimationQuality(project);
  assert.equal(fixed.remaining.some((issue) => issue.code === 'OFFSCREEN_LAYER'), false);
  assert.ok(fixed.remaining.some((issue) => issue.code === 'EMPTY_SCENE'));
  assert.ok(fixed.remaining.some((issue) => issue.code === 'STATIC_SCENE'));
  assert.equal(fixed.fixed, 1);
  assert.equal(fixed.project.scenes[0].renderMode === 'composite' && fixed.project.scenes[0].layers.length === 0, true);
});


test('hybrid infographic is accepted as meaningful explanation without decorative motion', () => {
  const now = new Date().toISOString();
  const project: AnimationProject = {
    schemaVersion: ANIMATION_PROJECT_VERSION,
    id: 'hybrid',
    name: 'hybrid',
    width: 1280,
    height: 720,
    fps: 30,
    createdAt: now,
    updatedAt: now,
    assets: [{ id: 'background', type: 'background', name: 'Background', uri: 'data:image/png;base64,AA==', tags: [], createdAt: now }],
    scenes: [{
      id: 'scene',
      name: 'Scene',
      order: 0,
      durationMs: 5000,
      narration: 'Khẩu phần giảm từ 4.000 calo xuống 1.500 calo.',
      renderMode: 'composite',
      backgroundColor: '#f4efe6',
      camera: { transform: defaultTransform(), commands: [] },
      layers: [
        { id: 'visual-0-0', name: 'Story frame', type: 'image', assetId: 'background', visible: true, locked: true, zIndex: 0, width: 1280, height: 720, startMs: 0, durationMs: 2500, transform: { ...defaultTransform(), position: { x: 640, y: 360 } } },
        { id: 'process-0-1-0-card', name: 'So sánh 1', type: 'shape', shape: 'rectangle', visible: true, locked: false, zIndex: 10, width: 360, height: 180, fill: '#f7f1e7', transform: { ...defaultTransform(), opacity: 0, position: { x: 380, y: 360 } } },
        { id: 'process-0-1-0-label', name: 'So sánh 1', type: 'text', text: '4.000 calo', visible: true, locked: false, zIndex: 11, width: 360, height: 180, fill: '#263238', transform: { ...defaultTransform(), opacity: 0, position: { x: 380, y: 360 } } },
      ],
      commands: [
        { id: 'in-card', type: 'FADE_IN', targetId: 'process-0-1-0-card', startMs: 2500, durationMs: 1 },
        { id: 'in-label', type: 'FADE_IN', targetId: 'process-0-1-0-label', startMs: 2500, durationMs: 1 },
      ],
    }],
  };
  const codes = checkAnimationQuality(project).map((issue) => issue.code);
  assert.equal(codes.includes('SLIDESHOW_ONLY'), false);
  assert.equal(codes.includes('UNGROUNDED_MOTION'), false);
});

test('quality checker surfaces unresolved generated-image QC severity', () => {
  const now = new Date().toISOString();
  const project: AnimationProject = { schemaVersion: ANIMATION_PROJECT_VERSION, id: 'qc-tags', name: 'qc-tags', width: 1280, height: 720, fps: 30, createdAt: now, updatedAt: now, assets: [
    { id: 'hard', type: 'image', name: 'Hard', uri: 'data:image/png;base64,AA==', tags: ['qc-hard-warning'], createdAt: now },
    { id: 'soft', type: 'image', name: 'Soft', uri: 'data:image/png;base64,AA==', tags: ['qc-warning'], createdAt: now },
  ], scenes: [{ id: 'scene', name: 'Scene', order: 0, durationMs: 4000, narration: 'Một mô tả.', renderMode: 'composite', backgroundColor: '#000', camera: { transform: defaultTransform(), commands: [] }, commands: [], layers: [
    { id: 'hard-layer', name: 'Hard image', type: 'image', assetId: 'hard', visible: true, locked: false, zIndex: 0, width: 1280, height: 720, transform: defaultTransform() },
    { id: 'soft-layer', name: 'Soft image', type: 'image', assetId: 'soft', visible: true, locked: false, zIndex: 1, width: 1280, height: 720, transform: defaultTransform() },
  ] }] };
  const issues = checkAnimationQuality(project);
  assert.ok(issues.some((issue) => issue.code === 'HARD_QC_ASSET' && issue.severity === 'error'));
  assert.ok(issues.some((issue) => issue.code === 'QC_WARNING_ASSET' && issue.severity === 'warning'));
});

test('does not flag expected overlap between a full-frame background and foreground diagram', () => {
  const now = new Date().toISOString();
  const project: AnimationProject = { schemaVersion: ANIMATION_PROJECT_VERSION, id: 'backdrop', name: 'backdrop', width: 1280, height: 720, fps: 30, createdAt: now, updatedAt: now, assets: [{ id: 'background', type: 'background', name: 'Background', uri: 'data:image/png;base64,AA==', tags: [], createdAt: now }], scenes: [{ id: 'scene', name: 'Scene', order: 0, durationMs: 4000, narration: 'Một mô tả.', renderMode: 'composite', backgroundColor: '#000', camera: { transform: defaultTransform(), commands: [] }, layers: [
    { id: 'bg', name: 'Background', type: 'image', assetId: 'background', visible: true, locked: true, zIndex: 0, width: 1280, height: 720, transform: defaultTransform() },
    { id: 'card', name: 'Card', type: 'shape', visible: true, locked: false, zIndex: 1, width: 600, height: 250, transform: { ...defaultTransform(), position: { x: 640, y: 360 } } },
  ], commands: [] }] };
  assert.equal(checkAnimationQuality(project).some((issue) => issue.code === 'HEAVY_OVERLAP'), false);
});
