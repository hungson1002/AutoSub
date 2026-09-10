import assert from 'node:assert/strict';
import test from 'node:test';
import { animationActorPlanIssues, buildBeatPerformances, buildVisualBeatTimeline, directorRepairRule, jsonFromDirectorReply, normalizeLongAnimationSegments, replaceUnavailableGeneratedAssets } from './animationDirector';
import { wavDurationMs } from './animationAssets';
import { animationCraftRules } from './directorKnowledge';

test('actor preflight rejects missing or unsupported clips before image generation', () => {
  const segments = normalizeLongAnimationSegments({ segments: [{ narration: 'Nhân vật bước tới bàn.', visualBeats: [{ visual: 'A room', narrationCue: 'Nhân vật bước tới bàn', action: 'Walk towards table', actors: [{ assetId: 'hero', animation: 'walk', fromX: .2, toX: .6, y: .6 }] }] }] }, 1);
  const spriteRequests = [{ key: 'hero', name: 'Hero', design: 'A consistent blue cutout character with a yellow jacket', clips: ['walk'] }];
  assert.equal(animationActorPlanIssues(segments, {}, [], true).length, 1);
  assert.equal(animationActorPlanIssues(segments, { spriteRequests }, [], false).length, 1);
  assert.deepEqual(animationActorPlanIssues(segments, { spriteRequests }, [], true), []);
  segments[0].visualBeats[0].actors![0].animation = 'pick-up';
  assert.equal(animationActorPlanIssues(segments, { spriteRequests }, [], true).length, 1);
});

test('legacy decorative motion is disabled and invented narration cues are rejected', () => {
  const [segment] = normalizeLongAnimationSegments({ segments: [{ narration: 'Mặt Trăng quay quanh Trái Đất.', motionGraphic: 'focus', visualBeats: [{ visual: 'Space', narrationCue: 'Câu không tồn tại', action: 'Orbit' }] }] }, 1);
  assert.equal(segment.motionGraphic, 'none');
  assert.equal(segment.visualBeats[0].narrationCue, undefined);
});

test('performance commands preserve the exact narration cue and semantic action', () => {
  const result = buildBeatPerformances({ sceneIndex: 0, durationMs: 5000, width: 1280, height: 720, assets: [], beats: [{ purpose: 'So sánh', narrationCue: 'A khác B', action: 'Lần lượt hiện hai thuộc tính để đối chiếu', visual: '', motion: 'locked', transition: 'cut', diagram: { steps: ['A nóng', 'B lạnh'], layout: 'comparison' } }] });
  assert.ok(result.commands.every((c) => c.parameters?.narrationCue === 'A khác B'));
});

test('staged diagrams create independent editable movement within each beat', () => {
  const result = buildBeatPerformances({ sceneIndex: 0, durationMs: 4000, width: 1920, height: 1080, assets: [], beats: [{ purpose: 'process', visual: '', motion: 'locked', transition: 'cut', diagram: { steps: ['Mưa', 'Nước ngấm', 'Cây phát triển'] } }] });
  assert.equal(result.layers.length, 9);
  assert.equal(result.commands.filter((item) => item.type === 'MOVE').length, 9);
  assert.ok(result.commands.every((item) => item.startMs + item.durationMs <= 4000));
  const reveals = result.commands.filter((item) => item.type === 'FADE_IN');
  assert.ok(reveals[3].startMs > reveals[0].startMs);
});

test('portrait comparison cards stay readable, separated and inside the safe area', () => {
  const result = buildBeatPerformances({ sceneIndex: 0, durationMs: 6000, width: 1080, height: 1920, assets: [], beats: [{ purpose: 'contrast', visual: '', motion: 'locked', transition: 'cut', diagram: { layout: 'comparison', steps: ['Ăn thực vật', 'Ăn thịt'] } }] });
  const cards = result.layers.filter((layer) => layer.id.endsWith('-card'));
  assert.equal(cards.length, 2);
  assert.ok(cards[0].transform.position.y + cards[0].height / 2 < cards[1].transform.position.y - cards[1].height / 2);
  assert.ok(cards.every((layer) => layer.transform.position.x - layer.width / 2 >= 100 && layer.transform.position.x + layer.width / 2 <= 980));
  assert.equal(result.commands.filter((command) => command.type === 'SCALE').length, 6);
  assert.ok(result.commands.every((command) => command.startMs + command.durationMs <= 6000));
});

test('missing sprite clips are reported rather than replaced by fake motion', () => {
  const result = buildBeatPerformances({ sceneIndex: 0, durationMs: 4000, width: 1920, height: 1080, assets: [], beats: [{ purpose: 'walk', visual: '', motion: 'locked', transition: 'cut', actors: [{ assetId: 'missing', animation: 'walk', fromX: .2, toX: .8, y: .5 }] }] });
  assert.equal(result.layers.length, 0);
  assert.equal(result.warnings.length, 1);
});

test('leftward sprite travel mirrors the character without changing clip timing', () => {
  const result = buildBeatPerformances({ sceneIndex: 0, durationMs: 4000, width: 1280, height: 720, assets: [{ id: 'hero', name: 'Hero', type: 'sprite', uri: '/hero.png', tags: [], createdAt: '', sprite: { frameWidth: 128, frameHeight: 128, columns: 4, frameCount: 8, clips: { walk: { from: 0, to: 7, fps: 8, loop: true } } } }], beats: [{ purpose: 'walk', visual: '', motion: 'locked', transition: 'cut', actors: [{ assetId: 'hero', animation: 'walk', fromX: .8, toX: .2, y: .5 }] }] });
  assert.equal(result.layers[0].transform.scale.x, -1);
  assert.equal(result.commands.find((command) => command.type === 'PLAY_ANIMATION')?.durationMs, 4000);
});

test('missing images preserve the assigned beat instead of shifting later shots', () => {
  const asset = { id: 'last', name: 'Last', type: 'background' as const, uri: '/last.png', tags: [], createdAt: new Date().toISOString() };
  const beat = { purpose: 'reveal', visual: 'test', motion: 'locked' as const, transition: 'cut' as const };
  const result = buildVisualBeatTimeline({ sceneIndex: 0, durationMs: 8000, width: 1920, height: 1080, visuals: [undefined, asset], beats: [beat, beat] });
  assert.equal(result.layers[0].id, 'visual-0-1');
  assert.equal(result.commands.find((item) => item.type === 'FADE_IN')?.startMs, 4000);
});

test('animation craft knowledge rejects static slideshow direction', () => {
  assert.match(animationCraftRules, /ANIMATION CRAFT GATE/);
  assert.match(animationCraftRules, /anticipation before important movement and follow-through/i);
  assert.match(animationCraftRules, /visual state change every 2–4 seconds/i);
});

test('parses Director JSON wrapped in provider explanation and fenced output', () => {
  const explained = jsonFromDirectorReply('Here is the project:\n{"name":"Demo","scenes":[]}\nDone.');
  const fenced = jsonFromDirectorReply('```json\n{"name":"Fenced","scenes":[]}\n```');
  assert.equal(explained.name, 'Demo');
  assert.equal(fenced.name, 'Fenced');
});

test('does not stop at braces inside a JSON string', () => {
  const result = jsonFromDirectorReply('Result: {"name":"A {useful} title","scenes":[]} thanks');
  assert.equal(result.name, 'A {useful} title');
});

test('uses a smaller retry when provider output is truncated', () => {
  const rule = directorRepairRule('JSON từ AI Director bị thiếu phần kết thúc.');
  assert.match(rule, /exactly 2 scenes/);
  assert.match(rule, /compact one-line JSON/);
});

test('keeps the project editable when an optional generated asset fails', () => {
  const scene = { id: 'scene', name: 'Scene', order: 0, durationMs: 3000, narration: '', renderMode: 'composite' as const, backgroundColor: '#000000', layers: [{ id: 'visual', name: 'Planet', type: 'image' as const, assetId: 'requested-planet', visible: true, locked: false, zIndex: 1, width: 300, height: 300, transform: { position: { x: 100, y: 100 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } } }], commands: [], camera: { transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } }, commands: [] } };
  const [result] = replaceUnavailableGeneratedAssets([scene], new Map(), new Set(['requested-planet']));
  assert.equal(result.renderMode, 'composite');
  if (result.renderMode !== 'composite') return;
  assert.equal(result.layers[0].type, 'shape');
  assert.equal(result.layers[0].assetId, undefined);
});

test('reads real WAV duration for voice-synced scenes', () => {
  const wav = Buffer.alloc(44 + 32_000);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(32_000, 40);
  assert.equal(wavDurationMs(wav), 1000);
});

test('long animation keeps real visual beats without manufacturing four image prompts', () => {
  const segments = normalizeLongAnimationSegments({ segments: Array.from({ length: 9 }, (_, index) => ({
    title: `Scene ${index + 1}`,
    narration: `Narration ${index + 1}`,
    visual: `Subject ${index + 1}`,
  })) }, 6);
  assert.equal(segments.length, 6);
  assert.equal(segments[0].visualBeats.length, 1);
  assert.equal(segments[0].visualBeats[0].visual, 'Subject 1');
});

test('diagram-only beats survive and duplicate still prompts are removed', () => {
  const [segment] = normalizeLongAnimationSegments({ segments: [{ narration: 'Giải thích', visualBeats: [{ visual: 'Forest' }, { visual: ' forest ' }, { diagram: { steps: ['Nguyên nhân', 'Kết quả'] } }] }] }, 1);
  assert.equal(segment.visualBeats.length, 2);
  assert.equal(segment.visualBeats[1].diagram?.steps.length, 2);
});

test('visual beats create short transitions and independent camera movement', () => {
  const now = new Date().toISOString();
  const visuals = Array.from({ length: 4 }, (_, index) => ({ id: `asset-${index}`, type: 'background' as const, name: `Shot ${index}`, uri: `/shot-${index}.png`, tags: [], createdAt: now }));
  const beats = [
    { purpose: 'Establish', visual: 'wide', motion: 'push' as const, transition: 'cut' as const },
    { purpose: 'Action', visual: 'action', motion: 'pan-right' as const, transition: 'match-cut' as const },
    { purpose: 'Detail', visual: 'detail', motion: 'pull' as const, transition: 'crossfade' as const },
    { purpose: 'Reveal', visual: 'reveal', motion: 'drift-up' as const, transition: 'crossfade' as const },
  ];
  const timeline = buildVisualBeatTimeline({ sceneIndex: 0, durationMs: 10_000, width: 1920, height: 1080, visuals, beats });
  assert.equal(timeline.layers.length, 4);
  assert.equal(timeline.commands.filter((command) => command.type === 'FADE_IN').length, 3);
  assert.equal(timeline.commands.filter((command) => command.type === 'FADE_OUT').length, 3);
  assert.ok(timeline.commands.some((command) => command.type === 'MOVE'));
  assert.ok(timeline.commands.some((command) => command.type === 'SCALE'));
  assert.ok(timeline.commands.every((command) => command.startMs + command.durationMs <= 10_000));
});
