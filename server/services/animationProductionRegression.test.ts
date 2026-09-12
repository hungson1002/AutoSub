import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { defaultTransform, validateAnimationProject, type AnimationProject } from '../../shared/animationStudio';
import { buildRenderTimeline } from '../../src/remotion/timeline';
import { buildAnimationAssetManifest } from './animationManifest';
import { createSentenceTimeMapper } from './animationTiming';

// Set isolation before any service dynamically imports ffmpeg/workdir.
const root = await mkdtemp(path.join(tmpdir(), 'autosub-animation-regression-'));
process.env.AUTOSUB_WORKDIR = root;

test('sprite restart reuses retained clip sources without a provider call', async () => {
  const { default: sharp } = await import('sharp');
  const { generateAnimationSprite } = await import('./animationSpriteGeneration');
  const request = { key: 'resume', name: 'Resume', design: 'A blue character for a checkpoint fixture', clips: ['walk' as const, 'point' as const] };
  const model = 'narwhal', continuity = '';
  const key = createHash('sha256').update(JSON.stringify({ geometryVersion: 2, request, model, continuity })).digest('hex');
  const directory = path.join(root, 'animation-sprites', key);
  await mkdir(directory, { recursive: true });
  const shapes = Array.from({ length: 8 }, (_, i) => `<rect x="${i % 4 * 128 + 30}" y="${Math.floor(i / 4) * 128 + 20}" width="${25 + i * 4}" height="80" fill="#2299cc"/>`).join('');
  const image = await sharp(Buffer.from(`<svg width="512" height="256"><rect width="512" height="256" fill="#ff00ff"/>${shapes}</svg>`)).png().toBuffer();
  for (const clip of request.clips) await writeFile(path.join(directory, `${clip}-source.png`), image);
  const asset = await generateAnimationSprite(request, model, continuity);
  assert.equal(asset.sprite?.frameCount, 16);
  assert.deepEqual(Object.keys(asset.sprite!.clips), ['walk', 'point']);
  assert.equal((await generateAnimationSprite(request, model, continuity)).id, asset.id);
});

test('checkpoint survives reload, rejects corruption and releases failed execution locks', async () => {
  const { animationCheckpointKey, loadAnimationCheckpoint, saveAnimationCheckpoint, runAnimationOnce } = await import('./animationCheckpoint');
  const key = animationCheckpointKey({ fixture: randomUUID() });
  await saveAnimationCheckpoint(key, { stage: 'planned', sceneIds: ['a', 'b'] });
  assert.deepEqual(await loadAnimationCheckpoint(key), { stage: 'planned', sceneIds: ['a', 'b'] });
  await assert.rejects(runAnimationOnce(key, async () => { throw new Error('offline'); }), /offline/);
  assert.equal(await runAnimationOnce(key, async () => 'resumed'), 'resumed');
  await writeFile(path.join(root, 'animation-director-checkpoints', `${key}.json`), '{broken', 'utf8');
  await assert.rejects(loadAnimationCheckpoint(key), SyntaxError);
});

test('voice scene boundaries do not overlap audio or subtitle windows', () => {
  const p = fixture();
  p.scenes.push({ ...p.scenes[0], id: 'second', order: 1 });
  const ranges = buildRenderTimeline(p);
  assert.equal(ranges[1].from, ranges[0].durationInFrames);
  assert.equal(ranges[0].transitionOutFrames, 0);
});

test('mixed timeline retains external video scenes without overlapping their audio', () => {
  const p = fixture();
  p.scenes.push({ id: 'video', name: 'Video', order: 1, durationMs: 2000, narration: '', renderMode: 'generated-video', prompt: 'Fixture', source: { kind: 'external-video', uri: 'https://example.com/test.mp4' } });
  p.scenes.push({ ...p.scenes[0], id: 'last', order: 2 });
  const ranges = buildRenderTimeline(p);
  assert.deepEqual(ranges.map((range) => [range.scene.id, range.from, range.durationInFrames]), [['scene', 0, 180], ['video', 180, 60], ['last', 240, 180]]);
  assert.ok(ranges.every((range) => range.transitionInFrames === 0 && range.transitionOutFrames === 0));
});


function fixture(): AnimationProject {
  return { schemaVersion: 1, id: '11111111-1111-4111-8111-111111111111', name: 'Regression', createdAt: '2026-01-01', updatedAt: '2026-01-01', width: 1280, height: 720, fps: 30, assets: [], scenes: [{ id: 'scene', name: 'Scene', order: 0, narration: 'Một câu. Một câu nữa.', durationMs: 6000, renderMode: 'composite', backgroundColor: '#123', layers: [], commands: [], camera: { transform: defaultTransform(), commands: [] } }] };
}

test('sentence remapping follows measured boundaries instead of global scaling', () => {
  const mapper = createSentenceTimeMapper([{ startMs: 0, endMs: 2000 }, { startMs: 2000, endMs: 4000 }], [{ startMs: 0, endMs: 1000 }, { startMs: 1000, endMs: 6000 }], 4000, 6000);
  assert.equal(mapper(2000), 1000);
  assert.equal(mapper(4000), 6000);
});

test('procedural diagram is ready without a bitmap; background alone cannot satisfy it', () => {
  const p = fixture();
  p.productionPlan = { version: 1, source: 'manual', status: 'draft', narrationUnits: [{ id: 'n', sceneId: 'scene', text: 'Một câu.' }], beats: [{ id: 'b', sceneId: 'scene', narrationUnitId: 'n', subjectIds: [], technique: 'diagram', visibleEvidence: 'Two cards', failureConditions: ['Missing cards'] }] };
  if (p.scenes[0].renderMode !== 'composite') throw new Error('fixture');
  p.scenes[0].layers.push({ id: 'process-0-0-0-card', name: 'Card', type: 'shape', visible: true, locked: false, width: 100, height: 100, zIndex: 1, transform: defaultTransform() });
  assert.equal(buildAnimationAssetManifest(p).entries.find((entry) => entry.role === 'diagram')?.status, 'ready');
  p.scenes[0].layers = [];
  assert.equal(buildAnimationAssetManifest(p).entries.find((entry) => entry.role === 'diagram')?.status, 'missing');
});

test('concurrent library writes and measured TTS reruns preserve outputs without duplicate calls', async () => {
  const { registerAnimationAsset, generateAnimationNarration } = await import('./animationAssets');
  await Promise.all(Array.from({ length: 20 }, (_, i) => registerAnimationAsset({ id: `test-${i}`, type: 'image', name: `Test ${i}`, uri: 'data:image/png;base64,AA==', tags: [], createdAt: '2026-01-01' })));
  const saved = JSON.parse(await readFile(path.join(root, 'animation-assets/library.json'), 'utf8'));
  assert.equal(saved.filter((asset: { id: string }) => asset.id.startsWith('test-')).length, 20);
  let calls = 0;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain request */ }
    calls++;
    const samples = (calls === 1 ? 1 : 3) * 24000;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(wav);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server');
    const provider = { id: 'test-tts', name: 'Test', providerType: 'openai-compatible' as const, baseUrl: `http://127.0.0.1:${address.port}/v1`, authType: 'none' as const, enabled: true, models: [], capabilities: { tts: true } };
    const input = { project: fixture(), provider, model: 'test', voice: 'test' };
    const first = await generateAnimationNarration(input);
    const second = await generateAnimationNarration({ ...input, project: first });
    assert.equal(calls, 2);
    assert.equal(second.scenes[0].durationMs, 4000);
    assert.deepEqual(validateAnimationProject(second), []);
    if (second.scenes[0].renderMode !== 'composite') throw new Error('fixture');
    assert.deepEqual(second.scenes[0].layers.find((layer) => layer.captionTimings)?.captionTimings?.map((cue) => [cue.startMs, cue.endMs]), [[0, 1000], [1000, 4000]]);
    assert.equal(new Set(second.assets.map((asset) => asset.id)).size, second.assets.length);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

test('Director resumes the accepted plan and shares duplicate submissions', async () => {
  let calls = 0;
  const plan = { name: 'Checkpoint integration', continuityBible: 'Flat 2D blue diagrams', segments: Array.from({ length: 4 }, (_, i) => ({ title: `Part ${i}`, narration: 'Đây là nguyên nhân. Đây là kết quả.', visualBeats: [{ purpose: 'explain', narrationCue: 'Đây là nguyên nhân', action: 'Show cause then result', visual: '', motion: 'locked', transition: 'cut', diagram: { layout: 'process', steps: ['Nguyên nhân', 'Kết quả'] }, objects: [{ name: 'Signal', shape: 'ellipse', fill: '#54d8c2', width: .08, height: .08, path: [{ t: 0, x: .2, y: .5, rotation: 0 }, { t: 1, x: .8, y: .5, rotation: 0 }] }] }], motionGraphic: 'none' })) };
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    calls++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server');
    const { directAnimationProject, batchDirectAnimationProjects } = await import('./animationDirector');
    const provider = { id: 'checkpoint-fixture', name: 'Fixture', providerType: 'openai-compatible' as const, baseUrl: `http://127.0.0.1:${address.port}/v1`, authType: 'none' as const, enabled: true, models: [], capabilities: {} };
    const input = { brief: 'Giải thích nguyên nhân và kết quả bằng sơ đồ', project: { ...fixture(), id: randomUUID() }, provider, model: 'fixture', targetDurationSeconds: 30 };
    const [first, duplicate] = await Promise.all([directAnimationProject(input), directAnimationProject(input)]);
    const resumed = await directAnimationProject(input);
    assert.equal(calls, 1);
    assert.deepEqual(first.scenes.map((s) => s.id), resumed.scenes.map((s) => s.id));
    assert.deepEqual(first.scenes.map((s) => s.id), duplicate.scenes.map((s) => s.id));
    assert.deepEqual(validateAnimationProject(resumed), []);
    await directAnimationProject({ ...input, brief: `${input.brief} với ví dụ mới` });
    assert.equal(calls, 2);
    const batch = await batchDirectAnimationProjects({ ...input, template: input.project, briefs: [input.brief] });
    assert.equal(batch.completed, 1, batch.results[0]?.error);
    assert.equal(batch.failed, 0);
    assert.equal(calls, 3);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
